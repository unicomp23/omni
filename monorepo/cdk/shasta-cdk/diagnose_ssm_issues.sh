#!/bin/bash

# Comprehensive SSM Agent Diagnostics Script
# This script helps diagnose SSM agent registration and connectivity issues

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REGION=${1:-us-east-1}

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🔍 SSM AGENT DIAGNOSTICS${NC}"
echo -e "${BLUE}===========================================${NC}"
echo

# Function to check if command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}❌ $1 is not installed${NC}"
        return 1
    fi
    return 0
}

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"
check_command aws || exit 1
check_command jq || echo -e "${YELLOW}⚠️ jq not installed - output may be less formatted${NC}"

# Check AWS credentials
echo -e "${YELLOW}🔑 Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity &>/dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    exit 1
fi
echo -e "${GREEN}✅ AWS credentials configured${NC}"

# Get Redpanda broker instances
echo -e "${YELLOW}🔍 Finding Redpanda broker instances...${NC}"
BROKER_INSTANCES=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:Purpose,Values=RedpandaBroker" \
             "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].[InstanceId,Tags[?Key=='BrokerId'].Value|[0],State.Name,PublicIpAddress,PrivateIpAddress]" \
    --output text)

if [ -z "$BROKER_INSTANCES" ]; then
    echo -e "${RED}❌ No running Redpanda broker instances found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Found Redpanda broker instances:${NC}"
echo "$BROKER_INSTANCES" | while read -r INSTANCE_ID BROKER_ID STATE PUBLIC_IP PRIVATE_IP; do
    echo "  • Broker $BROKER_ID: $INSTANCE_ID ($STATE) - Public: $PUBLIC_IP, Private: $PRIVATE_IP"
done
echo

# Check SSM agent status for each instance
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🔍 SSM AGENT STATUS CHECK${NC}"
echo -e "${BLUE}===========================================${NC}"
echo

echo "$BROKER_INSTANCES" | while read -r INSTANCE_ID BROKER_ID STATE PUBLIC_IP PRIVATE_IP; do
    echo -e "${YELLOW}🔍 Checking SSM status for Broker $BROKER_ID ($INSTANCE_ID)...${NC}"
    
    # Check if instance is registered with SSM
    SSM_STATUS=$(aws ssm describe-instance-information \
        --region $REGION \
        --instance-information-filter-list key=InstanceIds,valueSet=$INSTANCE_ID \
        --query "InstanceInformationList[0].[PingStatus,LastPingDateTime,PlatformType,PlatformVersion]" \
        --output text 2>/dev/null)
    
    if [ -z "$SSM_STATUS" ] || [ "$SSM_STATUS" = "None" ]; then
        echo -e "${RED}❌ Instance $INSTANCE_ID not registered with SSM${NC}"
        
        # Check if instance is accessible via SSH for troubleshooting
        echo -e "${YELLOW}🔍 Troubleshooting options:${NC}"
        echo "  • SSH to instance: ssh -i ~/.ssh/john.davis.pem ec2-user@$PUBLIC_IP"
        echo "  • Check user data logs: sudo cat /var/log/user-data.log"
        echo "  • Check SSM agent logs: sudo journalctl -u amazon-ssm-agent"
        echo "  • Check SSM agent status: sudo systemctl status amazon-ssm-agent"
        echo
    else
        echo -e "${GREEN}✅ Instance $INSTANCE_ID is registered with SSM${NC}"
        echo "$SSM_STATUS" | while read -r PING_STATUS LAST_PING PLATFORM_TYPE PLATFORM_VERSION; do
            if [ "$PING_STATUS" = "Online" ]; then
                echo -e "${GREEN}   Status: $PING_STATUS${NC}"
            else
                echo -e "${RED}   Status: $PING_STATUS${NC}"
            fi
            echo "   Last Ping: $LAST_PING"
            echo "   Platform: $PLATFORM_TYPE $PLATFORM_VERSION"
        done
        echo
    fi
done

# Check VPC endpoints
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🔍 VPC ENDPOINTS CHECK${NC}"
echo -e "${BLUE}===========================================${NC}"
echo

