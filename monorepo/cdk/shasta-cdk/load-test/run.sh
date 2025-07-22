#!/bin/bash
set -e

echo "=========================================="
echo "RedPanda Load Test with franz-go & UUID Topics"
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
TOPIC=${TOPIC:-}  # Leave empty to auto-generate UUID topic
PARTITIONS=${PARTITIONS:-12}
CLEANUP_OLD_TOPICS=${CLEANUP_OLD_TOPICS:-true}
WARMUP_MESSAGES=${WARMUP_MESSAGES:-1000}

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
        --no-cleanup)
            CLEANUP_OLD_TOPICS=false
            shift
            ;;
        --warmup-messages)
            WARMUP_MESSAGES="$2"
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
            echo "  --topic NAME        Topic name (default: auto-generate with UUID)"
            echo "  --partitions N      Number of topic partitions (default: 12)"
            echo "  --no-cleanup        Skip cleanup of old test topics"
            echo "  --warmup-messages N Number of messages to skip for warm-up (default: 1000)"
            echo ""
            echo "Environment Variables:"
            echo "  REDPANDA_BROKERS    Comma-separated broker addresses"
            echo ""
            echo "🆔 NEW: Each test run creates a unique topic with UUID"
            echo "🗑️  OLD test topics are automatically cleaned up"
            echo ""
            echo "Examples:"
            echo "  $0                                    # Run with defaults (UUID topic)"
            echo "  $0 --producers 10 --consumers 5      # Custom producer/consumer counts"
            echo "  $0 --message-size 4096 --duration 10m # Larger messages, longer test"
            echo "  $0 --compression zstd                 # Use zstd compression"
            echo "  $0 --topic my-specific-topic         # Use specific topic name"
            echo "  $0 --no-cleanup                      # Skip old topic cleanup"
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
if [ -n "$TOPIC" ]; then
    echo "  Topic: $TOPIC (user-specified)"
else
    echo "  Topic: [auto-generated UUID topic]"
fi
echo "  Producers: $PRODUCERS"
echo "  Consumers: $CONSUMERS"
echo "  Message Size: $MESSAGE_SIZE bytes"
echo "  Duration: $DURATION"
echo "  Compression: $COMPRESSION"
echo "  Partitions: $PARTITIONS"
echo "  Cleanup old topics: $CLEANUP_OLD_TOPICS"
echo "  Warm-up messages: $WARMUP_MESSAGES (excluded from latency percentiles)"
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

# Build command arguments
CMD_ARGS=(
    "-brokers=$REDPANDA_BROKERS"
    "-producers=$PRODUCERS"
    "-consumers=$CONSUMERS"
    "-message-size=$MESSAGE_SIZE"
    "-duration=$DURATION"
    "-compression=$COMPRESSION"
    "-partitions=$PARTITIONS"
    "-batch-size=100"
    "-print-interval=10s"
    "-cleanup-old-topics=$CLEANUP_OLD_TOPICS"
    "-warmup-messages=$WARMUP_MESSAGES"
)

# Add topic if specified, otherwise let the binary generate UUID
if [ -n "$TOPIC" ]; then
    CMD_ARGS+=("-topic=$TOPIC")
fi

echo "🚀 Executing: ./load-test ${CMD_ARGS[*]}"
echo ""

# Run the load test
exec ./load-test "${CMD_ARGS[@]}" 