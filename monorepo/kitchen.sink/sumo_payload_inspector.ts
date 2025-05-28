#!/usr/bin/env -S deno run --allow-all

interface SumoConfig {
  accessId: string;
  accessKey: string;
  endpoint: string;
  query: string;
  from: string;
  to: string;
}

class SumoPayloadInspector {
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

    const result = await response.json();
    console.log(`Search job created with ID: ${result.id}`);
    return result.id;
  }

  async waitForJobCompletion(jobId: string): Promise<any> {
    console.log('Waiting for job completion...');
    
    while (true) {
      const response = await fetch(`${this.baseUrl}/${jobId}`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to check job status: ${response.status} ${response.statusText}`);
      }

      const status = await response.json();
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

  async inspectRecords(jobId: string): Promise<void> {
    console.log('\n=== INSPECTING RECORDS ===');
    
    const response = await fetch(`${this.baseUrl}/${jobId}/records?offset=0&limit=3`, {
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      console.log(`Failed to fetch records: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();
    console.log('Records response structure:');
    console.log(JSON.stringify(data, null, 2));
  }

  async inspectMessages(jobId: string): Promise<void> {
    console.log('\n=== INSPECTING MESSAGES ===');
    
    const response = await fetch(`${this.baseUrl}/${jobId}/messages?offset=0&limit=3`, {
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      console.log(`Failed to fetch messages: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();
    console.log('Messages response structure:');
    console.log(JSON.stringify(data, null, 2));
    
    // Show first few raw messages
    if (data.messages && data.messages.length > 0) {
      console.log('\n=== FIRST FEW RAW MESSAGES ===');
      data.messages.slice(0, 3).forEach((msg: any, index: number) => {
        console.log(`\n--- Message ${index + 1} ---`);
        console.log('Raw content:', msg.map?._raw || 'No _raw field');
        console.log('Timestamp:', msg.map?.receiptTime || 'No timestamp');
        console.log('Source Host:', msg.map?._sourceHost || 'No source host');
        console.log('Source Category:', msg.map?._sourceCategory || 'No source category');
        console.log('All fields:', Object.keys(msg.map || {}));
      });
    }
  }

  async deleteSearchJob(jobId: string): Promise<void> {
    console.log(`\nCleaning up search job: ${jobId}`);
    
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
    console.error('Usage: ./sumo_payload_inspector.ts [ACCESS_ID] [ACCESS_KEY] [ENDPOINT] [FROM_TIME] [TO_TIME]');
    console.error('Or set environment variables: SUMO_ACCESS_ID, SUMO_ACCESS_KEY, SUMO_ENDPOINT');
    Deno.exit(1);
  }

  // Use a smaller time range for inspection (last 1 hour)
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  
  const config: SumoConfig = {
    accessId,
    accessKey,
    endpoint,
    query: '_index=media_* _collector=*yosemite*',
    from: oneHourAgo.toISOString(),
    to: now.toISOString()
  };

  // Allow custom time range via command line
  if (Deno.args.length >= 2) {
    // If we have env vars, args are time range
    if (Deno.env.get('SUMO_ACCESS_ID') && Deno.env.get('SUMO_ACCESS_KEY')) {
      config.from = Deno.args[0];
      config.to = Deno.args[1];
    } else if (Deno.args.length >= 5) {
      // If no env vars, args are [id, key, endpoint, from, to]
      config.from = Deno.args[3];
      config.to = Deno.args[4];
    }
  }

  // Convert to epoch milliseconds if needed
  if (config.from.includes('T')) {
    config.from = new Date(config.from).getTime().toString();
  }
  if (config.to.includes('T')) {
    config.to = new Date(config.to).getTime().toString();
  }

  const inspector = new SumoPayloadInspector(config);
  let jobId: string | null = null;

  try {
    // Create search job
    jobId = await inspector.createSearchJob();
    
    // Wait for completion
    const status = await inspector.waitForJobCompletion(jobId);
    
    // Inspect both records and messages
    await inspector.inspectRecords(jobId);
    await inspector.inspectMessages(jobId);
    
  } catch (error) {
    console.error('Error:', error.message);
    Deno.exit(1);
  } finally {
    // Clean up
    if (jobId) {
      await inspector.deleteSearchJob(jobId);
    }
  }
}

if (import.meta.main) {
  await main();
}

export {}; 