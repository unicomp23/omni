#!/bin/bash

# Compare Latency Percentiles Script
# This script compares percentiles between Go and Java implementations

echo "🔄 Generating Fresh Latency Data for Real-Time Comparison..."
echo "==========================================================="

# Generate fresh data with consumers running in background
echo "🚀 Starting consumers..."
timeout 30s docker compose exec -d dev-golang sh -c "cd /workspace/golang-project && go run latency-consumer.go" > fresh-go.jsonl 2>/dev/null &
timeout 30s docker compose exec -d dev-java sh -c "cd /workspace/java-project && java -cp 'target/classes:target/dependency/*' com.example.kafka.SimpleLatencyConsumer" > fresh-java.jsonl 2>/dev/null &

sleep 2

echo "📤 Sending messages from both producers..."
docker compose exec dev-golang sh -c "cd /workspace/golang-project && go run latency-producer.go" &
docker compose exec dev-java sh -c "cd /workspace/java-project && java -cp 'target/classes:target/dependency/*' com.example.kafka.SimpleLatencyProducer" &

wait

echo "⏱️  Waiting for consumers to process messages..."
sleep 10

echo
echo "📊 LATENCY PERCENTILES COMPARISON"
echo "=================================="

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
    if [ "$label" = "Go" ]; then
        GO_P95=$p95
        GO_P99=$p99
        GO_AVG=$avg
    else
        JAVA_P95=$p95  
        JAVA_P99=$p99
        JAVA_AVG=$avg
    fi
}

echo
# Analyze fresh data
extract_percentiles "fresh-go.jsonl" "Go"
extract_percentiles "fresh-java.jsonl" "Java"

echo
echo "📊 SIDE-BY-SIDE PERCENTILE COMPARISON"
echo "====================================="

printf "| %-12s | %-15s | %-15s | %-15s |\n" "Metric" "Go (ms)" "Java (ms)" "Winner"
printf "|%-12s-|%-15s-|%-15s-|%-15s-|\n" "------------" "---------------" "---------------" "---------------"

# Compare if both have data
if [ -n "${GO_P95:-}" ] && [ -n "${JAVA_P95:-}" ]; then
    # P95 comparison
    if (( $(echo "$GO_P95 < $JAVA_P95" | bc -l) )); then
        winner="🟢 Go"
    elif (( $(echo "$JAVA_P95 < $GO_P95" | bc -l) )); then
        winner="🟢 Java"
    else
        winner="🤝 Tie"
    fi
    printf "| %-12s | %-15.2f | %-15.2f | %-15s |\n" "P95" "$GO_P95" "$JAVA_P95" "$winner"
    
    # P99 comparison
    if (( $(echo "$GO_P99 < $JAVA_P99" | bc -l) )); then
        winner="🟢 Go"
    elif (( $(echo "$JAVA_P99 < $GO_P99" | bc -l) )); then
        winner="🟢 Java"
    else
        winner="🤝 Tie"
    fi
    printf "| %-12s | %-15.2f | %-15.2f | %-15s |\n" "P99" "$GO_P99" "$JAVA_P99" "$winner"
    
    # Average comparison
    if (( $(echo "$GO_AVG < $JAVA_AVG" | bc -l) )); then
        winner="🟢 Go"
    elif (( $(echo "$JAVA_AVG < $GO_AVG" | bc -l) )); then
        winner="🟢 Java"
    else
        winner="🤝 Tie"
    fi
    printf "| %-12s | %-15.2f | %-15.2f | %-15s |\n" "Average" "$GO_AVG" "$JAVA_AVG" "$winner"
fi

echo
echo "📋 Analysis Summary:"
echo "==================="

if [ -s "fresh-go.jsonl" ]; then
    go_count=$(wc -l < "fresh-go.jsonl")
    echo "✅ Go:   $go_count latency measurements collected"
else
    echo "❌ Go:   No data collected"
fi

if [ -s "fresh-java.jsonl" ]; then
    java_count=$(wc -l < "fresh-java.jsonl")  
    echo "✅ Java: $java_count latency measurements collected"
else
    echo "❌ Java: No data collected"
fi

echo
echo "💡 For detailed analysis, run:"
echo "   ./calculate-percentiles.sh fresh-go.jsonl \"Fresh Go\""
echo "   ./calculate-percentiles.sh fresh-java.jsonl \"Fresh Java\"" 