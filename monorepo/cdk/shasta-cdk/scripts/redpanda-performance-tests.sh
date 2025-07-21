#!/bin/bash
set -euo pipefail

# RedPanda Performance Testing Suite
# Comprehensive load testing and benchmarking for RedPanda clusters

echo "=== RedPanda Performance Testing Suite ==="

# Configuration
BOOTSTRAP_SERVERS="${BOOTSTRAP_SERVERS:-localhost:9092}"
TEST_TOPIC="${TEST_TOPIC:-performance-test}"
RESULTS_DIR="${RESULTS_DIR:-/home/ec2-user/test-results}"
DATE_STAMP=$(date +%Y%m%d-%H%M%S)

# Test parameters
MESSAGE_SIZES=(128 512 1024 4096 16384)
THROUGHPUT_TARGETS=(10000 50000 100000 500000 1000000)
PARTITION_COUNTS=(1 3 6 12 24 48)
REPLICATION_FACTORS=(1 3)

echo "Bootstrap servers: $BOOTSTRAP_SERVERS"
echo "Test topic: $TEST_TOPIC"
echo "Results directory: $RESULTS_DIR"

# Create results directory
mkdir -p "$RESULTS_DIR"
cd "$RESULTS_DIR"

# Function to check if RedPanda cluster is ready
check_cluster_ready() {
    echo "Checking cluster readiness..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if rpk cluster info --brokers "$BOOTSTRAP_SERVERS" &>/dev/null; then
            echo "✅ Cluster is ready!"
            return 0
        fi
        echo "Waiting for cluster... (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done
    
    echo "❌ Cluster is not ready after $max_attempts attempts"
    return 1
}

# Function to create test topic
create_test_topic() {
    local topic_name="$1"
    local partitions="$2"
    local replication_factor="$3"
    
    echo "Creating topic: $topic_name (partitions: $partitions, replication: $replication_factor)"
    
    # Delete topic if it exists
    rpk topic delete "$topic_name" --brokers "$BOOTSTRAP_SERVERS" 2>/dev/null || true
    sleep 2
    
    # Create new topic
    rpk topic create "$topic_name" \
        --partitions "$partitions" \
        --replicas "$replication_factor" \
        --brokers "$BOOTSTRAP_SERVERS" \
        --config min.insync.replicas=$((replication_factor > 1 ? replication_factor - 1 : 1))
        
    echo "✅ Topic '$topic_name' created successfully"
}

# Function to run producer performance test
run_producer_test() {
    local test_name="$1"
    local topic="$2"
    local num_records="$3"
    local record_size="$4"
    local throughput="$5"
    local output_file="$6"
    
    echo "🚀 Running producer test: $test_name"
    echo "Records: $num_records, Size: $record_size bytes, Target throughput: $throughput msg/sec"
    
    # Run Kafka producer performance test
    kafka-producer-perf-test.sh \
        --topic "$topic" \
        --num-records "$num_records" \
        --record-size "$record_size" \
        --throughput "$throughput" \
        --producer-props bootstrap.servers="$BOOTSTRAP_SERVERS" \
                         acks=1 \
                         linger.ms=0 \
                         batch.size=16384 \
                         compression.type=snappy \
        > "$output_file" 2>&1
        
    echo "✅ Producer test completed: $output_file"
}

# Function to run consumer performance test
run_consumer_test() {
    local test_name="$1"
    local topic="$2"
    local messages="$3"
    local output_file="$4"
    
    echo "🚀 Running consumer test: $test_name"
    echo "Messages to consume: $messages"
    
    # Run Kafka consumer performance test
    kafka-consumer-perf-test.sh \
        --bootstrap-server "$BOOTSTRAP_SERVERS" \
        --topic "$topic" \
        --messages "$messages" \
        --show-detailed-stats \
        > "$output_file" 2>&1
        
    echo "✅ Consumer test completed: $output_file"
}

