#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Open Source Component Analysis Script
 * Analyzes all package-lock.json files in cloned-repos directory
 * to generate a comprehensive list of dependencies with versions and licenses
 * 
 * Usage:
 *   node analyze-dependencies.js                  # Full analysis with license info
 *   node analyze-dependencies.js --skip-licenses  # Fast analysis without license info
 */

// Configuration
const CLONED_REPOS_DIR = './cloned-repos';
const OUTPUT_FILE = 'open-source-components.json';
const OUTPUT_CSV = 'open-source-components.csv';
const MAX_CONCURRENT_REQUESTS = 25; // Increased for faster processing
const REQUEST_TIMEOUT = 3000; // Reduced timeout for faster failures
const BATCH_DELAY = 50; // Reduced delay between batches
const SKIP_LICENSES = process.argv.includes('--skip-licenses'); // Flag to skip license fetching
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='));
const PACKAGE_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : null; // Limit number of packages to process

console.log('🔍 Starting Open Source Component Analysis...');
if (SKIP_LICENSES) {
    console.log('⚡ Fast mode: Skipping license information for speed\n');
} else {
    console.log('🔍 Full mode: Including license information (slower)\n');
}

/**
 * Find all package-lock.json files recursively
 */
function findPackageLockFiles(dir) {
    const results = [];
    
    function scan(currentDir) {
        try {
            const items = fs.readdirSync(currentDir);
            
            for (const item of items) {
                const itemPath = path.join(currentDir, item);
                const stat = fs.statSync(itemPath);
                
                if (stat.isDirectory()) {
                    // Skip node_modules and other common directories to avoid noise
                    if (!['node_modules', '.git', 'dist', 'build', 'coverage'].includes(item)) {
                        scan(itemPath);
                    }
                } else if (item === 'package-lock.json') {
                    results.push(itemPath);
                }
            }
        } catch (err) {
            console.warn(`⚠️  Warning: Could not scan directory ${currentDir}: ${err.message}`);
        }
    }
    
    scan(dir);
    return results;
}

/**
 * Parse package-lock.json and extract all dependencies
 */
function parseDependencies(packageLockPath) {
    try {
        const content = fs.readFileSync(packageLockPath, 'utf8');
        const packageLock = JSON.parse(content);
        
        const dependencies = new Map();
        
        // Handle different package-lock.json formats (v1 vs v2+)
        if (packageLock.dependencies) {
            // v1 format
            extractFromV1Dependencies(packageLock.dependencies, dependencies);
        }
        
        if (packageLock.packages) {
            // v2+ format
            extractFromV2Packages(packageLock.packages, dependencies);
        }
        
        return {
            service: path.dirname(packageLockPath).replace(CLONED_REPOS_DIR + '/', ''),
            dependencies: Array.from(dependencies.values())
        };
        
    } catch (err) {
        console.warn(`⚠️  Warning: Could not parse ${packageLockPath}: ${err.message}`);
        return {
            service: path.dirname(packageLockPath).replace(CLONED_REPOS_DIR + '/', ''),
            dependencies: []
        };
    }
}

/**
 * Extract dependencies from v1 format (dependencies object)
 */
function extractFromV1Dependencies(deps, dependencyMap) {
    for (const [name, info] of Object.entries(deps)) {
        if (name && info.version) {
            const key = `${name}@${info.version}`;
            if (!dependencyMap.has(key)) {
                dependencyMap.set(key, {
                    name,
                    version: info.version,
                    resolved: info.resolved,
                    dev: info.dev || false
                });
            }
        }
        
        // Recursively process nested dependencies
        if (info.dependencies) {
            extractFromV1Dependencies(info.dependencies, dependencyMap);
        }
    }
}

/**
 * Extract dependencies from v2+ format (packages object)
 */
