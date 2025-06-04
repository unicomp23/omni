#!/bin/bash

# Safe bulk downloader with overlap detection and validation
# Prevents message loss across chunks

echo "🛡️  Starting SAFE 60-day bulk download with overlap detection..."

# Calculate timestamps (60 days ago to now)
NOW=$(date +%s)
SIXTY_DAYS_AGO=$((NOW - 60*24*60*60))

echo "Time range: $(date -d @$SIXTY_DAYS_AGO) to $(date -d @$NOW)"
echo "That's $((($NOW - $SIXTY_DAYS_AGO) / 86400)) days of data"

# Convert to milliseconds for Sumo Logic API
START_MS=$((SIXTY_DAYS_AGO * 1000))
END_MS=$((NOW * 1000))

# 2-day chunks with 1-hour overlap to prevent boundary loss
CHUNK_MS=$((2 * 24 * 60 * 60 * 1000))  # 2 days
OVERLAP_MS=$((1 * 60 * 60 * 1000))      # 1 hour overlap

CURRENT_START=$START_MS
CHUNK_NUM=1
TOTAL_MESSAGES=0
FAILED_CHUNKS=()

echo "📦 Downloading in 2-day chunks with 1-hour overlap..."
echo "🔄 Overlap prevents boundary message loss"

while [ $CURRENT_START -lt $END_MS ]; do
    # Calculate chunk end with overlap
    CHUNK_END=$((CURRENT_START + CHUNK_MS))
    if [ $CHUNK_END -gt $END_MS ]; then
        CHUNK_END=$END_MS
    fi
    
    echo ""
    echo "=== CHUNK $CHUNK_NUM ==="
    echo "From: $(date -d @$((CURRENT_START / 1000)))"
    echo "To:   $(date -d @$((CHUNK_END / 1000)))"
    
    # Run the downloader for this chunk
    echo "🔄 Downloading chunk $CHUNK_NUM..."
    ./sumo_downloader.ts "$CURRENT_START" "$CHUNK_END"
    
    if [ $? -eq 0 ]; then
        # Validate the download
        LATEST_FILE=$(ls -t /data/sumo-records-*.csv | head -1)
        if [ -f "$LATEST_FILE" ]; then
            # Check if we hit the 200K limit (potential data loss)
            CHUNK_MESSAGES=$(wc -l < "$LATEST_FILE")
            CHUNK_MESSAGES=$((CHUNK_MESSAGES - 1))  # Subtract header
            
            if [ $CHUNK_MESSAGES -ge 199999 ]; then
                echo "⚠️  WARNING: Chunk $CHUNK_NUM hit ~200K limit! Potential message loss!"
                echo "⚠️  Consider smaller chunks for this time period"
                echo "⚠️  Messages in chunk: $CHUNK_MESSAGES"
            fi
            
            # Rename with chunk info
            NEW_NAME="/data/sumo-chunk-$(printf "%02d" $CHUNK_NUM)-$(basename "$LATEST_FILE")"
            mv "$LATEST_FILE" "$NEW_NAME"
            echo "📁 Renamed to: $NEW_NAME"
            echo "📊 Messages in chunk: $CHUNK_MESSAGES"
            
            # Validate timestamp range in the file
            echo "🔍 Validating timestamp range..."
            FIRST_TIME=$(head -2 "$NEW_NAME" | tail -1 | cut -d',' -f1 | tr -d '"')
            LAST_TIME=$(tail -1 "$NEW_NAME" | cut -d',' -f1 | tr -d '"')
            
            if [ ! -z "$FIRST_TIME" ] && [ ! -z "$LAST_TIME" ]; then
                echo "📅 Actual range: $(date -d @$((FIRST_TIME / 1000))) to $(date -d @$((LAST_TIME / 1000)))"
                
                # Check for gaps (if first message is much later than expected)
                EXPECTED_START_SEC=$((CURRENT_START / 1000))
                ACTUAL_START_SEC=$((FIRST_TIME / 1000))
                GAP_HOURS=$(( (ACTUAL_START_SEC - EXPECTED_START_SEC) / 3600 ))
                
                if [ $GAP_HOURS -gt 2 ]; then
                    echo "⚠️  WARNING: ${GAP_HOURS}h gap at start of chunk! Possible missing data."
                fi
            fi
            
            TOTAL_MESSAGES=$((TOTAL_MESSAGES + CHUNK_MESSAGES))
            echo "✅ Chunk $CHUNK_NUM completed successfully"
        else
            echo "❌ Chunk $CHUNK_NUM: No output file found"
            FAILED_CHUNKS+=($CHUNK_NUM)
        fi
    else
        echo "❌ Chunk $CHUNK_NUM failed"
        FAILED_CHUNKS+=($CHUNK_NUM)
    fi
    
    # Move to next chunk (subtract overlap to prevent gaps)
    CURRENT_START=$((CHUNK_END - OVERLAP_MS))
    CHUNK_NUM=$((CHUNK_NUM + 1))
    
    # Delay between chunks
    echo "⏳ Waiting 5 seconds before next chunk..."
    sleep 5
