#!/bin/bash

# Enable debug mode
set -x

# Detect CPU architecture
ARCH=$(uname -m)
echo "Detected CPU architecture: $ARCH"

if [ "$ARCH" = "x86_64" ]; then
    BINARY="./bin/producer-linux-amd64"
elif [ "$ARCH" = "aarch64" ]; then
    BINARY="./bin/producer-linux-arm64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

# Try to get bootstrap server from AWS SSM, fall back to redpanda if not available
if command -v aws &> /dev/null; then
    BOOTSTRAP_SERVER=$(aws ssm get-parameter --name "/cantina/kafka/connect_string" --query "Parameter.Value" --output text)
    if [ $? -eq 0 ] && [ ! -z "$BOOTSTRAP_SERVER" ]; then
        echo "Successfully retrieved bootstrap server from SSM"
    else
        echo "Failed to get SSM parameter, falling back to redpanda"
        BOOTSTRAP_SERVER="redpanda:9092"
    fi
else
    echo "AWS CLI not found, falling back to redpanda"
    BOOTSTRAP_SERVER="redpanda:9092"
fi

echo "Using bootstrap server: '$BOOTSTRAP_SERVER'"

# Create topic if it doesn't exist
if command -v kafka-topics.sh &> /dev/null; then
    echo "Creating topic if it doesn't exist..."
    ./create-topic.sh
else
    echo "Warning: kafka-topics.sh not found, skipping topic creation"
fi

# Make binary executable
chmod +x $BINARY

# Execute the appropriate binary
echo "Using binary: $BINARY"
$BINARY \
  -broker "$BOOTSTRAP_SERVER" \
  -topic "latency-test" \
  -thread 100 \
  -ack 1 \
  -addr :8082 \
  -iterations 432000

#   -iterations 7200
