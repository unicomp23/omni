#!/bin/bash

# Automated Coordinated Producer-Consumer Test
# Creates fresh topics and runs time-based coordination test with n producers and m consumers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to get timestamp
get_timestamp() {
    date '+%Y-%m-%d %H:%M:%S.%3N'
}

print_status() {
    echo -e "${GREEN}[INFO]${NC} [$(get_timestamp)] $1"
}

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}[$(get_timestamp)] $1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} [$(get_timestamp)] $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} [$(get_timestamp)] $1"
}

print_success() {
    echo -e "${GREEN}✅${NC} [$(get_timestamp)] $1"
}

print_fail() {
    echo -e "${RED}❌${NC} [$(get_timestamp)] $1"
}

# Configuration with defaults
NUM_PRODUCERS=${1:-2}  # n producers
NUM_CONSUMERS=${2:-3}  # m consumers
MESSAGE_COUNT=${3:-4}  # messages per producer
SPACING_MS=${4:-800}   # x millis between messages
BUFFER_MS=${5:-2000}   # buffer time for consumers

# Global variables for process tracking
CONSUMER_PIDS=()
PRODUCER_PIDS=()
CONSUMER_OUTPUTS=()
PRODUCER_OUTPUTS=()
TEST_START_TIME=""

# Function to show usage
show_usage() {
    echo "Usage: $0 [NUM_PRODUCERS] [NUM_CONSUMERS] [MESSAGE_COUNT] [SPACING_MS] [BUFFER_MS]"
    echo ""
    echo "Parameters:"
    echo "  NUM_PRODUCERS  - Number of producers (default: 2)"
    echo "  NUM_CONSUMERS  - Number of consumers (default: 3)"
    echo "  MESSAGE_COUNT  - Messages per producer (default: 4)"
    echo "  SPACING_MS     - Milliseconds between messages (default: 800)"
    echo "  BUFFER_MS      - Consumer buffer time in ms (default: 2000)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Use defaults: 2 producers, 3 consumers, 4 messages, 800ms spacing"
    echo "  $0 3 2 5 1000         # 3 producers, 2 consumers, 5 messages, 1000ms spacing"
    echo "  $0 1 1 10 500 3000    # 1 producer, 1 consumer, 10 messages, 500ms spacing, 3s buffer"
}

# Check for help
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    show_usage
    exit 0
fi

# Function to check dependencies
check_dependencies() {
    print_header "CHECKING DEPENDENCIES"
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    if ! docker compose ps &> /dev/null; then
        print_error "Docker compose is not available"
        exit 1
    fi
    
    # Check if containers are running
    if ! docker compose ps --services --filter "status=running" | grep -q "dev-golang"; then
        print_error "Go container is not running! Please run 'docker compose up -d' first."
        exit 1
    fi
    
    if ! docker compose ps --services --filter "status=running" | grep -q "kafka4"; then
        print_error "Kafka container is not running! Please run 'docker compose up -d' first."
        exit 1
    fi
    
    # Check if coordinated programs exist
    if ! docker compose exec -T dev-golang sh -c "command -v coordinated-producer" >/dev/null 2>&1; then
        print_error "Coordinated producer not found in container! Please rebuild containers."
        exit 1
    fi
    
    if ! docker compose exec -T dev-golang sh -c "command -v coordinated-consumer" >/dev/null 2>&1; then
        print_error "Coordinated consumer not found in container! Please rebuild containers."
        exit 1
    fi
    
    print_success "All dependencies checked"
}

# Function to create fresh topics
create_fresh_topics() {
    print_header "CREATING FRESH TOPICS"
    
    if [ ! -f "scripts/topic-manager.sh" ]; then
        print_error "Topic manager script not found!"
        exit 1
    fi
    
    # Create fresh topics
    ./scripts/topic-manager.sh fresh
    
    if [ ! -f "topic-config.env" ]; then
        print_error "Topic configuration not created!"
        exit 1
    fi
    
    print_success "Fresh topics created"
}

# Function to start consumers
start_consumers() {
    print_header "STARTING CONSUMERS"
    
    for i in $(seq 1 $NUM_CONSUMERS); do
        print_status "Starting Consumer $i..."
        
        local output_file="consumer-$i-$(date +%Y%m%d-%H%M%S).log"
        CONSUMER_OUTPUTS+=($output_file)
        
        # Calculate total wait time: (messages * spacing) + buffer
        local wait_time_ms=$(((MESSAGE_COUNT * SPACING_MS) + BUFFER_MS))
        
        docker compose exec -T \
            -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" \
            -e CONSUMER_ID="$i" \
            dev-golang sh -c "coordinated-consumer $wait_time_ms" > "$output_file" 2>&1 &
        
        CONSUMER_PIDS+=($!)
        sleep 0.3  # Stagger consumer starts slightly
    done
    
    print_success "Started $NUM_CONSUMERS consumers"
    
    # Wait for consumers to initialize
    sleep 2
}

