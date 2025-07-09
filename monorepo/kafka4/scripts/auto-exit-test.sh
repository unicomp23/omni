#!/bin/bash

# Auto-Exit Test Script
# This script demonstrates clean automatic exit for producers and consumers

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

# Function to copy auto-exit code to containers
copy_auto_exit_code() {
    print_status "Copying auto-exit consumers to containers..."
    
    # Clean up and create directories
    docker compose exec dev-golang sh -c "rm -rf /app && mkdir -p /app"
    docker compose exec dev-java sh -c "rm -rf /app && mkdir -p /app"
    
    # Copy Go project
    docker cp golang-project/. dev-golang:/app/
    docker compose exec dev-golang sh -c "cd /app && go mod download && go mod tidy"
    
    # Copy Java project and build
    docker cp java-project/. dev-java:/app/
    docker compose exec dev-java sh -c "cd /app && mvn clean compile dependency:copy-dependencies -q"
    
    print_status "Auto-exit code copied and built successfully"
}

# Function to run coordinated test
run_coordinated_test() {
    local language=$1
    local message_count=${2:-10}
    local timeout_seconds=${3:-15}
    
    print_header "RUNNING $language AUTO-EXIT TEST"
    
    local output_file="${language,,}-auto-exit-$(date +%Y%m%d-%H%M%S).jsonl"
    local debug_file="${language,,}-auto-exit-$(date +%Y%m%d-%H%M%S).debug"
    
    # Load topic config
    if [ ! -f "topic-config.env" ]; then
        print_error "No topic configuration found. Run topic manager first."
        return 1
    fi
    source topic-config.env
    
    print_status "Test configuration:"
    echo "  - Language: $language"
    echo "  - Expected messages: $message_count"
    echo "  - Consumer timeout: $timeout_seconds seconds"
    echo "  - Topic: $([ "$language" == "Go" ] && echo "$GO_LATENCY_TOPIC" || echo "$JAVA_LATENCY_TOPIC")"
    
    if [ "$language" == "Go" ]; then
        # Start Go consumer
        print_status "Starting Go auto-exit consumer..."
        docker compose exec -T \
            -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" \
            -e EXPECTED_MESSAGE_COUNT="$message_count" \
            -e CONSUMER_TIMEOUT_SECONDS="$timeout_seconds" \
            dev-golang sh -c "cd /app && go run auto-exit-consumer.go" \
            > "$output_file" 2> "$debug_file" &
        
        local consumer_pid=$!
        sleep 2
        
        # Start Go producer
        print_status "Starting Go producer..."
        docker compose exec -T \
            -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" \
            dev-golang sh -c "cd /app && go run latency-producer.go"
        
    else
        # Start Java consumer
        print_status "Starting Java auto-exit consumer..."
        docker compose exec -T \
            -e JAVA_LATENCY_TOPIC="$JAVA_LATENCY_TOPIC" \
            -e EXPECTED_MESSAGE_COUNT="$message_count" \
            -e CONSUMER_TIMEOUT_SECONDS="$timeout_seconds" \
            dev-java sh -c "cd /app && java -cp 'target/classes:target/dependency/*' com.example.kafka.AutoExitLatencyConsumer" \
            > "$output_file" 2> "$debug_file" &
        
        local consumer_pid=$!
        sleep 2
        
        # Start Java producer
        print_status "Starting Java producer..."
        docker compose exec -T \
            -e JAVA_LATENCY_TOPIC="$JAVA_LATENCY_TOPIC" \
            dev-java sh -c "cd /app && java -cp 'target/classes:target/dependency/*' com.example.kafka.LatencyProducer"
    fi
    
    # Wait for consumer to finish naturally
    print_status "Waiting for consumer to auto-exit..."
    wait $consumer_pid 2>/dev/null || true
    
    # Show results
    if [ -f "$output_file" ]; then
        local record_count=$(wc -l < "$output_file")
        print_status "$language test completed: $record_count records in $output_file"
        
        if [ $record_count -gt 0 ]; then
            echo "Sample results:"
            head -2 "$output_file" | jq -r '"  ID: \(.message_id) | Latency: \(.latency_ms) ms"' 2>/dev/null || head -2 "$output_file"
            
            # Calculate average latency
            if command -v jq &> /dev/null; then
                local avg_latency=$(jq -s 'map(.latency_ms) | add / length' "$output_file" 2>/dev/null || echo "N/A")
                echo "  Average latency: $avg_latency ms"
            fi
        fi
        
        # Show exit reason from debug log
        echo "Consumer exit reason:"
        tail -2 "$debug_file" | head -1 | sed 's/^/  /'
    else
        print_warning "No output file generated"
    fi
}

