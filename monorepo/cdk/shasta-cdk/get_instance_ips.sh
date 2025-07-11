#!/bin/bash

# Script to get Shasta infrastructure IP addresses
# Run this script to get the IPs you need for SSH configuration

REGION="us-east-1"
STACK_NAME_L2="ShastaCdkStackL2"  # Adjust if your stack name is different

# Function to check if AWS CLI is working
check_aws_credentials() {
    echo "Checking AWS credentials..."
    aws sts get-caller-identity > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "Warning: AWS CLI credentials not found. Trying to continue anyway..."
        echo "If this fails, please configure AWS credentials with: aws configure"
        echo ""
    else
        echo "AWS credentials found and working."
        echo ""
    fi
}

# Function to run AWS command with error handling
run_aws_command() {
    local cmd="$1"
    local description="$2"
    
    echo "Running: $cmd"
    result=$(eval "$cmd" 2>&1)
    exit_code=$?
    
    if [ $exit_code -ne 0 ]; then
        echo "Error running $description:"
        echo "$result"
        echo ""
        return 1
    fi
    
    echo "$result"
    return 0
}

check_aws_credentials

echo "Getting Bastion Host Public IP..."
bastion_cmd="aws cloudformation describe-stacks \
    --region $REGION \
    --stack-name $STACK_NAME_L2 \
    --query 'Stacks[0].Outputs[?OutputKey==\`BastionHostPublicIP\`].OutputValue' \
    --output text"

if run_aws_command "$bastion_cmd" "Bastion Host IP lookup"; then
    BASTION_IP=$(echo "$result" | tr -d '\n\r')
    echo "Bastion Host Public IP: $BASTION_IP"
else
    echo "Failed to get Bastion Host Public IP"
    BASTION_IP=""
fi

echo ""
echo "Getting Producer Instance Private IPs..."
producer_cmd="aws ec2 describe-instances \
    --region $REGION \
    --filters 'Name=tag:shasta-role,Values=producer' \
           'Name=instance-state-name,Values=running' \
    --query 'Reservations[].Instances[].PrivateIpAddress' \
    --output text"

if run_aws_command "$producer_cmd" "Producer Instance IP lookup"; then
    PRODUCER_IPS=$(echo "$result" | tr -d '\n\r')
    echo "Producer Instance Private IPs:"
    for ip in $PRODUCER_IPS; do
        echo "  - $ip"
    done
else
    echo "Failed to get Producer Instance Private IPs"
    PRODUCER_IPS=""
fi

echo ""
echo "Getting Consumer Instance Private IPs..."
consumer_cmd="aws ec2 describe-instances \
    --region $REGION \
    --filters 'Name=tag:shasta-role,Values=consumer' \
           'Name=instance-state-name,Values=running' \
    --query 'Reservations[].Instances[].PrivateIpAddress' \
    --output text"

if run_aws_command "$consumer_cmd" "Consumer Instance IP lookup"; then
    CONSUMER_IPS=$(echo "$result" | tr -d '\n\r')
    echo "Consumer Instance Private IPs:"
    for ip in $CONSUMER_IPS; do
        echo "  - $ip"
    done
else
    echo "Failed to get Consumer Instance Private IPs"
    CONSUMER_IPS=""
fi

echo ""
echo "=========================================="
echo "SSH Config entries you can add to ~/.ssh/config:"
echo ""

if [ -n "$BASTION_IP" ]; then
    echo "Host shasta-bastion"
    echo "    HostName $BASTION_IP"
    echo "    User ec2-user"
    echo "    IdentityFile ~/.ssh/john.davis.pem"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo ""
else
    echo "# Bastion host IP not found - check stack deployment"
    echo "# Host shasta-bastion"
    echo "#     HostName <BASTION_IP>"
    echo "#     User ec2-user"
    echo "#     IdentityFile ~/.ssh/john.davis.pem"
    echo "#     ForwardAgent yes"
    echo "#     ServerAliveInterval 60"
    echo ""
fi

counter=0
for ip in $PRODUCER_IPS; do
    echo "Host shasta-producer-$counter"
    echo "    HostName $ip"
    echo "    User ec2-user"
    echo "    IdentityFile ~/.ssh/john.davis.pem"
    echo "    ProxyJump shasta-bastion"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo ""
    ((counter++))
done

counter=0
for ip in $CONSUMER_IPS; do
    echo "Host shasta-consumer-$counter"
    echo "    HostName $ip"
    echo "    User ec2-user"
    echo "    IdentityFile ~/.ssh/john.davis.pem"
    echo "    ProxyJump shasta-bastion"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo ""
    ((counter++))
done

echo "=========================================="
echo "Troubleshooting:"
echo "1. If AWS commands fail, try: aws configure"
echo "2. If CDK works but AWS CLI doesn't, check AWS_PROFILE environment variable"
echo "3. Verify the stack name is correct: $STACK_NAME_L2"
echo "4. Check that instances are running in AWS console" 