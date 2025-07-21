#!/bin/bash
set -euo pipefail

# AWS Infrastructure Deployment Script (CDK Only)
# Deploys EC2 instances and infrastructure WITHOUT RedPanda installation

echo "=== AWS Infrastructure Deployment (CDK Only) ==="

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
KEY_PAIR_NAME="${KEY_PAIR_NAME:-john.davis}"
STACK_PREFIX="${STACK_PREFIX:-ShastaCdk}"

# CDK Stack Names
L1_STACK="${STACK_PREFIX}StackL1"
REDPANDA_STACK="${STACK_PREFIX}RedPandaCluster"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install AWS CLI."
        exit 1
    fi
    
    # Check CDK
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK not found. Please install AWS CDK: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured. Please run 'aws configure'."
        exit 1
    fi
    
    # Check key pair exists
    if ! aws ec2 describe-key-pairs --key-names "$KEY_PAIR_NAME" --region "$AWS_REGION" &> /dev/null; then
        log_error "Key pair '$KEY_PAIR_NAME' not found in region $AWS_REGION."
        log_info "Please create the key pair or update the KEY_PAIR_NAME variable."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Function to bootstrap CDK (if needed)
bootstrap_cdk() {
    log_info "Checking CDK bootstrap status..."
    
    local account_id=$(aws sts get-caller-identity --query Account --output text)
    
    if ! aws cloudformation describe-stacks --stack-name "CDKToolkit" --region "$AWS_REGION" &> /dev/null; then
        log_info "Bootstrapping CDK for account $account_id in region $AWS_REGION..."
        cdk bootstrap "aws://$account_id/$AWS_REGION"
        log_success "CDK bootstrap completed"
    else
        log_info "CDK already bootstrapped"
    fi
}

# Function to deploy infrastructure only
deploy_infrastructure() {
    log_info "Deploying infrastructure (EC2 instances, VPC, etc.)..."
    
    local start_time=$(date +%s)
    
    # Deploy Layer 1 (VPC, base resources)
    log_info "Deploying Layer 1 stack ($L1_STACK)..."
    if cdk deploy "$L1_STACK" --require-approval never --region "$AWS_REGION"; then
        log_success "Layer 1 stack deployed successfully"
    else
        log_error "Failed to deploy Layer 1 stack"
        return 1
    fi
    
    # Deploy RedPanda infrastructure (instances only, no RedPanda software)
    log_info "Deploying RedPanda infrastructure stack ($REDPANDA_STACK)..."
    if cdk deploy "$REDPANDA_STACK" --require-approval never --region "$AWS_REGION"; then
        log_success "RedPanda infrastructure stack deployed successfully"
    else
        log_error "Failed to deploy RedPanda infrastructure stack"
        return 1
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Infrastructure deployment completed in $((duration / 60))m $((duration % 60))s"
}

# Function to get instance information
get_instance_info() {
    log_info "Retrieving instance information..."
    
    # Get RedPanda nodes
    local redpanda_instances=$(aws ec2 describe-instances \
        --filters "Name=tag:shasta-role,Values=redpanda-node" \
                  "Name=instance-state-name,Values=running" \
        --region "$AWS_REGION" \
        --query 'Reservations[].Instances[].[InstanceId,PrivateIpAddress,PublicIpAddress,Tags[?Key==`redpanda-node-id`].Value|[0]]' \
        --output table 2>/dev/null)
    
    # Get load test instance
    local loadtest_instance=$(aws ec2 describe-instances \
        --filters "Name=tag:shasta-role,Values=load-test" \
                  "Name=instance-state-name,Values=running" \
        --region "$AWS_REGION" \
        --query 'Reservations[].Instances[].[InstanceId,PrivateIpAddress,PublicIpAddress]' \
        --output table 2>/dev/null)
    
    echo ""
    echo "RedPanda Nodes (ready for RedPanda installation):"
    echo "$redpanda_instances"
    echo ""
    echo "Load Test Instance (ready for testing tools):"
    echo "$loadtest_instance"
}

# Function to wait for instances to be ready
wait_for_instances() {
    log_info "Waiting for instances to be running..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        local running_instances=$(aws ec2 describe-instances \
            --filters "Name=tag:shasta-role,Values=redpanda-node,load-test" \
                      "Name=instance-state-name,Values=running" \
            --region "$AWS_REGION" \
            --query 'length(Reservations[].Instances[])' \
            --output text)
        
        if [ "$running_instances" -ge 4 ]; then  # 3 RedPanda + 1 load test
            log_success "All instances are running"
            break
        fi
        
        log_info "Waiting for instances... ($attempt/$max_attempts) - Found: $running_instances/4"
        sleep 30
        ((attempt++))
    done
    
    if [ $attempt -gt $max_attempts ]; then
        log_warning "Timeout waiting for all instances to be ready"
        return 1
    fi
    
    # Wait for user data scripts to complete (basic setup only)
    log_info "Waiting 2 minutes for basic system setup to complete..."
    sleep 120
}

