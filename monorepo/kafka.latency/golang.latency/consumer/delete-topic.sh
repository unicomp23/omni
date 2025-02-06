#!/bin/bash

# Enable debug mode
set -x

# Set AWS region
export AWS_REGION="us-east-1"
export AWS_DEFAULT_REGION="us-east-1"

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

# Delete the topic with 3 partitions and replication factor of 3
if command -v kafka-topics.sh &> /dev/null; then
    kafka-topics.sh \
      --bootstrap-server "$BOOTSTRAP_SERVER" \
      --delete \
      --topic latency-test

    # Verify the topic was deleted
    kafka-topics.sh \
      --bootstrap-server "$BOOTSTRAP_SERVER" \
      --list | grep latency-test
else
    echo "Warning: kafka-topics.sh not found, skipping topic deletion"
    exit 1
fi 