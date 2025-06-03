#!/usr/bin/env -S deno run --allow-all

// Type declarations for Deno globals
declare const Deno: {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string, options?: { append?: boolean }): Promise<void>;
  args: string[];
  exit(code: number): never;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
};

// Sumo Logic Query Generator for Orphaned Records
// Usage: ./sumo_query_generator.ts <csv_file> [source_category]

interface OrphanedRequest {
  id: string;
  epoch_ms: string;
  timestamp: string;
  method: string;
  endpoint: string;
}

interface OrphanedResponse {
  id: string;
  epoch_ms: string;
  timestamp: string;
  status: string;
  method: string;
  endpoint: string;
}

function generateRequestQuery(record: OrphanedRequest, sourceCategory: string = "your_category"): string {
  return `
// Query for orphaned request ID: ${record.id}
// Timestamp: ${record.timestamp}
// Endpoint: ${record.endpoint}

_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "REQUEST:"
| where _raw contains "id=${record.id}"
| where _raw contains "start=${record.epoch_ms}"
| fields _messagetime, _raw
| sort _messagetime

// Look for potential matching response:
/*
_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "WRITEHEAD:"
| where _raw contains "id=${record.id}"  
| where _messagetime >= ${record.epoch_ms}
| where _messagetime <= ${parseInt(record.epoch_ms) + 60000}  // +60 seconds
| fields _messagetime, _raw
| sort _messagetime
*/
`;
}

function generateResponseQuery(record: OrphanedResponse, sourceCategory: string = "your_category"): string {
  return `
// Query for orphaned response ID: ${record.id}
// Timestamp: ${record.timestamp}
// Status: ${record.status}
// Endpoint: ${record.endpoint}

_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "WRITEHEAD:"
| where _raw contains "id=${record.id}"
| where _raw contains "start=${record.epoch_ms}"
| fields _messagetime, _raw
| sort _messagetime

// Look for potential matching request:
/*
_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "REQUEST:"
| where _raw contains "id=${record.id}"
| where _messagetime <= ${record.epoch_ms}
| where _messagetime >= ${parseInt(record.epoch_ms) - 60000}  // -60 seconds
| fields _messagetime, _raw
| sort _messagetime
*/
`;
}

function generateBulkQuery(records: (OrphanedRequest | OrphanedResponse)[], type: 'request' | 'response', sourceCategory: string = "your_category"): string {
  const ids = records.slice(0, 20).map(r => r.id); // Limit to first 20 IDs
  const typeFilter = type === 'request' ? 'REQUEST:' : 'WRITEHEAD:';
  
  return `
// Bulk query for top 20 orphaned ${type}s
_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "${typeFilter}"
| where _raw matches "*id=(${ids.join('|')})*"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| fields _messagetime, request_id, start_time, _raw
| sort request_id, _messagetime
| limit 1000
`;
}

function generateTimelineQuery(record: OrphanedRequest | OrphanedResponse, sourceCategory: string = "your_category"): string {
  const startTime = parseInt(record.epoch_ms) - 300000; // 5 minutes before
  const endTime = parseInt(record.epoch_ms) + 300000;   // 5 minutes after
  
  return `
// Timeline analysis for ID: ${record.id}
// 10-minute window around timestamp: ${record.timestamp}

_sourceCategory=${sourceCategory}
| where _messagetime >= ${startTime}
| where _messagetime <= ${endTime}
| where _raw contains "HttpResponseTimeLogger"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| parse regex "\\[HttpResponseTimeLogger\\] (?<type>REQUEST|WRITEHEAD):"
| where request_id = "${record.id}"
| fields _messagetime, request_id, start_time, type, _raw
| sort _messagetime
`;
}

function generateEndpointAnalysisQuery(endpoint: string, sourceCategory: string = "your_category"): string {
  const escapedEndpoint = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  return `
// Analysis of endpoint: ${endpoint}
// Look for patterns in orphaned vs successful requests

_sourceCategory=${sourceCategory}
| where _raw contains "HttpResponseTimeLogger"
| where _raw contains "${endpoint}"
| parse regex "id=(?<request_id>\\d+)"
| parse regex "start=(?<start_time>\\d+)"
| parse regex "\\[HttpResponseTimeLogger\\] (?<type>REQUEST|WRITEHEAD):"
| fields _messagetime, request_id, start_time, type, _raw
| sort request_id, start_time, _messagetime
| limit 500
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
Sumo Logic Query Generator for Orphaned Records

Usage:
  ./sumo_query_generator.ts <csv_file> [source_category] [output_type]

Arguments:
  csv_file        Path to orphaned_requests.csv or orphaned_responses.csv
  source_category Sumo source category (default: "your_category")  
  output_type     Type of queries to generate: individual|bulk|timeline|endpoint (default: all)

Examples:
  ./sumo_query_generator.ts orphaned_requests.csv
  ./sumo_query_generator.ts orphaned_responses.csv "prod_logs"
  ./sumo_query_generator.ts orphaned_requests.csv "prod_logs" individual
  ./sumo_query_generator.ts orphaned_responses.csv "prod_logs" bulk

Output:
  Generates .sumo files in the sumo_queries/ directory with ready-to-use Sumo Logic queries
`);
    Deno.exit(0);
  }
  
  const csvFile = args[0];
  const sourceCategory = args[1] || "your_category";
  const outputType = args[2] || "all";
  
  console.log(`🔍 Generating Sumo Logic queries from: ${csvFile}`);
  console.log(`📊 Source category: ${sourceCategory}`);
  
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
    
    // Generate individual queries
    if (outputType === 'individual' || outputType === 'all') {
      const individualQueries: string[] = [];
      
      // Generate queries for first 10 records to avoid overwhelming output
      const sampleRecords = records.slice(0, 10);
      
      for (const record of sampleRecords) {
        if (isRequest) {
          individualQueries.push(generateRequestQuery(record as OrphanedRequest, sourceCategory));
        } else {
          individualQueries.push(generateResponseQuery(record as OrphanedResponse, sourceCategory));
        }
      }
      
      const individualOutput = individualQueries.join('\n' + '='.repeat(100) + '\n');
      const individualFile = `sumo_queries/individual_${type}_queries_${timestamp}.sumo`;
      await Deno.writeTextFile(individualFile, individualOutput);
      console.log(`✅ Individual queries: ${individualFile} (first 10 records)`);
    }
    
    // Generate bulk query
    if (outputType === 'bulk' || outputType === 'all') {
      const bulkQuery = generateBulkQuery(records, type, sourceCategory);
      const bulkFile = `sumo_queries/bulk_${type}_query_${timestamp}.sumo`;
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
      const timelineFile = `sumo_queries/timeline_${type}_queries_${timestamp}.sumo`;
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
      const endpointFile = `sumo_queries/endpoint_${type}_queries_${timestamp}.sumo`;
      await Deno.writeTextFile(endpointFile, endpointOutput);
      console.log(`✅ Endpoint queries: ${endpointFile} (top 10 endpoints)`);
    }
    
    console.log(`\n🎯 Query Generation Complete!`);
    console.log(`💡 Tip: Edit the source_category in the .sumo files to match your Sumo Logic setup`);
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