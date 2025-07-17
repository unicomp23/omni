#!/bin/bash

# Multi-Producer Latency Test: 1000 producers, 2 consumers, optimized for latency
# Configuration: 1.8M messages, 2 msg/s per producer, best latency focus

set -e

echo "🚀 Starting Multi-Producer Latency Test (1000 producers)"
echo "📊 Configuration:"
echo "   • Total Messages: 1,800,000"
echo "   • Producers: 1,000"
echo "   • Messages per producer: 1,800"
echo "   • Rate per producer: 2 msg/s"
echo "   • Interval: 500ms (0.5s)"
echo "   • Consumers: 2"
echo "   • Expected duration: ~15 minutes"
echo "   • Mode: Multi-producer latency optimized"
echo "   • Optimization: Ultra-low latency enabled"
echo ""

# Parameters
PRODUCERS=1000
CONSUMERS=2
TOTAL_MESSAGES=1800000
# For 2 msg/s per producer: 1/2 = 0.5s = 500ms
INTERVAL="500ms"
OUTPUT_FILE="multi-producer-latency-results.jsonl"

echo "🔧 Building application..."
make build

echo "🧹 Cleaning up any existing output files..."
rm -f $OUTPUT_FILE
rm -f multi-producer-latency-results-consumer-*.jsonl

echo "📤 Starting multi-producer latency test..."
echo "⏰ Start time: $(date)"

# Enable latency optimization environment variables
export KAFKA_OPTIMIZE_LATENCY=true
export KAFKA_ULTRA_LOW_LATENCY=true

./kafka-test \
  -count $TOTAL_MESSAGES \
  -interval $INTERVAL \
  -output $OUTPUT_FILE \
  -producers $PRODUCERS \
  -consumers $CONSUMERS \
  -optimize-latency \
  -wait-time 60s

echo "⏰ End time: $(date)"
echo "✅ Multi-producer latency test completed!"
echo ""
echo "📊 Quick stats:"
if [ -f "$OUTPUT_FILE" ]; then
    echo "   • Main output file: $OUTPUT_FILE"
    echo "   • Main file messages: $(wc -l < $OUTPUT_FILE)"
    echo "   • Main file size: $(du -h $OUTPUT_FILE | cut -f1)"
fi

# Check for consumer-specific output files
for i in {1..2}; do
    consumer_file="multi-producer-latency-results-consumer-$i.jsonl"
    if [ -f "$consumer_file" ]; then
        echo "   • Consumer $i file: $consumer_file"
        echo "   • Consumer $i messages: $(wc -l < $consumer_file)"
        echo "   • Consumer $i size: $(du -h $consumer_file | cut -f1)"
    fi
done

echo ""
echo "🔍 Use the analysis script to get detailed latency statistics:"
echo "   ./analyze-multi-producer-results.sh" 