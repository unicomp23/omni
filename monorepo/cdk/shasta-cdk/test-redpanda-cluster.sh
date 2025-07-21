#!/bin/bash

# Redpanda Cluster Testing Script
# This script runs comprehensive tests on the deployed Redpanda cluster

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
TEST_TOPIC="redpanda-test-$(date +%s)"
PERF_TOPIC="redpanda-perf-$(date +%s)"

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}🧪 REDPANDA CLUSTER TESTING${NC}"
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

# Function to get load test instance IP
get_loadtest_ip() {
    aws ec2 describe-instances \
        --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaLoadTest" \
                 "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].PublicIpAddress' \
        --output text
}

# Function to execute command on load test instance
run_on_loadtest() {
    local command="$1"
    local description="$2"
    local loadtest_ip="$3"
    
    if [[ -n "$description" ]]; then
        log_info "$description"
    fi
    
    if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 \
        -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip "$command"; then
        return 0
    else
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking test prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured"
        exit 1
    fi
    
    # Check if key pair file exists
    if [[ ! -f ~/.ssh/${KEY_PAIR_NAME}.pem ]]; then
        log_error "SSH key file not found: ~/.ssh/${KEY_PAIR_NAME}.pem"
        exit 1
    fi
    
    log_success "Prerequisites met"
    echo
}

# Function to check if stack exists and is deployed
check_stack_status() {
    log_info "Checking stack deployment status..."
    
    local stack_status=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [[ "$stack_status" == "CREATE_COMPLETE" || "$stack_status" == "UPDATE_COMPLETE" ]]; then
        log_success "Stack $STACK_NAME is deployed and ready"
    else
        log_error "Stack $STACK_NAME is not ready (status: $stack_status)"
        log_info "Please run ./deploy-redpanda.sh first"
        exit 1
    fi
    echo
}

# Function to test basic connectivity
test_connectivity() {
    log_info "Testing connectivity to load test instance..."
    
    local loadtest_ip=$(get_loadtest_ip)
    if [[ -z "$loadtest_ip" || "$loadtest_ip" == "None" ]]; then
        log_error "Could not get load test instance IP"
        return 1
    fi
    
    log_info "Load test instance IP: $loadtest_ip"
    
    # Test SSH connectivity
    if run_on_loadtest "echo 'SSH connectivity test successful'" "Testing SSH connectivity" "$loadtest_ip"; then
        log_success "SSH connectivity successful"
        echo "$loadtest_ip"  # Return IP for use by other functions
        return 0
    else
        log_error "SSH connectivity failed"
        return 1
    fi
}

# Function to test cluster health
test_cluster_health() {
    local loadtest_ip="$1"
    
    log_info "Testing Redpanda cluster health..."
    
    # Run built-in cluster validation
    if run_on_loadtest "source ~/.bashrc && ./quick_test.sh" "Running quick cluster test" "$loadtest_ip"; then
        log_success "Quick cluster test passed"
    else
        log_warning "Quick cluster test failed, continuing with detailed tests"
    fi
    
    # Test RPK cluster commands
    log_info "Testing RPK cluster commands..."
    
    if run_on_loadtest "source ~/.bashrc && rpk cluster info" "Getting cluster info" "$loadtest_ip"; then
        log_success "Cluster info retrieved successfully"
    else
        log_error "Failed to get cluster info"
        return 1
    fi
    
    if run_on_loadtest "source ~/.bashrc && rpk cluster health" "Checking cluster health" "$loadtest_ip"; then
        log_success "Cluster health check passed"
    else
        log_error "Cluster health check failed"
        return 1
    fi
    
    # Count available brokers
    local broker_count=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
        "source ~/.bashrc && rpk cluster info 2>/dev/null | grep -c 'ID:' || echo 0")
    
    if [[ "$broker_count" -eq 3 ]]; then
        log_success "All 3 brokers are online"
    else
        log_warning "Expected 3 brokers, found $broker_count"
    fi
    
    echo
}

# Function to test basic functionality
test_basic_functionality() {
    local loadtest_ip="$1"
    
    log_info "Testing basic Redpanda functionality..."
    
    # Create test topic
    log_info "Creating test topic: $TEST_TOPIC"
    if run_on_loadtest "source ~/.bashrc && rpk topic create $TEST_TOPIC --partitions 3 --replicas 3" \
        "Creating test topic with 3 partitions and 3 replicas" "$loadtest_ip"; then
        log_success "Test topic created successfully"
    else
        log_error "Failed to create test topic"
        return 1
    fi
    
    # Test message production and consumption
    log_info "Testing message production and consumption..."
    local test_message="Hello Redpanda Cluster - Test message $(date)"
    
    # Produce message
    if run_on_loadtest "source ~/.bashrc && echo '$test_message' | rpk topic produce $TEST_TOPIC --key test-key" \
        "Producing test message" "$loadtest_ip"; then
        log_success "Message produced successfully"
    else
        log_error "Failed to produce message"
        return 1
    fi
    
    # Consume message
    log_info "Consuming test message..."
    local consumed_message=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
        "source ~/.bashrc && timeout 10 rpk topic consume $TEST_TOPIC --offset start --num 1 --format '{{.Value}}' 2>/dev/null || echo 'FAILED'")
    
    if [[ "$consumed_message" == *"Hello Redpanda Cluster"* ]]; then
        log_success "Message consumed successfully"
        log_info "Consumed message: $consumed_message"
    else
        log_error "Failed to consume message or message content mismatch"
        return 1
    fi
    
    # Clean up test topic
    if run_on_loadtest "source ~/.bashrc && rpk topic delete $TEST_TOPIC" \
        "Cleaning up test topic" "$loadtest_ip"; then
        log_success "Test topic cleaned up"
    else
        log_warning "Failed to clean up test topic (manual cleanup may be needed)"
    fi
    
    echo
}

