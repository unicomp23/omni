#!/usr/bin/env -S deno run --allow-all

// Type declarations for Deno globals
declare const Deno: {
  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
  writeTextFile(path: string, data: string, options?: { append?: boolean }): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  args: string[];
  exit(code: number): never;
};

// Add crypto import for hashing
declare const crypto: {
  subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
};

interface HttpRecord {
  id: string;
  timestamp: number;
  type: 'REQUEST' | 'WRITEHEAD';
  method: string;
  url: string;
  host: string; // Added host field
  statusCode?: number;
  responseTimeMs?: number; // For WRITEHEAD records, this will be the actual response time
  lineNumber: number;
  rawLine: string;
}

interface BucketRecord {
  id: string;
  timestamp: number;
  type: 'REQUEST' | 'WRITEHEAD';
  method: string;
  url: string;
  host: string; // Added host field
  statusCode?: number;
  responseTimeMs?: number;
  lineNumber: number;
  rawLine: string;
}

interface WorkspaceConfig {
  workspaceDir: string;
  bucketsDir: string;
  resultsDir: string;
  numBuckets: number;
}

// Helper function to extract host from URL
function extractHost(url: string): string {
  try {
    // Handle different URL formats
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Full URL with protocol
      const urlObj = new URL(url);
      return urlObj.hostname;
    } else if (url.includes('://')) {
      // URL with custom protocol
      const parts = url.split('://');
      if (parts.length > 1) {
        const hostPart = parts[1].split('/')[0];
        return hostPart.split(':')[0]; // Remove port if present
      }
    } else if (url.startsWith('//')) {
      // Protocol-relative URL
      const hostPart = url.substring(2).split('/')[0];
      return hostPart.split(':')[0]; // Remove port if present
    } else if (url.includes('.') && !url.startsWith('/')) {
      // Likely a domain without protocol
      const hostPart = url.split('/')[0];
      return hostPart.split(':')[0]; // Remove port if present
    }
    
    // Fallback for paths or unrecognized formats
    return 'localhost';
  } catch (error) {
    // Fallback for any parsing errors
    return 'unknown';
  }
}

async function decompressGzFile(filePath: string): Promise<string> {
  // Read the gzipped file as bytes
  const gzData = await Deno.readFile(filePath);
  
  // Use DecompressionStream to decompress
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(gzData);
      controller.close();
    }
  }).pipeThrough(new DecompressionStream('gzip'));
  
  // Convert stream to text
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  // Combine chunks and decode to string
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  
  return new TextDecoder().decode(combined);
}

