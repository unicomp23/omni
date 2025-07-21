#!/bin/bash

# Redpanda Cluster Workflow Management Script
# This script provides a comprehensive workflow for managing Redpanda clusters

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
STACK_NAME="ShastaRedpandaStack"
REGION="us-east-1"
KEY_PAIR_NAME="john.davis"

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

log_header() {
    echo -e "${CYAN}$1${NC}"
}

# Function to display banner
show_banner() {
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                                                               ║${NC}"
    echo -e "${BLUE}║              🚀 REDPANDA CLUSTER WORKFLOW 🚀                  ║${NC}"
    echo -e "${BLUE}║                                                               ║${NC}"
    echo -e "${BLUE}║              Comprehensive Cluster Management                 ║${NC}"
    echo -e "${BLUE}║                                                               ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo
}

# Function to get stack status
get_stack_status() {
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND"
}

# Function to check if cluster is deployed
is_cluster_deployed() {
    local status=$(get_stack_status)
    [[ "$status" == "CREATE_COMPLETE" || "$status" == "UPDATE_COMPLETE" ]]
}

# Function to get cluster info
show_cluster_status() {
    log_header "═══ CLUSTER STATUS ═══"
    
    local stack_status=$(get_stack_status)
    echo -e "${BLUE}Stack Status:${NC} $stack_status"
    
    if is_cluster_deployed; then
        # Get instance count
        local running_instances=$(aws ec2 describe-instances --region "$REGION" \
            --filters "Name=tag:Name,Values=${STACK_NAME}/*" \
                     "Name=instance-state-name,Values=running" \
            --query 'Reservations[].Instances[].[InstanceId]' --output text | wc -l)
        
        echo -e "${BLUE}Running Instances:${NC} $running_instances"
        
        # Get load test instance IP
        local loadtest_ip=$(aws ec2 describe-instances --region "$REGION" \
            --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaLoadTest" \
                     "Name=instance-state-name,Values=running" \
            --query 'Reservations[].Instances[].PublicIpAddress' --output text)
        
        if [[ -n "$loadtest_ip" && "$loadtest_ip" != "None" ]]; then
            echo -e "${BLUE}Load Test IP:${NC} $loadtest_ip"
        else
            echo -e "${BLUE}Load Test IP:${NC} Not available"
        fi
        
        # Check S3 bucket
        local bucket_name="redpanda-data-$(aws sts get-caller-identity --query Account --output text)-$REGION"
        if aws s3api head-bucket --bucket "$bucket_name" --region "$REGION" &>/dev/null; then
            echo -e "${BLUE}S3 Bucket:${NC} $bucket_name"
        else
            echo -e "${BLUE}S3 Bucket:${NC} Not found"
        fi
        
        echo -e "${GREEN}✅ Cluster is deployed and ready${NC}"
    else
        echo -e "${YELLOW}⚠️  Cluster is not deployed${NC}"
    fi
    echo
}

# Function to show main menu
show_main_menu() {
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}                        MAIN MENU                              ${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo
    echo -e "${GREEN}🚀 DEPLOYMENT & SETUP${NC}"
    echo "  1) Deploy Redpanda Cluster    - Full CDK deployment"
    echo "  2) Check Deployment Status    - Verify stack and resources"
    echo
    echo -e "${GREEN}🧪 TESTING & VALIDATION${NC}"
    echo "  3) Test Cluster               - Comprehensive functionality tests"
    echo "  4) Quick Health Check         - Fast cluster validation"
    echo "  5) Performance Benchmark      - Run performance tests"
    echo
    echo -e "${GREEN}🔧 MANAGEMENT & ACCESS${NC}"
    echo "  6) Get Instance IPs           - Show broker and load test IPs"
    echo "  7) Connect to Load Test       - SSH connection info"
    echo "  8) Connect to Brokers         - Access broker instances"
    echo "  9) List Active Stacks         - Show all CDK stacks"
    echo
    echo -e "${GREEN}📊 MONITORING & LOGS${NC}"
    echo " 10) View Cluster Logs          - Check CloudWatch logs"
    echo " 11) Monitor Resources          - AWS resource usage"
    echo " 12) Troubleshoot Issues        - Common problem solutions"
    echo
    echo -e "${RED}🧹 CLEANUP & MAINTENANCE${NC}"
    echo " 13) Cleanup Cluster            - Destroy all resources"
    echo " 14) Emergency Cleanup          - Force cleanup without prompts"
    echo
    echo -e "${BLUE}❓ HELP & INFO${NC}"
    echo " 15) Show Documentation         - View setup and usage guides"
    echo " 16) Cost Estimation            - Estimate running costs"
    echo
    echo "  0) Exit"
    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
}

# Function to handle deployment
handle_deployment() {
    log_header "═══ DEPLOYING REDPANDA CLUSTER ═══"
    
    if is_cluster_deployed; then
        log_warning "Cluster is already deployed!"
        read -p "Do you want to continue anyway? [y/N]: " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi
    
    log_info "Starting cluster deployment..."
    if ./deploy-redpanda.sh; then
        log_success "Deployment completed successfully!"
    else
        log_error "Deployment failed!"
    fi
    
    read -p "Press Enter to continue..."
}

# Function to handle testing
handle_testing() {
    log_header "═══ TESTING REDPANDA CLUSTER ═══"
    
    if ! is_cluster_deployed; then
        log_error "No cluster deployed! Please deploy first."
        read -p "Press Enter to continue..."
        return 1
    fi
    
    log_info "Running comprehensive cluster tests..."
    if ./test-redpanda-cluster.sh; then
        log_success "All tests completed!"
    else
        log_warning "Some tests failed - check output above"
    fi
    
    read -p "Press Enter to continue..."
}

# Function to handle quick health check
handle_health_check() {
    log_header "═══ QUICK HEALTH CHECK ═══"
    
    if ! is_cluster_deployed; then
        log_error "No cluster deployed!"
        read -p "Press Enter to continue..."
        return 1
    fi
    
    # Get load test IP
    local loadtest_ip=$(aws ec2 describe-instances --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaLoadTest" \
                 "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].PublicIpAddress' --output text)
    
    if [[ -z "$loadtest_ip" || "$loadtest_ip" == "None" ]]; then
        log_error "Load test instance not available"
        read -p "Press Enter to continue..."
        return 1
    fi
    
    log_info "Running quick health check on $loadtest_ip..."
    
    if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 \
        -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
        "source ~/.bashrc && ./quick_test.sh"; then
        log_success "Health check passed!"
    else
        log_warning "Health check failed"
    fi
    
    read -p "Press Enter to continue..."
}

# Function to handle instance IPs
handle_instance_ips() {
    log_header "═══ INSTANCE IP ADDRESSES ═══"
    
    if ! is_cluster_deployed; then
        log_error "No cluster deployed!"
        read -p "Press Enter to continue..."
        return 1
    fi
    
    echo "Getting instance information..."
    echo
    
    # Run the existing scripts
    echo -e "${BLUE}📍 Load Test Instance:${NC}"
    ./get_redpanda_loadtest_ip.sh | head -20
    echo
    
    echo -e "${BLUE}📍 Broker Instances:${NC}"
    ./get_redpanda_broker_ips.sh | head -30
    
    read -p "Press Enter to continue..."
}

# Function to handle cleanup
handle_cleanup() {
    log_header "═══ CLEANUP REDPANDA CLUSTER ═══"
    
    if ! is_cluster_deployed; then
        log_warning "No cluster found to clean up"
        read -p "Press Enter to continue..."
        return 0
    fi
    
    log_warning "This will permanently delete your Redpanda cluster!"
    read -p "Are you sure you want to proceed? [y/N]: " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ./cleanup-redpanda.sh
    else
        log_info "Cleanup cancelled"
    fi
    
    read -p "Press Enter to continue..."
}

# Function to handle emergency cleanup
handle_emergency_cleanup() {
    log_header "═══ EMERGENCY CLEANUP (FORCE) ═══"
    
    log_error "This will force cleanup without prompts!"
    read -p "Are you absolutely sure? Type 'FORCE' to continue: " response
    
    if [[ "$response" == "FORCE" ]]; then
        ./cleanup-redpanda.sh --force
    else
        log_info "Emergency cleanup cancelled"
    fi
    
    read -p "Press Enter to continue..."
}

# Function to show documentation
show_documentation() {
    log_header "═══ DOCUMENTATION ═══"
    echo
    echo -e "${GREEN}📚 Available Documentation:${NC}"
    echo "  • REDPANDA_STACK_README.md - Complete architecture guide"
    echo "  • CLUSTER_MEMBERSHIP_GUIDE.md - Cluster monitoring guide"
    echo "  • redpanda_cluster_status_from_broker.md - Health checking"
    echo
    echo -e "${GREEN}🔧 Management Scripts:${NC}"
    echo "  • deploy-redpanda.sh - Deploy cluster"
    echo "  • test-redpanda-cluster.sh - Test functionality"
    echo "  • cleanup-redpanda.sh - Clean up resources"
    echo "  • get_redpanda_broker_ips.sh - Get broker IPs"
    echo "  • get_redpanda_loadtest_ip.sh - Get load test IP"
    echo
    echo -e "${GREEN}📖 Usage Examples:${NC}"
    echo "  1. Deploy: ./deploy-redpanda.sh"
    echo "  2. Test: ./test-redpanda-cluster.sh"
    echo "  3. Connect: ssh -i ~/.ssh/john.davis.pem ec2-user@<ip>"
    echo "  4. Cleanup: ./cleanup-redpanda.sh"
    echo
    
    read -p "Press Enter to continue..."
}

# Function to show cost estimation
show_cost_estimation() {
    log_header "═══ COST ESTIMATION ═══"
    echo
    echo -e "${GREEN}💰 Estimated Monthly Costs (us-east-1):${NC}"
    echo
    echo -e "${BLUE}EC2 Instances:${NC}"
    echo "  • 3 x c5n.xlarge (brokers): ~\$470/month (\$0.216/hour each)"
    echo "  • 1 x c5n.large (load test): ~\$78/month (\$0.108/hour)"
    echo
    echo -e "${BLUE}Storage:${NC}"
    echo "  • 4 x 100GB GP3 volumes: ~\$40/month"
    echo "  • S3 storage: ~\$5/month (minimal usage)"
    echo
    echo -e "${BLUE}Networking:${NC}"
    echo "  • NAT Gateway: ~\$45/month"
    echo "  • VPC endpoints: ~\$22/month"
    echo
    echo -e "${YELLOW}Total Estimated Cost: ~\$660/month${NC}"
    echo
    echo -e "${RED}⚠️  Note: Costs vary by region and actual usage${NC}"
    echo "   • Shut down when not needed to save costs"
    echo "   • Monitor AWS Cost Explorer for actual costs"
    echo "   • Consider using Spot instances for development"
    echo
    
    read -p "Press Enter to continue..."
}

# Function to list active stacks
list_stacks() {
    log_header "═══ ACTIVE CDK STACKS ═══"
    ./list-active-stacks.sh
    read -p "Press Enter to continue..."
}

# Function to handle troubleshooting
handle_troubleshooting() {
    log_header "═══ TROUBLESHOOTING GUIDE ═══"
    echo
    echo -e "${GREEN}🔧 Common Issues and Solutions:${NC}"
    echo
    echo -e "${YELLOW}1. Deployment Fails:${NC}"
    echo "   • Check AWS credentials: aws sts get-caller-identity"
    echo "   • Verify CDK bootstrap: cdk bootstrap"
    echo "   • Check service limits in AWS console"
    echo
    echo -e "${YELLOW}2. Can't Connect to Instances:${NC}"
    echo "   • Verify SSH key exists: ls ~/.ssh/john.davis.pem"
    echo "   • Check security groups allow SSH (port 22)"
    echo "   • Try SSM Session Manager: aws ssm start-session"
    echo
    echo -e "${YELLOW}3. Cluster Health Issues:${NC}"
    echo "   • Wait 5-10 minutes after deployment"
    echo "   • Check all 3 brokers are running"
    echo "   • Verify S3 bucket permissions"
    echo "   • Check VPC endpoints are working"
    echo
    echo -e "${YELLOW}4. Performance Issues:${NC}"
    echo "   • Verify placement groups are active"
    echo "   • Check network optimization settings"
    echo "   • Monitor CloudWatch metrics"
    echo
    echo -e "${YELLOW}5. Cleanup Issues:${NC}"
    echo "   • Empty S3 bucket manually if needed"
    echo "   • Terminate instances via AWS console"
    echo "   • Delete stack manually if CDK fails"
    echo
    echo -e "${GREEN}🆘 Emergency Commands:${NC}"
    echo "   • Force cleanup: ./cleanup-redpanda.sh --force"
    echo "   • Manual instance termination:"
    echo "     aws ec2 terminate-instances --instance-ids <id>"
    echo "   • Manual stack deletion:"
    echo "     aws cloudformation delete-stack --stack-name $STACK_NAME"
    echo
    
    read -p "Press Enter to continue..."
}

# Function to handle performance benchmark
handle_performance_benchmark() {
    log_header "═══ PERFORMANCE BENCHMARK ═══"
    
    if ! is_cluster_deployed; then
        log_error "No cluster deployed!"
        read -p "Press Enter to continue..."
        return 1
    fi
    
    local loadtest_ip=$(aws ec2 describe-instances --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaLoadTest" \
                 "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].PublicIpAddress' --output text)
    
    if [[ -z "$loadtest_ip" || "$loadtest_ip" == "None" ]]; then
        log_error "Load test instance not available"
        read -p "Press Enter to continue..."
        return 1
    fi
    
    log_info "Running performance benchmark on $loadtest_ip..."
    
    # Run performance test
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
        "source ~/.bashrc && echo 'Running performance tests...' && \
         rpk topic create perf-test --partitions 6 --replicas 3 && \
         echo 'Created performance topic' && \
         timeout 60 bash -c 'for i in {1..1000}; do echo \"perf-msg-\$i-\$(date +%s%N)\"; done | rpk topic produce perf-test' && \
         echo 'Performance test completed' && \
         rpk topic delete perf-test"
    
    read -p "Press Enter to continue..."
}

# Main menu loop
main_menu_loop() {
    while true; do
        clear
        show_banner
        show_cluster_status
        show_main_menu
        
        read -p "Enter your choice [0-16]: " choice
        echo
        
        case $choice in
            1)  handle_deployment ;;
            2)  show_cluster_status; read -p "Press Enter to continue..." ;;
            3)  handle_testing ;;
            4)  handle_health_check ;;
            5)  handle_performance_benchmark ;;
            6)  handle_instance_ips ;;
            7)  log_info "Load Test Connection Info:"; ./get_redpanda_loadtest_ip.sh | tail -20; read -p "Press Enter to continue..." ;;
            8)  log_info "Broker Connection Info:"; ./get_redpanda_broker_ips.sh | tail -30; read -p "Press Enter to continue..." ;;
            9)  list_stacks ;;
            10) log_info "CloudWatch logs feature not implemented yet"; read -p "Press Enter to continue..." ;;
            11) log_info "Resource monitoring feature not implemented yet"; read -p "Press Enter to continue..." ;;
            12) handle_troubleshooting ;;
            13) handle_cleanup ;;
            14) handle_emergency_cleanup ;;
            15) show_documentation ;;
            16) show_cost_estimation ;;
            0)  log_success "Goodbye!"; exit 0 ;;
            *)  log_error "Invalid choice. Please try again."; sleep 2 ;;
        esac
    done
}

