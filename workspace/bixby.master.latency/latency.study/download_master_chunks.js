#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const config = {
    sumoAccessId: process.env.SUMO_ACCESS_ID,
    sumoAccessKey: process.env.SUMO_ACCESS_KEY,
    apiUrl: 'api.sumologic.com'
};

if (!config.sumoAccessId || !config.sumoAccessKey) {
    console.error('Error: SUMO_ACCESS_ID and SUMO_ACCESS_KEY environment variables must be set');
    process.exit(1);
}

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const jsonResponse = JSON.parse(body);
                    resolve({ statusCode: res.statusCode, headers: res.headers, data: jsonResponse });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, headers: res.headers, data: body });
                }
            });
        });
        req.on('error', (err) => reject(err));
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

function formatDateForFilename(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}${month}${day}_${hour}${minute}`;
}

async function downloadChunk(startDate, endDate, chunkIndex, totalChunks) {
    // Query for Master/Tecate logs with receiveTimeMs
    const query = '"RegisterStream RECEIVED" AND receiveTimeMs';
    const chunkLabel = formatDateForFilename(startDate);

    console.log(`\n📦 Chunk ${chunkIndex + 1}/${totalChunks}: ${chunkLabel}`);
    console.log(`   From: ${startDate.toISOString()}`);
    console.log(`   To:   ${endDate.toISOString()}`);

    try {
        const searchData = {
            query: query,
            from: startDate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            to: endDate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            timeZone: 'UTC'
        };

        const options = {
            hostname: config.apiUrl,
            port: 443,
            path: '/api/v1/search/jobs',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${config.sumoAccessId}:${config.sumoAccessKey}`).toString('base64')
            }
        };

        const response = await makeRequest(options, searchData);

        if (response.statusCode !== 200 && response.statusCode !== 202) {
            console.log(`   ❌ Failed to start: ${response.statusCode}`);
            return { success: false, messages: 0, chunkLabel };
        }

        const jobId = response.data.id;
        console.log(`   ✅ Job: ${jobId}`);

        // Poll for completion
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max per chunk

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000));

            const statusOptions = {
                hostname: config.apiUrl,
                port: 443,
                path: `/api/v1/search/jobs/${jobId}`,
                method: 'GET',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${config.sumoAccessId}:${config.sumoAccessKey}`).toString('base64')
                }
            };

            const statusResponse = await makeRequest(statusOptions);

            if (statusResponse.statusCode === 200) {
                const status = statusResponse.data;

                if (status.state === 'DONE GATHERING RESULTS') {
                    const totalMessages = status.messageCount || 0;
                    console.log(`   📊 Found: ${totalMessages} messages`);

                    if (totalMessages > 0) {
                        // Download messages
                        const limit = Math.min(totalMessages, 50000); // Cap at 50K per chunk
                        const resultsOptions = {
                            hostname: config.apiUrl,
                            port: 443,
                            path: `/api/v1/search/jobs/${jobId}/messages?offset=0&limit=${limit}`,
                            method: 'GET',
                            headers: {
                                'Authorization': 'Basic ' + Buffer.from(`${config.sumoAccessId}:${config.sumoAccessKey}`).toString('base64')
                            }
                        };

                        const resultsResponse = await makeRequest(resultsOptions);

                        if (resultsResponse.statusCode === 200) {
                            const messages = resultsResponse.data.messages || [];
                            console.log(`   📥 Retrieved: ${messages.length} messages`);

                            if (messages.length > 0) {
                                // Analyze timestamps
                                const timestamps = messages
                                    .map(m => parseInt(m.map._messagetime))
                                    .filter(t => !isNaN(t))
                                    .sort((a, b) => a - b);

                                const actualStart = timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : 'N/A';
                                const actualEnd = timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : 'N/A';

                                // Extract receiveTimeMs and latencyId for quick stats
                                const receiveTimeValues = [];
                                let latencyIdCount = 0;
                                for (const msg of messages) {
                                    const rawLog = msg.map._raw || '';
                                    const receiveTimeMatch = rawLog.match(/receiveTimeMs=(\d+)/);
                                    if (receiveTimeMatch) {
                                        receiveTimeValues.push(parseInt(receiveTimeMatch[1]));
                                    }
                                    if (rawLog.includes('latencyId=')) {
                                        latencyIdCount++;
                                    }
                                }

                                let stats = null;
                                if (receiveTimeValues.length > 0) {
                                    stats = {
                                        count: receiveTimeValues.length,
                                        withLatencyId: latencyIdCount,
                                        receiveTimeRange: {
                                            min: new Date(Math.min(...receiveTimeValues)).toISOString(),
                                            max: new Date(Math.max(...receiveTimeValues)).toISOString()
                                        }
                                    };
                                }

                                // Save JSON file with master_chunk_ prefix
                                const jsonFile = `master_logs/master_chunk_${chunkLabel}.json`;
                                const outputData = {
                                    metadata: {
                                        chunkIndex: chunkIndex + 1,
                                        totalChunks: totalChunks,
                                        requestedRange: {
                                            from: startDate.toISOString(),
                                            to: endDate.toISOString()
                                        },
                                        actualRange: {
                                            from: actualStart,
                                            to: actualEnd
                                        },
                                        query: query,
                                        totalMessages: messages.length,
                                        stats: stats,
                                        downloadTime: new Date().toISOString()
                                    },
                                    messages: messages
                                };

                                fs.writeFileSync(jsonFile, JSON.stringify(outputData, null, 2));
                                const fileSize = (fs.statSync(jsonFile).size / 1024 / 1024).toFixed(1);

                                console.log(`   💾 Saved: ${jsonFile} (${fileSize} MB)`);
                                if (stats) {
                                    console.log(`   📊 Stats: ${stats.count} receiveTimeMs values, ${stats.withLatencyId} with latencyId`);
                                }

                                // Cancel job
                                const cancelOptions = {
                                    hostname: config.apiUrl,
                                    port: 443,
                                    path: `/api/v1/search/jobs/${jobId}`,
                                    method: 'DELETE',
                                    headers: {
                                        'Authorization': 'Basic ' + Buffer.from(`${config.sumoAccessId}:${config.sumoAccessKey}`).toString('base64')
                                    }
                                };
                                await makeRequest(cancelOptions);

                                return { success: true, messages: messages.length, chunkLabel, file: jsonFile };
                            }
                        } else {
                            console.log(`   ❌ Failed to retrieve: ${resultsResponse.statusCode}`);
                        }
                    } else {
                        console.log(`   ⚠️  No messages found`);
                    }

                    // Cancel job
                    const cancelOptions = {
                        hostname: config.apiUrl,
                        port: 443,
                        path: `/api/v1/search/jobs/${jobId}`,
                        method: 'DELETE',
                        headers: {
                            'Authorization': 'Basic ' + Buffer.from(`${config.sumoAccessId}:${config.sumoAccessKey}`).toString('base64')
                        }
                    };
                    await makeRequest(cancelOptions);

                    return { success: true, messages: 0, chunkLabel };
                } else if (status.state === 'CANCELLED' || status.state?.includes('ERROR')) {
                    console.log(`   ❌ Job failed: ${status.state}`);
                    return { success: false, messages: 0, chunkLabel };
                }
            }
            attempts++;
        }

        console.log(`   ⏱️  Timeout after 5 minutes`);
        return { success: false, messages: 0, chunkLabel };

    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return { success: false, messages: 0, chunkLabel };
    }
}

async function downloadAllChunks() {
    console.log('🚀 Downloading Master/Tecate latency data in 15-minute chunks');
    console.log('🔍 Query: "RegisterStream RECEIVED" AND receiveTimeMs\n');

    // Define date range - FULL 20-DAY RANGE
    const startDate = new Date('2025-09-07T00:00:00Z');
    const endDate = new Date('2025-09-27T23:59:59Z');
    const chunkMinutes = 15;

    console.log('📅 FULL DOWNLOAD MODE: September 7-27, 2025 (20 days)\n');

    // Calculate all 15-minute chunks
    const chunks = [];
    let currentStart = new Date(startDate);

    while (currentStart < endDate) {
        const currentEnd = new Date(currentStart.getTime() + (chunkMinutes * 60 * 1000));
        if (currentEnd > endDate) {
            currentEnd.setTime(endDate.getTime());
        }

        chunks.push({
            start: new Date(currentStart),
            end: new Date(currentEnd)
        });

        currentStart = new Date(currentEnd);
    }

    console.log(`📊 Total chunks to process: ${chunks.length} (15-minute intervals)`);
    console.log(`⏱️  Estimated time: ${Math.ceil(chunks.length * 0.5)} minutes\n`);

    const results = [];
    let totalMessages = 0;
    let successfulChunks = 0;

    // Process chunks
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const result = await downloadChunk(chunk.start, chunk.end, i, chunks.length);

        results.push(result);
        totalMessages += result.messages;

        if (result.success && result.messages > 0) {
            successfulChunks++;
        }

        // Small delay between chunks to be nice to API
        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 DOWNLOAD SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📦 Total chunks processed: ${chunks.length}`);
    console.log(`✅ Successful chunks: ${successfulChunks}`);
    console.log(`📄 Total messages downloaded: ${totalMessages.toLocaleString()}`);

    // List generated files
    const files = fs.readdirSync('master_logs').filter(f => f.startsWith('master_chunk_') && f.endsWith('.json'));
    const totalSize = files.reduce((sum, f) => sum + fs.statSync(path.join('master_logs', f)).size, 0);

    console.log(`📁 Files generated: ${files.length}`);
    console.log(`💾 Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

    if (files.length > 0) {
        console.log(`📂 Location: ${process.cwd()}`);
    }

    // Create summary file
    const summaryFile = 'master_logs/download_master_summary.json';
    const summary = {
        metadata: {
            dateRange: {
                requested: { from: startDate.toISOString(), to: endDate.toISOString() },
                chunkSize: `${chunkMinutes} minutes`,
                totalChunks: chunks.length
            },
            results: {
                successfulChunks,
                totalMessages,
                filesGenerated: files.length,
                totalSizeMB: Math.round(totalSize / 1024 / 1024 * 10) / 10
            },
            downloadTime: new Date().toISOString()
        },
        chunks: results
    };

    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log(`📋 Summary saved: ${summaryFile}\n`);

    console.log(`✅ Chunk download complete!`);

    if (totalMessages > 0) {
        console.log('\n🎉 SUCCESS! Master logs found.');
        console.log('💡 Next steps:');
        console.log('   1. Review master_chunk_*.json files to verify data');
        console.log('   2. Update line 249 to full date range: 2025-09-27T23:59:59Z');
        console.log('   3. Run script again to download full dataset\n');
    } else {
        console.log('\n⚠️  WARNING: No Master logs found.');
        console.log('💡 Try these alternative queries (line 48):');
        console.log('   Option 1: \'_view="media_master" AND latencyId AND receiveTimeMs\'');
        console.log('   Option 2: \'"RegisterStream RECEIVED" AND receiveTimeMs\'');
        console.log('   Option 3: \'_sourcecategory=*master* AND latencyId\'\n');
    }
}

downloadAllChunks().catch(console.error);
