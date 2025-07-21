#!/bin/bash
set -euo pipefail

# Post-Deployment Cluster Setup Script
# Automates RedPanda installation on already-deployed AWS infrastructure

echo "=== Post-Deployment RedPanda Cluster Setup ==="

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
KEY_PAIR_NAME="${KEY_PAIR_NAME:-john.davis}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if [[ ! -f "${KEY_PAIR_NAME}.pem" ]]; then
        log_error "Key pair file '${KEY_PAIR_NAME}.pem' not found in current directory"
        log_info "Please copy your key pair file here or update KEY_PAIR_NAME variable"
        exit 1
    fi
    
    chmod 400 "${KEY_PAIR_NAME}.pem"
    
    if [[ ! -f "scripts/install-redpanda.sh" ]] || [[ ! -f "scripts/setup-redpanda-cluster.sh" ]]; then
        log_error "Required scripts not found. Please ensure you're in the project root with scripts/ directory"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Function to get instance information
get_instances() {
    log_info "Retrieving instance information..."
    
    # Get RedPanda node IPs and IDs
    REDPANDA_INSTANCES=$(aws ec2 describe-instances \
        --filters "Name=tag:shasta-role,Values=redpanda-node" \
                  "Name=instance-state-name,Values=running" \
        --region "$AWS_REGION" \
        --query 'Reservations[].Instances[].[Tags[?Key==`redpanda-node-id`].Value|[0],PrivateIpAddress,PublicIpAddress]' \
        --output text 2>/dev/null)
    
    # Get load test instance IP
    LOADTEST_IP=$(aws ec2 describe-instances \
        --filters "Name=tag:shasta-role,Values=load-test" \
                  "Name=instance-state-name,Values=running" \
        --region "$AWS_REGION" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text 2>/dev/null)
    
    if [[ -z "$REDPANDA_INSTANCES" ]]; then
        log_error "No RedPanda instances found. Please deploy infrastructure first."
        exit 1
    fi
    
    if [[ -z "$LOADTEST_IP" ]] || [[ "$LOADTEST_IP" == "null" ]]; then
        log_error "Load test instance not found. Please deploy infrastructure first."
        exit 1
    fi
    
    log_success "Found instances ready for setup"
}

# Function to copy scripts to an instance
copy_scripts_to_instance() {
    local instance_ip="$1"
    local instance_type="$2"
    
    log_info "Copying scripts to $instance_type ($instance_ip)..."
    
    if scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "${KEY_PAIR_NAME}.pem" \
        scripts/install-redpanda.sh \
        scripts/setup-redpanda-cluster.sh \
        ec2-user@"$instance_ip":~/; then
        log_success "Scripts copied to $instance_type"
        return 0
    else
        log_error "Failed to copy scripts to $instance_type"
        return 1
    fi
}

# Function to run RedPanda installation on a node
install_redpanda_on_node() {
    local node_id="$1"
    local private_ip="$2"
    local public_ip="$3"
    
    # Use public IP if available, otherwise private IP (for VPC access)
    local target_ip="${public_ip:-$private_ip}"
    
    log_info "Installing RedPanda on node $node_id ($target_ip)..."
    
    # Copy scripts
    if ! copy_scripts_to_instance "$target_ip" "RedPanda node $node_id"; then
        return 1
    fi
    
    # Install RedPanda
    log_info "Running RedPanda installation on node $node_id..."
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "${KEY_PAIR_NAME}.pem" ec2-user@"$target_ip" \
        'chmod +x ~/install-redpanda.sh ~/setup-redpanda-cluster.sh && sudo ~/install-redpanda.sh'; then
        log_success "RedPanda installed on node $node_id"
    else
        log_error "Failed to install RedPanda on node $node_id"
        return 1
    fi
    
    # Configure cluster
    log_info "Configuring RedPanda cluster on node $node_id..."
    if ssh -o StrictHostKeyChecking=no -i "${KEY_PAIR_NAME}.pem" ec2-user@"$target_ip" \
        "NODE_ID=$node_id ~/setup-redpanda-cluster.sh"; then
        log_success "RedPanda configured on node $node_id"
    else
        log_error "Failed to configure RedPanda on node $node_id"
        return 1
    fi
}

# Function to set up load testing instance
setup_load_testing() {
    log_info "Setting up load testing instance ($LOADTEST_IP)..."
    
    # Copy performance test script
    if scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "${KEY_PAIR_NAME}.pem" \
        scripts/redpanda-performance-tests.sh \
        ec2-user@"$LOADTEST_IP":~/; then
        log_success "Performance test script copied to load test instance"
    else
        log_error "Failed to copy performance test script"
        return 1
    fi
    
    # Get RedPanda IPs for broker configuration
    local redpanda_ips=$(echo "$REDPANDA_INSTANCES" | awk '{print $2}' | paste -sd ',')
    local bootstrap_brokers="${redpanda_ips//,/:9092,}:9092"
    
    # Set up environment and test cluster connectivity
    log_info "Configuring load test environment..."
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "${KEY_PAIR_NAME}.pem" ec2-user@"$LOADTEST_IP" \
        "chmod +x ~/redpanda-performance-tests.sh && echo 'export BOOTSTRAP_SERVERS=\"$bootstrap_brokers\"' >> ~/.bashrc"; then
        log_success "Load test instance configured"
    else
        log_error "Failed to configure load test instance"
        return 1
    fi
}

