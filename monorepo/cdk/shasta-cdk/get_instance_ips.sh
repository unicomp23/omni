#!/bin/bash

# Script to get Shasta infrastructure IP addresses for direct SSH configuration
# This script generates direct SSH config for producer and consumer instances

REGION="us-east-1"
STACK_NAME_L2="ShastaCdkStackL2"  # Adjust if your stack name is different
KEY_FILE="~/.ssh/john.davis.pem"  # SSH key file path

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

echo "Getting Producer Instance Public IPs..."
producer_cmd="aws ec2 describe-instances \
    --region $REGION \
    --filters 'Name=tag:shasta-role,Values=producer' \
           'Name=instance-state-name,Values=running' \
    --query 'Reservations[].Instances[].PublicIpAddress' \
    --output text"

if run_aws_command "$producer_cmd" "Producer Instance IP lookup"; then
    PRODUCER_IPS=$(echo "$result" | tr -d '\n\r')
    echo "Producer Instance Public IPs:"
    for ip in $PRODUCER_IPS; do
        echo "  - $ip"
    done
else
    echo "Failed to get Producer Instance Public IPs"
    PRODUCER_IPS=""
fi

echo ""
echo "Getting Consumer Instance Public IPs..."
consumer_cmd="aws ec2 describe-instances \
    --region $REGION \
    --filters 'Name=tag:shasta-role,Values=consumer' \
           'Name=instance-state-name,Values=running' \
    --query 'Reservations[].Instances[].PublicIpAddress' \
    --output text"

if run_aws_command "$consumer_cmd" "Consumer Instance IP lookup"; then
    CONSUMER_IPS=$(echo "$result" | tr -d '\n\r')
    echo "Consumer Instance Public IPs:"
    for ip in $CONSUMER_IPS; do
        echo "  - $ip"
    done
else
    echo "Failed to get Consumer Instance Public IPs"
    CONSUMER_IPS=""
fi

echo ""
echo "=========================================="
echo "DIRECT SSH Config entries for ~/.ssh/config:"
echo ""

counter=0
for ip in $PRODUCER_IPS; do
    echo "# Producer Instance $counter - Direct SSH Access"
    echo "Host shasta-producer-$counter"
    echo "    HostName $ip"
    echo "    User ec2-user"
    echo "    IdentityFile $KEY_FILE"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo "    ServerAliveCountMax 3"
    echo "    # Connection optimization"
    echo "    ControlMaster auto"
    echo "    ControlPath ~/.ssh/control-%r@%h:%p"
    echo "    ControlPersist 5m"
    echo "    Compression yes"
    echo "    TCPKeepAlive yes"
    echo "    ConnectTimeout 10"
    echo ""
    ((counter++))
done

counter=0
for ip in $CONSUMER_IPS; do
    echo "# Consumer Instance $counter - Direct SSH Access"
    echo "Host shasta-consumer-$counter"
    echo "    HostName $ip"
    echo "    User ec2-user"
    echo "    IdentityFile $KEY_FILE"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo "    ServerAliveCountMax 3"
    echo "    # Connection optimization"
    echo "    ControlMaster auto"
    echo "    ControlPath ~/.ssh/control-%r@%h:%p"
    echo "    ControlPersist 5m"
    echo "    Compression yes"
    echo "    TCPKeepAlive yes"
    echo "    ConnectTimeout 10"
    echo ""
    ((counter++))
done

echo "=========================================="
echo "🚀 DIRECT SSH APPROACH - Optimizations Included:"
echo "✓ Connection multiplexing (ControlMaster) - reuses connections"
echo "✓ Control persistence - keeps connections alive for 5 minutes"
echo "✓ Compression - reduces bandwidth usage"
echo "✓ Keep-alive settings - prevents connection drops"
echo "✓ Fast timeouts - quick failure detection"
echo "✓ Direct access - no bastion host required"
echo ""
echo "🎯 Benefits of Direct SSH:"
echo "• SIMPLE: Direct connection to instances"
echo "• FAST: No intermediate hops"
echo "• RELIABLE: Fewer failure points"
echo "• MANAGEABLE: Standard SSH configuration"
echo ""
echo "💡 Performance Tips:"
echo "1. First connection will establish connection multiplexing"
echo "2. Subsequent connections will be faster (reuse existing connection)"
echo "3. Control sockets stored in ~/.ssh/control-* files"
echo "4. Use 'ssh -O exit <host>' to close master connection"
echo "5. Use 'ssh -O check <host>' to verify master status"
echo ""
echo "🔧 Usage Examples:"
echo "ssh shasta-producer-0        # Connect to first producer"
echo "ssh shasta-consumer-0        # Connect to first consumer"
echo ""
echo "🐛 Troubleshooting:"
echo "1. If AWS commands fail, try: aws configure"
echo "2. If CDK works but AWS CLI doesn't, check AWS_PROFILE environment variable"
echo "3. Verify the stack name is correct: $STACK_NAME_L2"
echo "4. Check that instances are running in AWS console"
echo "5. Ensure ~/.ssh/control/ directory exists: mkdir -p ~/.ssh/control"
echo "6. If connection multiplexing fails, remove control files: rm ~/.ssh/control-*"
echo "7. Verify key file exists: ls -la $KEY_FILE"
echo "8. Check security group allows SSH (port 22) from your IP"
echo "9. Verify instances have public IPs and are in public subnets" 