# Function to show next steps
show_next_steps() {
    log_info "Infrastructure deployment completed!"
    echo ""
    echo "🎯 NEXT STEPS - RedPanda Installation:"
    echo "======================================"
    echo ""
    echo "1. Copy scripts to instances:"
    echo "   # Get instance IPs from output above"
    echo "   scp -i $KEY_PAIR_NAME.pem scripts/install-redpanda.sh ec2-user@<redpanda-node-ip>:"
    echo "   scp -i $KEY_PAIR_NAME.pem scripts/setup-redpanda-cluster.sh ec2-user@<redpanda-node-ip>:"
    echo ""
    echo "2. Install RedPanda on each node (run on each RedPanda instance):"
    echo "   ssh -i $KEY_PAIR_NAME.pem ec2-user@<redpanda-node-0-ip>"
    echo "   sudo ./install-redpanda.sh"
    echo "   NODE_ID=0 ./setup-redpanda-cluster.sh"
    echo ""
    echo "   ssh -i $KEY_PAIR_NAME.pem ec2-user@<redpanda-node-1-ip>"
    echo "   sudo ./install-redpanda.sh"
    echo "   NODE_ID=1 ./setup-redpanda-cluster.sh"
    echo ""
    echo "   ssh -i $KEY_PAIR_NAME.pem ec2-user@<redpanda-node-2-ip>"
    echo "   sudo ./install-redpanda.sh"
    echo "   NODE_ID=2 ./setup-redpanda-cluster.sh"
    echo ""
    echo "3. Set up load testing (run on load test instance):"
    echo "   ssh -i $KEY_PAIR_NAME.pem ec2-user@<load-test-ip>"
    echo "   # Copy and run performance test scripts"
    echo ""
    echo "4. Alternative - Use helper script:"
    echo "   ./scripts/setup-cluster-post-deploy.sh  # (run from local machine)"
    echo ""
    
    # Show instance information
    get_instance_info
}

# Function to check stack status
show_status() {
    log_info "Infrastructure Status"
    echo "===================="
    
    # Check stack status
    local l1_status=$(aws cloudformation describe-stacks --stack-name "$L1_STACK" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
    local redpanda_status=$(aws cloudformation describe-stacks --stack-name "$REDPANDA_STACK" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
    
    echo "Stack Status:"
    echo "  L1 Stack: $l1_status"
    echo "  RedPanda Infrastructure Stack: $redpanda_status"
    echo ""
    
    if [ "$redpanda_status" = "CREATE_COMPLETE" ] || [ "$redpanda_status" = "UPDATE_COMPLETE" ]; then
        get_instance_info
    fi
}

# Function to destroy infrastructure
destroy_infrastructure() {
    log_warning "Destroying infrastructure..."
    read -p "Are you sure you want to destroy all AWS resources? (yes/no): " confirm
    
    if [ "$confirm" = "yes" ]; then
        log_info "Destroying stacks..."
        
        # Destroy in reverse order
        cdk destroy "$REDPANDA_STACK" --force --region "$AWS_REGION" || log_error "Failed to destroy RedPanda infrastructure stack"
        cdk destroy "$L1_STACK" --force --region "$AWS_REGION" || log_error "Failed to destroy L1 stack"
        
        log_success "Infrastructure destruction completed"
    else
        log_info "Destruction cancelled"
    fi
}

# Function to show help
show_help() {
    cat << EOF
AWS Infrastructure Deployment Script (CDK Only)

Usage: $0 [COMMAND]

Commands:
  deploy     - Deploy EC2 instances and AWS infrastructure (NO RedPanda software)
  status     - Show current infrastructure deployment status
  destroy    - Destroy all AWS infrastructure (CAREFUL!)
  help       - Show this help message

Environment Variables:
  AWS_REGION         - AWS region (default: us-east-1)
  KEY_PAIR_NAME      - EC2 Key Pair name (default: john.davis)
  STACK_PREFIX       - CloudFormation stack prefix (default: ShastaCdk)

What gets deployed:
  ✅ VPC with public/private subnets across 3 AZs
  ✅ Security groups for RedPanda ports
  ✅ 3x EC2 instances (i4i.2xlarge) for RedPanda nodes
  ✅ 1x EC2 instance (c5n.4xlarge) for load testing
  ✅ High-performance GP3 storage
  ✅ IAM roles and SSM access
  
What does NOT get deployed:
  ❌ RedPanda software (install manually with bash scripts)
  ❌ Cluster configuration (configure manually)
  ❌ Performance testing tools (set up manually)

Examples:
  $0 deploy          # Deploy infrastructure only
  $0 status          # Check deployment status
  $0 destroy         # Destroy everything

After deployment, use the bash scripts to install RedPanda:
  ./scripts/install-redpanda.sh        # Install RedPanda binary
  ./scripts/setup-redpanda-cluster.sh  # Configure and start cluster

EOF
}

# Main execution
case "${1:-help}" in
    "deploy")
        check_prerequisites
        bootstrap_cdk
        deploy_infrastructure
        wait_for_instances
        show_next_steps
        ;;
    "status")
        check_prerequisites
        show_status
        ;;
    "destroy")
        check_prerequisites
        destroy_infrastructure
        ;;
    "help"|*)
        show_help
        ;;
esac 