echo -e "${YELLOW}🔍 Checking VPC endpoints for SSM...${NC}"
VPC_ENDPOINTS=$(aws ec2 describe-vpc-endpoints \
    --region $REGION \
    --filters "Name=service-name,Values=com.amazonaws.us-east-1.ssm,com.amazonaws.us-east-1.ssmmessages,com.amazonaws.us-east-1.ec2messages" \
    --query "VpcEndpoints[].[ServiceName,State,VpcId,RouteTableIds,SubnetIds]" \
    --output text)

if [ -z "$VPC_ENDPOINTS" ]; then
    echo -e "${RED}❌ No VPC endpoints found for SSM services${NC}"
    echo -e "${YELLOW}   This may cause connectivity issues for instances in private subnets${NC}"
else
    echo -e "${GREEN}✅ VPC endpoints found:${NC}"
    echo "$VPC_ENDPOINTS" | while read -r SERVICE_NAME STATE VPC_ID ROUTE_TABLES SUBNETS; do
        echo "  • Service: $SERVICE_NAME"
        echo "    State: $STATE"
        echo "    VPC: $VPC_ID"
        echo "    Subnets: $SUBNETS"
        echo
    done
fi

# Check security groups
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🔍 SECURITY GROUP CHECK${NC}"
echo -e "${BLUE}===========================================${NC}"
echo

echo -e "${YELLOW}🔍 Checking security groups for SSM access...${NC}"
SECURITY_GROUPS=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:Purpose,Values=RedpandaBroker" \
             "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].SecurityGroups[].GroupId" \
    --output text | tr '\t' '\n' | sort -u)

for SG_ID in $SECURITY_GROUPS; do
    echo -e "${YELLOW}🔍 Checking security group: $SG_ID${NC}"
    
    # Check egress rules for HTTPS (443) to VPC CIDR
    HTTPS_EGRESS=$(aws ec2 describe-security-groups \
        --region $REGION \
        --group-ids $SG_ID \
        --query "SecurityGroups[0].IpPermissionsEgress[?FromPort==\`443\` && ToPort==\`443\`]" \
        --output text)
    
    if [ -z "$HTTPS_EGRESS" ]; then
        echo -e "${RED}❌ No HTTPS egress rules found for VPC endpoints${NC}"
    else
        echo -e "${GREEN}✅ HTTPS egress rules found${NC}"
    fi
    
    # Check egress rules for all traffic (common configuration)
    ALL_EGRESS=$(aws ec2 describe-security-groups \
        --region $REGION \
        --group-ids $SG_ID \
        --query "SecurityGroups[0].IpPermissionsEgress[?IpProtocol==\`-1\`]" \
        --output text)
    
    if [ -n "$ALL_EGRESS" ]; then
        echo -e "${GREEN}✅ All traffic egress rule found${NC}"
    fi
    echo
done

# Check IAM role permissions
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🔍 IAM ROLE CHECK${NC}"
echo -e "${BLUE}===========================================${NC}"
echo

echo -e "${YELLOW}🔍 Checking IAM role permissions...${NC}"
INSTANCE_PROFILES=$(aws ec2 describe-instances \
    --region $REGION \
    --filters "Name=tag:Purpose,Values=RedpandaBroker" \
             "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].IamInstanceProfile.Arn" \
    --output text | sort -u)

for PROFILE_ARN in $INSTANCE_PROFILES; do
    if [ -n "$PROFILE_ARN" ] && [ "$PROFILE_ARN" != "None" ]; then
        echo -e "${GREEN}✅ IAM instance profile found: $PROFILE_ARN${NC}"
        
        # Extract role name from instance profile ARN
        ROLE_NAME=$(echo "$PROFILE_ARN" | sed 's/.*instance-profile\///' | sed 's/\/.*//')
        
        # Check if role has SSM permissions
        POLICIES=$(aws iam list-attached-role-policies --role-name $ROLE_NAME --region $REGION --output text 2>/dev/null)
        INLINE_POLICIES=$(aws iam list-role-policies --role-name $ROLE_NAME --region $REGION --output text 2>/dev/null)
        
        if [ -n "$POLICIES" ] || [ -n "$INLINE_POLICIES" ]; then
            echo -e "${GREEN}✅ Role has policies attached${NC}"
        else
            echo -e "${RED}❌ Role may not have sufficient permissions${NC}"
        fi
    else
        echo -e "${RED}❌ No IAM instance profile found${NC}"
    fi
