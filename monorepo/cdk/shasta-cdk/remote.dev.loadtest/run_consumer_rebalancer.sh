#!/bin/bash

# Dedicated script to run consumer-based rebalancer only
# Usage: ./run_consumer_rebalancer.sh
# Always rebuilds from latest source before running

set -e

echo "🔄 Consumer-Based Rebalancer (Standalone)"
echo "=========================================="
echo "🔄 Rebuilding from latest source..."

# Clean old binaries
echo "🧹 Cleaning old binaries..."
rm -f rebalance_consumer

# Build from source with verbose output
echo "🔨 Building consumer rebalancer from source..."
cd cmd/rebalance-trigger && go build -v -o ../../rebalance_consumer main.go && cd ../..

echo "✅ Consumer rebalancer rebuilt successfully"

# Run the rebalancer
echo "🚀 Starting consumer-based rebalancer..."
echo "💡 This will trigger rebalances every hour by creating temporary consumers"
echo "🛑 Press Ctrl+C to stop"
echo ""

./rebalance_consumer