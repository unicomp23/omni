#!/bin/bash

# Production Kafka latency load test script
# 100k iterations, 2k msg/s, 10 producers, 2 workers, optimized for latency

echo "=== Production Kafka Latency Load Test ==="
echo "Target: 100k messages, 2k msg/s, 10 producers, 2 workers"
echo "Optimization: Latency over throughput"
echo ""

# Set environment variables for production test
export REDPANDA_BROKERS="redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092"
export TOPIC="latency-test"
export TOTAL_MESSAGES=100000      # 100k iterations
export PRODUCER_RATE=2000         # 2k msg/s total
export NUM_PRODUCERS=10           # 10 concurrent producers
export NUM_CONSUMER_WORKERS=2     # 2 consumer workers
export MESSAGE_SIZE=1024          # 1KB per message

echo "Configuration:"
echo "- Total messages: $TOTAL_MESSAGES"
echo "- Producer rate: $PRODUCER_RATE msg/s"
echo "- Producers: $NUM_PRODUCERS ($(($PRODUCER_RATE / $NUM_PRODUCERS)) msg/s each)"
echo "- Consumer workers: $NUM_CONSUMER_WORKERS"
echo "- Message size: $MESSAGE_SIZE bytes"
echo "- Output: latency_records.jsonl"
echo ""

# Ensure clean start
rm -f latency_records.jsonl

# Record start time
start_time=$(date +%s)

echo "Starting production test at $(date)"
echo "Expected duration: ~$((($TOTAL_MESSAGES / $PRODUCER_RATE) + 5)) seconds"
echo ""

# Run the test
./kafka-latency-test

# Record end time and calculate duration
end_time=$(date +%s)
duration=$((end_time - start_time))

echo ""
echo "=== Test Completed ==="
echo "Actual duration: $duration seconds"
echo "Results written to: latency_records.jsonl"

# Show detailed analysis if jq is available
if command -v jq &> /dev/null; then
    echo ""
    echo "=== Latency Analysis ==="
    if [ -f "latency_records.jsonl" ]; then
        total_records=$(wc -l < latency_records.jsonl)
        echo "Total records: $total_records"
        
        # Calculate latency statistics
        avg_latency=$(jq -r '.latency_ms' latency_records.jsonl | awk '{sum+=$1} END {print sum/NR}')
        min_latency=$(jq -r '.latency_ms' latency_records.jsonl | sort -n | head -1)
        max_latency=$(jq -r '.latency_ms' latency_records.jsonl | sort -n | tail -1)
        
        echo "Average latency: $(printf "%.2f" $avg_latency) ms"
        echo "Min latency: $(printf "%.2f" $min_latency) ms"
        echo "Max latency: $(printf "%.2f" $max_latency) ms"
        
        # Calculate percentiles
        p95_latency=$(jq -r '.latency_ms' latency_records.jsonl | sort -n | awk '{all[NR] = $0} END{print all[int(NR*0.95)]}')
        p99_latency=$(jq -r '.latency_ms' latency_records.jsonl | sort -n | awk '{all[NR] = $0} END{print all[int(NR*0.99)]}')
        
        echo "P95 latency: $(printf "%.2f" $p95_latency) ms"
        echo "P99 latency: $(printf "%.2f" $p99_latency) ms"
        
        echo ""
        echo "Consumer distribution:"
        jq -r '.consumer_id' latency_records.jsonl | sort | uniq -c | awk '{print "  Consumer", $2":", $1, "messages"}'
        
        echo ""
        echo "Partition distribution:"
        jq -r '.partition' latency_records.jsonl | sort | uniq -c | awk '{print "  Partition", $2":", $1, "messages"}'
        
        # Calculate actual throughput
        actual_rate=$(echo "scale=2; $total_records / $duration" | bc)
        echo ""
        echo "Actual throughput: $actual_rate msg/s"
        
        echo ""
        echo "=== JSONL Analysis Commands ==="
        echo "View first 5 records:"
        echo "  head -5 latency_records.jsonl | jq"
        echo ""
        echo "Calculate custom percentiles:"
        echo "  jq -r '.latency_ms' latency_records.jsonl | sort -n | awk '{all[NR] = \$0} END{print \"P90:\", all[int(NR*0.90)]}'"
        echo ""
        echo "Export to CSV:"
        echo "  jq -r '[.message_id, .consumer_id, .latency_ms, .partition] | @csv' latency_records.jsonl > latency_data.csv"
        echo ""
        echo "Plot histogram with Python:"
        echo "  python3 -c \"import json, matplotlib.pyplot as plt; data=[json.loads(line) for line in open('latency_records.jsonl')]; plt.hist([d['latency_ms'] for d in data], bins=50); plt.xlabel('Latency (ms)'); plt.ylabel('Frequency'); plt.title('Latency Distribution'); plt.show()\""
        
    else
        echo "No latency_records.jsonl file found!"
    fi
else
    echo ""
    echo "Install 'jq' for detailed analysis: sudo dnf install jq"
fi

echo ""
echo "=== Test Complete ===" 