function extractFromV2Packages(packages, dependencyMap) {
    for (const [packagePath, info] of Object.entries(packages)) {
        if (packagePath === '' || packagePath === 'node_modules') continue;
        
        // Extract package name from path like "node_modules/package-name"
        const match = packagePath.match(/node_modules\/([^\/]+)(?:\/|$)/);
        if (match && info.version) {
            const name = match[1];
            const key = `${name}@${info.version}`;
            
            if (!dependencyMap.has(key)) {
                dependencyMap.set(key, {
                    name,
                    version: info.version,
                    resolved: info.resolved,
                    dev: info.dev || false
                });
            }
        }
    }
}

/**
 * Fetch license information from npm registry
 */
async function fetchLicenseInfo(name, version) {
    const https = require('https');
    const http = require('http');
    
    return new Promise((resolve) => {
        const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
        
        const client = url.startsWith('https:') ? https : http;
        
        const request = client.get(url, (response) => {
            let data = '';
            
            response.on('data', (chunk) => {
                data += chunk;
            });
            
            response.on('end', () => {
                try {
                    if (response.statusCode === 200) {
                        const packageInfo = JSON.parse(data);
                        resolve({
                            license: packageInfo.license || 'Unknown',
                            description: packageInfo.description || '',
                            homepage: packageInfo.homepage || '',
                            repository: packageInfo.repository?.url || ''
                        });
                    } else {
                        resolve({
                            license: 'Unknown',
                            description: '',
                            homepage: '',
                            repository: ''
                        });
                    }
                } catch (err) {
                    resolve({
                        license: 'Unknown',
                        description: '',
                        homepage: '',
                        repository: ''
                    });
                }
            });
        });
        
        request.on('error', () => {
            resolve({
                license: 'Unknown',
                description: '',
                homepage: '',
                repository: ''
            });
        });
        
        // Timeout after configured timeout
        request.setTimeout(REQUEST_TIMEOUT, () => {
            request.abort();
            resolve({
                license: 'Unknown',
                description: '',
                homepage: '',
                repository: ''
            });
        });
    });
}

/**
 * Merge packages by name, collecting all versions and services that use them
 */
function mergePackageVersions(allPackages, serviceData) {
    const mergedPackages = new Map();
    
    // First pass: collect all packages with their versions and services
    serviceData.forEach(service => {
        service.dependencies.forEach(dep => {
            const key = dep.name;
            
            if (!mergedPackages.has(key)) {
                mergedPackages.set(key, {
                    name: dep.name,
                    versions: new Map(),
                    services: new Set(),
                    dev: dep.dev
                });
            }
            
            const packageInfo = mergedPackages.get(key);
            packageInfo.services.add(service.service);
            
            if (!packageInfo.versions.has(dep.version)) {
                packageInfo.versions.set(dep.version, {
                    version: dep.version,
                    services: new Set(),
                    resolved: dep.resolved
                });
            }
            
            packageInfo.versions.get(dep.version).services.add(service.service);
        });
    });
    
    // Convert to array format
    return Array.from(mergedPackages.values()).map(pkg => ({
        name: pkg.name,
        versions: Array.from(pkg.versions.values()).map(v => ({
            version: v.version,
            services: Array.from(v.services),
            resolved: v.resolved
        })),
        allServices: Array.from(pkg.services),
        totalServices: pkg.services.size,
        dev: pkg.dev
    }));
}

/**
 * Process packages in batches to avoid overwhelming the npm registry
 */
