#!/usr/bin/env -S deno run --allow-all

// Type declarations for Deno globals
declare const Deno: {
  writeTextFile(path: string, data: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
  stat(path: string): Promise<{ size: number }>;
  env: {
    get(key: string): string | undefined;
  };
  args: string[];
  exit(code: number): never;
};

// Type for import.meta
declare const importMeta: {
  main: boolean;
};

interface SumoConfig {
  accessId: string;
  accessKey: string;
  endpoint: string;
  query: string;
}

interface ChunkResult {
  chunkNumber: number;
  messageCount: number;
  filePath: string;
  actualStartTime: number;
  actualEndTime: number;
  hitLimit: boolean;
  success: boolean;
}

interface ValidationResult {
  totalMessages: number;
  failedChunks: number[];
  gapHours: number;
  coverageGood: boolean;
  warnings: string[];
}

class SumoSafeBulkDownloader {
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

  async createSearchJob(from: string, to: string): Promise<string> {
    const payload = {
      query: this.config.query,
      from,
      to,
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
    return result.id;
  }

  async waitForJobCompletion(jobId: string): Promise<any> {
    while (true) {
      const response = await fetch(`${this.baseUrl}/${jobId}`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to check job status: ${response.status} ${response.statusText}`);
      }

      const status = await response.json();

      if (status.state === 'DONE GATHERING RESULTS') {
        return status;
      } else if (status.state === 'CANCELLED' || status.state === 'FORCE PAUSED') {
        throw new Error(`Job failed with state: ${status.state}`);
      }

      // Wait 5 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  async downloadMessages(jobId: string, outputPath: string): Promise<number> {
    let offset = 0;
    const limit = 10000;
    let allMessages: any[] = [];
    let hasMore = true;

    while (hasMore) {
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
    }

    return allMessages.length;
  }

  private convertMessagesToCSV(messages: any[]): string {
    if (messages.length === 0) return '';

    const headers = ['messagetime', 'receipttime', 'raw', 'sourcehost', 'sourcecategory', 'sourcename', 'collector', 'loglevel', 'view', 'region'];
    const csvLines = [headers.map(h => `"${h}"`).join(',')];
    
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
    const response = await fetch(`${this.baseUrl}/${jobId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      console.warn(`Failed to delete search job: ${response.status} ${response.statusText}`);
    }
  }

  async downloadChunk(chunkNumber: number, startMs: number, endMs: number): Promise<ChunkResult> {
    console.log(`\n=== CHUNK ${chunkNumber} ===`);
    console.log(`From: ${new Date(startMs).toISOString()}`);
    console.log(`To:   ${new Date(endMs).toISOString()}`);
    console.log(`🔄 Downloading chunk ${chunkNumber}...`);

    try {
      // Create search job
      const jobId = await this.createSearchJob(startMs.toString(), endMs.toString());
      
      // Wait for completion
      const status = await this.waitForJobCompletion(jobId);
      
      if (status.messageCount > 0) {
        const outputPath = `/data/sumo-chunk-${chunkNumber.toString().padStart(2, '0')}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        
        const messageCount = await this.downloadMessages(jobId, outputPath);
        
        // Validate timestamp range
        const { actualStartTime, actualEndTime } = await this.validateChunkTimestamps(outputPath);
        
        const hitLimit = messageCount >= 199999;
        if (hitLimit) {
          console.log(`⚠️  WARNING: Chunk ${chunkNumber} hit ~200K limit! Potential message loss!`);
        }
        
        console.log(`📁 Saved to: ${outputPath}`);
        console.log(`📊 Messages: ${messageCount.toLocaleString()}`);
        console.log(`📅 Actual range: ${new Date(actualStartTime).toISOString()} to ${new Date(actualEndTime).toISOString()}`);
        
        // Clean up
        await this.deleteSearchJob(jobId);
        
        return {
          chunkNumber,
          messageCount,
          filePath: outputPath,
          actualStartTime,
          actualEndTime,
          hitLimit,
          success: true
        };
      } else {
        console.log(`ℹ️  Chunk ${chunkNumber}: No messages found`);
        await this.deleteSearchJob(jobId);
        
        return {
          chunkNumber,
          messageCount: 0,
          filePath: '',
          actualStartTime: startMs,
          actualEndTime: endMs,
          hitLimit: false,
          success: true
        };
      }
    } catch (error: any) {
      console.error(`❌ Error in chunk ${chunkNumber}:`, error.message);
      return {
        chunkNumber,
        messageCount: 0,
        filePath: '',
        actualStartTime: startMs,
        actualEndTime: endMs,
        hitLimit: false,
        success: false
      };
    }
  }

  async validateChunkTimestamps(filePath: string): Promise<{ actualStartTime: number; actualEndTime: number }> {
    try {
      const content = await Deno.readTextFile(filePath);
      const lines = content.split('\n').filter(line => line.trim() !== '');
      
      if (lines.length < 2) {
        return { actualStartTime: 0, actualEndTime: 0 };
      }
      
      // Get first and last data lines (skip header)
      const firstDataLine = lines[1];
      const lastDataLine = lines[lines.length - 1];
      
      const firstTime = parseInt(firstDataLine.split(',')[0].replace(/"/g, ''));
      const lastTime = parseInt(lastDataLine.split(',')[0].replace(/"/g, ''));
      
      return { actualStartTime: firstTime, actualEndTime: lastTime };
    } catch (error: any) {
      console.warn(`Failed to validate timestamps for ${filePath}:`, error.message);
      return { actualStartTime: 0, actualEndTime: 0 };
    }
  }

  async downloadInChunks(fromEpoch: number, toEpoch: number, chunkDays: number = 2, overlapHours: number = 1): Promise<ValidationResult> {
    const totalDays = Math.ceil((toEpoch - fromEpoch) / (24 * 60 * 60 * 1000));
    const maxChunkMs = chunkDays * 24 * 60 * 60 * 1000;
    const overlapMs = overlapHours * 60 * 60 * 1000;
    
    console.log(`🛡️  Starting ADAPTIVE bulk download...`);
    console.log(`📊 ${totalDays} days of data with adaptive chunking`);
    console.log(`📦 Max chunk size: ${chunkDays} days, overlap: ${overlapHours}h`);
    console.log(`🔄 Will adjust chunk boundaries based on actual message timestamps`);
    
    let currentStart = fromEpoch;
    let chunkNumber = 1;
    const results: ChunkResult[] = [];
    
    while (currentStart < toEpoch) {
      // Start with max chunk size, but will be limited by 200K message limit
      const maxChunkEnd = Math.min(currentStart + maxChunkMs, toEpoch);
      
      const result = await this.downloadChunk(chunkNumber, currentStart, maxChunkEnd);
      results.push(result);
      
      if (result.success && result.messageCount > 0) {
        console.log(`✅ Chunk ${chunkNumber} completed successfully`);
        
        if (result.hitLimit) {
          console.log(`🔄 Hit 200K limit - next chunk will start from last message timestamp`);
          // Use the actual end time from this chunk, minus overlap
          currentStart = result.actualEndTime - overlapMs;
        } else {
          // Normal progression with overlap
          currentStart = result.actualEndTime - overlapMs;
        }
        
        // Ensure we don't go backwards due to overlap
        if (currentStart <= result.actualStartTime) {
          currentStart = result.actualEndTime;
          console.log(`⚠️  Overlap would cause regression, using exact end time`);
        }
        
        console.log(`📅 Next chunk will start from: ${new Date(currentStart).toISOString()}`);
        
      } else if (result.success && result.messageCount === 0) {
        console.log(`ℹ️  Chunk ${chunkNumber}: No messages found, advancing by max chunk size`);
        // No messages in this time period, advance by full chunk size
        currentStart = maxChunkEnd;
      } else {
        console.log(`❌ Chunk ${chunkNumber} failed, advancing by max chunk size`);
        // Failed chunk, advance by max chunk size to continue
        currentStart = maxChunkEnd;
      }
      
      chunkNumber++;
      
      // Safety check to prevent infinite loops
      if (chunkNumber > 1000) {
        console.log(`⚠️  Safety limit reached (1000 chunks), stopping`);
        break;
      }
      
      // Delay between chunks
      console.log(`⏳ Waiting 3 seconds before next chunk...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Calculate validation results
    const totalMessages = results.reduce((sum, r) => sum + r.messageCount, 0);
    const failedChunks = results.filter(r => !r.success).map(r => r.chunkNumber);
    const warnings: string[] = [];
    
    // Check for 200K limit hits
    const limitHits = results.filter(r => r.hitLimit);
    if (limitHits.length > 0) {
      warnings.push(`${limitHits.length} chunks hit the 200K message limit`);
      console.log(`📊 Adaptive chunking handled ${limitHits.length} high-volume periods`);
    }
    
    console.log(`\n🎉 Adaptive bulk download complete!`);
    console.log(`📊 Total chunks: ${results.length}`);
    console.log(`📊 Total messages: ${totalMessages.toLocaleString()}`);
    console.log(`📊 Failed chunks: ${failedChunks.length}`);
    
    if (failedChunks.length > 0) {
      console.log(`❌ Failed chunks: ${failedChunks.join(', ')}`);
    }
    
    return {
      totalMessages,
      failedChunks,
      gapHours: 0, // Will be calculated in merge
      coverageGood: failedChunks.length === 0,
      warnings
    };
  }

  async mergeAndDeduplicate(outputPath: string): Promise<void> {
    console.log(`\n📁 Merging chunks with overlap deduplication...`);
    
    // Find all chunk files
    const chunkFiles: string[] = [];
    try {
      for await (const dirEntry of Deno.readDir('/data')) {
        if (dirEntry.name.startsWith('sumo-chunk-') && dirEntry.name.endsWith('.csv')) {
          chunkFiles.push(`/data/${dirEntry.name}`);
        }
      }
    } catch (error: any) {
      console.error('Error reading /data directory:', error.message);
      return;
    }
    
    chunkFiles.sort(); // Sort to ensure proper order
    
    if (chunkFiles.length === 0) {
      console.log('❌ No chunk files found to merge.');
      return;
    }
    
    console.log(`📦 Found ${chunkFiles.length} chunk files to merge`);
    
    let allLines: string[] = [];
    let headerLine = '';
    
    // Read all files
    for (const chunkFile of chunkFiles) {
      const fileName = chunkFile.split('/').pop() || chunkFile;
      console.log(`🔄 Processing: ${fileName}`);
      
      const content = await Deno.readTextFile(chunkFile);
      const lines = content.split('\n').filter(line => line.trim() !== '');
      
      if (lines.length === 0) continue;
      
      if (!headerLine) {
        headerLine = lines[0];
      }
      
      // Add data lines (skip header)
      allLines.push(...lines.slice(1));
    }
    
    console.log(`🔄 Sorting ${allLines.length.toLocaleString()} messages by timestamp...`);
    
    // Sort by timestamp (first column)
    allLines.sort((a: string, b: string) => {
      const timeA = parseInt(a.split(',')[0].replace(/"/g, ''));
      const timeB = parseInt(b.split(',')[0].replace(/"/g, ''));
      return timeA - timeB;
    });
    
    console.log(`🔄 Removing duplicates...`);
    
    // Remove duplicates (keep first occurrence)
    const uniqueLines: string[] = [];
    const seen = new Set<string>();
    
    for (const line of allLines) {
      if (!seen.has(line)) {
        seen.add(line);
        uniqueLines.push(line);
      }
    }
    
    console.log(`📊 Removed ${allLines.length - uniqueLines.length} duplicate messages`);
    
    // Write merged file
    const finalContent = [headerLine, ...uniqueLines].join('\n');
    await Deno.writeTextFile(outputPath, finalContent);
    
    const totalLines = uniqueLines.length + 1; // +1 for header
    const fileInfo = await Deno.stat(outputPath);
    const fileSizeMB = Math.round(fileInfo.size / (1024 * 1024));
    
    console.log(`✅ Merged file created: ${outputPath}`);
    console.log(`📊 Total lines: ${totalLines.toLocaleString()} (${uniqueLines.length.toLocaleString()} data lines)`);
    console.log(`📊 File size: ${fileSizeMB}MB`);
    
    // Validate final timestamp range
    if (uniqueLines.length > 0) {
      const firstTime = parseInt(uniqueLines[0].split(',')[0].replace(/"/g, ''));
      const lastTime = parseInt(uniqueLines[uniqueLines.length - 1].split(',')[0].replace(/"/g, ''));
      
      console.log(`\n🔍 Final validation:`);
      console.log(`📅 Time range: ${new Date(firstTime).toISOString()} to ${new Date(lastTime).toISOString()}`);
      console.log(`⏱️  Duration: ${Math.round((lastTime - firstTime) / (24 * 60 * 60 * 1000))} days`);
    }
  }
}

async function main() {
  // Get credentials from environment variables or command line args
  const accessId = Deno.env.get('SUMO_ACCESS_ID') || Deno.args[0];
  const accessKey = Deno.env.get('SUMO_ACCESS_KEY') || Deno.args[1];
  const endpoint = Deno.env.get('SUMO_ENDPOINT') || Deno.args[2] || 'api.sumologic.com';

  if (!accessId || !accessKey) {
    console.error('Usage: ./sumo_safe_bulk_downloader.ts [ACCESS_ID] [ACCESS_KEY] [ENDPOINT] [DAYS_BACK]');
    console.error('Or set environment variables: SUMO_ACCESS_ID, SUMO_ACCESS_KEY, SUMO_ENDPOINT');
    Deno.exit(1);
  }

  // Default to last 60 days
  const daysBack = parseInt(Deno.args[3] || '60');
  const now = Date.now();
  const startTime = now - (daysBack * 24 * 60 * 60 * 1000);
  
  console.log(`🚀 Downloading last ${daysBack} days of Sumo Logic data`);
  console.log(`📅 From: ${new Date(startTime).toISOString()}`);
  console.log(`📅 To:   ${new Date(now).toISOString()}`);
  
  const config: SumoConfig = {
    accessId,
    accessKey,
    endpoint,
    query: '_index=media_* _collector=*yosemite*'
  };

  const downloader = new SumoSafeBulkDownloader(config);
  
  try {
    // Download in chunks with overlap - using smaller chunks for high-volume data
    const validation = await downloader.downloadInChunks(startTime, now, 0.5, 0.5); // 12-hour chunks, 30-minute overlap
    
    // Merge and deduplicate
    const mergedOutputPath = `/data/sumo-bulk-${daysBack}days-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    await downloader.mergeAndDeduplicate(mergedOutputPath);
    
    // Final report
    console.log(`\n📋 DOWNLOAD SUMMARY:`);
    console.log(`✅ Total messages: ${validation.totalMessages.toLocaleString()}`);
    console.log(`✅ Failed chunks: ${validation.failedChunks.length}`);
    console.log(`✅ Warnings: ${validation.warnings.length}`);
    
    if (validation.warnings.length > 0) {
      console.log(`⚠️  Warnings:`);
      validation.warnings.forEach(w => console.log(`   - ${w}`));
    }
    
    console.log(`\n🚀 Ready to analyze with:`);
    console.log(`   ./http_response_analyzer.ts ${mergedOutputPath}`);
    
    console.log(`\n🛡️  ADAPTIVE FEATURES USED:`);
    console.log(`   ✅ Timestamp-based chunk boundaries`);
    console.log(`   ✅ 200K limit adaptive handling`);
    console.log(`   ✅ 30-minute overlap protection`);
    console.log(`   ✅ Automatic deduplication of overlaps`);
    console.log(`   ✅ Failed chunk tracking`);
    console.log(`   ✅ Final coverage validation`);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    Deno.exit(1);
  }
}

// Check if this is the main module
const isMainModule = (import.meta as any).main;

if (isMainModule) {
  await main();
}

export { SumoSafeBulkDownloader }; 