# Function to start producers
start_producers() {
    print_header "STARTING PRODUCERS"
    
    # Start all producers simultaneously
    for i in $(seq 1 $NUM_PRODUCERS); do
        print_status "Starting Producer $i..."
        
        local output_file="producer-$i-$(date +%Y%m%d-%H%M%S).log"
        PRODUCER_OUTPUTS+=($output_file)
        
        docker compose exec -T \
            -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" \
            -e PRODUCER_ID="$i" \
            -e MESSAGE_COUNT="$MESSAGE_COUNT" \
            -e MESSAGE_SPACING_MS="$SPACING_MS" \
            dev-golang sh -c "coordinated-producer" > "$output_file" 2>&1 &
        
        PRODUCER_PIDS+=($!)
        sleep 0.1  # Very small stagger to avoid exact simultaneous starts
    done
    
    print_success "Started $NUM_PRODUCERS producers"
}

# Function to wait for completion
wait_for_completion() {
    print_header "WAITING FOR COMPLETION"
    
    # Wait for all producers to complete
    print_status "Waiting for producers to complete..."
    for i in "${!PRODUCER_PIDS[@]}"; do
        local pid=${PRODUCER_PIDS[$i]}
        wait $pid 2>/dev/null || true
        print_status "Producer $((i+1)) completed"
    done
    
    # Wait for all consumers to complete
    print_status "Waiting for consumers to complete..."
    for i in "${!CONSUMER_PIDS[@]}"; do
        local pid=${CONSUMER_PIDS[$i]}
        wait $pid 2>/dev/null || true
        print_status "Consumer $((i+1)) completed"
    done
    
    print_success "All processes completed"
}

# Function to analyze results
analyze_results() {
    print_header "ANALYZING RESULTS"
    
    # Count total messages produced
    local total_messages_produced=$((NUM_PRODUCERS * MESSAGE_COUNT))
    print_status "Expected total messages: $total_messages_produced"
    
    # Analyze consumer outputs
    local total_processed=0
    local total_latency_records=0
    
    for i in "${!CONSUMER_OUTPUTS[@]}"; do
        local output_file=${CONSUMER_OUTPUTS[$i]}
        local consumer_id=$((i+1))
        
        if [ -f "$output_file" ]; then
            local processed=$(grep -c "Processed:" "$output_file" 2>/dev/null || echo "0")
            local latency_records=$(grep -c "^{" "$output_file" 2>/dev/null || echo "0")
            
            echo "  Consumer $consumer_id: $processed messages processed, $latency_records latency records"
            total_processed=$((total_processed + processed))
            total_latency_records=$((total_latency_records + latency_records))
        else
            echo "  Consumer $consumer_id: No output file found"
        fi
    done
    
    print_status "Total messages processed: $total_processed"
    print_status "Total latency records: $total_latency_records"
    
    # Check for coordinated messages
    local coordinated_messages=0
    for output_file in "${CONSUMER_OUTPUTS[@]}"; do
        if [ -f "$output_file" ]; then
            local coord_msgs=$(grep -c "coordinated-producer" "$output_file" 2>/dev/null || echo "0")
            coordinated_messages=$((coordinated_messages + coord_msgs))
        fi
    done
    
    print_status "Coordinated messages processed: $coordinated_messages"
    
    # Show producer outputs
    echo ""
    print_status "Producer completion status:"
    for i in "${!PRODUCER_OUTPUTS[@]}"; do
        local output_file=${PRODUCER_OUTPUTS[$i]}
        local producer_id=$((i+1))
        
        if [ -f "$output_file" ]; then
            if grep -q "completed" "$output_file" 2>/dev/null; then
                echo "  Producer $producer_id: ✅ Completed successfully"
            else
                echo "  Producer $producer_id: ❌ Did not complete"
            fi
        else
            echo "  Producer $producer_id: ❌ No output file found"
        fi
    done
    
    # Validate results
    if [ $coordinated_messages -eq $total_messages_produced ]; then
        print_success "All coordinated messages were processed correctly"
    else
        print_warning "Expected $total_messages_produced coordinated messages, got $coordinated_messages"
    fi
}

# Function to show detailed results
show_detailed_results() {
    print_header "DETAILED RESULTS"
    
    # Show timing analysis if jq is available
    if command -v jq &> /dev/null; then
        print_status "Latency analysis:"
        
        # Combine all latency records
        local combined_latency_file="combined-latency-$(date +%Y%m%d-%H%M%S).jsonl"
        
        for output_file in "${CONSUMER_OUTPUTS[@]}"; do
            if [ -f "$output_file" ]; then
                grep "^{" "$output_file" >> "$combined_latency_file" 2>/dev/null || true
            fi
        done
        
        if [ -f "$combined_latency_file" ] && [ -s "$combined_latency_file" ]; then
            local record_count=$(wc -l < "$combined_latency_file")
            echo "  - Total latency records: $record_count"
            
            # Analyze coordinated messages only
            local coord_latency_file="coordinated-latency-$(date +%Y%m%d-%H%M%S).jsonl"
            jq 'select(.producer_id > 0)' "$combined_latency_file" > "$coord_latency_file" 2>/dev/null || true
            
            if [ -f "$coord_latency_file" ] && [ -s "$coord_latency_file" ]; then
                local coord_count=$(wc -l < "$coord_latency_file")
                echo "  - Coordinated message latency records: $coord_count"
                
                if [ $coord_count -gt 0 ]; then
                    echo "  - Min latency: $(jq -s 'map(.latency_ms) | min' "$coord_latency_file") ms"
                    echo "  - Max latency: $(jq -s 'map(.latency_ms) | max' "$coord_latency_file") ms"
                    echo "  - Avg latency: $(jq -s 'map(.latency_ms) | add / length' "$coord_latency_file") ms"
                fi
            fi
        fi
    else
        print_warning "jq not available for detailed latency analysis"
    fi
    
    # List generated files
    echo ""
    print_status "Generated files:"
    ls -la consumer-*.log producer-*.log *-latency-*.jsonl 2>/dev/null || echo "  No files generated"
}

