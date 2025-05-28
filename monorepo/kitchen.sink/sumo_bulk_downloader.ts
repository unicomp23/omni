#!/usr/bin/env -S deno run --allow-all

import { SumoLogicDownloader } from './sumo_downloader.ts';

interface SumoConfig {
  accessId: string;
  accessKey: string;
  endpoint: string;
  query: string;
}

class SumoBulkDownloader {
  private config: SumoConfig;
  private downloader: any;

  constructor(config: SumoConfig) {
    this.config = config;
  }

  async downloadInChunks(fromEpoch: number, toEpoch: number, chunkDays: number = 3): Promise<void> {
    const totalDays = Math.ceil((toEpoch - fromEpoch) / (24 * 60 * 60 * 1000));
    const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
    
    console.log(`Downloading ${totalDays} days of data in ${chunkDays}-day chunks...`);
    console.log(`Total chunks needed: ${Math.ceil(totalDays / chunkDays)}`);
    
    let currentStart = fromEpoch;
    let chunkNumber = 1;
    let totalMessages = 0;
    
    while (currentStart < toEpoch) {
      const currentEnd = Math.min(currentStart + chunkMs, toEpoch);
      
      console.log(`\n=== CHUNK ${chunkNumber} ===`);
      console.log(`Time range: ${new Date(currentStart).toISOString()} to ${new Date(currentEnd).toISOString()}`);
      
      try {
        const chunkConfig = {
          ...this.config,
          from: currentStart.toString(),
          to: currentEnd.toString()
        };
        
        const downloader = new (await import('./sumo_downloader.ts')).SumoLogicDownloader(chunkConfig);
        
        // Create search job
        const jobId = await downloader.createSearchJob();
        
        // Wait for completion
        const status = await downloader.waitForJobCompletion(jobId);
        
        if (status.messageCount > 0) {
          const outputPath = `/data/sumo-chunk-${chunkNumber}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
          
          if (status.messageCount >= 200000) {
            console.log(`⚠️  Chunk ${chunkNumber} hit the 200K limit! Consider smaller chunks.`);
          }
          
          await downloader.downloadAllMessages(jobId, outputPath);
          totalMessages += status.messageCount;
          
          console.log(`✅ Chunk ${chunkNumber} complete: ${status.messageCount} messages`);
        } else {
          console.log(`ℹ️  Chunk ${chunkNumber}: No messages found`);
        }
        
        // Clean up
        await downloader.deleteSearchJob(jobId);
        
      } catch (error) {
        console.error(`❌ Error in chunk ${chunkNumber}:`, error.message);
      }
      
      currentStart = currentEnd;
      chunkNumber++;
      
      // Small delay between chunks to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n🎉 Bulk download complete!`);
    console.log(`Total messages downloaded: ${totalMessages.toLocaleString()}`);
    console.log(`Total chunks: ${chunkNumber - 1}`);
  }

  async mergeChunks(outputPath: string): Promise<void> {
    console.log('\n📁 Merging chunk files...');
    
    // Find all chunk files
    const chunkFiles: string[] = [];
    for await (const dirEntry of Deno.readDir('/data')) {
      if (dirEntry.name.startsWith('sumo-chunk-') && dirEntry.name.endsWith('.csv')) {
        chunkFiles.push(`/data/${dirEntry.name}`);
      }
    }
    
    chunkFiles.sort(); // Sort to ensure proper order
    
    if (chunkFiles.length === 0) {
      console.log('No chunk files found to merge.');
      return;
    }
    
    console.log(`Found ${chunkFiles.length} chunk files to merge`);
    
    let isFirstFile = true;
    let totalLines = 0;
    
    // Create the merged file
    const mergedFile = await Deno.open(outputPath, { write: true, create: true, truncate: true });
    
    for (const chunkFile of chunkFiles) {
      console.log(`Merging: ${chunkFile}`);
      
      const content = await Deno.readTextFile(chunkFile);
      const lines = content.split('\n');
      
      if (isFirstFile) {
        // Include header for first file
        await mergedFile.write(new TextEncoder().encode(content));
        totalLines += lines.length;
        isFirstFile = false;
      } else {
        // Skip header for subsequent files
        const dataLines = lines.slice(1);
        if (dataLines.length > 0 && dataLines[dataLines.length - 1].trim() === '') {
          dataLines.pop(); // Remove empty last line
        }
        if (dataLines.length > 0) {
          await mergedFile.write(new TextEncoder().encode('\n' + dataLines.join('\n')));
          totalLines += dataLines.length;
        }
      }
    }
    
    mergedFile.close();
    
    console.log(`✅ Merged ${chunkFiles.length} files into ${outputPath}`);
    console.log(`Total lines: ${totalLines.toLocaleString()}`);
    
    // Optionally clean up chunk files
    console.log('\n🗑️  Clean up chunk files? (keeping them for now)');
  }
}

async function main() {
  // Get credentials from environment variables or command line args
  const accessId = Deno.env.get('SUMO_ACCESS_ID') || Deno.args[0];
  const accessKey = Deno.env.get('SUMO_ACCESS_KEY') || Deno.args[1];
  const endpoint = Deno.env.get('SUMO_ENDPOINT') || Deno.args[2] || 'api.sumologic.com';

  if (!accessId || !accessKey) {
    console.error('Usage: ./sumo_bulk_downloader.ts [ACCESS_ID] [ACCESS_KEY] [ENDPOINT] [FROM_EPOCH] [TO_EPOCH] [CHUNK_DAYS]');
    console.error('Or set environment variables: SUMO_ACCESS_ID, SUMO_ACCESS_KEY, SUMO_ENDPOINT');
    Deno.exit(1);
  }

  // Default to last 60 days
  const now = Date.now();
  const sixtyDaysAgo = now - (60 * 24 * 60 * 60 * 1000);
  
  const fromEpoch = parseInt(Deno.args[3] || sixtyDaysAgo.toString());
  const toEpoch = parseInt(Deno.args[4] || now.toString());
  const chunkDays = parseInt(Deno.args[5] || '3'); // 3-day chunks by default
  
  const config: SumoConfig = {
    accessId,
    accessKey,
    endpoint,
    query: '_index=media_* _collector=*yosemite*'
  };

  const bulkDownloader = new SumoBulkDownloader(config);
  
  try {
    // Download in chunks
    await bulkDownloader.downloadInChunks(fromEpoch, toEpoch, chunkDays);
    
    // Merge all chunks
    const mergedOutputPath = `/data/sumo-bulk-60days-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    await bulkDownloader.mergeChunks(mergedOutputPath);
    
  } catch (error) {
    console.error('Error:', error.message);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}

export {}; 