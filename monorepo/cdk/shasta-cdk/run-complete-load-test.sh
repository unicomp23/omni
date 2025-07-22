#!/bin/bash

# Complete RedPanda Load Test Automation Script
# This script automates the entire process: setup, deployment, and execution

set -e

echo "=================================================="
echo "RedPanda Complete Load Test Automation"
echo "=================================================="

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

# Step 1: Get cluster information
echo "🔍 Step 1: Getting cluster information..."
BOOTSTRAP_BROKERS=$(aws --profile $AWS_PROFILE cloudformation describe-stacks \
    --region $AWS_DEFAULT_REGION --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='RedPandaBootstrapBrokers'].OutputValue" \
    --output text 2>/dev/null)

LOAD_TEST_IP=$(aws --profile $AWS_PROFILE cloudformation describe-stacks \
    --region $AWS_DEFAULT_REGION --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='LoadTestInstanceIP'].OutputValue" \
    --output text 2>/dev/null)

if [ -z "$BOOTSTRAP_BROKERS" ] || [ -z "$LOAD_TEST_IP" ]; then
    echo "❌ ERROR: Could not get cluster information from CloudFormation"
    echo "Please ensure your RedPandaClusterStack is deployed and accessible"
    exit 1
fi

echo "✅ Found RedPanda cluster:"
echo "  Bootstrap Brokers: $BOOTSTRAP_BROKERS"
echo "  Load Test Instance: $LOAD_TEST_IP"
echo ""

# Step 2: Copy load test files to instance
echo "📦 Step 2: Copying load test files to instance..."
cd load-test
scp -i $KEY_PATH -o StrictHostKeyChecking=no \
    *.go *.sh *.mod go.sum \
    ec2-user@$LOAD_TEST_IP:~/
echo "✅ Files copied successfully"
echo ""

# Step 3: Setup Go and build binary on target instance
echo "🔨 Step 3: Installing Go and building load test binary..."
ssh -i $KEY_PATH -o StrictHostKeyChecking=no ec2-user@$LOAD_TEST_IP << 'EOF'
# Install Go if not already installed
if ! which go > /dev/null 2>&1; then
    echo "Installing Go..."
    sudo yum install -y go
    echo "✅ Go installed successfully"
else
    echo "✅ Go already installed: $(go version)"
fi

# Build the load test binary
echo "Building load test binary..."
cd ~
go build -o load-test main.go
echo "✅ Binary built successfully"

# Make scripts executable
chmod +x *.sh
echo "✅ Scripts made executable"
EOF
echo ""

# Step 4: Run load test with configurable parameters
echo "🚀 Step 4: Running load test..."
PRODUCERS="${PRODUCERS:-2}"
CONSUMERS="${CONSUMERS:-2}" 
DURATION="${DURATION:-30s}"
MESSAGE_SIZE="${MESSAGE_SIZE:-1024}"
COMPRESSION="${COMPRESSION:-snappy}"

echo "Load test configuration:"
echo "  Producers: $PRODUCERS"
echo "  Consumers: $CONSUMERS"
echo "  Duration: $DURATION"
echo "  Message Size: $MESSAGE_SIZE bytes"
echo "  Compression: $COMPRESSION"
echo ""

# Run the actual load test
ssh -i $KEY_PATH -o StrictHostKeyChecking=no ec2-user@$LOAD_TEST_IP << EOF
export REDPANDA_BROKERS='$BOOTSTRAP_BROKERS'
echo "Starting load test with RedPanda brokers: \$REDPANDA_BROKERS"
echo ""

# Run load test with parameters, automatically answering the prompt
echo '' | ./run.sh \
    --producers $PRODUCERS \
    --consumers $CONSUMERS \
    --duration $DURATION \
    --message-size $MESSAGE_SIZE \
    --compression $COMPRESSION
EOF

echo ""
echo "=================================================="
echo "🎉 Load test completed successfully!"
echo ""
echo "To run again with different parameters:"
echo "  PRODUCERS=4 CONSUMERS=4 DURATION=60s $0"
echo ""
echo "Available parameters:"
echo "  PRODUCERS=N     # Number of producer threads"
echo "  CONSUMERS=N     # Number of consumer threads" 
echo "  DURATION=Xs     # Test duration (e.g., 30s, 5m)"
echo "  MESSAGE_SIZE=N  # Message size in bytes"
echo "  COMPRESSION=X   # none, gzip, snappy, lz4, zstd"
echo "==================================================" 