async function fetchLicensesInBatches(mergedPackages) {
    const results = new Map();
    
    if (SKIP_LICENSES) {
        console.log('⚡ Skipping license fetching for faster processing...');
        mergedPackages.forEach(pkg => {
            results.set(pkg.name, {
                ...pkg,
                license: 'Skipped',
                description: '',
                homepage: '',
                repository: ''
            });
        });
        return results;
    }
    
    console.log(`📡 Fetching license information for ${mergedPackages.length} unique packages...`);
    console.log(`⚡ Using ${MAX_CONCURRENT_REQUESTS} concurrent requests with ${REQUEST_TIMEOUT}ms timeout`);
    
    for (let i = 0; i < mergedPackages.length; i += MAX_CONCURRENT_REQUESTS) {
        const batch = mergedPackages.slice(i, i + MAX_CONCURRENT_REQUESTS);
        
        process.stdout.write(`\r📦 Processing packages ${i + 1}-${Math.min(i + MAX_CONCURRENT_REQUESTS, mergedPackages.length)} of ${mergedPackages.length}...`);
        
        const promises = batch.map(async (pkg) => {
            // Get license info from the latest version
            const latestVersion = pkg.versions.sort((a, b) => b.version.localeCompare(a.version))[0];
            const licenseInfo = await fetchLicenseInfo(pkg.name, latestVersion.version);
            
            results.set(pkg.name, {
                ...pkg,
                ...licenseInfo
            });
        });
        
        await Promise.all(promises);
        
        // Reduced delay for faster processing
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
    
    console.log('\n✅ License information fetching completed!');
    return results;
}

/**
 * Generate comprehensive report
 */
function generateReport(serviceData, allPackagesWithLicenses) {
    // Sort packages by popularity (number of services using them) and then by name
    const sortedPackages = Array.from(allPackagesWithLicenses.values())
        .sort((a, b) => {
            const serviceCountDiff = b.totalServices - a.totalServices;
            return serviceCountDiff !== 0 ? serviceCountDiff : a.name.localeCompare(b.name);
        });
    
    const report = {
        metadata: {
            generatedAt: new Date().toISOString(),
            generatedBy: 'Open Source Dependency Analyzer',
            totalServices: serviceData.length,
            totalUniquePackages: allPackagesWithLicenses.size,
            totalPackageVersionCombinations: serviceData.reduce((sum, service) => sum + service.dependencies.length, 0),
            description: 'Comprehensive analysis of open source components used across Backend Node.js Services',
            summary: {
                packagesWithMultipleVersions: sortedPackages.filter(pkg => pkg.versions.length > 1).length,
                averagePackagesPerService: Math.round(serviceData.reduce((sum, service) => sum + service.dependencies.length, 0) / serviceData.length),
                mostPopularPackage: sortedPackages[0] ? {
                    name: sortedPackages[0].name,
                    usedByServices: sortedPackages[0].totalServices
                } : null
            }
        },
        services: serviceData
            .sort((a, b) => a.service.localeCompare(b.service))
            .map(service => ({
                name: service.service,
                dependencyCount: service.dependencies.length,
                dependencies: service.dependencies
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(dep => ({
                        name: dep.name,
                        version: dep.version,
                        dev: dep.dev || false
                    }))
            })),
        packages: sortedPackages.map(pkg => ({
            name: pkg.name,
            license: pkg.license || 'Unknown',
            description: pkg.description || '',
            homepage: pkg.homepage || '',
            repository: pkg.repository || '',
            versions: pkg.versions.sort((a, b) => {
                // Sort versions in descending order (latest first)
                return b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' });
            }).map(v => ({
                version: v.version,
                services: v.services.sort()
            })),
            usage: {
                totalServices: pkg.totalServices,
                servicesUsingPackage: pkg.allServices.sort(),
                hasMultipleVersions: pkg.versions.length > 1,
                versionCount: pkg.versions.length
            },
            isDevelopmentDependency: pkg.dev || false
        }))
    };
    
    return report;
}

/**
 * Generate CSV report
 */
function generateCSV(allPackagesWithLicenses) {
    const headers = ['Package Name', 'Versions', 'Total Services', 'License', 'Description', 'Homepage', 'Repository', 'Dev Dependency', 'Services Using'];
    const rows = Array.from(allPackagesWithLicenses.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(pkg => [
            pkg.name,
            pkg.versions.map(v => v.version).join('; '),
            pkg.totalServices,
            pkg.license,
            `"${(pkg.description || '').replace(/"/g, '""')}"`,
            pkg.homepage || '',
            pkg.repository || '',
            pkg.dev ? 'Yes' : 'No',
            `"${pkg.allServices.join(', ')}"`.replace(/"/g, '""')
        ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
}

/**
 * Generate human-readable text summary
 */
function generateTextSummary(report) {
    const lines = [
        '='.repeat(80),
        'OPEN SOURCE COMPONENTS DEPENDENCY ANALYSIS',
        '='.repeat(80),
        '',
        `Generated: ${new Date(report.metadata.generatedAt).toLocaleString()}`,
        `Services Analyzed: ${report.metadata.totalServices}`,
        `Unique Packages: ${report.metadata.totalUniquePackages}`,
        `Total Package-Version Combinations: ${report.metadata.totalPackageVersionCombinations}`,
        `Average Packages per Service: ${report.metadata.summary.averagePackagesPerService}`,
        `Packages with Multiple Versions: ${report.metadata.summary.packagesWithMultipleVersions}`,
        '',
        '='.repeat(80),
        'TOP 20 MOST USED PACKAGES',
        '='.repeat(80),
        ''
    ];
    
    // Top packages by usage
    report.packages.slice(0, 20).forEach((pkg, index) => {
        lines.push(`${(index + 1).toString().padStart(3)}. ${pkg.name}`);
        lines.push(`     License: ${pkg.license}`);
        lines.push(`     Used by ${pkg.usage.totalServices} service(s)`);
        if (pkg.usage.hasMultipleVersions) {
            lines.push(`     ⚠️  Multiple versions: ${pkg.versions.map(v => v.version).join(', ')}`);
        } else {
            lines.push(`     Version: ${pkg.versions[0].version}`);
        }
        lines.push(`     Services: ${pkg.usage.servicesUsingPackage.slice(0, 5).join(', ')}${pkg.usage.servicesUsingPackage.length > 5 ? ` (+${pkg.usage.servicesUsingPackage.length - 5} more)` : ''}`);
        lines.push('');
    });
    
    lines.push('='.repeat(80));
    lines.push('PACKAGES WITH MOST VERSION CONFLICTS');
    lines.push('='.repeat(80));
    lines.push('');
    
    // Packages with most versions
    const multiVersionPackages = report.packages
        .filter(pkg => pkg.usage.hasMultipleVersions)
        .sort((a, b) => b.usage.versionCount - a.usage.versionCount)
        .slice(0, 15);
    
    multiVersionPackages.forEach((pkg, index) => {
        lines.push(`${(index + 1).toString().padStart(3)}. ${pkg.name} (${pkg.usage.versionCount} versions)`);
        pkg.versions.forEach(v => {
            lines.push(`     ${v.version} → ${v.services.join(', ')}`);
        });
        lines.push('');
    });
    
    lines.push('='.repeat(80));
    lines.push('LICENSE BREAKDOWN');
    lines.push('='.repeat(80));
    lines.push('');
    
    // License counts
    const licenseCounts = new Map();
    report.packages.forEach(pkg => {
        const license = pkg.license || 'Unknown';
        licenseCounts.set(license, (licenseCounts.get(license) || 0) + 1);
    });
    
    Array.from(licenseCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([license, count]) => {
            const licenseString = String(license || 'Unknown');
            lines.push(`${licenseString.padEnd(20)} ${count} packages`);
        });
    
    lines.push('');
    lines.push('='.repeat(80));
    lines.push('SERVICES OVERVIEW');
    lines.push('='.repeat(80));
    lines.push('');
    
    report.services.forEach(service => {
        lines.push(`${service.name} (${service.dependencyCount} dependencies)`);
    });
    
    lines.push('');
    lines.push('End of Report');
    lines.push('='.repeat(80));
    
    return lines.join('\n');
}

/**
 * Main execution function
 */
async function main() {
    try {
        // Check if cloned-repos directory exists
        if (!fs.existsSync(CLONED_REPOS_DIR)) {
            console.error(`❌ Error: Directory ${CLONED_REPOS_DIR} does not exist`);
            process.exit(1);
        }
        
        // Find all package-lock.json files
        console.log('🔍 Scanning for package-lock.json files...');
        const packageLockFiles = findPackageLockFiles(CLONED_REPOS_DIR);
        console.log(`📄 Found ${packageLockFiles.length} package-lock.json files`);
        
        if (packageLockFiles.length === 0) {
            console.log('ℹ️  No package-lock.json files found. Exiting.');
            return;
        }
        
        // Parse all package-lock.json files
        console.log('\n📋 Parsing dependencies from all services...');
        const serviceData = [];
        const allPackages = new Map();
        
        for (const filePath of packageLockFiles) {
            console.log(`  📄 Processing: ${filePath.replace(CLONED_REPOS_DIR + '/', '')}`);
            const result = parseDependencies(filePath);
            serviceData.push(result);
            
            // Collect all unique packages
            result.dependencies.forEach(dep => {
                const key = `${dep.name}@${dep.version}`;
                if (!allPackages.has(key)) {
                    allPackages.set(key, dep);
                }
            });
        }
        
        console.log(`\n📊 Found ${allPackages.size} unique package@version combinations`);
        
        // Merge packages by name, collecting all versions
        console.log('🔗 Merging package versions...');
        const mergedPackages = mergePackageVersions(allPackages, serviceData);
        console.log(`📦 Consolidated to ${mergedPackages.length} unique packages`);
        
        // Fetch license information
        const allPackagesWithLicenses = await fetchLicensesInBatches(mergedPackages);
        
        // Generate reports
        console.log('\n📄 Generating reports...');
        const report = generateReport(serviceData, allPackagesWithLicenses);
        const csvContent = generateCSV(allPackagesWithLicenses);
        
        // Write JSON report with pretty formatting
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 4));
        console.log(`✅ JSON report saved to: ${OUTPUT_FILE}`);
        
        // Also create a human-readable summary file
        const summaryFile = 'dependency-summary.txt';
        const summaryContent = generateTextSummary(report);
        fs.writeFileSync(summaryFile, summaryContent);
        console.log(`✅ Human-readable summary saved to: ${summaryFile}`);
        
        // Write CSV report
        fs.writeFileSync(OUTPUT_CSV, csvContent);
        console.log(`✅ CSV report saved to: ${OUTPUT_CSV}`);
        
        // Print summary
        console.log('\n📊 Summary:');
        console.log(`   Services analyzed: ${serviceData.length}`);
        console.log(`   Unique packages: ${allPackagesWithLicenses.size}`);
        
        // License breakdown
        const licenseCounts = new Map();
        allPackagesWithLicenses.forEach(pkg => {
            const license = pkg.license || 'Unknown';
            licenseCounts.set(license, (licenseCounts.get(license) || 0) + 1);
        });
        
        console.log('\n📋 License Distribution:');
        Array.from(licenseCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .forEach(([license, count]) => {
                console.log(`   ${license}: ${count} packages`);
            });
        
        // Show packages with multiple versions
        const multiVersionPackages = Array.from(allPackagesWithLicenses.values())
            .filter(pkg => pkg.versions.length > 1)
            .sort((a, b) => b.versions.length - a.versions.length);
        
        if (multiVersionPackages.length > 0) {
            console.log(`\n⚠️  Packages with Multiple Versions (${multiVersionPackages.length} packages):`);
            multiVersionPackages.slice(0, 10).forEach(pkg => {
                console.log(`   ${pkg.name}: ${pkg.versions.map(v => v.version).join(', ')}`);
            });
            if (multiVersionPackages.length > 10) {
                console.log(`   ... and ${multiVersionPackages.length - 10} more`);
            }
        }
        
        console.log('\n🎉 Analysis completed successfully!');
        
    } catch (error) {
        console.error('❌ Error during analysis:', error);
        process.exit(1);
    }
}

// Run the analysis
main().catch(console.error);
