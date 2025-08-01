#!/bin/bash

# Comprehensive Latency Analysis Script
# Provides detailed statistics up to 99.99 percentile

set -e

OUTPUT_FILE="high-volume-latency-results.jsonl"
TEMP_LATENCIES="/tmp/latencies_sorted.txt"

if [ ! -f "$OUTPUT_FILE" ]; then
    echo "❌ Error: Results file '$OUTPUT_FILE' not found"
    echo "🔧 Run './high-volume-test.sh' first to generate test results"
    exit 1
fi

echo "📊 High-Volume Latency Analysis"
echo "════════════════════════════════"
echo ""

# Extract and sort latencies
echo "🔍 Processing latency data..."
cat $OUTPUT_FILE | jq -r '.latency_ms' | sort -n > $TEMP_LATENCIES

# Basic statistics
echo "📈 Basic Statistics:"
echo "────────────────────"
TOTAL_MESSAGES=$(wc -l < $TEMP_LATENCIES)
MIN_LATENCY=$(head -n 1 $TEMP_LATENCIES)
MAX_LATENCY=$(tail -n 1 $TEMP_LATENCIES)
AVG_LATENCY=$(cat $TEMP_LATENCIES | awk '{sum+=$1; count++} END {printf "%.3f", sum/count}')

echo "   • Total messages: $(printf "%'d" $TOTAL_MESSAGES)"
echo "   • Min latency: ${MIN_LATENCY}ms"
echo "   • Max latency: ${MAX_LATENCY}ms"
echo "   • Average latency: ${AVG_LATENCY}ms"
echo ""

# Comprehensive percentile analysis
echo "🎯 Percentile Analysis (up to 99.99%):"
echo "──────────────────────────────────────"

# Calculate percentiles
calculate_percentile() {
    local percentile=$1
    local total=$2
    local position=$(echo "scale=0; $total * $percentile / 100" | bc -l)
    # Round to nearest integer
    position=$(printf "%.0f" $position)
    # Ensure we don't exceed bounds
    if [ $position -lt 1 ]; then position=1; fi
    if [ $position -gt $total ]; then position=$total; fi
    sed -n "${position}p" $TEMP_LATENCIES
}

# Standard percentiles
P50=$(calculate_percentile 50 $TOTAL_MESSAGES)
P75=$(calculate_percentile 75 $TOTAL_MESSAGES)
P90=$(calculate_percentile 90 $TOTAL_MESSAGES)
P95=$(calculate_percentile 95 $TOTAL_MESSAGES)
P99=$(calculate_percentile 99 $TOTAL_MESSAGES)

# High percentiles
P99_9=$(calculate_percentile 99.9 $TOTAL_MESSAGES)
P99_99=$(calculate_percentile 99.99 $TOTAL_MESSAGES)

echo "   • P50  (median): ${P50}ms"
echo "   • P75:           ${P75}ms"
echo "   • P90:           ${P90}ms"
echo "   • P95:           ${P95}ms"
echo "   • P99:           ${P99}ms"
echo "   • P99.9:         ${P99_9}ms"
echo "   • P99.99:        ${P99_99}ms"
echo ""

# Latency distribution analysis
echo "📊 Latency Distribution:"
echo "────────────────────────"

# Count messages in different latency ranges
UNDER_1MS=$(awk '$1 < 1 {count++} END {print count+0}' $TEMP_LATENCIES)
UNDER_5MS=$(awk '$1 < 5 {count++} END {print count+0}' $TEMP_LATENCIES)
UNDER_10MS=$(awk '$1 < 10 {count++} END {print count+0}' $TEMP_LATENCIES)
UNDER_50MS=$(awk '$1 < 50 {count++} END {print count+0}' $TEMP_LATENCIES)
UNDER_100MS=$(awk '$1 < 100 {count++} END {print count+0}' $TEMP_LATENCIES)
OVER_100MS=$(awk '$1 >= 100 {count++} END {print count+0}' $TEMP_LATENCIES)

echo "   • < 1ms:    $(printf "%'7d" $UNDER_1MS) messages ($(echo "scale=2; $UNDER_1MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo "   • < 5ms:    $(printf "%'7d" $UNDER_5MS) messages ($(echo "scale=2; $UNDER_5MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo "   • < 10ms:   $(printf "%'7d" $UNDER_10MS) messages ($(echo "scale=2; $UNDER_10MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo "   • < 50ms:   $(printf "%'7d" $UNDER_50MS) messages ($(echo "scale=2; $UNDER_50MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo "   • < 100ms:  $(printf "%'7d" $UNDER_100MS) messages ($(echo "scale=2; $UNDER_100MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo "   • >= 100ms: $(printf "%'7d" $OVER_100MS) messages ($(echo "scale=2; $OVER_100MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo ""

