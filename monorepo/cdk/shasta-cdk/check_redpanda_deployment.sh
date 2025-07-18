#!/bin/bash

# Redpanda Deployment Status Checker with Rate Limiting Handling
# This script checks the status of Redpanda instances and handles AWS API rate limits

set -e

# Configuration
REGION="us-east-1"
MAX_RETRIES=5
BASE_DELAY=2

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to perform AWS CLI calls with exponential backoff
aws_with_retry() {
    local cmd="$1"
    local retry_count=0
    
    while [ $retry_count -lt $MAX_RETRIES ]; do
        local delay=$((BASE_DELAY * (2 ** retry_count)))
        local jitter=$((RANDOM % 3))
        local total_delay=$((delay + jitter))
        
        print_status $BLUE "Executing: $cmd (attempt $((retry_count + 1))/$MAX_RETRIES)"
        
        if eval "$cmd" 2>/dev/null; then
            return 0
        else
            local exit_code=$?
            if [ $retry_count -lt $((MAX_RETRIES - 1)) ]; then
                print_status $YELLOW "Command failed (exit code: $exit_code). Retrying in $total_delay seconds..."
                sleep $total_delay
            else
                print_status $RED "Command failed after $MAX_RETRIES attempts."
                return $exit_code
            fi
        fi
        
        retry_count=$((retry_count + 1))
    done
}

# Function to check CloudFormation stack status
check_stack_status() {
    local stack_name=$1
    print_status $BLUE "Checking CloudFormation stack: $stack_name"
    
    local cmd="aws cloudformation describe-stacks --stack-name $stack_name --region $REGION --query 'Stacks[0].StackStatus' --output text"
    local status
    
    if status=$(aws_with_retry "$cmd"); then
        print_status $GREEN "Stack Status: $status"
        return 0
    else
        print_status $RED "Failed to get stack status"
        return 1
    fi
}

# Function to get instance information
get_instance_info() {
    local instance_id=$1
    print_status $BLUE "Getting information for instance: $instance_id"
    
    local cmd="aws ec2 describe-instances --instance-ids $instance_id --region $REGION --query 'Reservations[0].Instances[0].[InstanceId,State.Name,PublicIpAddress,PrivateIpAddress]' --output table"
    
    if aws_with_retry "$cmd"; then
        return 0
    else
        print_status $RED "Failed to get instance information"
        return 1
    fi
}

# Function to check SSM agent status
check_ssm_status() {
    local instance_id=$1
    print_status $BLUE "Checking SSM agent status for instance: $instance_id"
    
    local cmd="aws ssm describe-instance-information --region $REGION --query \"InstanceInformationList[?InstanceId=='$instance_id'].[InstanceId,PingStatus,LastPingDateTime]\" --output table"
    
    if aws_with_retry "$cmd"; then
        return 0
    else
        print_status $YELLOW "SSM agent not ready or failed to check status"
        return 1
    fi
}

# Function to get stack outputs
get_stack_outputs() {
    local stack_name=$1
    print_status $BLUE "Getting stack outputs for: $stack_name"
    
    local cmd="aws cloudformation describe-stacks --stack-name $stack_name --region $REGION --query 'Stacks[0].Outputs' --output table"
    
    if aws_with_retry "$cmd"; then
        return 0
    else
        print_status $RED "Failed to get stack outputs"
        return 1
    fi
}

# Main execution
main() {
    print_status $GREEN "=== Redpanda Deployment Status Checker ==="
    print_status $BLUE "Region: $REGION"
    echo
    
    # Check if AWS CLI is configured
    if ! aws sts get-caller-identity --region $REGION >/dev/null 2>&1; then
        print_status $RED "AWS CLI not configured or no permissions. Please configure AWS CLI first."
        exit 1
    fi
    
    # Define stack names (adjust these to match your actual stack names)
    local redpanda_stack_name="ShastaRedpandaStack"
    local base_stack_name="ShastaCdkStack"
    
    # Check base stack status
    print_status $GREEN "=== Checking Base Stack ==="
    check_stack_status "$base_stack_name"
    echo
    
    # Check Redpanda stack status
    print_status $GREEN "=== Checking Redpanda Stack ==="
    if check_stack_status "$redpanda_stack_name"; then
        echo
        print_status $GREEN "=== Getting Stack Outputs ==="
        get_stack_outputs "$redpanda_stack_name"
        echo
        
        # Try to get instance IDs from stack outputs
        print_status $GREEN "=== Checking Instance Status ==="
        local broker_ids_cmd="aws cloudformation describe-stacks --stack-name $redpanda_stack_name --region $REGION --query 'Stacks[0].Outputs[?OutputKey==\`RedpandaBrokerInstanceIds\`].OutputValue' --output text"
        local loadtest_id_cmd="aws cloudformation describe-stacks --stack-name $redpanda_stack_name --region $REGION --query 'Stacks[0].Outputs[?OutputKey==\`RedpandaLoadTestInstanceId\`].OutputValue' --output text"
        
        if broker_ids=$(aws_with_retry "$broker_ids_cmd"); then
            IFS=',' read -ra BROKER_ARRAY <<< "$broker_ids"
            for broker_id in "${BROKER_ARRAY[@]}"; do
                if [ -n "$broker_id" ]; then
                    get_instance_info "$broker_id"
                    check_ssm_status "$broker_id"
                    echo
                fi
            done
        fi
        
        if loadtest_id=$(aws_with_retry "$loadtest_id_cmd"); then
            if [ -n "$loadtest_id" ]; then
                get_instance_info "$loadtest_id"
                check_ssm_status "$loadtest_id"
                echo
            fi
        fi
    fi
    
    print_status $GREEN "=== Status Check Complete ==="
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo "Options:"
        echo "  --help, -h    Show this help message"
        echo "  --region, -r  Set AWS region (default: us-east-1)"
        echo ""
        echo "This script checks the status of Redpanda deployment with built-in retry logic"
        echo "to handle AWS API rate limiting issues."
        exit 0
        ;;
    --region|-r)
        REGION="$2"
        shift 2
        ;;
esac

# Run main function
main "$@" 