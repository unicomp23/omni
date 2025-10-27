// Shared library for downloading SumoLogic chunks
const https = require('https');
const fs = require('fs');

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

async function downloadChunk(startDate, endDate, chunkIndex, totalChunks, options) {
    const { query, outputDir, filePrefix, skipExisting = true } = options;
    const chunkLabel = formatDateForFilename(startDate);
    const jsonFile = `${outputDir}/${filePrefix}${chunkLabel}.json`;

    // Check if file already exists
    if (skipExisting && fs.existsSync(jsonFile)) {
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        const messageCount = data.messages ? data.messages.length : 0;
        console.log(`\n⏭️  Chunk ${chunkIndex + 1}/${totalChunks}: ${chunkLabel} - Already exists, skipping`);
        return { success: true, messages: messageCount, chunkLabel, file: jsonFile, skipped: true };
    }

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

        const requestOptions = {
            hostname: config.apiUrl,
            port: 443,
            path: '/api/v1/search/jobs',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${config.sumoAccessId}:${config.sumoAccessKey}`).toString('base64')
            }
        };

        const response = await makeRequest(requestOptions, searchData);

        if (response.statusCode !== 200 && response.statusCode !== 202) {
            console.log(`   ❌ Failed to start: ${response.statusCode}`);
            return { success: false, messages: 0, chunkLabel };
        }

        const jobId = response.data.id;
        console.log(`   ✅ Job: ${jobId}`);

        // Poll for completion
        let attempts = 0;
        const maxAttempts = 60;

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
                        const limit = Math.min(totalMessages, 50000);
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

                                // Save JSON file
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
                                        downloadTime: new Date().toISOString()
                                    },
                                    messages: messages
                                };

                                fs.writeFileSync(jsonFile, JSON.stringify(outputData, null, 2));
                                const fileSize = (fs.statSync(jsonFile).size / 1024 / 1024).toFixed(1);

                                console.log(`   💾 Saved: ${jsonFile} (${fileSize} MB)`);

                                // Cancel job
                                await cancelJob(jobId);

                                return { success: true, messages: messages.length, chunkLabel, file: jsonFile };
                            }
                        }
                    } else {
                        console.log(`   ⚠️  No messages found`);
                    }

                    await cancelJob(jobId);
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

async function cancelJob(jobId) {
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
}

function generateChunks(startDate, endDate, chunkMinutes) {
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

    return chunks;
}

async function downloadAllChunks(config) {
    const {
        description,
        query,
        startDate,
        endDate,
        chunkMinutes,
        outputDir,
        filePrefix,
        summaryFile,
        forceRedownload = false
    } = config;

    const skipExisting = !forceRedownload;

    console.log('🚀 ' + description);
    console.log('📅 Date range: ' + startDate.toISOString() + ' - ' + endDate.toISOString());
    console.log('🔍 Query: ' + query);
    if (skipExisting) {
        console.log('⏭️  Mode: Skip existing chunks (use --force to re-download all)');
    } else {
        console.log('🔄 Mode: Force re-download all chunks');
    }
    console.log();

    const chunks = generateChunks(startDate, endDate, chunkMinutes);

    console.log(`📊 Total chunks to process: ${chunks.length} (${chunkMinutes}-minute intervals)`);
    console.log(`⏱️  Estimated time: ${Math.ceil(chunks.length * 0.5)} minutes\n`);

    const results = [];
    let totalMessages = 0;
    let successfulChunks = 0;
    let skippedChunks = 0;

    // Process chunks
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const result = await downloadChunk(chunk.start, chunk.end, i, chunks.length, {
            query,
            outputDir,
            filePrefix,
            skipExisting
        });

        results.push(result);
        totalMessages += result.messages;

        if (result.success && result.messages > 0) {
            successfulChunks++;
        }

        if (result.skipped) {
            skippedChunks++;
        }

        // Small delay between chunks
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
    console.log(`⏭️  Skipped (already exist): ${skippedChunks}`);
    console.log(`📥 New chunks downloaded: ${successfulChunks - skippedChunks}`);
    console.log(`📄 Total messages: ${totalMessages.toLocaleString()}`);

    // List generated files
    const files = fs.readdirSync(outputDir).filter(f => f.startsWith(filePrefix) && f.endsWith('.json'));
    const totalSize = files.reduce((sum, f) => sum + fs.statSync(`${outputDir}/${f}`).size, 0);

    console.log(`📁 Files in directory: ${files.length}`);
    console.log(`💾 Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

    // Create summary file
    const summary = {
        metadata: {
            dateRange: {
                requested: { from: startDate.toISOString(), to: endDate.toISOString() },
                chunkSize: `${chunkMinutes} minutes`,
                totalChunks: chunks.length
            },
            results: {
                successfulChunks,
                skippedChunks,
                newChunks: successfulChunks - skippedChunks,
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

    console.log(`✅ Download complete!`);
}

module.exports = {
    downloadAllChunks
};