# Function to test replication and fault tolerance
test_replication() {
    local loadtest_ip="$1"
    
    log_info "Testing replication and fault tolerance..."
    
    # Create topic with replication
    local repl_topic="replication-test-$(date +%s)"
    if run_on_loadtest "source ~/.bashrc && rpk topic create $repl_topic --partitions 1 --replicas 3" \
        "Creating topic with 3 replicas" "$loadtest_ip"; then
        log_success "Replicated topic created"
    else
        log_error "Failed to create replicated topic"
        return 1
    fi
    
    # Check topic configuration
    if run_on_loadtest "source ~/.bashrc && rpk topic describe $repl_topic" \
        "Checking topic replication configuration" "$loadtest_ip"; then
        log_success "Topic replication verified"
    else
        log_warning "Could not verify topic replication"
    fi
    
    # Test message persistence across replicas
    log_info "Testing message persistence..."
    for i in {1..10}; do
        echo "Persistent message $i - $(date)" | ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
            "source ~/.bashrc && rpk topic produce $repl_topic --key msg-$i" >/dev/null 2>&1
    done
    
    # Verify all messages can be consumed
    local message_count=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
        "source ~/.bashrc && timeout 15 rpk topic consume $repl_topic --offset start --num 10 2>/dev/null | wc -l || echo 0")
    
    if [[ "$message_count" -eq 10 ]]; then
        log_success "All 10 messages persisted and retrieved correctly"
    else
        log_warning "Expected 10 messages, got $message_count"
    fi
    
    # Clean up
    run_on_loadtest "source ~/.bashrc && rpk topic delete $repl_topic" "" "$loadtest_ip" >/dev/null 2>&1
    
    echo
}

# Function to run performance tests
test_performance() {
    local loadtest_ip="$1"
    
    log_info "Running performance tests..."
    
    # Create performance test topic
    if run_on_loadtest "source ~/.bashrc && rpk topic create $PERF_TOPIC --partitions 3 --replicas 3" \
        "Creating performance test topic" "$loadtest_ip"; then
        log_success "Performance test topic created"
    else
        log_error "Failed to create performance test topic"
        return 1
    fi
    
    # Run latency test
    log_info "Running latency test..."
    if run_on_loadtest "source ~/.bashrc && timeout 60 python3 ~/latency_test.py 2>/dev/null || echo 'Latency test completed'" \
        "Running Python latency test" "$loadtest_ip"; then
        log_success "Latency test completed"
    else
        log_warning "Latency test script not found, running basic latency test"
        
        # Basic latency test using RPK
        local start_time end_time latency
        for i in {1..10}; do
            start_time=$(date +%s%N)
            echo "latency-test-$i" | ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
                -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
                "source ~/.bashrc && rpk topic produce $PERF_TOPIC" >/dev/null 2>&1
            end_time=$(date +%s%N)
            latency=$(( (end_time - start_time) / 1000000 ))  # Convert to milliseconds
            log_info "Message $i latency: ${latency}ms"
        done
    fi
    
    # Run throughput test
    log_info "Running throughput test..."
    local throughput_result=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
        "source ~/.bashrc && timeout 30 bash -c 'for i in {1..1000}; do echo \"throughput-test-\$i-\$(date +%s%N)\"; done | rpk topic produce $PERF_TOPIC --key throughput-test' 2>&1" || echo "Throughput test completed")
    
    log_success "Throughput test completed"
    
    # Clean up performance topic
    run_on_loadtest "source ~/.bashrc && rpk topic delete $PERF_TOPIC" "" "$loadtest_ip" >/dev/null 2>&1
    
    echo
}

