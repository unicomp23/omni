#!/bin/bash

# High-Volume Latency Test: 1.8M messages at 2k msg/s
# Expected duration: ~15 minutes
# Single producer, single optimized consumer

set -e

echo "🚀 Starting High-Volume Latency Test"
echo "📊 Configuration:"
echo "   • Messages: 1,800,000"
echo "   • Rate: 2,000 msg/s"
echo "   • Interval: 0.5ms (500µs)"
echo "   • Expected duration: ~15 minutes"
echo "   • Mode: Single producer + Ultra-optimized single consumer"
echo ""

# Calculate interval for 2k msg/s: 1/2000 = 0.0005s = 0.5ms = 500µs
INTERVAL="500us"
COUNT=1800000
OUTPUT_FILE="high-volume-latency-results.jsonl"

echo "🔧 Building application..."
make build

echo "🧹 Cleaning up any existing output files..."
rm -f $OUTPUT_FILE

echo "📤 Starting test..."
echo "⏰ Start time: $(date)"

./kafka-test \
  -count $COUNT \
  -interval $INTERVAL \
  -output $OUTPUT_FILE \
  -optimize-single \
  -wait-time 30s

echo "⏰ End time: $(date)"
echo "✅ Test completed!"
echo "📄 Results saved to: $OUTPUT_FILE"
echo ""
echo "📊 Quick stats:"
echo "   • Total messages: $(wc -l < $OUTPUT_FILE)"
echo "   • File size: $(du -h $OUTPUT_FILE | cut -f1)"
echo ""
echo "🔍 Run './analyze-high-volume-results.sh' for detailed latency analysis" 