async function findChunkFiles(directory: string = '/data'): Promise<string[]> {
  const chunkFiles: string[] = [];
  
  try {
    for await (const dirEntry of Deno.readDir(directory)) {
      if (dirEntry.name.startsWith('sumo-chunk-') && 
          (dirEntry.name.endsWith('.csv') || dirEntry.name.endsWith('.csv.gz'))) {
        chunkFiles.push(`${directory}/${dirEntry.name}`);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${directory}:`, error.message);
    return [];
  }
  
  // Sort files numerically by chunk number
  chunkFiles.sort((a, b) => {
    const aMatch = a.match(/sumo-chunk-(\d+)/);
    const bMatch = b.match(/sumo-chunk-(\d+)/);
    
    if (aMatch && bMatch) {
      return parseInt(aMatch[1]) - parseInt(bMatch[1]);
    }
    return a.localeCompare(b);
  });
  
  return chunkFiles;
}

async function processChunkFile(filePath: string, chunkNumber: number): Promise<HttpRecord[]> {
  console.log(`Processing chunk ${chunkNumber}: ${filePath.split('/').pop()}`);
  
  let csvContent: string;
  
  if (filePath.endsWith('.gz')) {
    csvContent = await decompressGzFile(filePath);
  } else {
    csvContent = await Deno.readTextFile(filePath);
  }
  
  const lines = csvContent.split('\n');
  const dataLines = lines.slice(1).filter(line => line.trim() !== ''); // Skip header
  
  const httpRecords: HttpRecord[] = [];
  
  // Timestamp validation - only accept timestamps from 2024 onwards (recent data)
  const validTimestampThreshold = new Date('2024-01-01').getTime();
  let invalidTimestampCount = 0;
  
  // Process each line to extract HTTP records
  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    
    // Look for HTTP response time logger entries
    if (line.includes('http-response-time-logger.js') && 
        (line.includes('[HttpResponseTimeLogger] REQUEST:') || 
         line.includes('[HttpResponseTimeLogger] WRITEHEAD:'))) {
      
      // Parse CSV to extract sourcehost field
      // CSV format: "messagetime","receipttime","raw","sourcehost","sourcecategory",...
      const csvFields = line.split('","');
      let sourcehost = 'unknown';
      
      if (csvFields.length >= 4) {
        // sourcehost is the 4th field (index 3)
        sourcehost = csvFields[3].replace(/^"/, '').replace(/"$/, ''); // Remove quotes
      }
      
      // Extract the log message part from the raw field (3rd field, index 2)
      const rawField = csvFields.length >= 3 ? csvFields[2] : line;
      const logMatch = rawField.match(/\[HttpResponseTimeLogger\] (REQUEST|WRITEHEAD): (.+)/);
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
      
      // Filter out invalid timestamps
      if (timestamp < validTimestampThreshold) {
        invalidTimestampCount++;
        continue; // Skip this record
      }
      
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
        host: sourcehost, // Use sourcehost from CSV instead of extracting from URL
        statusCode,
        responseTimeMs,
        lineNumber: i + 2, // +2 because we skipped header and arrays are 0-indexed
        rawLine: line
      });
    }
  }
  
  if (invalidTimestampCount > 0) {
    console.log(`  Filtered out ${invalidTimestampCount.toLocaleString()} records with invalid timestamps (before 2024)`);
  }
  
  console.log(`  Found ${httpRecords.length} valid HTTP records in chunk ${chunkNumber}`);
  return httpRecords;
}

async function analyzeHttpResponses(inputPath: string, startChunk?: number, endChunk?: number) {
  console.log(`Analyzing HTTP request/response pairs from: ${inputPath}`);
  
  // Streaming aggregation variables
  let totalHttpRecords = 0;
  let totalCompletePairs = 0;
  let totalOrphanedRequests = 0;
  let totalOrphanedResponses = 0;
  let totalMultipleOccurrences = 0;
  let extremelySlowCount = 0; // Responses > 5 seconds
  
  // Memory-efficient sampling for response times (max 10K samples instead of 50K)
  const maxSamples = 10000;
  const allResponseTimes: number[] = [];
  let totalResponseTimeSum = 0;
  let minResponseTime = Infinity;
  let maxResponseTime = 0;
  let sampleCount = 0;
  
  const methodStats = new Map<string, { count: number; totalResponseTime: number }>();
  const statusStats = new Map<number, { count: number; totalResponseTime: number }>();
  const orphanedEndpoints = new Map<string, number>();
  const orphanedResponseEndpoints = new Map<string, number>();
  const slowestResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }> = [];
  const fastestResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }> = [];
  const extremelySlowResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }> = [];
  
  // Track specific orphaned record IDs with smaller limits
  const orphanedRequestIds: Array<{ id: string; method: string; url: string; timestamp: number }> = [];
  const orphanedResponseIds: Array<{ id: string; status: number | undefined; method: string; url: string; timestamp: number }> = [];
  
  // Performance distribution counters
  let sub10msCount = 0;
  let ms10to100Count = 0;
  let ms100to5sCount = 0;
  let over5sCount = 0;
  
  let minTimestamp = Infinity;
  let maxTimestamp = 0;
  
  try {
    // Check if input is a single file or directory pattern
    if (inputPath.includes('sumo-chunk-') || inputPath === '/data' || inputPath.endsWith('/')) {
      // Process multiple chunk files
      const directory = inputPath === '/data' || inputPath.endsWith('/') ? inputPath.replace(/\/$/, '') : '/data';
      const chunkFiles = await findChunkFiles(directory);
      
      if (chunkFiles.length === 0) {
        console.error(`No chunk files found in ${directory}`);
        Deno.exit(1);
      }
      
      console.log(`Found ${chunkFiles.length} chunk files to process`);
      
      // Apply chunk range filtering if specified
      let processChunks = chunkFiles;
      if (startChunk && endChunk) {
        const startIndex = startChunk - 1; // Convert to 0-based index
        const endIndex = Math.min(endChunk, chunkFiles.length); // Ensure we don't exceed array bounds
        processChunks = chunkFiles.slice(startIndex, endIndex);
        console.log(`📦 BATCH MODE: Processing ${processChunks.length} chunks (${startChunk}-${Math.min(endChunk, chunkFiles.length)})`);
      }
      
      console.log("=".repeat(100));
      
      // Process each chunk file individually (streaming)
      for (let i = 0; i < processChunks.length; i++) {
        const actualChunkNumber = startChunk ? startChunk + i : i + 1;
        const httpRecords = await processChunkFile(processChunks[i], actualChunkNumber);
        
        // Update timestamp range
        if (httpRecords.length > 0) {
          const timestamps = httpRecords.map(r => r.timestamp);
          minTimestamp = Math.min(minTimestamp, Math.min(...timestamps));
          maxTimestamp = Math.max(maxTimestamp, Math.max(...timestamps));
        }
        
        // Process this chunk's records
        const chunkResults = processChunkRecords(httpRecords);
        
        // Aggregate the results
        totalHttpRecords += httpRecords.length;
        totalCompletePairs += chunkResults.completePairs.length;
        totalOrphanedRequests += chunkResults.orphanedRequests.length;
        totalOrphanedResponses += chunkResults.orphanedResponses.length;
        totalMultipleOccurrences += chunkResults.multipleOccurrences.length;
        
        // Memory-efficient response time processing
        for (const pair of chunkResults.completePairs) {
          const responseTime = pair.responseTimeMs;
          
          // Update running statistics
          totalResponseTimeSum += responseTime;
          minResponseTime = Math.min(minResponseTime, responseTime);
          maxResponseTime = Math.max(maxResponseTime, responseTime);
          sampleCount++;
          
          // Sample response times for percentile calculation (reservoir sampling)
          if (allResponseTimes.length < maxSamples) {
            allResponseTimes.push(responseTime);
          } else {
            // Reservoir sampling: randomly replace existing sample
            const randomIndex = Math.floor(Math.random() * sampleCount);
            if (randomIndex < maxSamples) {
              allResponseTimes[randomIndex] = responseTime;
            }
          }
          
          // Update performance distribution counters
          if (responseTime < 10) {
            sub10msCount++;
          } else if (responseTime < 100) {
            ms10to100Count++;
          } else if (responseTime < 5000) {
            ms100to5sCount++;
          } else {
            over5sCount++;
          }
          
          // Track extremely slow responses (>5 seconds)
          if (responseTime > 5000) {
            extremelySlowCount++;
            if (extremelySlowResponses.length < 20) {
              extremelySlowResponses.push({
                id: pair.id,
                responseTimeMs: responseTime,
                status: pair.response.statusCode,
                method: pair.response.method,
                url: pair.response.url,
                timestamp: pair.response.timestamp
              });
            }
          }
          
          // Update method stats
          const method = pair.response.method;
          if (!methodStats.has(method)) {
            methodStats.set(method, { count: 0, totalResponseTime: 0 });
          }
          const mStats = methodStats.get(method)!;
          mStats.count++;
          mStats.totalResponseTime += responseTime;
          
          // Update status stats
          const status = pair.response.statusCode || 0;
          if (!statusStats.has(status)) {
            statusStats.set(status, { count: 0, totalResponseTime: 0 });
          }
          const sStats = statusStats.get(status)!;
          sStats.count++;
          sStats.totalResponseTime += responseTime;
          
          // Track slowest responses (keep top 20 instead of 50 to reduce memory)
          if (slowestResponses.length < 20) {
            slowestResponses.push({
              id: pair.id,
              responseTimeMs: responseTime,
              status: pair.response.statusCode,
              method: pair.response.method,
              url: pair.response.url,
              timestamp: pair.response.timestamp
            });
          } else {
            // Only keep if it's slower than the current slowest
            slowestResponses.sort((a, b) => b.responseTimeMs - a.responseTimeMs);
            if (responseTime > slowestResponses[19].responseTimeMs) {
              slowestResponses[19] = {
                id: pair.id,
                responseTimeMs: responseTime,
                status: pair.response.statusCode,
                method: pair.response.method,
                url: pair.response.url,
                timestamp: pair.response.timestamp
              };
            }
          }
          
          // Track fastest responses (keep top 20 instead of 50 to reduce memory)
          if (fastestResponses.length < 20) {
            fastestResponses.push({
              id: pair.id,
              responseTimeMs: responseTime,
              status: pair.response.statusCode,
              method: pair.response.method,
              url: pair.response.url,
              timestamp: pair.response.timestamp
            });
          } else {
            // Only keep if it's faster than the current fastest
            fastestResponses.sort((a, b) => a.responseTimeMs - b.responseTimeMs);
            if (responseTime < fastestResponses[19].responseTimeMs) {
              fastestResponses[19] = {
                id: pair.id,
                responseTimeMs: responseTime,
                status: pair.response.statusCode,
                method: pair.response.method,
                url: pair.response.url,
                timestamp: pair.response.timestamp
              };
            }
          }
        }
        
        // Aggregate orphaned endpoints (with smaller memory limits)
        for (const orphan of chunkResults.orphanedRequests) {
          orphanedEndpoints.set(orphan.url, (orphanedEndpoints.get(orphan.url) || 0) + 1);
          // Track specific orphaned request IDs (limit to prevent memory growth)
          if (orphanedRequestIds.length < 200) {
            orphanedRequestIds.push({
              id: orphan.id,
              method: orphan.method,
              url: orphan.url,
              timestamp: orphan.timestamp
            });
          }
        }
        
        // Aggregate orphaned response endpoints (with smaller memory limits)
        for (const orphan of chunkResults.orphanedResponses) {
          orphanedResponseEndpoints.set(orphan.url, (orphanedResponseEndpoints.get(orphan.url) || 0) + 1);
          // Track specific orphaned response IDs (limit to prevent memory growth)
          if (orphanedResponseIds.length < 200) {
            orphanedResponseIds.push({
              id: orphan.id,
              status: orphan.statusCode,
              method: orphan.method,
              url: orphan.url,
              timestamp: orphan.timestamp
            });
          }
        }
        
        // Limit orphaned endpoint tracking to prevent memory growth (smaller limits)
        if (orphanedEndpoints.size > 200) {
          const sortedEntries = [...orphanedEndpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100);
          orphanedEndpoints.clear();
          for (const [url, count] of sortedEntries) {
            orphanedEndpoints.set(url, count);
          }
        }
        
        if (orphanedResponseEndpoints.size > 200) {
          const sortedEntries = [...orphanedResponseEndpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100);
          orphanedResponseEndpoints.clear();
          for (const [url, count] of sortedEntries) {
            orphanedResponseEndpoints.set(url, count);
          }
        }
        
        // Free memory by clearing the chunk records
        httpRecords.length = 0;
        
        console.log(`  Processed chunk ${actualChunkNumber}/${processChunks.length} - Total pairs so far: ${totalCompletePairs.toLocaleString()}`);
        
        // Force garbage collection hint every 5 chunks instead of 10
        if ((actualChunkNumber) % 5 === 0) {
          // Clear some temporary arrays to help with memory
          if (globalThis.gc) {
            globalThis.gc();
          }
          
          // Aggressive cleanup every 5 chunks
          if (slowestResponses.length > 10) {
            slowestResponses.sort((a, b) => b.responseTimeMs - a.responseTimeMs);
            slowestResponses.splice(10); // Keep only top 10
          }
          if (fastestResponses.length > 10) {
            fastestResponses.sort((a, b) => a.responseTimeMs - b.responseTimeMs);
            fastestResponses.splice(10); // Keep only top 10
          }
        }
      }
      
    } else {
      // Single file processing (existing logic but with memory optimization)
      const httpRecords = await processSingleFile(inputPath);
      const chunkResults = processChunkRecords(httpRecords);
      
      totalHttpRecords = httpRecords.length;
      totalCompletePairs = chunkResults.completePairs.length;
      totalOrphanedRequests = chunkResults.orphanedRequests.length;
      totalOrphanedResponses = chunkResults.orphanedResponses.length;
      totalMultipleOccurrences = chunkResults.multipleOccurrences.length;
      
      // Process response times with sampling
      for (const pair of chunkResults.completePairs) {
        const responseTime = pair.responseTimeMs;
        
        totalResponseTimeSum += responseTime;
        minResponseTime = Math.min(minResponseTime, responseTime);
        maxResponseTime = Math.max(maxResponseTime, responseTime);
        sampleCount++;
        
        if (allResponseTimes.length < maxSamples) {
          allResponseTimes.push(responseTime);
        }
        
        // Update performance distribution
        if (responseTime < 10) sub10msCount++;
        else if (responseTime < 100) ms10to100Count++;
        else if (responseTime < 5000) ms100to5sCount++;
        else over5sCount++;
        
        if (responseTime > 5000) {
          extremelySlowCount++;
          if (extremelySlowResponses.length < 20) {
            extremelySlowResponses.push({
              id: pair.id,
              responseTimeMs: responseTime,
              status: pair.response.statusCode,
              method: pair.response.method,
              url: pair.response.url,
              timestamp: pair.response.timestamp
            });
          }
        }
        
        // Update stats maps
        const method = pair.response.method;
        if (!methodStats.has(method)) {
          methodStats.set(method, { count: 0, totalResponseTime: 0 });
        }
        const mStats = methodStats.get(method)!;
        mStats.count++;
        mStats.totalResponseTime += responseTime;
        
        const status = pair.response.statusCode || 0;
        if (!statusStats.has(status)) {
          statusStats.set(status, { count: 0, totalResponseTime: 0 });
        }
        const sStats = statusStats.get(status)!;
        sStats.count++;
        sStats.totalResponseTime += responseTime;
        
        slowestResponses.push({
          id: pair.id,
          responseTimeMs: responseTime,
          status: pair.response.statusCode,
          method: pair.response.method,
          url: pair.response.url,
          timestamp: pair.response.timestamp
        });
        
        fastestResponses.push({
          id: pair.id,
          responseTimeMs: responseTime,
          status: pair.response.statusCode,
          method: pair.response.method,
          url: pair.response.url,
          timestamp: pair.response.timestamp
        });
      }
      
      for (const orphan of chunkResults.orphanedRequests) {
        orphanedEndpoints.set(orphan.url, (orphanedEndpoints.get(orphan.url) || 0) + 1);
        // Track specific orphaned request IDs
        if (orphanedRequestIds.length < 200) {
          orphanedRequestIds.push({
            id: orphan.id,
            method: orphan.method,
            url: orphan.url,
            timestamp: orphan.timestamp
          });
        }
      }
      
      for (const orphan of chunkResults.orphanedResponses) {
        orphanedResponseEndpoints.set(orphan.url, (orphanedResponseEndpoints.get(orphan.url) || 0) + 1);
        // Track specific orphaned response IDs
        if (orphanedResponseIds.length < 200) {
          orphanedResponseIds.push({
            id: orphan.id,
            status: orphan.statusCode,
            method: orphan.method,
            url: orphan.url,
            timestamp: orphan.timestamp
          });
        }
      }
      
      if (httpRecords.length > 0) {
        const timestamps = httpRecords.map(r => r.timestamp);
        minTimestamp = Math.min(...timestamps);
        maxTimestamp = Math.max(...timestamps);
      }
    }
    
    // Sort final results
    slowestResponses.sort((a, b) => b.responseTimeMs - a.responseTimeMs);
    fastestResponses.sort((a, b) => a.responseTimeMs - b.responseTimeMs);
    
    console.log("\n" + "=".repeat(100));
    console.log(`TOTAL HTTP RECORDS FOUND: ${totalHttpRecords.toLocaleString()}`);
    console.log("=".repeat(100));
    
    // Calculate timestamp range
    if (minTimestamp !== Infinity && maxTimestamp > 0) {
      const timeRangeMs = maxTimestamp - minTimestamp;
      const timeRangeSeconds = timeRangeMs / 1000;
      const timeRangeMinutes = timeRangeSeconds / 60;
      const timeRangeHours = timeRangeMinutes / 60;
      const timeRangeDays = timeRangeHours / 24;
      
      console.log(`\nTIMESTAMP RANGE (FILTERED DATA - 2024+ ONLY):`);
      console.log(`Min timestamp: ${minTimestamp} (${new Date(minTimestamp).toISOString()})`);
      console.log(`Max timestamp: ${maxTimestamp} (${new Date(maxTimestamp).toISOString()})`);
      console.log(`Duration: ${timeRangeDays.toFixed(1)} days`);
      console.log(`Activity rate: ${(totalHttpRecords / timeRangeSeconds).toFixed(2)} HTTP operations/second`);
    }
    
    // Display results
    console.log("\n" + "=".repeat(100));
    console.log("ANALYSIS RESULTS");
    console.log("=".repeat(100));
    
    console.log(`\nComplete request/response pairs: ${totalCompletePairs.toLocaleString()}`);
    console.log(`Orphaned requests (no response): ${totalOrphanedRequests.toLocaleString()}`);
    console.log(`Orphaned responses (no request): ${totalOrphanedResponses.toLocaleString()}`);
    console.log(`IDs with multiple occurrences: ${totalMultipleOccurrences.toLocaleString()}`);
    console.log(`🚨 Extremely slow responses (>5s): ${extremelySlowCount.toLocaleString()}`);
    
    // Show extremely slow responses if any
    if (extremelySlowResponses.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("🚨 EXTREMELY SLOW RESPONSES (>5 SECONDS):");
      console.log("-".repeat(100));
      console.log("ID\t\tResponse Time\tStatus\tMethod\tURL");
      console.log("-".repeat(100));
      
      // Sort by response time (descending) and show top 20
      extremelySlowResponses.sort((a, b) => b.responseTimeMs - a.responseTimeMs);
      const displayCount = Math.min(extremelySlowResponses.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, responseTimeMs, status, method, url } = extremelySlowResponses[i];
        const statusStr = status || 'N/A';
        const timeInSeconds = (responseTimeMs / 1000).toFixed(2);
        console.log(`${id}\t\t${timeInSeconds}s\t\t${statusStr}\t${method}\t${url}`);
      }
      
      if (extremelySlowResponses.length > 20) {
        console.log(`\n... and ${extremelySlowResponses.length - 20} more extremely slow responses`);
      }
    }
    
    // Show slowest responses
    if (slowestResponses.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("TOP 20 SLOWEST RESPONSES:");
      console.log("-".repeat(100));
      console.log("ID\t\tResponse Time\tStatus\tMethod\tURL");
      console.log("-".repeat(100));
      
      const displayCount = Math.min(slowestResponses.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, responseTimeMs, status, method, url } = slowestResponses[i];
        const statusStr = status || 'N/A';
        console.log(`${id}\t\t${responseTimeMs}ms\t\t${statusStr}\t${method}\t${url}`);
      }
    }
    
    // Show fastest responses
    if (fastestResponses.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("TOP 20 FASTEST RESPONSES:");
      console.log("-".repeat(100));
      console.log("ID\t\tResponse Time\tStatus\tMethod\tURL");
      console.log("-".repeat(100));
      
      const displayCount = Math.min(fastestResponses.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, responseTimeMs, status, method, url } = fastestResponses[i];
        const statusStr = status || 'N/A';
        console.log(`${id}\t\t${responseTimeMs}ms\t\t${statusStr}\t${method}\t${url}`);
      }
    }
    
    // Response time statistics using sampled data
    if (sampleCount > 0) {
      allResponseTimes.sort((a, b) => a - b);
      const avgResponseTime = totalResponseTimeSum / sampleCount;
      
      // Calculate percentiles from sample
      const p50 = allResponseTimes[Math.floor(allResponseTimes.length * 0.5)];
      const p90 = allResponseTimes[Math.floor(allResponseTimes.length * 0.9)];
      const p95 = allResponseTimes[Math.floor(allResponseTimes.length * 0.95)];
      const p99 = allResponseTimes[Math.floor(allResponseTimes.length * 0.99)];
      
      console.log("\n" + "-".repeat(100));
      console.log("RESPONSE TIME STATISTICS:");
      console.log("-".repeat(100));
      console.log(`Sample size: ${allResponseTimes.length.toLocaleString()} (from ${sampleCount.toLocaleString()} total)`);
      console.log(`Average response time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`Min response time: ${minResponseTime}ms`);
      console.log(`Max response time: ${maxResponseTime.toLocaleString()}ms`);
      console.log(`50th percentile (median): ${p50}ms`);
      console.log(`90th percentile: ${p90}ms`);
      console.log(`95th percentile: ${p95}ms`);
      console.log(`99th percentile: ${p99}ms`);
      
      // Performance summary using counters
      console.log(`\nPERFORMANCE SUMMARY:`);
      console.log(`✅ Sub-10ms responses: ${sub10msCount.toLocaleString()} (${(sub10msCount / sampleCount * 100).toFixed(1)}%)`);
      console.log(`⚠️  10-100ms responses: ${ms10to100Count.toLocaleString()} (${(ms10to100Count / sampleCount * 100).toFixed(1)}%)`);
      console.log(`🔴 100ms-5s responses: ${ms100to5sCount.toLocaleString()} (${(ms100to5sCount / sampleCount * 100).toFixed(1)}%)`);
      console.log(`🚨 >5s responses: ${over5sCount.toLocaleString()} (${(over5sCount / sampleCount * 100).toFixed(1)}%) - CRITICAL!`);
    }
    
    // Method breakdown
    if (methodStats.size > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("RESPONSE TIME BY HTTP METHOD:");
      console.log("-".repeat(100));
      console.log("Method\t\tCount\t\t\tAvg Response Time");
      console.log("-".repeat(100));
      
      for (const [method, { count, totalResponseTime }] of [...methodStats.entries()].sort((a, b) => b[1].count - a[1].count)) {
        const avgResponseTime = totalResponseTime / count;
        console.log(`${method}\t\t${count.toLocaleString()}\t\t\t${avgResponseTime.toFixed(2)}ms`);
      }
    }
    
    // Status code breakdown
    if (statusStats.size > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("RESPONSE TIME BY STATUS CODE:");
      console.log("-".repeat(100));
      console.log("Status\t\tCount\t\t\tAvg Response Time");
      console.log("-".repeat(100));
      
      for (const [status, { count, totalResponseTime }] of [...statusStats.entries()].sort((a, b) => b[1].count - a[1].count)) {
        const avgResponseTime = totalResponseTime / count;
        console.log(`${status}\t\t${count.toLocaleString()}\t\t\t${avgResponseTime.toFixed(2)}ms`);
      }
    }
    
    // Show summary of orphaned requests by endpoint (top 10)
    if (orphanedEndpoints.size > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("TOP 10 ORPHANED REQUEST ENDPOINTS:");
      console.log("-".repeat(100));
      console.log("Count\t\tEndpoint");
      console.log("-".repeat(100));
      
      const sortedOrphans = [...orphanedEndpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [endpoint, count] of sortedOrphans) {
        console.log(`${count.toLocaleString()}\t\t${endpoint}`);
      }
    }

    // Show summary of orphaned responses by endpoint (top 10)
    if (orphanedResponseEndpoints.size > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("TOP 10 ORPHANED RESPONSE ENDPOINTS:");
      console.log("-".repeat(100));
      console.log("Count\t\tEndpoint");
      console.log("-".repeat(100));
      
      const sortedOrphanResponses = [...orphanedResponseEndpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [endpoint, count] of sortedOrphanResponses) {
        console.log(`${count.toLocaleString()}\t\t${endpoint}`);
      }
    }
    
    // Show specific orphaned request IDs
    if (orphanedRequestIds.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("SPECIFIC ORPHANED REQUEST IDs:");
      console.log("-".repeat(100));
      console.log("ID\t\tEpoch (ms)\tTimestamp\tMethod\tEndpoint");
      console.log("-".repeat(100));
      
      const displayCount = Math.min(orphanedRequestIds.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, method, url, timestamp } = orphanedRequestIds[i];
        const shortUrl = url.length > 50 ? url.substring(0, 47) + '...' : url;
        const timestampStr = new Date(timestamp).toISOString();
        console.log(`${id}\t\t${timestamp}\t${timestampStr}\t${method}\t${shortUrl}`);
      }
      
      if (orphanedRequestIds.length > 20) {
        console.log(`\n... and ${orphanedRequestIds.length - 20} more orphaned requests`);
      }
    }
    
    // Show specific orphaned response IDs
    if (orphanedResponseIds.length > 0) {
      console.log("\n" + "-".repeat(100));
      console.log("SPECIFIC ORPHANED RESPONSE IDs:");
      console.log("-".repeat(100));
      console.log("ID\t\tEpoch (ms)\tTimestamp\tStatus\tMethod\tEndpoint");
      console.log("-".repeat(100));
      
      const displayCount = Math.min(orphanedResponseIds.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, status, method, url, timestamp } = orphanedResponseIds[i];
        const statusStr = status || 'N/A';
        const shortUrl = url.length > 40 ? url.substring(0, 37) + '...' : url;
        const timestampStr = new Date(timestamp).toISOString();
        console.log(`${id}\t\t${timestamp}\t${timestampStr}\t${statusStr}\t${method}\t${shortUrl}`);
      }
      
      if (orphanedResponseIds.length > 20) {
        console.log(`\n... and ${orphanedResponseIds.length - 20} more orphaned responses`);
      }
    }
    
    console.log("\n" + "=".repeat(100));
    console.log("ANALYSIS COMPLETE");
    console.log("=".repeat(100));
    
    await generateMarkdownReport(
      inputPath,
      totalHttpRecords,
      totalCompletePairs,
      totalOrphanedRequests,
      totalOrphanedResponses,
      totalMultipleOccurrences,
      extremelySlowCount,
      allResponseTimes,
      methodStats,
      statusStats,
      slowestResponses,
      fastestResponses,
      extremelySlowResponses,
      orphanedEndpoints,
      orphanedResponseEndpoints,
      orphanedRequestIds,
      orphanedResponseIds,
      minTimestamp,
      maxTimestamp,
      sampleCount,
      totalResponseTimeSum,
      minResponseTime,
      maxResponseTime,
      sub10msCount,
      ms10to100Count,
      ms100to5sCount,
      over5sCount
    );
    
  } catch (error) {
    console.error(`Error processing files: ${error.message}`);
    Deno.exit(1);
  }
}

