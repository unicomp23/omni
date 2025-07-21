#!/bin/bash
set -euo pipefail

# AWS RedPanda Deployment and Management Script
# Automates deployment, configuration, and management of RedPanda clusters on AWS

echo "=== AWS RedPanda Deployment Script ==="

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
KEY_PAIR_NAME="${KEY_PAIR_NAME:-john.davis}"
STACK_PREFIX="${STACK_PREFIX:-ShastaCdk}"
DEPLOYMENT_TIMEOUT="${DEPLOYMENT_TIMEOUT:-1800}"  # 30 minutes

# CDK Stack Names
L1_STACK="${STACK_PREFIX}StackL1"
REDPANDA_STACK="${STACK_PREFIX}RedPandaCluster"
L2_STACK="${STACK_PREFIX}StackL2"

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

# Function to deploy infrastructure
deploy_infrastructure() {
    log_info "Deploying RedPanda infrastructure..."
    
    local start_time=$(date +%s)
    
    # Deploy Layer 1 (VPC, base resources)
    log_info "Deploying Layer 1 stack ($L1_STACK)..."
    if cdk deploy "$L1_STACK" --require-approval never --region "$AWS_REGION"; then
        log_success "Layer 1 stack deployed successfully"
    else
        log_error "Failed to deploy Layer 1 stack"
        return 1
    fi
    
    # Deploy RedPanda cluster
    log_info "Deploying RedPanda cluster stack ($REDPANDA_STACK)..."
    if cdk deploy "$REDPANDA_STACK" --require-approval never --region "$AWS_REGION"; then
        log_success "RedPanda cluster stack deployed successfully"
    else
        log_error "Failed to deploy RedPanda cluster stack"
        return 1
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Infrastructure deployment completed in $((duration / 60))m $((duration % 60))s"
}

# Function to get stack outputs
get_stack_outputs() {
    local stack_name="$1"
    
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey!=`null`].[OutputKey,OutputValue]' \
        --output table 2>/dev/null || echo "Stack outputs not available"
}

# Function to get instance information
get_instance_info() {
    log_info "Retrieving RedPanda cluster instance information..."
    
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
    
    echo "RedPanda Nodes:"
    echo "$redpanda_instances"
    echo ""
    echo "Load Test Instance:"
    echo "$loadtest_instance"
}

# Function to wait for instances to be ready
wait_for_instances() {
    log_info "Waiting for instances to be ready and user data scripts to complete..."
    
    local max_attempts=60
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
    fi
    
    # Additional wait for user data scripts
    log_info "Waiting additional 5 minutes for user data scripts to complete..."
    sleep 300
}

# Function to test cluster connectivity
test_cluster_connectivity() {
    log_info "Testing RedPanda cluster connectivity..."
    
    # Get load test instance
    local loadtest_ip=$(aws ec2 describe-instances \
        --filters "Name=tag:shasta-role,Values=load-test" \
                  "Name=instance-state-name,Values=running" \
        --region "$AWS_REGION" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text 2>/dev/null)
    
    if [ "$loadtest_ip" = "null" ] || [ -z "$loadtest_ip" ]; then
        log_warning "Load test instance not found or not ready"
        return 1
    fi
    
    log_info "Testing connectivity from load test instance ($loadtest_ip)..."
    
    # Test SSH connectivity and run cluster check
    if ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -i "${KEY_PAIR_NAME}.pem" ec2-user@"$loadtest_ip" \
        'timeout 30s bash -c "until rpk cluster info --brokers \$KAFKA_BROKERS &>/dev/null; do sleep 5; done; rpk cluster info --brokers \$KAFKA_BROKERS"' 2>/dev/null; then
        log_success "Cluster connectivity test passed"
        return 0
    else
        log_warning "Cluster connectivity test failed - cluster may still be initializing"
        return 1
    fi
}

# Function to run performance tests
run_performance_tests() {
    log_info "Running performance tests on RedPanda cluster..."
    
    local loadtest_ip=$(aws ec2 describe-instances \
        --filters "Name=tag:shasta-role,Values=load-test" \
                  "Name=instance-state-name,Values=running" \
        --region "$AWS_REGION" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text 2>/dev/null)
    
    if [ "$loadtest_ip" = "null" ] || [ -z "$loadtest_ip" ]; then
        log_error "Load test instance not found"
        return 1
    fi
    
    log_info "Running quick performance test on $loadtest_ip..."
    
    # Copy performance test script and run it
    if scp -o StrictHostKeyChecking=no -i "${KEY_PAIR_NAME}.pem" \
        scripts/redpanda-performance-tests.sh ec2-user@"$loadtest_ip":/tmp/; then
        
        ssh -o StrictHostKeyChecking=no -i "${KEY_PAIR_NAME}.pem" ec2-user@"$loadtest_ip" \
            'chmod +x /tmp/redpanda-performance-tests.sh && /tmp/redpanda-performance-tests.sh quick'
        
        log_success "Performance tests completed"
    else
        log_error "Failed to copy or run performance tests"
        return 1
    fi
}

