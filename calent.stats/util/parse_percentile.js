const fs = require('fs');
const readline = require('readline');
const path = require('path');

// Simple argument parsing
const args = process.argv.slice(2);
const quiet = args.includes('-q') || args.includes('--quiet');
const dirPath = args.find(arg => !arg.startsWith('-'));

// Add new function to process directory
async function processDirectory(dirPath) {
    const files = fs.readdirSync(dirPath);
    const logFiles = files.filter(file => file.endsWith('.log'));
    
    if (logFiles.length === 0) {
        console.log('No log files found in directory');
        return;
    }

    // Initialize merged report
    const mergedReport = {
        totalSamples: 0,
        min: Infinity,
        max: -Infinity,
        percentiles: {},
        processedAt: new Date().toISOString(),
        files: [],
        combinedHistogram: new Map()
    };

    // First pass: collect all statistics
    for (const logFile of logFiles) {
        const filePath = path.join(dirPath, logFile);
        await collectStats(filePath, mergedReport);
    }

    // Calculate overall percentiles
    calculatePercentiles(mergedReport);

    // Output results
    console.log('\nOverall Summary:');
    console.log(`Files processed: ${mergedReport.files.length}`);
    console.log(`Total samples: ${mergedReport.totalSamples}`);
    console.log(`Min: ${mergedReport.min}ms`);
    console.log(`Max: ${mergedReport.max}ms\n`);

    Object.values(mergedReport.percentiles).forEach(p => {
        console.log(`${p.percentile}th percentile: ${p.latency}ms`);
    });

    // Save merged report
    const reportPath = `merged_latency_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    
    // Remove Map before saving (it's not JSON serializable)
    const reportToSave = {...mergedReport};
    delete reportToSave.combinedHistogram;
    
    fs.writeFileSync(reportPath, JSON.stringify(reportToSave, null, 2));
}

async function collectStats(filename, mergedReport) {
    const fileStream = fs.createReadStream(filename);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    mergedReport.files.push(path.basename(filename));

    // Skip first line and collect durations
    let isFirstLine = true;
    for await (const line of rl) {
        if (isFirstLine) {
            isFirstLine = false;
            continue;
        }
        
        if (!line.trim()) continue;

        const duration = parseInt(line.split(',')[7]);
        mergedReport.combinedHistogram.set(
            duration, 
            (mergedReport.combinedHistogram.get(duration) || 0) + 1
        );
        mergedReport.totalSamples++;
        mergedReport.min = Math.min(mergedReport.min, duration);
        mergedReport.max = Math.max(mergedReport.max, duration);
    }
}

function calculatePercentiles(report) {
    const percentiles = [50, 75, 90, 95, 99, 99.9, 99.99];
    let currentCount = 0;

    // Sort durations and calculate each percentile
    const sortedDurations = Array.from(report.combinedHistogram.entries())
        .sort(([a], [b]) => a - b);

    for (const [duration, count] of sortedDurations) {
        currentCount += count;
        
        for (const percentile of percentiles) {
            const percentileThreshold = (percentile / 100) * report.totalSamples;
            if (currentCount >= percentileThreshold && !report.percentiles[`p${percentile}`]) {
                report.percentiles[`p${percentile}`] = {
                    percentile: percentile,
                    latency: duration,
                    unit: 'ms'
                };
            }
        }
    }
}

// Update main execution code
if (!dirPath) {
    console.error('Please provide a directory path as argument');
    process.exit(1);
}

if (!fs.existsSync(dirPath)) {
    console.error('Directory does not exist');
    process.exit(1);
}

if (!fs.statSync(dirPath).isDirectory()) {
    console.error('Path provided is not a directory');
    process.exit(1);
}

processDirectory(dirPath)
    .catch(console.error);
