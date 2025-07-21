#!/bin/bash

# Redpanda Cluster Deployment Script
# This script deploys a Redpanda cluster using AWS CDK and sets up testing infrastructure

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
STACK_NAME="ShastaRedpandaStack"
REGION="us-east-1"
KEY_PAIR_NAME="john.davis"

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🚀 REDPANDA CLUSTER DEPLOYMENT${NC}"
echo -e "${BLUE}===========================================${NC}"
echo

# Function to print colored messages
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install AWS CLI first."
        exit 1
    fi
    
    # Check CDK CLI
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK CLI not found. Please install CDK first: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured. Run 'aws configure' first."
        exit 1
    fi
    
    # Check key pair exists
    if ! aws ec2 describe-key-pairs --key-names "$KEY_PAIR_NAME" --region "$REGION" &> /dev/null; then
        log_warning "Key pair '$KEY_PAIR_NAME' not found in region '$REGION'"
        log_info "Creating key pair '$KEY_PAIR_NAME'..."
        aws ec2 create-key-pair --key-name "$KEY_PAIR_NAME" --region "$REGION" --query 'KeyMaterial' --output text > ~/.ssh/${KEY_PAIR_NAME}.pem
        chmod 400 ~/.ssh/${KEY_PAIR_NAME}.pem
        log_success "Key pair created and saved to ~/.ssh/${KEY_PAIR_NAME}.pem"
    else
        log_success "Key pair '$KEY_PAIR_NAME' exists"
    fi
    
    log_success "All prerequisites met"
    echo
}

# Function to bootstrap CDK if needed
bootstrap_cdk() {
    log_info "Checking CDK bootstrap status..."
    
    # Check if bootstrap stack exists
    if aws cloudformation describe-stacks --stack-name "CDKToolkit" --region "$REGION" &> /dev/null; then
        log_success "CDK already bootstrapped"
    else
        log_info "Bootstrapping CDK..."
        cdk bootstrap --region "$REGION"
        log_success "CDK bootstrap completed"
    fi
    echo
}

# Function to install dependencies
install_dependencies() {
    log_info "Installing Node.js dependencies..."
    npm install
    log_success "Dependencies installed"
    echo
}

# Function to deploy the CDK stack
deploy_stack() {
    log_info "Deploying Redpanda CDK stack..."
    log_info "This will take 10-15 minutes to create all resources..."
    
    # Deploy with progress tracking
    if cdk deploy "$STACK_NAME" --require-approval never --progress events; then
        log_success "CDK stack deployment completed!"
    else
        log_error "CDK stack deployment failed!"
        exit 1
    fi
    echo
}

# Function to get stack outputs
get_stack_outputs() {
    log_info "Getting stack outputs..."
    
    # Get stack outputs
    OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].Outputs')
    
    if [[ "$OUTPUTS" != "null" ]]; then
        echo "$OUTPUTS" | jq -r '.[] | "export \(.OutputKey)=\(.OutputValue)"' > .env
        log_success "Stack outputs saved to .env file"
        
        # Display key outputs
        echo -e "${BLUE}Key Stack Outputs:${NC}"
        echo "$OUTPUTS" | jq -r '.[] | "\(.OutputKey): \(.OutputValue)"'
        echo
    else
        log_warning "No stack outputs found"
    fi
}

