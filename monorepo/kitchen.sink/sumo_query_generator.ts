#!/usr/bin/env -S deno run --allow-all

// Type declarations for Deno globals
declare const Deno: {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string, options?: { append?: boolean }): Promise<void>;
  args: string[];
  exit(code: number): never;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
};

// Sumo Logic Query Generator for Orphaned Records v2.1
// Updated for sourcehost-based pairing analysis
// Usage: ./sumo_query_generator.ts <csv_file> [source_category] [source_host]

interface OrphanedRequest {
  id: string;
  epoch_ms: string;
  timestamp: string;
  method: string;
  endpoint: string;
  sourcehost?: string; // Added sourcehost support
}

interface OrphanedResponse {
  id: string;
  epoch_ms: string;
  timestamp: string;
  status: string;
  method: string;
  endpoint: string;
  sourcehost?: string; // Added sourcehost support
}

function generateRequestQuery(record: OrphanedRequest, sourceCategory: string = "your_category", sourceHost?: string): string {
  const hostFilter = sourceHost ? `| where _sourceHost = "${sourceHost}"` : 
                     record.sourcehost ? `| where _sourceHost = "${record.sourcehost}"` : "";
  
  return `
// Query for orphaned request ID: ${record.id}
// Timestamp: ${record.timestamp}
// Endpoint: ${record.endpoint}
// Sourcehost: ${record.sourcehost || 'N/A'}
// Pairing method: ID + sourcehost (v2.1)

_sourceCategory=${sourceCategory}${hostFilter}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "REQUEST:"
| where _raw contains "id=${record.id}"
| where _raw contains "start=${record.epoch_ms}"
| fields _messagetime, _sourceHost, _raw
| sort _messagetime

// Look for potential matching response on SAME sourcehost:
/*
_sourceCategory=${sourceCategory}${hostFilter}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "WRITEHEAD:"
| where _raw contains "id=${record.id}"  
| where _messagetime >= ${record.epoch_ms}
| where _messagetime <= ${parseInt(record.epoch_ms) + 60000}  // +60 seconds
| fields _messagetime, _sourceHost, _raw
| sort _messagetime
*/

// Check for cross-host issues (if sourcehost mismatch):
/*
_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "id=${record.id}"
| where _messagetime >= ${parseInt(record.epoch_ms) - 5000}
| where _messagetime <= ${parseInt(record.epoch_ms) + 60000}
| fields _messagetime, _sourceHost, _raw
| sort _messagetime
*/
`;
}

function generateResponseQuery(record: OrphanedResponse, sourceCategory: string = "your_category", sourceHost?: string): string {
  const hostFilter = sourceHost ? `| where _sourceHost = "${sourceHost}"` : 
                     record.sourcehost ? `| where _sourceHost = "${record.sourcehost}"` : "";
  
  return `
// Query for orphaned response ID: ${record.id}
// Timestamp: ${record.timestamp}
// Status: ${record.status}
// Endpoint: ${record.endpoint}
// Sourcehost: ${record.sourcehost || 'N/A'}
// Pairing method: ID + sourcehost (v2.1)

_sourceCategory=${sourceCategory}${hostFilter}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "WRITEHEAD:"
| where _raw contains "id=${record.id}"
| where _raw contains "start=${record.epoch_ms}"
| fields _messagetime, _sourceHost, _raw
| sort _messagetime

// Look for potential matching request on SAME sourcehost:
/*
_sourceCategory=${sourceCategory}${hostFilter}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "REQUEST:"
| where _raw contains "id=${record.id}"
| where _messagetime <= ${record.epoch_ms}
| where _messagetime >= ${parseInt(record.epoch_ms) - 60000}  // -60 seconds
| fields _messagetime, _sourceHost, _raw
| sort _messagetime
*/

// Check for cross-host issues (if sourcehost mismatch):
/*
_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "id=${record.id}"
| where _messagetime >= ${parseInt(record.epoch_ms) - 60000}
| where _messagetime <= ${parseInt(record.epoch_ms) + 5000}
| fields _messagetime, _sourceHost, _raw
| sort _messagetime
*/
`;
}

