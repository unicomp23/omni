#!/usr/bin/env -S deno run --allow-all

// Type declarations for Deno globals
declare const Deno: {
  writeTextFile(path: string, data: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  env: {
    get(key: string): string | undefined;
  };
  args: string[];
  exit(code: number): never;
};

interface SumoConfig {
  accessId: string;
  accessKey: string;
  endpoint: string;
  query: string;
  from: string;
  to: string;
}

interface SearchJobResponse {
  id: string;
  link: {
    rel: string;
    href: string;
  };
}

interface JobStatus {
  state: string;
  messageCount: number;
  recordCount: number;
  pendingErrors: string[];
  pendingWarnings: string[];
}

export class SumoLogicDownloader {
  private config: SumoConfig;
  private baseUrl: string;

  constructor(config: SumoConfig) {
    this.config = config;
    this.baseUrl = `https://${config.endpoint}/api/v1/search/jobs`;
  }

  private getAuthHeaders(): HeadersInit {
    const credentials = btoa(`${this.config.accessId}:${this.config.accessKey}`);
    return {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  async createSearchJob(): Promise<string> {
    console.log('Creating search job...');
    console.log(`Query: ${this.config.query}`);
    console.log(`Time range: ${this.config.from} to ${this.config.to}`);

    const payload = {
      query: this.config.query,
      from: this.config.from,
      to: this.config.to,
      timeZone: 'UTC'
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create search job: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result: SearchJobResponse = await response.json();
    console.log(`Search job created with ID: ${result.id}`);
    return result.id;
  }

  async waitForJobCompletion(jobId: string): Promise<JobStatus> {
    console.log('Waiting for job completion...');
    
    while (true) {
      const response = await fetch(`${this.baseUrl}/${jobId}`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to check job status: ${response.status} ${response.statusText}`);
      }

      const status: JobStatus = await response.json();
      console.log(`Job state: ${status.state}, Records: ${status.recordCount}, Messages: ${status.messageCount}`);

      if (status.state === 'DONE GATHERING RESULTS') {
        console.log('Job completed successfully!');
        return status;
      } else if (status.state === 'CANCELLED' || status.state === 'FORCE PAUSED') {
        throw new Error(`Job failed with state: ${status.state}`);
      }

      // Wait 5 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  async downloadRecords(jobId: string, outputPath: string): Promise<void> {
    console.log(`Downloading records to: ${outputPath}`);

    const response = await fetch(`${this.baseUrl}/${jobId}/records?offset=0&limit=10000`, {
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to download records: ${response.status} ${response.statusText}`);
    }

    const records = await response.json();
    
    // Convert to CSV format
    if (records.records && records.records.length > 0) {
      const csvContent = this.convertToCSV(records.records);
      await Deno.writeTextFile(outputPath, csvContent);
      console.log(`Downloaded ${records.records.length} records to ${outputPath}`);
    } else {
      console.log('No records found for the specified query and time range.');
    }
  }

  async downloadAllRecords(jobId: string, outputPath: string): Promise<void> {
    console.log(`Downloading all records to: ${outputPath}`);
    
    let offset = 0;
    const limit = 10000;
    let allRecords: any[] = [];
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching records ${offset} to ${offset + limit}...`);
      
      const response = await fetch(`${this.baseUrl}/${jobId}/records?offset=${offset}&limit=${limit}`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to download records: ${response.status} ${response.statusText}`);
      }

      const batch = await response.json();
      
      if (batch.records && batch.records.length > 0) {
        allRecords.push(...batch.records);
        offset += batch.records.length;
        hasMore = batch.records.length === limit;
      } else {
        hasMore = false;
      }
    }

    if (allRecords.length > 0) {
      const csvContent = this.convertToCSV(allRecords);
      await Deno.writeTextFile(outputPath, csvContent);
      console.log(`Downloaded ${allRecords.length} total records to ${outputPath}`);
    } else {
      console.log('No records found, trying to download messages instead...');
      await this.downloadAllMessages(jobId, outputPath);
    }
  }

  async downloadAllMessages(jobId: string, outputPath: string): Promise<void> {
    console.log(`Downloading all messages to: ${outputPath}`);
    
    let offset = 0;
    const limit = 10000;
    let allMessages: any[] = [];
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching messages ${offset} to ${offset + limit}...`);
      
      const response = await fetch(`${this.baseUrl}/${jobId}/messages?offset=${offset}&limit=${limit}`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to download messages: ${response.status} ${response.statusText}`);
      }

      const batch = await response.json();
      
      if (batch.messages && batch.messages.length > 0) {
        allMessages.push(...batch.messages);
        offset += batch.messages.length;
        hasMore = batch.messages.length === limit;
      } else {
        hasMore = false;
      }
    }

    if (allMessages.length > 0) {
      const csvContent = this.convertMessagesToCSV(allMessages);
      await Deno.writeTextFile(outputPath, csvContent);
      console.log(`Downloaded ${allMessages.length} total messages to ${outputPath}`);
    } else {
      console.log('No messages found for the specified query and time range.');
    }
  }

  private convertToCSV(records: any[]): string {
    if (records.length === 0) return '';

    // Get all unique field names from all records
    const fieldNames = new Set<string>();
    records.forEach(record => {
      if (record.map) {
        Object.keys(record.map).forEach(key => fieldNames.add(key));
      }
    });

    const headers = Array.from(fieldNames).sort();
    
    // Create CSV header
    const csvLines = [headers.map(h => `"${h}"`).join(',')];
    
    // Add data rows
    records.forEach(record => {
      const row = headers.map(header => {
        const value = record.map?.[header] || '';
        // Escape quotes and wrap in quotes
        return `"${String(value).replace(/"/g, '""')}"`;
      });
      csvLines.push(row.join(','));
    });

    return csvLines.join('\n');
  }

  private convertMessagesToCSV(messages: any[]): string {
    if (messages.length === 0) return '';

    // Create CSV header for messages based on actual structure
    const headers = ['messagetime', 'receipttime', 'raw', 'sourcehost', 'sourcecategory', 'sourcename', 'collector', 'loglevel', 'view', 'region'];
    const csvLines = [headers.map(h => `"${h}"`).join(',')];
    
    // Add data rows
    messages.forEach(msg => {
      const row = [
        msg.map?._messagetime || '',
        msg.map?._receipttime || '',
        msg.map?._raw || '',
        msg.map?._sourcehost || '',
        msg.map?._sourcecategory || '',
        msg.map?._sourcename || '',
        msg.map?._collector || '',
        msg.map?._loglevel || '',
        msg.map?._view || '',
        msg.map?.region || ''
      ].map(value => `"${String(value).replace(/"/g, '""')}"`);
      csvLines.push(row.join(','));
    });

    return csvLines.join('\n');
  }

  async deleteSearchJob(jobId: string): Promise<void> {
    console.log(`Cleaning up search job: ${jobId}`);
    
    const response = await fetch(`${this.baseUrl}/${jobId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      console.warn(`Failed to delete search job: ${response.status} ${response.statusText}`);
    } else {
      console.log('Search job deleted successfully.');
    }
  }
}

async function main() {
  // Get credentials from environment variables or command line args
  const accessId = Deno.env.get('SUMO_ACCESS_ID') || Deno.args[0];
  const accessKey = Deno.env.get('SUMO_ACCESS_KEY') || Deno.args[1];
  const endpoint = Deno.env.get('SUMO_ENDPOINT') || Deno.args[2] || 'api.sumologic.com';

  if (!accessId || !accessKey) {
    console.error('Usage: ./sumo_downloader.ts [ACCESS_ID] [ACCESS_KEY] [ENDPOINT] [FROM_TIME] [TO_TIME]');
    console.error('Or set environment variables: SUMO_ACCESS_ID, SUMO_ACCESS_KEY, SUMO_ENDPOINT');
    Deno.exit(1);
  }

  // Calculate time range (last 24 hours by default)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const config: SumoConfig = {
    accessId,
    accessKey,
    endpoint,
    query: '_index=media_* _collector=*yosemite*',
    from: yesterday.toISOString(),
    to: now.toISOString()
  };

  // Allow custom time range via command line
  // If we have environment variables set, args 0 and 1 are time range
  // If we don't have env vars, args 0-2 are credentials/endpoint, args 3-4 are time range
  let fromTimeArg: string | undefined;
  let toTimeArg: string | undefined;
  
  if (Deno.env.get('SUMO_ACCESS_ID') && Deno.env.get('SUMO_ACCESS_KEY')) {
    // Using env vars, so args are: [endpoint], [from], [to] or [from], [to]
    if (Deno.args.length >= 2) {
      if (Deno.args.length === 2) {
        // args are [from], [to]
        fromTimeArg = Deno.args[0];
        toTimeArg = Deno.args[1];
      } else if (Deno.args.length >= 3) {
        // args are [endpoint], [from], [to]
        fromTimeArg = Deno.args[1];
        toTimeArg = Deno.args[2];
      }
    }
  } else {
    // Using command line args for credentials
    if (Deno.args.length >= 5) {
      // args are [accessId], [accessKey], [endpoint], [from], [to]
      fromTimeArg = Deno.args[3];
      toTimeArg = Deno.args[4];
    } else if (Deno.args.length === 4) {
      // args are [accessId], [accessKey], [from], [to] (using default endpoint)
      fromTimeArg = Deno.args[2];
      toTimeArg = Deno.args[3];
    }
  }
  
  if (fromTimeArg && toTimeArg) {
    config.from = fromTimeArg;
    config.to = toTimeArg;
  }

  const outputPath = `/data/sumo-records-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  
  const downloader = new SumoLogicDownloader(config);
  let jobId: string | null = null;

  try {
    // Create search job
    jobId = await downloader.createSearchJob();
    
    // Wait for completion
    const status = await downloader.waitForJobCompletion(jobId);
    
    if (status.recordCount > 0) {
      // Download all records
      await downloader.downloadAllRecords(jobId, outputPath);
    } else if (status.messageCount > 0) {
      // Download messages instead
      console.log(`Found ${status.messageCount} messages but no records. Downloading messages...`);
      await downloader.downloadAllMessages(jobId, outputPath);
    } else {
      console.log('No records or messages found for the specified query and time range.');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    Deno.exit(1);
  } finally {
    // Clean up
    if (jobId) {
      await downloader.deleteSearchJob(jobId);
    }
  }
}

if ((import.meta as any).main) {
  await main();
}

export {}; 