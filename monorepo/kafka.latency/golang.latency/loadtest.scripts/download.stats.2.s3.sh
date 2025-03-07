#!/bin/bash

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Set AWS region and disable pager
AWS_REGION="us-east-1"
export AWS_PAGER=""

# Get current timestamp - shared between consumer and producer downloads
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Function to download logs from instances
download_logs() {
    local ROLE=$1
    local INSTANCES=$2
    
    echo "Found ${ROLE} instances: ${INSTANCES:-none}"
    
    if [[ -z "$INSTANCES" ]]; then
        echo "No ${ROLE} instances found. Please verify the instance tags and states."
        return
    fi
    
    # For each instance, copy logs to S3
    while read -r INSTANCE_ID INSTANCE_NAME; do
        echo "Downloading logs from ${ROLE} instance ${INSTANCE_ID} (${INSTANCE_NAME})..."
        
        # Create S3 destination path with timestamp and instance name
        S3_PATH="s3://cantina-jd/golang.reports/data/${TIMESTAMP}/${ROLE}/${INSTANCE_NAME}"
        
        # Copy logs using SSM command
        COMMAND_ID=$(aws ssm send-command \
            --region ${AWS_REGION} \
            --instance-ids "${INSTANCE_ID}" \
            --document-name "AWS-RunShellScript" \
            --parameters "{\"commands\":[
                \"cd /home/ec2-user/golang/${ROLE}\",
                \"aws s3 cp . ${S3_PATH} --recursive --exclude '*' --include '*.jsonl' --include '*.jsonl.gz' --include '*.log' --region ${AWS_REGION}\"
            ]}" \
            --cloud-watch-output-config '{"CloudWatchOutputEnabled":true}' \
            --comment "Copy ${ROLE} logs to S3" \
            --output text \
            --query 'Command.CommandId')
        
        echo "Started copy command ${COMMAND_ID} for instance ${INSTANCE_ID}"
        
        # Wait a moment then check command status
        sleep 5
        aws ssm get-command-invocation \
            --region ${AWS_REGION} \
            --command-id "${COMMAND_ID}" \
            --instance-id "${INSTANCE_ID}" \
            --output text \
            --query '[Status,StatusDetails]'
    done <<< "$INSTANCES"
}

# Check for consumer instances
echo "Checking for consumer instances..."
CONSUMER_INSTANCES=$(aws ec2 describe-instances \
    --region ${AWS_REGION} \
    --filters "Name=tag:Name,Values=cantina-dev-node-consumer-jd-asg" "Name=instance-state-name,Values=running" \
    --query 'Reservations[*].Instances[*].[InstanceId,PrivateDnsName]' \
    --output text)

# Check for producer instances
echo "Checking for producer instances..."
PRODUCER_INSTANCES=$(aws ec2 describe-instances \
    --region ${AWS_REGION} \
    --filters "Name=tag:Name,Values=cantina-dev-node-producer-jd-asg" "Name=instance-state-name,Values=running" \
    --query 'Reservations[*].Instances[*].[InstanceId,PrivateDnsName]' \
    --output text)

# Download logs from both types of instances
download_logs "consumer" "$CONSUMER_INSTANCES"
download_logs "producer" "$PRODUCER_INSTANCES"

echo "Log collection complete. Check S3 bucket for files." 