function generateBulkQuery(records: (OrphanedRequest | OrphanedResponse)[], type: 'request' | 'response', sourceCategory: string = "your_category"): string {
  const ids = records.slice(0, 20).map(r => r.id); // Limit to first 20 IDs
  const typeFilter = type === 'request' ? 'REQUEST:' : 'WRITEHEAD:';
  
  return `
// Bulk query for top 20 orphaned ${type}s (v2.1 - sourcehost pairing)
_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "${typeFilter}"
| where _raw matches "*id=(${ids.join('|')})*"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| fields _messagetime, _sourceHost, request_id, start_time, _raw
| sort _sourceHost, request_id, _messagetime
| limit 1000
`;
}

function generateHostAnalysisQuery(sourceCategory: string = "your_category"): string {
  return `
// Host-based orphan analysis (v2.1)
// Analyze orphaned records by sourcehost to identify problematic hosts

_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| parse regex "\\[HttpResponseTimeLogger\\] (?<type>REQUEST|WRITEHEAD):"
| stats count by _sourceHost, type, request_id
| where count = 1  // Only orphaned records (single REQUEST or WRITEHEAD)
| stats count as orphan_count by _sourceHost, type
| sort orphan_count desc
| limit 50

// This shows which hosts have the most orphaned records
`;
}

function generatePairingDebugQuery(sourceCategory: string = "your_category"): string {
  return `
// Debug ID+sourcehost pairing issues (v2.1)
// Find IDs that appear on multiple sourcehosts (potential pairing issues)

_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| parse regex "\\[HttpResponseTimeLogger\\] (?<type>REQUEST|WRITEHEAD):"
| stats values(_sourceHost) as hosts, count as total_records by request_id
| where total_records > 2 OR array_length(hosts) > 1
| sort total_records desc
| limit 100

// IDs with records on multiple hosts suggest cross-host request/response issues
`;
}

function generateTimelineQuery(record: OrphanedRequest | OrphanedResponse, sourceCategory: string = "your_category"): string {
  const startTime = parseInt(record.epoch_ms) - 300000; // 5 minutes before
  const endTime = parseInt(record.epoch_ms) + 300000;   // 5 minutes after
  const hostFilter = record.sourcehost ? `| where _sourceHost = "${record.sourcehost}"` : "";
  
  return `
// Timeline analysis for ID: ${record.id} (v2.1 - sourcehost pairing)
// 10-minute window around timestamp: ${record.timestamp}
// Sourcehost: ${record.sourcehost || 'N/A'}

_sourceCategory=${sourceCategory}${hostFilter}
| where _messagetime >= ${startTime}
| where _messagetime <= ${endTime}
| where _raw contains "HttpResponseTimeLogger"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| parse regex "\\[HttpResponseTimeLogger\\] (?<type>REQUEST|WRITEHEAD):"
| where request_id = "${record.id}"
| fields _messagetime, _sourceHost, request_id, start_time, type, _raw
| sort _messagetime

// Should show both REQUEST and WRITEHEAD for complete pairs
// Orphaned = only one type appears
`;
}

function generateEndpointAnalysisQuery(endpoint: string, sourceCategory: string = "your_category"): string {
  const escapedEndpoint = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  return `
// Analysis of endpoint: ${endpoint} (v2.1 - sourcehost aware)
// Look for patterns in orphaned vs successful requests by host

_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "${endpoint}"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| parse regex "\\[HttpResponseTimeLogger\\] (?<type>REQUEST|WRITEHEAD):"
| stats count by _sourceHost, request_id, type
| eval is_orphan = if(count = 1, "orphaned", "paired")
| stats count as record_count by _sourceHost, is_orphan
| sort _sourceHost, is_orphan
| limit 500

// Shows orphaned vs paired ratios by sourcehost for this endpoint
`;
}

function generateHostPerformanceQuery(sourceCategory: string = "your_category"): string {
  return `
// Host performance comparison (v2.1)
// Compare response times and orphan rates across sourcehosts

_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "WRITEHEAD:"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| parse regex "(?<response_time>\\d+)msec"
| stats 
    count as total_responses,
    avg(response_time) as avg_response_time,
    max(response_time) as max_response_time,
    percentile(response_time, 95) as p95_response_time
    by _sourceHost
| sort avg_response_time desc
| limit 50

// Helps identify problematic hosts with poor performance
`;
}

