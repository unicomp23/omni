#!/bin/bash
set -euo pipefail

# Fully Automated RedPanda Cluster Setup Script
# Handles private subnet architecture using bastion host approach

echo "=== Fully Automated RedPanda Cluster Setup ==="

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
KEY_PAIR_NAME="${KEY_PAIR_NAME:-john.davis}"
KEY_PAIR_PATH="${KEY_PAIR_PATH:-/data/.ssh/john.davis.pem}"
STACK_NAME="${STACK_NAME:-RedPandaClusterStack}"

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
    
    if [[ ! -f "$KEY_PAIR_PATH" ]]; then
        log_error "Key pair file '$KEY_PAIR_PATH' not found"
        log_info "Please set KEY_PAIR_PATH environment variable or ensure ${KEY_PAIR_NAME}.pem exists"
        exit 1
    fi
    
    chmod 400 "$KEY_PAIR_PATH"
    
    if ! aws sts get-caller-identity &>/dev/null; then
        log_error "AWS credentials not configured. Please configure AWS credentials"
        exit 1
    fi
    
    if [[ ! -f "scripts/install-redpanda.sh" ]] || [[ ! -f "scripts/setup-redpanda-cluster.sh" ]]; then
        log_error "Required scripts not found. Please ensure you're in the project root with scripts/ directory"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Function to get deployment information from AWS
get_deployment_info() {
    log_info "Retrieving deployment information from AWS..."
    
    # Get stack outputs
    LOADTEST_IP=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" --query 'Stacks[0].Outputs[?OutputKey==`LoadTestInstanceIP`].OutputValue' --output text 2>/dev/null || echo "")
    BOOTSTRAP_BROKERS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" --query 'Stacks[0].Outputs[?OutputKey==`RedPandaBootstrapBrokers`].OutputValue' --output text 2>/dev/null || echo "")
    REDPANDA_IPS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" --query 'Stacks[0].Outputs[?OutputKey==`RedPandaClusterIPs`].OutputValue' --output text 2>/dev/null || echo "")
    
    if [[ -z "$LOADTEST_IP" ]] || [[ "$LOADTEST_IP" == "null" ]]; then
        log_error "Load test instance not found. Please ensure RedPandaClusterStack is deployed"
        exit 1
    fi
    
    if [[ -z "$REDPANDA_IPS" ]]; then
        log_error "RedPanda cluster IPs not found. Please ensure RedPandaClusterStack is deployed"
        exit 1
    fi
    
    # Convert comma-separated IPs to array
    IFS=',' read -ra REDPANDA_IP_ARRAY <<< "$REDPANDA_IPS"
    
    log_success "Found deployment info:"
    log_info "  Load test instance: $LOADTEST_IP"
    log_info "  RedPanda nodes: $REDPANDA_IPS"
    log_info "  Bootstrap brokers: $BOOTSTRAP_BROKERS"
}

# Function to wait for instances to be ready
wait_for_instances() {
    log_info "Waiting for instances to be ready..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP" "echo 'ready'" &>/dev/null; then
            log_success "Load test instance is ready"
            break
        fi
        log_info "Waiting for load test instance... (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done
    
    if [ $attempt -gt $max_attempts ]; then
        log_error "Load test instance not ready after $max_attempts attempts"
        exit 1
    fi
    
    # Wait a bit more for user data scripts to complete
    log_info "Waiting additional 60 seconds for user data scripts to complete..."
    sleep 60
}

