#!/usr/bin/env node

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

async function runQuery(query, startTime, endTime) {
    console.log(`\n🔍 Running query: ${query}`);
    console.log(`   Time range: ${startTime} to ${endTime}`);

    const searchData = {
        query: query,
        from: startTime,
        to: endTime,
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
        return null;
    }

    const jobId = response.data.id;
    console.log(`   ✅ Job: ${jobId}`);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 3000));

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
                    const limit = Math.min(totalMessages, 100);
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

                    if (resultsResponse.statusCode === 200) {
                        return resultsResponse.data.messages || [];
                    }
                }

                return [];
            } else if (status.state === 'CANCELLED' || status.state?.includes('ERROR')) {
                console.log(`   ❌ Job failed: ${status.state}`);
                return null;
            }
        }
        attempts++;
    }

    console.log(`   ⏱️  Timeout`);
    return null;
}

function analyzeMessages(messages, label) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${label.toUpperCase()} - ANALYSIS`);
    console.log(`${'='.repeat(80)}`);

    if (!messages || messages.length === 0) {
        console.log('❌ No messages found');
        return;
    }

    const indexes = new Set();
    const sourceCategories = new Set();
    const collectors = new Set();
    const envs = new Set();
    const hosts = new Set();

    messages.forEach(msg => {
        const map = msg.map || {};

        if (map._index) indexes.add(map._index);
        if (map._sourcecategory) sourceCategories.add(map._sourcecategory);
        if (map._collector) collectors.add(map._collector);
        if (map.env) envs.add(map.env);
        if (map._sourcehost) hosts.add(map._sourcehost);
    });

    console.log(`\n📦 Found ${messages.length} messages`);
    console.log(`\n📑 INDEXES:`);
    indexes.forEach(idx => console.log(`   - ${idx}`));

    console.log(`\n🌍 ENVIRONMENTS:`);
    envs.forEach(env => console.log(`   - env=${env}`));

    console.log(`\n📂 SOURCE CATEGORIES:`);
    sourceCategories.forEach(sc => console.log(`   - ${sc}`));

    console.log(`\n🖥️  COLLECTORS (sample):`);
    Array.from(collectors).slice(0, 5).forEach(c => console.log(`   - ${c}`));

    console.log(`\n🏠 HOSTS (sample):`);
    Array.from(hosts).slice(0, 5).forEach(h => console.log(`   - ${h}`));

    // Sample raw log
    if (messages[0]) {
        console.log(`\n📝 SAMPLE RAW LOG:`);
        const raw = messages[0].map._raw || '';
        console.log(raw.substring(0, 500));
        if (raw.length > 500) console.log('...');
    }

    return {
        indexes: Array.from(indexes),
        sourceCategories: Array.from(sourceCategories),
        envs: Array.from(envs),
        collectors: Array.from(collectors),
        hosts: Array.from(hosts)
    };
}

async function findIndexes() {
    console.log('=' .repeat(80));
    console.log('PRODUCTION INDEX FINDER');
    console.log('=' .repeat(80));
    console.log('\nStrategy: Query for logs with latencyId in a 30-min window');
    console.log('This will show us what indexes contain production data\n');

    // Use the latest 30 minutes from now
    const endTime = new Date(); // Current time
    const startTime = new Date(endTime.getTime() - 30 * 60 * 1000); // 30 minutes ago

    console.log(`\n📅 Time Window: ${startTime.toISOString()} to ${endTime.toISOString()}`);

    // Format timestamps without milliseconds
    const formatTime = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

    // Query 1: Find Bixby logs with latencyId and env=prod using _view
    const bixbyQuery = '_view=media_bixby env=prod latencyMs';
    const bixbyMessages = await runQuery(bixbyQuery, formatTime(startTime), formatTime(endTime));
    const bixbyInfo = analyzeMessages(bixbyMessages, 'Bixby (Client)');

    // Query 2: Find Master logs with latencyId and receiveTimeMs
    const masterQuery = '"RegisterStream RECEIVED" receiveTimeMs';
    const masterMessages = await runQuery(masterQuery, formatTime(startTime), formatTime(endTime));
    const masterInfo = analyzeMessages(masterMessages, 'Master (Server)');

    // Generate recommendations
    console.log(`\n${'='.repeat(80)}`);
    console.log('RECOMMENDED QUERIES');
    console.log(`${'='.repeat(80)}`);

    if (bixbyInfo && bixbyInfo.indexes.length > 0) {
        console.log('\n🔵 BIXBY PRODUCTION QUERY:');
        const bixbyIndex = bixbyInfo.indexes[0];
        const bixbyEnv = bixbyInfo.envs.includes('prod') ? ' AND env=prod' : '';
        console.log(`   _index=${bixbyIndex}${bixbyEnv} AND latencyMs`);
        console.log(`   OR`);
        console.log(`   _view="${bixbyIndex}"${bixbyEnv} AND latencyMs`);
    }

    if (masterInfo && masterInfo.indexes.length > 0) {
        console.log('\n🔴 MASTER PRODUCTION QUERY:');
        const masterIndex = masterInfo.indexes[0];
        const masterEnv = masterInfo.envs.includes('prod') ? ' AND env=prod' : '';
        console.log(`   _index=${masterIndex}${masterEnv} AND receiveTimeMs AND "RegisterStream RECEIVED"`);
        console.log(`   OR`);
        console.log(`   _view="${masterIndex}"${masterEnv} AND receiveTimeMs AND "RegisterStream RECEIVED"`);
    }

    // Save results
    const results = {
        timeWindow: {
            start: startTime.toISOString(),
            end: endTime.toISOString()
        },
        bixby: bixbyInfo,
        master: masterInfo,
        timestamp: new Date().toISOString()
    };

    fs.writeFileSync('prod_index_analysis.json', JSON.stringify(results, null, 2));
    console.log(`\n💾 Full analysis saved to: prod_index_analysis.json`);
    console.log(`\n${'='.repeat(80)}`);
}

findIndexes().catch(console.error);
