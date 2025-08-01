#!/bin/bash

# Multi-Producer Ultra-Low Latency Test - FIXED VERSION
# Goal: Best latency (not throughput)
# 1000 producers * 2 msg/s = 2000 msg/s total
# 1.8M messages / 2000 msg/s = 900 seconds = 15 minutes expected

set -e

echo "🚀 Starting Multi-Producer Ultra-Low Latency Test - FIXED VERSION"
echo "📊 Configuration:"
echo "   • Total Messages: 1,800,000"
echo "   • Producers: 1,000"
echo "   • Rate per producer: 2 msg/s"
echo "   • Total rate: 2,000 msg/s"
echo "   • Expected duration: ~15 minutes"
echo "   • Consumers: 2 (ultra-optimized)"
echo "   • Goal: BEST LATENCY (not throughput)"
echo "   • Fix: Longer consumer wait time to ensure message processing"
echo ""

# Calculate interval for 2 msg/s per producer: 1/2 = 0.5s = 500ms
INTERVAL="500ms"
COUNT=1800000
PRODUCERS=1000
CONSUMERS=2
OUTPUT_FILE="multi-producer-latency-results.jsonl"

echo "🔧 Building application..."
export PATH=/usr/local/go/bin:$PATH
go build -o kafka-test .

echo "🧹 Cleaning up any existing output files..."
rm -f $OUTPUT_FILE
rm -f multi-producer-latency-results-consumer-*.jsonl

echo "🌍 Setting ultra-low latency environment variables..."
export KAFKA_OPTIMIZE_2_WORKERS=true
export KAFKA_ULTRA_LOW_LATENCY=true

echo "📤 Starting ultra-low latency test with extended wait time..."
echo "⏰ Start time: $(date)"

# Use a much longer wait time to ensure consumers stay alive during the entire producer phase
# 15 minutes for producer + 5 minutes buffer = 20 minutes total wait time
./kafka-test \
  -count $COUNT \
  -interval $INTERVAL \
  -producers $PRODUCERS \
  -consumers $CONSUMERS \
  -optimize-latency \
  -output $OUTPUT_FILE \
  -wait-time 20m

echo "⏰ End time: $(date)"
echo "✅ Multi-producer test completed!"
echo "📄 Results saved to: $OUTPUT_FILE"

echo ""
echo "📊 Quick stats:"
if [ -f "$OUTPUT_FILE" ]; then
    echo "   • Total messages: $(wc -l < $OUTPUT_FILE)"
    echo "   • File size: $(du -h $OUTPUT_FILE | cut -f1)"
else
    echo "   • Checking individual consumer files..."
    CONSUMER_FILES=$(ls multi-producer-latency-results-consumer-*.jsonl 2>/dev/null || echo "")
    if [ -n "$CONSUMER_FILES" ]; then
        TOTAL_MESSAGES=0
        for file in $CONSUMER_FILES; do
            MESSAGES=$(wc -l < "$file")
            TOTAL_MESSAGES=$((TOTAL_MESSAGES + MESSAGES))
            echo "   • $file: $MESSAGES messages"
        done
        echo "   • Total messages: $TOTAL_MESSAGES"
        
        # Combine files if they exist
        if [ $TOTAL_MESSAGES -gt 0 ]; then
            echo "   • Combining consumer files..."
            cat multi-producer-latency-results-consumer-*.jsonl > $OUTPUT_FILE
            echo "   • Combined file created: $OUTPUT_FILE"
        fi
    else
        echo "   • No output files found"
    fi
fi

echo ""
echo "🔍 Analysis:"
if [ -f "$OUTPUT_FILE" ] && [ -s "$OUTPUT_FILE" ]; then
    echo "   • Success! Results file contains data"
    echo "   • Run './analyze-multi-producer-results.sh' for detailed latency analysis"
else
    echo "   • ⚠️  No results data found. Possible issues:"
    echo "     - Consumers finished before producers started"
    echo "     - Consumer group coordination issue"
    echo "     - Topic partitioning issue"
    echo "   • Check the test logs above for error messages"
fi

echo ""
echo "🎯 Multi-Producer Test Summary:"
echo "   • 1000 producers each sending 1800 messages at 2 msg/s"
echo "   • 2 ultra-optimized consumers with extended wait time"
echo "   • Goal: Ultra-low latency with high message volume" 