// Helper function to process records for a single chunk
function processChunkRecords(httpRecords: HttpRecord[]): {
  completePairs: Array<{
    id: string;
    request: HttpRecord;
    response: HttpRecord;
    responseTimeMs: number;
  }>;
  orphanedRequests: HttpRecord[];
  orphanedResponses: HttpRecord[];
  multipleOccurrences: Array<{ id: string; records: HttpRecord[] }>;
} {
  // Group records by composite key (id:host)
  const recordsByCompositeKey = new Map<string, HttpRecord[]>();
  
  const completePairs: Array<{
    id: string;
    request: HttpRecord;
    response: HttpRecord;
    responseTimeMs: number;
  }> = [];
  
  const orphanedRequests: HttpRecord[] = [];
  const orphanedResponses: HttpRecord[] = [];
  const multipleOccurrences: Array<{ id: string; records: HttpRecord[] }> = [];
  
  for (const record of httpRecords) {
    const compositeKey = `${record.id}:${record.host}`;
    
    if (!recordsByCompositeKey.has(compositeKey)) {
      recordsByCompositeKey.set(compositeKey, []);
    }
    
    const records = recordsByCompositeKey.get(compositeKey)!;
    records.push(record);
    
    // Process immediately when counter reaches 2
    if (records.length === 2) {
      // Sort by timestamp to ensure request comes before response
      records.sort((a, b) => a.timestamp - b.timestamp);
      
      const request = records.find(r => r.type === 'REQUEST');
      const response = records.find(r => r.type === 'WRITEHEAD');
      
      if (request && response && response.responseTimeMs !== undefined) {
        // Calculate lag between request and response
        const lagMs = response.timestamp - request.timestamp;
        
        if (lagMs > 5000) {
          // Lag >5s, treat as orphaned but still remove from map to save memory
          orphanedRequests.push(request);
          orphanedResponses.push(response);
        } else {
          // Normal pair, process it
          completePairs.push({
            id: request.id,
            request,
            response,
            responseTimeMs: response.responseTimeMs
          });
        }
        // Remove from map for both cases to prevent memory accumulation
        recordsByCompositeKey.delete(compositeKey);
      } else {
        // Both are same type or missing response time
        if (records[0].type === 'REQUEST') {
          orphanedRequests.push(...records);
        } else {
          orphanedResponses.push(...records);
        }
        // Remove malformed pairs from map
        recordsByCompositeKey.delete(compositeKey);
      }
      
      // All pairs with counter==2 are removed from map to save memory
    }
  }
  
  // Process remaining single records as orphaned
  for (const [compositeKey, records] of recordsByCompositeKey.entries()) {
    if (records.length === 1) {
      if (records[0].type === 'REQUEST') {
        orphanedRequests.push(records[0]);
      } else {
        orphanedResponses.push(records[0]);
      }
    } else if (records.length > 2) {
      // Multiple occurrences (should be rare with composite keys)
      multipleOccurrences.push({ id: records[0].id, records });
    }
  }
  
  return {
    completePairs,
    orphanedRequests,
    orphanedResponses,
    multipleOccurrences
  };
}

// Helper function to process a single file
async function processSingleFile(inputPath: string): Promise<HttpRecord[]> {
  let csvContent: string;
  
  if (inputPath.endsWith('.gz')) {
    csvContent = await decompressGzFile(inputPath);
  } else {
    csvContent = await Deno.readTextFile(inputPath);
  }
  
  const lines = csvContent.split('\n');
  const dataLines = lines.slice(1).filter(line => line.trim() !== '');
  
  const httpRecords: HttpRecord[] = [];
  
  // Timestamp validation - only accept timestamps from 2024 onwards (recent data)
  const validTimestampThreshold = new Date('2024-01-01').getTime();
  let invalidTimestampCount = 0;
  
  // Process single file (existing logic)
  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    
    if (line.includes('http-response-time-logger.js') && 
        (line.includes('[HttpResponseTimeLogger] REQUEST:') || 
         line.includes('[HttpResponseTimeLogger] WRITEHEAD:'))) {
      
      // Parse CSV to extract sourcehost field
      // CSV format: "messagetime","receipttime","raw","sourcehost","sourcecategory",...
      const csvFields = line.split('","');
      let sourcehost = 'unknown';
      
      if (csvFields.length >= 4) {
        // sourcehost is the 4th field (index 3)
        sourcehost = csvFields[3].replace(/^"/, '').replace(/"$/, ''); // Remove quotes
      }
      
      // Extract the log message part from the raw field (3rd field, index 2)
      const rawField = csvFields.length >= 3 ? csvFields[2] : line;
      const logMatch = rawField.match(/\[HttpResponseTimeLogger\] (REQUEST|WRITEHEAD): (.+)/);
      if (!logMatch) continue;
      
      const type = logMatch[1] as 'REQUEST' | 'WRITEHEAD';
      const logContent = logMatch[2];
      
      const idMatch = logContent.match(/id=(\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      
      const startMatch = logContent.match(/start=(\d+)/);
      if (!startMatch) continue;
      const timestamp = parseInt(startMatch[1]);
      
      // Filter out invalid timestamps
      if (timestamp < validTimestampThreshold) {
        invalidTimestampCount++;
        continue; // Skip this record
      }
      
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
        host: sourcehost, // Use sourcehost from CSV instead of extracting from URL
        statusCode,
        responseTimeMs,
        lineNumber: i + 2,
        rawLine: line
      });
    }
  }
  
  if (invalidTimestampCount > 0) {
    console.log(`Filtered out ${invalidTimestampCount.toLocaleString()} records with invalid timestamps (before 2024)`);
  }
  
  return httpRecords;
}