# Function to show connection information
show_connection_info() {
    log_info "RedPanda Cluster Connection Information"
    echo "========================================"
    
    # Get stack outputs
    echo "Stack Outputs:"
    get_stack_outputs "$REDPANDA_STACK"
    echo ""
    
    # Get instance information
    get_instance_info
    echo ""
    
    # Connection examples
    local loadtest_ip=$(aws ec2 describe-instances \
        --filters "Name=tag:shasta-role,Values=load-test" \
                  "Name=instance-state-name,Values=running" \
        --region "$AWS_REGION" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text 2>/dev/null)
    
    if [ "$loadtest_ip" != "null" ] && [ -n "$loadtest_ip" ]; then
        echo "Connection Examples:"
        echo "===================="
        echo "SSH to load test instance:"
        echo "  ssh -i ${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip"
        echo ""
        echo "Run performance tests:"
        echo "  ssh -i ${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip 'cd ~/load-test-scripts && ./kafka-perf-test.sh'"
        echo ""
        echo "Check cluster status:"
        echo "  ssh -i ${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip 'rpk cluster info --brokers \$KAFKA_BROKERS'"
    fi
    
    # SSM connection info
    echo "SSM Session Manager (no key required):"
    local instance_ids=$(aws ec2 describe-instances \
        --filters "Name=tag:shasta-role,Values=redpanda-node,load-test" \
                  "Name=instance-state-name,Values=running" \
        --region "$AWS_REGION" \
        --query 'Reservations[].Instances[].InstanceId' \
        --output text)
    
    echo "Available instances for SSM:"
    for instance_id in $instance_ids; do
        echo "  aws ssm start-session --target $instance_id --region $AWS_REGION"
    done
}

# Function to destroy infrastructure
destroy_infrastructure() {
    log_warning "Destroying RedPanda infrastructure..."
    read -p "Are you sure you want to destroy all resources? (yes/no): " confirm
    
    if [ "$confirm" = "yes" ]; then
        log_info "Destroying stacks..."
        
        # Destroy in reverse order
        cdk destroy "$L2_STACK" --force --region "$AWS_REGION" 2>/dev/null || true
        cdk destroy "$REDPANDA_STACK" --force --region "$AWS_REGION" || log_error "Failed to destroy RedPanda stack"
        cdk destroy "$L1_STACK" --force --region "$AWS_REGION" || log_error "Failed to destroy L1 stack"
        
        log_success "Infrastructure destruction completed"
    else
        log_info "Destruction cancelled"
    fi
}

# Function to show status
show_status() {
    log_info "RedPanda Cluster Status"
    echo "======================="
    
    # Check stack status
    local l1_status=$(aws cloudformation describe-stacks --stack-name "$L1_STACK" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
    local redpanda_status=$(aws cloudformation describe-stacks --stack-name "$REDPANDA_STACK" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
    
    echo "Stack Status:"
    echo "  L1 Stack: $l1_status"
    echo "  RedPanda Stack: $redpanda_status"
    echo ""
    
    if [ "$redpanda_status" = "CREATE_COMPLETE" ] || [ "$redpanda_status" = "UPDATE_COMPLETE" ]; then
        get_instance_info
    fi
}

# Function to show help
show_help() {
    cat << EOF
AWS RedPanda Deployment Script

Usage: $0 [COMMAND]

Commands:
  deploy     - Deploy the complete RedPanda infrastructure
  status     - Show current deployment status
  info       - Show connection information
  test       - Run performance tests
  destroy    - Destroy all infrastructure (CAREFUL!)
  help       - Show this help message

Environment Variables:
  AWS_REGION         - AWS region (default: us-east-1)
  KEY_PAIR_NAME      - EC2 Key Pair name (default: john.davis)
  STACK_PREFIX       - CloudFormation stack prefix (default: ShastaCdk)
  DEPLOYMENT_TIMEOUT - Deployment timeout in seconds (default: 1800)

Examples:
  $0 deploy          # Deploy infrastructure
  $0 status          # Check status
  $0 test            # Run performance tests
  $0 info            # Show connection details
  $0 destroy         # Destroy everything

EOF
}

# Main execution
case "${1:-help}" in
    "deploy")
        check_prerequisites
        bootstrap_cdk
        deploy_infrastructure
        wait_for_instances
        show_connection_info
        if test_cluster_connectivity; then
            log_success "Deployment completed successfully! Cluster is ready."
        else
            log_warning "Deployment completed but cluster connectivity test failed."
            log_info "The cluster may still be initializing. Please wait a few more minutes."
        fi
        ;;
    "status")
        check_prerequisites
        show_status
        ;;
    "info")
        check_prerequisites
        show_connection_info
        ;;
    "test")
        check_prerequisites
        run_performance_tests
        ;;
    "destroy")
        check_prerequisites
        destroy_infrastructure
        ;;
    "help"|*)
        show_help
        ;;
esac 