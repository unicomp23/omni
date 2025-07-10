#!/bin/bash

# Script to get Shasta infrastructure Instance IDs for SSM connections
# Run this script to get the instance IDs you need for SSH over SSM

REGION="us-east-1"

echo "Getting Producer Instance IDs and details..."
echo "=========================================="

# Get producer instances
aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:shasta-role,Values=producer" \
           "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].[InstanceId,PrivateIpAddress,Tags[?Key==`Name`].Value|[0]]' \
    --output table

echo ""
echo "Getting Consumer Instance IDs and details..."
echo "=========================================="

# Get consumer instances
aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:shasta-role,Values=consumer" \
           "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].[InstanceId,PrivateIpAddress,Tags[?Key==`Name`].Value|[0]]' \
    --output table

echo ""
echo "Getting Monitor/Orchestrator Instance IDs and details..."
echo "=================================================="

# Get monitor instances
aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:shasta-role,Values=monitor" \
           "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].[InstanceId,PrivateIpAddress,Tags[?Key==`Name`].Value|[0]]' \
    --output table

echo ""
echo "SSH Config entries for ~/.ssh/config:"
echo "====================================="

# Get producer instances for SSH config
PRODUCER_DATA=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:shasta-role,Values=producer" \
           "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].[InstanceId,Tags[?Key==`Name`].Value|[0]]' \
    --output text)

counter=0
while IFS=$'\t' read -r instance_id instance_name; do
    echo "# Producer Instance $counter"
    echo "Host shasta-producer-$counter"
    echo "    HostName $instance_id"
    echo "    User ec2-user"
    echo "    ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p' --region us-east-1"
    echo "    IdentityFile ~/.ssh/john.davis.pem"
    echo "    StrictHostKeyChecking no"
    echo "    UserKnownHostsFile /dev/null"
    echo "    ServerAliveInterval 60"
    echo "    ForwardAgent yes"
    echo ""
    ((counter++))
done <<< "$PRODUCER_DATA"

# Get consumer instances for SSH config
CONSUMER_DATA=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:shasta-role,Values=consumer" \
           "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].[InstanceId,Tags[?Key==`Name`].Value|[0]]' \
    --output text)

counter=0
while IFS=$'\t' read -r instance_id instance_name; do
    echo "# Consumer Instance $counter"
    echo "Host shasta-consumer-$counter"
    echo "    HostName $instance_id"
    echo "    User ec2-user"
    echo "    ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p' --region us-east-1"
    echo "    IdentityFile ~/.ssh/john.davis.pem"
    echo "    StrictHostKeyChecking no"
    echo "    UserKnownHostsFile /dev/null"
    echo "    ServerAliveInterval 60"
    echo "    ForwardAgent yes"
    echo ""
    ((counter++))
done <<< "$CONSUMER_DATA"

echo ""
echo "Quick Test Commands:"
echo "==================="
echo "# Test SSM connection (interactive shell):"
echo "aws ssm start-session --target <instance-id> --region us-east-1"
echo ""
echo "# Test SSH over SSM:"
echo "ssh shasta-producer-0"
echo ""
echo "# List all SSM-managed instances:"
echo "aws ssm describe-instance-information --region us-east-1 --query 'InstanceInformationList[].InstanceId' --output table" 