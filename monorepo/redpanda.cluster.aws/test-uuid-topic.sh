#!/bin/bash

# Test script for UUID topic creation and cleanup functionality

echo "=== Testing UUID Topic Creation & Cleanup ==="

# Set environment variables for testing
export REDPANDA_BROKERS="redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092"
export BASE_TOPIC="test-uuid-topic"
export TOTAL_MESSAGES=100        # Small number for quick test
export PRODUCER_RATE=50          # Low rate for quick test
export NUM_PRODUCERS=2           # Fewer producers for quick test
export NUM_CONSUMER_WORKERS=1    # Single consumer for quick test
export MESSAGE_SIZE=256          # Small messages for quick test

echo "Configuration:"
echo "- Base topic: $BASE_TOPIC"
echo "- Total messages: $TOTAL_MESSAGES"
echo "- Producer rate: $PRODUCER_RATE msg/s"
echo "- Producers: $NUM_PRODUCERS"
echo "- Consumer workers: $NUM_CONSUMER_WORKERS"
echo "- Message size: $MESSAGE_SIZE bytes"
echo ""

echo "Starting load test - watch for unique topic creation..."
./kafka-latency-test

echo ""
echo "Test completed! Check the output above for:"
echo "1. Unique topic creation with UUID (e.g., test-uuid-topic-a1b2c3d4)"
echo "2. Automatic cleanup of old topics"
echo "3. JSONL output with latency records" 