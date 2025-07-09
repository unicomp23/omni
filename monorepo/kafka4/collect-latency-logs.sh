#!/bin/bash

# Collect Latency Logs Script
# This script runs both Go and Java latency consumers and saves logs to files

echo "🚀 Starting Latency Log Collection..."
echo "📁 Logs will be saved to: $(pwd)"

# Create timestamp for log files
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Define log file names
GO_JSONL="golang-latency-${TIMESTAMP}.jsonl"
GO_DEBUG="golang-latency-${TIMESTAMP}.debug"
JAVA_JSONL="java-latency-${TIMESTAMP}.jsonl"
JAVA_DEBUG="java-latency-${TIMESTAMP}.debug"

echo "📊 Log Files:"
echo "  - Golang JSONL: ${GO_JSONL}"
echo "  - Golang Debug: ${GO_DEBUG}"
echo "  - Java JSONL:   ${JAVA_JSONL}"
echo "  - Java Debug:   ${JAVA_DEBUG}"
echo

# Function to run consumer and save logs
run_consumer() {
    local consumer_type=$1
    local jsonl_file=$2
    local debug_file=$3
    local command=$4
    
    echo "🔄 Starting ${consumer_type} consumer..."
    echo "   Command: ${command}"
    
    # Run for 30 seconds, then stop
    timeout 30s ${command} > "${jsonl_file}" 2> "${debug_file}"
    
    local records=$(wc -l < "${jsonl_file}")
    echo "✅ ${consumer_type} completed: ${records} records in ${jsonl_file}"
}

# Start both consumers in parallel
echo "🔄 Starting consumers (will run for 30 seconds)..."
run_consumer "Golang" "${GO_JSONL}" "${GO_DEBUG}" \
    "docker compose exec -T dev-golang sh -c 'cd /workspace/golang-project && go run latency-consumer.go'" &

run_consumer "Java" "${JAVA_JSONL}" "${JAVA_DEBUG}" \
    "docker compose exec -T dev-java sh -c 'cd /workspace/java-project && java -cp \"target/classes:target/dependency/*\" com.example.kafka.SimpleLatencyConsumer'" &

# Wait for both to complete
wait

echo
echo "📋 Log Collection Summary:"
echo "=========================="
ls -la *latency*${TIMESTAMP}*

echo
echo "🔍 Quick Preview:"
echo "================="
echo "--- Golang Latency Logs (first 2 records) ---"
head -2 "${GO_JSONL}"
echo
echo "--- Java Latency Logs (first 2 records) ---"
head -2 "${JAVA_JSONL}"

echo
echo "✅ Log collection complete!"
echo "💡 Tip: You can now analyze the JSONL files with tools like jq, pandas, or import into databases" 