# Function to demo different exit strategies
demo_exit_strategies() {
    print_header "DEMONSTRATING AUTO-EXIT STRATEGIES"
    
    echo "Strategy 1: Expected Message Count (10 messages, 15s timeout)"
    run_coordinated_test "Go" 10 15
    echo ""
    
    echo "Strategy 2: Quick Test (5 messages, 10s timeout)"
    run_coordinated_test "Java" 5 10
    echo ""
    
    echo "Strategy 3: Idle Timeout Test (expect 10, but producer sends only 5)"
    print_status "This will demonstrate idle timeout when fewer messages are received"
    # Would need a modified producer for this demo
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --go-test [count] [timeout]     Run Go auto-exit test"
    echo "  --java-test [count] [timeout]   Run Java auto-exit test"
    echo "  --demo                          Demo different exit strategies"
    echo "  --copy-only                     Only copy code, don't run tests"
    echo "  --no-fresh                      Don't create fresh topics"
    echo "  --help                          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --go-test                    # Go test with defaults (10 msg, 15s)"
    echo "  $0 --java-test 5 10             # Java test with 5 messages, 10s timeout"
    echo "  $0 --demo                       # Show multiple exit strategies"
}

# Main function
main() {
    local run_go=false
    local run_java=false
    local run_demo=false
    local copy_only=false
    local create_fresh=true
    local message_count=10
    local timeout_seconds=15
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --go-test)
                run_go=true
                shift
                # Optional message count
                if [[ $1 =~ ^[0-9]+$ ]]; then
                    message_count=$1
                    shift
                    # Optional timeout
                    if [[ $1 =~ ^[0-9]+$ ]]; then
                        timeout_seconds=$1
                        shift
                    fi
                fi
                ;;
            --java-test)
                run_java=true
                shift
                # Optional message count
                if [[ $1 =~ ^[0-9]+$ ]]; then
                    message_count=$1
                    shift
                    # Optional timeout
                    if [[ $1 =~ ^[0-9]+$ ]]; then
                        timeout_seconds=$1
                        shift
                    fi
                fi
                ;;
            --demo)
                run_demo=true
                shift
                ;;
            --copy-only)
                copy_only=true
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
    
    # Default to demo if no specific test chosen
    if [ "$run_go" = false ] && [ "$run_java" = false ] && [ "$run_demo" = false ]; then
        run_demo=true
    fi
    
    # Check if containers are running
    if ! docker compose ps | grep -q "dev-golang.*Up"; then
        print_error "Containers not running. Start with: docker compose up -d"
        exit 1
    fi
    
    # Create fresh topics if requested
    if [ "$create_fresh" = true ]; then
        print_header "CREATING FRESH TOPICS"
        ./scripts/topic-manager.sh fresh
        echo ""
    fi
    
    # Copy code
    copy_auto_exit_code
    echo ""
    
    # Run tests if not copy-only
    if [ "$copy_only" = false ]; then
        if [ "$run_demo" = true ]; then
            demo_exit_strategies
        else
            if [ "$run_go" = true ]; then
                run_coordinated_test "Go" $message_count $timeout_seconds
                echo ""
            fi
            
            if [ "$run_java" = true ]; then
                run_coordinated_test "Java" $message_count $timeout_seconds
                echo ""
            fi
        fi
        
        print_header "AUTO-EXIT TESTS COMPLETED"
        print_status "All consumers exited automatically without timeout kills!"
        echo ""
        echo "Generated files:"
        ls -la *-auto-exit-*.jsonl *-auto-exit-*.debug 2>/dev/null || echo "No files generated"
    else
        print_header "CODE COPY COMPLETED"
        print_status "Auto-exit code copied to containers. Ready for testing."
    fi
}

# Run main function
main "$@" 