# Throughput analysis
echo "⚡ Throughput Analysis:"
echo "──────────────────────"

# Calculate actual throughput based on timestamps
FIRST_TIMESTAMP=$(head -n 1 $OUTPUT_FILE | jq -r '.produced_at')
LAST_TIMESTAMP=$(tail -n 1 $OUTPUT_FILE | jq -r '.produced_at')

# Convert to epoch seconds for calculation
FIRST_EPOCH=$(date -d "$FIRST_TIMESTAMP" +%s 2>/dev/null || echo "0")
LAST_EPOCH=$(date -d "$LAST_TIMESTAMP" +%s 2>/dev/null || echo "1")

if [ $FIRST_EPOCH -ne 0 ] && [ $LAST_EPOCH -ne 0 ] && [ $LAST_EPOCH -gt $FIRST_EPOCH ]; then
    DURATION=$((LAST_EPOCH - FIRST_EPOCH))
    ACTUAL_THROUGHPUT=$(echo "scale=2; $TOTAL_MESSAGES / $DURATION" | bc -l)
    echo "   • Test duration: ${DURATION} seconds"
    echo "   • Actual throughput: ${ACTUAL_THROUGHPUT} msg/s"
    echo "   • Target throughput: 2,000 msg/s"
else
    echo "   • Unable to calculate throughput from timestamps"
fi
echo ""

# SLA compliance analysis
echo "🎯 SLA Compliance Analysis:"
echo "──────────────────────────"

# Common SLA thresholds
SLA_1MS=$(awk '$1 <= 1 {count++} END {print count+0}' $TEMP_LATENCIES)
SLA_5MS=$(awk '$1 <= 5 {count++} END {print count+0}' $TEMP_LATENCIES)
SLA_10MS=$(awk '$1 <= 10 {count++} END {print count+0}' $TEMP_LATENCIES)
SLA_50MS=$(awk '$1 <= 50 {count++} END {print count+0}' $TEMP_LATENCIES)

echo "   • <= 1ms:  $(printf "%'7d" $SLA_1MS) messages ($(echo "scale=2; $SLA_1MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo "   • <= 5ms:  $(printf "%'7d" $SLA_5MS) messages ($(echo "scale=2; $SLA_5MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo "   • <= 10ms: $(printf "%'7d" $SLA_10MS) messages ($(echo "scale=2; $SLA_10MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo "   • <= 50ms: $(printf "%'7d" $SLA_50MS) messages ($(echo "scale=2; $SLA_50MS * 100 / $TOTAL_MESSAGES" | bc -l)%)"
echo ""

# Generate CSV for further analysis
CSV_OUTPUT="high-volume-latency-stats.csv"
echo "📄 Generating CSV summary: $CSV_OUTPUT"
echo "metric,value,unit" > $CSV_OUTPUT
echo "total_messages,$TOTAL_MESSAGES,count" >> $CSV_OUTPUT
echo "min_latency,$MIN_LATENCY,ms" >> $CSV_OUTPUT
echo "max_latency,$MAX_LATENCY,ms" >> $CSV_OUTPUT
echo "avg_latency,$AVG_LATENCY,ms" >> $CSV_OUTPUT
echo "p50_latency,$P50,ms" >> $CSV_OUTPUT
echo "p75_latency,$P75,ms" >> $CSV_OUTPUT
echo "p90_latency,$P90,ms" >> $CSV_OUTPUT
echo "p95_latency,$P95,ms" >> $CSV_OUTPUT
echo "p99_latency,$P99,ms" >> $CSV_OUTPUT
echo "p99_9_latency,$P99_9,ms" >> $CSV_OUTPUT
echo "p99_99_latency,$P99_99,ms" >> $CSV_OUTPUT

echo ""
echo "✅ Analysis complete!"
echo "📊 Key insights:"
echo "   • Ultra-high percentile (P99.99): ${P99_99}ms"
echo "   • High percentile (P99.9): ${P99_9}ms"
echo "   • Standard high percentile (P99): ${P99}ms"
echo "   • Median performance (P50): ${P50}ms"
echo ""
echo "📁 Files generated:"
echo "   • Raw results: $OUTPUT_FILE"
echo "   • CSV summary: $CSV_OUTPUT"
echo "   • Temp sorted data: $TEMP_LATENCIES"

# Cleanup
rm -f $TEMP_LATENCIES 