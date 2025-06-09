/// <reference lib="deno.ns" />

import { walk } from "https://deno.land/std/fs/walk.ts";
import { parse as parseJsonl } from "https://deno.land/std/jsonc/mod.ts";
import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
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

interface TimeBucketStats {
  [bucket: string]: LatencyStats;
}

interface TimeBucketData {
  latencies: number[];
}

// Create a unique temporary directory for this run
const TEMP_DIR = join("/tmp", `kafka-latency-analysis-${Date.now()}`);
// Define a constant for the time bucket report file
// A new file will be created for each test run with a unique timestamp
let BUCKET_REPORT_FILE = "";

// Store bucket reports in memory before writing them out sorted
const bucketReports: Array<{bucket: string, stats: LatencyStats}> = [];

// Configure performance settings
const CONCURRENCY_LIMIT = 10; // Increased from 5 to 10
const BUFFER_SIZE = 1024 * 1024; // 1MB buffer for file operations
const BATCH_SIZE = 1000; // Process events in batches of 1000

// Bucket type configuration
let BUCKET_TYPE: "hour" | "minute" = "hour";

/**
 * Compare two time bucket strings for sorting in reverse chronological order
 * @param bucketA First bucket string
 * @param bucketB Second bucket string
 * @returns Negative if bucketA is more recent, positive if bucketB is more recent
 */
