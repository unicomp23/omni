#!/bin/bash

# Script to upload RedPanda load test code to S3

set -e

echo "RedPanda Load Test S3 Upload"
echo "============================"

# Get S3 bucket name from CloudFormation if not provided
if [ -z "$BUCKET_NAME" ]; then
    echo "Auto-discovering S3 bucket name..."
    
    # Try to get from CloudFormation outputs
    BUCKET_NAME=$(aws cloudformation describe-stacks --region ${AWS_DEFAULT_REGION:-us-east-1} --stack-name RedPandaClusterStack --query 'Stacks[0].Outputs[?OutputKey==`LoadTestS3Bucket`].OutputValue' --output text 2>/dev/null || echo "")
    
    if [ -z "$BUCKET_NAME" ]; then
        echo "ERROR: Could not auto-discover S3 bucket name from CloudFormation."
        echo "Please set the BUCKET_NAME environment variable or ensure the RedPandaClusterStack is deployed."
        echo ""
        echo "Usage:"
        echo "  BUCKET_NAME=your-bucket-name $0"
        echo "  or"
        echo "  export BUCKET_NAME=your-bucket-name && $0"
        exit 1
    fi
fi

echo "S3 Bucket: $BUCKET_NAME"

# Check if load-test directory exists
if [ ! -d "load-test" ]; then
    echo "ERROR: load-test directory not found. Please run this script from the project root."
    exit 1
fi

echo "Uploading load test files to S3..."

# Upload all files in load-test directory
aws s3 sync load-test/ s3://$BUCKET_NAME/ --exclude "*.git*" --delete

echo ""
echo "Upload complete!"
echo ""
echo "To run the load test:"
echo "1. SSH to your load test instance:"
echo "   ssh -i ~/.ssh/john.davis.pem ec2-user@{load-test-instance-ip}"
echo ""
echo "2. Download and run:"
echo "   cd ~/scripts"
echo "   ./download-and-run-load-test.sh"
echo ""
echo "Alternatively, run manually:"
echo "   cd ~/load-test-scripts"
echo "   ./run.sh"
echo "   # or"
echo "   ./quick-tests.sh" 