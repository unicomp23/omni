#!/bin/bash

# Deploy Load Test Files to EC2 Instance
# This script copies the load test code to the remote EC2 instance for execution

set -e

echo "🚚 RedPanda Load Test Deployment"
echo "================================="

# Configuration
export AWS_PROFILE="${AWS_PROFILE:-358474168551_admin}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}" 
export STACK_NAME="${STACK_NAME:-RedPandaClusterStack}"
export KEY_PATH="${KEY_PATH:-/data/.ssh/john.davis.pem}"

# Get load test instance IP from CloudFormation
echo "🔍 Finding load test instance..."
LOAD_TEST_IP=$(aws --profile $AWS_PROFILE cloudformation describe-stacks \
    --region $AWS_DEFAULT_REGION --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`LoadTestInstanceIP`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$LOAD_TEST_IP" ]; then
    echo "❌ ERROR: Could not find load test instance IP from CloudFormation"
    echo "Make sure $STACK_NAME is deployed in $AWS_DEFAULT_REGION"
    exit 1
fi

echo "✅ Found load test instance: $LOAD_TEST_IP"

# Deploy load test files
echo ""
echo "📁 Deploying load test files..."
echo "   Source: ./load-test/*"
echo "   Target: ec2-user@$LOAD_TEST_IP:~/"
echo ""

scp -i "$KEY_PATH" -o StrictHostKeyChecking=no -r load-test/* ec2-user@$LOAD_TEST_IP:~/

echo ""
echo "✅ Load test files deployed successfully!"
echo ""
echo "💡 Next steps:"
echo "   1. SSH to instance: ssh -i $KEY_PATH ec2-user@$LOAD_TEST_IP"
echo "   2. Run test: ./run.sh --duration=10s"
echo "   OR"
echo "   3. Use automated script: ./run-complete-load-test.sh"
echo "" 