done

echo ""
echo "🎉 Bulk download complete!"
echo "📊 Total chunks: $((CHUNK_NUM - 1))"
echo "📊 Estimated total messages: $TOTAL_MESSAGES"

# Report failed chunks
if [ ${#FAILED_CHUNKS[@]} -gt 0 ]; then
    echo "❌ Failed chunks: ${FAILED_CHUNKS[*]}"
    echo "⚠️  You may have data gaps! Consider re-running failed chunks."
else
    echo "✅ All chunks downloaded successfully"
fi

# Merge with deduplication
echo ""
echo "📁 Merging chunks with overlap deduplication..."
MERGED_FILE="/data/sumo-bulk-60days-$(date +%Y%m%d-%H%M%S).csv"

# Create temporary file for deduplication
TEMP_FILE="/tmp/sumo_merge_temp.csv"

# Start with header from first chunk
FIRST_CHUNK=$(ls /data/sumo-chunk-*.csv | head -1)
if [ -f "$FIRST_CHUNK" ]; then
    head -1 "$FIRST_CHUNK" > "$TEMP_FILE"
    
    echo "🔄 Merging and deduplicating overlapping data..."
    
    # Combine all data (skip headers)
    for chunk_file in /data/sumo-chunk-*.csv; do
        echo "Processing: $(basename "$chunk_file")"
        tail -n +2 "$chunk_file" >> "$TEMP_FILE"
    done
    
    # Sort by timestamp and remove duplicates
    echo "🔄 Sorting by timestamp and removing duplicates..."
    (head -1 "$TEMP_FILE" && tail -n +2 "$TEMP_FILE" | sort -t',' -k1,1n | uniq) > "$MERGED_FILE"
    
    # Clean up temp file
    rm "$TEMP_FILE"
    
    TOTAL_LINES=$(wc -l < "$MERGED_FILE")
    TOTAL_DATA_LINES=$((TOTAL_LINES - 1))
    
    echo "✅ Merged and deduplicated file created: $MERGED_FILE"
    echo "📊 Total lines: $TOTAL_LINES ($TOTAL_DATA_LINES unique data lines)"
    echo "📊 File size: $(du -h "$MERGED_FILE" | cut -f1)"
    
    # Validate final timestamp range
    echo ""
    echo "🔍 Final validation..."
    FIRST_TIME=$(head -2 "$MERGED_FILE" | tail -1 | cut -d',' -f1 | tr -d '"')
    LAST_TIME=$(tail -1 "$MERGED_FILE" | cut -d',' -f1 | tr -d '"')
    
    if [ ! -z "$FIRST_TIME" ] && [ ! -z "$LAST_TIME" ]; then
        echo "📅 Final range: $(date -d @$((FIRST_TIME / 1000))) to $(date -d @$((LAST_TIME / 1000)))"
        
        # Check coverage
        EXPECTED_START_SEC=$((START_MS / 1000))
        EXPECTED_END_SEC=$((END_MS / 1000))
        ACTUAL_START_SEC=$((FIRST_TIME / 1000))
        ACTUAL_END_SEC=$((LAST_TIME / 1000))
        
        START_GAP_HOURS=$(( (ACTUAL_START_SEC - EXPECTED_START_SEC) / 3600 ))
        END_GAP_HOURS=$(( (EXPECTED_END_SEC - ACTUAL_END_SEC) / 3600 ))
        
        if [ $START_GAP_HOURS -gt 1 ]; then
            echo "⚠️  ${START_GAP_HOURS}h gap at beginning"
        fi
        if [ $END_GAP_HOURS -gt 1 ]; then
            echo "⚠️  ${END_GAP_HOURS}h gap at end"
        fi
        
        if [ $START_GAP_HOURS -le 1 ] && [ $END_GAP_HOURS -le 1 ]; then
            echo "✅ Good coverage - minimal gaps detected"
        fi
    fi
    
    echo ""
    echo "🗑️  Chunk files kept for backup: /data/sumo-chunk-*.csv"
    echo "🗑️  Delete with: rm /data/sumo-chunk-*.csv"
else
    echo "❌ No chunk files found to merge"
fi

echo ""
echo "🚀 Ready to analyze with: ./http_response_analyzer.ts $MERGED_FILE"
echo ""
echo "📋 SAFETY FEATURES USED:"
echo "   ✅ 1-hour overlap between chunks"
echo "   ✅ 200K limit detection and warnings"
echo "   ✅ Timestamp validation per chunk"
echo "   ✅ Gap detection and reporting"
echo "   ✅ Automatic deduplication of overlaps"
echo "   ✅ Failed chunk tracking"
echo "   ✅ Final coverage validation" 