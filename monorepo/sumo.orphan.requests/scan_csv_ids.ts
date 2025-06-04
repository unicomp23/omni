#!/usr/bin/env -S deno run --allow-all

// Type declarations for Deno globals
declare const Deno: {
  readTextFile(path: string): Promise<string>;
  args: string[];
  exit(code: number): never;
};

async function scanCsvIds(filePath: string) {
  console.log(`Scanning CSV file for HTTP requests without matching responses: ${filePath}`);
  
  try {
    // Read the CSV file
    const csvContent = await Deno.readTextFile(filePath);
    const lines = csvContent.split('\n');
    
    console.log(`Total lines found: ${lines.length}`);
    
    // Skip header line
    const dataLines = lines.slice(1).filter(line => line.trim() !== '');
    console.log(`Data lines to process: ${dataLines.length}`);
    
    // Count occurrences of each ID and track request/response info
    const idCounts = new Map<string, number>();
    const idDetails = new Map<string, Array<{ method: string; url: string; lineNumber: number }>>();
    
    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      
      // Extract UUID-like IDs from the line using regex
      // Look for patterns like "id":"uuid" or ""id"":""uuid""
      const idMatches = line.match(/""id"":""([a-f0-9-]{36})""|"id":"([a-f0-9-]{36})"/g);
      
      if (idMatches) {
        for (const match of idMatches) {
          // Extract the actual UUID from the match
          let id = '';
          if (match.includes('""id"":""')) {
            id = match.replace(/""id"":""/, '').replace(/""$/, '');
          } else {
            id = match.replace(/"id":"/, '').replace(/"$/, '');
          }
          
          if (id.match(/^[a-f0-9-]{36}$/)) {
            idCounts.set(id, (idCounts.get(id) || 0) + 1);
            
            // Extract method and URL for analysis
            const methodMatch = line.match(/""method"":""([^""]+)""|"method":"([^"]+)"/);
            const urlMatch = line.match(/""url"":""([^""]+)""|"url":"([^"]+)"/);
            
            const method = methodMatch ? (methodMatch[1] || methodMatch[2] || 'UNKNOWN') : 'UNKNOWN';
            const url = urlMatch ? (urlMatch[1] || urlMatch[2] || 'UNKNOWN') : 'UNKNOWN';
            
            if (!idDetails.has(id)) {
              idDetails.set(id, []);
            }
            idDetails.get(id)!.push({ method, url, lineNumber: i + 2 }); // +2 because we skipped header and arrays are 0-indexed
          }
        }
      }
      
      // Also look for standalone UUIDs in quotes that might be in the ID column
      const standaloneIds = line.match(/"([a-f0-9-]{36})"/g);
      if (standaloneIds) {
        for (const match of standaloneIds) {
          const id = match.replace(/"/g, '');
          if (id.match(/^[a-f0-9-]{36}$/)) {
            // Only count if we haven't already found this ID in the JSON format
            if (!line.includes(`"id":"${id}`) && !line.includes(`""id"":""${id}"`)) {
              idCounts.set(id, (idCounts.get(id) || 0) + 1);
              
              if (!idDetails.has(id)) {
                idDetails.set(id, []);
              }
              idDetails.get(id)!.push({ method: 'UNKNOWN', url: 'UNKNOWN', lineNumber: i + 2 });
            }
          }
        }
      }
    }
    
    console.log(`Unique request IDs found: ${idCounts.size}`);
    
    // Find HTTP requests without matching responses (count != 2)
    const unmatchedRequests: Array<{ id: string; count: number; details: Array<{ method: string; url: string; lineNumber: number }> }> = [];
    
    for (const [id, count] of idCounts.entries()) {
      if (count !== 2) {
        unmatchedRequests.push({ 
          id, 
          count, 
          details: idDetails.get(id) || []
        });
      }
    }
    
    // Sort by count (descending) then by ID
    unmatchedRequests.sort((a, b) => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return a.id.localeCompare(b.id);
    });
    
    console.log(`\nHTTP requests without matching responses: ${unmatchedRequests.length}`);
    console.log("=".repeat(80));
    
    if (unmatchedRequests.length === 0) {
      console.log("All HTTP requests have matching responses!");
    } else {
      console.log("ID\t\t\t\t\tCount\tMethod\tURL");
      console.log("-".repeat(80));
      
      // Show first 20 unmatched requests with details
      const displayCount = Math.min(unmatchedRequests.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const { id, count, details } = unmatchedRequests[i];
        const firstDetail = details[0] || { method: 'UNKNOWN', url: 'UNKNOWN', lineNumber: 0 };
        console.log(`${id}\t${count}\t${firstDetail.method}\t${firstDetail.url}`);
        
        // Show additional occurrences if any
        if (details.length > 1) {
          for (let j = 1; j < details.length; j++) {
            const detail = details[j];
            console.log(`\t\t\t\t\t\t${detail.method}\t${detail.url} (line ${detail.lineNumber})`);
          }
        }
      }
      
      if (unmatchedRequests.length > 20) {
        console.log(`\n... and ${unmatchedRequests.length - 20} more unmatched requests`);
      }
    }
    
    // Summary statistics
    console.log("\n" + "=".repeat(80));
    console.log("SUMMARY:");
    console.log(`Total lines processed: ${dataLines.length}`);
    console.log(`Unique request IDs: ${idCounts.size}`);
    console.log(`Requests with matching responses (count = 2): ${idCounts.size - unmatchedRequests.length}`);
    console.log(`Requests WITHOUT matching responses (count != 2): ${unmatchedRequests.length}`);
    
    // Count distribution
    const countDistribution = new Map<number, number>();
    for (const count of idCounts.values()) {
      countDistribution.set(count, (countDistribution.get(count) || 0) + 1);
    }
    
    console.log("\nRequest/Response count distribution:");
    for (const [count, frequency] of [...countDistribution.entries()].sort((a, b) => a[0] - b[0])) {
      const description = count === 1 ? "(orphaned requests)" : 
                         count === 2 ? "(matched req/resp pairs)" : 
                         "(multiple occurrences)";
      console.log(`  Count ${count}: ${frequency} IDs ${description}`);
    }
    
    // Method breakdown for unmatched requests
    if (unmatchedRequests.length > 0) {
      const methodCounts = new Map<string, number>();
      for (const { details } of unmatchedRequests) {
        for (const { method } of details) {
          methodCounts.set(method, (methodCounts.get(method) || 0) + 1);
        }
      }
      
      console.log("\nUnmatched requests by HTTP method:");
      for (const [method, count] of [...methodCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${method}: ${count} requests`);
      }
    }
    
  } catch (error) {
    console.error(`Error processing file: ${error.message}`);
    Deno.exit(1);
  }
}

// Main execution
if ((import.meta as any).main) {
  const filePath = Deno.args[0] || "/data/search-results-2025-05-27T11_16_26.214-0700.csv";
  
  if (!filePath) {
    console.error("Usage: ./scan_csv_ids.ts [csv_file_path]");
    Deno.exit(1);
  }
  
  await scanCsvIds(filePath);
}

export {}; 