async function generateMarkdownReport(
  inputPath: string,
  totalHttpRecords: number,
  totalCompletePairs: number,
  totalOrphanedRequests: number,
  totalOrphanedResponses: number,
  totalMultipleOccurrences: number,
  extremelySlowCount: number,
  allResponseTimes: number[],
  methodStats: Map<string, { count: number; totalResponseTime: number }>,
  statusStats: Map<number, { count: number; totalResponseTime: number }>,
  slowestResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>,
  fastestResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>,
  extremelySlowResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>,
  orphanedEndpoints: Map<string, number>,
  orphanedResponseEndpoints: Map<string, number>,
  orphanedRequestIds: Array<{ id: string; method: string; url: string; timestamp: number }>,
  orphanedResponseIds: Array<{ id: string; status: number | undefined; method: string; url: string; timestamp: number }>,
  minTimestamp: number,
  maxTimestamp: number,
  sampleCount: number,
  totalResponseTimeSum: number,
  minResponseTime: number,
  maxResponseTime: number,
  sub10msCount: number,
  ms10to100Count: number,
  ms100to5sCount: number,
  over5sCount: number
): Promise<void> {
  const reportPath = `comprehensive_http_analysis_report_${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
  
  // Calculate time range
  const timeRangeMs = maxTimestamp - minTimestamp;
  const timeRangeSeconds = timeRangeMs / 1000;
  const timeRangeHours = timeRangeSeconds / 3600;
  const timeRangeDays = timeRangeHours / 24;
  
  // Calculate response time statistics
  allResponseTimes.sort((a, b) => a - b);
  const avgResponseTime = totalResponseTimeSum / sampleCount;
  
  // Calculate percentiles from sample
  const p50 = allResponseTimes[Math.floor(allResponseTimes.length * 0.5)];
  const p90 = allResponseTimes[Math.floor(allResponseTimes.length * 0.9)];
  const p95 = allResponseTimes[Math.floor(allResponseTimes.length * 0.95)];
  const p99 = allResponseTimes[Math.floor(allResponseTimes.length * 0.99)];
  
  // Calculate success rate for reporting
  const successRate = ((totalCompletePairs / (totalCompletePairs + totalOrphanedRequests + totalOrphanedResponses)) * 100).toFixed(2);
  
  const report = `# HTTP Request/Response Analysis Report - Production Scale (using sourcehost)

**Data Source:** ${inputPath === '/data' ? '70+ compressed chunks from adaptive bulk download' : inputPath}  
**Analysis Date:** ${new Date().toLocaleDateString()}  
**Report Generated By:** HTTP Response Analyzer v2.1 - Using CSV sourcehost field for pairing  
**Data Volume:** ${totalHttpRecords.toLocaleString()} HTTP records processed

---

## Executive Summary

This report analyzes HTTP request/response pairs from a **${timeRangeDays.toFixed(1)}-day period** of production system activity using **sourcehost-based pairing**. The analysis reveals **${totalCompletePairs.toLocaleString()} complete request/response pairs** with an average response time of **${avgResponseTime.toFixed(2)}ms**${extremelySlowCount > 0 ? `, with ${extremelySlowCount} critical >5s response${extremelySlowCount > 1 ? 's' : ''} requiring immediate attention` : ', demonstrating excellent system performance'}.

### Key Metrics
- **Total HTTP records:** ${totalHttpRecords.toLocaleString()}
- **Complete pairs:** ${totalCompletePairs.toLocaleString()} (${successRate}% success rate)
- **Average response time:** ${avgResponseTime.toFixed(2)}ms
- **99th percentile:** ${p99}ms
- **System load:** ~${(totalHttpRecords / timeRangeSeconds).toFixed(2)} requests/second
- **Pairing method:** ID + sourcehost (from CSV column)
${extremelySlowCount > 0 ? `- **🚨 Critical responses (>5s):** ${extremelySlowCount}` : '- **🚨 Critical responses (>5s):** 0 ✅'}

---

## 1. Data Overview

### Timestamp Range (Filtered - 2024+ Only)
- **Start:** ${minTimestamp} (${new Date(minTimestamp).toISOString()})
- **End:** ${maxTimestamp} (${new Date(maxTimestamp).toISOString()})
- **Duration:** ${timeRangeDays.toFixed(1)} days (${timeRangeMs.toLocaleString()}ms)
- **Activity Rate:** ${(totalHttpRecords / timeRangeSeconds).toFixed(2)} HTTP operations/second

### Record Distribution
- **Complete request/response pairs:** ${totalCompletePairs.toLocaleString()}
- **Orphaned requests:** ${totalOrphanedRequests.toLocaleString()} (no matching response)
- **Orphaned responses:** ${totalOrphanedResponses.toLocaleString()} (no matching request)
- **Multiple occurrences:** ${totalMultipleOccurrences.toLocaleString()} IDs (duplicate logs filtered)
${extremelySlowCount > 0 ? `- **🚨 Extremely slow responses (>5s):** ${extremelySlowCount}` : '- **🚨 Extremely slow responses (>5s):** 0 ✅'}

---

## 2. Performance Analysis

### Response Time Statistics
| Metric | Value |
|--------|-------|
| Average | ${avgResponseTime.toFixed(2)}ms |
| Minimum | ${minResponseTime}ms |
| Maximum | ${maxResponseTime.toLocaleString()}ms |
| 50th percentile (median) | ${p50}ms |
| 90th percentile | ${p90}ms |
| 95th percentile | ${p95}ms |
| 99th percentile | ${p99}ms |

### Performance Distribution
| Category | Count | Percentage | Status |
|----------|-------|------------|---------|
| ✅ Sub-10ms responses | ${sub10msCount.toLocaleString()} | ${(sub10msCount / sampleCount * 100).toFixed(1)}% | Excellent |
| ⚠️ 10-100ms responses | ${ms10to100Count.toLocaleString()} | ${(ms10to100Count / sampleCount * 100).toFixed(1)}% | Acceptable |
| 🔴 100ms-5s responses | ${ms100to5sCount.toLocaleString()} | ${(ms100to5sCount / sampleCount * 100).toFixed(1)}% | Needs attention |
| 🚨 >5s responses | ${over5sCount.toLocaleString()} | ${(over5sCount / sampleCount * 100).toFixed(1)}% | ${over5sCount > 0 ? '**CRITICAL!**' : '✅ None'} |

### Performance by HTTP Method
| Method | Count | Avg Response Time | Performance |
|--------|-------|------------------|-------------|
${[...methodStats.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .map(([method, { count, totalResponseTime }]) => {
    const avg = totalResponseTime / count;
    const perf = avg < 5 ? '⭐ Excellent' : avg < 50 ? '⚠️ Acceptable' : '🔴 Needs optimization';
    return `| ${method} | ${count.toLocaleString()} | ${avg.toFixed(2)}ms | ${perf} |`;
  }).join('\n')}

### Performance by Status Code
| Status | Count | Avg Response Time | Description |
|--------|-------|------------------|-------------|
${[...statusStats.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 10)
  .map(([status, { count, totalResponseTime }]) => {
    const avg = totalResponseTime / count;
    const desc = status === 200 ? 'Success responses' :
                status === 201 ? 'Resource creation' :
                status === 204 ? 'Successful operations' :
                status === 404 ? 'Missing resources' :
                status === 429 ? 'Rate limiting' :
                status === 500 ? 'Server errors' : 'Other responses';
    return `| ${status} | ${count.toLocaleString()} | ${avg.toFixed(2)}ms | ${desc} |`;
  }).join('\n')}

---

## 3. Critical Performance Issues

${extremelySlowCount > 0 ? `### 🚨 Extremely Slow Responses (>5 Seconds)
**TOTAL: ${extremelySlowCount} response${extremelySlowCount > 1 ? 's' : ''}**

| ID | Epoch (ms) | Timestamp | Response Time | Status | Method | Endpoint | Issue Type |
|----|------------|-----------|---------------|--------|--------|----------|------------|
${extremelySlowResponses.map(r => {
  const timeSeconds = (r.responseTimeMs / 1000).toFixed(2);
  const statusStr = r.status || 'N/A';
  const issueType = r.url.includes('sitecore') ? '**Security Attack**' :
                   r.url.includes('allocate') ? '**Performance Issue**' :
                   r.responseTimeMs > 10000 ? '**System Issue**' : '**Optimization Needed**';
  const timestampStr = new Date(r.timestamp).toISOString();
  return `| ${r.id} | \`${r.timestamp}\` | \`${timestampStr}\` | **${timeSeconds}s** | ${statusStr} | ${r.method} | \`${r.url}\` | ${issueType} |`;
}).join('\n')}

` : '### ✅ No Critical >5s Responses Found\n\nExcellent! No responses exceeded 5 seconds during the analysis period.\n\n'}

### Top 10 Slowest Responses
| Rank | ID | Epoch (ms) | Timestamp | Response Time | Status | Method | Endpoint |
|------|----|-----------|-----------|--------------:|--------|--------|----------|
${slowestResponses.slice(0, 10).map((r, i) => {
  const statusStr = r.status || 'N/A';
  const shortUrl = r.url.length > 50 ? r.url.substring(0, 47) + '...' : r.url;
  const timestampStr = new Date(r.timestamp).toISOString();
  return `| ${i + 1} | ${r.id} | \`${r.timestamp}\` | \`${timestampStr}\` | ${r.responseTimeMs.toLocaleString()}ms | ${statusStr} | ${r.method} | \`${shortUrl}\` |`;
}).join('\n')}

---

## 4. System Health Analysis

### Orphaned Records Analysis
- **Total orphaned records:** ${totalOrphanedRequests + totalOrphanedResponses}
- **Orphaned requests:** ${totalOrphanedRequests} (requests without responses)
- **Orphaned responses:** ${totalOrphanedResponses} (responses without requests)
- **Success rate:** ${successRate}% (${totalCompletePairs.toLocaleString()} complete pairs out of ${(totalCompletePairs + totalOrphanedRequests + totalOrphanedResponses).toLocaleString()} total)

${orphanedEndpoints.size > 0 ? `### Top Orphaned Request Endpoints
| Endpoint | Count | Notes |
|----------|-------|-------|
${[...orphanedEndpoints.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([endpoint, count]) => {
    const notes = endpoint.includes('health') ? 'Health check endpoint' :
                 endpoint.includes('allocate') ? 'Subscription endpoint timeout' :
                 endpoint.includes('test') ? 'Test environment' :
                 endpoint.includes('session') ? 'Session management' : 'Unknown';
    return `| \`${endpoint}\` | ${count} | ${notes} |`;
  }).join('\n')}

${orphanedResponseEndpoints.size > 0 ? `### Top Orphaned Response Endpoints
| Endpoint | Count | Notes |
|----------|-------|-------|
${[...orphanedResponseEndpoints.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([endpoint, count]) => {
    const notes = endpoint.includes('health') ? 'Health check endpoint' :
                 endpoint.includes('allocate') ? 'Subscription endpoint' :
                 endpoint.includes('test') ? 'Test environment' :
                 endpoint.includes('session') ? 'Session management' : 'Unknown';
    return `| \`${endpoint}\` | ${count} | ${notes} |`;
  }).join('\n')}` : ''}` : '### ✅ Minimal Orphaned Records\n\nExcellent data quality with minimal orphaned records.'}

---

## 5. Performance Insights

### 🟢 Excellent Performance Indicators
1. **Outstanding response times** - ${(sub10msCount / sampleCount * 100).toFixed(1)}% under 10ms
2. **High success rate** - ${successRate}% of requests have matching responses
3. **Consistent logging** - Minimal gaps across ${timeRangeDays.toFixed(1)}-day period
4. **Strong 99th percentile** - ${p99}ms keeps most users satisfied
${extremelySlowCount === 0 ? '5. **No critical timeouts** - Zero responses exceeded 5 seconds' : ''}

### 🟡 Areas Requiring Attention
${[...methodStats.entries()]
  .filter(([_, { count, totalResponseTime }]) => totalResponseTime / count > 50)
  .slice(0, 3)
  .map(([method, { count, totalResponseTime }]) => 
    `1. **${method} operations** - ${(totalResponseTime / count).toFixed(2)}ms average needs optimization`
  ).join('\n')}
${statusStats.has(201) ? `1. **Resource creation overhead** - 201 status codes average ${(statusStats.get(201)!.totalResponseTime / statusStats.get(201)!.count).toFixed(2)}ms` : ''}

${extremelySlowCount > 0 ? `### 🔴 Critical Security/Performance Alerts
${extremelySlowResponses.slice(0, 3).map(r => {
  if (r.url.includes('sitecore')) return `1. **🚨 Security vulnerability scanning** - ${(r.responseTimeMs / 1000).toFixed(2)}s attack attempt (${r.status} response)`;
  if (r.url.includes('allocate')) return `1. **🔴 Subscription endpoint** - ${r.responseTimeMs}ms is unacceptable for production`;
  return `1. **🔴 Performance issue** - ${r.url} taking ${r.responseTimeMs}ms`;
}).join('\n')}` : '### ✅ No Critical Issues\n\nNo responses exceeded 5 seconds - excellent system health!'}

${orphanedRequestIds.length > 0 ? `### 🔍 Specific Orphaned Request IDs
**Total: ${orphanedRequestIds.length} orphaned requests**

| ID | Epoch (ms) | Timestamp | Method | Endpoint |
|----|------------|-----------|--------|----------|
${orphanedRequestIds.map(r => {
  const timestampStr = new Date(r.timestamp).toISOString();
  return `| \`${r.id}\` | \`${r.timestamp}\` | \`${timestampStr}\` | ${r.method} | \`${r.url.length > 45 ? r.url.substring(0, 42) + '...' : r.url}\` |`;
}).join('\n')}

` : ''}${orphanedResponseIds.length > 0 ? `### 🔍 Specific Orphaned Response IDs
**Total: ${orphanedResponseIds.length} orphaned responses**

| ID | Epoch (ms) | Timestamp | Status | Method | Endpoint |
|----|------------|-----------|--------|--------|----------|
${orphanedResponseIds.map(r => {
  const timestampStr = new Date(r.timestamp).toISOString();
  return `| \`${r.id}\` | \`${r.timestamp}\` | \`${timestampStr}\` | ${r.status || 'N/A'} | ${r.method} | \`${r.url.length > 40 ? r.url.substring(0, 37) + '...' : r.url}\` |`;
}).join('\n')}

