#!/bin/bash

# RedPanda Cluster Setup Script

set -e

echo "RedPanda Cluster Setup"
echo "====================="

# Default configuration
export STACK_NAME="${STACK_NAME:-RedPandaClusterStack}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export KEY_PATH="${KEY_PATH:-/data/.ssh/john.davis.pem}"
export REDPANDA_VERSION="${REDPANDA_VERSION:-v23.3.3}"

echo "Configuration:"
echo "  Stack Name: $STACK_NAME"
echo "  AWS Region: $AWS_DEFAULT_REGION"
echo "  Key Path: $KEY_PATH"
echo "  RedPanda Version: $REDPANDA_VERSION"
echo ""

# Check if key file exists
if [ ! -f "$KEY_PATH" ]; then
    echo "❌ ERROR: SSH key file not found at $KEY_PATH"
    echo "Please ensure your SSH key is available or set KEY_PATH environment variable"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "❌ ERROR: AWS credentials not configured"
    echo "Please run 'aws configure' or set AWS environment variables"
    exit 1
fi

# Build the setup tool if needed
if [ ! -f "./redpanda-setup" ]; then
    echo "🔨 Building RedPanda setup tool..."
    go build -o redpanda-setup .
    echo "✅ Build complete"
    echo ""
fi

# Run the setup tool
echo "🚀 Starting RedPanda cluster setup..."
./redpanda-setup

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 RedPanda cluster setup complete!"
    echo ""
    echo "Next steps:"
    echo "1. Test the cluster with your load testing tool"
    echo "2. Create topics: ssh -i $KEY_PATH ec2-user@<node-ip> 'sudo docker exec redpanda rpk topic create test-topic -p 12'"
    echo "3. Run load tests: cd ../load-test && ./run.sh"
    echo ""
    echo "The cluster is healthy and ready for use! 🚀"
else
    echo ""
    echo "❌ RedPanda cluster setup failed!"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check the error messages above"
    echo "2. Verify all EC2 instances are running: aws ec2 describe-instances"
    echo "3. Check SSH connectivity: ssh -i $KEY_PATH ec2-user@<node-ip>"
    echo "4. View container logs: ssh -i $KEY_PATH ec2-user@<node-ip> 'sudo docker logs redpanda'"
    exit 1
fi 