# Function to run latency test
run_latency_test() {
    local test_name="$1"
    local topic="$2"
    local num_records="$3"
    local record_size="$4"
    local output_file="$5"
    
    echo "🚀 Running latency test: $test_name"
    
    # Create temporary consumer group
    local consumer_group="latency-test-$(date +%s)"
    
    # Start consumer in background
    timeout 60s kafka-console-consumer.sh \
        --bootstrap-server "$BOOTSTRAP_SERVERS" \
        --topic "$topic" \
        --group "$consumer_group" \
        --max-messages "$num_records" \
        --property print.timestamp=true \
        > "${output_file}.consumer" 2>&1 &
    
    local consumer_pid=$!
    sleep 2
    
    # Run producer with timestamps
    kafka-producer-perf-test.sh \
        --topic "$topic" \
        --num-records "$num_records" \
        --record-size "$record_size" \
        --throughput -1 \
        --producer-props bootstrap.servers="$BOOTSTRAP_SERVERS" \
                         acks=1 \
                         linger.ms=0 \
        > "${output_file}.producer" 2>&1
        
    # Wait for consumer to finish
    wait $consumer_pid 2>/dev/null || true
    
    # Calculate latencies (simplified)
    echo "Latency test results saved to ${output_file}.*"
    echo "✅ Latency test completed: $test_name"
}

# Function to run throughput scaling test
run_throughput_scaling_test() {
    local base_topic="throughput-scaling"
    local test_dir="$RESULTS_DIR/throughput-scaling-$DATE_STAMP"
    mkdir -p "$test_dir"
    
    echo "🚀 Running throughput scaling tests..."
    
    for partitions in "${PARTITION_COUNTS[@]}"; do
        local topic="${base_topic}-${partitions}p"
        create_test_topic "$topic" "$partitions" 3
        
        for throughput in "${THROUGHPUT_TARGETS[@]}"; do
            local test_name="throughput-${partitions}p-${throughput}tps"
            local output_file="$test_dir/${test_name}.log"
            
            run_producer_test "$test_name" "$topic" 1000000 1024 "$throughput" "$output_file"
            
            # Brief pause between tests
            sleep 5
        done
    done
    
    echo "✅ Throughput scaling tests completed: $test_dir"
}

# Function to run message size impact test
run_message_size_test() {
    local base_topic="message-size"
    local test_dir="$RESULTS_DIR/message-size-$DATE_STAMP"
    mkdir -p "$test_dir"
    
    echo "🚀 Running message size impact tests..."
    
    create_test_topic "$base_topic" 12 3
    
    for size in "${MESSAGE_SIZES[@]}"; do
        local test_name="msgsize-${size}b"
        local output_file="$test_dir/${test_name}.log"
        local num_records=$((104857600 / size))  # ~100MB total data
        
        run_producer_test "$test_name" "$base_topic" "$num_records" "$size" -1 "$output_file"
        
        # Test consumer performance
        run_consumer_test "${test_name}-consumer" "$base_topic" "$num_records" "${output_file}.consumer"
        
        sleep 5
    done
    
    echo "✅ Message size tests completed: $test_dir"
}

# Function to run end-to-end latency test
run_end_to_end_latency_test() {
    local test_topic="e2e-latency"
    local test_dir="$RESULTS_DIR/e2e-latency-$DATE_STAMP"
    mkdir -p "$test_dir"
    
    echo "🚀 Running end-to-end latency tests..."
    
    create_test_topic "$test_topic" 1 3
    
    # Small batch, high frequency test
    run_latency_test "e2e-latency-1kb" "$test_topic" 10000 1024 "$test_dir/e2e-latency-1kb.log"
    
    echo "✅ End-to-end latency tests completed: $test_dir"
}

# Function to run replication factor impact test
run_replication_test() {
    local base_topic="replication-test"
    local test_dir="$RESULTS_DIR/replication-$DATE_STAMP"
    mkdir -p "$test_dir"
    
    echo "🚀 Running replication factor impact tests..."
    
    for replication in "${REPLICATION_FACTORS[@]}"; do
        local topic="${base_topic}-rf${replication}"
        create_test_topic "$topic" 12 "$replication"
        
        local test_name="replication-rf${replication}"
        local output_file="$test_dir/${test_name}.log"
        
        run_producer_test "$test_name" "$topic" 1000000 1024 100000 "$output_file"
        run_consumer_test "${test_name}-consumer" "$topic" 1000000 "${output_file}.consumer"
        
        sleep 10
    done
    
    echo "✅ Replication factor tests completed: $test_dir"
}