async function parseCsvFile(filePath: string): Promise<OrphanedRequest[] | OrphanedResponse[]> {
  const content = await Deno.readTextFile(filePath);
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',');
  
  const records: any[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const record: any = {};
    
    for (let j = 0; j < headers.length; j++) {
      let value = values[j] || '';
      // Remove quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      record[headers[j].toLowerCase().replace(/[^a-z0-9]/g, '_')] = value;
    }
    
    records.push(record);
  }
  
  return records;
}

async function main() {
  const args = Deno.args;
  
  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Sumo Logic Query Generator for Orphaned Records v2.1
Updated for sourcehost-based pairing analysis

Usage:
  ./sumo_query_generator.ts <csv_file> [source_category] [output_type] [source_host]

Arguments:
  csv_file        Path to orphaned_requests.csv or orphaned_responses.csv
  source_category Sumo source category (default: "your_category")  
  output_type     Type of queries: individual|bulk|timeline|endpoint|host|debug|all (default: all)
  source_host     Optional: filter to specific sourcehost

Examples:
  ./sumo_query_generator.ts orphaned_requests.csv
  ./sumo_query_generator.ts orphaned_responses.csv "prod_logs"
  ./sumo_query_generator.ts orphaned_requests.csv "prod_logs" individual
  ./sumo_query_generator.ts orphaned_responses.csv "prod_logs" host
  ./sumo_query_generator.ts orphaned_requests.csv "prod_logs" all "yosemite-i-01eacf5bc07ba429f-us-east-1"

New v2.1 Query Types:
  host    - Analyze orphan patterns by sourcehost
  debug   - Debug ID+sourcehost pairing issues
  perf    - Host performance comparison

Output:
  Generates .sumo files in the sumo_queries/ directory with ready-to-use Sumo Logic queries
  All queries now include sourcehost awareness for better debugging
`);
    Deno.exit(0);
  }
  
  const csvFile = args[0];
  const sourceCategory = args[1] || "your_category";
  const outputType = args[2] || "all";
  const sourceHost = args[3]; // Optional source host filter
  
  console.log(`🔍 Generating Sumo Logic queries from: ${csvFile}`);
  console.log(`📊 Source category: ${sourceCategory}`);
  if (sourceHost) {
    console.log(`🖥️  Source host filter: ${sourceHost}`);
  }
  console.log(`🆕 Using v2.1 sourcehost-based pairing approach`);
  
  try {
    const records = await parseCsvFile(csvFile);
    
    if (records.length === 0) {
      console.log("No records found in CSV file");
      Deno.exit(1);
    }
    
    // Ensure sumo_queries directory exists
    try {
      await Deno.mkdir("sumo_queries", { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore error
    }
    
    const isRequest = csvFile.includes('request');
    const type = isRequest ? 'request' : 'response';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    console.log(`📝 Found ${records.length} orphaned ${type} records`);
    
    // Show sourcehost distribution
    const sourcehostCounts = new Map<string, number>();
    records.forEach(record => {
      const host = record.sourcehost || 'unknown';
      sourcehostCounts.set(host, (sourcehostCounts.get(host) || 0) + 1);
    });
    
    console.log(`🖥️  Sourcehost distribution:`);
    [...sourcehostCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([host, count]) => {
        console.log(`   ${host}: ${count} records`);
      });
    
    // Generate individual queries
    if (outputType === 'individual' || outputType === 'all') {
      const individualQueries: string[] = [];
      
      // Generate queries for first 10 records to avoid overwhelming output
      const sampleRecords = records.slice(0, 10);
      
      for (const record of sampleRecords) {
        if (isRequest) {
          individualQueries.push(generateRequestQuery(record as OrphanedRequest, sourceCategory, sourceHost));
        } else {
          individualQueries.push(generateResponseQuery(record as OrphanedResponse, sourceCategory, sourceHost));
        }
      }
      
      const individualOutput = individualQueries.join('\n' + '='.repeat(100) + '\n');
      const individualFile = `sumo_queries/individual_${type}_queries_v2.1_${timestamp}.sumo`;
      await Deno.writeTextFile(individualFile, individualOutput);
      console.log(`✅ Individual queries: ${individualFile} (first 10 records)`);
    }
    
    // Generate bulk query
    if (outputType === 'bulk' || outputType === 'all') {
      const bulkQuery = generateBulkQuery(records, type, sourceCategory);
      const bulkFile = `sumo_queries/bulk_${type}_query_v2.1_${timestamp}.sumo`;
      await Deno.writeTextFile(bulkFile, bulkQuery);
      console.log(`✅ Bulk query: ${bulkFile} (top 20 IDs)`);
    }
    
    // Generate timeline queries
    if (outputType === 'timeline' || outputType === 'all') {
      const timelineQueries: string[] = [];
      
      // Generate timeline queries for first 5 records
      const sampleRecords = records.slice(0, 5);
      
      for (const record of sampleRecords) {
        timelineQueries.push(generateTimelineQuery(record, sourceCategory));
      }
      
      const timelineOutput = timelineQueries.join('\n' + '='.repeat(100) + '\n');
      const timelineFile = `sumo_queries/timeline_${type}_queries_v2.1_${timestamp}.sumo`;
      await Deno.writeTextFile(timelineFile, timelineOutput);
      console.log(`✅ Timeline queries: ${timelineFile} (first 5 records)`);
    }
    
    // Generate endpoint analysis queries
    if (outputType === 'endpoint' || outputType === 'all') {
      // Get unique endpoints
      const uniqueEndpoints = [...new Set(records.map(r => r.endpoint))].slice(0, 10);
      
      const endpointQueries: string[] = [];
      for (const endpoint of uniqueEndpoints) {
        endpointQueries.push(generateEndpointAnalysisQuery(endpoint, sourceCategory));
      }
      
      const endpointOutput = endpointQueries.join('\n' + '='.repeat(100) + '\n');
      const endpointFile = `sumo_queries/endpoint_${type}_queries_v2.1_${timestamp}.sumo`;
      await Deno.writeTextFile(endpointFile, endpointOutput);
      console.log(`✅ Endpoint queries: ${endpointFile} (top 10 endpoints)`);
    }
    
    // Generate host analysis queries (NEW in v2.1)
    if (outputType === 'host' || outputType === 'all') {
      const hostQueries: string[] = [
        generateHostAnalysisQuery(sourceCategory),
        generateHostPerformanceQuery(sourceCategory)
      ];
      
      const hostOutput = hostQueries.join('\n' + '='.repeat(100) + '\n');
      const hostFile = `sumo_queries/host_analysis_v2.1_${timestamp}.sumo`;
      await Deno.writeTextFile(hostFile, hostOutput);
      console.log(`✅ Host analysis: ${hostFile} (NEW in v2.1)`);
    }
    
    // Generate debug queries (NEW in v2.1)
    if (outputType === 'debug' || outputType === 'all') {
      const debugQuery = generatePairingDebugQuery(sourceCategory);
      const debugFile = `sumo_queries/pairing_debug_v2.1_${timestamp}.sumo`;
      await Deno.writeTextFile(debugFile, debugQuery);
      console.log(`✅ Pairing debug: ${debugFile} (NEW in v2.1)`);
    }
    
    console.log(`\n🎯 Query Generation Complete! (v2.1 - sourcehost aware)`);
    console.log(`💡 Tip: Edit the source_category in the .sumo files to match your Sumo Logic setup`);
    console.log(`🖥️  All queries now include sourcehost filtering for better analysis`);
    console.log(`📋 Copy and paste queries into Sumo Logic search interface`);
    console.log(`📁 All queries saved to: sumo_queries/ directory`);
    
  } catch (error) {
    console.error(`Error processing CSV file: ${error.message}`);
    Deno.exit(1);
  }
}

if ((import.meta as any).main) {
  await main();
} 

// Export to make this file a module
export {}; 