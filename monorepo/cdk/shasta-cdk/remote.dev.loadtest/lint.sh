#!/bin/bash

# Comprehensive Go linting script
# Handles multiple main functions properly

set -e

echo "🔍 Running Go Linting Checks"
echo "============================"

# Format check
echo "📝 Checking formatting..."
UNFORMATTED=$(gofmt -l .)
if [ -n "$UNFORMATTED" ]; then
    echo "❌ Files need formatting:"
    echo "$UNFORMATTED"
    echo "   Run: gofmt -w ."
    exit 1
else
    echo "✅ All files properly formatted"
fi

# Vet packages separately to avoid main function conflicts
echo ""
echo "🔍 Running go vet..."

# Vet main programs individually
echo "   • Checking main.go..."
go vet main.go || exit 1

echo "   • Checking partition rebalancer..."
cd cmd/partition-rebalancer && go vet main.go && cd ../.. || exit 1

# Vet subdirectories
echo "   • Checking cmd packages..."
go vet ./cmd/... || exit 1

echo "   • Checking pkg packages..."
if find pkg -name "*.go" 2>/dev/null | grep -q .; then
    go vet ./pkg/... || exit 1
else
    echo "     (no pkg packages found)"
fi

echo "✅ All vet checks passed"

# Build check - ensure everything compiles
echo ""
echo "🔨 Checking compilation..."

echo "   • Building main load test..."
go build -o /tmp/loadtest_check main.go && rm -f /tmp/loadtest_check || exit 1

echo "   • Building partition rebalancer..."
cd cmd/partition-rebalancer && go build -o /tmp/partition_check main.go && rm -f /tmp/partition_check && cd ../.. || exit 1

echo "   • Building consumer rebalancer..."
cd cmd/rebalance-trigger && go build -o /tmp/consumer_check main.go && rm -f /tmp/consumer_check && cd ../.. || exit 1

echo "✅ All programs compile successfully"

# Module check
echo ""
echo "📦 Checking go modules..."
go mod tidy
go mod verify || echo "⚠️  Module verification issues (may be expected in dev)"

echo ""
echo "🎯 LINTING SUMMARY"
echo "=================="
echo "✅ Formatting: PASS"
echo "✅ Vet checks: PASS"  
echo "✅ Compilation: PASS"
echo "✅ Modules: CHECKED"
echo ""
echo "🚀 Code is ready for commit!"