# Function to generate summary report
generate_summary_report() {
    local report_file="$RESULTS_DIR/performance-summary-$DATE_STAMP.txt"
    
    echo "📊 Generating performance summary report..."
    
    cat > "$report_file" <<EOF
# RedPanda Performance Test Summary
Date: $(date)
Cluster: $BOOTSTRAP_SERVERS
Test ID: $DATE_STAMP

## Test Configuration
- Message sizes tested: ${MESSAGE_SIZES[*]}
- Throughput targets: ${THROUGHPUT_TARGETS[*]}
- Partition counts: ${PARTITION_COUNTS[*]}
- Replication factors: ${REPLICATION_FACTORS[*]}

## Cluster Information
EOF
    
    # Add cluster info
    echo "### Cluster Status" >> "$report_file"
    rpk cluster info --brokers "$BOOTSTRAP_SERVERS" >> "$report_file" 2>/dev/null || echo "Could not retrieve cluster info" >> "$report_file"
    
    echo "" >> "$report_file"
    echo "### Available Topics" >> "$report_file"
    rpk topic list --brokers "$BOOTSTRAP_SERVERS" >> "$report_file" 2>/dev/null || echo "Could not retrieve topic list" >> "$report_file"
    
    # Add system information
    echo "" >> "$report_file"
    echo "### System Information" >> "$report_file"
    echo "Hostname: $(hostname)" >> "$report_file"
    echo "OS: $(uname -a)" >> "$report_file"
    echo "CPU: $(nproc) cores" >> "$report_file"
    echo "Memory: $(free -h | grep Mem | awk '{print $2}')" >> "$report_file"
    echo "Disk: $(df -h / | tail -1 | awk '{print $2 " total, " $3 " used, " $4 " available"}')" >> "$report_file"
    
    echo "✅ Summary report generated: $report_file"
}

# Function to run all tests
run_all_tests() {
    echo "🚀 Starting comprehensive RedPanda performance test suite..."
    
    # Check prerequisites
    if ! command -v kafka-producer-perf-test.sh &> /dev/null; then
        echo "❌ Kafka performance tools not found. Please install Kafka CLI tools."
        exit 1
    fi
    
    if ! command -v rpk &> /dev/null; then
        echo "❌ RPK (RedPanda CLI) not found. Please install RedPanda."
        exit 1
    fi
    
    # Check cluster readiness
    if ! check_cluster_ready; then
        echo "❌ RedPanda cluster is not ready. Please check your configuration."
        exit 1
    fi
    
    local start_time=$(date +%s)
    
    # Run test suites
    run_throughput_scaling_test
    run_message_size_test
    run_end_to_end_latency_test
    run_replication_test
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    echo "⏱️  Total test duration: $((duration / 60)) minutes $((duration % 60)) seconds"
    
    # Generate summary
    generate_summary_report
    
    echo "🎉 All performance tests completed successfully!"
    echo "Results directory: $RESULTS_DIR"
    echo ""
    echo "📊 Quick performance check:"
    rpk topic list --brokers "$BOOTSTRAP_SERVERS" | head -10
}

# Function to run quick test
run_quick_test() {
    echo "🚀 Running quick RedPanda performance test..."
    
    check_cluster_ready || exit 1
    
    local quick_topic="quick-test"
    create_test_topic "$quick_topic" 6 3
    
    local test_dir="$RESULTS_DIR/quick-test-$DATE_STAMP"
    mkdir -p "$test_dir"
    
    # Quick producer test
    run_producer_test "quick-producer" "$quick_topic" 100000 1024 50000 "$test_dir/quick-producer.log"
    
    # Quick consumer test
    run_consumer_test "quick-consumer" "$quick_topic" 100000 "$test_dir/quick-consumer.log"
    
    echo "✅ Quick test completed: $test_dir"
    
    # Show basic results
    echo ""
    echo "📊 Quick Results:"
    tail -n 5 "$test_dir/quick-producer.log"
}

# Main execution
case "${1:-all}" in
    "quick")
        run_quick_test
        ;;
    "throughput")
        run_throughput_scaling_test
        ;;
    "latency")
        run_end_to_end_latency_test
        ;;
    "size")
        run_message_size_test
        ;;
    "replication")
        run_replication_test
        ;;
    "all"|*)
        run_all_tests
        ;;
esac

echo ""
echo "📁 Results saved to: $RESULTS_DIR"
echo "🔍 For detailed analysis, check individual log files in the results directory." 