#!/bin/bash

# Build all binaries from latest source
# Usage: ./build_all.sh
# Useful for preparing all binaries without running anything

set -e

echo "🔨 Building All Binaries from Latest Source"
echo "==========================================="

# Clean all old binaries
echo "🧹 Cleaning all old binaries..."
rm -f loadtest loadtest_standalone loadtest_timing
rm -f rebalance_consumer rebalance_partition rebalance_service rebalance_test

echo "🔄 Building all components..."

# Build main load test
echo "🔨 Building main load test..."
go build -v -o loadtest main.go

# Build standalone load test
echo "🔨 Building standalone load test..."
go build -v -o loadtest_standalone main.go

# Build consumer-based rebalancer
echo "🔨 Building consumer rebalancer..."
cd cmd/rebalance-trigger && go build -v -o ../../rebalance_consumer main.go && cd ../..

# Build partition-based rebalancer
echo "🔨 Building partition rebalancer..."
go build -v -o rebalance_partition partition_rebalancer.go

# Build timing test versions
echo "🔨 Building timing test binaries..."
cp loadtest loadtest_timing
cp rebalance_consumer rebalance_test

echo ""
echo "✅ All binaries built successfully:"
echo "   📊 loadtest                 - Main load test"
echo "   📊 loadtest_standalone      - Load test without rebalancing"
echo "   📊 loadtest_timing          - Load test for timing tests"
echo "   🔄 rebalance_consumer       - Consumer-based rebalancer"
echo "   🔄 rebalance_partition      - Partition-based rebalancer"
echo "   🧪 rebalance_test           - Rebalancer for timing tests"
echo ""
echo "🚀 Ready to run any combination!"