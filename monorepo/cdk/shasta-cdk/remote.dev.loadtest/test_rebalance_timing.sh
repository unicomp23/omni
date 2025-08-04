#!/bin/bash

# Quick test to measure actual rebalance timing in your setup
# Usage: ./test_rebalance_timing.sh
# Always rebuilds from latest source before running

set -e

echo "🧪 Testing Rebalance Timing in Your Redpanda Cluster"
echo "======================================================"
echo "🔄 Rebuilding from latest source..."

# Clean old binaries
echo "🧹 Cleaning old test binaries..."
rm -f rebalance_test loadtest_timing

# Build the rebalance trigger from source
echo "🔨 Building rebalance trigger from source..."
cd cmd/rebalance-trigger && go build -v -o ../../rebalance_test main.go && cd ../..

# Build a timing-specific load test binary
echo "🔨 Building load test from source..."
go build -v -o loadtest_timing main.go

echo "✅ Test binaries rebuilt successfully"

# Start a quick load test in background
echo "🚀 Starting 2-minute load test..."
timeout 120s ./loadtest_timing &
LOADTEST_PID=$!

# Wait for load test to stabilize
echo "⏳ Waiting 10s for load test to stabilize..."
sleep 10

# Measure rebalance timing
echo "🔄 Triggering test rebalance and measuring timing..."
echo "⏰ Start time: $(date '+%H:%M:%S.%3N')"

# Start rebalance trigger and capture output with timestamps
./rebalance_test &
REBALANCE_PID=$!

# Monitor for 30 seconds to capture the rebalance
sleep 30

# Cleanup
echo "🛑 Cleaning up..."
kill $REBALANCE_PID 2>/dev/null || true
kill $LOADTEST_PID 2>/dev/null || true
wait $REBALANCE_PID 2>/dev/null || true
wait $LOADTEST_PID 2>/dev/null || true

echo "✅ Timing test completed"
echo ""
echo "📊 Check the logs above for:"
echo "   • 'Creating temporary consumer' → Detection start"
echo "   • 'Temporary consumer joining group' → Rebalance initiation"  
echo "   • 'Rebalance triggered successfully' → Completion"
echo ""
echo "🎯 Your actual rebalance time = Completion - Detection timestamps"