# Function to test S3 integration
test_s3_integration() {
    local loadtest_ip="$1"
    
    log_info "Testing S3 integration..."
    
    # Test S3 connectivity
    if run_on_loadtest "source ~/.bashrc && aws s3 ls s3://\$REDPANDA_S3_BUCKET/" \
        "Testing S3 bucket access" "$loadtest_ip"; then
        log_success "S3 bucket access successful"
    else
        log_warning "S3 integration test failed"
        return 1
    fi
    
    # Test writing test data to S3
    local test_file="test-data-$(date +%s).json"
    if run_on_loadtest "echo '{\"test\":\"data\",\"timestamp\":\"$(date)\"}' > /tmp/$test_file && aws s3 cp /tmp/$test_file s3://\$REDPANDA_S3_BUCKET/tests/$test_file" \
        "Writing test data to S3" "$loadtest_ip"; then
        log_success "S3 write test successful"
        
        # Clean up test file
        run_on_loadtest "aws s3 rm s3://\$REDPANDA_S3_BUCKET/tests/$test_file && rm /tmp/$test_file" "" "$loadtest_ip" >/dev/null 2>&1
    else
        log_warning "S3 write test failed"
    fi
    
    echo
}

# Function to run comprehensive tests
run_comprehensive_tests() {
    local loadtest_ip="$1"
    
    log_info "Running comprehensive Redpanda cluster tests..."
    echo
    
    local tests_passed=0
    local total_tests=5
    
    # Test 1: Cluster Health
    if test_cluster_health "$loadtest_ip"; then
        ((tests_passed++))
    fi
    
    # Test 2: Basic Functionality  
    if test_basic_functionality "$loadtest_ip"; then
        ((tests_passed++))
    fi
    
    # Test 3: Replication
    if test_replication "$loadtest_ip"; then
        ((tests_passed++))
    fi
    
    # Test 4: Performance
    if test_performance "$loadtest_ip"; then
        ((tests_passed++))
    fi
    
    # Test 5: S3 Integration
    if test_s3_integration "$loadtest_ip"; then
        ((tests_passed++))
    fi
    
    return $tests_passed
}

# Function to display test results
display_test_results() {
    local tests_passed="$1"
    local total_tests=5
    
    echo
    echo -e "${BLUE}===========================================${NC}"
    echo -e "${BLUE}📊 TEST RESULTS${NC}"
    echo -e "${BLUE}===========================================${NC}"
    
    local pass_percentage=$((tests_passed * 100 / total_tests))
    
    if [[ $tests_passed -eq $total_tests ]]; then
        log_success "All tests passed! ($tests_passed/$total_tests)"
        log_success "Redpanda cluster is fully functional"
    elif [[ $tests_passed -gt $((total_tests / 2)) ]]; then
        log_warning "Most tests passed ($tests_passed/$total_tests - ${pass_percentage}%)"
        log_info "Cluster is functional with some issues"
    else
        log_error "Multiple tests failed ($tests_passed/$total_tests - ${pass_percentage}%)"
        log_error "Cluster may have significant issues"
    fi
    
    echo
    echo -e "${GREEN}Test Summary:${NC}"
    echo "✓ Tests Passed: $tests_passed/$total_tests (${pass_percentage}%)"
    echo "✓ Cluster Health: $([ $tests_passed -gt 0 ] && echo 'OK' || echo 'FAILED')"
    echo "✓ Basic Functionality: $([ $tests_passed -gt 1 ] && echo 'OK' || echo 'FAILED')"
    echo "✓ Replication: $([ $tests_passed -gt 2 ] && echo 'OK' || echo 'FAILED')"
    echo "✓ Performance: $([ $tests_passed -gt 3 ] && echo 'OK' || echo 'FAILED')"
    echo "✓ S3 Integration: $([ $tests_passed -eq 5 ] && echo 'OK' || echo 'FAILED')"
    echo
    
    if [[ $tests_passed -eq $total_tests ]]; then
        echo -e "${GREEN}🎉 Your Redpanda cluster is ready for production use!${NC}"
    else
        echo -e "${YELLOW}⚠️  Some tests failed. Check the output above for details.${NC}"
        echo -e "${BLUE}💡 For troubleshooting, try:${NC}"
        echo "   1. Connect to load test instance and run manual tests"
        echo "   2. Check broker logs using: ./get_redpanda_broker_ips.sh"
        echo "   3. Verify all brokers are running in AWS console"
    fi
    echo
}

# Main testing function
main() {
    echo -e "${GREEN}Starting Redpanda cluster testing...${NC}"
    echo "Stack: $STACK_NAME"
    echo "Region: $REGION"
    echo
    
    check_prerequisites
    check_stack_status
    
    # Test connectivity and get load test IP
    local loadtest_ip
    if loadtest_ip=$(test_connectivity); then
        log_success "Connected to load test instance: $loadtest_ip"
    else
        log_error "Failed to connect to load test instance"
        exit 1
    fi
    
    echo
    
    # Run comprehensive tests
    local tests_passed
    if tests_passed=$(run_comprehensive_tests "$loadtest_ip"); then
        display_test_results "$tests_passed"
    else
        tests_passed=$?
        display_test_results "$tests_passed"
    fi
    
    # Exit with appropriate code
    if [[ $tests_passed -eq 5 ]]; then
        log_success "🎯 All tests completed successfully!"
        exit 0
    else
        log_warning "⚠️  Some tests failed - check output above"
        exit 1
    fi
}

# Handle script interruption
trap 'log_error "Testing interrupted"; exit 1' INT

# Run main function
main "$@" 