function compareBucketsReverseChrono(bucketA: string, bucketB: string): number {
  // For hour format: "YYYY-MM-DD_HH"
  // For minute format: "YYYY-MM-DD_HH:MM"
  
  let dateTimeA: string;
  let dateTimeB: string;
  
  if (BUCKET_TYPE === "hour") {
    const [dateA, hoursA] = bucketA.split('_');
    const [dateB, hoursB] = bucketB.split('_');
    dateTimeA = `${dateA}T${hoursA}:00:00`;
    dateTimeB = `${dateB}T${hoursB}:00:00`;
  } else {
    // Minute format
    const [dateA, timeA] = bucketA.split('_');
    const [dateB, timeB] = bucketB.split('_');
    dateTimeA = `${dateA}T${timeA}:00`;
    dateTimeB = `${dateB}T${timeB}:00`;
  }
  
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

function getTimeBucket(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  
  if (BUCKET_TYPE === "hour") {
    return `${year}-${month}-${day}_${hours}`;
  } else {
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}:${minutes}`;
  }
}

/**
 * Logs bucket information to a report file in /tmp with a filename containing zero-padded epoch milliseconds
 * @param bucket The bucket string in format YYYY-MM-DD_HH or YYYY-MM-DD_HH:MM
 * @param stats The latency statistics for this bucket
 */
async function logBucketToTmpFile(bucket: string, stats: LatencyStats): Promise<void> {
  try {
    // Ensure the temp directory exists
    await ensureDir(TEMP_DIR);
    
    // Store the entry in memory
    bucketReports.push({
      bucket,
      stats: {
        ...stats,
        avg: Number(stats.avg.toFixed(2)),
      }
    });
    
    console.log(`${BUCKET_TYPE === "hour" ? "Hour" : "Minute"} data stored for bucket: ${bucket}`);
  } catch (error) {
    console.error(`Error storing ${BUCKET_TYPE} data: ${error}`);
  }
}

/**
 * Write all bucket reports to file, sorted by bucket
 */
async function writeSortedBucketReports(): Promise<void> {
  try {
    // Skip if there are no reports to write
    if (bucketReports.length === 0) {
      console.log(`No ${BUCKET_TYPE} reports to write.`);
      return;
    }
    
    // Ensure the temp directory exists
    await ensureDir(TEMP_DIR);
    
    // Sort reports by bucket in reverse chronological order (most recent first)
    bucketReports.sort((a, b) => compareBucketsReverseChrono(a.bucket, b.bucket));
    
    // First, create an array of all the report lines
    const reportLines: string[] = [];
    
    for (const report of bucketReports) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        [`${BUCKET_TYPE}`]: report.bucket,
        stats: report.stats
      };
      
      // Convert to JSON line format with newline
      reportLines.push(JSON.stringify(logEntry));
    }
    
    // Write all lines at once to the file (create new file)
    await Deno.writeTextFile(BUCKET_REPORT_FILE, reportLines.join("\n") + "\n");
    
    console.log(`All ${BUCKET_TYPE} reports written to: ${BUCKET_REPORT_FILE}`);
    
    // Clear the bucket reports array after writing to file
    bucketReports.length = 0;
  } catch (error) {
    console.error(`Error writing sorted ${BUCKET_TYPE} reports: ${error}`);
  }
}

async function processGzippedFile(filePath: string, fileBucket: string): Promise<void> {
  try {
    console.log(`Processing gzipped file: ${filePath} (file timestamp bucket: ${fileBucket})`);
    const compressedData = await Deno.readFile(filePath);
    const decompressedData = await gunzip(compressedData);
    const content = new TextDecoder().decode(decompressedData);
    
    if (!content.trim()) {
      console.log(`Skipping empty file: ${filePath}`);
      return;
    }

    const lines = content.trim().split("\n");
    console.log(`Processing ${lines.length} lines from ${filePath}`);

    // Group events by time bucket based on their actual timestamps
    const bucketData: Record<string, { latencies: string }> = {};
    
    // Process lines in batches for better memory efficiency
    for (let i = 0; i < lines.length; i += BATCH_SIZE) {
      const batch = lines.slice(i, i + BATCH_SIZE);
      
      for (const line of batch) {
        if (!line.trim()) continue; // Skip empty lines
        
        try {
          const event = parseJsonl(line) as ConsumerEvent;
          if (event.type !== "consume") continue;

          // Use the event's actual timestamp to determine the time bucket
          const eventTimestamp = new Date(event.timestamp).getTime();
          const eventBucket = getTimeBucket(eventTimestamp);
          
          // Initialize this bucket if it doesn't exist
          if (!bucketData[eventBucket]) {
            bucketData[eventBucket] = { latencies: "" };
          }
          
          // Add this event's data to its bucket
          bucketData[eventBucket].latencies += `${event.latency_ms}\n`;
        } catch (e) {
          // Log the problematic line for debugging
          console.error(`Error parsing line in ${filePath}:`, e);
        }
      }
    }
    
    // Write data for each bucket
    const writePromises = Object.entries(bucketData).map(async ([bucket, data]) => {
      const bucketPath = join(TEMP_DIR, bucket);
      await ensureDir(bucketPath);
      
      const latenciesPath = join(bucketPath, "latencies.jsonl");
      
      // Append latencies to the bucket file
      await Deno.writeTextFile(latenciesPath, data.latencies, { append: true });
    });
    
    // Wait for all writes to complete
    await Promise.all(writePromises);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

async function analyzeConsumerLogsByBucket(testDir: string): Promise<TimeBucketStats> {
  // Create temp directory for this analysis
  await ensureDir(TEMP_DIR);
  console.log(`Using temporary directory: ${TEMP_DIR}`);
  
  // Track all buckets we've seen
  const buckets = new Set<string>();
  
  // Collect all files to process
  const filesToProcess: { path: string; fileBucket: string }[] = [];
  
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
    const fileBucket = getTimeBucket(fileTimestamp);
    buckets.add(fileBucket);
    
    filesToProcess.push({ path: entry.path, fileBucket });
  }
  
  console.log(`Found ${filesToProcess.length} files to process`);
  
  // Process files concurrently with increased concurrency limit
  const chunks: Array<{ path: string; fileBucket: string }[]> = [];
  
  for (let i = 0; i < filesToProcess.length; i += CONCURRENCY_LIMIT) {
    const chunk = filesToProcess.slice(i, i + CONCURRENCY_LIMIT);
    chunks.push(chunk);
  }
  
  console.log(`Processing files in ${chunks.length} chunks of up to ${CONCURRENCY_LIMIT} files each`);
  
  let processedChunks = 0;
  const totalChunks = chunks.length;
  
  for (const chunk of chunks) {
    await Promise.all(chunk.map(file => processGzippedFile(file.path, file.fileBucket)));
    processedChunks++;
    console.log(`Processed chunk ${processedChunks}/${totalChunks} (${Math.round(processedChunks/totalChunks*100)}%)`);
  }
  
  // Now read all the temp files and calculate stats
  const bucketStats: TimeBucketStats = {};
  
  // Get all directories in the temp directory to find all buckets
  const allBuckets = new Set<string>();
  for await (const entry of Deno.readDir(TEMP_DIR)) {
    if (entry.isDirectory) {
      allBuckets.add(entry.name);
    }
  }
  
  console.log(`Found ${allBuckets.size} ${BUCKET_TYPE} buckets to analyze`);
  
  for (const bucket of allBuckets) {
    const bucketPath = join(TEMP_DIR, bucket);
    const latenciesPath = join(bucketPath, "latencies.jsonl");
    
    try {
      // Read latencies
      let latencies: number[] = [];
      try {
        const latenciesContent = await Deno.readTextFile(latenciesPath);
        latencies = latenciesContent
          .split("\n")
          .filter(line => line.trim())
          .map(line => parseFloat(line));
      } catch (e) {
        console.log(`No latencies found for ${BUCKET_TYPE}: ${bucket}`);
      }
      
      console.log(`Calculating stats for ${BUCKET_TYPE}: ${bucket} (${latencies.length} events)`);
      bucketStats[bucket] = calculateStats(latencies);
      
      // Log bucket information to tmp file with zero-padded epoch milliseconds
      await logBucketToTmpFile(bucket, bucketStats[bucket]);
      
      // Clean up this bucket's temp files immediately after processing
      try {
        await Deno.remove(bucketPath, { recursive: true });
        console.log(`Cleaned up temporary files for ${BUCKET_TYPE}: ${bucket}`);
      } catch (error) {
        console.error(`Error cleaning up temporary files for ${BUCKET_TYPE} ${bucket}:`, error);
      }
    } catch (error) {
      console.error(`Error calculating stats for ${BUCKET_TYPE} ${bucket}:`, error);
    }
  }
  
  // Clean up the main temp directory
  try {
    await Deno.remove(TEMP_DIR, { recursive: true });
    console.log(`Cleaned up main temporary directory: ${TEMP_DIR}`);
  } catch (error) {
    console.error(`Error cleaning up main temporary directory: ${TEMP_DIR}`, error);
  }
  
  return bucketStats;
}

async function main() {
  const reportsDir = Deno.args[0];
  if (!reportsDir) {
    console.error("Please provide the reports directory path");
    Deno.exit(1);
  }

  // Get bucket type from command line (default to "hour")
  const bucketTypeArg = Deno.args[1] || "hour";
  if (bucketTypeArg !== "hour" && bucketTypeArg !== "minute") {
    console.error("Invalid bucket type. Must be 'hour' or 'minute'");
    Deno.exit(1);
  }
  BUCKET_TYPE = bucketTypeArg as "hour" | "minute";

  try {
    // Find all timestamp directories
    for await (const entry of Deno.readDir(reportsDir)) {
      if (!entry.isDirectory) continue;
      
      const testDir = `${reportsDir}/${entry.name}`;
      console.log(`Analyzing test run: ${entry.name}`);
      
      try {
        // Create a new bucket report file for each test run
        BUCKET_REPORT_FILE = join("/tmp", `${BUCKET_TYPE}_reports_${Date.now()}.jsonl`);
        console.log(`Using ${BUCKET_TYPE} report file: ${BUCKET_REPORT_FILE}`);
        
        // Clear the bucket reports array at the beginning of each test run
        bucketReports.length = 0;
        
        const bucketStats = await analyzeConsumerLogsByBucket(testDir);
        
        if (Object.keys(bucketStats).length === 0) {
          console.log(`No data found for test run: ${entry.name}`);
          continue;
        }
        
        // Write sorted bucket reports to the JSONL file
        await writeSortedBucketReports();
        
        // Format the report
        const report = {
          timestamp: new Date().toISOString(),
          test_run: entry.name,
          bucket_type: BUCKET_TYPE,
          [`${BUCKET_TYPE}_stats`]: Object.entries(bucketStats).map(([bucket, stats]) => ({
            [BUCKET_TYPE]: bucket,
            stats: {
              ...stats,
              avg: Number(stats.avg.toFixed(2)),
            },
          })).sort((a, b) => compareBucketsReverseChrono(a[BUCKET_TYPE], b[BUCKET_TYPE])),
        };

        // Write report to the timestamp directory
        const reportPath = `${testDir}/consumer.${BUCKET_TYPE}.report.json`;
        await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`${BUCKET_TYPE === "hour" ? "Hourly" : "Per-minute"} report generated for ${entry.name}:`, reportPath);
        
        // Print a summary of the bucket stats
        let p99_99_exceeded = false;
        let p99_999_exceeded = false;
        
        for (const bucketData of report[`${BUCKET_TYPE}_stats`]) {
          let thresholdFlag = "✅ OK";
          if (bucketData.stats.exceeds_threshold) {
            if (bucketData.stats.p99_99 > 100 && bucketData.stats.p99_999 > 150) {
              thresholdFlag = "⚠️ BOTH P99.99 & P99.999 THRESHOLDS EXCEEDED";
              p99_99_exceeded = true;
              p99_999_exceeded = true;
            } else if (bucketData.stats.p99_99 > 100) {
              thresholdFlag = "⚠️ P99.99 THRESHOLD EXCEEDED";
              p99_99_exceeded = true;
            } else {
              thresholdFlag = "⚠️ P99.999 THRESHOLD EXCEEDED";
              p99_999_exceeded = true;
            }
          }
          
          console.log(
            `${BUCKET_TYPE === "hour" ? "Hour" : "Minute"}: ${bucketData[BUCKET_TYPE]}, Count: ${bucketData.stats.count}, ` +
            `Avg: ${bucketData.stats.avg}ms, P99: ${bucketData.stats.p99}ms, ` +
            `P99.99: ${bucketData.stats.p99_99}ms, P99.999: ${bucketData.stats.p99_999}ms ${thresholdFlag}`
          );
          
          // Log each bucket to a tmp file with zero-padded epoch milliseconds
          await logBucketToTmpFile(bucketData[BUCKET_TYPE], bucketData.stats);
        }
        
        // Print overall summary
        if (!p99_99_exceeded && !p99_999_exceeded) {
          console.log(`✅ All ${BUCKET_TYPE}s are below both the 100ms p99.99 threshold and the 150ms p99.999 threshold`);
        } else {
          if (p99_99_exceeded) {
            console.log(`⚠️ Some ${BUCKET_TYPE}s exceeded the 100ms p99.99 threshold`);
          }
          if (p99_999_exceeded) {
            console.log(`⚠️ Some ${BUCKET_TYPE}s exceeded the 150ms p99.999 threshold`);
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