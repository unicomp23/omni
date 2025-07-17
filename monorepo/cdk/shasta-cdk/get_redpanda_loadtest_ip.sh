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
    --filters 'Name=tag:Purpose,Values=LoadTesting' \
           'Name=tag:Name,Values=RedpandaLoadTestInstance' \
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
        --filters 'Name=tag:Purpose,Values=LoadTesting' \
               'Name=tag:Name,Values=RedpandaLoadTestInstance' \
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
echo "• Instance Type: c5n.4xlarge (enhanced networking)"
echo "• CPU: 16 vCPUs"
echo "• Memory: 32 GB"
echo "• Network: Up to 100 Gbps"
echo "• Storage: 100GB GP3 (3000 IOPS)"
echo "• Placement: Cluster placement group for low latency"
echo ""
echo "🔧 Pre-installed Load Testing Tools:"
echo "• Kafka client tools (/opt/kafka/bin/)"
echo "• kcat (formerly kafkacat)"
echo "• Performance monitoring (htop, iotop, tcpdump)"
echo "• Network optimization (TCP BBR, optimized buffers)"
echo "• JVM tuning (G1GC, 4GB heap, 20ms pause target)"
echo ""
echo "📊 Environment Variables (already configured):"
echo "• REDPANDA_BROKERS - broker connection string"
echo "• KAFKA_HEAP_OPTS - JVM settings for low latency"
echo "• JVM_PERFORMANCE_OPTS - additional JVM optimizations"
echo ""
echo "🎮 Usage Examples:"
echo "ssh redpanda-loadtest                    # Connect to load test instance"
echo "ssh rp-test                              # Short alias"
echo ""
echo "Once connected, try:"
echo "cd ~/redpanda-testing"
echo "./low-latency-test.sh                    # Run pre-configured latency test"
echo "source ~/.bashrc                         # Load environment variables"
echo "echo \$REDPANDA_BROKERS                   # Check broker endpoints"
echo ""
echo "💡 Performance Testing Commands:"
echo "# Create a test topic"
echo "/opt/kafka/bin/kafka-topics.sh --create --topic perf-test --bootstrap-server \$REDPANDA_BROKERS --partitions 3 --replication-factor 3"
echo ""
echo "# Run producer performance test"
echo "/opt/kafka/bin/kafka-producer-perf-test.sh --topic perf-test --num-records 1000000 --record-size 1024 --throughput 50000 --producer-props bootstrap.servers=\$REDPANDA_BROKERS"
echo ""
echo "# Run consumer performance test"
echo "/opt/kafka/bin/kafka-consumer-perf-test.sh --topic perf-test --bootstrap-server \$REDPANDA_BROKERS --messages 1000000"
echo ""
echo "# Measure end-to-end latency"
echo "/opt/kafka/bin/kafka-run-class.sh kafka.tools.EndToEndLatency \$REDPANDA_BROKERS perf-test 10000 1 1024"
echo ""
echo "📈 Monitoring Commands:"
echo "htop                                     # CPU and memory usage"
echo "iotop -o                                 # I/O usage"
echo "tcpdump -i eth0 -n port 9092            # Network traffic to Redpanda"
echo "netstat -i                               # Network interface stats"
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
echo "10. If Redpanda brokers are unreachable, check ECS service status:"
echo "    aws ecs describe-services --cluster RedpandaCluster --services redpanda-broker-1 redpanda-broker-2 redpanda-broker-3" 