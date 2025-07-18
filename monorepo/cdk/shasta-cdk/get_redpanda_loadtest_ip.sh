#!/bin/bash

# Script to get Redpanda load test instance IP address for direct SSH configuration
# This script generates direct SSH config for the load testing instance

REGION="us-east-1"
STACK_NAME="ShastaRedpandaStack"  # Adjust if your stack name is different
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

echo "Getting Redpanda Load Test Instance Public IP..."
loadtest_cmd="aws ec2 describe-instances \
    --region $REGION \
    --filters 'Name=tag:Name,Values=ShastaRedpandaStack/RedpandaLoadTest' \
           'Name=instance-state-name,Values=running' \
    --query 'Reservations[].Instances[].[PublicIpAddress,InstanceId,InstanceType,Tags[?Key==\"Name\"].Value|[0]]' \
    --output table"

if run_aws_command "$loadtest_cmd" "Redpanda Load Test Instance lookup"; then
    echo "Redpanda Load Test Instance Details:"
    echo "$result"
    echo ""
    
    # Get just the IP address
    ip_cmd="aws ec2 describe-instances \
        --region $REGION \
        --filters 'Name=tag:Name,Values=ShastaRedpandaStack/RedpandaLoadTest' \
               'Name=instance-state-name,Values=running' \
        --query 'Reservations[].Instances[].PublicIpAddress' \
        --output text"
    
    if run_aws_command "$ip_cmd" "IP address extraction"; then
        LOADTEST_IP=$(echo "$result" | tr -d '\n\r' | awk '{print $1}')
        echo "Load Test Instance Public IP: $LOADTEST_IP"
    else
        echo "Failed to extract IP address"
        LOADTEST_IP=""
    fi
else
    echo "Failed to get Redpanda Load Test Instance details"
    LOADTEST_IP=""
fi

echo ""
echo "=========================================="
echo "DIRECT SSH Config entry for ~/.ssh/config:"
echo ""

if [ -n "$LOADTEST_IP" ]; then
    echo "# Redpanda Load Test Instance - Direct SSH Access"
    echo "Host redpanda-loadtest"
    echo "    HostName $LOADTEST_IP"
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
    echo "# Alternative short alias"
    echo "Host rp-test"
    echo "    HostName $LOADTEST_IP"
    echo "    User ec2-user"
    echo "    IdentityFile $KEY_FILE"
    echo "    ForwardAgent yes"
    echo "    ServerAliveInterval 60"
    echo "    ServerAliveCountMax 3"
    echo "    ControlMaster auto"
    echo "    ControlPath ~/.ssh/control-%r@%h:%p"
    echo "    ControlPersist 5m"
    echo "    Compression yes"
    echo "    TCPKeepAlive yes"
    echo "    ConnectTimeout 10"
else
    echo "❌ No IP address found. Check that:"
    echo "1. ShastaRedpandaStack has been deployed"
    echo "2. The load test instance is running"
    echo "3. AWS credentials are configured correctly"
fi

echo ""
echo "=========================================="
echo "🚀 REDPANDA LOAD TEST INSTANCE - Optimizations Included:"
echo "✓ Connection multiplexing (ControlMaster) - reuses connections"
echo "✓ Control persistence - keeps connections alive for 5 minutes"
echo "✓ Compression - reduces bandwidth usage"
echo "✓ Keep-alive settings - prevents connection drops"
echo "✓ Fast timeouts - quick failure detection"
echo "✓ Direct access - no bastion host required"
echo ""
echo "🎯 Instance Specifications:"
echo "• Instance Type: c5n.large (enhanced networking)"
echo "• CPU: 2 vCPUs"
echo "• Memory: 5.25 GB"
echo "• Network: Up to 25 Gbps"
echo "• Storage: 100GB GP3 (3000 IOPS)"
echo "• Placement: Same VPC as Redpanda brokers"
echo ""
echo "🔧 Pre-installed Load Testing Tools:"
echo "• RPK (Redpanda CLI tool)"
echo "• Python 3 with kafka-python and confluent-kafka"
echo "• AWS CLI and boto3 for S3 operations"
echo "• Performance monitoring (htop, iotop)"
echo "• Network optimization (TCP buffer tuning)"
echo "• Custom latency test scripts"
echo ""
echo "📊 Environment Variables (already configured):"
echo "• REDPANDA_S3_BUCKET - S3 bucket for test data"
echo "• RPK profiles configured for cluster access"
echo "• Python scripts for latency testing"
echo ""
echo "🎮 Usage Examples:"
echo "ssh redpanda-loadtest                    # Connect to load test instance"
echo "ssh rp-test                              # Short alias"
echo ""
echo "Once connected, try:"
echo "source ~/.bashrc                         # Load environment variables"
echo "echo \$REDPANDA_S3_BUCKET                 # Check S3 bucket name"
echo "rpk cluster info                         # Check cluster status"
echo ""
echo "💡 Performance Testing Commands:"
echo "# Create a test topic"
echo "rpk topic create perf-test --partitions 3 --replicas 3"
echo ""
echo "# Run Python latency test"
echo "python3 ~/latency_test.py"
echo ""
echo "# Test S3 operations"
echo "python3 ~/s3_test.py"
echo ""
echo "# Basic producer/consumer test"
echo "echo 'test message' | rpk topic produce perf-test"
echo "rpk topic consume perf-test --from-beginning --num 1"
echo ""
echo "📈 Monitoring Commands:"
echo "htop                                     # CPU and memory usage"
echo "iotop -o                                 # I/O usage"
echo "rpk cluster health                       # Cluster health check"
echo "bash ~/s3_helper.sh                      # List S3 bucket contents"
echo ""
echo "🐛 Troubleshooting:"
echo "1. If AWS commands fail, try: aws configure"
echo "2. If CDK works but AWS CLI doesn't, check AWS_PROFILE environment variable"
echo "3. Verify the stack name is correct: $STACK_NAME"
echo "4. Check that instance is running in AWS console"
echo "5. Ensure ~/.ssh/control/ directory exists: mkdir -p ~/.ssh/control"
echo "6. If connection multiplexing fails, remove control files: rm ~/.ssh/control-*"
echo "7. Verify key file exists: ls -la $KEY_FILE"
echo "8. Check security group allows SSH (port 22) from your IP"
echo "9. Verify instance has public IP and is in public subnet"
echo "10. If Redpanda brokers are unreachable, check broker instances:"
echo "    aws ec2 describe-instances --filters 'Name=tag:Name,Values=ShastaRedpandaStack/RedpandaBroker*' --query 'Reservations[].Instances[].State'" 