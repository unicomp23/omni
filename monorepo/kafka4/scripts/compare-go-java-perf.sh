#!/bin/bash

# Go vs Java Performance Comparison Script
# Runs identical latency tests for both languages and compares results

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Test configuration
MESSAGE_COUNT=${1:-1000}
SPACING_MS=${2:-5}
TIMEOUT_SECONDS=${3:-30}

print_header "GO vs JAVA PERFORMANCE COMPARISON"
echo -e "${BLUE}📋 Test Configuration:${NC}"
echo "  - Messages per test: $MESSAGE_COUNT"
echo "  - Message spacing: ${SPACING_MS}ms"
echo "  - Consumer timeout: ${TIMEOUT_SECONDS}s"
test_duration=$((MESSAGE_COUNT * SPACING_MS / 1000))
if [ $test_duration -eq 0 ]; then test_duration=1; fi
echo "  - Expected test duration: ~${test_duration}s per language"
echo "  - Total estimated time: ~$((test_duration * 2 + 60))s (including setup)"
echo ""
echo -e "${YELLOW}⏱️  Progress will be shown during each test phase${NC}"
echo ""

# Function to create fresh topics
create_fresh_topics() {
    print_header "CREATING FRESH TOPICS"
    ./scripts/topic-manager.sh fresh
    source topic-config.env
    print_success "Fresh topics created"
}

# Function to run Go latency test
run_go_test() {
    print_header "RUNNING GO LATENCY TEST"
    
    local output_file="go-perf-$(date +%Y%m%d-%H%M%S).jsonl"
    local debug_file="go-perf-$(date +%Y%m%d-%H%M%S).debug"
    
    print_status "Starting Go consumer..."
    timeout ${TIMEOUT_SECONDS}s docker compose exec -T \
        -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" \
        dev-golang sh -c "cd /workspace && go run latency-consumer.go" \
        > "$output_file" 2> "$debug_file" &
    
    local consumer_pid=$!
    sleep 2
    
    print_status "Starting Go producer (${MESSAGE_COUNT} messages @ ${SPACING_MS}ms intervals)..."
    docker compose exec -T \
        -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" \
        dev-golang sh -c "cd /workspace && go run latency-producer.go ${MESSAGE_COUNT} ${SPACING_MS}" &
    
    local producer_pid=$!
    
    # Monitor progress
    print_status "Monitoring Go test progress..."
    local start_time=$(date +%s)
    local expected_duration=$((MESSAGE_COUNT * SPACING_MS / 1000))
    # Ensure minimum duration of 1 second to avoid division by zero
    if [ $expected_duration -eq 0 ]; then
        expected_duration=1
    fi
    
    while kill -0 $producer_pid 2>/dev/null; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        local progress=$((elapsed * 100 / expected_duration))
        if [ $progress -gt 100 ]; then progress=100; fi
        
        # Count current records
        local current_records=0
        if [ -f "$output_file" ]; then
            current_records=$(wc -l < "$output_file" 2>/dev/null || echo "0")
        fi
        
        printf "\r  📊 Go Progress: %d%% (%ds/%ds) | Records: %d | " $progress $elapsed $expected_duration $current_records
        sleep 2
    done
    
    echo "" # New line after progress
    print_status "Go producer completed, waiting for consumer..."
    
    # Wait for consumer to finish
    wait $consumer_pid 2>/dev/null || true
    
    GO_OUTPUT_FILE="$output_file"
    GO_DEBUG_FILE="$debug_file"
    
    if [ -f "$output_file" ]; then
        local record_count=$(wc -l < "$output_file")
        print_success "Go test completed: $record_count latency records"
    else
        print_warning "Go test generated no output file"
    fi
}

