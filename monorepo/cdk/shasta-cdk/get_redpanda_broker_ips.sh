#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🔍 REDPANDA BROKER INSTANCES INFO${NC}"
echo -e "${BLUE}===========================================${NC}"

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

echo -e "${YELLOW}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${YELLOW}Warning: AWS CLI credentials not found. Trying to continue anyway...${NC}"
    echo -e "${YELLOW}If this fails, please configure AWS credentials with: aws configure${NC}"
    echo
fi

echo -e "${BLUE}Getting Redpanda Broker Instance details...${NC}"

# Get broker instance information
BROKER_QUERY='aws ec2 describe-instances \
    --region us-east-1 \
    --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaBroker*" \
             "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].[PrivateIpAddress,PublicIpAddress,InstanceId,InstanceType,Tags[?Key==\"Name\"].Value|[0],AvailabilityZone]" \
    --output table'

echo -e "${YELLOW}Running: $BROKER_QUERY${NC}"
echo

if BROKER_RESULT=$(eval "$BROKER_QUERY" 2>&1); then
    echo -e "${GREEN}✅ Redpanda Broker Instances:${NC}"
    echo "$BROKER_RESULT"
    echo
    
    # Get private IPs for SSH commands
    BROKER_IPS=$(aws ec2 describe-instances \
        --region us-east-1 \
        --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaBroker*" \
                 "Name=instance-state-name,Values=running" \
        --query "Reservations[].Instances[].PrivateIpAddress" \
        --output text 2>/dev/null)
    
    # Get public IPs for direct SSH access - Note: Brokers are in private subnets, no public IPs
    BROKER_PUBLIC_IPS=$(aws ec2 describe-instances \
        --region us-east-1 \
        --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaBroker*" \
                 "Name=instance-state-name,Values=running" \
        --query "Reservations[].Instances[].PublicIpAddress" \
        --output text 2>/dev/null)
    
    if [ -n "$BROKER_IPS" ]; then
        echo -e "${BLUE}===========================================${NC}"
        echo -e "${BLUE}🔐 SSH ACCESS TO BROKER INSTANCES${NC}"
        echo -e "${BLUE}===========================================${NC}"
        echo
        echo -e "${GREEN}📝 SSH Config entries for ~/.ssh/config:${NC}"
        echo
        
        # Config for private IP access via jump host
        echo -e "${YELLOW}# Access via jump host (private IPs only)${NC}"
        COUNTER=1
        for IP in $BROKER_IPS; do
            echo "Host redpanda-broker-$COUNTER"
            echo "    HostName $IP"
            echo "    User ec2-user"
            echo "    IdentityFile ~/.ssh/john.davis.pem"
            echo "    StrictHostKeyChecking no"
            echo "    UserKnownHostsFile /dev/null"
            echo "    ProxyJump redpanda-loadtest"
            echo "    LogLevel ERROR"
            echo
            ((COUNTER++))
        done
        
        echo -e "${BLUE}===========================================${NC}"
        echo -e "${BLUE}🚀 SSH COMMANDS${NC}"
        echo -e "${BLUE}===========================================${NC}"
        echo
        echo -e "${GREEN}SSH via jump host (private IPs only):${NC}"
        COUNTER=1
        for IP in $BROKER_IPS; do
            echo -e "${YELLOW}# Connect to Redpanda Broker $COUNTER:${NC}"
            echo "ssh redpanda-broker-$COUNTER"
            echo
            ((COUNTER++))
        done
        
        echo -e "${GREEN}Alternative - Direct SSH with ProxyJump:${NC}"
        # Get load test instance IP
        LOADTEST_IP=$(aws ec2 describe-instances \
            --region us-east-1 \
            --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaLoadTest" \
                     "Name=instance-state-name,Values=running" \
            --query "Reservations[].Instances[].PublicIpAddress" \
            --output text 2>/dev/null)
        
        if [ -n "$LOADTEST_IP" ]; then
            COUNTER=1
            for IP in $BROKER_IPS; do
                echo -e "${YELLOW}# Broker $COUNTER via Load Test instance:${NC}"
                echo "ssh -J ec2-user@$LOADTEST_IP -i ~/.ssh/john.davis.pem ec2-user@$IP"
                echo
                ((COUNTER++))
            done
        fi
        
        echo -e "${BLUE}===========================================${NC}"
        echo -e "${BLUE}🔧 AWS SESSION MANAGER ACCESS${NC}"
        echo -e "${BLUE}===========================================${NC}"
        echo
        echo -e "${GREEN}Alternative access via AWS Session Manager (no SSH key needed):${NC}"
        
        # Get instance IDs for Session Manager
        INSTANCE_IDS=$(aws ec2 describe-instances \
            --region us-east-1 \
            --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaBroker*" \
                     "Name=instance-state-name,Values=running" \
            --query "Reservations[].Instances[].[InstanceId,Tags[?Key==\"Name\"].Value|[0]]" \
            --output text 2>/dev/null)
        
        if [ -n "$INSTANCE_IDS" ]; then
            echo "$INSTANCE_IDS" | while read -r INSTANCE_ID BROKER_NAME; do
                # Extract broker number from name (ShastaRedpandaStack/RedpandaBroker1 -> 1)
                BROKER_NUM=$(echo "$BROKER_NAME" | sed 's/.*RedpandaBroker\([0-9]*\).*/\1/')
                echo -e "${YELLOW}# Connect to Broker $BROKER_NUM:${NC}"
                echo "aws ssm start-session --target $INSTANCE_ID --region us-east-1"
                echo
            done
        fi
        
        echo -e "${BLUE}===========================================${NC}"
        echo -e "${BLUE}🌐 EC2 INSTANCE CONNECT ACCESS${NC}"
        echo -e "${BLUE}===========================================${NC}"
        echo
        echo -e "${GREEN}Browser-based access via AWS Console:${NC}"
        echo "1. Go to EC2 Console → Instances"
        echo "2. Select a Redpanda broker instance"
        echo "3. Click 'Connect' → 'EC2 Instance Connect'"
        echo "4. Click 'Connect'"
        echo
        echo -e "${GREEN}CLI-based EC2 Instance Connect:${NC}"
        if [ -n "$INSTANCE_IDS" ]; then
            echo "$INSTANCE_IDS" | while read -r INSTANCE_ID BROKER_NAME; do
                # Extract broker number from name (ShastaRedpandaStack/RedpandaBroker1 -> 1)
                BROKER_NUM=$(echo "$BROKER_NAME" | sed 's/.*RedpandaBroker\([0-9]*\).*/\1/')
                # Get AZ and private IP for the instance (brokers don't have public IPs)
                INSTANCE_INFO=$(aws ec2 describe-instances \
                    --region us-east-1 \
                    --instance-ids $INSTANCE_ID \
                    --query "Reservations[].Instances[].[Placement.AvailabilityZone,PrivateIpAddress]" \
                    --output text 2>/dev/null)
                
                if [ -n "$INSTANCE_INFO" ]; then
                    AZ=$(echo "$INSTANCE_INFO" | cut -f1)
                    PRIVATE_IP=$(echo "$INSTANCE_INFO" | cut -f2)
                    
                    echo -e "${YELLOW}# Connect to Broker $BROKER_NUM (Private subnet - use jump host):${NC}"
                    echo "# Note: Broker instances are in private subnets and don't have public IPs"
                    echo "# Use SSM Session Manager or SSH via jump host (load test instance)"
                    echo "aws ssm start-session --target $INSTANCE_ID --region us-east-1"
                    echo
                fi
            done
        fi
        
        echo -e "${BLUE}===========================================${NC}"
        echo -e "${BLUE}🔧 REDPANDA COMMANDS ON BROKER INSTANCES${NC}"
        echo -e "${BLUE}===========================================${NC}"
        echo
        echo -e "${GREEN}Once connected to a broker instance, useful commands:${NC}"
        echo
        echo -e "${YELLOW}# Check Redpanda service status:${NC}"
        echo "sudo systemctl status redpanda"
        echo
        echo -e "${YELLOW}# Check Redpanda logs:${NC}"
        echo "sudo journalctl -u redpanda -f --no-pager"
        echo "sudo tail -f /var/log/redpanda/redpanda.log"
        echo
        echo -e "${YELLOW}# Run RPK commands:${NC}"
        echo "rpk cluster health"
        echo "rpk cluster info"
        echo "rpk topic list"
        echo "rpk cluster config status"
        echo
        echo -e "${YELLOW}# Performance monitoring:${NC}"
        echo "htop"
        echo "iotop -o"
        echo "netstat -tulpn | grep :9092"
        echo
        
    else
        echo -e "${RED}❌ No running broker instances found${NC}"
    fi
    
else
    echo -e "${RED}Error running Redpanda Broker Instance lookup:${NC}"
    echo
    echo "$BROKER_RESULT"
    echo
    echo -e "${RED}Failed to get Redpanda Broker Instance details${NC}"
fi

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}📋 NOTES${NC}"
echo -e "${BLUE}===========================================${NC}"
echo
echo -e "${YELLOW}🔑 Prerequisites:${NC}"
echo "• SSH key file: ~/.ssh/john.davis.pem"
echo "• Load test instance must be running (acts as jump host)"
echo "• AWS credentials configured"
echo
echo -e "${YELLOW}🌐 Network Setup:${NC}"
echo "• Broker instances are in private subnets (no public IPs)"
echo "• Access via load test instance as jump host or SSM Session Manager"
echo "• All instances have Session Manager (SSM) enabled"
echo "• EC2 Instance Connect enabled for browser-based and CLI access"
echo
echo -e "${YELLOW}⚡ Performance:${NC}"
echo "• Instance Type: c5n.xlarge (enhanced networking)"
echo "• Low latency network optimizations applied"
echo "• Native Redpanda installation (no Docker overhead)"
echo "• GP3 storage with 3000 IOPS and 125 MiB/s throughput"
echo
echo -e "${YELLOW}🔍 Troubleshooting:${NC}"
echo "• Broker instances are in private subnets - use SSM or jump host"
echo "• If SSH via jump host fails, try Session Manager (no jump host needed)"
echo "• Check security groups allow SSH from EC2 Instance Connect service"
echo "• Verify load test instance has public IP (acts as jump host)"
echo "• For EC2 Instance Connect, ensure public key is in ~/.ssh/id_rsa.pub"
echo "• SSM Session Manager works for private instances without public IPs"
echo
echo -e "${YELLOW}🔧 EC2 Instance Connect Troubleshooting:${NC}"
echo "• If 'Connect' button is grayed out, check instance is running"
echo "• If connection times out, verify security group allows 18.206.107.24/29"
echo "• If 'Failed to connect' error, check EC2 Instance Connect agent is running"
echo "• Try refreshing the AWS Console and wait 2-3 minutes after instance launch"
echo "• Check CloudTrail logs for 'SendSSHPublicKey' events for detailed errors"
echo
echo -e "${YELLOW}🔍 Manual EC2 Instance Connect Verification:${NC}"
echo "# Check if EC2 Instance Connect is working:"
echo "aws ec2-instance-connect describe-instance-connect-endpoints --region us-east-1"
echo "# Check instance metadata service:"
echo "aws ec2 describe-instances --instance-ids <instance-id> --region us-east-1 --query 'Reservations[].Instances[].MetadataOptions'" 