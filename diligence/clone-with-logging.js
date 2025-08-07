#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

class DetailedRepoCloner {
    constructor() {
        this.cloneDir = './cloned-repos';
        this.logFile = './detailed-clone-log.json';
        this.orgs = [];
        this.httpLog = [];
        this.results = {
            startTime: new Date().toISOString(),
            organizations: {},
            summary: {
                totalOrgs: 0,
                totalRepos: 0,
                successfulClones: 0,
                failedClones: 0,
                skippedClones: 0,
                httpRequests: 0,
                httpErrors: 0
            },
            httpLog: [],
            errors: []
        };
    }

    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message
        };
        
        console.log(`[${timestamp}] [${level}] ${message}`);
        
        if (level === 'ERROR') {
            this.results.errors.push(logEntry);
        }
    }

    logHttp(method, url, statusCode, headers, responseTime, error = null) {
        const httpEntry = {
            timestamp: new Date().toISOString(),
            method,
            url,
            statusCode,
            responseTime: `${responseTime}ms`,
            headers: {
                'user-agent': headers['user-agent'] || 'N/A',
                'x-ratelimit-remaining': headers['x-ratelimit-remaining'] || 'N/A',
                'x-ratelimit-limit': headers['x-ratelimit-limit'] || 'N/A',
                'x-ratelimit-reset': headers['x-ratelimit-reset'] || 'N/A'
            },
            error
        };
        
        this.results.httpLog.push(httpEntry);
        this.results.summary.httpRequests++;
        
        if (error) {
            this.results.summary.httpErrors++;
        }

        const statusColor = statusCode >= 200 && statusCode < 300 ? '\x1b[32m' : 
                           statusCode >= 400 ? '\x1b[31m' : '\x1b[33m';
        
        this.log(`HTTP ${method} ${url} → ${statusColor}${statusCode}\x1b[0m (${responseTime}ms)${
            headers['x-ratelimit-remaining'] ? ` [Rate limit: ${headers['x-ratelimit-remaining']}/${headers['x-ratelimit-limit']}]` : ''
        }${error ? ` ERROR: ${error}` : ''}`, 'HTTP');
    }

    async executeGhCommand(command) {
        const startTime = Date.now();
        try {
            this.log(`Executing: ${command}`, 'CMD');
            const result = execSync(command, { 
                encoding: 'utf8', 
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, GH_DEBUG: 'api' }
            });
            
            const responseTime = Date.now() - startTime;
            this.log(`Command completed in ${responseTime}ms`, 'CMD');
            
            return result.trim();
        } catch (error) {
            const responseTime = Date.now() - startTime;
            this.log(`Command failed after ${responseTime}ms: ${error.message}`, 'ERROR');
            
            // Try to extract HTTP info from gh CLI error
            if (error.stderr) {
                const httpMatch = error.stderr.match(/HTTP (\d+)/);
                if (httpMatch) {
                    this.logHttp('GET', 'GitHub CLI', parseInt(httpMatch[1]), {}, responseTime, error.message);
                }
            }
            
            throw error;
        }
    }

    async ensureDirectory(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            this.log(`Created directory: ${dirPath}`, 'DIR');
        }
    }

    async checkRateLimit() {
        this.log('🌐 Checking GitHub API rate limits...', 'INFO');
        
        try {
            const output = await this.executeGhCommand('gh api /rate_limit');
            const rateLimitData = JSON.parse(output);
            
            this.log('📊 Rate Limit Status:', 'RATE');
            this.log(`    Core API:`, 'RATE');
            this.log(`      - Limit: ${rateLimitData.resources.core.limit}`, 'RATE');
            this.log(`      - Remaining: ${rateLimitData.resources.core.remaining}`, 'RATE');
            this.log(`      - Reset: ${new Date(rateLimitData.resources.core.reset * 1000).toISOString()}`, 'RATE');
            this.log(`    Search API:`, 'RATE');
            this.log(`      - Limit: ${rateLimitData.resources.search.limit}`, 'RATE');
            this.log(`      - Remaining: ${rateLimitData.resources.search.remaining}`, 'RATE');
            this.log(`      - Reset: ${new Date(rateLimitData.resources.search.reset * 1000).toISOString()}`, 'RATE');
            
            // Store in results
            this.results.initialRateLimit = rateLimitData;
            
            return rateLimitData;
        } catch (error) {
            this.log(`⚠️  Failed to check rate limits: ${error.message}`, 'WARNING');
            return null;
        }
    }

    async getOrganizations() {
        this.log('🏢 Fetching organizations with detailed HTTP logging...', 'INFO');
        
        try {
            // First try with plain text output (older gh CLI versions)
            const output = await this.executeGhCommand('gh org list');
            const lines = output.split('\n').filter(line => line.trim() && !line.includes('Showing'));
            this.orgs = lines.map(line => line.trim());
            this.results.summary.totalOrgs = this.orgs.length;
            
            this.log(`Found ${this.orgs.length} organizations: ${this.orgs.join(', ')}`, 'SUCCESS');
            
            return this.orgs;
        } catch (error) {
            this.log(`Failed to get organizations: ${error.message}`, 'ERROR');
            throw error;
        }
    }

    async getRepositories(org) {
        this.log(`📋 Fetching repositories for organization: ${org}`, 'INFO');
        
        try {
            // Try JSON format first, fall back to plain text if not supported
            let reposData = [];
            try {
                const jsonOutput = await this.executeGhCommand(`gh repo list ${org} --limit 1000 --json name,sshUrl,cloneUrl,size,language,updatedAt`);
                reposData = JSON.parse(jsonOutput);
            } catch (jsonError) {
                this.log(`JSON format not supported, using plain text format`, 'INFO');
                // Fall back to plain text format
                const textOutput = await this.executeGhCommand(`gh repo list ${org} --limit 1000`);
                const lines = textOutput.split('\n').filter(line => line.trim());
                
                reposData = lines.map(line => {
                    const parts = line.split('\t');
                    const fullName = parts[0] || '';
                    const name = fullName.split('/')[1] || fullName;
                    return {
                        name: name,
                        cloneUrl: `https://github.com/${org}/${name}.git`,
                        sshUrl: `git@github.com:${org}/${name}.git`,
                        size: null,
                        language: parts[2] || null,
                        updatedAt: parts[3] || null
                    };
                });
            }
            
            this.results.summary.totalRepos += reposData.length;
            
            this.log(`Found ${reposData.length} repositories in ${org}`, 'SUCCESS');
            
            // Log repository details
            reposData.forEach(repo => {
                this.log(`  → ${repo.name} (${repo.language || 'Unknown'}, ${repo.size || 0}KB, updated: ${repo.updatedAt || 'Unknown'})`, 'REPO');
            });
            
            return reposData;
        } catch (error) {
            this.log(`Failed to get repositories for ${org}: ${error.message}`, 'ERROR');
            return [];
        }
    }

    async cloneRepository(org, repoData) {
        const { name: repo, cloneUrl, sshUrl, size, language } = repoData;
        const orgDir = path.join(this.cloneDir, org);
        const repoPath = path.join(orgDir, repo);
        
        await this.ensureDirectory(orgDir);
        
        // Skip if already cloned
        if (fs.existsSync(repoPath)) {
            this.log(`⏭️  Repository ${org}/${repo} already exists, skipping`, 'SKIP');
            this.results.summary.skippedClones++;
            return { success: true, skipped: true, reason: 'Already exists' };
        }
        
        const startTime = Date.now();
        this.log(`📥 Cloning ${org}/${repo} (${language || 'Unknown'}, ${size || 0}KB)...`, 'CLONE');
        this.log(`    Using URL: ${cloneUrl}`, 'CLONE');
        
        try {
            // Use spawn to get real-time output with better authentication handling
            const cloneProcess = spawn('git', [
                'clone', 
                '--depth', '1',
                '--single-branch',
                '--progress',
                cloneUrl,
                repoPath
            ], {
                stdio: ['ignore', 'pipe', 'pipe'],  // Ignore stdin to prevent prompts
                env: {
                    ...process.env,
                    GIT_TERMINAL_PROMPT: '0',  // Disable git prompts
                    GIT_ASKPASS: 'echo',       // Use empty password
                    SSH_ASKPASS: 'echo'        // Use empty SSH password
                }
            });
            
            let stdout = '';
            let stderr = '';
            
            cloneProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            cloneProcess.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                
                // Check for authentication prompts and kill process
                if (output.includes('Username for') || output.includes('Password for') || 
                    output.includes('Authentication failed') || output.includes('Repository not found')) {
                    this.log(`    ⚠️  Authentication required or repo not accessible - killing process`, 'AUTH');
                    cloneProcess.kill('SIGKILL');
                    return;
                }
                
                // Log real-time clone progress
                const lines = output.split('\n').filter(line => line.trim());
                lines.forEach(line => {
                    if (line.includes('Receiving objects') || line.includes('Resolving deltas')) {
                        this.log(`    ${line.trim()}`, 'PROGRESS');
                    }
                });
            });
            
            await new Promise((resolve, reject) => {
                cloneProcess.on('close', (code) => {
                    const responseTime = Date.now() - startTime;
                    
                    if (code === 0) {
                        this.log(`✅ Successfully cloned ${org}/${repo} in ${responseTime}ms`, 'SUCCESS');
                        this.results.summary.successfulClones++;
                        resolve();
                    } else {
                        // Check if this was an authentication/access issue
                        const isAuthIssue = stderr.includes('Authentication failed') || 
                                          stderr.includes('Repository not found') ||
                                          stderr.includes('Username for') ||
                                          stderr.includes('Password for') ||
                                          code === 128;
                        
                        if (isAuthIssue) {
                            this.log(`🔐 Repository ${org}/${repo} requires authentication or doesn't exist - skipping`, 'SKIP');
                            this.log(`    Error: ${stderr.split('\n').find(line => line.includes('fatal:')) || 'Authentication required'}`, 'SKIP');
                            this.results.summary.skippedClones++;
                            resolve({ success: true, skipped: true, reason: 'Authentication required' });
                        } else {
                            this.log(`❌ Failed to clone ${org}/${repo} (exit code: ${code}) after ${responseTime}ms`, 'ERROR');
                            this.log(`    stdout: ${stdout}`, 'ERROR');
                            this.log(`    stderr: ${stderr}`, 'ERROR');
                            this.results.summary.failedClones++;
                            reject(new Error(`Git clone failed with exit code ${code}`));
                        }
                    }
                });
                
                cloneProcess.on('error', (error) => {
                    const responseTime = Date.now() - startTime;
                    this.log(`❌ Clone process error for ${org}/${repo} after ${responseTime}ms: ${error.message}`, 'ERROR');
                    this.results.summary.failedClones++;
                    reject(error);
                });
                
                // Shorter timeout for concurrent processing (30 seconds for auth issues)
                const timeoutId = setTimeout(() => {
                    cloneProcess.kill('SIGKILL');
                    const responseTime = Date.now() - startTime;
                    
                    // If timeout is due to auth prompts, treat as skip
                    if (stderr.includes('Username for') || stderr.includes('Password for')) {
                        this.log(`🔐 Repository ${org}/${repo} timed out waiting for auth - skipping`, 'SKIP');
                        this.results.summary.skippedClones++;
                        resolve({ success: true, skipped: true, reason: 'Authentication timeout' });
                    } else {
                        this.log(`⏰ Clone timeout for ${org}/${repo} after ${responseTime}ms`, 'ERROR');
                        this.results.summary.failedClones++;
                        reject(new Error('Clone timeout'));
                    }
                }, 30000); // Reduced to 30 seconds
                
                // Clear timeout when process ends
                cloneProcess.on('close', () => clearTimeout(timeoutId));
                cloneProcess.on('error', () => clearTimeout(timeoutId));
            });
            
            // Log final repository info
            const stats = fs.statSync(repoPath);
            const responseTime = Date.now() - startTime;
            
            this.log(`    Repository cloned to: ${repoPath}`, 'INFO');
            this.log(`    Clone completed in: ${responseTime}ms`, 'INFO');
            
            return { 
                success: true, 
                skipped: false, 
                cloneTime: responseTime,
                repoSize: size,
                language: language
            };
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            this.log(`❌ Failed to clone ${org}/${repo}: ${error.message}`, 'ERROR');
            
            // Clean up partial clone
            if (fs.existsSync(repoPath)) {
                try {
                    fs.rmSync(repoPath, { recursive: true, force: true });
                    this.log(`    Cleaned up partial clone: ${repoPath}`, 'CLEANUP');
                } catch (cleanupError) {
                    this.log(`    Failed to cleanup ${repoPath}: ${cleanupError.message}`, 'ERROR');
                }
            }
            
            this.results.summary.failedClones++;
            return { 
                success: false, 
                skipped: false, 
                error: error.message,
                cloneTime: responseTime
            };
        }
    }

    async processOrganization(org) {
        this.log(`\n=== Processing Organization: ${org} ===`, 'ORG');
        
        this.results.organizations[org] = {
            repositories: {},
            summary: {
                totalRepos: 0,
                successfulClones: 0,
                failedClones: 0,
                skippedClones: 0
            }
        };
        
        try {
            const repos = await this.getRepositories(org);
            this.results.organizations[org].summary.totalRepos = repos.length;
            
            if (repos.length === 0) {
                this.log(`No repositories found in ${org}`, 'WARNING');
                return;
            }
            
            // Process repositories in batches with TRUE concurrency
            const batchSize = 5; // Increased for concurrent processing
            for (let i = 0; i < repos.length; i += batchSize) {
                const batch = repos.slice(i, i + batchSize);
                const batchNum = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(repos.length / batchSize);
                
                this.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} repos) - CONCURRENT`, 'BATCH');
                
                // Process batch CONCURRENTLY using Promise.all
                const batchPromises = batch.map(repoData => this.cloneRepository(org, repoData));
                const batchResults = await Promise.allSettled(batchPromises);
                
                // Process results
                batchResults.forEach((promiseResult, index) => {
                    const repoData = batch[index];
                    let result;
                    
                    if (promiseResult.status === 'fulfilled') {
                        result = promiseResult.value;
                    } else {
                        result = {
                            success: false,
                            skipped: false,
                            error: promiseResult.reason?.message || 'Unknown error',
                            cloneTime: 0
                        };
                    }
                    
                    this.results.organizations[org].repositories[repoData.name] = result;
                    
                    // Update organization summary
                    if (result.success) {
                        if (result.skipped) {
                            this.results.organizations[org].summary.skippedClones++;
                        } else {
                            this.results.organizations[org].summary.successfulClones++;
                        }
                    } else {
                        this.results.organizations[org].summary.failedClones++;
                    }
                });
                
                this.log(`✅ Batch ${batchNum} completed: ${batch.length} repositories processed concurrently`, 'BATCH');
                
                // Brief delay between batches to be respectful to GitHub
                if (i + batchSize < repos.length) {
                    this.log(`Waiting 1 second before next batch...`, 'WAIT');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            const orgSummary = this.results.organizations[org].summary;
            this.log(`✅ Organization ${org} completed:`, 'ORG');
            this.log(`    Total: ${orgSummary.totalRepos}`, 'ORG');
            this.log(`    Successful: ${orgSummary.successfulClones}`, 'ORG');
            this.log(`    Failed: ${orgSummary.failedClones}`, 'ORG');
            this.log(`    Skipped: ${orgSummary.skippedClones}`, 'ORG');
            
        } catch (error) {
            this.log(`Failed to process organization ${org}: ${error.message}`, 'ERROR');
        }
    }

    async generateReports() {
        this.results.endTime = new Date().toISOString();
        this.results.duration = new Date(this.results.endTime) - new Date(this.results.startTime);
        
        // Write detailed JSON log
        fs.writeFileSync(this.logFile, JSON.stringify(this.results, null, 2));
        
        // Generate summary report
        const summaryFile = './clone-detailed-summary.txt';
        let summary = `Detailed Repository Clone Summary\n`;
        summary += `================================\n\n`;
        summary += `Started: ${this.results.startTime}\n`;
        summary += `Completed: ${this.results.endTime}\n`;
        summary += `Duration: ${Math.round(this.results.duration / 1000)}s\n\n`;
        
        summary += `Overall Statistics:\n`;
        summary += `- Organizations processed: ${this.results.summary.totalOrgs}\n`;
        summary += `- Total repositories found: ${this.results.summary.totalRepos}\n`;
        summary += `- Successfully cloned: ${this.results.summary.successfulClones}\n`;
        summary += `- Failed to clone: ${this.results.summary.failedClones}\n`;
        summary += `- Skipped (already exist): ${this.results.summary.skippedClones}\n`;
        summary += `- HTTP requests made: ${this.results.summary.httpRequests}\n`;
        summary += `- HTTP errors: ${this.results.summary.httpErrors}\n\n`;
        
        // HTTP Log Summary
        if (this.results.httpLog.length > 0) {
            summary += `HTTP Request Summary:\n`;
            const statusCounts = {};
            this.results.httpLog.forEach(req => {
                statusCounts[req.statusCode] = (statusCounts[req.statusCode] || 0) + 1;
            });
            
            Object.entries(statusCounts).sort().forEach(([status, count]) => {
                summary += `- HTTP ${status}: ${count} requests\n`;
            });
            summary += `\n`;
        }
        
        // Organization breakdown
        summary += `By Organization:\n`;
        Object.entries(this.results.organizations).forEach(([org, data]) => {
            summary += `\n${org}:\n`;
            summary += `  - Total repos: ${data.summary.totalRepos}\n`;
            summary += `  - Cloned: ${data.summary.successfulClones}\n`;
            summary += `  - Failed: ${data.summary.failedClones}\n`;
            summary += `  - Skipped: ${data.summary.skippedClones}\n`;
        });
        
        // Error summary
        if (this.results.errors.length > 0) {
            summary += `\nErrors (${this.results.errors.length}):\n`;
            this.results.errors.forEach((error, i) => {
                summary += `${i + 1}. [${error.timestamp}] ${error.message}\n`;
            });
        }
        
        fs.writeFileSync(summaryFile, summary);
        
        this.log(`\n📊 Reports generated:`, 'REPORT');
        this.log(`   - Detailed log: ${path.resolve(this.logFile)}`, 'REPORT');
        this.log(`   - Summary: ${path.resolve(summaryFile)}`, 'REPORT');
    }

    async run() {
        try {
            this.log('🚀 Starting detailed repository cloning with HTTP logging...', 'START');
            
            // Verify prerequisites
            try {
                const versionOutput = await this.executeGhCommand('gh --version');
                this.log(`✅ GitHub CLI is available: ${versionOutput.split('\n')[0]}`, 'CHECK');
            } catch (error) {
                this.log('❌ GitHub CLI not found or not authenticated', 'ERROR');
                throw new Error('Please install and authenticate GitHub CLI first');
            }
            
            // Check authentication status
            try {
                const authOutput = await this.executeGhCommand('gh auth status');
                this.log('✅ GitHub CLI is authenticated', 'CHECK');
            } catch (error) {
                this.log('⚠️  GitHub CLI authentication issue - continuing anyway', 'WARNING');
            }
            
            // Check initial rate limits
            await this.checkRateLimit();
            
            await this.ensureDirectory(this.cloneDir);
            
            // Get all organizations
            const orgs = await this.getOrganizations();
            
            // Process each organization
            for (const org of orgs) {
                await this.processOrganization(org);
            }
            
            // Check final rate limits
            this.log('\n🌐 Checking final rate limits...', 'INFO');
            const finalRateLimit = await this.checkRateLimit();
            if (finalRateLimit && this.results.initialRateLimit) {
                const coreUsed = this.results.initialRateLimit.resources.core.remaining - finalRateLimit.resources.core.remaining;
                const searchUsed = this.results.initialRateLimit.resources.search.remaining - finalRateLimit.resources.search.remaining;
                this.log(`📊 API Usage Summary:`, 'RATE');
                this.log(`    Core API requests used: ${coreUsed}`, 'RATE');
                this.log(`    Search API requests used: ${searchUsed}`, 'RATE');
                this.results.finalRateLimit = finalRateLimit;
                this.results.apiUsage = { core: coreUsed, search: searchUsed };
            }
            
            // Generate final reports
            await this.generateReports();
            
            this.log(`\n🎉 Clone process completed!`, 'COMPLETE');
            this.log(`📁 Repositories cloned to: ${path.resolve(this.cloneDir)}`, 'COMPLETE');
            this.log(`📊 Results: ${this.results.summary.successfulClones} cloned, ${this.results.summary.failedClones} failed, ${this.results.summary.skippedClones} skipped`, 'COMPLETE');
            this.log(`🌐 HTTP requests: ${this.results.summary.httpRequests} total, ${this.results.summary.httpErrors} errors`, 'COMPLETE');
            
        } catch (error) {
            this.log(`💥 Clone process failed: ${error.message}`, 'FATAL');
            process.exit(1);
        }
    }
}

// Run the script
if (require.main === module) {
    const cloner = new DetailedRepoCloner();
    cloner.run().catch(error => {
        console.error('💥 Script failed:', error);
        process.exit(1);
    });
}

module.exports = DetailedRepoCloner;
