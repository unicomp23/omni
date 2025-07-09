#!/bin/bash

# Analyze Latency Logs Script
# This script provides basic analysis of the JSONL latency logs

if [ $# -eq 0 ]; then
    echo "Usage: $0 <latency-log-file.jsonl>"
    echo "Example: $0 golang-latency-logs.jsonl"
    exit 1
fi

LOGFILE=$1

if [ ! -f "$LOGFILE" ]; then
    echo "Error: File '$LOGFILE' not found!"
    exit 1
fi

echo "📊 Analyzing Latency Logs: $LOGFILE"
echo "=================================="

# Total records
TOTAL_RECORDS=$(wc -l < "$LOGFILE")
echo "📈 Total Records: $TOTAL_RECORDS"

# Check if jq is available
if command -v jq &> /dev/null; then
    echo
    echo "🔍 Latency Statistics:"
    echo "====================="
    
    # Extract latency_ms values and calculate stats
    echo "Calculating statistics..."
    
    # Min, Max, Average latency
    MIN_LATENCY=$(jq -s 'map(.latency_ms) | min' "$LOGFILE")
    MAX_LATENCY=$(jq -s 'map(.latency_ms) | max' "$LOGFILE")
    AVG_LATENCY=$(jq -s 'map(.latency_ms) | add / length' "$LOGFILE")
    
    echo "  • Min Latency:     ${MIN_LATENCY} ms"
    echo "  • Max Latency:     ${MAX_LATENCY} ms"
    echo "  • Average Latency: ${AVG_LATENCY} ms"
    
    echo
    echo "📋 Producer/Consumer Breakdown:"
    echo "==============================="
    jq -s 'group_by(.producer) | map({producer: .[0].producer, count: length})' "$LOGFILE"
    
    echo
    echo "🎯 Recent Messages (last 5):"
    echo "============================="
    tail -5 "$LOGFILE" | jq -r '"Message: \(.message_id) | Producer: \(.producer) | Latency: \(.latency_ms) ms"'
    
else
    echo
    echo "⚠️  jq not found. Installing for better analysis..."
    echo "   You can install jq with: apt-get install jq"
    echo
    echo "🔍 Basic Analysis (without jq):"
    echo "==============================="
    echo "  • Recent messages:"
    tail -5 "$LOGFILE"
fi

echo
echo "✅ Analysis complete!"
echo "💡 For advanced analysis, consider:"
echo "   - Import into pandas: pandas.read_json('$LOGFILE', lines=True)"
echo "   - Use with jq: jq '.latency_ms' $LOGFILE | sort -n"
echo "   - Import into database for time-series analysis" 