import { walk } from "https://deno.land/std/fs/walk.ts";
import { parse as parseJsonl } from "https://deno.land/std/jsonc/mod.ts";
import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";

interface ConsumerEvent {
  type: string;
  timestamp: string;
  key: string;
  latency_ms: number;
  within_kpi: boolean;
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
  within_kpi_count: number;
  within_kpi_pct: number;
}

function calculatePercentile(sortedLatencies: number[], percentile: number): number {
  const index = Math.ceil((percentile / 100) * sortedLatencies.length) - 1;
  return sortedLatencies[index];
}

async function analyzeConsumerLogs(testDir: string): Promise<LatencyStats> {
  const latencies: number[] = [];
  let withinKpiCount = 0;

  // Walk through all consumer.*.jsonl and consumer.*.jsonl.gz files in this test directory
  for await (const entry of walk(testDir)) {
    if (!entry.isFile || !entry.name.match(/^consumer.*\.(jsonl|jsonl\.gz)$/)) continue;

    let content: string;
    if (entry.name.endsWith('.jsonl.gz')) {
      // Handle gzipped files
      console.log(`Processing gzipped file: ${entry.path}`);
      const compressedData = await Deno.readFile(entry.path);
      const decompressedData = await gunzip(compressedData);
      content = new TextDecoder().decode(decompressedData);
    } else {
      // Handle regular jsonl files
      content = await Deno.readTextFile(entry.path);
    }

    if (!content.trim()) {
      console.log(`Skipping empty file: ${entry.path}`);
      continue;
    }

    const lines = content.trim().split("\n");
    console.log(`Processing ${lines.length} lines from ${entry.path}`);

    for (const line of lines) {
      if (!line.trim()) continue; // Skip empty lines
      
      try {
        const event = parseJsonl(line) as ConsumerEvent;
        if (event.type !== "consume") continue;

        latencies.push(event.latency_ms);
        if (event.within_kpi) withinKpiCount++;
      } catch (e) {
        // Log the problematic line for debugging
        console.error(`Error parsing line in ${entry.path}:`, e);
        console.error(`Problematic line: ${line}`);
      }
    }
  }

  if (latencies.length === 0) {
    throw new Error("No consumer events found");
  }

  // Log summary before calculations
  console.log(`Processed ${latencies.length} events, ${withinKpiCount} within KPI`);

  // Sort latencies for percentile calculations
  latencies.sort((a, b) => a - b);

  const stats: LatencyStats = {
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
    p99_99: calculatePercentile(latencies, 99.99),
    within_kpi_count: withinKpiCount,
    within_kpi_pct: (withinKpiCount / latencies.length) * 100,
  };

  return stats;
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
        const stats = await analyzeConsumerLogs(testDir);
        
        // Format the report
        const report = {
          timestamp: new Date().toISOString(),
          test_run: entry.name,
          stats: {
            ...stats,
            avg: Number(stats.avg.toFixed(2)),
            within_kpi_pct: Number(stats.within_kpi_pct.toFixed(2)),
          },
        };

        // Write report to the timestamp directory
        const reportPath = `${testDir}/consumer.report.json`;
        await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`Report generated for ${entry.name}:`, reportPath);
        console.log(report);
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