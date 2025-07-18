#!/bin/bash

# Redpanda Broker Connectivity Diagnostic Script
# This script helps diagnose why brokers are not accessible

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 Redpanda Broker Connectivity Diagnostics${NC}"
echo "=============================================="

# Broker IPs from your previous output
BROKER_IPS=(
    "34.203.210.117"
    "35.172.250.181" 
    "52.201.230.84"
)

LOADTEST_IP="3.85.145.113"

echo -e "${YELLOW}📋 Testing connectivity to broker instances...${NC}"
echo

# Test 1: Check if broker ports are accessible from current location
echo -e "${BLUE}Test 1: Port connectivity from current location${NC}"
for i in "${!BROKER_IPS[@]}"; do
    ip="${BROKER_IPS[$i]}"
    broker_num=$((i + 1))
    
    echo -n "Broker $broker_num ($ip): "
    
    # Test SSH port (22)
    if timeout 5 bash -c "echo > /dev/tcp/$ip/22" 2>/dev/null; then
        echo -e "${GREEN}SSH ✅${NC}"
    else
        echo -e "${RED}SSH ❌${NC}"
    fi
done
echo

# Test 2: Check connectivity from load test instance
echo -e "${BLUE}Test 2: Connectivity from load test instance${NC}"
echo "Load test instance: $LOADTEST_IP"

# First verify load test instance is accessible
if timeout 5 bash -c "echo > /dev/tcp/$LOADTEST_IP/22" 2>/dev/null; then
    echo -e "${GREEN}✅ Load test instance is accessible${NC}"
    
    # Test connectivity to brokers from load test instance
    for i in "${!BROKER_IPS[@]}"; do
        ip="${BROKER_IPS[$i]}"
        broker_num=$((i + 1))
        
        echo -n "  → Broker $broker_num ($ip): "
        
        # Test ping from load test instance
        if ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$LOADTEST_IP "timeout 3 ping -c 1 $ip" >/dev/null 2>&1; then
            echo -e "${GREEN}Ping ✅${NC}"
        else
            echo -e "${RED}Ping ❌${NC}"
        fi
    done
else
    echo -e "${RED}❌ Load test instance is not accessible${NC}"
fi
echo

# Test 3: Check if instances might be in different subnets
echo -e "${BLUE}Test 3: Network analysis${NC}"
echo "Checking network configuration from load test instance..."

if ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$LOADTEST_IP 'ip route show' 2>/dev/null; then
    echo
    echo "Load test instance network interface:"
    ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$LOADTEST_IP 'ip addr show eth0' 2>/dev/null | grep inet
else
    echo -e "${RED}Could not retrieve network information${NC}"
fi
echo

# Test 4: Check if brokers are in public or private subnets
echo -e "${BLUE}Test 4: Subnet analysis${NC}"
echo "Broker IP analysis:"
for i in "${!BROKER_IPS[@]}"; do
    ip="${BROKER_IPS[$i]}"
    broker_num=$((i + 1))
    
    # Check if IP is in private range
    if [[ $ip =~ ^10\. ]] || [[ $ip =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] || [[ $ip =~ ^192\.168\. ]]; then
        echo "  Broker $broker_num ($ip): ${YELLOW}Private IP${NC}"
    else
        echo "  Broker $broker_num ($ip): ${GREEN}Public IP${NC}"
    fi
done
echo

# Test 5: Check if security groups might be blocking access
echo -e "${BLUE}Test 5: Security group analysis${NC}"
echo "Testing common ports on brokers..."

PORTS=(22 9092 33145 9644)
PORT_NAMES=("SSH" "Kafka" "RPC" "Admin")

for i in "${!BROKER_IPS[@]}"; do
    ip="${BROKER_IPS[$i]}"
    broker_num=$((i + 1))
    
    echo "Broker $broker_num ($ip):"
    for j in "${!PORTS[@]}"; do
        port="${PORTS[$j]}"
        name="${PORT_NAMES[$j]}"
        
        echo -n "  $name ($port): "
        if timeout 3 bash -c "echo > /dev/tcp/$ip/$port" 2>/dev/null; then
            echo -e "${GREEN}Open ✅${NC}"
        else
            echo -e "${RED}Closed/Filtered ❌${NC}"
        fi
    done
    echo
done

# Test 6: Check if instances are actually running
echo -e "${BLUE}Test 6: Instance status check${NC}"
echo "Attempting to determine if instances are running..."

# Try to get instance metadata (this would work if we had AWS credentials)
echo "Note: To check actual instance status, you would need AWS credentials configured."
echo "You can check instance status in the AWS Console:"
echo "  1. Go to EC2 Console → Instances"
echo "  2. Search for instance IDs: i-0424e93f8cf918a15, i-026cd9abb2e502809, i-020dcf96c9fc521b0"
echo "  3. Check their state (running, stopped, terminated)"
echo "  4. Check their security groups"
echo "  5. Check their subnet configuration"
echo

# Summary and recommendations
echo -e "${BLUE}📊 DIAGNOSIS SUMMARY${NC}"
echo "===================="

echo -e "${YELLOW}🔍 Findings:${NC}"
echo "• Broker instances are not accessible via SSH from current location"
echo "• Load test instance cannot reach brokers (if tested above)"
echo "• This suggests either:"
echo "  1. Instances are not running"
echo "  2. Security groups are blocking access"
echo "  3. Network configuration issues"
echo "  4. Instances are still starting up"
echo

echo -e "${YELLOW}🔧 Recommended Actions:${NC}"
echo "1. Check instance status in AWS Console"
echo "2. Verify security groups allow:"
echo "   • SSH (port 22) from your IP or load test instance"
echo "   • Inter-broker communication (port 33145)"
echo "   • Kafka API (port 9092)"
echo "3. Check if instances are in correct subnets"
echo "4. Review CloudFormation stack events for deployment issues"
echo "5. Check CloudWatch logs for instance startup issues"
echo

echo -e "${YELLOW}🚀 Quick fixes to try:${NC}"
echo "1. Restart the instances from AWS Console"
echo "2. Check security group rules"
echo "3. Verify VPC and subnet configuration"
echo "4. Check if instances have public IPs assigned"
echo "5. Review user data script execution in CloudWatch logs"
echo

echo -e "${BLUE}💡 Next steps:${NC}"
echo "• Configure AWS credentials: aws configure"
echo "• Then run: ./check_redpanda_deployment.sh"
echo "• Or manually check instances in AWS Console" 