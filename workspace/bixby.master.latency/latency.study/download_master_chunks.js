#!/usr/bin/env node

const { downloadAllChunks } = require('./download_lib');

// Parse command line arguments
const args = process.argv.slice(2);
const forceRedownload = args.includes('--force');

downloadAllChunks({
    description: 'Downloading Master/Tecate PRODUCTION latency data in 30-minute chunks',
    query: '"RegisterStream RECEIVED" AND receiveTimeMs AND _collector=*-prod-*',
    startDate: new Date('2025-09-07T00:00:00Z'),
    endDate: new Date('2025-10-24T23:59:59Z'),
    chunkMinutes: 30,
    outputDir: 'master_logs',
    filePrefix: 'master_chunk_',
    summaryFile: 'master_logs/download_master_summary.json',
    forceRedownload
}).catch(console.error);
