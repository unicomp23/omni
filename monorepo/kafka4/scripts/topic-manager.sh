#!/bin/bash

# Topic Manager Script
# Manages Kafka topics with UUID generation for fresh test runs

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
KAFKA_CONTAINER="kafka4"
BOOTSTRAP_SERVER="kafka4:29092"
TOPIC_PREFIX="test-"

# Function to generate UUID (since uuidgen is not available)
generate_uuid() {
    python3 -c "import uuid; print(str(uuid.uuid4()))"
}

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

# Function to check if Kafka is running
check_kafka() {
    if ! docker compose ps | grep -q "kafka4.*Up"; then
        print_error "Kafka container is not running. Please start with: docker compose up -d"
        exit 1
    fi
}

# Function to list all topics
list_topics() {
    print_status "Listing all topics..."
    docker compose exec -T $KAFKA_CONTAINER kafka-topics \
        --list \
        --bootstrap-server $BOOTSTRAP_SERVER 2>/dev/null || true
}

# Function to delete all test topics
cleanup_topics() {
    print_header "CLEANING UP OLD TOPICS"
    
    # Get list of topics
    topics=$(docker compose exec -T $KAFKA_CONTAINER kafka-topics \
        --list \
        --bootstrap-server $BOOTSTRAP_SERVER 2>/dev/null | grep -E "^(test-|latency-)" || true)
    
    if [ -z "$topics" ]; then
        print_status "No test topics found to cleanup"
        return 0
    fi
    
    print_status "Found topics to cleanup:"
    echo "$topics" | sed 's/^/  - /'
    
    # Delete each topic
    for topic in $topics; do
        print_status "Deleting topic: $topic"
        docker compose exec -T $KAFKA_CONTAINER kafka-topics \
            --delete \
            --topic "$topic" \
            --bootstrap-server $BOOTSTRAP_SERVER 2>/dev/null || print_warning "Failed to delete $topic"
    done
    
    print_status "Cleanup completed"
}

# Function to create a new topic with UUID
create_topic() {
    local topic_type=$1
    local uuid=$(generate_uuid)
    local topic_name="${TOPIC_PREFIX}${topic_type}-${uuid}"
    
    print_status "Creating topic: $topic_name" >&2
    
    docker compose exec -T $KAFKA_CONTAINER kafka-topics \
        --create \
        --topic "$topic_name" \
        --bootstrap-server $BOOTSTRAP_SERVER \
        --partitions 3 \
        --replication-factor 1 >/dev/null 2>&1
    
    echo "$topic_name"
}

# Function to create topic configuration file
create_topic_config() {
    local go_topic=$1
    local java_topic=$2
    local general_topic=$3
    
    cat > topic-config.env << EOF
# Generated topic configuration - $(date)
# These topics have unique UUIDs to ensure fresh test runs

# Go latency testing topic
GO_LATENCY_TOPIC=$go_topic

# Java latency testing topic  
JAVA_LATENCY_TOPIC=$java_topic

# General testing topic
GENERAL_TEST_TOPIC=$general_topic

# Export for shell scripts
export GO_LATENCY_TOPIC JAVA_LATENCY_TOPIC GENERAL_TEST_TOPIC
EOF
    
    print_status "Created topic-config.env with new topic names"
}

# Function to setup fresh topics for a test run
setup_fresh_topics() {
    print_header "SETTING UP FRESH TOPICS"
    
    # Create topics for different purposes
    go_topic=$(create_topic "go-latency" 2>/dev/null)
    java_topic=$(create_topic "java-latency" 2>/dev/null)
    general_topic=$(create_topic "general" 2>/dev/null)
    
    # Create configuration file
    create_topic_config "$go_topic" "$java_topic" "$general_topic"
    
    print_status "Fresh topics created:"
    echo "  - Go Latency:  $go_topic"
    echo "  - Java Latency: $java_topic"
    echo "  - General:     $general_topic"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  list      - List all topics"
    echo "  cleanup   - Delete all test topics"
    echo "  setup     - Create fresh topics with UUIDs"
    echo "  fresh     - Cleanup old topics and create fresh ones"
    echo "  help      - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 fresh           # Full cleanup and setup"
    echo "  $0 cleanup         # Only cleanup old topics"
    echo "  $0 setup           # Only create new topics"
}

# Main script logic
main() {
    check_kafka
    
    case "${1:-help}" in
        "list")
            list_topics
            ;;
        "cleanup")
            cleanup_topics
            ;;
        "setup")
            setup_fresh_topics
            ;;
        "fresh")
            cleanup_topics
            echo ""
            setup_fresh_topics
            ;;
        "help"|"-h"|"--help")
            show_usage
            ;;
        *)
            print_error "Unknown command: $1"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Run main function
main "$@" 