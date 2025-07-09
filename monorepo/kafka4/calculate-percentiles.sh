#!/bin/bash

# Calculate Latency Percentiles Script
# This script calculates percentiles from JSONL latency logs

if [ $# -eq 0 ]; then
    echo "Usage: $0 <latency-log-file.jsonl> [label]"
    echo "Example: $0 go-percentile-logs.jsonl \"Go\""
    exit 1
fi

LOGFILE=$1
LABEL=${2:-""}

if [ ! -f "$LOGFILE" ]; then
    echo "Error: File '$LOGFILE' not found!"
    exit 1
fi

echo "📊 Latency Percentiles Analysis: $LABEL"
echo "======================================="
echo "📁 File: $LOGFILE"

# Total records
TOTAL_RECORDS=$(wc -l < "$LOGFILE")
echo "📈 Total Records: $TOTAL_RECORDS"

if [ $TOTAL_RECORDS -eq 0 ]; then
    echo "❌ No records found in $LOGFILE"
    exit 1
fi

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo "❌ jq is required but not installed. Please install jq first."
    exit 1
fi

echo
echo "🔍 Calculating Percentiles..."
echo "============================="

# Extract latency values and sort them
LATENCIES=$(jq -r '.latency_ms' "$LOGFILE" | sort -n)

# Convert to array for easier processing
readarray -t LATENCY_ARRAY <<< "$LATENCIES"
COUNT=${#LATENCY_ARRAY[@]}

if [ $COUNT -eq 0 ]; then
    echo "❌ No valid latency values found"
    exit 1
fi

# Function to calculate percentile
calculate_percentile() {
    local p=$1
    local index=$(echo "scale=0; ($p * $COUNT) / 100" | bc -l)
    # Round down for array index (0-based)
    local idx=$(printf "%.0f" "$index")
    # Ensure we don't exceed array bounds
    if [ $idx -ge $COUNT ]; then
        idx=$((COUNT - 1))
    fi
    echo "${LATENCY_ARRAY[$idx]}"
}

# Calculate basic statistics
MIN=$(echo "$LATENCIES" | head -1)
MAX=$(echo "$LATENCIES" | tail -1)
MEDIAN=$(calculate_percentile 50)

# Calculate average using jq
AVG=$(jq -s 'map(.latency_ms) | add / length' "$LOGFILE")

echo "📊 Basic Statistics:"
echo "  • Min:        ${MIN} ms"
echo "  • Max:        ${MAX} ms"  
echo "  • Average:    ${AVG} ms"
echo "  • Median:     ${MEDIAN} ms"
echo

echo "📈 Percentile Distribution:"
echo "=========================="

# Common percentiles
percentiles=(50 75 90 95 99 99.9)

for p in "${percentiles[@]}"; do
    value=$(calculate_percentile "$p")
    printf "  • P%-5s   %10s ms\n" "$p:" "$value"
done

echo
echo "📋 Percentile Summary Table:"
echo "============================"
printf "| %-10s | %-12s |\n" "Percentile" "Latency (ms)"
printf "|%-10s-|%-12s-|\n" "----------" "------------"
for p in "${percentiles[@]}"; do
    value=$(calculate_percentile "$p")
    printf "| %-10s | %-12s |\n" "P$p" "$value"
done

echo
echo "🎯 Performance Classification:"
echo "============================="

# Performance thresholds (adjust as needed)
P95=$(calculate_percentile 95)
P99=$(calculate_percentile 99)

if (( $(echo "$P95 < 100" | bc -l) )); then
    echo "🟢 Excellent: P95 < 100ms"
elif (( $(echo "$P95 < 500" | bc -l) )); then
    echo "🟡 Good: P95 < 500ms"
elif (( $(echo "$P95 < 1000" | bc -l) )); then
    echo "🟠 Fair: P95 < 1s"
else
    echo "🔴 Needs Improvement: P95 > 1s"
fi

echo
echo "✅ Percentile analysis complete!" 