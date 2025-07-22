#!/bin/bash

# RedPanda Cluster Management Utilities

set -e

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

# Get node IPs from CloudFormation
get_node_ips() {
    local output_key=$1
    aws cloudformation describe-stacks \
        --region $AWS_DEFAULT_REGION \
        --stack-name $STACK_NAME \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text | tr ',' '\n' | tr -d ' '
}

# Execute command on all nodes
execute_on_all_nodes() {
    local command=$1
    local description=$2
    
    log "$description"
    
    get_node_ips "RedPandaClusterPublicIPs" | while read -r ip; do
        if [ -n "$ip" ]; then
            log "Executing on $ip..."
            ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
                ec2-user@"$ip" "$command"
        fi
    done
}

# Execute command on first node only
execute_on_first_node() {
    local command=$1
    local first_ip=$(get_node_ips "RedPandaClusterPublicIPs" | head -n 1)
    
    if [ -n "$first_ip" ]; then
        ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
            ec2-user@"$first_ip" "$command"
    else
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
    echo ""
}

# Show cluster status
show_status() {
    log "Checking cluster status..."
    execute_on_all_nodes "sudo docker ps | grep redpanda || echo 'RedPanda container not running'" "Container Status"
    
    echo ""
    log "Checking cluster health..."
    execute_on_first_node "sudo docker exec redpanda rpk cluster info" || warn "Cluster info failed"
}

# Show detailed cluster info
show_info() {
    log "Cluster Information:"
    execute_on_first_node "sudo docker exec redpanda rpk cluster info"
    
    echo ""
    log "Broker Information:"
    execute_on_first_node "sudo docker exec redpanda rpk redpanda admin brokers list"
    
    echo ""
    log "Partition Information:"
    execute_on_first_node "sudo docker exec redpanda rpk cluster partitions"
}

# List topics
list_topics() {
    log "Topics in cluster:"
    execute_on_first_node "sudo docker exec redpanda rpk topic list"
}

# Create test topic
create_test_topic() {
    local topic_name="load-test-topic"
    local partitions=12
    local replication=3
    
    log "Creating test topic: $topic_name"
    execute_on_first_node "sudo docker exec redpanda rpk topic create $topic_name -p $partitions -r $replication"
    
    log "Topic created successfully!"
    execute_on_first_node "sudo docker exec redpanda rpk topic describe $topic_name"
}

# Restart containers
restart_containers() {
    log "Restarting RedPanda containers..."
    execute_on_all_nodes "sudo docker restart redpanda" "Restarting containers"
    
    log "Waiting for containers to stabilize..."
    sleep 10
    
    log "Checking status after restart..."
    show_status
}

# Stop containers
stop_containers() {
    warn "Stopping RedPanda containers..."
    execute_on_all_nodes "sudo docker stop redpanda" "Stopping containers"
}

# Start containers
start_containers() {
    log "Starting RedPanda containers..."
    execute_on_all_nodes "sudo docker start redpanda" "Starting containers"
    
    log "Waiting for containers to stabilize..."
    sleep 15
    
    log "Checking status after start..."
    show_status
}

# Show logs
show_logs() {
    log "Recent RedPanda logs from all nodes:"
    execute_on_all_nodes "sudo docker logs --tail 50 redpanda" "Container Logs"
}

# SSH to first node
ssh_to_node() {
    local first_ip=$(get_node_ips "RedPandaClusterPublicIPs" | head -n 1)
    
    if [ -n "$first_ip" ]; then
        log "Connecting to first RedPanda node: $first_ip"
        ssh -i "$KEY_PATH" ec2-user@"$first_ip"
    else
        error "Could not find first node IP"
        return 1
    fi
}

# Show bootstrap brokers
show_brokers() {
    log "Bootstrap Brokers:"
    local private_ips=$(get_node_ips "RedPandaClusterIPs")
    echo "$private_ips" | sed 's/$/:9092/' | tr '\n' ',' | sed 's/,$//'
    echo ""
    
    log "Public IPs (for SSH access):"
    get_node_ips "RedPandaClusterPublicIPs"
}

# Cleanup (destructive)
cleanup_cluster() {
    warn "⚠️  DESTRUCTIVE OPERATION ⚠️"
    warn "This will remove all RedPanda containers and data!"
    
    read -p "Are you sure you want to continue? Type 'DELETE' to confirm: " confirm
    
    if [ "$confirm" = "DELETE" ]; then
        error "Removing RedPanda containers and data..."
        execute_on_all_nodes "sudo docker stop redpanda || true" "Stopping containers"
        execute_on_all_nodes "sudo docker rm redpanda || true" "Removing containers" 
        execute_on_all_nodes "sudo rm -rf /opt/redpanda/data/*" "Removing data"
        log "Cleanup complete"
    else
        log "Cleanup cancelled"
    fi
}

# Main command handler
case "${1:-}" in
    "status")
        show_status
        ;;
    "info")
        show_info
        ;;
    "topics")
        list_topics
        ;;
    "create-topic")
        create_test_topic
        ;;
    "restart")
        restart_containers
        ;;
    "stop")
        stop_containers
        ;;
    "start")
        start_containers
        ;;
    "logs")
        show_logs
        ;;
    "shell")
        ssh_to_node
        ;;
    "brokers")
        show_brokers
        ;;
    "cleanup")
        cleanup_cluster
        ;;
    "")
        show_usage
        ;;
    *)
        error "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac 