#!/bin/bash

# Script to run load test with hourly rebalancing
# Usage: ./run_with_rebalance.sh [consumer|partition]
# Always rebuilds from latest source before running

set -e

REBALANCE_TYPE=${1:-consumer}

echo "🚀 Starting Redpanda Load Test with Hourly Rebalancing (${REBALANCE_TYPE} method)"
echo "🔄 Rebuilding from latest source..."

# Clean any existing binaries to ensure fresh build
echo "🧹 Cleaning old binaries..."
rm -f rebalance_service loadtest rebalance_consumer rebalance_partition

# Build the appropriate rebalance trigger
if [ "$REBALANCE_TYPE" = "consumer" ]; then
    echo "🔨 Building consumer-based rebalance trigger from source..."
    cd cmd/rebalance-trigger && go build -v -o ../../rebalance_service main.go && cd ../..
elif [ "$REBALANCE_TYPE" = "partition" ]; then
    echo "🔨 Building partition-based rebalance trigger from source..."
    go build -v -o rebalance_service partition_rebalancer.go
else
    echo "❌ Invalid rebalance type: $REBALANCE_TYPE (use 'consumer' or 'partition')"
    exit 1
fi

# Build the main load test with verbose output to show it's rebuilding
echo "🔨 Building main load test from source..."
go build -v -o loadtest main.go

echo "✅ All binaries rebuilt successfully"

# Start rebalance trigger in background
echo "🔄 Starting ${REBALANCE_TYPE}-based rebalance service..."
./rebalance_service &
REBALANCE_PID=$!

# Function to cleanup background processes
cleanup() {
    echo "🛑 Shutting down rebalance service..."
    kill $REBALANCE_PID 2>/dev/null || true
    wait $REBALANCE_PID 2>/dev/null || true
    echo "✅ Cleanup completed"
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Start main load test
echo "🚀 Starting main load test..."
./loadtest

echo "✅ Load test completed"