#!/bin/bash

# Redpanda Cluster Cleanup Script
# This script safely destroys all Redpanda resources and cleans up local files

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
echo -e "${BLUE}🧹 REDPANDA CLUSTER CLEANUP${NC}"
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

# Function to prompt for confirmation
confirm_action() {
    local prompt="$1"
    local default="${2:-n}"
    
    if [[ "$default" == "y" ]]; then
        read -p "$prompt [Y/n]: " -n 1 -r
        echo
        [[ $REPLY =~ ^[Nn]$ ]] && return 1 || return 0
    else
        read -p "$prompt [y/N]: " -n 1 -r
        echo
        [[ $REPLY =~ ^[Yy]$ ]] && return 0 || return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking cleanup prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found"
        exit 1
    fi
    
    # Check CDK CLI
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK CLI not found"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured"
        exit 1
    fi
    
    log_success "Prerequisites met"
    echo
}

# Function to get current stack status
get_stack_status() {
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND"
}

# Function to check what resources will be deleted
show_resources_to_delete() {
    log_info "Resources that will be deleted:"
    echo
    
    local stack_status=$(get_stack_status)
    
    if [[ "$stack_status" == "NOT_FOUND" ]]; then
        log_warning "Stack $STACK_NAME not found - no CDK resources to delete"
        return 1
    fi
    
    # Get stack resources
    log_info "📋 CDK Stack Resources:"
    aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" --region "$REGION" \
        --query 'StackResources[].[ResourceType,LogicalResourceId]' --output table 2>/dev/null || {
        log_warning "Could not retrieve stack resources"
    }
    
    echo
    
    # Get running instances
    log_info "💻 EC2 Instances:"
    local instances=$(aws ec2 describe-instances --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/*" \
                 "Name=instance-state-name,Values=running,stopped,stopping" \
        --query 'Reservations[].Instances[].[InstanceId,Tags[?Key==`Name`].Value|[0],State.Name]' \
        --output table 2>/dev/null)
    
    if [[ -n "$instances" ]]; then
        echo "$instances"
    else
        log_info "No EC2 instances found"
    fi
    
    echo
    
    # Get S3 bucket
    log_info "🪣 S3 Buckets:"
    local bucket_name="redpanda-data-$(aws sts get-caller-identity --query Account --output text)-$REGION"
    if aws s3api head-bucket --bucket "$bucket_name" --region "$REGION" 2>/dev/null; then
        local object_count=$(aws s3 ls s3://$bucket_name --recursive --summarize 2>/dev/null | grep "Total Objects:" | awk '{print $3}' || echo "unknown")
        log_info "Bucket: $bucket_name (contains $object_count objects)"
    else
        log_info "S3 bucket not found or already deleted"
    fi
    
    echo
    
    return 0
}

# Function to backup important data (optional)
backup_data() {
    if ! confirm_action "Do you want to backup cluster metadata before cleanup?"; then
        return 0
    fi
    
    log_info "Creating backup of cluster metadata..."
    
    local backup_dir="./redpanda-backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    
    # Backup stack outputs
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
        --query 'Stacks[0].Outputs' > "$backup_dir/stack-outputs.json" 2>/dev/null; then
        log_success "Stack outputs backed up"
    fi
    
    # Backup stack template
    if aws cloudformation get-template --stack-name "$STACK_NAME" --region "$REGION" \
        > "$backup_dir/stack-template.json" 2>/dev/null; then
        log_success "Stack template backed up"
    fi
    
    # Backup instance information
    aws ec2 describe-instances --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/*" \
        > "$backup_dir/instances.json" 2>/dev/null || true
    
    # Try to backup topics list from load test instance
    local loadtest_ip=$(aws ec2 describe-instances --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/RedpandaLoadTest" \
                 "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].PublicIpAddress' --output text 2>/dev/null)
    
    if [[ -n "$loadtest_ip" && "$loadtest_ip" != "None" ]]; then
        log_info "Attempting to backup Redpanda topics list..."
        if timeout 30 ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@$loadtest_ip \
            "source ~/.bashrc && rpk topic list" > "$backup_dir/topics-list.txt" 2>/dev/null; then
            log_success "Topics list backed up"
        else
            log_warning "Could not backup topics list"
        fi
    fi
    
    log_success "Backup created in: $backup_dir"
    echo
}

# Function to terminate running instances (for faster cleanup)
terminate_instances() {
    log_info "Terminating running instances for faster cleanup..."
    
    local instance_ids=$(aws ec2 describe-instances --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/*" \
                 "Name=instance-state-name,Values=running,stopped" \
        --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null)
    
    if [[ -n "$instance_ids" ]]; then
        log_info "Terminating instances: $instance_ids"
        if aws ec2 terminate-instances --instance-ids $instance_ids --region "$REGION" >/dev/null 2>&1; then
            log_success "Instance termination initiated"
            
            # Wait for instances to terminate
            log_info "Waiting for instances to terminate (max 5 minutes)..."
            local attempts=0
            local max_attempts=30
            
            while [[ $attempts -lt $max_attempts ]]; do
                local running_count=$(aws ec2 describe-instances --instance-ids $instance_ids --region "$REGION" \
                    --query 'Reservations[].Instances[?State.Name==`running`].InstanceId' --output text 2>/dev/null | wc -w)
                
                if [[ $running_count -eq 0 ]]; then
                    log_success "All instances terminated"
                    break
                else
                    log_info "Waiting for $running_count instances to terminate... (${attempts}/${max_attempts})"
                    sleep 10
                    ((attempts++))
                fi
            done
        else
            log_warning "Failed to terminate instances, CDK destroy will handle it"
        fi
    else
        log_info "No instances to terminate"
    fi
    
    echo
}

# Function to clean up S3 bucket contents
cleanup_s3_bucket() {
    log_info "Cleaning up S3 bucket contents..."
    
    local bucket_name="redpanda-data-$(aws sts get-caller-identity --query Account --output text)-$REGION"
    
    if aws s3api head-bucket --bucket "$bucket_name" --region "$REGION" 2>/dev/null; then
        log_info "Emptying S3 bucket: $bucket_name"
        
        # Empty the bucket
        if aws s3 rm s3://$bucket_name --recursive --region "$REGION" 2>/dev/null; then
            log_success "S3 bucket emptied"
        else
            log_warning "Failed to empty S3 bucket, CDK destroy will attempt to handle it"
        fi
    else
        log_info "S3 bucket not found or already deleted"
    fi
    
    echo
}

# Function to destroy CDK stack
destroy_cdk_stack() {
    log_info "Destroying CDK stack..."
    log_warning "This operation cannot be undone!"
    
    local stack_status=$(get_stack_status)
    
    if [[ "$stack_status" == "NOT_FOUND" ]]; then
        log_warning "Stack $STACK_NAME not found"
        return 0
    fi
    
    log_info "Current stack status: $stack_status"
    log_info "Starting CDK destroy process..."
    
    # Destroy the stack with timeout
    if timeout 1800 cdk destroy "$STACK_NAME" --force; then
        log_success "CDK stack destroyed successfully"
    else
        log_error "CDK stack destruction failed or timed out"
        log_info "You may need to manually clean up remaining resources in AWS console"
        return 1
    fi
    
    echo
}

# Function to clean up local files
cleanup_local_files() {
    log_info "Cleaning up local files..."
    
    # Remove generated files
    local files_to_clean=(".env" "cdk.out" "node_modules/.cache")
    
    for file in "${files_to_clean[@]}"; do
        if [[ -e "$file" ]]; then
            if confirm_action "Remove local file/directory: $file?"; then
                rm -rf "$file"
                log_success "Removed: $file"
            fi
        fi
    done
    
    # Optionally remove SSH key
    if [[ -f ~/.ssh/${KEY_PAIR_NAME}.pem ]]; then
        if confirm_action "Remove SSH key file: ~/.ssh/${KEY_PAIR_NAME}.pem?"; then
            rm ~/.ssh/${KEY_PAIR_NAME}.pem
            log_success "SSH key file removed"
        fi
    fi
    
    # Clean up SSH known_hosts entries
    if [[ -f ~/.ssh/known_hosts ]]; then
        if confirm_action "Clean up SSH known_hosts entries for this cluster?"; then
            # Remove entries for cluster instances
            sed -i.bak '/redpanda-/d' ~/.ssh/known_hosts 2>/dev/null || true
            log_success "SSH known_hosts cleaned"
        fi
    fi
    
    echo
}

# Function to verify cleanup completion
verify_cleanup() {
    log_info "Verifying cleanup completion..."
    
    # Check stack status
    local stack_status=$(get_stack_status)
    if [[ "$stack_status" == "NOT_FOUND" ]]; then
        log_success "CDK stack successfully removed"
    else
        log_warning "CDK stack still exists (status: $stack_status)"
    fi
    
    # Check for remaining instances
    local remaining_instances=$(aws ec2 describe-instances --region "$REGION" \
        --filters "Name=tag:Name,Values=${STACK_NAME}/*" \
                 "Name=instance-state-name,Values=running,stopped,pending" \
        --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null)
    
    if [[ -z "$remaining_instances" ]]; then
        log_success "No remaining EC2 instances"
    else
        log_warning "Some instances may still be terminating: $remaining_instances"
    fi
    
    # Check S3 bucket
    local bucket_name="redpanda-data-$(aws sts get-caller-identity --query Account --output text)-$REGION"
    if ! aws s3api head-bucket --bucket "$bucket_name" --region "$REGION" 2>/dev/null; then
        log_success "S3 bucket removed"
    else
        log_warning "S3 bucket still exists (may have remaining objects)"
    fi
    
    echo
}

# Function to display cleanup summary
display_cleanup_summary() {
    echo -e "${BLUE}===========================================${NC}"
    echo -e "${BLUE}📊 CLEANUP SUMMARY${NC}"
    echo -e "${BLUE}===========================================${NC}"
    
    log_success "Redpanda cluster cleanup completed!"
    echo
    
    echo -e "${GREEN}What was cleaned up:${NC}"
    echo "✓ CDK stack and all AWS resources"
    echo "✓ EC2 instances (brokers and load test)"
    echo "✓ VPC, subnets, security groups, and networking"
    echo "✓ S3 bucket and stored data"
    echo "✓ IAM roles and policies"
    echo "✓ EBS volumes"
    echo "✓ Local generated files (optional)"
    echo
    
    echo -e "${YELLOW}💰 Cost Impact:${NC}"
    echo "• All hourly charges stopped"
    echo "• No more EC2, VPC, or storage costs"
    echo "• EBS snapshots (if any) may still incur minimal costs"
    echo
    
    echo -e "${BLUE}📋 Post-Cleanup Notes:${NC}"
    echo "• Verify no unexpected charges in AWS billing console"
    echo "• Check CloudWatch logs retention settings if concerned about storage costs"
    echo "• Backup files (if created) are preserved locally"
    echo "• You can redeploy anytime using: ./deploy-redpanda.sh"
    echo
    
    if [[ -d ./redpanda-backup-* ]]; then
        local backup_dirs=$(ls -d ./redpanda-backup-* 2>/dev/null | head -3)
        echo -e "${GREEN}💾 Backups Available:${NC}"
        echo "$backup_dirs"
        echo
    fi
    
    log_success "🎉 Cleanup completed successfully!"
}

# Main cleanup function
main() {
    echo -e "${YELLOW}⚠️  WARNING: This will permanently delete your Redpanda cluster!${NC}"
    echo "Stack: $STACK_NAME"
    echo "Region: $REGION"
    echo
    
    if ! confirm_action "Are you sure you want to proceed with cleanup?"; then
        log_info "Cleanup cancelled by user"
        exit 0
    fi
    
    echo
    
    check_prerequisites
    
    # Show what will be deleted
    if show_resources_to_delete; then
        echo
        if ! confirm_action "Continue with deletion of the above resources?"; then
            log_info "Cleanup cancelled by user"
            exit 0
        fi
    fi
    
    echo
    
    # Optional backup
    backup_data
    
    # Start cleanup process
    log_info "🚀 Starting cleanup process..."
    
    # Clean up S3 first (required for stack deletion)
    cleanup_s3_bucket
    
    # Terminate instances for faster cleanup (optional)
    if confirm_action "Terminate instances immediately for faster cleanup?" "y"; then
        terminate_instances
    fi
    
    # Destroy CDK stack
    destroy_cdk_stack
    
    # Clean up local files
    cleanup_local_files
    
    # Verify cleanup
    verify_cleanup
    
    # Show summary
    display_cleanup_summary
}

# Handle script interruption
trap 'log_error "Cleanup interrupted - some resources may still exist"; exit 1' INT

# Check if running in non-interactive mode
if [[ "$1" == "--force" ]]; then
    log_warning "Running in force mode - skipping confirmations"
    confirm_action() { return 0; }
fi

# Run main function
main "$@" 