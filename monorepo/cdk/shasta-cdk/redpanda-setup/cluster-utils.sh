#!/bin/bash

# RedPanda Cluster Management Utilities

set -e

# Enable debug mode if DEBUG environment variable is set
if [ "${DEBUG:-false}" = "true" ]; then
    set -x
    echo "🔍 DEBUG MODE ENABLED"
fi

# Configuration
STACK_NAME="${STACK_NAME:-RedPandaClusterStack}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
KEY_PATH="${KEY_PATH:-/data/.ssh/john.davis.pem}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO] $(date '+%Y-%m-%d %H:%M:%S')${NC} $1"
}

log_debug() {
    if [ "${DEBUG:-false}" = "true" ]; then
        echo -e "${BLUE}[DEBUG] $(date '+%Y-%m-%d %H:%M:%S')${NC} $1"
    fi
}

log_error() {
    echo -e "${RED}[ERROR] $(date '+%Y-%m-%d %H:%M:%S')${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN] $(date '+%Y-%m-%d %H:%M:%S')${NC} $1"
}

# Helper functions
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Initialize debug logging
log_debug "Cluster utilities script starting"
log_debug "Configuration:"
log_debug "  STACK_NAME: $STACK_NAME"
log_debug "  AWS_DEFAULT_REGION: $AWS_DEFAULT_REGION"
log_debug "  KEY_PATH: $KEY_PATH"
log_debug "  DEBUG: ${DEBUG:-false}"

# Validate environment
validate_environment() {
    log_debug "Validating environment prerequisites"
    
    # Check if key file exists
    if [ ! -f "$KEY_PATH" ]; then
        log_error "SSH key file not found at $KEY_PATH"
        error "SSH key file not found at $KEY_PATH"
        exit 1
    fi
    log_debug "SSH key file found: $KEY_PATH"
    
    # Check if AWS CLI is available
    if ! which aws >/dev/null 2>&1; then
        log_error "AWS CLI not found in PATH"
        error "AWS CLI not found in PATH"
        exit 1
    fi
    log_debug "AWS CLI found: $(aws --version 2>&1 | head -n1)"
    
    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_error "AWS credentials not configured or accessible"
        error "AWS credentials not configured. Run 'aws configure' or set environment variables"
        exit 1
    fi
    log_debug "AWS credentials verified"
}

# Get node IPs from CloudFormation
get_node_ips() {
    local output_key=$1
    log_debug "Fetching node IPs for output key: $output_key"
    
    local start_time=$(date +%s)
    local result=$(aws cloudformation describe-stacks \
        --region $AWS_DEFAULT_REGION \
        --stack-name $STACK_NAME \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text 2>/dev/null | tr ',' '\n' | tr -d ' ')
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    if [ -n "$result" ]; then
        local ip_count=$(echo "$result" | wc -l)
        log_debug "Retrieved $ip_count IPs for $output_key in ${duration}s"
        echo "$result"
    else
        log_error "No IPs found for output key: $output_key"
        return 1
    fi
}

# Execute command on all nodes
execute_on_all_nodes() {
    local command=$1
    local description=$2
    
    log_info "$description"
    log_debug "Executing command on all nodes: $command"
    
    local start_time=$(date +%s)
    local node_count=0
    local success_count=0
    
    get_node_ips "RedPandaClusterPublicIPs" | while read -r ip; do
        if [ -n "$ip" ]; then
            node_count=$((node_count + 1))
            log_debug "Executing on node $node_count ($ip)"
            log "Executing on $ip..."
            
            local cmd_start=$(date +%s)
            if ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
                ec2-user@"$ip" "$command" 2>&1; then
                local cmd_end=$(date +%s)
                local cmd_duration=$((cmd_end - cmd_start))
                log_debug "Command succeeded on $ip in ${cmd_duration}s"
                success_count=$((success_count + 1))
            else
                local cmd_end=$(date +%s)
                local cmd_duration=$((cmd_end - cmd_start))
                log_error "Command failed on $ip after ${cmd_duration}s"
            fi
        fi
    done
    
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    log_debug "Command execution completed on $node_count nodes in ${total_duration}s ($success_count succeeded)"
}

