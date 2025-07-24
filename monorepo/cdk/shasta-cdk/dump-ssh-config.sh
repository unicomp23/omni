#!/bin/bash

set -e

# Configuration
STACK_NAME=${STACK_NAME:-RedPandaClusterStack}
AWS_PROFILE=${AWS_PROFILE:-358474168551_admin}
AWS_REGION=${AWS_DEFAULT_REGION:-us-east-1}
KEY_NAME="john.davis"
KEY_PATH="${HOME}/.ssh/${KEY_NAME}.pem"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Fetching load test instance information...${NC}"

# Get load test instance IP
LOAD_TEST_IP=$(aws --profile ${AWS_PROFILE} cloudformation describe-stacks \
    --region ${AWS_REGION} \
    --stack-name ${STACK_NAME} \
    --query "Stacks[0].Outputs[?OutputKey=='LoadTestInstanceIP'].OutputValue" \
    --output text 2>/dev/null)

if [ -z "$LOAD_TEST_IP" ] || [ "$LOAD_TEST_IP" == "None" ]; then
    echo -e "${RED}Error: Could not retrieve load test instance IP from stack ${STACK_NAME}${NC}"
    echo -e "${YELLOW}Make sure the stack is deployed and the AWS profile/region are correct.${NC}"
    exit 1
fi

echo -e "${GREEN}Load test instance IP: ${LOAD_TEST_IP}${NC}"

# Generate SSH config entry
cat << EOF

# ================================
# RedPanda Load Test Instance
# ================================
Host redpanda-loadtest
    HostName ${LOAD_TEST_IP}
    User ec2-user
    IdentityFile ${KEY_PATH}
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ServerAliveCountMax 3
    ConnectTimeout 10

# Alternative alias
Host loadtest
    HostName ${LOAD_TEST_IP}
    User ec2-user
    IdentityFile ${KEY_PATH}
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ServerAliveCountMax 3
    ConnectTimeout 10

EOF

echo -e "${YELLOW}Usage:${NC}"
echo "  1. Copy the above configuration to your ~/.ssh/config file"
echo "  2. Ensure your SSH key is at: ${KEY_PATH}"
echo "  3. Set proper permissions: chmod 600 ${KEY_PATH}"
echo "  4. Connect using: ssh redpanda-loadtest or ssh loadtest"
echo ""
echo -e "${YELLOW}Alternative direct connection:${NC}"
echo "  ssh -i ${KEY_PATH} ec2-user@${LOAD_TEST_IP}"
echo ""

# Check if key file exists
if [ ! -f "${KEY_PATH}" ]; then
    echo -e "${RED}Warning: SSH key file not found at ${KEY_PATH}${NC}"
    echo -e "${YELLOW}Make sure to place your ${KEY_NAME}.pem key file at the correct location.${NC}"
fi 