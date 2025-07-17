#!/bin/bash

# ULTRA-OPTIMIZED 2-Worker Latency Test: 1.8M messages at 2k msg/s
# Enhanced configuration for maximum throughput with minimal latency impact
# Single producer + 2 ultra-optimized consumers

set -e

echo "🚀 Starting ULTRA-OPTIMIZED 2-Worker Latency Test"
echo "📊 Configuration:"
echo "   • Messages: 1,800,000"
echo "   • Rate: 2,000 msg/s"
echo "   • Interval: 0.5ms (500µs)"
echo "   • Expected duration: ~15 minutes"
echo "   • Mode: Single producer + 2 ULTRA-OPTIMIZED consumers"
echo "   • Optimizations: Enhanced fetch settings, reduced coordination overhead"
echo ""

# Calculate interval for 2k msg/s: 1/2000 = 0.0005s = 0.5ms = 500µs
INTERVAL="500us"
COUNT=1800000
OUTPUT_FILE="high-volume-latency-results-2workers-optimized.jsonl"

echo "🔧 Building application..."
make build

echo "🧹 Cleaning up any existing output files..."
rm -f $OUTPUT_FILE

echo "📤 Starting optimized test..."
echo "⏰ Start time: $(date)"

# Use environment variables to enable optimizations
export KAFKA_OPTIMIZE_2_WORKERS=true
export KAFKA_ULTRA_LOW_LATENCY=true

./kafka-test \
  -count $COUNT \
  -interval $INTERVAL \
  -output $OUTPUT_FILE \
  -consumers 2 \
  -wait-time 30s

echo "⏰ End time: $(date)"
echo "✅ Optimized test completed!"
echo "📄 Results saved to: $OUTPUT_FILE"
echo ""
echo "📊 Quick stats:"
echo "   • Total messages: $(wc -l < $OUTPUT_FILE)"
echo "   • File size: $(du -h $OUTPUT_FILE | cut -f1)"
echo ""
echo "🔍 Run './analyze-high-volume-results-2workers-optimized.sh' for detailed latency analysis" 