# Function to verify cluster health
verify_cluster() {
    log_info "Verifying RedPanda cluster health..."
    
    # Test from load test instance
    local redpanda_ips=$(echo "$REDPANDA_INSTANCES" | awk '{print $2}' | paste -sd ',')
    local bootstrap_brokers="${redpanda_ips//,/:9092,}:9092"
    
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "${KEY_PAIR_NAME}.pem" ec2-user@"$LOADTEST_IP" \
        "timeout 60s bash -c 'until rpk cluster info --brokers $bootstrap_brokers &>/dev/null; do sleep 5; echo Waiting for cluster...; done; rpk cluster info --brokers $bootstrap_brokers'"; then
        log_success "RedPanda cluster is healthy and ready!"
        return 0
    else
        log_warning "Cluster verification failed - cluster may still be initializing"
        return 1
    fi
}

# Function to show usage instructions
show_usage() {
    log_info "RedPanda Cluster Setup Complete!"
    echo ""
    echo "🎯 ACCESS INSTRUCTIONS:"
    echo "======================="
    echo ""
    echo "SSH Access:"
    
    # Show RedPanda node access
    while IFS=$'\t' read -r node_id private_ip public_ip; do
        local target_ip="${public_ip:-$private_ip}"
        echo "  RedPanda Node $node_id: ssh -i ${KEY_PAIR_NAME}.pem ec2-user@$target_ip"
    done <<< "$REDPANDA_INSTANCES"
    
    echo "  Load Test Instance:   ssh -i ${KEY_PAIR_NAME}.pem ec2-user@$LOADTEST_IP"
    echo ""
    
    echo "Quick Commands:"
    echo "  # Check cluster status"
    echo "  ssh -i ${KEY_PAIR_NAME}.pem ec2-user@$LOADTEST_IP 'rpk cluster info --brokers \$BOOTSTRAP_SERVERS'"
    echo ""
    echo "  # Run performance tests"
    echo "  ssh -i ${KEY_PAIR_NAME}.pem ec2-user@$LOADTEST_IP './redpanda-performance-tests.sh quick'"
    echo ""
    echo "  # List topics"
    echo "  ssh -i ${KEY_PAIR_NAME}.pem ec2-user@$LOADTEST_IP 'rpk topic list --brokers \$BOOTSTRAP_SERVERS'"
}

# Function to run a quick test
run_quick_test() {
    log_info "Running quick performance test..."
    
    local redpanda_ips=$(echo "$REDPANDA_INSTANCES" | awk '{print $2}' | paste -sd ',')
    local bootstrap_brokers="${redpanda_ips//,/:9092,}:9092"
    
    if ssh -o StrictHostKeyChecking=no -i "${KEY_PAIR_NAME}.pem" ec2-user@"$LOADTEST_IP" \
        "BOOTSTRAP_SERVERS=\"$bootstrap_brokers\" ./redpanda-performance-tests.sh quick"; then
        log_success "Quick performance test completed!"
    else
        log_warning "Performance test failed - cluster may still be initializing"
    fi
}

# Main execution
main() {
    local start_time=$(date +%s)
    
    check_prerequisites
    get_instances
    
    log_info "Starting RedPanda installation on all nodes..."
    
    # Install RedPanda on each node
    local install_failed=false
    while IFS=$'\t' read -r node_id private_ip public_ip; do
        if ! install_redpanda_on_node "$node_id" "$private_ip" "$public_ip"; then
            install_failed=true
        fi
    done <<< "$REDPANDA_INSTANCES"
    
    if [[ "$install_failed" == "true" ]]; then
        log_error "Some RedPanda installations failed. Please check the logs above."
        exit 1
    fi
    
    # Set up load testing
    setup_load_testing
    
    # Wait for cluster to stabilize
    log_info "Waiting 30 seconds for cluster to stabilize..."
    sleep 30
    
    # Verify cluster
    if verify_cluster; then
        run_quick_test
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "RedPanda cluster setup completed in $((duration / 60))m $((duration % 60))s"
    
    show_usage
}

# Show help
show_help() {
    cat << EOF
Post-Deployment RedPanda Cluster Setup Script

Usage: $0

This script automates RedPanda installation after AWS infrastructure deployment.

Prerequisites:
  ✅ AWS infrastructure must be already deployed (run aws-infrastructure-deploy.sh first)
  ✅ ${KEY_PAIR_NAME}.pem key file must be in current directory
  ✅ scripts/install-redpanda.sh and setup-redpanda-cluster.sh must exist

What this script does:
  1. Finds deployed RedPanda and load test instances
  2. Copies installation scripts to each instance
  3. Installs RedPanda on all nodes (via install-redpanda.sh)
  4. Configures 3-node cluster (via setup-redpanda-cluster.sh)
  5. Sets up load testing environment
  6. Verifies cluster health
  7. Runs quick performance test

Environment Variables:
  AWS_REGION=${AWS_REGION}
  KEY_PAIR_NAME=${KEY_PAIR_NAME}

Example:
  # First deploy infrastructure
  ./scripts/aws-infrastructure-deploy.sh deploy
  
  # Then run this script
  ./scripts/setup-cluster-post-deploy.sh

EOF
}

case "${1:-run}" in
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        main
        ;;
esac 