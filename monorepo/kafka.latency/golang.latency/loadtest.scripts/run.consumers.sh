#!/bin/bash

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Set AWS region and disable pager
AWS_REGION="us-east-1"
export AWS_PAGER=""

# Check for consumer instances
echo "Checking for consumer instances..."
CONSUMER_INSTANCES=$(aws ec2 describe-instances \
    --region ${AWS_REGION} \
    --filters "Name=tag:Name,Values=cantina-dev-node-consumer-jd-asg" "Name=instance-state-name,Values=running" \
    --query 'Reservations[*].Instances[*].[InstanceId]' \
    --output text)

echo "Found consumer instances: ${CONSUMER_INSTANCES:-none}"

if [[ -z "$CONSUMER_INSTANCES" ]]; then
    echo "No consumer instances found. Please verify the instance tags and states."
    exit 1
fi

# Run consumers on instances
echo "Starting consumers on instances..."
CONSUMER_COMMAND=$(aws ssm send-command \
    --region ${AWS_REGION} \
    --instance-ids ${CONSUMER_INSTANCES} \
    --document-name "AWS-RunShellScript" \
    --parameters '{"commands":[
        "cd /home/ec2-user/golang/consumer",
        "find . -name \"*.sh\" -exec chmod +x {} +",
        "chmod +x run.sh",
        "nohup ./run.sh > consumer.$(date +%Y%m%d_%H%M%S).log 2>&1 &",
        "echo $! > consumer.$(date +%Y%m%d_%H%M%S).pid"
    ],"executionTimeout":["30"]}' \
    --cloud-watch-output-config '{"CloudWatchOutputEnabled":true}' \
    --comment "Start golang consumers" \
    --query 'Command.CommandId' \
    --output text)

echo "Consumer start command ID: ${CONSUMER_COMMAND}"

# Check command status
check_command_status() {
    local command_id=$1
    shift  # Remove first argument, leaving remaining instance IDs
    local instance_ids=($@)  # Convert arguments to array
    
    for instance_id in "${instance_ids[@]}"; do
        echo "Checking command output for instance ${instance_id}..."
        aws ssm get-command-invocation \
            --region ${AWS_REGION} \
            --command-id "${command_id}" \
            --instance-id "${instance_id}" \
            --output text \
            --query '[Status,StatusDetails,StandardOutputContent,StandardErrorContent]'
    done
}

# Wait a bit for the command to start
sleep 5

echo "Checking consumer start status..."
read -ra INSTANCE_ARRAY <<< "$CONSUMER_INSTANCES"  # Convert space-separated string to array
check_command_status "${CONSUMER_COMMAND}" "${INSTANCE_ARRAY[@]}"

echo "Consumer start command has been issued. Check CloudWatch logs for ongoing output."
