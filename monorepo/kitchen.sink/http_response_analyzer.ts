#!/usr/bin/env -S deno run --allow-all

// Type declarations for Deno globals
declare const Deno: {
  readTextFile(path: string): Promise<string>;
  args: string[];
  exit(code: number): never;
};

interface HttpRecord {
  id: string;
  timestamp: number;
  type: 'REQUEST' | 'WRITEHEAD';
  method: string;
  url: string;
  statusCode?: number;
  responseTimeMs?: number; // For WRITEHEAD records, this will be the actual response time
  lineNumber: number;
  rawLine: string;
}

async function analyzeHttpResponses(filePath: string) {
  console.log(`Analyzing HTTP request/response pairs in: ${filePath}`);
  
  try {
    const csvContent = await Deno.readTextFile(filePath);
    const lines = csvContent.split('\n');
    
    console.log(`Total lines found: ${lines.length}`);
    
    // Skip header line and filter empty lines
    const dataLines = lines.slice(1).filter(line => line.trim() !== '');
    console.log(`Data lines to process: ${dataLines.length}`);
    
    const httpRecords: HttpRecord[] = [];
    
    // Process each line to extract HTTP records
    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      
      // Look for HTTP response time logger entries
      if (line.includes('http-response-time-logger.js') && 
          (line.includes('[HttpResponseTimeLogger] REQUEST:') || 
           line.includes('[HttpResponseTimeLogger] WRITEHEAD:'))) {
        
        // Extract the log message part
        const logMatch = line.match(/\[HttpResponseTimeLogger\] (REQUEST|WRITEHEAD): (.+)/);
        if (!logMatch) continue;
        
        const type = logMatch[1] as 'REQUEST' | 'WRITEHEAD';
        const logContent = logMatch[2];
        
        // Extract ID
        const idMatch = logContent.match(/id=(\d+)/);
        if (!idMatch) continue;
        const id = idMatch[1];
        
        // Extract timestamp from start= parameter
        const startMatch = logContent.match(/start=(\d+)/);
        if (!startMatch) continue;
        const timestamp = parseInt(startMatch[1]);
        
        // Extract method and URL
        let method = 'UNKNOWN';
        let url = 'UNKNOWN';
        let statusCode: number | undefined;
        let responseTimeMs: number | undefined;
        
        if (type === 'REQUEST') {
          const requestMatch = logContent.match(/^(\w+)\s+(.+?)\s+id=/);
          if (requestMatch) {
            method = requestMatch[1];
            url = requestMatch[2];
          }
        } else if (type === 'WRITEHEAD') {
          const writeheadMatch = logContent.match(/^(\d+)\s+(\w+)\s+(.+?)\s+id=\d+\s+start=\d+\s+(\d+)msec/);
          if (writeheadMatch) {
            statusCode = parseInt(writeheadMatch[1]);
            method = writeheadMatch[2];
            url = writeheadMatch[3];
            responseTimeMs = parseInt(writeheadMatch[4]);
          }
        }
        
        httpRecords.push({
          id,
          timestamp,
          type,
          method,
          url,
          statusCode,
          responseTimeMs,
          lineNumber: i + 2, // +2 because we skipped header and arrays are 0-indexed
          rawLine: line
        });
      }
    }
    
    console.log(`HTTP records found: ${httpRecords.length}`);
    
    // Calculate timestamp range
    if (httpRecords.length > 0) {
      const timestamps = httpRecords.map(r => r.timestamp);
      const minTimestamp = Math.min(...timestamps);
      const maxTimestamp = Math.max(...timestamps);
      const timeRangeMs = maxTimestamp - minTimestamp;
      const timeRangeSeconds = timeRangeMs / 1000;
      const timeRangeMinutes = timeRangeSeconds / 60;
      
      console.log(`\nTIMESTAMP RANGE:`);
      console.log(`Min timestamp: ${minTimestamp} (${new Date(minTimestamp).toISOString()})`);
      console.log(`Max timestamp: ${maxTimestamp} (${new Date(maxTimestamp).toISOString()})`);
      console.log(`Time range: ${timeRangeMs}ms (${timeRangeSeconds.toFixed(2)}s / ${timeRangeMinutes.toFixed(2)}min)`);
    }
    
    // Group records by ID
    const recordsByID = new Map<string, HttpRecord[]>();
    for (const record of httpRecords) {
      if (!recordsByID.has(record.id)) {
        recordsByID.set(record.id, []);
      }
      recordsByID.get(record.id)!.push(record);
    }
    
    console.log(`Unique request IDs: ${recordsByID.size}`);
    
    // Analyze request/response pairs
    const completePairs: Array<{
      id: string;
      request: HttpRecord;
      response: HttpRecord;
      responseTimeMs: number;
    }> = [];
    
    const orphanedRequests: HttpRecord[] = [];
    const orphanedResponses: HttpRecord[] = [];
    const multipleOccurrences: Array<{ id: string; records: HttpRecord[] }> = [];
    
    for (const [id, records] of recordsByID.entries()) {
      if (records.length === 2) {
        // Sort by timestamp to ensure request comes before response
        records.sort((a, b) => a.timestamp - b.timestamp);
        
        const request = records.find(r => r.type === 'REQUEST');
        const response = records.find(r => r.type === 'WRITEHEAD');
        
        if (request && response && response.responseTimeMs !== undefined) {
          completePairs.push({
            id,
            request,
            response,
            responseTimeMs: response.responseTimeMs
          });
        } else {
          // Both are same type or missing response time
          if (records[0].type === 'REQUEST') {
            orphanedRequests.push(...records);
          } else {
            orphanedResponses.push(...records);
          }
        }
      } else if (records.length === 1) {
        if (records[0].type === 'REQUEST') {
          orphanedRequests.push(records[0]);
        } else {
          orphanedResponses.push(records[0]);
        }
      } else {
        multipleOccurrences.push({ id, records });
      }
    }
    
    // Sort complete pairs by response time (descending)
    completePairs.sort((a, b) => b.responseTimeMs - a.responseTimeMs);
    
    // Display results
    console.log("\n" + "=".repeat(100));
    console.log("ANALYSIS RESULTS");
    console.log("=".repeat(100));
    
    console.log(`\nComplete request/response pairs: ${completePairs.length}`);
    console.log(`Orphaned requests (no response): ${orphanedRequests.length}`);
    console.log(`Orphaned responses (no request): ${orphanedResponses.length}`);
    console.log(`IDs with multiple occurrences: ${multipleOccurrences.length}`);
    
    // Show slowest responses
    if (completePairs.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("TOP 20 SLOWEST RESPONSES:");
      console.log("-".repeat(100));
      console.log("ID\t\tResponse Time\tStatus\tMethod\tURL");
      console.log("-".repeat(100));
      
      const displayCount = Math.min(completePairs.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, responseTimeMs, response } = completePairs[i];
        const status = response.statusCode || 'N/A';
        console.log(`${id}\t\t${responseTimeMs}ms\t\t${status}\t${response.method}\t${response.url}`);
      }
    }
    
    // Show fastest responses
    if (completePairs.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("TOP 20 FASTEST RESPONSES:");
      console.log("-".repeat(100));
      console.log("ID\t\tResponse Time\tStatus\tMethod\tURL");
      console.log("-".repeat(100));
      
      const fastestPairs = [...completePairs].sort((a, b) => a.responseTimeMs - b.responseTimeMs);
      const displayCount = Math.min(fastestPairs.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, responseTimeMs, response } = fastestPairs[i];
        const status = response.statusCode || 'N/A';
        console.log(`${id}\t\t${responseTimeMs}ms\t\t${status}\t${response.method}\t${response.url}`);
      }
    }
    
    // Show orphaned requests
    if (orphanedRequests.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("ORPHANED REQUESTS (NO MATCHING RESPONSE):");
      console.log("-".repeat(100));
      console.log("ID\t\tTimestamp\tMethod\tURL");
      console.log("-".repeat(100));
      
      const displayCount = Math.min(orphanedRequests.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, timestamp, method, url } = orphanedRequests[i];
        console.log(`${id}\t\t${timestamp}\t${method}\t${url}`);
      }
      
      if (orphanedRequests.length > 20) {
        console.log(`\n... and ${orphanedRequests.length - 20} more orphaned requests`);
      }
      
      // Group orphaned requests by endpoint
      const orphanedRequestsByEndpoint = new Map<string, number>();
      for (const { url } of orphanedRequests) {
        orphanedRequestsByEndpoint.set(url, (orphanedRequestsByEndpoint.get(url) || 0) + 1);
      }
      
      console.log("\n" + "-".repeat(50));
      console.log("ORPHANED REQUESTS BY ENDPOINT:");
      console.log("-".repeat(50));
      console.log("Count\tEndpoint");
      console.log("-".repeat(50));
      
      for (const [endpoint, count] of [...orphanedRequestsByEndpoint.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`${count}\t${endpoint}`);
      }
    }
    
    // Show orphaned responses
    if (orphanedResponses.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("ORPHANED RESPONSES (NO MATCHING REQUEST):");
      console.log("-".repeat(100));
      console.log("ID\t\tTimestamp\tStatus\tMethod\tURL\t\tResponse Time");
      console.log("-".repeat(100));
      
      const displayCount = Math.min(orphanedResponses.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, timestamp, statusCode, method, url, responseTimeMs } = orphanedResponses[i];
        const status = statusCode || 'N/A';
        const respTime = responseTimeMs !== undefined ? `${responseTimeMs}ms` : 'N/A';
        console.log(`${id}\t\t${timestamp}\t${status}\t${method}\t${url}\t\t${respTime}`);
      }
      
      if (orphanedResponses.length > 20) {
        console.log(`\n... and ${orphanedResponses.length - 20} more orphaned responses`);
      }
      
      // Group orphaned responses by endpoint
      const orphanedResponsesByEndpoint = new Map<string, number>();
      for (const { url } of orphanedResponses) {
        orphanedResponsesByEndpoint.set(url, (orphanedResponsesByEndpoint.get(url) || 0) + 1);
      }
      
      console.log("\n" + "-".repeat(50));
      console.log("ORPHANED RESPONSES BY ENDPOINT:");
      console.log("-".repeat(50));
      console.log("Count\tEndpoint");
      console.log("-".repeat(50));
      
      for (const [endpoint, count] of [...orphanedResponsesByEndpoint.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`${count}\t${endpoint}`);
      }
    }
    
    // Response time statistics
    if (completePairs.length > 0) {
      const responseTimes = completePairs.map(p => p.responseTimeMs);
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const minResponseTime = Math.min(...responseTimes);
      const maxResponseTime = Math.max(...responseTimes);
      
      // Calculate percentiles
      responseTimes.sort((a, b) => a - b);
      const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)];
      const p90 = responseTimes[Math.floor(responseTimes.length * 0.9)];
      const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
      const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];
      
      console.log("\n" + "-".repeat(100));
      console.log("RESPONSE TIME STATISTICS:");
      console.log("-".repeat(100));
      console.log(`Average response time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`Min response time: ${minResponseTime}ms`);
      console.log(`Max response time: ${maxResponseTime}ms`);
      console.log(`50th percentile (median): ${p50}ms`);
      console.log(`90th percentile: ${p90}ms`);
      console.log(`95th percentile: ${p95}ms`);
      console.log(`99th percentile: ${p99}ms`);
    }
    
    // Method breakdown
    const methodStats = new Map<string, { count: number; avgResponseTime: number; totalResponseTime: number }>();
    for (const { response, responseTimeMs } of completePairs) {
      const method = response.method;
      if (!methodStats.has(method)) {
        methodStats.set(method, { count: 0, avgResponseTime: 0, totalResponseTime: 0 });
      }
      const stats = methodStats.get(method)!;
      stats.totalResponseTime += responseTimeMs;
      stats.count++;
      stats.avgResponseTime = stats.totalResponseTime / stats.count;
    }
    
    if (methodStats.size > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("RESPONSE TIME BY HTTP METHOD:");
      console.log("-".repeat(100));
      console.log("Method\t\tCount\t\tAvg Response Time");
      console.log("-".repeat(100));
      
      for (const [method, { count, avgResponseTime }] of [...methodStats.entries()].sort((a, b) => b[1].count - a[1].count)) {
        console.log(`${method}\t\t${count}\t\t${avgResponseTime.toFixed(2)}ms`);
      }
    }
    
    // Status code breakdown
    const statusStats = new Map<number, { count: number; avgResponseTime: number; totalResponseTime: number }>();
    for (const { response, responseTimeMs } of completePairs) {
      const status = response.statusCode || 0;
      if (!statusStats.has(status)) {
        statusStats.set(status, { count: 0, avgResponseTime: 0, totalResponseTime: 0 });
      }
      const stats = statusStats.get(status)!;
      stats.totalResponseTime += responseTimeMs;
      stats.count++;
      stats.avgResponseTime = stats.totalResponseTime / stats.count;
    }
    
    if (statusStats.size > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("RESPONSE TIME BY STATUS CODE:");
      console.log("-".repeat(100));
      console.log("Status\t\tCount\t\tAvg Response Time");
      console.log("-".repeat(100));
      
      for (const [status, { count, avgResponseTime }] of [...statusStats.entries()].sort((a, b) => b[1].count - a[1].count)) {
        console.log(`${status}\t\t${count}\t\t${avgResponseTime.toFixed(2)}ms`);
      }
    }
    
  } catch (error) {
    console.error(`Error processing file: ${error.message}`);
    Deno.exit(1);
  }
}

// Main execution
if ((import.meta as any).main) {
  const filePath = Deno.args[0] || "/data/search-results-2025-05-27T16_18_33.456-0700.csv";
  
  if (!filePath) {
    console.error("Usage: ./http_response_analyzer.ts [csv_file_path]");
    Deno.exit(1);
  }
  
  await analyzeHttpResponses(filePath);
}

export {}; 