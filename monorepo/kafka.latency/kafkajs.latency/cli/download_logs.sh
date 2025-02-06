#!/bin/bash

# Set variables
KEY_NAME="john.davis"
LOCAL_DOWNLOAD_DIR="./downloaded_logs"
TEST_ID="019"
AWS_REGION="us-east-1"  # Added region specification

# Create local download directory
mkdir -p "$LOCAL_DOWNLOAD_DIR"

# Get bastion host public DNS
BASTION_DNS=$(aws ec2 describe-instances \
    --region $AWS_REGION \
    --filters "Name=tag:Name,Values=ShastaCdkStackL2/BastionHost" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].PublicDnsName" \
    --output text)

# Get consumer instances
CONSUMER_INSTANCES=$(aws ec2 describe-instances \
    --region $AWS_REGION \
    --filters "Name=tag:shasta-role,Values=consumer-asg" "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].PrivateDnsName" \
    --output text)

# First, ensure SSH agent is running and has your key
eval $(ssh-agent)
ssh-add /tmp/$KEY_NAME.pem

# Configure SSH to use agent forwarding through bastion
cat > ~/.ssh/config << EOF
Host bastion
    HostName $BASTION_DNS
    User ec2-user
    ForwardAgent yes
    IdentityFile /tmp/$KEY_NAME.pem
    StrictHostKeyChecking no

Host 10.* ip-10-*
    User ec2-user
    ProxyCommand ssh bastion -W %h:%p
    StrictHostKeyChecking no
EOF

# Function to download files from an instance
download_files() {
    local instance_dns=$1
    local instance_dir="$LOCAL_DOWNLOAD_DIR/$(echo $instance_dns | tr '.' '-')"
    
    echo "Downloading logs from $instance_dns..."
    mkdir -p "$instance_dir"
    
    # Download both consumer logs and latency stats
    scp -r "ec2-user@$instance_dns:/tmp/kafka-consumer-*-${TEST_ID}.log" "$instance_dir/" 2>/dev/null || true
    scp -r "ec2-user@$instance_dns:/tmp/kafka-latency-*.jsonl" "$instance_dir/" 2>/dev/null || true
    
    echo "✓ Downloaded files from $instance_dns"
}

# Download from each consumer instance
for instance in $CONSUMER_INSTANCES; do
    download_files "$instance"
done

echo "All downloads completed. Files are in $LOCAL_DOWNLOAD_DIR"

# Clean up SSH agent
ssh-agent -k