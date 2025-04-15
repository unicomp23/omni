/// <reference lib="deno.ns" />

import { walk } from "https://deno.land/std/fs/walk.ts";
import { parse as parseJsonl } from "https://deno.land/std/jsonc/mod.ts";
import { gunzip, gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
import { ensureDir } from "https://deno.land/std/fs/ensure_dir.ts";
import { join } from "https://deno.land/std/path/mod.ts";

interface ConsumerEvent {
  type: string;
  timestamp: string;
  key: string;
  latency_ms: number;
}

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p99_9: number;
  p99_99: number;
  p99_999: number;
  exceeds_threshold: boolean;
}

interface HourlyStats {
  [hour: string]: LatencyStats;
}

interface HourlyBucket {
  latencies: number[];
}

// Create a unique temporary directory for this run
const TEMP_DIR = join("/tmp", `kafka-latency-analysis-${Date.now()}`);
// Define a constant for the hourly report file
// A new file will be created for each test run with a unique timestamp
let HOURLY_REPORT_FILE = "";

// Store hourly reports in memory before writing them out sorted
const hourlyReports: Array<{hour: string, stats: LatencyStats}> = [];

// Configure performance settings
const CONCURRENCY_LIMIT = 10; // Increased from 5 to 10
const BUFFER_SIZE = 1024 * 1024; // 1MB buffer for file operations
const BATCH_SIZE = 1000; // Process events in batches of 1000

/**
 * Compare two hour strings in format "YYYY-MM-DD_HH" for sorting in reverse chronological order
 * @param hourA First hour string
 * @param hourB Second hour string
 * @returns Negative if hourA is more recent, positive if hourB is more recent
 */
function compareHoursReverseChrono(hourA: string, hourB: string): number {
  // Parse the hour strings into Date objects
  const [dateA, hoursA] = hourA.split('_');
  const [dateB, hoursB] = hourB.split('_');
  
  // Create comparable date strings with hours
  const dateTimeA = `${dateA}T${hoursA}:00:00`;
  const dateTimeB = `${dateB}T${hoursB}:00:00`;
  
  // Sort in reverse chronological order (most recent first)
  return new Date(dateTimeB).getTime() - new Date(dateTimeA).getTime();
}

function calculatePercentile(sortedLatencies: number[], percentile: number): number {
  if (sortedLatencies.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedLatencies.length) - 1;
  return sortedLatencies[Math.max(0, index)];
}

function calculateStats(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      p99_9: 0,
      p99_99: 0,
      p99_999: 0,
      exceeds_threshold: false,
    };
  }

  // Sort latencies for percentile calculations
  latencies.sort((a, b) => a - b);

  const p99_99 = calculatePercentile(latencies, 99.99);
  const p99_999 = calculatePercentile(latencies, 99.999);
  // Flag when p99.99 > 100ms or p99.999 > 150ms
  const exceeds_threshold = p99_99 > 100 || p99_999 > 150;

  return {
    count: latencies.length,
    min: latencies[0],
    max: latencies[latencies.length - 1],
    avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p50: calculatePercentile(latencies, 50),
    p75: calculatePercentile(latencies, 75),
    p90: calculatePercentile(latencies, 90),
    p95: calculatePercentile(latencies, 95),
    p99: calculatePercentile(latencies, 99),
    p99_9: calculatePercentile(latencies, 99.9),
    p99_99,
    p99_999,
    exceeds_threshold,
  };
}

