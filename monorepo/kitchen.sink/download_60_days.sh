#!/bin/bash

# Download 60 days of Sumo Logic data in 3-day chunks
# This bypasses the 200K message limit per search job

echo "🚀 Starting 60-day bulk download..."

# Calculate timestamps (60 days ago to now)
NOW=$(date +%s)
SIXTY_DAYS_AGO=$((NOW - 60*24*60*60))

echo "Time range: $(date -d @$SIXTY_DAYS_AGO) to $(date -d @$NOW)"
echo "That's $((($NOW - $SIXTY_DAYS_AGO) / 86400)) days of data"

# Convert to milliseconds for Sumo Logic API
START_MS=$((SIXTY_DAYS_AGO * 1000))
END_MS=$((NOW * 1000))

# 3-day chunks in milliseconds
CHUNK_MS=$((3 * 24 * 60 * 60 * 1000))

CURRENT_START=$START_MS
CHUNK_NUM=1
TOTAL_MESSAGES=0

echo "📦 Downloading in 3-day chunks..."

while [ $CURRENT_START -lt $END_MS ]; do
    CURRENT_END=$((CURRENT_START + CHUNK_MS))
    if [ $CURRENT_END -gt $END_MS ]; then
        CURRENT_END=$END_MS
    fi
    
    echo ""
    echo "=== CHUNK $CHUNK_NUM ==="
    echo "From: $(date -d @$((CURRENT_START / 1000)))"
    echo "To:   $(date -d @$((CURRENT_END / 1000)))"
    
    # Run the downloader for this chunk
    echo "Downloading chunk $CHUNK_NUM..."
    ./sumo_downloader.ts "$CURRENT_START" "$CURRENT_END"
    
    if [ $? -eq 0 ]; then
        echo "✅ Chunk $CHUNK_NUM completed successfully"
        
        # Rename the file to include chunk number
        LATEST_FILE=$(ls -t /data/sumo-records-*.csv | head -1)
        if [ -f "$LATEST_FILE" ]; then
            NEW_NAME="/data/sumo-chunk-$(printf "%02d" $CHUNK_NUM)-$(basename "$LATEST_FILE")"
            mv "$LATEST_FILE" "$NEW_NAME"
            echo "📁 Renamed to: $NEW_NAME"
            
            # Count messages in this chunk
            CHUNK_MESSAGES=$(wc -l < "$NEW_NAME")
            CHUNK_MESSAGES=$((CHUNK_MESSAGES - 1))  # Subtract header
            TOTAL_MESSAGES=$((TOTAL_MESSAGES + CHUNK_MESSAGES))
            echo "📊 Messages in chunk: $CHUNK_MESSAGES"
        fi
    else
        echo "❌ Chunk $CHUNK_NUM failed"
    fi
    
    CURRENT_START=$CURRENT_END
    CHUNK_NUM=$((CHUNK_NUM + 1))
    
    # Small delay between chunks
    echo "⏳ Waiting 3 seconds before next chunk..."
    sleep 3
done

echo ""
echo "🎉 Bulk download complete!"
echo "📊 Total chunks: $((CHUNK_NUM - 1))"
echo "📊 Estimated total messages: $TOTAL_MESSAGES"

# Merge all chunks
echo ""
echo "📁 Merging all chunks into single file..."
MERGED_FILE="/data/sumo-bulk-60days-$(date +%Y%m%d-%H%M%S).csv"

# Start with header from first chunk
FIRST_CHUNK=$(ls /data/sumo-chunk-*.csv | head -1)
if [ -f "$FIRST_CHUNK" ]; then
    head -1 "$FIRST_CHUNK" > "$MERGED_FILE"
    
    # Append data from all chunks (skip headers)
    for chunk_file in /data/sumo-chunk-*.csv; do
        echo "Merging: $(basename "$chunk_file")"
        tail -n +2 "$chunk_file" >> "$MERGED_FILE"
    done
    
    TOTAL_LINES=$(wc -l < "$MERGED_FILE")
    TOTAL_DATA_LINES=$((TOTAL_LINES - 1))
    
    echo "✅ Merged file created: $MERGED_FILE"
    echo "📊 Total lines: $TOTAL_LINES ($TOTAL_DATA_LINES data lines)"
    echo "📊 File size: $(du -h "$MERGED_FILE" | cut -f1)"
    
    echo ""
    echo "🗑️  Chunk files are kept in /data/ for backup"
    echo "🗑️  You can delete them manually if needed: rm /data/sumo-chunk-*.csv"
else
    echo "❌ No chunk files found to merge"
fi

echo ""
echo "🚀 Ready to analyze with: ./http_response_analyzer.ts $MERGED_FILE" 