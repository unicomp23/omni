#!/bin/bash

# Script to upload RedPanda load test code to S3
# Updated to include complete automation workflow

set -e

echo "RedPanda Load Test S3 Upload"
echo "============================"

# Configuration
export AWS_PROFILE="${AWS_PROFILE:-default}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-2}"
export STACK_NAME="${STACK_NAME:-RedPandaClusterStack}"

# Get S3 bucket name from CloudFormation if not provided
if [ -z "$BUCKET_NAME" ]; then
    echo "Auto-discovering S3 bucket name..."
    
    # Try to get from CloudFormation outputs
    BUCKET_NAME=$(aws --profile $AWS_PROFILE cloudformation describe-stacks \
        --region $AWS_DEFAULT_REGION --stack-name $STACK_NAME \
        --query 'Stacks[0].Outputs[?OutputKey==`LoadTestS3Bucket`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$BUCKET_NAME" ]; then
        echo "ERROR: Could not auto-discover S3 bucket name from CloudFormation."
        echo "Please set the BUCKET_NAME environment variable or ensure the $STACK_NAME is deployed."
        echo ""
        echo "Usage:"
        echo "  BUCKET_NAME=your-bucket-name $0"
        echo "  or"
        echo "  export BUCKET_NAME=your-bucket-name && $0"
        exit 1
    fi
fi

echo "S3 Bucket: $BUCKET_NAME"
echo "AWS Profile: $AWS_PROFILE"
echo "Region: $AWS_DEFAULT_REGION"

# Check if load-test directory exists
if [ ! -d "load-test" ]; then
    echo "ERROR: load-test directory not found. Please run this script from the project root."
    exit 1
fi

echo ""
echo "Uploading load test files to S3..."

# Upload all files in load-test directory
aws --profile $AWS_PROFILE s3 sync load-test/ s3://$BUCKET_NAME/ --exclude "*.git*" --delete

echo ""
echo "✅ Upload complete!"
echo ""
echo "=========================================="
echo "RECOMMENDED: Use the Complete Automation"
echo "=========================================="
echo ""
echo "Instead of manual steps, use the complete automation script:"
echo ""
echo "  ./run-complete-load-test.sh"
echo ""
echo "This script will automatically:"
echo "  1. Get cluster IPs from CloudFormation"
echo "  2. Copy files to load test instance"
echo "  3. Install Go and build binary"
echo "  4. Run the load test"
echo ""
echo "Example with custom parameters:"
echo "  PRODUCERS=4 CONSUMERS=4 DURATION=5m ./run-complete-load-test.sh"
echo ""
echo "=========================================="
echo "Manual Steps (if needed):"
echo "=========================================="
echo ""
echo "1. SSH to your load test instance:"
echo "   ssh -i /data/.ssh/john.davis.calent-2.pem ec2-user@{load-test-instance-ip}"
echo ""
echo "2. Download from S3:"
echo "   aws s3 sync s3://$BUCKET_NAME/ ~/load-test-scripts/"
echo ""
echo "3. Install Go and build:"
echo "   sudo yum install -y go"
echo "   cd ~/load-test-scripts"
echo "   go build -o load-test main.go"
echo ""
echo "4. Run tests:"
echo "   ./run.sh --producers 2 --consumers 2 --duration 30s"
echo "   # or"
echo "   ./quick-tests.sh" 