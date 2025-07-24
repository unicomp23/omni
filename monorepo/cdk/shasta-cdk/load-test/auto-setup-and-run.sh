#!/bin/bash

# Auto-setup and run script for RedPanda load test
# This can be run directly on the load test instance

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

echo "RedPanda Load Test Auto-Setup"
echo "============================="

log_info "Starting RedPanda load test auto-setup process"
start_time=$(date +%s)

log_debug "Environment variables:"
log_debug "  DEBUG: ${DEBUG:-false}"
log_debug "  REDPANDA_BROKERS: ${REDPANDA_BROKERS:-not set}"
log_debug "  AWS_DEFAULT_REGION: ${AWS_DEFAULT_REGION:-us-east-1}"
log_debug "  STACK_NAME: ${STACK_NAME:-RedPandaClusterStack}"
log_debug "  Working directory: $(pwd)"

# Install Go if not present
log_info "Checking Go installation"
if ! which go > /dev/null 2>&1; then
    log_info "Go not found, installing Go..."
    log_debug "Installing Go via yum package manager"
    
    install_start=$(date +%s)
    sudo yum install -y go
    install_end=$(date +%s)
    install_duration=$((install_end - install_start))
    
    go_version=$(go version 2>/dev/null || echo "Failed to get Go version")
    log_info "Go installed successfully in ${install_duration} seconds: $go_version"
    echo "📦 Installing Go..."
    echo "✅ Go installed successfully: $(go version)"
else
    go_version=$(go version)
    log_debug "Go already installed: $go_version"
    echo "✅ Go already installed: $(go version)"
fi

# Build binary if not present or source is newer
log_info "Checking load test binary status"
should_build=false

if [ ! -f "./load-test" ]; then
    log_debug "Binary not found, will build"
    should_build=true
elif [ "main.go" -nt "./load-test" ]; then
    log_debug "Source file is newer than binary, will rebuild"
    should_build=true
else
    log_debug "Binary is up to date"
fi

if [ "$should_build" = "true" ]; then
    log_info "Building load test binary from source"
    log_debug "Go module file exists: $(test -f go.mod && echo 'yes' || echo 'no')"
    
    build_start=$(date +%s)
    echo "🔨 Building load test binary..."
    
    # Ensure go.mod is up to date
    if [ -f "go.mod" ]; then
        log_debug "Running 'go mod tidy' to update dependencies"
        if [ "${DEBUG:-false}" = "true" ]; then
            go mod tidy -v
        else
            go mod tidy 2>&1 | tee /tmp/go-mod-tidy.log
        fi
    else
        log_warn "No go.mod file found, creating one"
        go mod init load-test
        go mod tidy
    fi
    
    # Build the binary
    log_debug "Building binary with 'go build'"
    if [ "${DEBUG:-false}" = "true" ]; then
        go build -v -o load-test main.go
    else
        go build -o load-test main.go 2>&1 | tee /tmp/go-build.log
    fi
    
    build_end=$(date +%s)
    build_duration=$((build_end - build_start))
    
    if [ -f "./load-test" ]; then
        binary_size=$(stat -c%s "./load-test" 2>/dev/null || echo "unknown")
        log_debug "Binary built successfully in ${build_duration} seconds (size: ${binary_size} bytes)"
        echo "✅ Binary built successfully"
    else
        log_error "Binary build failed - file not found after build"
        log_debug "Build log: $(cat /tmp/go-build.log 2>/dev/null || echo 'No build log')"
        echo "❌ Binary build failed"
        exit 1
    fi
else
    binary_info=$(ls -la "./load-test" 2>/dev/null || echo "Failed to stat binary")
    log_debug "Using existing binary: $binary_info"
    echo "✅ Binary is up to date"
fi

# Make scripts executable
log_debug "Making shell scripts executable"
chmod +x *.sh 2>/dev/null || log_warn "Failed to make some scripts executable"

# Auto-discover RedPanda brokers if not set
if [ -z "$REDPANDA_BROKERS" ]; then
    log_info "REDPANDA_BROKERS not set, attempting auto-discovery"
    echo "🔍 Auto-discovering RedPanda brokers..."
    
    # Try to get from CloudFormation if AWS CLI is available
    if which aws > /dev/null 2>&1; then
        log_debug "AWS CLI found, attempting CloudFormation discovery"
        aws_version=$(aws --version 2>&1 || echo "Failed to get AWS version")
        log_debug "AWS CLI version: $aws_version"
        
        discovery_start=$(date +%s)
        BOOTSTRAP_BROKERS=$(aws cloudformation describe-stacks \
            --region ${AWS_DEFAULT_REGION:-us-east-1} \
            --stack-name ${STACK_NAME:-RedPandaClusterStack} \
            --query "Stacks[0].Outputs[?OutputKey=='RedPandaBootstrapBrokers'].OutputValue" \
            --output text 2>/dev/null || echo "")
        discovery_end=$(date +%s)
        discovery_duration=$((discovery_end - discovery_start))
        
        log_debug "CloudFormation query completed in ${discovery_duration} seconds"
        
        if [ -n "$BOOTSTRAP_BROKERS" ]; then
            export REDPANDA_BROKERS="$BOOTSTRAP_BROKERS"
            log_info "Successfully discovered brokers: $REDPANDA_BROKERS"
            echo "✅ Found brokers: $REDPANDA_BROKERS"
        else
            log_error "CloudFormation query returned empty result"
            log_debug "Stack name: ${STACK_NAME:-RedPandaClusterStack}"
            log_debug "Region: ${AWS_DEFAULT_REGION:-us-east-1}"
            echo "⚠️  Could not auto-discover brokers from CloudFormation"
            echo "Please set REDPANDA_BROKERS environment variable"
            echo "Example: export REDPANDA_BROKERS='10.1.0.1:9092,10.1.1.1:9092,10.1.2.1:9092'"
            exit 1
        fi
    else
        log_error "AWS CLI not found in PATH"
        log_debug "PATH: $PATH"
        echo "⚠️  AWS CLI not available for auto-discovery"
        echo "Please set REDPANDA_BROKERS environment variable"
        exit 1
    fi
else
    log_debug "REDPANDA_BROKERS already set: $REDPANDA_BROKERS"
    echo "✅ Using provided brokers: $REDPANDA_BROKERS"
fi

setup_end=$(date +%s)
setup_duration=$((setup_end - start_time))
log_info "Auto-setup completed successfully in ${setup_duration} seconds"

echo ""
echo "🚀 Setup complete! Ready to run load tests."
echo ""
echo "Available options:"
echo "1. Quick test (30s): ./run.sh --duration=30s"
echo "2. Throughput test: ./run.sh --producers=6 --consumers=6 --duration=5m"
echo "3. Custom test: ./run.sh --help"
echo ""

# Check if there are any command line arguments passed to the script
if [ $# -gt 0 ]; then
    log_info "Command line arguments provided, running load test with: $*"
    echo "🎯 Running load test with provided arguments..."
    
    test_start=$(date +%s)
    ./run.sh "$@"
    test_end=$(date +%s)
    test_duration=$((test_end - test_start))
    
    log_info "Load test completed in ${test_duration} seconds"
    
    total_duration=$((test_end - start_time))
    log_info "Total execution time (setup + test): ${total_duration} seconds"
else
    log_debug "No command line arguments provided, setup only"
    echo "💡 Run './run.sh --help' for load test options"
fi

log_info "Auto-setup script completed successfully" 