# Execute command on first node only
execute_on_first_node() {
    local command=$1
    log_debug "Executing command on first node: $command"
    
    local first_ip=$(get_node_ips "RedPandaClusterPublicIPs" | head -n 1)
    
    if [ -n "$first_ip" ]; then
        log_debug "First node IP: $first_ip"
        local start_time=$(date +%s)
        
        if ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
            ec2-user@"$first_ip" "$command"; then
            local end_time=$(date +%s)
            local duration=$((end_time - start_time))
            log_debug "Command succeeded on first node in ${duration}s"
        else
            local end_time=$(date +%s)
            local duration=$((end_time - start_time))
            log_error "Command failed on first node after ${duration}s"
            return 1
        fi
    else
        log_error "Could not find first node IP"
        error "Could not find first node IP"
        return 1
    fi
}

# Show usage
show_usage() {
    echo "RedPanda Cluster Management Utilities"
    echo "===================================="
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  status       - Show cluster status and health"
    echo "  info         - Show detailed cluster information"
    echo "  topics       - List all topics"
    echo "  create-topic - Create a test topic"
    echo "  restart      - Restart RedPanda containers on all nodes"
    echo "  stop         - Stop RedPanda containers on all nodes"
    echo "  start        - Start RedPanda containers on all nodes"
    echo "  logs         - Show RedPanda logs from all nodes"
    echo "  shell        - SSH to first RedPanda node"
    echo "  brokers      - Show bootstrap broker addresses"
    echo "  cleanup      - Remove all containers and data (DESTRUCTIVE!)"
    echo ""
    echo "Environment variables:"
    echo "  STACK_NAME=$STACK_NAME"
    echo "  AWS_DEFAULT_REGION=$AWS_DEFAULT_REGION"  
    echo "  KEY_PATH=$KEY_PATH"
    echo "  DEBUG=${DEBUG:-false}"
    echo ""
    echo "Debug mode: Set DEBUG=true for verbose logging"
}

# Show cluster status
show_status() {
    log_info "Checking cluster status"
    local start_time=$(date +%s)
    
    execute_on_all_nodes "sudo systemctl is-active redpanda && echo 'RedPanda service is running' || echo 'RedPanda service is not running'" "Service Status"
    
    echo ""
    log_info "Checking cluster health"
    if execute_on_first_node "rpk cluster info"; then
        log_debug "Cluster health check completed successfully"
    else
        log_warn "Cluster info command failed"
        warn "Cluster info failed"
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log_debug "Status check completed in ${duration}s"
}

# Show detailed cluster info
show_info() {
    log_info "Gathering detailed cluster information"
    local start_time=$(date +%s)
    
    log_info "Cluster Information:"
    execute_on_first_node "rpk cluster info"
    
    echo ""
    log_info "Broker Information:"
    execute_on_first_node "rpk redpanda admin brokers list"
    
    echo ""
    log_info "Partition Information:"
    execute_on_first_node "rpk cluster partitions"
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log_debug "Info gathering completed in ${duration}s"
}

# List topics
list_topics() {
    log_info "Listing topics in cluster"
    execute_on_first_node "rpk topic list"
}

# Create test topic
create_test_topic() {
    local topic_name="load-test-topic"
    local partitions=12
    local replication=3
    
    log_info "Creating test topic: $topic_name (partitions: $partitions, replication: $replication)"
    local start_time=$(date +%s)
    
    if execute_on_first_node "rpk topic create $topic_name -p $partitions -r $replication"; then
        log_info "Topic created successfully!"
        execute_on_first_node "rpk topic describe $topic_name"
        
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_debug "Topic creation completed in ${duration}s"
    else
        log_error "Topic creation failed"
    fi
}

# Restart services
restart_containers() {
    log_info "Restarting RedPanda services on all nodes"
    local start_time=$(date +%s)
    
    execute_on_all_nodes "sudo systemctl restart redpanda" "Restarting services"
    
    log_info "Waiting for services to stabilize..."
    sleep 10
    
    log_info "Checking status after restart..."
    show_status
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log_debug "Restart operation completed in ${duration}s"
}

# Stop services
stop_containers() {
    log_warn "Stopping RedPanda services on all nodes"
    local start_time=$(date +%s)
    
    execute_on_all_nodes "sudo systemctl stop redpanda" "Stopping services"
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log_debug "Stop operation completed in ${duration}s"
}

