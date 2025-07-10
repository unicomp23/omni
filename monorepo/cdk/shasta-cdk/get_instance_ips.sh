#!/bin/bash

# Script to get Shasta infrastructure IP addresses
# Run this script to get the IPs you need for SSH configuration

REGION="us-east-1"
STACK_NAME_L2="shasta-cdk-layer2"  # Adjust if your stack name is different

echo "Getting Bastion Host Public IP..."
BASTION_IP=$(aws cloudformation describe-stacks \
    --region $REGION \
    --stack-name $STACK_NAME_L2 \
    --query 'Stacks[0].Outputs[?OutputKey==`BastionHostPublicIP`].OutputValue' \
    --output text)

echo "Bastion Host Public IP: $BASTION_IP"

echo ""
echo "Getting Producer Instance Private IPs..."
PRODUCER_IPS=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:shasta-role,Values=producer" \
           "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].PrivateIpAddress' \
    --output text)

echo "Producer Instance Private IPs:"
for ip in $PRODUCER_IPS; do
    echo "  - $ip"
done

echo ""
echo "Getting Consumer Instance Private IPs..."
CONSUMER_IPS=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:shasta-role,Values=consumer" \
           "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].PrivateIpAddress' \
    --output text)

echo "Consumer Instance Private IPs:"
for ip in $CONSUMER_IPS; do
    echo "  - $ip"
done

echo ""
echo "SSH Config entries you can add to ~/.ssh/config:"
echo ""
echo "Host shasta-bastion"
echo "    HostName $BASTION_IP"
echo "    User ec2-user"
echo "    IdentityFile ~/.ssh/john.davis.pem"
echo "    ForwardAgent yes"
echo "    ServerAliveInterval 60"
echo ""

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