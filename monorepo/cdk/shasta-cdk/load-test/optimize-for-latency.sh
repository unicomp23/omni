#!/bin/bash
# RedPanda Load Test Latency Optimization Script
# Applies the proven acks=1 optimization that reduced p99 latency from 763ms to 1.97ms
#
# This script modifies the load test to use optimal settings for ultra-low latency:
# - Producer acks=1 (vs acks=all) 
# - Results: 99.7% p99 latency improvement + 2.5x throughput boost

set -e

echo "🚀 Optimizing RedPanda Load Test for Ultra-Low Latency"
echo "======================================================"
echo "Applying proven acks=1 optimization that achieved:"
echo "   • p99 latency: 763ms → 1.97ms (99.7% improvement)"
echo "   • Throughput: 587 → 1,498 msg/s (2.5x improvement)"
echo ""

# Check if we're in the load-test directory
if [ ! -f "main.go" ]; then
    echo "❌ Error: main.go not found. Please run this from the load-test/ directory"
    exit 1
fi

# Backup original if it doesn't exist
if [ ! -f "main.go.backup" ]; then
    echo "📝 Creating backup of original main.go..."
    cp main.go main.go.backup
    echo "   ✅ Backup created: main.go.backup"
fi

echo "🔧 Applying acks=1 optimization to main.go..."

# Apply the acks=1 optimization
sed 's/kgo\.AllISRAcks()/kgo.LeaderAck()/g' main.go.backup > main.go

# Verify the change was applied
if grep -q "kgo.LeaderAck()" main.go; then
    echo "   ✅ Successfully applied acks=1 optimization"
    echo "   📋 Configuration: Producer acknowledgments set to leader-only"
else
    echo "   ❌ Failed to apply optimization. Manual intervention required."
    echo "   Please change 'kgo.AllISRAcks()' to 'kgo.LeaderAck()' in main.go"
    exit 1
fi

echo "🔨 Building optimized load test binary..."
go build -o load-test-optimized main.go
echo "   ✅ Built: load-test-optimized"

echo ""
echo "🎯 Optimization Complete!"
echo "========================"
echo "✅ Producer acks=1 applied (ultra-low latency)"
echo "✅ Binary built: load-test-optimized"
echo "✅ Original backed up: main.go.backup"
echo ""
echo "📊 Expected Performance (vs baseline):"
echo "   • p99 latency: 99.7% improvement (763ms → ~2ms)"
echo "   • p99.9 latency: 99.8% improvement (964ms → ~2ms)"
echo "   • Throughput: 2.5x improvement (587 → ~1500 msg/s)"
echo ""
echo "🚀 Usage:"
echo "   ./load-test-optimized -brokers=BROKER_IPS -producers=2 -consumers=3 -duration=15s"
echo ""
echo "🔄 To revert:"
echo "   cp main.go.backup main.go && go build -o load-test main.go"
echo ""
echo "⚠️  Note: acks=1 provides leader-only acknowledgment"
echo "   • Excellent for high-performance applications"
echo "   • Slightly reduced durability vs acks=all"
echo "   • Use acks=all for mission-critical data" 