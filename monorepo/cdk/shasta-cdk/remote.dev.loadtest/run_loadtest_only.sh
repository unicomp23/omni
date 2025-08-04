#!/bin/bash

# Dedicated script to run load test only (no rebalancing)
# Usage: ./run_loadtest_only.sh
# Always rebuilds from latest source before running

set -e

echo "🚀 Redpanda Load Test (No Rebalancing)"
echo "======================================"
echo "🔄 Rebuilding from latest source..."

# Clean old binaries
echo "🧹 Cleaning old binaries..."
rm -f loadtest_standalone

# Build from source with verbose output
echo "🔨 Building load test from source..."
go build -v -o loadtest_standalone main.go

echo "✅ Load test rebuilt successfully"

# Show configuration
echo ""
echo "🔧 Environment variables:"
echo "   REDPANDA_BROKERS=${REDPANDA_BROKERS:-using defaults}"
echo ""

# Run the load test
echo "🚀 Starting load test..."
echo "💡 This runs the 3-week load test without any rebalancing triggers"
echo "🛑 Press Ctrl+C to stop early"
echo ""

./loadtest_standalone