function getHourBucket(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}`;
}

/**
 * Logs hour information to a report file in /tmp with a filename containing zero-padded epoch milliseconds
 * @param hour The hour string in format YYYY-MM-DD_HH
 * @param stats The latency statistics for this hour
 */
async function logHourToTmpFile(hour: string, stats: LatencyStats): Promise<void> {
  try {
    // Ensure the temp directory exists
    await ensureDir(TEMP_DIR);
    
    // Store the entry in memory
    hourlyReports.push({
      hour,
      stats: {
        ...stats,
        avg: Number(stats.avg.toFixed(2)),
      }
    });
    
    console.log(`Hour data stored for hour: ${hour}`);
  } catch (error) {
    console.error(`Error storing hour data: ${error}`);
  }
}

/**
 * Write all hourly reports to file, sorted by hour
 */
async function writeSortedHourlyReports(): Promise<void> {
  try {
    // Skip if there are no reports to write
    if (hourlyReports.length === 0) {
      console.log("No hourly reports to write.");
      return;
    }
    
    // Ensure the temp directory exists
    await ensureDir(TEMP_DIR);
    
    // Sort reports by hour in reverse chronological order (most recent first)
    hourlyReports.sort((a, b) => compareHoursReverseChrono(a.hour, b.hour));
    
    // First, create an array of all the report lines
    const reportLines: string[] = [];
    
    for (const report of hourlyReports) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        hour: report.hour,
        stats: report.stats
      };
      
      // Convert to JSON line format with newline
      reportLines.push(JSON.stringify(logEntry));
    }
    
    // Write all lines at once to the file (create new file)
    await Deno.writeTextFile(HOURLY_REPORT_FILE, reportLines.join("\n") + "\n");
    
    console.log(`All hourly reports written to: ${HOURLY_REPORT_FILE}`);
    
    // Clear the hourly reports array after writing to file
    hourlyReports.length = 0;
  } catch (error) {
    console.error(`Error writing sorted hourly reports: ${error}`);
  }
}

async function processGzippedFile(filePath: string, fileHourBucket: string): Promise<void> {
  try {
    console.log(`Processing gzipped file: ${filePath} (file timestamp bucket: ${fileHourBucket})`);
    const compressedData = await Deno.readFile(filePath);
    const decompressedData = await gunzip(compressedData);
    const content = new TextDecoder().decode(decompressedData);
    
    if (!content.trim()) {
      console.log(`Skipping empty file: ${filePath}`);
      return;
    }

    const lines = content.trim().split("\n");
    console.log(`Processing ${lines.length} lines from ${filePath}`);

    // Group events by hour bucket based on their actual timestamps
    const hourBucketData: Record<string, { latencies: string }> = {};
    
    // Process lines in batches for better memory efficiency
    for (let i = 0; i < lines.length; i += BATCH_SIZE) {
      const batch = lines.slice(i, i + BATCH_SIZE);
      
      for (const line of batch) {
        if (!line.trim()) continue; // Skip empty lines
        
        try {
          const event = parseJsonl(line) as ConsumerEvent;
          if (event.type !== "consume") continue;

          // Use the event's actual timestamp to determine the hour bucket
          const eventTimestamp = new Date(event.timestamp).getTime();
          const eventHourBucket = getHourBucket(eventTimestamp);
          
          // Initialize this hour bucket if it doesn't exist
          if (!hourBucketData[eventHourBucket]) {
            hourBucketData[eventHourBucket] = { latencies: "" };
          }
          
          // Add this event's data to its hour bucket
          hourBucketData[eventHourBucket].latencies += `${event.latency_ms}\n`;
        } catch (e) {
          // Log the problematic line for debugging
          console.error(`Error parsing line in ${filePath}:`, e);
        }
      }
    }
    
    // Write data for each hour bucket
    const writePromises = Object.entries(hourBucketData).map(async ([hourBucket, data]) => {
      const hourBucketPath = join(TEMP_DIR, hourBucket);
      await ensureDir(hourBucketPath);
      
      const latenciesPath = join(hourBucketPath, "latencies.jsonl");
      const latenciesGzPath = join(hourBucketPath, "latencies.jsonl.gz");
      
      // Write uncompressed data first
      await Deno.writeTextFile(latenciesPath, data.latencies, { append: true });
      
      // Compress the file
      const uncompressedData = await Deno.readFile(latenciesPath);
      const compressedData = await gzip(uncompressedData);
      await Deno.writeFile(latenciesGzPath, compressedData);
      
      // Remove the uncompressed file
      await Deno.remove(latenciesPath);
    });
    
    // Wait for all writes to complete
    await Promise.all(writePromises);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

async function analyzeConsumerLogsByHour(testDir: string): Promise<HourlyStats> {
  // Create temp directory for this analysis
  await ensureDir(TEMP_DIR);
  console.log(`Using temporary directory: ${TEMP_DIR}`);
  
  // Track all hour buckets we've seen
  const hourBuckets = new Set<string>();
  
  // Collect all files to process
  const filesToProcess: { path: string; fileHourBucket: string }[] = [];
  
  console.log(`Scanning directory: ${testDir}`);
  // Walk through all consumer.*.jsonl and consumer.*.jsonl.gz files in this test directory
  for await (const entry of walk(testDir, { maxDepth: 3 })) {
    if (!entry.isFile || !entry.name.match(/^consumer\.\d+\.(jsonl|jsonl\.gz)$/)) continue;

    // Extract timestamp from filename (e.g., consumer.1741597665516.jsonl.gz)
    const timestampMatch = entry.name.match(/consumer\.(\d+)\./);
    if (!timestampMatch) {
      console.log(`Skipping file with no timestamp: ${entry.path}`);
      continue;
    }

    const fileTimestamp = parseInt(timestampMatch[1]);
    const fileHourBucket = getHourBucket(fileTimestamp);
    hourBuckets.add(fileHourBucket);
    
    filesToProcess.push({ path: entry.path, fileHourBucket });
  }
  
  console.log(`Found ${filesToProcess.length} files to process`);
  
  // Process files concurrently with increased concurrency limit
  const chunks: Array<{ path: string; fileHourBucket: string }[]> = [];
  
  for (let i = 0; i < filesToProcess.length; i += CONCURRENCY_LIMIT) {
    const chunk = filesToProcess.slice(i, i + CONCURRENCY_LIMIT);
    chunks.push(chunk);
  }
  
  console.log(`Processing files in ${chunks.length} chunks of up to ${CONCURRENCY_LIMIT} files each`);
  
  let processedChunks = 0;
  const totalChunks = chunks.length;
  
  for (const chunk of chunks) {
    await Promise.all(chunk.map(file => processGzippedFile(file.path, file.fileHourBucket)));
    processedChunks++;
    console.log(`Processed chunk ${processedChunks}/${totalChunks} (${Math.round(processedChunks/totalChunks*100)}%)`);
  }
  
  // Now read all the temp files and calculate stats
  const hourlyStats: HourlyStats = {};
  
  // Get all directories in the temp directory to find all hour buckets
  const allHourBuckets = new Set<string>();
  for await (const entry of Deno.readDir(TEMP_DIR)) {
    if (entry.isDirectory) {
      allHourBuckets.add(entry.name);
    }
  }
  
  console.log(`Found ${allHourBuckets.size} hour buckets to analyze`);
  
  for (const fileHourBucket of allHourBuckets) {
    const fileHourBucketPath = join(TEMP_DIR, fileHourBucket);
    const latenciesGzPath = join(fileHourBucketPath, "latencies.jsonl.gz");
    
    try {
      // Read latencies
      let latencies: number[] = [];
      try {
        const compressedData = await Deno.readFile(latenciesGzPath);
        const decompressedData = await gunzip(compressedData);
        const latenciesContent = new TextDecoder().decode(decompressedData);
        latencies = latenciesContent
          .split("\n")
          .filter(line => line.trim())
          .map(line => parseFloat(line));
      } catch (e) {
        console.log(`No latencies found for hour: ${fileHourBucket}`);
      }
      
      console.log(`Calculating stats for hour: ${fileHourBucket} (${latencies.length} events)`);
      hourlyStats[fileHourBucket] = calculateStats(latencies);
      
      // Log hour information to tmp file with zero-padded epoch milliseconds
      await logHourToTmpFile(fileHourBucket, hourlyStats[fileHourBucket]);
      
      // Clean up this hour's temp files immediately after processing
      try {
        await Deno.remove(fileHourBucketPath, { recursive: true });
        console.log(`Cleaned up temporary files for hour: ${fileHourBucket}`);
      } catch (error) {
        console.error(`Error cleaning up temporary files for hour ${fileHourBucket}:`, error);
      }
    } catch (error) {
      console.error(`Error calculating stats for hour ${fileHourBucket}:`, error);
    }
  }
  
  // Clean up the main temp directory
  try {
    await Deno.remove(TEMP_DIR, { recursive: true });
    console.log(`Cleaned up main temporary directory: ${TEMP_DIR}`);
  } catch (error) {
    console.error(`Error cleaning up main temporary directory: ${TEMP_DIR}`, error);
  }
  
  return hourlyStats;
}

async function main() {
  const reportsDir = Deno.args[0];
  if (!reportsDir) {
    console.error("Please provide the reports directory path");
    Deno.exit(1);
  }

  try {
    // Find all timestamp directories
    for await (const entry of Deno.readDir(reportsDir)) {
      if (!entry.isDirectory) continue;
      
      const testDir = `${reportsDir}/${entry.name}`;
      console.log(`Analyzing test run: ${entry.name}`);
      
      try {
        // Create a new hourly report file for each test run
        HOURLY_REPORT_FILE = join("/tmp", `hourly_reports_${Date.now()}.jsonl`);
        console.log(`Using hourly report file: ${HOURLY_REPORT_FILE}`);
        
        // Clear the hourly reports array at the beginning of each test run
        hourlyReports.length = 0;
        
        const hourlyStats = await analyzeConsumerLogsByHour(testDir);
        
        if (Object.keys(hourlyStats).length === 0) {
          console.log(`No data found for test run: ${entry.name}`);
          continue;
        }
        
        // Write sorted hourly reports to the JSONL file
        await writeSortedHourlyReports();
        
        // Format the report
        const report = {
          timestamp: new Date().toISOString(),
          test_run: entry.name,
          hourly_stats: Object.entries(hourlyStats).map(([hour, stats]) => ({
            hour,
            stats: {
              ...stats,
              avg: Number(stats.avg.toFixed(2)),
            },
          })).sort((a, b) => compareHoursReverseChrono(a.hour, b.hour)),
        };

        // Write report to the timestamp directory
        const reportPath = `${testDir}/consumer.hourly.report.json`;
        await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`Hourly report generated for ${entry.name}:`, reportPath);
        
        // Print a summary of the hourly stats
        let p99_99_exceeded = false;
        let p99_999_exceeded = false;
        
        for (const hourData of report.hourly_stats) {
          let thresholdFlag = "✅ OK";
          if (hourData.stats.exceeds_threshold) {
            if (hourData.stats.p99_99 > 100 && hourData.stats.p99_999 > 150) {
              thresholdFlag = "⚠️ BOTH P99.99 & P99.999 THRESHOLDS EXCEEDED";
              p99_99_exceeded = true;
              p99_999_exceeded = true;
            } else if (hourData.stats.p99_99 > 100) {
              thresholdFlag = "⚠️ P99.99 THRESHOLD EXCEEDED";
              p99_99_exceeded = true;
            } else {
              thresholdFlag = "⚠️ P99.999 THRESHOLD EXCEEDED";
              p99_999_exceeded = true;
            }
          }
          
          console.log(
            `Hour: ${hourData.hour}, Count: ${hourData.stats.count}, ` +
            `Avg: ${hourData.stats.avg}ms, P99: ${hourData.stats.p99}ms, ` +
            `P99.99: ${hourData.stats.p99_99}ms, P99.999: ${hourData.stats.p99_999}ms ${thresholdFlag}`
          );
          
          // Log each hour to a tmp file with zero-padded epoch milliseconds
          await logHourToTmpFile(hourData.hour, hourData.stats);
        }
        
        // Print overall summary
        if (!p99_99_exceeded && !p99_999_exceeded) {
          console.log("✅ All hours are below both the 100ms p99.99 threshold and the 150ms p99.999 threshold");
        } else {
          if (p99_99_exceeded) {
            console.log("⚠️ Some hours exceeded the 100ms p99.99 threshold");
          }
          if (p99_999_exceeded) {
            console.log("⚠️ Some hours exceeded the 150ms p99.999 threshold");
          }
        }
      } catch (error) {
        console.error(`Error analyzing test run ${entry.name}:`, error);
        // Continue with next test run
      }
    }
  } catch (error) {
    console.error("Error processing reports:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
} 