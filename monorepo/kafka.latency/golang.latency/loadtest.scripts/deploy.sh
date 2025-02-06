#!/bin/bash

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Set AWS region and disable pager
AWS_REGION="us-east-1"
export AWS_PAGER=""

# Function to deploy to instances in batches
deploy_to_instances() {
    local instance_ids=($1)  # Convert space-separated string to array
    local instance_type=$2   # "producer" or "consumer"
    local batch_size=50
    local total_instances=${#instance_ids[@]}
    
    for ((i=0; i<total_instances; i+=batch_size)); do
        local batch_instances=()
        for ((j=i; j<i+batch_size && j<total_instances; j++)); do
            batch_instances+=("${instance_ids[j]}")
        done
        
        echo "Deploying to ${instance_type} instances (batch $((i/batch_size + 1)))..."
        local command_id=$(aws ssm send-command \
            --region ${AWS_REGION} \
            --instance-ids "${batch_instances[@]}" \
            --document-name "AWS-RunShellScript" \
            --parameters '{"commands":["set -x","aws s3 sync s3://cantina-jd/golang /home/ec2-user/golang --region us-east-1","chown -R ec2-user:ec2-user /home/ec2-user/golang","find /home/ec2-user/golang -name \"*.sh\" -exec chmod +x {} +"],"executionTimeout":["300"]}' \
            --cloud-watch-output-config '{"CloudWatchOutputEnabled":true}' \
            --comment "Deploy golang files to ${instance_type} instances" \
            --query 'Command.CommandId' \
            --output text)
            
        echo "${instance_type} deployment command ID for batch $((i/batch_size + 1)): ${command_id}"
        
        # Check status for this batch
        echo "Checking deployment status for batch $((i/batch_size + 1))..."
        sleep 15  # Wait for deployment to progress
        
        for instance in "${batch_instances[@]}"; do
            echo "Checking command output for instance ${instance}..."
            aws ssm get-command-invocation \
                --region ${AWS_REGION} \
                --command-id "${command_id}" \
                --instance-id "${instance}" \
                --output text \
                --query '[Status,StatusDetails,StandardOutputContent,StandardErrorContent]' || true
        done
    done
}

# Get instances (convert output to array)
PRODUCER_INSTANCES=($(aws ec2 describe-instances \
    --region ${AWS_REGION} \
    --filters "Name=tag:Name,Values=cantina-dev-node-producer-jd-asg" "Name=instance-state-name,Values=running" \
    --query 'Reservations[*].Instances[*].[InstanceId]' \
    --output text))

CONSUMER_INSTANCES=($(aws ec2 describe-instances \
    --region ${AWS_REGION} \
    --filters "Name=tag:Name,Values=cantina-dev-node-consumer-jd-asg" "Name=instance-state-name,Values=running" \
    --query 'Reservations[*].Instances[*].[InstanceId]' \
    --output text))

# Display found instances
echo "Found ${#PRODUCER_INSTANCES[@]} producer instances"
echo "Found ${#CONSUMER_INSTANCES[@]} consumer instances"

if [ ${#PRODUCER_INSTANCES[@]} -eq 0 ] && [ ${#CONSUMER_INSTANCES[@]} -eq 0 ]; then
    echo "No instances found. Please verify the instance tags and states."
    exit 1
fi

# Deploy to producers if they exist
if [ ${#PRODUCER_INSTANCES[@]} -gt 0 ]; then
    deploy_to_instances "${PRODUCER_INSTANCES[*]}" "producer"
fi

# Deploy to consumers if they exist
if [ ${#CONSUMER_INSTANCES[@]} -gt 0 ]; then
    deploy_to_instances "${CONSUMER_INSTANCES[*]}" "consumer"
fi

echo "Deployment complete. Check the status output above for any errors."
