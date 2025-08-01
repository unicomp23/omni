# Kafka Latency Testing Makefile

# Variables
APP_NAME := kafka-test
GO_FILES := $(shell find . -name '*.go' -type f)
BINARY := $(APP_NAME)
TEST_COUNT := 1000
STRESS_COUNT := 10000
INTERVAL := 1ms

# Default target
.PHONY: all
all: build

# Build the application
.PHONY: build
build: $(BINARY)

$(BINARY): $(GO_FILES) go.mod go.sum
	@echo "🔨 Building $(APP_NAME)..."
	go build -o $(BINARY) .
	@echo "✅ Build complete: $(BINARY)"

# Install Go (if not already installed)
.PHONY: install-go
install-go:
	@echo "🔧 Installing Go..."
	@if command -v go >/dev/null 2>&1; then \
		echo "✅ Go is already installed: $$(go version)"; \
	else \
		echo "📦 Go not found, running installation script..."; \
		./install-go.sh; \
	fi
	@echo "✅ Go installation check complete"

# Complete setup (install Go + dependencies)
.PHONY: setup
setup: install-go deps
	@echo "🎉 Complete setup finished! You can now run 'make build' or 'make test'"

# Install dependencies
.PHONY: deps
deps:
	@echo "📦 Installing dependencies..."
	go mod download
	go mod tidy
	@echo "✅ Dependencies installed"

# Format Go code
.PHONY: fmt
fmt:
	@echo "🎨 Formatting Go code..."
	go fmt ./...
	@echo "✅ Code formatted"

# Lint Go code
.PHONY: lint
lint:
	@echo "🔍 Linting Go code..."
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run; \
	else \
		echo "⚠️  golangci-lint not found, using go vet instead"; \
		go vet ./...; \
	fi
	@echo "✅ Linting complete"

# Run basic test
.PHONY: test
test: build
	@echo "🧪 Running basic test ($(TEST_COUNT) messages)..."
	./$(BINARY) -count=$(TEST_COUNT) -interval=$(INTERVAL)

# Run stress test
.PHONY: stress
stress: build
	@echo "🚀 Running stress test ($(STRESS_COUNT) messages)..."
	./$(BINARY) -count=$(STRESS_COUNT) -interval=$(INTERVAL)

# Test robustness (includes warmup and cleanup testing)
.PHONY: test-robust
test-robust: build
	@echo "🛡️  Running robustness test with cleanup and warmup..."
	./$(BINARY) -count=50 -interval=10ms
	@echo "🧪 Testing with small batch (no warmup)..."
	./$(BINARY) -count=5 -interval=100ms

# Run custom test
.PHONY: run
run: build
	@echo "▶️  Running custom test..."
	./$(BINARY) $(ARGS)

# Analyze latest results
.PHONY: analyze
analyze:
	@echo "📊 Analyzing latest latency results..."
	@if [ -f "latency-records.jsonl" ]; then \
		python3 -c "import json,statistics; \
		latencies=[json.loads(line)['latency_ns'] for line in open('latency-records.jsonl')]; \
		latencies.sort(); count=len(latencies); \
		print(f'📈 ANALYSIS: {count:,} events | Avg: {statistics.mean(latencies)/1e6:.2f}ms | Median: {statistics.median(latencies)/1e6:.2f}ms | P99: {latencies[int(count*0.99)]/1e6:.2f}ms')"; \
	else \
		echo "❌ No latency-records.jsonl file found. Run a test first."; \
	fi

# Detailed analysis with percentiles
.PHONY: analyze-detailed
analyze-detailed:
	@echo "📊 Detailed latency analysis..."
	@if [ -f "latency-records.jsonl" ]; then \
		python3 -c "import json,statistics; \
		latencies=[json.loads(line)['latency_ns'] for line in open('latency-records.jsonl')]; \
		latencies.sort(); count=len(latencies); avg=statistics.mean(latencies); \
		print(f'🎯 DETAILED ANALYSIS - {count:,} events'); \
		print(f'Min: {min(latencies)/1e6:.2f}ms | Max: {max(latencies)/1e6:.2f}ms | Avg: {avg/1e6:.2f}ms | Median: {statistics.median(latencies)/1e6:.2f}ms'); \
		print(f'P50: {latencies[int(count*0.5)]/1e6:.2f}ms | P90: {latencies[int(count*0.9)]/1e6:.2f}ms | P95: {latencies[int(count*0.95)]/1e6:.2f}ms'); \
		print(f'P99: {latencies[int(count*0.99)]/1e6:.2f}ms | P99.9: {latencies[int(count*0.999)]/1e6:.2f}ms | P99.99: {latencies[int(count*0.9999)]/1e6:.2f}ms'); \
		sub1ms=sum(1 for x in latencies if x<1e6); \
		print(f'<1ms: {sub1ms:,} ({sub1ms/count*100:.1f}%) | <2ms: {sum(1 for x in latencies if x<2e6):,} ({sum(1 for x in latencies if x<2e6)/count*100:.1f}%)')"; \
	else \
		echo "❌ No latency-records.jsonl file found. Run a test first."; \
	fi

