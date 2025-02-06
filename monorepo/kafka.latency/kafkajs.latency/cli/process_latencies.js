const fs = require('fs');
const readline = require('readline');
const path = require('path');

class LatencyStats {
    constructor() {
        this.count = 0;
        this.min = Infinity;
        this.max = -Infinity;
        this.sum = 0;
        this.histogram = new Array(100).fill(0);
        this.histogramMin = Infinity;
        this.histogramMax = -Infinity;
    }

    addValue(latency) {
        this.count++;
        this.min = Math.min(this.min, latency);
        this.max = Math.max(this.max, latency);
        this.sum += latency;
        
        this.histogramMin = Math.min(this.histogramMin, latency);
        this.histogramMax = Math.max(this.histogramMax, latency);
        const bucket = this.getBucket(latency);
        this.histogram[bucket]++;
    }

    getBucket(latency) {
        if (this.histogramMax === this.histogramMin) return 0;
        const bucket = Math.floor((latency - this.histogramMin) / (this.histogramMax - this.histogramMin) * 99);
        return Math.min(Math.max(bucket, 0), 99);
    }

    getPercentile(p) {
        const targetCount = (p / 100) * this.count;
        let cumCount = 0;
        
        for (let i = 0; i < this.histogram.length; i++) {
            cumCount += this.histogram[i];
            if (cumCount >= targetCount) {
                const bucketStart = this.histogramMin + (i / 99) * (this.histogramMax - this.histogramMin);
                const bucketEnd = this.histogramMin + ((i + 1) / 99) * (this.histogramMax - this.histogramMin);
                return (bucketStart + bucketEnd) / 2;
            }
        }
        return this.max;
    }

    getStats() {
        return {
            p50: this.getPercentile(50),
            p75: this.getPercentile(75),
            p90: this.getPercentile(90),
            p95: this.getPercentile(95),
            p99: this.getPercentile(99),
            p99_9: this.getPercentile(99.9),
            p99_99: this.getPercentile(99.99),
            min: this.min,
            max: this.max,
            mean: this.sum / this.count,
            count: this.count
        };
    }
}

async function processFile(filePath, stats) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        try {
            const event = JSON.parse(line);
            if (event.latencyMs !== undefined) {
                stats.addValue(event.latencyMs);
            }
        } catch (err) {
            console.error('Error parsing line:', err);
        }
    }
}

async function processAllFiles() {
    const baseDir = './downloaded_logs';
    const files = [];
    const stats = new LatencyStats();

    // Find all kafka-latency-events.jsonl files
    const dirs = fs.readdirSync(baseDir);
    for (const dir of dirs) {
        const eventFile = path.join(baseDir, dir, 'kafka-latency-events.jsonl');
        if (fs.existsSync(eventFile)) {
            files.push(eventFile);
        }
    }

    // Process each file
    for (const file of files) {
        console.log(`Processing ${file}...`);
        await processFile(file, stats);
        // Show intermediate results
        console.log(`Processed ${stats.count} events so far...`);
    }

    console.log('\nFinal Statistics:');
    console.log(JSON.stringify(stats.getStats(), null, 2));
}

// Run the analysis
processAllFiles().catch(console.error);
