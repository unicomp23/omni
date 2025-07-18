#!/bin/bash

# Quick Redpanda Cluster Check
# A simple script to quickly verify if brokers have joined the cluster

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REGION=${1:-us-east-1}

echo -e "${BLUE}🔍 Quick Redpanda Cluster Check${NC}"
echo "=================================="

# Method 1: Check from Load Test Instance (fastest)
echo -e "${YELLOW}Method 1: Checking from Load Test Instance...${NC}"

LOADTEST_IP=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:Purpose,Values=LoadTesting" \
             "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].PublicIpAddress" \
    --output text 2>/dev/null)

if [ -n "$LOADTEST_IP" ]; then
    echo "Load test instance IP: $LOADTEST_IP"
    
    # Quick cluster check
    if ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$LOADTEST_IP 'source ~/.bashrc && /opt/kafka/bin/kafka-topics.sh --list --bootstrap-server $REDPANDA_BROKERS' 2>/dev/null; then
        echo -e "${GREEN}✅ Cluster is accessible and responsive${NC}"
        
        # Get broker count
        BROKER_COUNT=$(ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$LOADTEST_IP 'source ~/.bashrc && /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server $REDPANDA_BROKERS 2>/dev/null | grep -c "^[0-9]"' 2>/dev/null)
        
        if [ -n "$BROKER_COUNT" ] && [ "$BROKER_COUNT" -eq 3 ]; then
            echo -e "${GREEN}✅ All 3 brokers are connected${NC}"
        else
            echo -e "${YELLOW}⚠️ Expected 3 brokers, found: ${BROKER_COUNT:-unknown}${NC}"
        fi
        
        # Quick health test
        echo -e "${BLUE}Running quick health test...${NC}"
        if ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$LOADTEST_IP 'source ~/.bashrc && echo "test" | /opt/kafka/bin/kafka-console-producer.sh --topic __health_check --bootstrap-server $REDPANDA_BROKERS 2>/dev/null && echo "Health test passed"' 2>/dev/null; then
            echo -e "${GREEN}✅ Cluster can handle produce operations${NC}"
        else
            echo -e "${YELLOW}⚠️ Cluster health test failed${NC}"
        fi
    else
        echo -e "${RED}❌ Cluster is not accessible from load test instance${NC}"
    fi
else
    echo -e "${RED}❌ Load test instance not found${NC}"
fi

echo

# Method 2: Check individual brokers
echo -e "${YELLOW}Method 2: Checking Individual Brokers...${NC}"

BROKER_IPS=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:Purpose,Values=RedpandaBroker" \
             "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].[Tags[?Key=='BrokerId'].Value|[0],PublicIpAddress]" \
    --output text 2>/dev/null)

if [ -n "$BROKER_IPS" ]; then
    echo "$BROKER_IPS" | while read -r broker_id public_ip; do
        if [ -n "$broker_id" ] && [ -n "$public_ip" ]; then
            echo -n "Broker $broker_id ($public_ip): "
            
            # Check if container is running and healthy
            if ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$public_ip '/usr/local/bin/redpanda-health-check.sh' 2>/dev/null | grep -q "Healthy"; then
                echo -e "${GREEN}✅ Healthy${NC}"
            else
                echo -e "${RED}❌ Not healthy${NC}"
            fi
        fi
    done
else
    echo -e "${RED}❌ No broker instances found${NC}"
fi

echo

# Method 3: Direct RPK cluster info check
echo -e "${YELLOW}Method 3: Direct RPK Cluster Info...${NC}"

if [ -n "$BROKER_IPS" ]; then
    # Get first broker IP for cluster info
    FIRST_BROKER_IP=$(echo "$BROKER_IPS" | head -1 | awk '{print $2}')
    
    if [ -n "$FIRST_BROKER_IP" ]; then
        echo "Checking cluster info from first broker ($FIRST_BROKER_IP)..."
        
        CLUSTER_INFO=$(ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$FIRST_BROKER_IP 'docker exec redpanda-broker-1 rpk cluster info --brokers localhost:9092' 2>/dev/null)
        
        if [ -n "$CLUSTER_INFO" ]; then
            echo -e "${GREEN}✅ Cluster info retrieved:${NC}"
            echo "$CLUSTER_INFO" | head -10
        else
            echo -e "${RED}❌ Could not retrieve cluster info${NC}"
        fi
    fi
fi

echo

# Summary
echo -e "${BLUE}📊 Quick Summary${NC}"
echo "================="

# Count running brokers
RUNNING_BROKERS=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:Purpose,Values=RedpandaBroker" \
             "Name=instance-state-name,Values=running" \
    --query "length(Reservations[].Instances[])" \
    --output text 2>/dev/null)

echo "Running broker instances: ${RUNNING_BROKERS:-0}/3"

# Check if load test instance can connect
if [ -n "$LOADTEST_IP" ]; then
    if ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$LOADTEST_IP 'source ~/.bashrc && /opt/kafka/bin/kafka-topics.sh --list --bootstrap-server $REDPANDA_BROKERS' &>/dev/null; then
        echo -e "Cluster accessibility: ${GREEN}✅ Accessible${NC}"
    else
        echo -e "Cluster accessibility: ${RED}❌ Not accessible${NC}"
    fi
else
    echo -e "Cluster accessibility: ${YELLOW}⚠️ Cannot test (no load test instance)${NC}"
fi

echo
echo -e "${BLUE}💡 For detailed analysis, run: ./check_redpanda_cluster_membership.sh${NC}"
echo -e "${BLUE}💡 For broker IPs and SSH info, run: ./get_redpanda_broker_ips.sh${NC}" 