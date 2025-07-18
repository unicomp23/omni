#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🔍 EC2 INSTANCE CONNECT DIAGNOSTIC${NC}"
echo -e "${BLUE}===========================================${NC}"

# Check if instance ID is provided
if [ -z "$1" ]; then
    echo -e "${RED}Usage: $0 <instance-id>${NC}"
    echo -e "${YELLOW}Example: $0 i-1234567890abcdef0${NC}"
    exit 1
fi

INSTANCE_ID="$1"
REGION="us-east-1"

echo -e "${YELLOW}Checking EC2 Instance Connect for instance: $INSTANCE_ID${NC}"
echo

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    exit 1
fi

echo -e "${GREEN}✅ AWS CLI and credentials are configured${NC}"

# Check instance status
echo -e "${YELLOW}Checking instance status...${NC}"
INSTANCE_STATE=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION --query 'Reservations[].Instances[].State.Name' --output text 2>/dev/null)

if [ -z "$INSTANCE_STATE" ]; then
    echo -e "${RED}❌ Instance not found or access denied${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Instance state: $INSTANCE_STATE${NC}"

if [ "$INSTANCE_STATE" != "running" ]; then
    echo -e "${RED}❌ Instance is not running${NC}"
    exit 1
fi

# Check instance details
echo -e "${YELLOW}Checking instance details...${NC}"
INSTANCE_INFO=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION --query 'Reservations[].Instances[].[InstanceType,PublicIpAddress,Platform,ImageId,MetadataOptions.HttpEndpoint,MetadataOptions.HttpTokens]' --output text 2>/dev/null)

if [ -n "$INSTANCE_INFO" ]; then
    echo -e "${GREEN}✅ Instance details:${NC}"
    echo "$INSTANCE_INFO" | while read -r TYPE PUBLIC_IP PLATFORM IMAGE_ID METADATA_ENDPOINT METADATA_TOKENS; do
        echo "  Instance Type: $TYPE"
        echo "  Public IP: $PUBLIC_IP"
        echo "  Platform: $PLATFORM"
        echo "  Image ID: $IMAGE_ID"
        echo "  Metadata Endpoint: $METADATA_ENDPOINT"
        echo "  Metadata Tokens: $METADATA_TOKENS"
    done
else
    echo -e "${RED}❌ Could not retrieve instance details${NC}"
fi

# Check security groups
echo -e "${YELLOW}Checking security groups...${NC}"
SECURITY_GROUPS=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION --query 'Reservations[].Instances[].SecurityGroups[].GroupId' --output text 2>/dev/null)

if [ -n "$SECURITY_GROUPS" ]; then
    echo -e "${GREEN}✅ Security Groups: $SECURITY_GROUPS${NC}"
    
    # Check if EC2 Instance Connect IP range is allowed
    for SG in $SECURITY_GROUPS; do
        echo -e "${YELLOW}Checking security group $SG for EC2 Instance Connect access...${NC}"
        SSH_RULES=$(aws ec2 describe-security-groups --group-ids $SG --region $REGION --query 'SecurityGroups[].IpPermissions[?FromPort==`22`]' --output json 2>/dev/null)
        
        if echo "$SSH_RULES" | grep -q "18.206.107.24/29"; then
            echo -e "${GREEN}✅ EC2 Instance Connect IP range (18.206.107.24/29) is allowed${NC}"
        else
            echo -e "${RED}❌ EC2 Instance Connect IP range (18.206.107.24/29) is NOT allowed${NC}"
            echo -e "${YELLOW}Current SSH rules:${NC}"
            echo "$SSH_RULES" | jq -r '.[] | .IpRanges[]?.CidrIp // empty' | sort | uniq
        fi
    done
else
    echo -e "${RED}❌ Could not retrieve security groups${NC}"
fi

# Check if EC2 Instance Connect service is available
echo -e "${YELLOW}Checking EC2 Instance Connect service availability...${NC}"
CONNECT_ENDPOINTS=$(aws ec2-instance-connect describe-instance-connect-endpoints --region $REGION --output json 2>/dev/null)

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ EC2 Instance Connect service is available${NC}"
else
    echo -e "${RED}❌ EC2 Instance Connect service is not available or not accessible${NC}"
fi

# Test sending SSH public key
echo -e "${YELLOW}Testing SSH public key upload...${NC}"
if [ -f ~/.ssh/id_rsa.pub ]; then
    AZ=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION --query 'Reservations[].Instances[].Placement.AvailabilityZone' --output text 2>/dev/null)
    
    if [ -n "$AZ" ]; then
        echo -e "${GREEN}✅ Instance AZ: $AZ${NC}"
        echo -e "${YELLOW}Attempting to send SSH public key...${NC}"
        
        if aws ec2-instance-connect send-ssh-public-key \
            --instance-id $INSTANCE_ID \
            --availability-zone $AZ \
            --instance-os-user ec2-user \
            --ssh-public-key file://~/.ssh/id_rsa.pub \
            --region $REGION 2>/dev/null; then
            echo -e "${GREEN}✅ SSH public key sent successfully${NC}"
        else
            echo -e "${RED}❌ Failed to send SSH public key${NC}"
            echo -e "${YELLOW}Common reasons:${NC}"
            echo "  • Instance not running"
            echo "  • Security group doesn't allow EC2 Instance Connect IP range"
            echo "  • EC2 Instance Connect agent not running on instance"
            echo "  • Instance metadata service not accessible"
            echo "  • IAM permissions insufficient"
        fi
    else
        echo -e "${RED}❌ Could not determine instance AZ${NC}"
    fi
else
    echo -e "${RED}❌ SSH public key not found at ~/.ssh/id_rsa.pub${NC}"
    echo -e "${YELLOW}Generate one with: ssh-keygen -t rsa -b 2048 -f ~/.ssh/id_rsa${NC}"
fi

echo
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}📋 NEXT STEPS${NC}"
echo -e "${BLUE}===========================================${NC}"
echo
echo -e "${GREEN}If all checks pass:${NC}"
echo "1. Go to AWS Console → EC2 → Instances"
echo "2. Select instance $INSTANCE_ID"
echo "3. Click 'Connect' → 'EC2 Instance Connect'"
echo "4. Click 'Connect'"
echo
echo -e "${YELLOW}If connection still fails:${NC}"
echo "1. Check CloudTrail logs for 'SendSSHPublicKey' events"
echo "2. SSH into instance via Session Manager and check:"
echo "   sudo systemctl status ec2-instance-connect"
echo "   sudo journalctl -u ec2-instance-connect"
echo "3. Verify instance user data completed successfully:"
echo "   sudo cat /var/log/user-data.log"
echo
echo -e "${BLUE}Alternative access methods:${NC}"
echo "• Session Manager: aws ssm start-session --target $INSTANCE_ID --region $REGION"
echo "• SSH via load test instance (if available)" 