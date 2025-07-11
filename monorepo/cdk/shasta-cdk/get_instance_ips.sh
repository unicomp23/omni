#!/bin/bash

# Script to get Shasta infrastructure IP addresses for SSH configuration
# This script generates optimized SSH config for bastion host jumping (NOT SSM)

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
echo "Getting Monitor/Orchestrator Instance Private IPs..."
monitor_cmd="aws ec2 describe-instances \
    --region $REGION \
    --filters 'Name=tag:shasta-role,Values=monitor' \
           'Name=instance-state-name,Values=running' \
    --query 'Reservations[].Instances[].PrivateIpAddress' \
    --output text"

if run_aws_command "$monitor_cmd" "Monitor Instance IP lookup"; then
    MONITOR_IPS=$(echo "$result" | tr -d '\n\r')
    echo "Monitor Instance Private IPs:"
    for ip in $MONITOR_IPS; do
        echo "  - $ip"
    done
else
    echo "Failed to get Monitor Instance Private IPs"
    MONITOR_IPS=""
fi

echo ""
echo "=========================================="
echo "OPTIMIZED SSH Config entries for ~/.ssh/config:"
echo ""

if [ -n "$BASTION_IP" ]; then
    echo "# Bastion Host - SSH Jump Host (NOT SSM)"
    echo "# Optimized for connection multiplexing and performance"
    echo "Host shasta-bastion"
    echo "    HostName $BASTION_IP"
    echo "    User ec2-user"
    echo "    IdentityFile $KEY_FILE"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo "    ServerAliveCountMax 3"
    echo "    # Connection multiplexing for performance"
    echo "    ControlMaster auto"
    echo "    ControlPath ~/.ssh/control-%r@%h:%p"
    echo "    ControlPersist 10m"
    echo "    # Compression for slower connections"
    echo "    Compression yes"
    echo "    # Fast connection setup"
    echo "    TCPKeepAlive yes"
    echo "    ConnectTimeout 10"
    echo ""
else
    echo "# Bastion host IP not found - check stack deployment"
    echo "# Host shasta-bastion"
    echo "#     HostName <BASTION_IP>"
    echo "#     User ec2-user"
    echo "#     IdentityFile $KEY_FILE"
    echo "#     ForwardAgent yes"
    echo "#     ServerAliveInterval 60"
    echo "#     ControlMaster auto"
    echo "#     ControlPath ~/.ssh/control-%r@%h:%p"
    echo "#     ControlPersist 10m"
    echo "#     Compression yes"
    echo "#     TCPKeepAlive yes"
    echo "#     ConnectTimeout 10"
    echo ""
fi

counter=0
for ip in $PRODUCER_IPS; do
    echo "# Producer Instance $counter - SSH via Bastion (NOT SSM)"
    echo "# Uses ProxyJump for fast bastion tunneling"
    echo "Host shasta-producer-$counter"
    echo "    HostName $ip"
    echo "    User ec2-user"
    echo "    IdentityFile $KEY_FILE"
    echo "    ProxyJump shasta-bastion"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo "    ServerAliveCountMax 3"
    echo "    # Reuse bastion connection for performance"
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
    echo "# Consumer Instance $counter - SSH via Bastion (NOT SSM)"
    echo "# Uses ProxyJump for fast bastion tunneling"
    echo "Host shasta-consumer-$counter"
    echo "    HostName $ip"
    echo "    User ec2-user"
    echo "    IdentityFile $KEY_FILE"
    echo "    ProxyJump shasta-bastion"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo "    ServerAliveCountMax 3"
    echo "    # Reuse bastion connection for performance"
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
for ip in $MONITOR_IPS; do
    echo "# Monitor Instance $counter - SSH via Bastion (NOT SSM)"
    echo "# Uses ProxyJump for fast bastion tunneling"
    echo "Host shasta-monitor-$counter"
    echo "    HostName $ip"
    echo "    User ec2-user"
    echo "    IdentityFile $KEY_FILE"
    echo "    ProxyJump shasta-bastion"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo "    ServerAliveCountMax 3"
    echo "    # Reuse bastion connection for performance"
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
echo "🚀 SSH BASTION APPROACH (NOT SSM) - Optimizations Included:"
echo "✓ Connection multiplexing (ControlMaster) - reuses connections"
echo "✓ Control persistence - keeps connections alive for 5-10 minutes"
echo "✓ Compression - reduces bandwidth usage"
echo "✓ Keep-alive settings - prevents connection drops"
echo "✓ Fast timeouts - quick failure detection"
echo "✓ ProxyJump - efficient bastion tunneling"
echo ""
echo "🎯 Why SSH Bastion > SSM:"
echo "• FASTER: Instant connections after first (vs 2-5 sec SSM startup)"
echo "• SIMPLER: Standard SSH tools work perfectly"
echo "• CHEAPER: No SSM API costs"
echo "• RELIABLE: No AWS API dependencies"
echo ""
echo "💡 Performance Tips:"
echo "1. First connection to bastion will be slower (establishes master)"
echo "2. Subsequent connections will be instant (reuse master)"
echo "3. Control sockets stored in ~/.ssh/control-* files"
echo "4. Run 'ssh -O exit shasta-bastion' to close master connection"
echo "5. Use 'ssh -O check shasta-bastion' to verify master status"
echo ""
echo "🔧 Usage Examples:"
echo "ssh shasta-bastion           # Connect to bastion"
echo "ssh shasta-producer-0        # Connect to producer (via bastion)"
echo "ssh shasta-consumer-0        # Connect to consumer (via bastion)"
echo "ssh shasta-monitor-0         # Connect to monitor (via bastion)"
echo ""
echo "🐛 Troubleshooting:"
echo "1. If AWS commands fail, try: aws configure"
echo "2. If CDK works but AWS CLI doesn't, check AWS_PROFILE environment variable"
echo "3. Verify the stack name is correct: $STACK_NAME_L2"
echo "4. Check that instances are running in AWS console"
echo "5. Ensure ~/.ssh/control/ directory exists: mkdir -p ~/.ssh/control"
echo "6. If connection multiplexing fails, remove control files: rm ~/.ssh/control-*"
echo "7. Verify key file exists: ls -la $KEY_FILE" 