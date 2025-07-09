#!/bin/bash

# Compare Latency Percentiles Script
# This script compares percentiles between different Go test configurations

if [ $# -lt 2 ]; then
    echo "Usage: $0 <latency-file1.jsonl> <latency-file2.jsonl> [label1] [label2]"
    echo "Example: $0 test1-latency.jsonl test2-latency.jsonl \"High Frequency\" \"Low Frequency\""
    exit 1
fi

FILE1=$1
FILE2=$2
LABEL1=${3:-"Configuration 1"}
LABEL2=${4:-"Configuration 2"}

echo "🔄 LATENCY PERCENTILES COMPARISON"
echo "=================================="
echo "Comparing: $LABEL1 vs $LABEL2"
echo "Files: $FILE1 vs $FILE2"
echo

# Function to extract percentiles from a file
extract_percentiles() {
    local file=$1
    local label=$2
    
    if [ ! -f "$file" ] || [ ! -s "$file" ]; then
        echo "❌ No data for $label"
        return
    fi
    
    local count=$(wc -l < "$file")
    if [ $count -eq 0 ]; then
        echo "❌ No valid records for $label"
        return
    fi
    
    echo "📈 $label ($count records):"
    
    # Extract latency values and sort them
    local latencies=$(jq -r '.latency_ms' "$file" | sort -n)
    readarray -t latency_array <<< "$latencies"
    local total=${#latency_array[@]}
    
    if [ $total -eq 0 ]; then
        echo "❌ No valid latency values for $label"
        return
    fi
    
    # Calculate percentiles
    local min=$(echo "$latencies" | head -1)
    local max=$(echo "$latencies" | tail -1)
    local avg=$(jq -s 'map(.latency_ms) | add / length' "$file")
    
    # Function to calculate percentile
    calc_perc() {
        local p=$1
        local index=$(echo "scale=0; ($p * $total) / 100" | bc -l)
        local idx=$(printf "%.0f" "$index")
        if [ $idx -ge $total ]; then
            idx=$((total - 1))
        fi
        echo "${latency_array[$idx]}"
    }
    
    local p50=$(calc_perc 50)
    local p90=$(calc_perc 90)
    local p95=$(calc_perc 95)
    local p99=$(calc_perc 99)
    
    printf "  Min: %8.2f ms | P50: %8.2f ms | P90: %8.2f ms | P95: %8.2f ms | P99: %8.2f ms | Max: %8.2f ms\n" \
           "$min" "$p50" "$p90" "$p95" "$p99" "$max"
    
    # Store values for comparison
    if [ "$label" = "$LABEL1" ]; then
        CONFIG1_P95=$p95
        CONFIG1_P99=$p99
        CONFIG1_AVG=$avg
        CONFIG1_P50=$p50
    else
        CONFIG2_P95=$p95  
        CONFIG2_P99=$p99
        CONFIG2_AVG=$avg
        CONFIG2_P50=$p50
    fi
}

echo
# Analyze both configurations
extract_percentiles "$FILE1" "$LABEL1"
extract_percentiles "$FILE2" "$LABEL2"

echo
echo "📊 SIDE-BY-SIDE PERCENTILE COMPARISON"
echo "====================================="

printf "| %-12s | %-15s | %-15s | %-15s |\n" "Metric" "$LABEL1 (ms)" "$LABEL2 (ms)" "Winner"
printf "|%-12s-|%-15s-|%-15s-|%-15s-|\n" "------------" "---------------" "---------------" "---------------"

# Compare if both have data
if [ -n "${CONFIG1_P95:-}" ] && [ -n "${CONFIG2_P95:-}" ]; then
    # P50 comparison
    if (( $(echo "$CONFIG1_P50 < $CONFIG2_P50" | bc -l) )); then
        winner="🟢 $LABEL1"
    elif (( $(echo "$CONFIG2_P50 < $CONFIG1_P50" | bc -l) )); then
        winner="🟢 $LABEL2"
    else
        winner="🤝 Tie"
    fi
    printf "| %-12s | %-15.2f | %-15.2f | %-15s |\n" "P50" "$CONFIG1_P50" "$CONFIG2_P50" "$winner"
    
    # P95 comparison
    if (( $(echo "$CONFIG1_P95 < $CONFIG2_P95" | bc -l) )); then
        winner="🟢 $LABEL1"
    elif (( $(echo "$CONFIG2_P95 < $CONFIG1_P95" | bc -l) )); then
        winner="🟢 $LABEL2"
    else
        winner="🤝 Tie"
    fi
    printf "| %-12s | %-15.2f | %-15.2f | %-15s |\n" "P95" "$CONFIG1_P95" "$CONFIG2_P95" "$winner"
    
    # P99 comparison
    if (( $(echo "$CONFIG1_P99 < $CONFIG2_P99" | bc -l) )); then
        winner="🟢 $LABEL1"
    elif (( $(echo "$CONFIG2_P99 < $CONFIG1_P99" | bc -l) )); then
        winner="🟢 $LABEL2"
    else
        winner="🤝 Tie"
    fi
    printf "| %-12s | %-15.2f | %-15.2f | %-15s |\n" "P99" "$CONFIG1_P99" "$CONFIG2_P99" "$winner"
    
    # Average comparison
    if (( $(echo "$CONFIG1_AVG < $CONFIG2_AVG" | bc -l) )); then
        winner="🟢 $LABEL1"
    elif (( $(echo "$CONFIG2_AVG < $CONFIG1_AVG" | bc -l) )); then
        winner="🟢 $LABEL2"
    else
        winner="🤝 Tie"
    fi
    printf "| %-12s | %-15.2f | %-15.2f | %-15s |\n" "Average" "$CONFIG1_AVG" "$CONFIG2_AVG" "$winner"
fi

echo
echo "📋 Analysis Summary:"
echo "==================="

if [ -s "$FILE1" ]; then
    config1_count=$(wc -l < "$FILE1")
    echo "✅ $LABEL1: $config1_count latency measurements"
else
    echo "❌ $LABEL1: No data collected"
fi

if [ -s "$FILE2" ]; then
    config2_count=$(wc -l < "$FILE2")  
    echo "✅ $LABEL2: $config2_count latency measurements"
else
    echo "❌ $LABEL2: No data collected"
fi

echo
echo "💡 For detailed analysis, run:"
echo "   ./calculate-percentiles.sh $FILE1 \"$LABEL1\""
echo "   ./calculate-percentiles.sh $FILE2 \"$LABEL2\""

# Performance insights
echo
echo "🎯 Performance Insights:"
echo "======================="
if [ -n "${CONFIG1_P95:-}" ] && [ -n "${CONFIG2_P95:-}" ]; then
    echo "• Both configurations show latency characteristics"
    if (( $(echo "$CONFIG1_P95 < 100" | bc -l) )) && (( $(echo "$CONFIG2_P95 < 100" | bc -l) )); then
        echo "• Both have excellent P95 performance (<100ms)"
    elif (( $(echo "$CONFIG1_P95 < 500" | bc -l) )) && (( $(echo "$CONFIG2_P95 < 500" | bc -l) )); then
        echo "• Both have good P95 performance (<500ms)"
    fi
    
    # Calculate improvement percentage
    improvement=$(echo "scale=2; (($CONFIG2_P95 - $CONFIG1_P95) / $CONFIG2_P95) * 100" | bc -l)
    if (( $(echo "$improvement > 0" | bc -l) )); then
        echo "• $LABEL1 shows ${improvement}% better P95 than $LABEL2"
    else
        improvement=$(echo "scale=2; (($CONFIG1_P95 - $CONFIG2_P95) / $CONFIG1_P95) * 100" | bc -l)
        echo "• $LABEL2 shows ${improvement}% better P95 than $LABEL1"
    fi
fi 