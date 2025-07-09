#!/bin/bash

# Collect Latency Logs Script
# This script runs Go latency consumers and saves logs to files

if [ $# -eq 0 ]; then
    echo "Usage: $0 <duration_seconds> [message_count] [spacing_ms]"
    echo "Example: $0 30 1000 10"
    exit 1
fi

DURATION=$1
MESSAGE_COUNT=${2:-1000}
SPACING_MS=${3:-10}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Output files
GO_JSONL="go-latency-${TIMESTAMP}.jsonl"
GO_DEBUG="go-latency-${TIMESTAMP}.debug"

echo "🚀 Starting Go Latency Data Collection"
echo "======================================"
echo "Duration: ${DURATION}s"
echo "Messages: ${MESSAGE_COUNT}"
echo "Spacing: ${SPACING_MS}ms"
echo "Timestamp: ${TIMESTAMP}"
echo ""
echo "Output files:"
echo "  - Go JSONL:     ${GO_JSONL}"
echo "  - Go Debug:     ${GO_DEBUG}"
echo ""

# Function to run a consumer in the background and save logs
run_consumer() {
    local name=$1
    local jsonl_file=$2
    local debug_file=$3
    local command=$4
    
    echo "Starting $name latency consumer..."
    
    # Run the consumer command, splitting stdout (JSONL) and stderr (debug)
    timeout ${DURATION}s bash -c "$command" > "${jsonl_file}" 2> "${debug_file}"
    
    echo "$name consumer completed"
}

# Start consumers in background
echo "📊 Starting latency consumers..."
run_consumer "Go" "${GO_JSONL}" "${GO_DEBUG}" \
    "docker compose exec -T dev-golang sh -c 'cd /workspace/golang-project && go run latency-consumer.go'"

# Wait for consumers to start
sleep 2

# Run producers
echo "📤 Starting latency producers..."
docker compose exec dev-golang sh -c "cd /workspace/golang-project && go run latency-producer.go ${MESSAGE_COUNT} ${SPACING_MS}"

# Wait for collection to complete
echo "⏳ Waiting for collection to complete..."
sleep $((DURATION + 2))

echo ""
echo "✅ Collection completed!"
echo "=============================="

# Show basic statistics
echo "📊 Results Summary:"
echo "==================="

if [ -f "${GO_JSONL}" ]; then
    go_records=$(wc -l < "${GO_JSONL}")
    echo "Go:   $go_records latency records"
else
    echo "Go:   No data collected"
fi

echo ""
echo "📋 Sample Results:"
echo "=================="
echo "--- Go Latency Logs (first 2 records) ---"
head -2 "${GO_JSONL}"

echo ""
echo "💡 Analysis Commands:"
echo "===================="
echo "  ./analyze-latency-logs.sh ${GO_JSONL}"
echo "  ./calculate-percentiles.sh ${GO_JSONL} \"Go\""

echo ""
echo "🗂️  Files generated:"
echo "  - ${GO_JSONL}"
echo "  - ${GO_DEBUG}" 