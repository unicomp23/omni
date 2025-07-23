#!/bin/bash

# Automated Kafka/RedPanda Load Testing Script
# Creates topics and runs comprehensive performance tests

set -e

# Configuration
TOPIC="${TOPIC:-load-test-topic}"
PARTITIONS="${PARTITIONS:-3}"
REPLICAS="${REPLICAS:-3}"
KEY_PATH="${KEY_PATH:-/data/.ssh/john.davis.pem}"

# Get first RedPanda node IP from CloudFormation stack
STACK_NAME="${STACK_NAME:-RedPandaClusterStack}"
FIRST_NODE_IP=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='RedPandaClusterPublicIPs'].OutputValue" \
    --output text | cut -d',' -f1)

echo "🚀 Starting Kafka Load Test Automation"
echo "======================================"
echo "Topic: $TOPIC"
echo "Partitions: $PARTITIONS"
echo "Replicas: $REPLICAS"
echo "RedPanda Node: $FIRST_NODE_IP"
echo ""

# Create topic using native RPK
echo "📋 Creating topic '$TOPIC'..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no ec2-user@"$FIRST_NODE_IP" \
    "rpk topic create '$TOPIC' --partitions $PARTITIONS --replicas $REPLICAS" \
    2>/dev/null || echo 'Topic may already exist'

echo "✅ Topic creation completed"
echo ""

# Run load test
echo "⚡ Starting load test..."
cd load-test && ./run.sh

echo ""
echo "🎉 Load test automation completed!" 