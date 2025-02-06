#!/bin/bash

# Enable debug mode
set -x

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

# Create the topic with 36 partitions and replication factor of 3
kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVER" \
  --create \
  --topic latency-test \
  --partitions 36 \
  --replication-factor 3 \
  --if-not-exists

# Verify the topic was created
kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVER" \
  --describe \
  --topic latency-test 