# Start services
start_containers() {
    log_info "Starting RedPanda services on all nodes"
    local start_time=$(date +%s)
    
    execute_on_all_nodes "sudo systemctl start redpanda" "Starting services"
    
    log_info "Waiting for services to stabilize..."
    sleep 15
    
    log_info "Checking status after start..."
    show_status
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log_debug "Start operation completed in ${duration}s"
}

# Show logs
show_logs() {
    log_info "Retrieving recent RedPanda logs from all nodes"
    execute_on_all_nodes "sudo journalctl -u redpanda --lines=50 --no-pager" "Service Logs"
}

# SSH to first node
ssh_to_node() {
    local first_ip=$(get_node_ips "RedPandaClusterPublicIPs" | head -n 1)
    
    if [ -n "$first_ip" ]; then
        log_info "Connecting to first RedPanda node: $first_ip"
        log_debug "SSH command: ssh -i $KEY_PATH ec2-user@$first_ip"
        ssh -i "$KEY_PATH" ec2-user@"$first_ip"
    else
        log_error "Could not find first node IP"
        error "Could not find first node IP"
        return 1
    fi
}

# Show bootstrap brokers
show_brokers() {
    log_info "Retrieving bootstrap broker addresses"
    local start_time=$(date +%s)
    
    log "Bootstrap Brokers:"
    local private_ips=$(get_node_ips "RedPandaClusterIPs")
    local broker_list=$(echo "$private_ips" | sed 's/$/:9092/' | tr '\n' ',' | sed 's/,$//')
    echo "$broker_list"
    echo ""
    
    log "Public IPs (for SSH access):"
    get_node_ips "RedPandaClusterPublicIPs"
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log_debug "Broker address retrieval completed in ${duration}s"
}

# Cleanup (destructive)
cleanup_cluster() {
    log_warn "⚠️  DESTRUCTIVE OPERATION ⚠️"
    warn "⚠️  DESTRUCTIVE OPERATION ⚠️"
    warn "This will stop RedPanda services and remove all data!"
    
    if [ "${DEBUG:-false}" = "true" ]; then
        log_debug "Cleanup operation requested"
    fi
    
    read -p "Are you sure you want to continue? Type 'DELETE' to confirm: " confirm
    
    if [ "$confirm" = "DELETE" ]; then
        log_error "Starting destructive cleanup operation"
        local start_time=$(date +%s)
        
        error "Stopping RedPanda services and removing data..."
        execute_on_all_nodes "sudo systemctl stop redpanda || true" "Stopping services"
        execute_on_all_nodes "sudo systemctl disable redpanda || true" "Disabling services" 
        execute_on_all_nodes "sudo rm -rf /var/lib/redpanda/data/*" "Removing data"
        
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_info "Cleanup completed in ${duration}s"
        log "Cleanup complete"
    else
        log_info "Cleanup cancelled by user"
        log "Cleanup cancelled"
    fi
}

# Validate environment before proceeding
validate_environment

# Main command handler
command="${1:-}"
log_debug "Processing command: '${command}'"

case "$command" in
    "status")
        log_debug "Executing status command"
        show_status
        ;;
    "info")
        log_debug "Executing info command"
        show_info
        ;;
    "topics")
        log_debug "Executing topics command"
        list_topics
        ;;
    "create-topic")
        log_debug "Executing create-topic command"
        create_test_topic
        ;;
    "restart")
        log_debug "Executing restart command"
        restart_containers
        ;;
    "stop")
        log_debug "Executing stop command"
        stop_containers
        ;;
    "start")
        log_debug "Executing start command"
        start_containers
        ;;
    "logs")
        log_debug "Executing logs command"
        show_logs
        ;;
    "shell")
        log_debug "Executing shell command"
        ssh_to_node
        ;;
    "brokers")
        log_debug "Executing brokers command"
        show_brokers
        ;;
    "cleanup")
        log_debug "Executing cleanup command"
        cleanup_cluster
        ;;
    "")
        log_debug "No command provided, showing usage"
        show_usage
        ;;
    *)
        log_error "Unknown command: $command"
        error "Unknown command: $command"
        show_usage
        exit 1
        ;;
esac

log_debug "Cluster utilities script completed" 