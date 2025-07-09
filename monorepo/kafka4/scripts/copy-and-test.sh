#!/bin/bash

# Copy Code and Test Script
# This script copies fresh code into containers and runs latency tests

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

# Function to copy Go project into container
copy_go_project() {
    print_status "Copying Go project into container..."
    
    # Clean up any existing files in container
    docker compose exec dev-golang sh -c "rm -rf /app"
    docker compose exec dev-golang sh -c "mkdir -p /app"
    
    # Copy files
    docker cp golang-project/. dev-golang:/app/
    
    # Download Go dependencies
    print_status "Downloading Go dependencies..."
    docker compose exec dev-golang sh -c "cd /app && go mod download"
    docker compose exec dev-golang sh -c "cd /app && go mod tidy"
    
    # Verify copy
    local file_count=$(docker compose exec dev-golang sh -c "ls -1 /app | wc -l")
    print_status "Copied Go project: $file_count files in container (with dependencies)"
}

# Function to copy Java project into container  
copy_java_project() {
    print_status "Copying Java project into container..."
    
    # Clean up any existing files in container
    docker compose exec dev-java sh -c "rm -rf /app"
    docker compose exec dev-java sh -c "mkdir -p /app"
    
    # Copy files
    docker cp java-project/. dev-java:/app/
    
    # Build the project in container
    print_status "Building Java project in container..."
    docker compose exec dev-java sh -c "cd /app && mvn clean compile dependency:copy-dependencies -q"
    
    # Verify copy and build
    local file_count=$(docker compose exec dev-java sh -c "ls -1 /app | wc -l")
    print_status "Copied and built Java project: $file_count files in container"
}

# Function to copy scripts into containers
copy_scripts() {
    print_status "Copying topic management scripts..."
    
    # Copy to both containers
    docker cp scripts/topic-manager.sh dev-golang:/app/
    docker cp scripts/topic-manager.sh dev-java:/app/
    
    # Make executable
    docker compose exec dev-golang sh -c "chmod +x /app/topic-manager.sh"
    docker compose exec dev-java sh -c "chmod +x /app/topic-manager.sh"
}

# Function to run Go latency test in container
run_go_test_in_container() {
    print_header "RUNNING GO TEST IN CONTAINER"
    
    local output_file="go-container-$(date +%Y%m%d-%H%M%S).jsonl"
    local debug_file="go-container-$(date +%Y%m%d-%H%M%S).debug"
    
    # Load topic config and export to container
    if [ ! -f "topic-config.env" ]; then
        print_error "No topic configuration found. Run topic manager first."
        return 1
    fi
    
    source topic-config.env
    
    print_status "Starting Go consumer in container..."
    timeout 30s docker compose exec -T -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" dev-golang sh -c "
        cd /app && 
        go run latency-consumer.go
    " > "$output_file" 2> "$debug_file" &
    
    local consumer_pid=$!
    sleep 2
    
    print_status "Starting Go producer in container..."
    docker compose exec -T -e GO_LATENCY_TOPIC="$GO_LATENCY_TOPIC" dev-golang sh -c "
        cd /app && 
        go run latency-producer.go
    "
    
    # Wait for consumer to finish
    wait $consumer_pid 2>/dev/null || true
    
    print_status "Go test completed. Results in: $output_file"
    
    # Show quick summary
    if [ -f "$output_file" ]; then
        local record_count=$(wc -l < "$output_file")
        print_status "Go test generated $record_count latency records"
        
        # Show sample results
        if [ $record_count -gt 0 ]; then
            echo "Sample results:"
            head -2 "$output_file" | jq -r '"  ID: \(.message_id) | Latency: \(.latency_ms) ms"' 2>/dev/null || head -2 "$output_file"
        fi
    fi
}

# Function to run Java latency test in container
run_java_test_in_container() {
    print_header "RUNNING JAVA TEST IN CONTAINER"
    
    local output_file="java-container-$(date +%Y%m%d-%H%M%S).jsonl"
    local debug_file="java-container-$(date +%Y%m%d-%H%M%S).debug"
    
    # Load topic config
    source topic-config.env
    
    print_status "Starting Java consumer in container..."
    timeout 30s docker compose exec -T -e JAVA_LATENCY_TOPIC="$JAVA_LATENCY_TOPIC" dev-java sh -c "
        cd /app && 
        java -cp 'target/classes:target/dependency/*' com.example.kafka.LatencyConsumer
    " > "$output_file" 2> "$debug_file" &
    
    local consumer_pid=$!
    sleep 2
    
    print_status "Starting Java producer in container..."
    docker compose exec -T -e JAVA_LATENCY_TOPIC="$JAVA_LATENCY_TOPIC" dev-java sh -c "
        cd /app && 
        java -cp 'target/classes:target/dependency/*' com.example.kafka.LatencyProducer
    "
    
    # Wait for consumer to finish
    wait $consumer_pid 2>/dev/null || true
    
    print_status "Java test completed. Results in: $output_file"
    
    # Show quick summary
    if [ -f "$output_file" ]; then
        local record_count=$(wc -l < "$output_file")
        print_status "Java test generated $record_count latency records"
        
        # Show sample results
        if [ $record_count -gt 0 ]; then
            echo "Sample results:"
            head -2 "$output_file" | jq -r '"  ID: \(.message_id) | Latency: \(.latency_ms) ms"' 2>/dev/null || head -2 "$output_file"
        fi
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --go-only     Copy and test only Go code"
    echo "  --java-only   Copy and test only Java code"
    echo "  --copy-only   Only copy code, don't run tests"
    echo "  --no-fresh    Don't create fresh topics"
    echo "  --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                    # Copy all code and run all tests"
    echo "  $0 --go-only          # Copy and test only Go"
    echo "  $0 --copy-only        # Just copy code without testing"
}

# Main function
main() {
    local run_go=true
    local run_java=true
    local copy_only=false
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
    
    # Copy projects
    print_header "COPYING FRESH CODE INTO CONTAINERS"
    
    if [ "$run_go" = true ]; then
        copy_go_project
    fi
    
    if [ "$run_java" = true ]; then
        copy_java_project
    fi
    
    copy_scripts
    echo ""
    
    # Run tests if not copy-only
    if [ "$copy_only" = false ]; then
        if [ "$run_go" = true ]; then
            run_go_test_in_container
            echo ""
        fi
        
        if [ "$run_java" = true ]; then
            run_java_test_in_container
            echo ""
        fi
        
        print_header "ALL TESTS COMPLETED"
        print_status "Results saved with timestamped filenames"
        echo ""
        echo "Generated files:"
        ls -la *-container-*.jsonl *-container-*.debug 2>/dev/null || echo "No files generated"
    else
        print_header "CODE COPY COMPLETED"
        print_status "Code copied to containers. Ready for testing."
    fi
}

# Run main function
main "$@" 