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
    const query = '_view="media_bixby" AND latencyMs';
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

                                // Extract latencies for quick stats
                                const latencyValues = [];
                                for (const msg of messages) {
                                    const rawLog = msg.map._raw || '';
                                    const latencyMatch = rawLog.match(/latencyMs=(\d+)/);
                                    if (latencyMatch) {
                                        latencyValues.push(parseInt(latencyMatch[1]));
                                    }
                                }

                                let stats = null;
                                if (latencyValues.length > 0) {
                                    latencyValues.sort((a, b) => a - b);
                                    stats = {
                                        count: latencyValues.length,
                                        min: latencyValues[0],
                                        max: latencyValues[latencyValues.length - 1],
                                        median: latencyValues[Math.floor(latencyValues.length / 2)],
                                        mean: Math.round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length)
                                    };
                                }

                                // Save JSON file
                                const jsonFile = `chunk_${chunkLabel}.json`;
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
                                        latencyStats: stats,
                                        downloadTime: new Date().toISOString()
                                    },
                                    messages: messages
                                };

                                fs.writeFileSync(jsonFile, JSON.stringify(outputData, null, 2));
                                const fileSize = (fs.statSync(jsonFile).size / 1024 / 1024).toFixed(1);

                                console.log(`   💾 Saved: ${jsonFile} (${fileSize} MB)`);
                                if (stats) {
                                    console.log(`   📊 Latencies: ${stats.count} values, ${stats.min}-${stats.max}ms, median ${stats.median}ms`);
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
    console.log('🚀 Downloading latency data in 15-minute chunks');
    console.log('📅 Date range: September 7, 2025 - September 27, 2025');
    console.log('🔍 Query: _view="media_bixby" AND latencyMs\n');

    // Define date range
    const startDate = new Date('2025-09-07T00:00:00Z');
    const endDate = new Date('2025-09-27T23:59:59Z');
    const chunkMinutes = 15;

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
    const files = fs.readdirSync('.').filter(f => f.startsWith('chunk_') && f.endsWith('.json'));
    const totalSize = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);

    console.log(`📁 Files generated: ${files.length}`);
    console.log(`💾 Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

    if (files.length > 0) {
        console.log(`📂 Location: ${process.cwd()}`);
    }

    // Create summary file
    const summaryFile = 'download_summary.json';
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
}

downloadAllChunks().catch(console.error);