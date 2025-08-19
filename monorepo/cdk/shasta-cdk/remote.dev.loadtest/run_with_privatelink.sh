#!/bin/bash

# Enhanced run script that automatically loads privatelink environment
# Usage: ./run_with_privatelink.sh

set -e

echo "🚀 Redpanda Load Test (PrivateLink)"
echo "==================================="

# Source the privatelink environment file
if [ -f "redpanda.privatelink.env" ]; then
    echo "📡 Loading PrivateLink environment..."
    source redpanda.privatelink.env
    echo "   REDPANDA_BROKERS: $REDPANDA_BROKERS"
else
    echo "❌ redpanda.privatelink.env not found!"
    exit 1
fi

echo ""
echo "🔄 Rebuilding from latest source..."

# Clean old binaries
echo "🧹 Cleaning old binaries..."
rm -f loadtest_standalone

# Build from source with verbose output
echo "🔨 Building load test from source..."
go build -v -o loadtest_standalone main.go

echo "✅ Load test rebuilt successfully"

# Show final configuration
echo ""
echo "🔧 Configuration:"
echo "   Broker: $REDPANDA_BROKERS"
echo "   TLS: Enabled (cloud endpoint detected)"
echo ""

# Run the load test
echo "🚀 Starting load test..."
echo "💡 This runs the 3-week load test using PrivateLink"
echo "🛑 Press Ctrl+C to stop early"
echo ""

./loadtest_standalone
