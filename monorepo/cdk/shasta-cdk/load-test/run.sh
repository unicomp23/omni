#!/bin/bash
set -e

echo "=========================================="
echo "RedPanda Load Test with franz-go"
echo "=========================================="

# Source environment variables
if [ -f ~/.bashrc ]; then
    source ~/.bashrc
fi

# Get RedPanda cluster IPs from environment or CloudFormation
if [ -z "$REDPANDA_BROKERS" ]; then
    echo "Auto-discovering RedPanda brokers..."
    
    # Try to get from CloudFormation outputs
    BOOTSTRAP_BROKERS=$(aws cloudformation describe-stacks --region ${AWS_DEFAULT_REGION:-us-east-1} --stack-name RedPandaClusterStack --query 'Stacks[0].Outputs[?OutputKey==`RedPandaBootstrapBrokers`].OutputValue' --output text 2>/dev/null || echo "")
    
    if [ -n "$BOOTSTRAP_BROKERS" ]; then
        export REDPANDA_BROKERS="$BOOTSTRAP_BROKERS"
        echo "Found brokers from CloudFormation: $REDPANDA_BROKERS"
    else
        # Default to localhost for testing
        export REDPANDA_BROKERS="localhost:9092"
        echo "Using default broker: $REDPANDA_BROKERS"
        echo "WARNING: Could not auto-discover RedPanda cluster. Using localhost."
    fi
fi

echo "RedPanda Brokers: $REDPANDA_BROKERS"

# Parse command line arguments with defaults
PRODUCERS=${PRODUCERS:-6}
CONSUMERS=${CONSUMERS:-6}
MESSAGE_SIZE=${MESSAGE_SIZE:-1024}
DURATION=${DURATION:-300s}
COMPRESSION=${COMPRESSION:-snappy}
TOPIC=${TOPIC:-load-test-topic}
PARTITIONS=${PARTITIONS:-12}

# Parse command line flags
while [[ $# -gt 0 ]]; do
    case $1 in
        --producers)
            PRODUCERS="$2"
            shift 2
            ;;
        --consumers)
            CONSUMERS="$2"
            shift 2
            ;;
        --message-size)
            MESSAGE_SIZE="$2"
            shift 2
            ;;
        --duration)
            DURATION="$2"
            shift 2
            ;;
        --compression)
            COMPRESSION="$2"
            shift 2
            ;;
        --topic)
            TOPIC="$2"
            shift 2
            ;;
        --partitions)
            PARTITIONS="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --producers N       Number of producer goroutines (default: 6)"
            echo "  --consumers N       Number of consumer goroutines (default: 6)"
            echo "  --message-size N    Message size in bytes (default: 1024)"
            echo "  --duration D        Test duration (default: 300s)"
            echo "  --compression TYPE  Compression type: none, gzip, snappy, lz4, zstd (default: snappy)"
            echo "  --topic NAME        Topic name (default: load-test-topic)"
            echo "  --partitions N      Number of topic partitions (default: 12)"
            echo ""
            echo "Environment Variables:"
            echo "  REDPANDA_BROKERS    Comma-separated broker addresses"
            echo ""
            echo "Examples:"
            echo "  $0                                    # Run with defaults"
            echo "  $0 --producers 10 --consumers 5      # Custom producer/consumer counts"
            echo "  $0 --message-size 4096 --duration 10m # Larger messages, longer test"
            echo "  $0 --compression zstd                 # Use zstd compression"
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo ""
echo "Configuration:"
echo "  Brokers: $REDPANDA_BROKERS"
echo "  Topic: $TOPIC"
echo "  Producers: $PRODUCERS"
echo "  Consumers: $CONSUMERS"
echo "  Message Size: $MESSAGE_SIZE bytes"
echo "  Duration: $DURATION"
echo "  Compression: $COMPRESSION"
echo "  Partitions: $PARTITIONS"
echo ""

# Wait for user confirmation
echo -n "Press Enter to start the load test (Ctrl+C to cancel)..."
read

echo "Starting load test..."
echo ""

# Check if binary exists, build if needed
if [ ! -f "./load-test" ]; then
    echo "Building load test binary..."
    /usr/local/go/bin/go build -o load-test .
    echo "Build complete."
    echo ""
fi

# Run the load test
exec ./load-test \
    -brokers="$REDPANDA_BROKERS" \
    -topic="$TOPIC" \
    -producers="$PRODUCERS" \
    -consumers="$CONSUMERS" \
    -message-size="$MESSAGE_SIZE" \
    -duration="$DURATION" \
    -compression="$COMPRESSION" \
    -partitions="$PARTITIONS" \
    -batch-size=100 \
    -print-interval=10s 