# Function to cleanup
cleanup() {
    print_header "CLEANUP"
    
    # Clean up log files (optional)
    if [ "${CLEANUP_LOGS:-false}" = "true" ]; then
        print_status "Cleaning up log files..."
        rm -f consumer-*.log producer-*.log 2>/dev/null || true
    fi
    
    print_success "Cleanup completed"
}

# Function to show test summary
show_test_summary() {
    print_header "TEST SUMMARY"
    
    # Calculate expected durations
    local producer_duration=$((MESSAGE_COUNT * SPACING_MS))
    local consumer_duration=$((producer_duration + BUFFER_MS))
    
    echo -e "${BLUE}Configuration:${NC}"
    echo "  - Producers: $NUM_PRODUCERS"
    echo "  - Consumers: $NUM_CONSUMERS"
    echo "  - Messages per producer: $MESSAGE_COUNT"
    echo "  - Message spacing: ${SPACING_MS}ms"
    echo "  - Consumer buffer: ${BUFFER_MS}ms"
    echo "  - Topic: $GO_LATENCY_TOPIC"
    echo ""
    
    echo -e "${BLUE}Expected Timing:${NC}"
    echo "  - Producer emission time: ${producer_duration}ms"
    echo "  - Consumer wait time: ${consumer_duration}ms"
    echo "  - Total expected messages: $((NUM_PRODUCERS * MESSAGE_COUNT))"
    echo ""
    
    echo -e "${GREEN}✅ Benefits of Time-Based Coordination:${NC}"
    echo "  - Consumers exit gracefully without timeouts"
    echo "  - No dependency on message count per consumer"
    echo "  - Works with any partition/consumer distribution"
    echo "  - Scales with multiple producers and consumers"
    echo "  - Predictable exit timing"
    echo ""
    
    echo -e "${BLUE}📊 How it works:${NC}"
    echo "  1. Producers embed timing metadata in messages"
    echo "  2. Consumers learn emission pattern from first coordinated message"
    echo "  3. Consumers calculate: (messages × spacing) + buffer"
    echo "  4. All consumers exit after emission period + buffer"
    echo "  5. No coordination overhead or complex synchronization"
}

# Function to handle signal interruption
handle_signal() {
    local signal_name="$1"
    local end_time=$(get_timestamp)
    local elapsed_time=""
    
    if [ -n "$TEST_START_TIME" ]; then
        local start_epoch=$(date -d "$TEST_START_TIME" +%s)
        local end_epoch=$(date +%s)
        elapsed_time=" (elapsed: $((end_epoch - start_epoch))s)"
    fi
    
    print_error "Test interrupted by signal $signal_name at $end_time$elapsed_time"
    
    # Kill all running processes
    if [ ${#PRODUCER_PIDS[@]} -gt 0 ]; then
        print_status "Terminating ${#PRODUCER_PIDS[@]} producer processes..."
        for pid in "${PRODUCER_PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done
    fi
    
    if [ ${#CONSUMER_PIDS[@]} -gt 0 ]; then
        print_status "Terminating ${#CONSUMER_PIDS[@]} consumer processes..."
        for pid in "${CONSUMER_PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done
    fi
    
    # Give processes time to terminate gracefully
    sleep 1
    
    # Force kill any remaining processes
    for pid in "${PRODUCER_PIDS[@]}" "${CONSUMER_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
    
    print_status "Process cleanup completed"
    exit 1
}

# Main execution
main() {
    TEST_START_TIME=$(get_timestamp)
    print_header "AUTOMATED COORDINATED PRODUCER-CONSUMER TEST"
    
    # Show configuration
    show_test_summary
    
    # Run test phases
    check_dependencies
    create_fresh_topics
    
    # Load topic configuration
    source topic-config.env
    
    start_consumers
    start_producers
    wait_for_completion
    analyze_results
    show_detailed_results
    cleanup
    
    print_header "TEST COMPLETED SUCCESSFULLY"
    print_success "Coordinated producer-consumer test completed!"
    
    echo ""
    echo -e "${YELLOW}💡 Next steps:${NC}"
    echo "  - Review latency records in generated .jsonl files"
    echo "  - Run with different configurations: $0 --help"
    echo "  - Scale test: $0 5 3 10 500 1000"
}

# Trap to handle interruption
trap 'handle_signal "INT"' INT
trap 'handle_signal "TERM"' TERM

# Run main function
main "$@" 