# Check prerequisites
check_prerequisites() {
    local missing_tools=()
    
    command -v aws >/dev/null 2>&1 || missing_tools+=("AWS CLI")
    command -v cdk >/dev/null 2>&1 || missing_tools+=("AWS CDK")
    command -v jq >/dev/null 2>&1 || missing_tools+=("jq")
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        echo "Please install the missing tools and try again."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_error "AWS credentials not configured"
        echo "Please run 'aws configure' to set up your credentials."
        exit 1
    fi
}

# Handle command line arguments
if [[ $# -gt 0 ]]; then
    case "$1" in
        "deploy"|"--deploy")
            check_prerequisites
            handle_deployment
            exit 0
            ;;
        "test"|"--test")
            check_prerequisites
            handle_testing
            exit 0
            ;;
        "cleanup"|"--cleanup")
            check_prerequisites
            handle_cleanup
            exit 0
            ;;
        "status"|"--status")
            check_prerequisites
            show_cluster_status
            exit 0
            ;;
        "--help"|"-h")
            echo "Redpanda Cluster Workflow Management"
            echo
            echo "Usage: $0 [command]"
            echo
            echo "Commands:"
            echo "  deploy    Deploy the Redpanda cluster"
            echo "  test      Test the cluster functionality" 
            echo "  cleanup   Clean up all resources"
            echo "  status    Show cluster status"
            echo "  (no args) Launch interactive menu"
            echo
            exit 0
            ;;
        *)
            log_error "Unknown command: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
fi

# Main execution
check_prerequisites
main_menu_loop 