# Function to run Java latency test
run_java_test() {
    print_header "RUNNING JAVA LATENCY TEST"
    
    local output_file="java-perf-$(date +%Y%m%d-%H%M%S).jsonl"
    local debug_file="java-perf-$(date +%Y%m%d-%H%M%S).debug"
    
    print_status "Starting Java consumer..."
    timeout ${TIMEOUT_SECONDS}s docker compose exec -T \
        -e JAVA_LATENCY_TOPIC="$JAVA_LATENCY_TOPIC" \
        dev-java sh -c "cd /workspace && java -cp 'target/classes:target/dependency/*' com.example.kafka.LatencyConsumer" \
        > "$output_file" 2> "$debug_file" &
    
    local consumer_pid=$!
    sleep 2
    
    print_status "Starting Java producer (${MESSAGE_COUNT} messages @ ${SPACING_MS}ms intervals)..."
    docker compose exec -T \
        -e JAVA_LATENCY_TOPIC="$JAVA_LATENCY_TOPIC" \
        dev-java sh -c "cd /workspace && java -cp 'target/classes:target/dependency/*' com.example.kafka.LatencyProducer ${MESSAGE_COUNT} ${SPACING_MS}" &
    
    local producer_pid=$!
    
    # Monitor progress
    print_status "Monitoring Java test progress..."
    local start_time=$(date +%s)
    local expected_duration=$((MESSAGE_COUNT * SPACING_MS / 1000))
    # Ensure minimum duration of 1 second to avoid division by zero
    if [ $expected_duration -eq 0 ]; then
        expected_duration=1
    fi
    
    while kill -0 $producer_pid 2>/dev/null; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        local progress=$((elapsed * 100 / expected_duration))
        if [ $progress -gt 100 ]; then progress=100; fi
        
        # Count current records
        local current_records=0
        if [ -f "$output_file" ]; then
            current_records=$(wc -l < "$output_file" 2>/dev/null || echo "0")
        fi
        
        printf "\r  📊 Java Progress: %d%% (%ds/%ds) | Records: %d | " $progress $elapsed $expected_duration $current_records
        sleep 2
    done
    
    echo "" # New line after progress
    print_status "Java producer completed, waiting for consumer..."
    
    # Wait for consumer to finish
    wait $consumer_pid 2>/dev/null || true
    
    JAVA_OUTPUT_FILE="$output_file"
    JAVA_DEBUG_FILE="$debug_file"
    
    if [ -f "$output_file" ]; then
        local record_count=$(wc -l < "$output_file")
        print_success "Java test completed: $record_count latency records"
    else
        print_warning "Java test generated no output file"
    fi
}