done

echo

# Test SSM connectivity
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🔧 CONNECTION TESTING${NC}"
echo -e "${BLUE}===========================================${NC}"
echo

echo -e "${YELLOW}🔍 Testing SSM connectivity...${NC}"
echo "$BROKER_INSTANCES" | head -1 | while read -r INSTANCE_ID BROKER_ID STATE PUBLIC_IP PRIVATE_IP; do
    echo -e "${YELLOW}🔍 Testing connection to Broker $BROKER_ID ($INSTANCE_ID)...${NC}"
    
    # Test SSM session
    echo -e "${YELLOW}   Testing SSM session (will timeout in 10 seconds)...${NC}"
    timeout 10 aws ssm start-session --target $INSTANCE_ID --region $REGION --output text 2>/dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ SSM session test successful${NC}"
    else
        echo -e "${RED}❌ SSM session test failed${NC}"
    fi
    
    # Test SSH connection
    echo -e "${YELLOW}   Testing SSH connection (will timeout in 10 seconds)...${NC}"
    timeout 10 ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=5 -o StrictHostKeyChecking=no ec2-user@$PUBLIC_IP "echo 'SSH connection successful'" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ SSH connection test successful${NC}"
    else
        echo -e "${RED}❌ SSH connection test failed${NC}"
    fi
done

echo

# Summary and recommendations
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}📋 SUMMARY AND RECOMMENDATIONS${NC}"
echo -e "${BLUE}===========================================${NC}"
echo

echo -e "${YELLOW}🔧 Common SSM Issues and Solutions:${NC}"
echo
echo -e "${GREEN}1. Instance not registered with SSM:${NC}"
echo "   • Check IAM role has SSM permissions"
echo "   • Verify SSM agent is running: sudo systemctl status amazon-ssm-agent"
echo "   • Check user data logs: sudo cat /var/log/user-data.log"
echo "   • Restart SSM agent: sudo systemctl restart amazon-ssm-agent"
echo
echo -e "${GREEN}2. SSM agent offline:${NC}"
echo "   • Check network connectivity to SSM endpoints"
echo "   • Verify security group allows HTTPS outbound"
echo "   • Check VPC endpoints are accessible"
echo "   • Review SSM agent logs: sudo journalctl -u amazon-ssm-agent"
echo
echo -e "${GREEN}3. Permission issues:${NC}"
echo "   • Verify IAM role has AmazonSSMManagedInstanceCore policy"
echo "   • Check instance profile is attached"
echo "   • Review CloudTrail logs for permission denials"
echo
echo -e "${GREEN}4. Network issues:${NC}"
echo "   • Ensure security groups allow outbound HTTPS (443)"
echo "   • Check VPC endpoints are in correct subnets"
echo "   • Verify route tables allow access to VPC endpoints"
echo
echo -e "${YELLOW}🔧 Manual troubleshooting commands:${NC}"
echo "# Check SSM agent status on instance:"
echo "sudo systemctl status amazon-ssm-agent"
echo "sudo journalctl -u amazon-ssm-agent -f"
echo
echo "# Check SSM agent configuration:"
echo "sudo cat /etc/amazon/ssm/amazon-ssm-agent.json"
echo
echo "# Test connectivity to SSM endpoints:"
echo "curl -I https://ssm.us-east-1.amazonaws.com"
echo "curl -I https://ssmmessages.us-east-1.amazonaws.com"
echo "curl -I https://ec2messages.us-east-1.amazonaws.com"
echo
echo "# Force SSM agent registration:"
echo "sudo systemctl stop amazon-ssm-agent"
echo "sudo rm -rf /var/lib/amazon/ssm/registration"
echo "sudo systemctl start amazon-ssm-agent"
echo
echo -e "${GREEN}For immediate access, use alternative methods:${NC}"
echo "• SSH: ssh -i ~/.ssh/john.davis.pem ec2-user@<public-ip>"
echo "• EC2 Instance Connect: aws ec2-instance-connect send-ssh-public-key ..."
echo
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🏁 DIAGNOSTIC COMPLETE${NC}"
echo -e "${BLUE}===========================================${NC}" 