#!/bin/bash

# RedPanda Cluster Setup Script

set -e

# Enable debug mode if DEBUG environment variable is set
if [ "${DEBUG:-false}" = "true" ]; then
    set -x
    echo "🔍 DEBUG MODE ENABLED"
fi

# Logging functions
log_info() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $1"
}

log_debug() {
    if [ "${DEBUG:-false}" = "true" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [DEBUG] $1"
    fi
}

log_error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $1" >&2
}

log_warn() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] $1"
}

echo "RedPanda Cluster Setup"
echo "====================="

log_info "Starting RedPanda cluster setup process"
start_time=$(date +%s)

# Default configuration
export STACK_NAME="${STACK_NAME:-RedPandaClusterStack}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export KEY_PATH="${KEY_PATH:-/data/.ssh/john.davis.pem}"
export REDPANDA_VERSION="${REDPANDA_VERSION:-v23.3.3}"
export NON_INTERACTIVE="${NON_INTERACTIVE:-false}"

log_debug "Environment variables loaded"
log_debug "DEBUG mode: ${DEBUG:-false}"
log_debug "STACK_NAME: $STACK_NAME"
log_debug "AWS_DEFAULT_REGION: $AWS_DEFAULT_REGION"
log_debug "KEY_PATH: $KEY_PATH"
log_debug "REDPANDA_VERSION: $REDPANDA_VERSION"
log_debug "NON_INTERACTIVE: $NON_INTERACTIVE"

echo "Configuration:"
echo "  Stack Name: $STACK_NAME"
echo "  AWS Region: $AWS_DEFAULT_REGION"
echo "  Key Path: $KEY_PATH"
echo "  RedPanda Version: $REDPANDA_VERSION"
echo "  Non-Interactive: $NON_INTERACTIVE"
echo ""

# Environment validation
log_info "Validating environment and prerequisites"

# Check if key file exists
log_debug "Checking SSH key file existence at: $KEY_PATH"
if [ ! -f "$KEY_PATH" ]; then
    log_error "SSH key file not found at $KEY_PATH"
    log_debug "Attempted key path: $KEY_PATH"
    log_debug "Current working directory: $(pwd)"
    log_debug "Directory contents: $(ls -la 2>/dev/null || echo 'Failed to list directory')"
    echo "❌ ERROR: SSH key file not found at $KEY_PATH"
    echo "Please ensure your SSH key is available or set KEY_PATH environment variable"
    exit 1
fi

log_debug "SSH key file found and accessible"
log_debug "Key file permissions: $(ls -la "$KEY_PATH" 2>/dev/null || echo 'Failed to check permissions')"

# Check if AWS credentials are configured
log_debug "Checking AWS credentials configuration"
log_info "Verifying AWS credentials and connectivity"
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    log_error "AWS credentials not configured or AWS CLI not accessible"
    log_debug "AWS CLI version: $(aws --version 2>&1 || echo 'AWS CLI not found')"
    log_debug "AWS_PROFILE: ${AWS_PROFILE:-not set}"
    log_debug "AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:+***set***}"
    log_debug "AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:+***set***}"
    echo "❌ ERROR: AWS credentials not configured"
    echo "Please run 'aws configure' or set AWS environment variables"
    exit 1
fi

# Log AWS caller identity for debugging
aws_identity=$(aws sts get-caller-identity 2>/dev/null || echo "Failed to get caller identity")
log_debug "AWS caller identity: $aws_identity"
log_info "AWS credentials verified successfully"

# Check if Go is available
log_debug "Checking Go installation"
if ! which go >/dev/null 2>&1; then
    log_error "Go is not installed or not in PATH"
    log_debug "PATH: $PATH"
    echo "❌ ERROR: Go is not installed. Please install Go 1.21 or higher"
    exit 1
fi

go_version=$(go version 2>/dev/null || echo "Failed to get Go version")
log_debug "Go version: $go_version"
log_info "Go installation verified"

# Build the setup tool if needed
log_info "Checking if Go source files are available"
if [ ! -f "main.go" ]; then
    log_error "main.go not found in current directory"
    echo "❌ ERROR: main.go not found. Please run this script from the redpanda-setup directory"
    exit 1
fi

log_debug "Go source files found, will use 'go run' for latest code"
log_debug "Go module file exists: $(test -f go.mod && echo 'yes' || echo 'no')"

# Run the setup tool directly with go run (always uses latest source)
log_info "Launching RedPanda cluster setup tool with go run"
setup_start=$(date +%s)
echo "🚀 Starting RedPanda cluster setup..."

# Pass debug environment to the Go tool
if [ "${DEBUG:-false}" = "true" ]; then
    export DEBUG=true
fi

# Execute the setup tool with go run for latest code
if go run main.go; then
    setup_end=$(date +%s)
    setup_duration=$((setup_end - setup_start))
    total_duration=$((setup_end - start_time))
    
    log_info "RedPanda setup tool completed successfully in ${setup_duration} seconds"
    log_info "Total setup time: ${total_duration} seconds"
    
    echo ""
    echo "🎉 RedPanda cluster setup complete!"
    echo ""
    echo "Next steps:"
    echo "1. Test the cluster with your load testing tool"
    echo "2. Create topics: ssh -i $KEY_PATH ec2-user@<node-ip> 'rpk topic create test-topic -p 12'"
    echo "3. Run load tests: cd ../load-test && ./run.sh"
    echo "4. Check service status: ssh -i $KEY_PATH ec2-user@<node-ip> 'sudo systemctl status redpanda'"
    echo "5. View logs: ssh -i $KEY_PATH ec2-user@<node-ip> 'sudo journalctl -u redpanda --lines=50'"
    echo ""
    echo "The cluster is healthy and ready for use! 🚀"
    
    log_info "Setup completed successfully"
    exit 0
else
    setup_exit_code=$?
    setup_end=$(date +%s)
    setup_duration=$((setup_end - setup_start))
    
    log_error "RedPanda setup tool failed with exit code: $setup_exit_code"
    log_debug "Setup tool execution time: ${setup_duration} seconds"
    
    echo ""
    echo "❌ RedPanda cluster setup failed!"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check the error messages above"
    echo "2. Run with DEBUG=true for detailed logging: DEBUG=true ./setup-cluster.sh"
    echo "3. Verify all EC2 instances are running: aws ec2 describe-instances --region $AWS_DEFAULT_REGION"
    echo "4. Check SSH connectivity: ssh -i $KEY_PATH ec2-user@<node-ip>"
    echo "5. Check service status: ssh -i $KEY_PATH ec2-user@<node-ip> 'sudo systemctl status redpanda'"
    echo "6. View service logs: ssh -i $KEY_PATH ec2-user@<node-ip> 'sudo journalctl -u redpanda --lines=50'"
    echo "7. Check Redpanda configuration: ssh -i $KEY_PATH ec2-user@<node-ip> 'cat /etc/redpanda/redpanda.yaml'"
    echo ""
    log_error "Setup failed. Check logs above for details."
    exit 1
fi 