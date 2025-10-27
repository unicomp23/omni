#!/usr/bin/env node

const { downloadAllChunks } = require('./download_lib');

// Parse command line arguments
const args = process.argv.slice(2);
const forceRedownload = args.includes('--force');

downloadAllChunks({
    description: 'Downloading Bixby PRODUCTION latency data in 30-minute chunks',
    query: '_view="media_bixby" AND env=prod AND latencyMs',
    startDate: new Date('2025-09-07T00:00:00Z'),
    endDate: new Date('2025-10-24T23:59:59Z'),
    chunkMinutes: 30,
    outputDir: 'bixby_logs',
    filePrefix: 'chunk_',
    summaryFile: 'bixby_logs/download_summary.json',
    forceRedownload
}).catch(console.error);