# Benchmark different configurations
.PHONY: benchmark
benchmark: build
	@echo "🏁 Running benchmark suite..."
	@echo "Test 1: Small batch (100 messages)"
	./$(BINARY) -count=100 -interval=1ms -output=bench-100.jsonl
	@echo "Test 2: Medium batch (1000 messages)"
	./$(BINARY) -count=1000 -interval=1ms -output=bench-1000.jsonl
	@echo "Test 3: Large batch (10000 messages)"
	./$(BINARY) -count=10000 -interval=1ms -output=bench-10000.jsonl
	@echo "✅ Benchmark complete"

# Clean up generated files
.PHONY: clean
clean:
	@echo "🧹 Cleaning up..."
	rm -f $(BINARY)
	rm -f kafka-latency-test*
	rm -f *.jsonl
	rm -f bench-*.jsonl
	@echo "✅ Clean complete"

# Clean binaries only
.PHONY: clean-bin
clean-bin:
	@echo "🧹 Cleaning binaries..."
	rm -f $(BINARY)
	rm -f kafka-latency-test*
	@echo "✅ Binaries cleaned"

# Clean logs only
.PHONY: clean-logs
clean-logs:
	@echo "🧹 Cleaning log files..."
	rm -f *.jsonl
	rm -f bench-*.jsonl
	@echo "✅ Log files cleaned"

# Show help
.PHONY: help
help:
	@echo "🔧 Kafka Latency Testing Makefile"
	@echo ""
	@echo "🚀 Quick Start:"
	@echo "  1. Run 'make setup' to install Go and dependencies"
	@echo "  2. Run 'make test' to run a basic latency test"
	@echo "  3. Run 'make analyze-detailed' to see detailed results"
	@echo ""
	@echo "📋 Available targets:"
	@echo "  setup           - Complete setup (install Go + dependencies)"
	@echo "  install-go      - Install Go (if not already installed)"
	@echo "  build           - Build the application"
	@echo "  deps            - Install Go dependencies"
	@echo "  fmt             - Format Go code"
	@echo "  lint            - Lint Go code"
	@echo "  test            - Run basic test ($(TEST_COUNT) messages)"
	@echo "  test-robust     - Run robustness test (warmup + cleanup testing)"
	@echo "  stress          - Run stress test ($(STRESS_COUNT) messages)"
	@echo "  run ARGS='...'  - Run with custom arguments"
	@echo "  analyze         - Quick analysis of latest results"
	@echo "  analyze-detailed - Detailed analysis with percentiles"
	@echo "  benchmark       - Run benchmark suite"
	@echo "  clean           - Clean all generated files"
	@echo "  clean-bin       - Clean binaries only"
	@echo "  clean-logs      - Clean log files only"
	@echo "  help            - Show this help message"
	@echo ""
	@echo "🔧 Variables:"
	@echo "  TEST_COUNT=$(TEST_COUNT)       - Number of messages for basic test"
	@echo "  STRESS_COUNT=$(STRESS_COUNT)     - Number of messages for stress test"
	@echo "  INTERVAL=$(INTERVAL)         - Interval between messages"
	@echo ""
	@echo "💡 Examples:"
	@echo "  make setup      # Complete setup for new developers"
	@echo "  make install-go # Install Go only"
	@echo "  make test"
	@echo "  make stress"
	@echo "  make run ARGS='-count=5000 -interval=500us'"
	@echo "  make benchmark"
	@echo "  make analyze-detailed"

# Show application help
.PHONY: app-help
app-help: build
	@echo "📖 Application help:"
	./$(BINARY) -h 