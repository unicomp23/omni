#!/bin/bash

# Dedicated script to run partition-based rebalancer only
# Usage: ./run_partition_rebalancer.sh
# Always rebuilds from latest source before running

set -e

echo "🔄 Partition-Based Rebalancer (Standalone)"
echo "=========================================="
echo "🔄 Rebuilding from latest source..."

# Clean old binaries
echo "🧹 Cleaning old binaries..."
rm -f rebalance_partition

# Build from source with verbose output
echo "🔨 Building partition rebalancer from source..."
cd cmd/partition-rebalancer && go build -v -o ../../rebalance_partition main.go && cd ../..

echo "✅ Partition rebalancer rebuilt successfully"

# Run the rebalancer
echo "🚀 Starting partition-based rebalancer..."
echo "💡 This will trigger rebalances every hour via metadata refresh"
echo "🛑 Press Ctrl+C to stop"
echo ""
echo "🔧 Environment variables:"
echo "   REBALANCE_INTERVAL_MINUTES=${REBALANCE_INTERVAL_MINUTES:-60} (default: 60)"
echo "   REDPANDA_BROKERS=${REDPANDA_BROKERS:-using defaults}"
echo ""

./rebalance_partition