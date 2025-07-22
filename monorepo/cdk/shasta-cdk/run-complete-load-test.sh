#!/bin/bash

# Complete RedPanda Load Test Automation Script
# This script automates the entire process: setup, deployment, and execution
# NEW: Includes UUID-based unique topics and automatic cleanup

set -e

echo "========================================================="
echo "RedPanda Complete Load Test Automation with UUID Topics"
echo "========================================================="

# Configuration
export AWS_PROFILE="${AWS_PROFILE:-358474168551_admin}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}" 
export STACK_NAME="${STACK_NAME:-RedPandaClusterStack}"
export KEY_PATH="${KEY_PATH:-/data/.ssh/john.davis.pem}"

echo "Configuration:"
echo "  AWS Profile: $AWS_PROFILE"
echo "  Region: $AWS_DEFAULT_REGION"
echo "  Stack: $STACK_NAME"
echo "  Key Path: $KEY_PATH"
echo ""

# Load test parameters (can be overridden by environment variables)
PRODUCERS="${PRODUCERS:-2}"
CONSUMERS="${CONSUMERS:-2}"
DURATION="${DURATION:-30s}"
MESSAGE_SIZE="${MESSAGE_SIZE:-1024}"
COMPRESSION="${COMPRESSION:-snappy}"
PARTITIONS="${PARTITIONS:-6}"
CLEANUP_OLD_TOPICS="${CLEANUP_OLD_TOPICS:-true}"
WARMUP_MESSAGES="${WARMUP_MESSAGES:-1000}"

echo "Load Test Configuration:"
echo "  Producers: $PRODUCERS"
echo "  Consumers: $CONSUMERS"
echo "  Duration: $DURATION"
echo "  Message Size: $MESSAGE_SIZE bytes"
echo "  Compression: $COMPRESSION"
echo "  Partitions: $PARTITIONS"
echo "  Cleanup old topics: $CLEANUP_OLD_TOPICS"
echo "  Warm-up messages: $WARMUP_MESSAGES (excluded from latency percentiles)"
echo "  Topic: [auto-generated UUID]"
echo ""

# Step 1: Get cluster IPs from CloudFormation
echo "🔍 Step 1: Auto-discovering RedPanda cluster..."
PRIVATE_IPS=$(aws --profile $AWS_PROFILE cloudformation describe-stacks \
    --region $AWS_DEFAULT_REGION --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`RedPandaClusterIPs`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$PRIVATE_IPS" ]; then
    echo "❌ ERROR: Could not find RedPanda cluster IPs from CloudFormation"
    echo "Please ensure $STACK_NAME is deployed in $AWS_DEFAULT_REGION"
    exit 1
fi

BOOTSTRAP_BROKERS=$(echo $PRIVATE_IPS | tr ',' '\n' | sed 's/$/:9092/' | tr '\n' ',' | sed 's/,$//')
echo "✅ Found RedPanda brokers: $BOOTSTRAP_BROKERS"

# Step 2: Get load test instance IP
echo ""
echo "🔍 Step 2: Finding load test instance..."
LOAD_TEST_IP=$(aws --profile $AWS_PROFILE cloudformation describe-stacks \
    --region $AWS_DEFAULT_REGION --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`LoadTestInstanceIP`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$LOAD_TEST_IP" ]; then
    echo "❌ ERROR: Could not find load test instance IP from CloudFormation"
    exit 1
fi

echo "✅ Found load test instance: $LOAD_TEST_IP"

# Step 3: Copy load test files
echo ""
echo "📁 Step 3: Copying enhanced load test files..."
scp -i "$KEY_PATH" -o StrictHostKeyChecking=no -r load-test/* ec2-user@$LOAD_TEST_IP:~/

echo "✅ Files copied successfully"

# Step 4: Install dependencies and run test
echo ""
echo "🚀 Step 4: Running enhanced load test with UUID topic..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no ec2-user@$LOAD_TEST_IP << EOF
# Install Go if needed
if ! which go > /dev/null 2>&1; then
    echo "📦 Installing Go..."
    sudo yum install -y go
fi

# Build the enhanced load test binary
echo "🔨 Building enhanced load test binary..."
go build -o load-test main.go

# Export RedPanda brokers
export REDPANDA_BROKERS="$BOOTSTRAP_BROKERS"

echo ""
echo "🎯 Starting load test with enhanced features:"
echo "   • UUID-based unique topic creation"
echo "   • Automatic cleanup of old test topics"  
echo "   • Detailed latency percentiles including p99.99"
echo "   • Warm-up period exclusion ($WARMUP_MESSAGES messages)"
echo "   • Enhanced final results display"
echo ""

# Run the load test with all parameters
./load-test \\
    -brokers="$BOOTSTRAP_BROKERS" \\
    -producers="$PRODUCERS" \\
    -consumers="$CONSUMERS" \\
    -message-size="$MESSAGE_SIZE" \\
    -duration="$DURATION" \\
    -compression="$COMPRESSION" \\
    -partitions="$PARTITIONS" \\
    -cleanup-old-topics="$CLEANUP_OLD_TOPICS" \\
    -warmup-messages="$WARMUP_MESSAGES" \\
    -batch-size=100 \\
    -print-interval=5s
EOF

echo ""
echo "🎉 Complete automation finished!"
echo ""
echo "✨ Enhanced Features Used:"
echo "   🆔 Unique UUID topic created for this run"
echo "   🗑️  Old test topics cleaned up automatically"
echo "   📊 Detailed latency percentiles displayed"
echo "   🔥 Warm-up messages excluded from percentiles"
echo "   ⭐ p99.99 latency measurement included"
echo ""
echo "🔄 Next run will create a new UUID topic and clean up this one!" 