# Function to setup bastion host
setup_bastion_host() {
    log_info "Setting up bastion host (load test instance)..."
    
    # Copy key file to bastion host with proper permissions
    log_info "Copying SSH key to bastion host..."
    # Copy to tmp first to avoid permission issues, then move with correct permissions
    scp -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP":/tmp/redpanda-key.pem
    ssh -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP" "mv /tmp/redpanda-key.pem ~/redpanda-key.pem && chmod 400 ~/redpanda-key.pem"
    
    # Copy all scripts to bastion host
    log_info "Copying RedPanda scripts to bastion host..."
    scp -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" \
        scripts/install-redpanda.sh \
        scripts/setup-redpanda-cluster.sh \
        scripts/redpanda-performance-tests.sh \
        ec2-user@"$LOADTEST_IP":~/
    
    # Set up bastion host environment
    log_info "Configuring bastion host environment..."
    ssh -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP" << EOF
# Make scripts executable
chmod +x ~/*.sh

# Add environment variables
cat >> ~/.bashrc << 'BASHRC_EOF'

# RedPanda Environment
export REDPANDA_IPS="$REDPANDA_IPS"
export BOOTSTRAP_SERVERS="$BOOTSTRAP_BROKERS"
export KAFKA_BROKERS="$BOOTSTRAP_BROKERS"
BASHRC_EOF

# Source the environment
source ~/.bashrc || true

echo "Bastion host setup completed"
EOF
    
    log_success "Bastion host setup completed"
}

# Function to install RedPanda on each node via bastion
install_redpanda_cluster() {
    log_info "Installing RedPanda on all cluster nodes..."
    
    local node_id=0
    local failed_nodes=()
    
    for redpanda_ip in "${REDPANDA_IP_ARRAY[@]}"; do
        log_info "Installing RedPanda on node $node_id ($redpanda_ip)..."
        
        # Retry mechanism for installation
        local max_retries=3
        local retry=1
        local success=false
        
        while [ $retry -le $max_retries ] && [ "$success" = "false" ]; do
            log_info "Attempt $retry/$max_retries for node $node_id..."
            
            # Execute installation via bastion host
            if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 -i "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP" << EOF
set -euo pipefail

echo "=== Installing RedPanda on Node $node_id ($redpanda_ip) ==="

# Wait for node to be ready
echo "Waiting for RedPanda node to be ready..."
for i in {1..12}; do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i ~/redpanda-key.pem ec2-user@$redpanda_ip "echo 'ready'" &>/dev/null; then
        echo "Node $node_id is ready"
        break
    fi
    echo "Waiting... (\$i/12)"
    sleep 10
done

# Copy scripts to RedPanda node
echo "Copying scripts to RedPanda node..."
if ! scp -o StrictHostKeyChecking=no -o ConnectTimeout=30 -i ~/redpanda-key.pem \
    install-redpanda.sh setup-redpanda-cluster.sh \
    ec2-user@$redpanda_ip:~/; then
    echo "Failed to copy scripts"
    exit 1
fi

# Install RedPanda binary
echo "Installing RedPanda binary..."
if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=60 -i ~/redpanda-key.pem ec2-user@$redpanda_ip \
    'chmod +x ~/install-redpanda.sh ~/setup-redpanda-cluster.sh && sudo ~/install-redpanda.sh'; then
    echo "Failed to install RedPanda binary"
    exit 1
fi

# Configure RedPanda cluster
echo "Configuring RedPanda cluster..."
if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=60 -i ~/redpanda-key.pem ec2-user@$redpanda_ip \
    "NODE_ID=$node_id CLUSTER_SIZE=3 ~/setup-redpanda-cluster.sh"; then
    echo "Failed to configure RedPanda cluster"
    exit 1
fi

echo "Node $node_id installation completed successfully"
EOF
            then
                log_success "RedPanda installed and configured on node $node_id"
                success=true
            else
                log_warning "Attempt $retry failed for node $node_id"
                ((retry++))
                if [ $retry -le $max_retries ]; then
                    log_info "Retrying in 30 seconds..."
                    sleep 30
                fi
            fi
        done
        
        if [ "$success" = "false" ]; then
            log_error "Failed to install RedPanda on node $node_id after $max_retries attempts"
            failed_nodes+=("$node_id")
        fi
        
        ((node_id++))
        sleep 5  # Brief pause between nodes
    done
    
    if [ ${#failed_nodes[@]} -eq 0 ]; then
        log_success "RedPanda installation completed on all nodes"
        return 0
    else
        log_error "RedPanda installation failed on nodes: ${failed_nodes[*]}"
        log_warning "Continuing with available nodes..."
        return 1
    fi
}

# Function to setup load test environment
setup_load_test_environment() {
    log_info "Setting up load test environment..."
    
    # Set up environment directly with proper variable expansion
    ssh -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP" \
        "chmod +x ~/redpanda-performance-tests.sh && \
         echo 'export BOOTSTRAP_SERVERS=\"$BOOTSTRAP_BROKERS\"' >> ~/.bashrc && \
         echo 'export KAFKA_BROKERS=\"$BOOTSTRAP_BROKERS\"' >> ~/.bashrc"
    
    log_success "Load test environment configured"
}

# Function to verify cluster health
verify_cluster_health() {
    log_info "Verifying RedPanda cluster health..."
    
    local max_attempts=20
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if ssh -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP" \
            "timeout 30s rpk cluster info --brokers $BOOTSTRAP_BROKERS" &>/dev/null; then
            log_success "RedPanda cluster is healthy!"
            break
        fi
        
        log_info "Waiting for cluster to be ready... (attempt $attempt/$max_attempts)"
        sleep 15
        ((attempt++))
    done
    
    if [ $attempt -gt $max_attempts ]; then
        log_warning "Cluster health verification failed - cluster may still be initializing"
        return 1
    fi
    
    # Show cluster information
    log_info "Cluster information:"
    ssh -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP" \
        "rpk cluster info --brokers $BOOTSTRAP_BROKERS"
    
    return 0
}

# Function to run quick performance test
run_quick_test() {
    log_info "Running quick performance test..."
    
    if ssh -o StrictHostKeyChecking=no -i "$KEY_PAIR_PATH" ec2-user@"$LOADTEST_IP" \
        "BOOTSTRAP_SERVERS=$BOOTSTRAP_BROKERS ./redpanda-performance-tests.sh quick"; then
        log_success "Quick performance test completed successfully!"
    else
        log_warning "Performance test failed - cluster may still be stabilizing"
    fi
}

# Function to show usage information
show_usage_info() {
    log_success "🎉 RedPanda Cluster Setup Completed!"
    echo ""
    echo "📋 Cluster Information:"
    echo "======================="
    echo "Load Test Instance:  $LOADTEST_IP"
    echo "RedPanda Nodes:      $REDPANDA_IPS"
    echo "Bootstrap Brokers:   $BOOTSTRAP_BROKERS"
    echo ""
    echo "🔗 Access Instructions:"
    echo "======================"
    echo "# Connect to load test instance:"
    echo "ssh -i $KEY_PAIR_PATH ec2-user@$LOADTEST_IP"
    echo ""
    echo "# Connect to RedPanda nodes (via bastion):"
    for i in "${!REDPANDA_IP_ARRAY[@]}"; do
        echo "ssh -i $KEY_PAIR_PATH ec2-user@$LOADTEST_IP 'ssh -i ~/redpanda-key.pem ec2-user@${REDPANDA_IP_ARRAY[i]}'"
    done
    echo ""
    echo "🧪 Quick Commands:"
    echo "================="
    echo "# Check cluster status:"
    echo "ssh -i $KEY_PAIR_PATH ec2-user@$LOADTEST_IP 'rpk cluster info --brokers \$BOOTSTRAP_SERVERS'"
    echo ""
    echo "# Run performance tests:"
    echo "ssh -i $KEY_PAIR_PATH ec2-user@$LOADTEST_IP './redpanda-performance-tests.sh quick'"
    echo "ssh -i $KEY_PAIR_PATH ec2-user@$LOADTEST_IP './redpanda-performance-tests.sh all'"
    echo ""
    echo "# List topics:"
    echo "ssh -i $KEY_PAIR_PATH ec2-user@$LOADTEST_IP 'rpk topic list --brokers \$BOOTSTRAP_SERVERS'"
}

# Main execution
main() {
    local start_time=$(date +%s)
    
    check_prerequisites
    get_deployment_info
    wait_for_instances
    setup_bastion_host
    
    # Try to install RedPanda on all nodes, but continue even if some fail
    local install_success=true
    if ! install_redpanda_cluster; then
        log_warning "Some RedPanda nodes failed to install, continuing with available nodes..."
        install_success=false
    fi
    
    setup_load_test_environment
    
    # Wait for cluster to stabilize
    log_info "Waiting 90 seconds for cluster to stabilize..."
    sleep 90
    
    # Try cluster health check with longer timeout for partial deployments
    local cluster_ready=false
    if verify_cluster_health; then
        cluster_ready=true
        run_quick_test
    else
        log_warning "Full cluster verification failed, but partial cluster may be functional"
        log_info "You can manually check cluster status using provided commands"
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    if [ "$install_success" = "true" ] && [ "$cluster_ready" = "true" ]; then
        log_success "✅ RedPanda cluster setup completed successfully in $((duration / 60))m $((duration % 60))s"
    elif [ "$install_success" = "true" ]; then
        log_warning "⚠️  RedPanda cluster setup completed with warnings in $((duration / 60))m $((duration % 60))s"
        log_info "Cluster may need additional time to stabilize"
    else
        log_warning "⚠️  RedPanda cluster setup completed with errors in $((duration / 60))m $((duration % 60))s"
        log_info "Some nodes failed, but partial cluster may be functional"
    fi
    
    show_usage_info
}

# Run main function
main "$@" 