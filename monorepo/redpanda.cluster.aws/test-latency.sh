#!/bin/bash

# Test script for the multi-producer Kafka latency load test

echo "Starting Kafka latency load test with multiple producers and consumer workers..."

# Set environment variables for the test
export REDPANDA_BROKERS="redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092"
export TOPIC="latency-test"
export TOTAL_MESSAGES=10000      # Smaller test run
export PRODUCER_RATE=1000        # 1000 msg/s total
export NUM_PRODUCERS=5           # 5 concurrent producers
export NUM_CONSUMER_WORKERS=2    # 2 consumer workers
export MESSAGE_SIZE=512          # 512 bytes per message

echo "Configuration:"
echo "- Total messages: $TOTAL_MESSAGES"
echo "- Producer rate: $PRODUCER_RATE msg/s"
echo "- Producers: $NUM_PRODUCERS"
echo "- Consumer workers: $NUM_CONSUMER_WORKERS"
echo "- Message size: $MESSAGE_SIZE bytes"
echo "- Output: latency_records.jsonl"
echo ""

# Run the test
./kafka-latency-test

echo ""
echo "Test completed. Check latency_records.jsonl for detailed results."

# Show a quick summary if jq is available
if command -v jq &> /dev/null; then
    echo ""
    echo "Quick latency summary:"
    if [ -f "latency_records.jsonl" ]; then
        echo "Total records: $(wc -l < latency_records.jsonl)"
        echo "Average latency: $(jq -r '.latency_ms' latency_records.jsonl | awk '{sum+=$1} END {print sum/NR, "ms"}')"
        echo "Consumer distribution:"
        jq -r '.consumer_id' latency_records.jsonl | sort | uniq -c | awk '{print "  Consumer", $2":", $1, "messages"}'
    fi
fi 