# Function to analyze and compare results
analyze_and_compare() {
    print_header "PERFORMANCE COMPARISON ANALYSIS"
    
    if [ ! -f "$GO_OUTPUT_FILE" ] && [ ! -f "$JAVA_OUTPUT_FILE" ]; then
        print_error "No output files generated for comparison"
        return 1
    fi
    
    echo -e "${BLUE}📊 Results Summary:${NC}"
    echo ""
    
    # Go analysis
    if [ -f "$GO_OUTPUT_FILE" ] && [ -s "$GO_OUTPUT_FILE" ]; then
        local go_count=$(wc -l < "$GO_OUTPUT_FILE")
        echo -e "${GREEN}🔹 Go Performance:${NC}"
        echo "  • Records: $go_count"
        
        if command -v jq &> /dev/null && [ $go_count -gt 0 ]; then
            local go_min=$(jq -s 'map(.latency_ms) | min' "$GO_OUTPUT_FILE")
            local go_max=$(jq -s 'map(.latency_ms) | max' "$GO_OUTPUT_FILE")
            local go_avg=$(jq -s 'map(.latency_ms) | add / length' "$GO_OUTPUT_FILE")
            local go_median=$(jq -r '.latency_ms' "$GO_OUTPUT_FILE" | sort -n | awk 'NR==int(NR/2){print $1}')
            
            echo "  • Min: $go_min ms"
            echo "  • Max: $go_max ms"
            echo "  • Avg: $go_avg ms"
            echo "  • Median: $go_median ms"
            
            # Calculate percentiles
            local go_p95=$(jq -r '.latency_ms' "$GO_OUTPUT_FILE" | sort -n | awk 'NR==int(NR*0.95){print $1}')
            local go_p99=$(jq -r '.latency_ms' "$GO_OUTPUT_FILE" | sort -n | awk 'NR==int(NR*0.99){print $1}')
            echo "  • P95: $go_p95 ms"
            echo "  • P99: $go_p99 ms"
        fi
    else
        echo -e "${RED}🔹 Go Performance: No valid results${NC}"
    fi
    
    echo ""
    
    # Java analysis
    if [ -f "$JAVA_OUTPUT_FILE" ] && [ -s "$JAVA_OUTPUT_FILE" ]; then
        local java_count=$(wc -l < "$JAVA_OUTPUT_FILE")
        echo -e "${GREEN}🔹 Java Performance:${NC}"
        echo "  • Records: $java_count"
        
        if command -v jq &> /dev/null && [ $java_count -gt 0 ]; then
            local java_min=$(jq -s 'map(.latencyMs) | min' "$JAVA_OUTPUT_FILE")
            local java_max=$(jq -s 'map(.latencyMs) | max' "$JAVA_OUTPUT_FILE")
            local java_avg=$(jq -s 'map(.latencyMs) | add / length' "$JAVA_OUTPUT_FILE")
            local java_median=$(jq -r '.latencyMs' "$JAVA_OUTPUT_FILE" | sort -n | awk 'NR==int(NR/2){print $1}')
            
            echo "  • Min: $java_min ms"
            echo "  • Max: $java_max ms"
            echo "  • Avg: $java_avg ms"
            echo "  • Median: $java_median ms"
            
            # Calculate percentiles
            local java_p95=$(jq -r '.latencyMs' "$JAVA_OUTPUT_FILE" | sort -n | awk 'NR==int(NR*0.95){print $1}')
            local java_p99=$(jq -r '.latencyMs' "$JAVA_OUTPUT_FILE" | sort -n | awk 'NR==int(NR*0.99){print $1}')
            echo "  • P95: $java_p95 ms"
            echo "  • P99: $java_p99 ms"
        fi
    else
        echo -e "${RED}🔹 Java Performance: No valid results${NC}"
    fi
    
    # Performance comparison
    if [ -f "$GO_OUTPUT_FILE" ] && [ -s "$GO_OUTPUT_FILE" ] && [ -f "$JAVA_OUTPUT_FILE" ] && [ -s "$JAVA_OUTPUT_FILE" ]; then
        echo ""
        echo -e "${BLUE}🏆 PERFORMANCE WINNER ANALYSIS:${NC}"
        
        local go_avg=$(jq -s 'map(.latency_ms) | add / length' "$GO_OUTPUT_FILE" 2>/dev/null || echo "0")
        local java_avg=$(jq -s 'map(.latencyMs) | add / length' "$JAVA_OUTPUT_FILE" 2>/dev/null || echo "0")
        
        local go_p95=$(jq -r '.latency_ms' "$GO_OUTPUT_FILE" | sort -n | awk 'NR==int(NR*0.95){print $1}' 2>/dev/null || echo "0")
        local java_p95=$(jq -r '.latencyMs' "$JAVA_OUTPUT_FILE" | sort -n | awk 'NR==int(NR*0.95){print $1}' 2>/dev/null || echo "0")
        
        # Compare averages
        if (( $(echo "$go_avg < $java_avg" | bc -l 2>/dev/null || echo "0") )); then
            local avg_improvement=$(echo "scale=1; ($java_avg - $go_avg) * 100 / $java_avg" | bc -l 2>/dev/null || echo "0")
            echo "  🥇 Average Latency: Go wins by ${avg_improvement}% (${go_avg}ms vs ${java_avg}ms)"
        elif (( $(echo "$java_avg < $go_avg" | bc -l 2>/dev/null || echo "0") )); then
            local avg_improvement=$(echo "scale=1; ($go_avg - $java_avg) * 100 / $go_avg" | bc -l 2>/dev/null || echo "0")
            echo "  🥇 Average Latency: Java wins by ${avg_improvement}% (${java_avg}ms vs ${go_avg}ms)"
        else
            echo "  🤝 Average Latency: Tie (${go_avg}ms vs ${java_avg}ms)"
        fi
        
        # Compare P95
        if (( $(echo "$go_p95 < $java_p95" | bc -l 2>/dev/null || echo "0") )); then
            local p95_improvement=$(echo "scale=1; ($java_p95 - $go_p95) * 100 / $java_p95" | bc -l 2>/dev/null || echo "0")
            echo "  🥇 P95 Latency: Go wins by ${p95_improvement}% (${go_p95}ms vs ${java_p95}ms)"
        elif (( $(echo "$java_p95 < $go_p95" | bc -l 2>/dev/null || echo "0") )); then
            local p95_improvement=$(echo "scale=1; ($go_p95 - $java_p95) * 100 / $go_p95" | bc -l 2>/dev/null || echo "0")
            echo "  🥇 P95 Latency: Java wins by ${p95_improvement}% (${java_p95}ms vs ${go_p95}ms)"
        else
            echo "  🤝 P95 Latency: Tie (${go_p95}ms vs ${java_p95}ms)"
        fi
    fi
    
    echo ""
    echo -e "${YELLOW}📁 Generated Files:${NC}"
    ls -la go-perf-*.jsonl java-perf-*.jsonl go-perf-*.debug java-perf-*.debug 2>/dev/null || echo "  No files generated"
    
    # Auto-generate detailed percentile reports
    if [ -f "$GO_OUTPUT_FILE" ] && [ -s "$GO_OUTPUT_FILE" ]; then
        echo ""
        echo -e "${BLUE}📊 DETAILED GO PERCENTILE REPORT:${NC}"
        ./calculate-percentiles.sh "$GO_OUTPUT_FILE"
    fi
    
    if [ -f "$JAVA_OUTPUT_FILE" ] && [ -s "$JAVA_OUTPUT_FILE" ]; then
        echo ""
        echo -e "${BLUE}📊 DETAILED JAVA PERCENTILE REPORT:${NC}"
        # Create a temporary file with corrected field names for Java analysis
        local java_temp_file="java-temp-$(date +%Y%m%d-%H%M%S).jsonl"
        jq '.latency_ms = .latencyMs | del(.latencyMs)' "$JAVA_OUTPUT_FILE" > "$java_temp_file"
        ./calculate-percentiles.sh "$java_temp_file"
        rm -f "$java_temp_file"
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [MESSAGE_COUNT] [SPACING_MS] [TIMEOUT_SECONDS]"
    echo ""
    echo "Parameters:"
    echo "  MESSAGE_COUNT     - Number of messages to send (default: 1000)"
    echo "  SPACING_MS        - Milliseconds between messages (default: 5)"
    echo "  TIMEOUT_SECONDS   - Consumer timeout in seconds (default: 30)"
    echo ""
    echo "Examples:"
    echo "  $0                # Default: 1000 messages, 5ms spacing"
    echo "  $0 500 10         # 500 messages, 10ms spacing"
    echo "  $0 2000 1 60      # 2000 messages, 1ms spacing, 60s timeout"
}

# Main function
main() {
    if [[ "$1" == "--help" || "$1" == "-h" ]]; then
        show_usage
        exit 0
    fi
    
    # Check if containers are running
    if ! docker compose ps | grep -q "dev-golang.*Up"; then
        print_error "Containers not running. Start with: docker compose up -d"
        exit 1
    fi
    
    # Build Java project first
    print_status "Building Java project..."
    docker compose exec -T dev-java sh -c "cd /workspace && mvn clean compile dependency:copy-dependencies -q" || {
        print_error "Java build failed"
        exit 1
    }
    
    # Run tests
    create_fresh_topics
    run_go_test
    run_java_test
    analyze_and_compare
    
    print_header "PERFORMANCE COMPARISON COMPLETED"
    print_success "Go vs Java performance comparison completed!"
    
    echo ""
    echo -e "${YELLOW}💡 Next steps:${NC}"
    echo "  - Review detailed results in generated .jsonl files"
    echo "  - Run with different configurations: $0 --help"
    echo "  - Use ./calculate-percentiles.sh for detailed analysis"
}

# Run main function
main "$@" 