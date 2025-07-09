#!/bin/bash

# Comprehensive Latency Test Runner
# This script creates fresh topics and runs latency tests for both Go and Java

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

# Function to check if required files exist
check_dependencies() {
    if [ ! -f "scripts/topic-manager.sh" ]; then
        print_error "Topic manager script not found!"
        exit 1
    fi
    
    if [ ! -f "golang-project/latency-producer.go" ]; then
        print_error "Go latency producer not found!"
        exit 1
    fi
    
    if [ ! -f "golang-project/latency-consumer.go" ]; then
        print_error "Go latency consumer not found!"
        exit 1
    fi
}

# Function to load topic configuration
load_topic_config() {
    if [ ! -f "topic-config.env" ]; then
        print_error "Topic configuration not found! Run topic manager first."
        exit 1
    fi
    
    source topic-config.env
    print_status "Loaded topic configuration:"
    echo "  - Go Latency Topic: $GO_LATENCY_TOPIC"
    echo "  - Java Latency Topic: $JAVA_LATENCY_TOPIC"
    echo "  - General Topic: $GENERAL_TEST_TOPIC"
}

# Function to run Go latency test
run_go_latency_test() {
    print_header "RUNNING GO LATENCY TEST"
    
    local output_file="go-latency-$(date +%Y%m%d-%H%M%S).jsonl"
    local debug_file="go-latency-$(date +%Y%m%d-%H%M%S).debug"
    
    print_status "Starting Go consumer in background..."
    timeout 30s docker compose exec -T -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" dev-golang sh -c "
        cd /workspace && 
        go run golang-project/latency-consumer.go
    " > "$output_file" 2> "$debug_file" &
    
    local consumer_pid=$!
    sleep 2
    
    print_status "Starting Go producer..."
    docker compose exec -T -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" dev-golang sh -c "
        cd /workspace && 
        go run golang-project/latency-producer.go
    "
    
    # Wait for consumer to finish
    wait $consumer_pid 2>/dev/null || true
    
    print_status "Go test completed. Results in: $output_file"
    
    # Show quick summary
    if [ -f "$output_file" ]; then
        local record_count=$(wc -l < "$output_file")
        print_status "Go test generated $record_count latency records"
    fi
}

# Function to run Java latency test
run_java_latency_test() {
    print_header "RUNNING JAVA LATENCY TEST"
    
    local output_file="java-latency-$(date +%Y%m%d-%H%M%S).jsonl"
    local debug_file="java-latency-$(date +%Y%m%d-%H%M%S).debug"
    
    print_status "Building Java project..."
    docker compose exec -T dev-java sh -c "cd /workspace/java-project && mvn clean compile dependency:copy-dependencies -q"
    
    print_status "Starting Java consumer in background..."
    timeout 30s docker compose exec -T -e JAVA_LATENCY_TOPIC="$JAVA_LATENCY_TOPIC" dev-java sh -c "
        cd /workspace/java-project && 
        java -cp 'target/classes:target/dependency/*' com.example.kafka.LatencyConsumer
    " > "$output_file" 2> "$debug_file" &
    
    local consumer_pid=$!
    sleep 2
    
    print_status "Starting Java producer..."
    docker compose exec -T -e JAVA_LATENCY_TOPIC="$JAVA_LATENCY_TOPIC" dev-java sh -c "
        cd /workspace/java-project && 
        java -cp 'target/classes:target/dependency/*' com.example.kafka.LatencyProducer
    "
    
    # Wait for consumer to finish
    wait $consumer_pid 2>/dev/null || true
    
    print_status "Java test completed. Results in: $output_file"
    
    # Show quick summary
    if [ -f "$output_file" ]; then
        local record_count=$(wc -l < "$output_file")
        print_status "Java test generated $record_count latency records"
    fi
}

# Function to analyze results
analyze_results() {
    print_header "ANALYZING RESULTS"
    
    local go_files=(go-latency-*.jsonl)
    local java_files=(java-latency-*.jsonl)
    
    if [ -f "${go_files[-1]}" ]; then
        print_status "Go latency results:"
        if command -v jq &> /dev/null; then
            echo "  - Min: $(jq -s 'map(.latency_ms) | min' "${go_files[-1]}") ms"
            echo "  - Max: $(jq -s 'map(.latency_ms) | max' "${go_files[-1]}") ms"
            echo "  - Avg: $(jq -s 'map(.latency_ms) | add / length' "${go_files[-1]}") ms"
        else
            echo "  - Records: $(wc -l < "${go_files[-1]}")"
        fi
    fi
    
    if [ -f "${java_files[-1]}" ]; then
        print_status "Java latency results:"
        if command -v jq &> /dev/null; then
            echo "  - Min: $(jq -s 'map(.latency_ms) | min' "${java_files[-1]}") ms"
            echo "  - Max: $(jq -s 'map(.latency_ms) | max' "${java_files[-1]}") ms"
            echo "  - Avg: $(jq -s 'map(.latency_ms) | add / length' "${java_files[-1]}") ms"
        else
            echo "  - Records: $(wc -l < "${java_files[-1]}")"
        fi
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --go-only     Run only Go latency test"
    echo "  --java-only   Run only Java latency test"
    echo "  --no-fresh    Don't create fresh topics (use existing)"
    echo "  --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                    # Run complete test with fresh topics"
    echo "  $0 --go-only          # Run only Go test"
    echo "  $0 --java-only        # Run only Java test"
    echo "  $0 --no-fresh         # Run with existing topics"
}

# Main function
main() {
    local run_go=true
    local run_java=true
    local create_fresh=true
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --go-only)
                run_java=false
                shift
                ;;
            --java-only)
                run_go=false
                shift
                ;;
            --no-fresh)
                create_fresh=false
                shift
                ;;
            --help|-h)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    check_dependencies
    
    if [ "$create_fresh" = true ]; then
        print_header "CREATING FRESH TOPICS"
        ./scripts/topic-manager.sh fresh
        echo ""
    fi
    
    load_topic_config
    echo ""
    
    if [ "$run_go" = true ]; then
        run_go_latency_test
        echo ""
    fi
    
    if [ "$run_java" = true ]; then
        run_java_latency_test
        echo ""
    fi
    
    analyze_results
    
    print_header "TEST COMPLETED"
    print_status "All latency tests completed successfully!"
    echo ""
    echo "Generated files:"
    ls -la *-latency-*.jsonl *-latency-*.debug 2>/dev/null || echo "No files generated"
}

# Run main function
main "$@" 