` : ''}---

## 6. Recommendations

### Immediate Actions (Critical Priority)
${extremelySlowCount > 0 ? 
extremelySlowResponses.slice(0, 3).map(r => {
  if (r.url.includes('sitecore')) return `1. **🚨 SECURITY ALERT** - Implement WAF rules to block Sitecore vulnerability scans`;
  if (r.url.includes('allocate')) return `1. **🔴 Investigate allocate_subscribe** - ${r.responseTimeMs}ms is unacceptable for production`;
  return `1. **🔴 Investigate slow endpoint** - ${r.url} needs immediate attention`;
}).join('\n') :
'1. **✅ Maintain current performance** - System is performing excellently\n2. **🟡 Continue monitoring** - Set up alerts for any >5s responses'
}

### Performance Optimization (High Priority)
${[...methodStats.entries()]
  .filter(([_, { totalResponseTime, count }]) => totalResponseTime / count > 20)
  .slice(0, 3)
  .map(([method, { totalResponseTime, count }], i) => 
    `${i + 1}. **Optimize ${method} endpoints** - Focus on reducing ${(totalResponseTime / count).toFixed(2)}ms average`
  ).join('\n')}

### Monitoring Setup (Medium Priority)
1. **Response time alerts** - Monitor >100ms responses
2. **Security scanning detection** - Alert on vulnerability scan attempts
3. **Performance dashboards** - Track 4-tier performance categories
4. **Orphaned request tracking** - Alert if orphan rate exceeds 1%

---

## 7. Technical Achievements

### Data Processing Scale
- **${totalHttpRecords.toLocaleString()}+ HTTP records** processed successfully
- **Memory-efficient streaming** - No out-of-memory issues during analysis
- **Timestamp validation** - Filtered out corrupt records (pre-2024)
- **Multi-format support** - Handled both CSV and gzipped chunk files

### Analysis Quality
- **${successRate}% data integrity** - Minimal orphaned records
- **Critical outlier detection** - >5s response identification
- **Production-grade metrics** - Enterprise monitoring capabilities
- **Comprehensive reporting** - Automated markdown generation

---

## 8. Monitoring Setup

### Recommended Alerts
1. **🚨 Critical (>5s)** - Immediate escalation
2. **🔴 Slow (100ms-5s)** - Operations team notification  
3. **⚠️ Elevated (10-100ms)** - Trend monitoring
4. **📊 Orphan rate >1%** - Data integrity alert

### Performance SLAs
- **${(sub10msCount / sampleCount * 100).toFixed(0)}% of requests** currently complete under 10ms
- **${((sub10msCount + ms10to100Count) / sampleCount * 100).toFixed(0)}% of requests** currently complete under 100ms
- **${((sampleCount - over5sCount) / sampleCount * 100).toFixed(1)}% of requests** currently complete under 5s
- **Zero tolerance** for >5s responses (except during attacks)

---

## 9. Conclusion

The system demonstrates **${sub10msCount / sampleCount > 0.7 ? 'exceptional' : 'good'}** performance with ${(sub10msCount / sampleCount * 100).toFixed(1)}% of responses under 10ms and a ${successRate}% success rate across **${totalCompletePairs.toLocaleString()} transactions**.

${extremelySlowCount > 0 ? 
`**Critical attention needed:** ${extremelySlowCount} response${extremelySlowCount > 1 ? 's' : ''} exceeded 5 seconds, indicating potential security threats or performance bottlenecks.` :
'**Excellent system health:** No responses exceeded 5 seconds during the entire analysis period.'}

**Next steps:** ${extremelySlowCount > 0 ? 
'Address critical security/performance issues, implement enhanced monitoring, and optimize the slowest endpoints.' :
'Maintain current performance levels, implement proactive monitoring, and continue optimizing the slowest percentile of transactions.'}

---

*Report generated automatically by HTTP Response Analyzer v2.1 - ${new Date().toISOString()}*
`;

  await Deno.writeTextFile(reportPath, report);
  console.log(`\n📊 Comprehensive markdown report generated: ${reportPath}`);
}

async function processBucketFile(bucketFile: string, bucketIndex: number): Promise<{
  completePairs: number;
  orphanedRequests: number;
  orphanedResponses: number;
  multipleOccurrences: number;
  responseStats: {
    totalResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    responseTimes: number[];
    methodStats: Map<string, { count: number; totalResponseTime: number }>;
    statusStats: Map<number, { count: number; totalResponseTime: number }>;
    performanceBuckets: { sub10ms: number; ms10to100: number; ms100to5s: number; over5s: number };
  };
  orphanedDetails: {
    orphanedRequestRecords: Array<{ id: string; method: string; url: string; timestamp: number }>;
    orphanedResponseRecords: Array<{ id: string; status: number | undefined; method: string; url: string; timestamp: number }>;
    orphanedRequestEndpoints: Map<string, number>;
    orphanedResponseEndpoints: Map<string, number>;
    slowestResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>;
    fastestResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>;
    extremelySlowResponses: Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>;
  };
}> {
  console.log(`  Processing bucket ${bucketIndex}...`);
  
  let bucketContent: string;
  try {
    bucketContent = await Deno.readTextFile(bucketFile);
  } catch (error) {
    // Bucket file doesn't exist (empty bucket)
    return {
      completePairs: 0,
      orphanedRequests: 0,
      orphanedResponses: 0,
      multipleOccurrences: 0,
      responseStats: {
        totalResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        responseTimes: [],
        methodStats: new Map(),
        statusStats: new Map(),
        performanceBuckets: { sub10ms: 0, ms10to100: 0, ms100to5s: 0, over5s: 0 }
      },
      orphanedDetails: {
        orphanedRequestRecords: [],
        orphanedResponseRecords: [],
        orphanedRequestEndpoints: new Map(),
        orphanedResponseEndpoints: new Map(),
        slowestResponses: [],
        fastestResponses: [],
        extremelySlowResponses: []
      }
    };
  }
  
  const lines = bucketContent.trim().split('\n').filter(line => line.trim());
  console.log(`    Bucket ${bucketIndex}: ${lines.length} records to process`);
  
  // Simple streaming approach - group by composite key
  const recordsByKey = new Map<string, BucketRecord[]>();
  
  // Parse all records first
  for (let i = 0; i < lines.length; i++) {
    try {
      const record: BucketRecord = JSON.parse(lines[i]);
      const compositeKey = `${record.id}:${record.host}`;
      
      if (!recordsByKey.has(compositeKey)) {
        recordsByKey.set(compositeKey, []);
      }
      recordsByKey.get(compositeKey)!.push(record);
    } catch (error) {
      // Skip malformed JSON lines
      continue;
    }
    
    // Progress indicator for large buckets
    if (i % 100000 === 0 && i > 0) {
      console.log(`      Parsed ${i.toLocaleString()}/${lines.length.toLocaleString()} records...`);
    }
  }
  
  let completePairs = 0;
  let orphanedRequests = 0;
  let orphanedResponses = 0;
  let multipleOccurrences = 0;
  
  const responseStats = {
    totalResponseTime: 0,
    minResponseTime: Infinity,
    maxResponseTime: 0,
    responseTimes: [] as number[],
    methodStats: new Map<string, { count: number; totalResponseTime: number }>(),
    statusStats: new Map<number, { count: number; totalResponseTime: number }>(),
    performanceBuckets: { sub10ms: 0, ms10to100: 0, ms100to5s: 0, over5s: 0 }
  };
  
  const orphanedDetails = {
    orphanedRequestRecords: [] as Array<{ id: string; method: string; url: string; timestamp: number }>,
    orphanedResponseRecords: [] as Array<{ id: string; status: number | undefined; method: string; url: string; timestamp: number }>,
    orphanedRequestEndpoints: new Map<string, number>(),
    orphanedResponseEndpoints: new Map<string, number>(),
    slowestResponses: [] as Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>,
    fastestResponses: [] as Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>,
    extremelySlowResponses: [] as Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>
  };
  
  // Process each composite key
  let processedKeys = 0;
  for (const [compositeKey, records] of recordsByKey.entries()) {
    if (records.length === 2) {
      records.sort((a, b) => a.timestamp - b.timestamp);
      const request = records.find(r => r.type === 'REQUEST');
      const response = records.find(r => r.type === 'WRITEHEAD');
      
      if (request && response && response.responseTimeMs !== undefined) {
        const lagMs = response.timestamp - request.timestamp;
        
        if (lagMs > 5000) {
          // >5s lag - treat as orphaned
          orphanedRequests++;
          orphanedResponses++;
          
          // Track orphaned request details
          orphanedDetails.orphanedRequestRecords.push({
            id: request.id,
            method: request.method,
            url: request.url,
            timestamp: request.timestamp
          });
          
          // Track orphaned response details
          orphanedDetails.orphanedResponseRecords.push({
            id: response.id,
            status: response.statusCode,
            method: response.method,
            url: response.url,
            timestamp: response.timestamp
          });
          
          // Update endpoint counters
          orphanedDetails.orphanedRequestEndpoints.set(request.url, (orphanedDetails.orphanedRequestEndpoints.get(request.url) || 0) + 1);
          orphanedDetails.orphanedResponseEndpoints.set(response.url, (orphanedDetails.orphanedResponseEndpoints.get(response.url) || 0) + 1);
        } else {
          // Valid pair
          completePairs++;
          const responseTime = response.responseTimeMs;
          
          // Update response statistics
          responseStats.totalResponseTime += responseTime;
          responseStats.minResponseTime = Math.min(responseStats.minResponseTime, responseTime);
          responseStats.maxResponseTime = Math.max(responseStats.maxResponseTime, responseTime);
          
          // Sample response times to avoid memory issues (max 5K per bucket)
          if (responseStats.responseTimes.length < 5000) {
            responseStats.responseTimes.push(responseTime);
          }
          
          // Performance buckets
          if (responseTime < 10) responseStats.performanceBuckets.sub10ms++;
          else if (responseTime < 100) responseStats.performanceBuckets.ms10to100++;
          else if (responseTime < 5000) responseStats.performanceBuckets.ms100to5s++;
          else responseStats.performanceBuckets.over5s++;
          
          // Track extremely slow responses (>5 seconds)
          if (responseTime > 5000) {
            orphanedDetails.extremelySlowResponses.push({
              id: response.id,
              responseTimeMs: responseTime,
              status: response.statusCode,
              method: response.method,
              url: response.url,
              timestamp: response.timestamp
            });
          }
          
          // Track slowest responses (keep top 10 per bucket)
          if (orphanedDetails.slowestResponses.length < 10) {
            orphanedDetails.slowestResponses.push({
              id: response.id,
              responseTimeMs: responseTime,
              status: response.statusCode,
              method: response.method,
              url: response.url,
              timestamp: response.timestamp
            });
          } else {
            orphanedDetails.slowestResponses.sort((a, b) => b.responseTimeMs - a.responseTimeMs);
            if (responseTime > orphanedDetails.slowestResponses[9].responseTimeMs) {
              orphanedDetails.slowestResponses[9] = {
                id: response.id,
                responseTimeMs: responseTime,
                status: response.statusCode,
                method: response.method,
                url: response.url,
                timestamp: response.timestamp
              };
            }
          }
          
          // Track fastest responses (keep top 10 per bucket)
          if (orphanedDetails.fastestResponses.length < 10) {
            orphanedDetails.fastestResponses.push({
              id: response.id,
              responseTimeMs: responseTime,
              status: response.statusCode,
              method: response.method,
              url: response.url,
              timestamp: response.timestamp
            });
          } else {
            orphanedDetails.fastestResponses.sort((a, b) => a.responseTimeMs - b.responseTimeMs);
            if (responseTime < orphanedDetails.fastestResponses[9].responseTimeMs) {
              orphanedDetails.fastestResponses[9] = {
                id: response.id,
                responseTimeMs: responseTime,
                status: response.statusCode,
                method: response.method,
                url: response.url,
                timestamp: response.timestamp
              };
            }
          }
          
          // Method stats
          const method = response.method;
          if (!responseStats.methodStats.has(method)) {
            responseStats.methodStats.set(method, { count: 0, totalResponseTime: 0 });
          }
          const mStats = responseStats.methodStats.get(method)!;
          mStats.count++;
          mStats.totalResponseTime += responseTime;
          
          // Status stats
          const status = response.statusCode || 0;
          if (!responseStats.statusStats.has(status)) {
            responseStats.statusStats.set(status, { count: 0, totalResponseTime: 0 });
          }
          const sStats = responseStats.statusStats.get(status)!;
          sStats.count++;
          sStats.totalResponseTime += responseTime;
        }
      } else {
        orphanedRequests++;
        orphanedResponses++;
        
        // Track orphaned records
        for (const record of records) {
          if (record.type === 'REQUEST') {
            orphanedDetails.orphanedRequestRecords.push({
              id: record.id,
              method: record.method,
              url: record.url,
              timestamp: record.timestamp
            });
            orphanedDetails.orphanedRequestEndpoints.set(record.url, (orphanedDetails.orphanedRequestEndpoints.get(record.url) || 0) + 1);
          } else {
            orphanedDetails.orphanedResponseRecords.push({
              id: record.id,
              status: record.statusCode,
              method: record.method,
              url: record.url,
              timestamp: record.timestamp
            });
            orphanedDetails.orphanedResponseEndpoints.set(record.url, (orphanedDetails.orphanedResponseEndpoints.get(record.url) || 0) + 1);
          }
        }
      }
    } else if (records.length === 1) {
      const record = records[0];
      if (record.type === 'REQUEST') {
        orphanedRequests++;
        orphanedDetails.orphanedRequestRecords.push({
          id: record.id,
          method: record.method,
          url: record.url,
          timestamp: record.timestamp
        });
        orphanedDetails.orphanedRequestEndpoints.set(record.url, (orphanedDetails.orphanedRequestEndpoints.get(record.url) || 0) + 1);
      } else {
        orphanedResponses++;
        orphanedDetails.orphanedResponseRecords.push({
          id: record.id,
          status: record.statusCode,
          method: record.method,
          url: record.url,
          timestamp: record.timestamp
        });
        orphanedDetails.orphanedResponseEndpoints.set(record.url, (orphanedDetails.orphanedResponseEndpoints.get(record.url) || 0) + 1);
      }
    } else {
      multipleOccurrences++;
    }
    
    processedKeys++;
    if (processedKeys % 50000 === 0) {
      console.log(`      Processed ${processedKeys.toLocaleString()}/${recordsByKey.size.toLocaleString()} composite keys...`);
    }
  }
  
  console.log(`    Bucket ${bucketIndex}: ${completePairs} pairs, ${orphanedRequests} orphaned requests, ${orphanedResponses} orphaned responses`);
  
  return {
    completePairs,
    orphanedRequests,
    orphanedResponses,
    multipleOccurrences,
    responseStats,
    orphanedDetails
  };
}

