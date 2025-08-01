#!/bin/bash

# Analysis script for multi-producer latency test results

echo "🔍 Analyzing Multi-Producer Latency Test Results"
echo "================================================"

# Look for result files
MAIN_FILE="multi-producer-latency-results.jsonl"
CONSUMER_FILES=$(ls multi-producer-latency-results-consumer-*.jsonl 2>/dev/null || echo "")

if [ -f "$MAIN_FILE" ]; then
    echo "📊 Main results file: $MAIN_FILE"
    echo "   • Total messages: $(wc -l < $MAIN_FILE)"
    echo "   • File size: $(du -h $MAIN_FILE | cut -f1)"
    ANALYSIS_FILE="$MAIN_FILE"
elif [ -n "$CONSUMER_FILES" ]; then
    echo "📊 Consumer-specific files found:"
    TOTAL_MESSAGES=0
    for file in $CONSUMER_FILES; do
        MESSAGES=$(wc -l < "$file")
        TOTAL_MESSAGES=$((TOTAL_MESSAGES + MESSAGES))
        echo "   • $file: $MESSAGES messages ($(du -h $file | cut -f1))"
    done
    echo "   • Total messages: $TOTAL_MESSAGES"
    
    # Combine files for analysis
    echo "🔄 Combining consumer files for analysis..."
    cat $CONSUMER_FILES > combined-multi-producer-results.jsonl
    ANALYSIS_FILE="combined-multi-producer-results.jsonl"
    echo "   • Combined file: $ANALYSIS_FILE"
else
    echo "❌ No result files found!"
    echo "Expected files:"
    echo "   • $MAIN_FILE"
    echo "   • multi-producer-latency-results-consumer-*.jsonl"
    exit 1
fi

echo ""
echo "🔍 Latency Analysis for: $ANALYSIS_FILE"
echo "========================================"

# Basic latency statistics using jq if available
if command -v jq &> /dev/null; then
    echo "📈 Latency Statistics (in milliseconds):"
    
    # Extract latency values and calculate statistics
    LATENCIES=$(jq -r '.latency_ms' "$ANALYSIS_FILE" 2>/dev/null | sort -n)
    
    if [ -n "$LATENCIES" ]; then
        echo "$LATENCIES" | awk '
        BEGIN { sum = 0; count = 0; }
        { 
            latencies[count] = $1; 
            sum += $1; 
            count++; 
        }
        END {
            if (count > 0) {
                mean = sum / count;
                
                # Calculate percentiles
                p50_idx = int(count * 0.5);
                p90_idx = int(count * 0.9);
                p95_idx = int(count * 0.95);
                p99_idx = int(count * 0.99);
                p999_idx = int(count * 0.999);
                p9999_idx = int(count * 0.9999);
                
                printf "   • Count: %d messages\n", count;
                printf "   • Mean: %.2f ms\n", mean;
                printf "   • Min: %.2f ms\n", latencies[0];
                printf "   • P50: %.2f ms\n", latencies[p50_idx];
                printf "   • P90: %.2f ms\n", latencies[p90_idx];
                printf "   • P95: %.2f ms\n", latencies[p95_idx];
                printf "   • P99: %.2f ms\n", latencies[p99_idx];
                printf "   • P99.9: %.2f ms\n", latencies[p999_idx];
                printf "   • P99.99: %.2f ms\n", latencies[p9999_idx];
                printf "   • Max: %.2f ms\n", latencies[count-1];
            }
        }'
    else
        echo "❌ Could not extract latency data from JSON"
    fi
else
    echo "⚠️  jq not available, showing basic file stats only"
    echo "   • Total records: $(wc -l < $ANALYSIS_FILE)"
    echo "   • First few records:"
    head -5 "$ANALYSIS_FILE"
fi

echo ""
echo "📝 Analysis complete!"
echo "💡 For detailed analysis, consider:"
echo "   • Installing jq for JSON processing"
echo "   • Using additional analysis tools"
echo "   • Comparing with baseline tests" 