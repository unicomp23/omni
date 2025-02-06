#!/bin/bash

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Set AWS region and disable pager
AWS_REGION="us-east-1"
export AWS_PAGER=""

# Check for producer instances
echo "Checking for producer instances..."
PRODUCER_INSTANCES=($(aws ec2 describe-instances \
    --region ${AWS_REGION} \
    --filters "Name=tag:Name,Values=cantina-dev-node-producer-jd-asg" "Name=instance-state-name,Values=running" \
    --query 'Reservations[*].Instances[*].[InstanceId]' \
    --output text))

echo "Found ${#PRODUCER_INSTANCES[@]} producer instances"

if [ ${#PRODUCER_INSTANCES[@]} -eq 0 ]; then
    echo "No producer instances found. Please verify the instance tags and states."
    exit 1
fi

# Function to run command on instances in batches
run_command_in_batches() {
    local instance_ids=("$@")
    local batch_size=50
    local total_instances=${#instance_ids[@]}
    
    for ((i=0; i<total_instances; i+=batch_size)); do
        local batch_instances=()
        for ((j=i; j<i+batch_size && j<total_instances; j++)); do
            batch_instances+=("${instance_ids[j]}")
        done
        
        echo "Starting producers on instances (batch $((i/batch_size + 1)))..."
        local command_id=$(aws ssm send-command \
            --region ${AWS_REGION} \
            --instance-ids "${batch_instances[@]}" \
            --document-name "AWS-RunShellScript" \
            --parameters '{"commands":[
                "cd /home/ec2-user/golang/producer",
                "find . -name \"*.sh\" -exec chmod +x {} +",
                "chmod +x run.sh",
                "nohup ./run.sh > producer.$(date +%Y%m%d_%H%M%S).log 2>&1 &",
                "echo $! > producer.$(date +%Y%m%d_%H%M%S).pid"
            ],"executionTimeout":["30"]}' \
            --cloud-watch-output-config '{"CloudWatchOutputEnabled":true}' \
            --comment "Start golang producers" \
            --query 'Command.CommandId' \
            --output text)

        echo "Producer start command ID for batch $((i/batch_size + 1)): ${command_id}"
        
        # Wait a bit for the command to start
        sleep 5
        
        # Check status for this batch
        echo "Checking producer start status for batch $((i/batch_size + 1))..."
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

# Run the command in batches
run_command_in_batches "${PRODUCER_INSTANCES[@]}"

echo "Producer start commands have been issued. Check CloudWatch logs for ongoing output."