# Function to wait for instances to be ready
wait_for_instances() {
    log_info "Waiting for EC2 instances to be ready..."
    
    # Wait for broker instances
    log_info "Checking broker instances..."
    local broker_ready=false
    local attempts=0
    local max_attempts=30
    
    while [[ $attempts -lt $max_attempts ]]; do
        local running_brokers=$(aws ec2 describe-instances \
            --region "$REGION" \
            --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaBroker*" \
                     "Name=instance-state-name,Values=running" \
            --query 'Reservations[].Instances[].InstanceId' \
            --output text | wc -w)
        
        if [[ $running_brokers -eq 3 ]]; then
            log_success "All 3 broker instances are running"
            broker_ready=true
            break
        else
            log_info "Broker instances running: $running_brokers/3 (attempt $((attempts+1))/$max_attempts)"
            sleep 30
            ((attempts++))
        fi
    done
    
    if [[ $broker_ready != true ]]; then
        log_error "Broker instances failed to start within expected time"
        exit 1
    fi
    
    # Wait for load test instance
    log_info "Checking load test instance..."
    local loadtest_ready=false
    attempts=0
    
    while [[ $attempts -lt $max_attempts ]]; do
        local running_loadtest=$(aws ec2 describe-instances \
            --region "$REGION" \
            --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaLoadTest" \
                     "Name=instance-state-name,Values=running" \
            --query 'Reservations[].Instances[].InstanceId' \
            --output text | wc -w)
        
        if [[ $running_loadtest -eq 1 ]]; then
            log_success "Load test instance is running"
            loadtest_ready=true
            break
        else
            log_info "Load test instance not ready (attempt $((attempts+1))/$max_attempts)"
            sleep 30
            ((attempts++))
        fi
    done
    
    if [[ $loadtest_ready != true ]]; then
        log_error "Load test instance failed to start within expected time"
        exit 1
    fi
    
    echo
}

# Function to wait for Redpanda cluster to be ready
wait_for_redpanda_cluster() {
    log_info "Waiting for Redpanda cluster to be ready..."
    log_info "This may take 5-10 minutes for all brokers to join the cluster..."
    
    # Get load test instance IP
    local loadtest_ip=$(aws ec2 describe-instances \
        --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaLoadTest" \
                 "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].PublicIpAddress' \
        --output text)
    
    if [[ -z "$loadtest_ip" || "$loadtest_ip" == "None" ]]; then
        log_error "Could not get load test instance IP"
        exit 1
    fi
    
    log_info "Load test instance IP: $loadtest_ip"
    
    # Wait for SSH to be available
    log_info "Waiting for SSH access..."
    local ssh_ready=false
    local attempts=0
    local max_attempts=20
    
    while [[ $attempts -lt $max_attempts ]]; do
        if timeout 10 ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip "echo 'SSH ready'" &> /dev/null; then
            log_success "SSH access to load test instance ready"
            ssh_ready=true
            break
        else
            log_info "Waiting for SSH access (attempt $((attempts+1))/$max_attempts)"
            sleep 30
            ((attempts++))
        fi
    done
    
    if [[ $ssh_ready != true ]]; then
        log_error "SSH access to load test instance not available"
        exit 1
    fi
    
    # Wait for Redpanda cluster to be ready
    log_info "Testing Redpanda cluster readiness..."
    local cluster_ready=false
    attempts=0
    max_attempts=20
    
    while [[ $attempts -lt $max_attempts ]]; do
        if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
            "source ~/.bashrc && timeout 30 ./quick_test.sh" &> /dev/null; then
            log_success "Redpanda cluster is ready!"
            cluster_ready=true
            break
        else
            log_info "Waiting for Redpanda cluster (attempt $((attempts+1))/$max_attempts)"
            sleep 60
            ((attempts++))
        fi
    done
    
    if [[ $cluster_ready != true ]]; then
        log_warning "Cluster readiness test failed, but deployment may still be successful"
        log_info "You can manually test the cluster later using: ./test-redpanda-cluster.sh"
    fi
    
    echo
}

# Function to display connection information
display_connection_info() {
    log_success "Deployment completed successfully!"
    echo
    echo -e "${BLUE}===========================================${NC}"
    echo -e "${BLUE}🔗 CONNECTION INFORMATION${NC}"
    echo -e "${BLUE}===========================================${NC}"
    
    # Get instance IPs
    local loadtest_ip=$(aws ec2 describe-instances \
        --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaLoadTest" \
                 "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].PublicIpAddress' \
        --output text)
    
    local broker_ips=$(aws ec2 describe-instances \
        --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaBroker*" \
                 "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].PrivateIpAddress' \
        --output text | tr '\n' ',' | sed 's/,$//')
    
    echo -e "${GREEN}Load Test Instance:${NC}"
    echo "  Public IP: $loadtest_ip"
    echo "  SSH: ssh -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip"
    echo
    
    echo -e "${GREEN}Redpanda Brokers:${NC}"
    echo "  Private IPs: $broker_ips"
    echo "  Access via load test instance or SSM Session Manager"
    echo
    
    echo -e "${GREEN}Next Steps:${NC}"
    echo "1. Test the cluster: ./test-redpanda-cluster.sh"
    echo "2. Connect to load test instance:"
    echo "   ssh -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip"
    echo "3. Run cluster validation:"
    echo "   ./quick_test.sh"
    echo "4. When done, cleanup: ./cleanup-redpanda.sh"
    echo
}

# Main deployment function
main() {
    echo -e "${GREEN}Starting Redpanda cluster deployment...${NC}"
    echo "Stack: $STACK_NAME"
    echo "Region: $REGION"
    echo "Key Pair: $KEY_PAIR_NAME"
    echo
    
    check_prerequisites
    bootstrap_cdk
    install_dependencies
    deploy_stack
    get_stack_outputs
    wait_for_instances
    wait_for_redpanda_cluster
    display_connection_info
    
    log_success "🎉 Redpanda cluster deployment completed successfully!"
    log_info "Total deployment time: $(date)"
}

# Handle script interruption
trap 'log_error "Deployment interrupted"; exit 1' INT

# Run main function
main "$@" 