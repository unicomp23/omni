#!/bin/bash

# Redpanda Cluster Membership Checker
# This script checks if brokers have successfully joined the Redpanda cluster

set -e

# Configuration
REGION="us-east-1"
MAX_RETRIES=3
BASE_DELAY=2

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to print section headers
print_header() {
    echo
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

# Function to perform commands with retry
execute_with_retry() {
    local cmd="$1"
    local description="$2"
    local retry_count=0
    
    while [ $retry_count -lt $MAX_RETRIES ]; do
        local delay=$((BASE_DELAY * (2 ** retry_count)))
        
        if [ $retry_count -gt 0 ]; then
            print_status $YELLOW "Retrying in $delay seconds... (attempt $((retry_count + 1))/$MAX_RETRIES)"
            sleep $delay
        fi
        
        if eval "$cmd" 2>/dev/null; then
            return 0
        else
            local exit_code=$?
            if [ $retry_count -lt $((MAX_RETRIES - 1)) ]; then
                print_status $YELLOW "$description failed (exit code: $exit_code). Retrying..."
            else
                print_status $RED "$description failed after $MAX_RETRIES attempts."
                return $exit_code
            fi
        fi
        
        retry_count=$((retry_count + 1))
    done
}

# Function to get broker instance information
get_broker_instances() {
    print_status $BLUE "Getting Redpanda broker instances..."
    
    local cmd="aws ec2 describe-instances --region $REGION --filters 'Name=tag:Purpose,Values=RedpandaBroker' 'Name=instance-state-name,Values=running' --query 'Reservations[].Instances[].[InstanceId,Tags[?Key==\`BrokerId\`].Value|[0],PublicIpAddress,PrivateIpAddress,State.Name]' --output text"
    
    if execute_with_retry "$cmd" "Getting broker instances"; then
        return 0
    else
        print_status $RED "Failed to get broker instances"
        return 1
    fi
}

# Function to check if broker container is running
check_broker_container() {
    local instance_id=$1
    local broker_id=$2
    local public_ip=$3
    
    print_status $CYAN "Checking Docker container on Broker $broker_id ($instance_id)..."
    
    # Try multiple connection methods
    local ssh_methods=(
        "ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$public_ip"
        "aws ssm start-session --target $instance_id --region $REGION --document-name AWS-StartInteractiveCommand --parameters command='bash'"
    )
    
    for method in "${ssh_methods[@]}"; do
        if echo "$method" | grep -q "ssh"; then
            local container_check="$method 'docker ps --filter name=redpanda-broker-$broker_id --format \"table {{.Names}}\t{{.Status}}\t{{.Ports}}\"'"
            
            print_status $BLUE "Checking container via SSH..."
            if eval "$container_check" 2>/dev/null; then
                return 0
            fi
        fi
    done
    
    print_status $YELLOW "Could not connect via SSH, trying alternative methods..."
    return 1
}

# Function to check cluster health via rpk
check_cluster_health() {
    local instance_id=$1
    local broker_id=$2
    local public_ip=$3
    
    print_status $CYAN "Checking cluster health on Broker $broker_id..."
    
    # Try to execute rpk cluster health command
    local health_cmd="ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$public_ip 'docker exec redpanda-broker-$broker_id rpk cluster health --brokers localhost:9092'"
    
    if execute_with_retry "$health_cmd" "Cluster health check"; then
        return 0
    else
        print_status $YELLOW "Direct cluster health check failed, trying alternative..."
        return 1
    fi
}

# Function to check cluster info via rpk
check_cluster_info() {
    local instance_id=$1
    local broker_id=$2
    local public_ip=$3
    
    print_status $CYAN "Getting cluster info from Broker $broker_id..."
    
    local info_cmd="ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$public_ip 'docker exec redpanda-broker-$broker_id rpk cluster info --brokers localhost:9092'"
    
    if execute_with_retry "$info_cmd" "Cluster info check"; then
        return 0
    else
        print_status $YELLOW "Cluster info check failed"
        return 1
    fi
}

# Function to check broker logs
check_broker_logs() {
    local instance_id=$1
    local broker_id=$2
    local public_ip=$3
    
    print_status $CYAN "Checking recent logs for Broker $broker_id..."
    
    local logs_cmd="ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$public_ip 'docker logs --tail 50 redpanda-broker-$broker_id 2>&1 | grep -E \"(cluster|join|election|leader|ready|started|error|warn)\" | tail -20'"
    
    if execute_with_retry "$logs_cmd" "Broker logs check"; then
        return 0
    else
        print_status $YELLOW "Could not retrieve broker logs"
        return 1
    fi
}

# Function to run built-in health check script
run_health_check_script() {
    local instance_id=$1
    local broker_id=$2
    local public_ip=$3
    
    print_status $CYAN "Running built-in health check script on Broker $broker_id..."
    
    local health_script_cmd="ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$public_ip '/usr/local/bin/redpanda-health-check.sh'"
    
    if execute_with_retry "$health_script_cmd" "Built-in health check"; then
        return 0
    else
        print_status $YELLOW "Built-in health check failed"
        return 1
    fi
}

# Function to check cluster membership from load test instance
check_from_loadtest_instance() {
    print_status $CYAN "Checking cluster from load test instance..."
    
    # Get load test instance IP
    local loadtest_ip=$(aws ec2 describe-instances \
        --region $REGION \
        --filters "Name=tag:Purpose,Values=LoadTesting" \
                 "Name=instance-state-name,Values=running" \
        --query "Reservations[].Instances[].PublicIpAddress" \
        --output text 2>/dev/null)
    
    if [ -z "$loadtest_ip" ]; then
        print_status $YELLOW "Load test instance not found or not running"
        return 1
    fi
    
    print_status $BLUE "Load test instance IP: $loadtest_ip"
    
    # Check if we can reach the brokers from load test instance
    local broker_endpoints="redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092"
    
    # Try to list topics to verify cluster connectivity
    local topics_cmd="ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$loadtest_ip 'source ~/.bashrc && /opt/kafka/bin/kafka-topics.sh --list --bootstrap-server \$REDPANDA_BROKERS'"
    
    print_status $BLUE "Checking cluster connectivity from load test instance..."
    if execute_with_retry "$topics_cmd" "Topic listing from load test"; then
        print_status $GREEN "✅ Cluster is accessible from load test instance"
        return 0
    else
        print_status $RED "❌ Cluster not accessible from load test instance"
        return 1
    fi
}

# Function to perform comprehensive cluster check
comprehensive_cluster_check() {
    local loadtest_ip=$(aws ec2 describe-instances \
        --region $REGION \
        --filters "Name=tag:Purpose,Values=LoadTesting" \
                 "Name=instance-state-name,Values=running" \
        --query "Reservations[].Instances[].PublicIpAddress" \
        --output text 2>/dev/null)
    
    if [ -z "$loadtest_ip" ]; then
        print_status $YELLOW "Load test instance not available for comprehensive check"
        return 1
    fi
    
    print_status $CYAN "Running comprehensive cluster check from load test instance..."
    
    # Create a comprehensive check script
    local check_script="
source ~/.bashrc
echo 'Broker endpoints: '\$REDPANDA_BROKERS
echo
echo '=== Cluster Metadata ==='
/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server \$REDPANDA_BROKERS 2>/dev/null | head -10
echo
echo '=== Topic List ==='
/opt/kafka/bin/kafka-topics.sh --list --bootstrap-server \$REDPANDA_BROKERS 2>/dev/null
echo
echo '=== Broker Details ==='
/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server \$REDPANDA_BROKERS 2>/dev/null | grep -E 'id|host|port' | head -10
echo
echo '=== Cluster Health Test ==='
# Create a test topic
/opt/kafka/bin/kafka-topics.sh --create --topic cluster-test --bootstrap-server \$REDPANDA_BROKERS --partitions 3 --replication-factor 3 --if-not-exists 2>/dev/null
# Test produce/consume
echo 'test-message' | /opt/kafka/bin/kafka-console-producer.sh --topic cluster-test --bootstrap-server \$REDPANDA_BROKERS 2>/dev/null
timeout 5 /opt/kafka/bin/kafka-console-consumer.sh --topic cluster-test --bootstrap-server \$REDPANDA_BROKERS --from-beginning --max-messages 1 2>/dev/null
echo
echo '=== Cleanup ==='
/opt/kafka/bin/kafka-topics.sh --delete --topic cluster-test --bootstrap-server \$REDPANDA_BROKERS 2>/dev/null
echo 'Comprehensive check completed'
"
    
    local comprehensive_cmd="ssh -i ~/.ssh/john.davis.pem -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ec2-user@$loadtest_ip '$check_script'"
    
    if execute_with_retry "$comprehensive_cmd" "Comprehensive cluster check"; then
        return 0
    else
        print_status $RED "Comprehensive cluster check failed"
        return 1
    fi
}

# Function to provide troubleshooting guidance
provide_troubleshooting() {
    print_header "🔧 TROUBLESHOOTING GUIDE"
    
    print_status $YELLOW "If brokers are not joining the cluster, try these steps:"
    echo
    echo "1. Check Docker containers are running:"
    echo "   ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip> 'docker ps'"
    echo
    echo "2. Check Redpanda logs:"
    echo "   ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip> 'docker logs redpanda-broker-X'"
    echo
    echo "3. Check network connectivity between brokers:"
    echo "   ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip> 'telnet redpanda-broker-Y 33145'"
    echo
    echo "4. Restart a broker container:"
    echo "   ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip> 'docker restart redpanda-broker-X'"
    echo
    echo "5. Check security groups allow inter-broker communication (port 33145)"
    echo
    echo "6. Verify DNS resolution:"
    echo "   ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip> 'nslookup redpanda-broker-Y'"
    echo
    echo "7. Check system resources:"
    echo "   ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip> 'htop'"
    echo "   ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip> 'df -h'"
    echo
    echo "8. Manual cluster health check:"
    echo "   docker exec redpanda-broker-X rpk cluster health --brokers localhost:9092"
    echo "   docker exec redpanda-broker-X rpk cluster info --brokers localhost:9092"
    echo
}

# Main execution
main() {
    print_header "🔍 REDPANDA CLUSTER MEMBERSHIP CHECK"
    
    # Check prerequisites
    if ! command -v aws &> /dev/null; then
        print_status $RED "AWS CLI not installed"
        exit 1
    fi
    
    if ! aws sts get-caller-identity --region $REGION >/dev/null 2>&1; then
        print_status $RED "AWS CLI not configured or no permissions"
        exit 1
    fi
    
    # Get broker instances
    print_header "📋 BROKER INSTANCES"
    local broker_data
    if broker_data=$(get_broker_instances); then
        echo "$broker_data" | while read -r instance_id broker_id public_ip private_ip state; do
            if [ -n "$instance_id" ] && [ -n "$broker_id" ]; then
                print_status $GREEN "✅ Broker $broker_id: $instance_id ($state)"
                echo "   Public IP: $public_ip"
                echo "   Private IP: $private_ip"
                echo
            fi
        done
    else
        print_status $RED "Failed to get broker instances"
        exit 1
    fi
    
    # Check each broker
    print_header "🔍 INDIVIDUAL BROKER CHECKS"
    local all_healthy=true
    
    echo "$broker_data" | while read -r instance_id broker_id public_ip private_ip state; do
        if [ -n "$instance_id" ] && [ -n "$broker_id" ] && [ -n "$public_ip" ]; then
            print_status $BLUE "Checking Broker $broker_id ($instance_id)..."
            
            # Check container status
            if check_broker_container "$instance_id" "$broker_id" "$public_ip"; then
                print_status $GREEN "✅ Container running"
            else
                print_status $RED "❌ Container check failed"
                all_healthy=false
            fi
            
            # Check built-in health script
            if run_health_check_script "$instance_id" "$broker_id" "$public_ip"; then
                print_status $GREEN "✅ Built-in health check passed"
            else
                print_status $RED "❌ Built-in health check failed"
                all_healthy=false
            fi
            
            # Check cluster health
            if check_cluster_health "$instance_id" "$broker_id" "$public_ip"; then
                print_status $GREEN "✅ Cluster health check passed"
            else
                print_status $RED "❌ Cluster health check failed"
                all_healthy=false
            fi
            
            # Check cluster info
            if check_cluster_info "$instance_id" "$broker_id" "$public_ip"; then
                print_status $GREEN "✅ Cluster info retrieved"
            else
                print_status $RED "❌ Cluster info failed"
                all_healthy=false
            fi
            
            # Check recent logs
            print_status $CYAN "Recent logs for Broker $broker_id:"
            check_broker_logs "$instance_id" "$broker_id" "$public_ip"
            
            echo
        fi
    done
    
    # Check from load test instance
    print_header "🧪 LOAD TEST INSTANCE CHECK"
    if check_from_loadtest_instance; then
        print_status $GREEN "✅ Cluster accessible from load test instance"
    else
        print_status $RED "❌ Cluster not accessible from load test instance"
        all_healthy=false
    fi
    
    # Comprehensive cluster check
    print_header "🔬 COMPREHENSIVE CLUSTER CHECK"
    if comprehensive_cluster_check; then
        print_status $GREEN "✅ Comprehensive cluster check passed"
    else
        print_status $RED "❌ Comprehensive cluster check failed"
        all_healthy=false
    fi
    
    # Final summary
    print_header "📊 SUMMARY"
    if [ "$all_healthy" = true ]; then
        print_status $GREEN "🎉 All brokers have successfully joined the cluster!"
        print_status $GREEN "✅ Cluster is healthy and ready for use"
    else
        print_status $RED "⚠️ Some brokers may not have joined the cluster properly"
        print_status $YELLOW "Please review the checks above and follow troubleshooting steps"
        provide_troubleshooting
    fi
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo "Options:"
        echo "  --help, -h    Show this help message"
        echo "  --region, -r  Set AWS region (default: us-east-1)"
        echo ""
        echo "This script checks if Redpanda brokers have successfully joined the cluster."
        exit 0
        ;;
    --region|-r)
        REGION="$2"
        shift 2
        ;;
esac

# Run main function
main "$@" 