async function analyzeHttpResponsesWithBucketing(inputPath: string, startChunk?: number, endChunk?: number) {
  console.log(`🪣 BUCKETING MODE: Analyzing HTTP request/response pairs from: ${inputPath}`);
  
  // Phase 1: Create workspace and buckets
  const config = await createWorkspace();
  console.log(`📁 Using ${config.numBuckets} buckets for processing (better distribution for large datasets)`);
  
  try {
    // Check if input is a single file or directory pattern
    if (inputPath.includes('sumo-chunk-') || inputPath === '/data' || inputPath.endsWith('/')) {
      // Process multiple chunk files
      const directory = inputPath === '/data' || inputPath.endsWith('/') ? inputPath.replace(/\/$/, '') : '/data';
      const chunkFiles = await findChunkFiles(directory);
      
      if (chunkFiles.length === 0) {
        console.error(`No chunk files found in ${directory}`);
        Deno.exit(1);
      }
      
      // Apply chunk range filtering if specified
      let processChunks = chunkFiles;
      if (startChunk && endChunk) {
        const startIndex = startChunk - 1;
        const endIndex = Math.min(endChunk, chunkFiles.length);
        processChunks = chunkFiles.slice(startIndex, endIndex);
        console.log(`📦 BATCH MODE: Processing ${processChunks.length} chunks (${startChunk}-${Math.min(endChunk, chunkFiles.length)})`);
      }
      
      console.log(`Found ${processChunks.length} chunk files to process into buckets`);
      console.log("=".repeat(100));
      
      // Phase 1: Process chunks and write to buckets
      let totalRecordsProcessed = 0;
      for (let i = 0; i < processChunks.length; i++) {
        const actualChunkNumber = startChunk ? startChunk + i : i + 1;
        console.log(`📥 Processing chunk ${actualChunkNumber}: ${processChunks[i].split('/').pop()}`);
        
        // Read and process chunk
        let csvContent: string;
        if (processChunks[i].endsWith('.gz')) {
          csvContent = await decompressGzFile(processChunks[i]);
        } else {
          csvContent = await Deno.readTextFile(processChunks[i]);
        }
        
        const lines = csvContent.split('\n');
        const dataLines = lines.slice(1).filter(line => line.trim() !== '');
        
        // Timestamp validation
        const validTimestampThreshold = new Date('2024-01-01').getTime();
        let validRecords = 0;
        
        // Process each line and write to appropriate bucket
        for (let lineIndex = 0; lineIndex < dataLines.length; lineIndex++) {
          const line = dataLines[lineIndex];
          
          if (line.includes('http-response-time-logger.js') && 
              (line.includes('[HttpResponseTimeLogger] REQUEST:') || 
               line.includes('[HttpResponseTimeLogger] WRITEHEAD:'))) {
            
            // Parse CSV to extract sourcehost field
            // CSV format: "messagetime","receipttime","raw","sourcehost","sourcecategory",...
            const csvFields = line.split('","');
            let sourcehost = 'unknown';
            
            if (csvFields.length >= 4) {
              // sourcehost is the 4th field (index 3)
              sourcehost = csvFields[3].replace(/^"/, '').replace(/"$/, ''); // Remove quotes
            }
            
            // Extract the log message part from the raw field (3rd field, index 2)
            const rawField = csvFields.length >= 3 ? csvFields[2] : line;
            const logMatch = rawField.match(/\[HttpResponseTimeLogger\] (REQUEST|WRITEHEAD): (.+)/);
            if (!logMatch) continue;
            
            const type = logMatch[1] as 'REQUEST' | 'WRITEHEAD';
            const logContent = logMatch[2];
            
            const idMatch = logContent.match(/id=(\d+)/);
            if (!idMatch) continue;
            const id = idMatch[1];
            
            const startMatch = logContent.match(/start=(\d+)/);
            if (!startMatch) continue;
            const timestamp = parseInt(startMatch[1]);
            
            if (timestamp < validTimestampThreshold) continue;
            
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
            
            const bucketRecord: BucketRecord = {
              id,
              timestamp,
              type,
              method,
              url,
              host: sourcehost, // Use sourcehost from CSV instead of extracting from URL
              statusCode,
              responseTimeMs,
              lineNumber: lineIndex + 2,
              rawLine: line
            };
            
            await writeToBucket(bucketRecord, config);
            validRecords++;
          }
        }
        
        totalRecordsProcessed += validRecords;
        console.log(`  ✅ Chunk ${actualChunkNumber}: ${validRecords} records → buckets`);
      }
      
      console.log(`\n📊 Phase 1 Complete: ${totalRecordsProcessed.toLocaleString()} records written to ${config.numBuckets} buckets`);
      
      // Phase 2: Process each bucket
      console.log("\n" + "=".repeat(100));
      console.log("📊 Phase 2: Processing buckets...");
      console.log("=".repeat(100));
      
      let totalCompletePairs = 0;
      let totalOrphanedRequests = 0;
      let totalOrphanedResponses = 0;
      let totalMultipleOccurrences = 0;
      
      let minTimestamp = Infinity;
      let maxTimestamp = 0;
      
      const aggregatedStats = {
        totalResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        responseTimes: [] as number[],
        methodStats: new Map<string, { count: number; totalResponseTime: number }>(),
        statusStats: new Map<number, { count: number; totalResponseTime: number }>(),
        performanceBuckets: { sub10ms: 0, ms10to100: 0, ms100to5s: 0, over5s: 0 }
      };
      
      const aggregatedOrphanedDetails = {
        orphanedRequestRecords: [] as Array<{ id: string; method: string; url: string; timestamp: number }>,
        orphanedResponseRecords: [] as Array<{ id: string; status: number | undefined; method: string; url: string; timestamp: number }>,
        orphanedRequestEndpoints: new Map<string, number>(),
        orphanedResponseEndpoints: new Map<string, number>(),
        slowestResponses: [] as Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>,
        fastestResponses: [] as Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>,
        extremelySlowResponses: [] as Array<{ id: string; responseTimeMs: number; status: number | undefined; method: string; url: string; timestamp: number }>
      };
      
      for (let bucketIndex = 0; bucketIndex < config.numBuckets; bucketIndex++) {
        const bucketFile = `${config.bucketsDir}/bucket_${bucketIndex.toString().padStart(3, '0')}.jsonl`;
        const bucketResults = await processBucketFile(bucketFile, bucketIndex);
        
        // Aggregate results
        totalCompletePairs += bucketResults.completePairs;
        totalOrphanedRequests += bucketResults.orphanedRequests;
        totalOrphanedResponses += bucketResults.orphanedResponses;
        totalMultipleOccurrences += bucketResults.multipleOccurrences;
        
        // Merge response statistics
        const stats = bucketResults.responseStats;
        aggregatedStats.totalResponseTime += stats.totalResponseTime;
        aggregatedStats.minResponseTime = Math.min(aggregatedStats.minResponseTime, stats.minResponseTime);
        aggregatedStats.maxResponseTime = Math.max(aggregatedStats.maxResponseTime, stats.maxResponseTime);
        aggregatedStats.responseTimes.push(...stats.responseTimes);
        
        // Merge performance buckets
        aggregatedStats.performanceBuckets.sub10ms += stats.performanceBuckets.sub10ms;
        aggregatedStats.performanceBuckets.ms10to100 += stats.performanceBuckets.ms10to100;
        aggregatedStats.performanceBuckets.ms100to5s += stats.performanceBuckets.ms100to5s;
        aggregatedStats.performanceBuckets.over5s += stats.performanceBuckets.over5s;
        
        // Merge method stats
        for (const [method, methodData] of stats.methodStats.entries()) {
          if (!aggregatedStats.methodStats.has(method)) {
            aggregatedStats.methodStats.set(method, { count: 0, totalResponseTime: 0 });
          }
          const aggMethod = aggregatedStats.methodStats.get(method)!;
          aggMethod.count += methodData.count;
          aggMethod.totalResponseTime += methodData.totalResponseTime;
        }
        
        // Merge status stats
        for (const [status, statusData] of stats.statusStats.entries()) {
          if (!aggregatedStats.statusStats.has(status)) {
            aggregatedStats.statusStats.set(status, { count: 0, totalResponseTime: 0 });
          }
          const aggStatus = aggregatedStats.statusStats.get(status)!;
          aggStatus.count += statusData.count;
          aggStatus.totalResponseTime += statusData.totalResponseTime;
        }
        
        // Merge orphaned details
        const orphanedDetails = bucketResults.orphanedDetails;
        
        // Merge orphaned request records (collect all records now that we export to CSV)
        aggregatedOrphanedDetails.orphanedRequestRecords.push(...orphanedDetails.orphanedRequestRecords);
        
        // Merge orphaned response records (collect all records now that we export to CSV)
        aggregatedOrphanedDetails.orphanedResponseRecords.push(...orphanedDetails.orphanedResponseRecords);
        
        // Merge orphaned request endpoints
        for (const [endpoint, count] of orphanedDetails.orphanedRequestEndpoints.entries()) {
          aggregatedOrphanedDetails.orphanedRequestEndpoints.set(endpoint, (aggregatedOrphanedDetails.orphanedRequestEndpoints.get(endpoint) || 0) + count);
        }
        
        // Merge orphaned response endpoints
        for (const [endpoint, count] of orphanedDetails.orphanedResponseEndpoints.entries()) {
          aggregatedOrphanedDetails.orphanedResponseEndpoints.set(endpoint, (aggregatedOrphanedDetails.orphanedResponseEndpoints.get(endpoint) || 0) + count);
        }
        
        // Merge slowest responses
        aggregatedOrphanedDetails.slowestResponses.push(...orphanedDetails.slowestResponses);
        
        // Merge fastest responses
        aggregatedOrphanedDetails.fastestResponses.push(...orphanedDetails.fastestResponses);
        
        // Merge extremely slow responses
        aggregatedOrphanedDetails.extremelySlowResponses.push(...orphanedDetails.extremelySlowResponses);
        
        // Update timestamp range
        if (orphanedDetails.slowestResponses.length > 0) {
          const timestamps = orphanedDetails.slowestResponses.map(r => r.timestamp);
          minTimestamp = Math.min(minTimestamp, Math.min(...timestamps));
          maxTimestamp = Math.max(maxTimestamp, Math.max(...timestamps));
        }
        
        // Also track timestamps from orphaned records
        if (orphanedDetails.orphanedRequestRecords.length > 0) {
          const timestamps = orphanedDetails.orphanedRequestRecords.map(r => r.timestamp);
          minTimestamp = Math.min(minTimestamp, Math.min(...timestamps));
          maxTimestamp = Math.max(maxTimestamp, Math.max(...timestamps));
        }
        
        if (orphanedDetails.orphanedResponseRecords.length > 0) {
          const timestamps = orphanedDetails.orphanedResponseRecords.map(r => r.timestamp);
          minTimestamp = Math.min(minTimestamp, Math.min(...timestamps));
          maxTimestamp = Math.max(maxTimestamp, Math.max(...timestamps));
        }
      }
      
      // Sort and limit final collections
      aggregatedOrphanedDetails.slowestResponses.sort((a, b) => b.responseTimeMs - a.responseTimeMs);
      aggregatedOrphanedDetails.slowestResponses = aggregatedOrphanedDetails.slowestResponses.slice(0, 20);
      
      aggregatedOrphanedDetails.fastestResponses.sort((a, b) => a.responseTimeMs - b.responseTimeMs);
      aggregatedOrphanedDetails.fastestResponses = aggregatedOrphanedDetails.fastestResponses.slice(0, 20);
      
      aggregatedOrphanedDetails.extremelySlowResponses.sort((a, b) => b.responseTimeMs - a.responseTimeMs);
      
      // Export comprehensive CSV files to workspace
      console.log("\n📄 Exporting comprehensive CSV reports...");
      
      // Deduplicate all records before CSV export using composite keys
      console.log("  🔄 Deduplicating records...");
      
      // Deduplicate orphaned requests
      const uniqueOrphanedRequests = Array.from(
        new Map(aggregatedOrphanedDetails.orphanedRequestRecords.map(r => 
          [`${r.id}:${r.timestamp}`, r]
        )).values()
      );
      console.log(`    Orphaned requests: ${aggregatedOrphanedDetails.orphanedRequestRecords.length} → ${uniqueOrphanedRequests.length} (removed ${aggregatedOrphanedDetails.orphanedRequestRecords.length - uniqueOrphanedRequests.length} duplicates)`);
      
      // Deduplicate orphaned responses
      const uniqueOrphanedResponses = Array.from(
        new Map(aggregatedOrphanedDetails.orphanedResponseRecords.map(r => 
          [`${r.id}:${r.timestamp}`, r]
        )).values()
      );
      console.log(`    Orphaned responses: ${aggregatedOrphanedDetails.orphanedResponseRecords.length} → ${uniqueOrphanedResponses.length} (removed ${aggregatedOrphanedDetails.orphanedResponseRecords.length - uniqueOrphanedResponses.length} duplicates)`);
      
      // Deduplicate extremely slow responses
      const uniqueExtremelySlowResponses = Array.from(
        new Map(aggregatedOrphanedDetails.extremelySlowResponses.map(r => 
          [`${r.id}:${r.timestamp}`, r]
        )).values()
      );
      console.log(`    Extremely slow responses: ${aggregatedOrphanedDetails.extremelySlowResponses.length} → ${uniqueExtremelySlowResponses.length} (removed ${aggregatedOrphanedDetails.extremelySlowResponses.length - uniqueExtremelySlowResponses.length} duplicates)`);
      
      // Deduplicate slowest responses
      const uniqueSlowestResponses = Array.from(
        new Map(aggregatedOrphanedDetails.slowestResponses.map(r => 
          [`${r.id}:${r.timestamp}`, r]
        )).values()
      );
      console.log(`    Slowest responses: ${aggregatedOrphanedDetails.slowestResponses.length} → ${uniqueSlowestResponses.length} (removed ${aggregatedOrphanedDetails.slowestResponses.length - uniqueSlowestResponses.length} duplicates)`);
      
      // Deduplicate fastest responses
      const uniqueFastestResponses = Array.from(
        new Map(aggregatedOrphanedDetails.fastestResponses.map(r => 
          [`${r.id}:${r.timestamp}`, r]
        )).values()
      );
      console.log(`    Fastest responses: ${aggregatedOrphanedDetails.fastestResponses.length} → ${uniqueFastestResponses.length} (removed ${aggregatedOrphanedDetails.fastestResponses.length - uniqueFastestResponses.length} duplicates)`);
      
      // Export all orphaned requests
      if (uniqueOrphanedRequests.length > 0) {
        const orphanedRequestsCsv = [
          'ID,Epoch_ms,Timestamp,Method,Endpoint',
          ...uniqueOrphanedRequests.map(r => 
            `${r.id},${r.timestamp},${new Date(r.timestamp).toISOString()},${r.method},"${r.url.replace(/"/g, '""')}"`)
        ].join('\n');
        await Deno.writeTextFile(`${config.workspaceDir}/orphaned_requests.csv`, orphanedRequestsCsv);
        console.log(`  ✅ orphaned_requests.csv: ${uniqueOrphanedRequests.length} deduplicated records`);
      }
      
      // Export all orphaned responses  
      if (uniqueOrphanedResponses.length > 0) {
        const orphanedResponsesCsv = [
          'ID,Epoch_ms,Timestamp,Status,Method,Endpoint',
          ...uniqueOrphanedResponses.map(r => 
            `${r.id},${r.timestamp},${new Date(r.timestamp).toISOString()},${r.status || 'N/A'},${r.method},"${r.url.replace(/"/g, '""')}"`)
        ].join('\n');
        await Deno.writeTextFile(`${config.workspaceDir}/orphaned_responses.csv`, orphanedResponsesCsv);
        console.log(`  ✅ orphaned_responses.csv: ${uniqueOrphanedResponses.length} deduplicated records`);
      }
      
      // Export orphaned request endpoints summary
      if (aggregatedOrphanedDetails.orphanedRequestEndpoints.size > 0) {
        const orphanedRequestEndpointsCsv = [
          'Endpoint,Count',
          ...[...aggregatedOrphanedDetails.orphanedRequestEndpoints.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([endpoint, count]) => `"${endpoint.replace(/"/g, '""')}",${count}`)
        ].join('\n');
        await Deno.writeTextFile(`${config.workspaceDir}/orphaned_request_endpoints.csv`, orphanedRequestEndpointsCsv);
        console.log(`  ✅ orphaned_request_endpoints.csv: ${aggregatedOrphanedDetails.orphanedRequestEndpoints.size} endpoints`);
      }
      
      // Export orphaned response endpoints summary
      if (aggregatedOrphanedDetails.orphanedResponseEndpoints.size > 0) {
        const orphanedResponseEndpointsCsv = [
          'Endpoint,Count',
          ...[...aggregatedOrphanedDetails.orphanedResponseEndpoints.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([endpoint, count]) => `"${endpoint.replace(/"/g, '""')}",${count}`)
        ].join('\n');
        await Deno.writeTextFile(`${config.workspaceDir}/orphaned_response_endpoints.csv`, orphanedResponseEndpointsCsv);
        console.log(`  ✅ orphaned_response_endpoints.csv: ${aggregatedOrphanedDetails.orphanedResponseEndpoints.size} endpoints`);
      }
      
      // Export extremely slow responses
      if (uniqueExtremelySlowResponses.length > 0) {
        const extremelySlowCsv = [
          'ID,Epoch_ms,Timestamp,ResponseTimeMs,Status,Method,Endpoint',
          ...uniqueExtremelySlowResponses.map(r => 
            `${r.id},${r.timestamp},${new Date(r.timestamp).toISOString()},${r.responseTimeMs},${r.status || 'N/A'},${r.method},"${r.url.replace(/"/g, '""')}"`)
        ].join('\n');
        await Deno.writeTextFile(`${config.workspaceDir}/extremely_slow_responses.csv`, extremelySlowCsv);
        console.log(`  ✅ extremely_slow_responses.csv: ${uniqueExtremelySlowResponses.length} deduplicated records`);
      }
      
      // Export all slowest/fastest responses for analysis
      if (uniqueSlowestResponses.length > 0) {
        const slowestCsv = [
          'ID,Epoch_ms,Timestamp,ResponseTimeMs,Status,Method,Endpoint',
          ...uniqueSlowestResponses.map(r => 
            `${r.id},${r.timestamp},${new Date(r.timestamp).toISOString()},${r.responseTimeMs},${r.status || 'N/A'},${r.method},"${r.url.replace(/"/g, '""')}"`)
        ].join('\n');
        await Deno.writeTextFile(`${config.workspaceDir}/slowest_responses.csv`, slowestCsv);
        console.log(`  ✅ slowest_responses.csv: ${uniqueSlowestResponses.length} deduplicated records`);
      }
      
      if (uniqueFastestResponses.length > 0) {
        const fastestCsv = [
          'ID,Epoch_ms,Timestamp,ResponseTimeMs,Status,Method,Endpoint',
          ...uniqueFastestResponses.map(r => 
            `${r.id},${r.timestamp},${new Date(r.timestamp).toISOString()},${r.responseTimeMs},${r.status || 'N/A'},${r.method},"${r.url.replace(/"/g, '""')}"`)
        ].join('\n');
        await Deno.writeTextFile(`${config.workspaceDir}/fastest_responses.csv`, fastestCsv);
        console.log(`  ✅ fastest_responses.csv: ${uniqueFastestResponses.length} deduplicated records`);
      }
      
      // Phase 3: Generate final report
      console.log("\n" + "=".repeat(100));
      console.log("📊 FINAL ANALYSIS RESULTS (BUCKETED)");
      console.log("=".repeat(100));
      
      console.log(`\nTotal HTTP records processed: ${totalRecordsProcessed.toLocaleString()}`);
      console.log(`Complete request/response pairs: ${totalCompletePairs.toLocaleString()}`);
      console.log(`Orphaned requests (no response): ${totalOrphanedRequests.toLocaleString()}`);
      console.log(`Orphaned responses (no request): ${totalOrphanedResponses.toLocaleString()}`);
      console.log(`IDs with multiple occurrences: ${totalMultipleOccurrences.toLocaleString()}`);
      console.log(`🚨 Extremely slow responses (>5s): ${aggregatedStats.performanceBuckets.over5s.toLocaleString()}`);
      
      // Response time statistics
      if (aggregatedStats.responseTimes.length > 0) {
        aggregatedStats.responseTimes.sort((a, b) => a - b);
        const avgResponseTime = aggregatedStats.totalResponseTime / aggregatedStats.responseTimes.length;
        
        const p50 = aggregatedStats.responseTimes[Math.floor(aggregatedStats.responseTimes.length * 0.5)];
        const p90 = aggregatedStats.responseTimes[Math.floor(aggregatedStats.responseTimes.length * 0.9)];
        const p95 = aggregatedStats.responseTimes[Math.floor(aggregatedStats.responseTimes.length * 0.95)];
        const p99 = aggregatedStats.responseTimes[Math.floor(aggregatedStats.responseTimes.length * 0.99)];
        
        console.log("\n" + "-".repeat(100));
        console.log("RESPONSE TIME STATISTICS:");
        console.log("-".repeat(100));
        console.log(`Sample size: ${aggregatedStats.responseTimes.length.toLocaleString()}`);
        console.log(`Average response time: ${avgResponseTime.toFixed(2)}ms`);
        console.log(`Min response time: ${aggregatedStats.minResponseTime}ms`);
        console.log(`Max response time: ${aggregatedStats.maxResponseTime.toLocaleString()}ms`);
        console.log(`50th percentile (median): ${p50}ms`);
        console.log(`90th percentile: ${p90}ms`);
        console.log(`95th percentile: ${p95}ms`);
        console.log(`99th percentile: ${p99}ms`);
        
        const totalResponses = aggregatedStats.responseTimes.length;
        console.log(`\nPERFORMANCE SUMMARY:`);
        console.log(`✅ Sub-10ms responses: ${aggregatedStats.performanceBuckets.sub10ms.toLocaleString()} (${(aggregatedStats.performanceBuckets.sub10ms / totalResponses * 100).toFixed(1)}%)`);
        console.log(`⚠️  10-100ms responses: ${aggregatedStats.performanceBuckets.ms10to100.toLocaleString()} (${(aggregatedStats.performanceBuckets.ms10to100 / totalResponses * 100).toFixed(1)}%)`);
        console.log(`🔴 100ms-5s responses: ${aggregatedStats.performanceBuckets.ms100to5s.toLocaleString()} (${(aggregatedStats.performanceBuckets.ms100to5s / totalResponses * 100).toFixed(1)}%)`);
        console.log(`🚨 >5s responses: ${aggregatedStats.performanceBuckets.over5s.toLocaleString()} (${(aggregatedStats.performanceBuckets.over5s / totalResponses * 100).toFixed(1)}%) ${aggregatedStats.performanceBuckets.over5s > 0 ? '- CRITICAL!' : '✅'}`);
      }
      
      // Method breakdown
      if (aggregatedStats.methodStats.size > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("RESPONSE TIME BY HTTP METHOD:");
        console.log("-".repeat(100));
        console.log("Method\t\tCount\t\t\tAvg Response Time");
        console.log("-".repeat(100));
        
        for (const [method, { count, totalResponseTime }] of [...aggregatedStats.methodStats.entries()].sort((a, b) => b[1].count - a[1].count)) {
          const avgResponseTime = totalResponseTime / count;
          console.log(`${method}\t\t${count.toLocaleString()}\t\t\t${avgResponseTime.toFixed(2)}ms`);
        }
      }
      
      // Status code breakdown
      if (aggregatedStats.statusStats.size > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("RESPONSE TIME BY STATUS CODE:");
        console.log("-".repeat(100));
        console.log("Status\t\tCount\t\t\tAvg Response Time");
        console.log("-".repeat(100));
        
        for (const [status, { count, totalResponseTime }] of [...aggregatedStats.statusStats.entries()].sort((a, b) => b[1].count - a[1].count)) {
          const avgResponseTime = totalResponseTime / count;
          console.log(`${status}\t\t${count.toLocaleString()}\t\t\t${avgResponseTime.toFixed(2)}ms`);
        }
      }
      
      // Show extremely slow responses if any
      if (aggregatedOrphanedDetails.extremelySlowResponses.length > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("🚨 EXTREMELY SLOW RESPONSES (>5 SECONDS):");
        console.log("-".repeat(100));
        console.log("ID\t\tResponse Time\tStatus\tMethod\tURL");
        console.log("-".repeat(100));
        
        const displayCount = Math.min(aggregatedOrphanedDetails.extremelySlowResponses.length, 20);
        for (let i = 0; i < displayCount; i++) {
          const { id, responseTimeMs, status, method, url } = aggregatedOrphanedDetails.extremelySlowResponses[i];
          const statusStr = status || 'N/A';
          const timeInSeconds = (responseTimeMs / 1000).toFixed(2);
          console.log(`${id}\t\t${timeInSeconds}s\t\t${statusStr}\t${method}\t${url}`);
        }
        
        if (aggregatedOrphanedDetails.extremelySlowResponses.length > 20) {
          console.log(`\n... and ${aggregatedOrphanedDetails.extremelySlowResponses.length - 20} more extremely slow responses`);
        }
      }
      
      // Show slowest responses
      if (aggregatedOrphanedDetails.slowestResponses.length > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("TOP 20 SLOWEST RESPONSES:");
        console.log("-".repeat(100));
        console.log("ID\t\tResponse Time\tStatus\tMethod\tURL");
        console.log("-".repeat(100));
        
        const displayCount = Math.min(aggregatedOrphanedDetails.slowestResponses.length, 20);
        for (let i = 0; i < displayCount; i++) {
          const { id, responseTimeMs, status, method, url } = aggregatedOrphanedDetails.slowestResponses[i];
          const statusStr = status || 'N/A';
          console.log(`${id}\t\t${responseTimeMs}ms\t\t${statusStr}\t${method}\t${url}`);
        }
      }
      
      // Show fastest responses
      if (aggregatedOrphanedDetails.fastestResponses.length > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("TOP 20 FASTEST RESPONSES:");
        console.log("-".repeat(100));
        console.log("ID\t\tResponse Time\tStatus\tMethod\tURL");
        console.log("-".repeat(100));
        
        const displayCount = Math.min(aggregatedOrphanedDetails.fastestResponses.length, 20);
        for (let i = 0; i < displayCount; i++) {
          const { id, responseTimeMs, status, method, url } = aggregatedOrphanedDetails.fastestResponses[i];
          const statusStr = status || 'N/A';
          console.log(`${id}\t\t${responseTimeMs}ms\t\t${statusStr}\t${method}\t${url}`);
        }
      }
      
      // Show summary of orphaned requests by endpoint (top 10)
      if (aggregatedOrphanedDetails.orphanedRequestEndpoints.size > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("TOP 10 ORPHANED REQUEST ENDPOINTS:");
        console.log("-".repeat(100));
        console.log("Count\t\tEndpoint");
        console.log("-".repeat(100));
        
        const sortedOrphans = [...aggregatedOrphanedDetails.orphanedRequestEndpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        for (const [endpoint, count] of sortedOrphans) {
          console.log(`${count.toLocaleString()}\t\t${endpoint}`);
        }
      }

      // Show summary of orphaned responses by endpoint (top 10)
      if (aggregatedOrphanedDetails.orphanedResponseEndpoints.size > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("TOP 10 ORPHANED RESPONSE ENDPOINTS:");
        console.log("-".repeat(100));
        console.log("Count\t\tEndpoint");
        console.log("-".repeat(100));
        
        const sortedOrphanResponses = [...aggregatedOrphanedDetails.orphanedResponseEndpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        for (const [endpoint, count] of sortedOrphanResponses) {
          console.log(`${count.toLocaleString()}\t\t${endpoint}`);
        }
      }
      
      // Show specific orphaned request IDs
      if (aggregatedOrphanedDetails.orphanedRequestRecords.length > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("SPECIFIC ORPHANED REQUEST IDs (SAMPLE - Complete data in CSV files):");
        console.log("-".repeat(100));
        console.log("ID\t\tEpoch (ms)\tTimestamp\tMethod\tEndpoint");
        console.log("-".repeat(100));
        
        const displayCount = Math.min(aggregatedOrphanedDetails.orphanedRequestRecords.length, 20);
        for (let i = 0; i < displayCount; i++) {
          const { id, method, url, timestamp } = aggregatedOrphanedDetails.orphanedRequestRecords[i];
          const shortUrl = url.length > 50 ? url.substring(0, 47) + '...' : url;
          const timestampStr = new Date(timestamp).toISOString();
          console.log(`${id}\t\t${timestamp}\t${timestampStr}\t${method}\t${shortUrl}`);
        }
        
        if (aggregatedOrphanedDetails.orphanedRequestRecords.length > 20) {
          console.log(`\n... and ${aggregatedOrphanedDetails.orphanedRequestRecords.length - 20} more orphaned requests`);
          console.log(`💾 Complete list: ${config.workspaceDir}/orphaned_requests.csv`);
        }
      }
      
      // Show specific orphaned response IDs
      if (aggregatedOrphanedDetails.orphanedResponseRecords.length > 0) {
        console.log("\n" + "-".repeat(100));
        console.log("SPECIFIC ORPHANED RESPONSE IDs (SAMPLE - Complete data in CSV files):");
        console.log("-".repeat(100));
        console.log("ID\t\tEpoch (ms)\tTimestamp\tStatus\tMethod\tEndpoint");
        console.log("-".repeat(100));
        
        const displayCount = Math.min(aggregatedOrphanedDetails.orphanedResponseRecords.length, 20);
        for (let i = 0; i < displayCount; i++) {
          const { id, status, method, url, timestamp } = aggregatedOrphanedDetails.orphanedResponseRecords[i];
          const statusStr = status || 'N/A';
          const shortUrl = url.length > 40 ? url.substring(0, 37) + '...' : url;
          const timestampStr = new Date(timestamp).toISOString();
          console.log(`${id}\t\t${timestamp}\t${timestampStr}\t${statusStr}\t${method}\t${shortUrl}`);
        }
        
        if (aggregatedOrphanedDetails.orphanedResponseRecords.length > 20) {
          console.log(`\n... and ${aggregatedOrphanedDetails.orphanedResponseRecords.length - 20} more orphaned responses`);
          console.log(`💾 Complete list: ${config.workspaceDir}/orphaned_responses.csv`);
        }
      }
      
      console.log("\n" + "=".repeat(100));
      console.log(`✅ BUCKETING ANALYSIS COMPLETE - Workspace: ${config.workspaceDir}`);
      console.log("=".repeat(100));
      console.log(`📁 Complete orphan data exported to CSV files in: ${config.workspaceDir}`);
      console.log(`📊 Markdown report and bucket data preserved for further analysis`);
      
      // Generate markdown report with deduplicated data
      await generateMarkdownReport(
        inputPath,
        totalRecordsProcessed,
        totalCompletePairs,
        totalOrphanedRequests,
        totalOrphanedResponses,
        totalMultipleOccurrences,
        uniqueExtremelySlowResponses.length,
        aggregatedStats.responseTimes,
        aggregatedStats.methodStats,
        aggregatedStats.statusStats,
        uniqueSlowestResponses,
        uniqueFastestResponses,
        uniqueExtremelySlowResponses,
        aggregatedOrphanedDetails.orphanedRequestEndpoints,
        aggregatedOrphanedDetails.orphanedResponseEndpoints,
        uniqueOrphanedRequests,
        uniqueOrphanedResponses,
        minTimestamp,
        maxTimestamp,
        aggregatedStats.responseTimes.length,
        aggregatedStats.totalResponseTime,
        aggregatedStats.minResponseTime,
        aggregatedStats.maxResponseTime,
        aggregatedStats.performanceBuckets.sub10ms,
        aggregatedStats.performanceBuckets.ms10to100,
        aggregatedStats.performanceBuckets.ms100to5s,
        aggregatedStats.performanceBuckets.over5s
      );
      
    } else {
      console.log("Bucketing mode only supports multiple chunk processing. Use regular mode for single files.");
      Deno.exit(1);
    }
    
  } catch (error) {
    console.error(`Error during bucketing analysis: ${error.message}`);
    Deno.exit(1);
  }
}

async function createWorkspace(): Promise<WorkspaceConfig> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workspaceDir = `./workspace_${timestamp}`;
  const bucketsDir = `${workspaceDir}/buckets`;
  const resultsDir = `${workspaceDir}/results`;
  
  // Create directories
  await Deno.mkdir(workspaceDir, { recursive: true });
  await Deno.mkdir(bucketsDir, { recursive: true });
  await Deno.mkdir(resultsDir, { recursive: true });
  
  console.log(`📁 Created workspace: ${workspaceDir}`);
  
  return {
    workspaceDir,
    bucketsDir,
    resultsDir,
    numBuckets: 100 // Increased from 20 to 100 for better distribution with large datasets
  };
}

async function hashCompositeKey(compositeKey: string): Promise<number> {
  const encoder = new TextEncoder();
  const data = encoder.encode(compositeKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  
  // Use first 4 bytes as uint32 for bucket selection
  const hashInt = (hashArray[0] << 24) | (hashArray[1] << 16) | (hashArray[2] << 8) | hashArray[3];
  return Math.abs(hashInt);
}

async function writeToBucket(record: BucketRecord, config: WorkspaceConfig): Promise<void> {
  const compositeKey = `${record.id}:${record.host}`;
  const hash = await hashCompositeKey(compositeKey);
  const bucketIndex = hash % config.numBuckets;
  const bucketFile = `${config.bucketsDir}/bucket_${bucketIndex.toString().padStart(3, '0')}.jsonl`;
  
  const recordLine = JSON.stringify(record) + '\n';
  await Deno.writeTextFile(bucketFile, recordLine, { append: true });
}

// Main execution
if ((import.meta as any).main) {
  const args = Deno.args;
  const bucketMode = args.includes('--bucket');
  
  // Remove --bucket flag from args if present
  const filteredArgs = args.filter(arg => arg !== '--bucket');
  
  const inputPath = filteredArgs[0] || "/data";
  const startChunk = filteredArgs[1] ? parseInt(filteredArgs[1]) : undefined;
  const endChunk = filteredArgs[2] ? parseInt(filteredArgs[2]) : undefined;
  
  console.log("🔍 HTTP Response Analyzer v2.0 - Multi-Chunk Gzip Support");
  console.log("=".repeat(100));
  
  if (inputPath === "--help" || inputPath === "-h") {
    console.log("Usage:");
    console.log("  ./http_response_analyzer.ts [--bucket] [path] [startChunk] [endChunk]");
    console.log("");
    console.log("Arguments:");
    console.log("  --bucket   Use disk-based bucketing for unlimited scalability (recommended for large datasets)");
    console.log("  path       Path to analyze (default: /data)");
    console.log("  startChunk Start chunk number (1-based, optional)");
    console.log("  endChunk   End chunk number (1-based, optional)");
    console.log("");
    console.log("Examples:");
    console.log("  ./http_response_analyzer.ts --bucket                   # Bucket all chunks in /data");
    console.log("  ./http_response_analyzer.ts --bucket /data 1 25        # Bucket chunks 1-25");
    console.log("  ./http_response_analyzer.ts /data 1 25                 # Memory-based chunks 1-25");
    console.log("  ./http_response_analyzer.ts single-file.csv.gz         # Process single gzipped file");
    console.log("");
    console.log("Modes:");
    console.log("  Memory-based: Faster but limited by available RAM (~50-60 chunks max)");
    console.log("  Bucket-based: Unlimited scalability, uses disk for intermediate storage");
    Deno.exit(0);
  }
  
  if (startChunk && endChunk) {
    console.log(`📦 BATCH MODE: Processing chunks ${startChunk}-${endChunk}`);
  }
  
  if (bucketMode) {
    console.log("🪣 BUCKETING MODE: Using disk-based processing for unlimited scalability");
    await analyzeHttpResponsesWithBucketing(inputPath, startChunk, endChunk);
  } else {
    console.log("💾 MEMORY MODE: Processing in memory (recommended for <60 chunks)");
    await analyzeHttpResponses(inputPath, startChunk, endChunk);
  }
}

export {};