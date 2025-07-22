#!/bin/bash

# Auto-setup and run script for RedPanda load test
# This can be run directly on the load test instance

set -e

echo "RedPanda Load Test Auto-Setup"
echo "============================="

# Install Go if not present
if ! which go > /dev/null 2>&1; then
    echo "📦 Installing Go..."
    sudo yum install -y go
    echo "✅ Go installed successfully: $(go version)"
else
    echo "✅ Go already installed: $(go version)"
fi

# Build binary if not present or source is newer
if [ ! -f "./load-test" ] || [ "main.go" -nt "./load-test" ]; then
    echo "🔨 Building load test binary..."
    go mod tidy
    go build -o load-test main.go
    echo "✅ Binary built successfully"
else
    echo "✅ Binary is up to date"
fi

# Make scripts executable
chmod +x *.sh

# Auto-discover RedPanda brokers if not set
if [ -z "$REDPANDA_BROKERS" ]; then
    echo "🔍 Auto-discovering RedPanda brokers..."
    
    # Try to get from CloudFormation if AWS CLI is available
    if which aws > /dev/null 2>&1; then
        BOOTSTRAP_BROKERS=$(aws cloudformation describe-stacks \
            --region ${AWS_DEFAULT_REGION:-us-east-1} \
            --stack-name ${STACK_NAME:-RedPandaClusterStack} \
            --query "Stacks[0].Outputs[?OutputKey=='RedPandaBootstrapBrokers'].OutputValue" \
            --output text 2>/dev/null || echo "")
        
        if [ -n "$BOOTSTRAP_BROKERS" ]; then
            export REDPANDA_BROKERS="$BOOTSTRAP_BROKERS"
            echo "✅ Found brokers: $REDPANDA_BROKERS"
        else
            echo "⚠️  Could not auto-discover brokers from CloudFormation"
            echo "Please set REDPANDA_BROKERS environment variable"
            echo "Example: export REDPANDA_BROKERS='10.1.0.1:9092,10.1.1.1:9092,10.1.2.1:9092'"
            exit 1
        fi
    else
        echo "⚠️  AWS CLI not available for auto-discovery"
        echo "Please set REDPANDA_BROKERS environment variable"
        exit 1
    fi
fi

echo ""
echo "🚀 Ready to run load tests!"
echo "Brokers: $REDPANDA_BROKERS"
echo ""

# Parse command line arguments or provide menu
if [ $# -eq 0 ]; then
    echo "Select test type:"
    echo "1. Quick test (30s, 2 producers/consumers)"
    echo "2. Throughput test (5m, 6 producers/consumers)" 
    echo "3. Custom test"
    echo "4. Interactive quick-tests menu"
    echo ""
    read -p "Enter choice (1-4): " choice
    
    case $choice in
        1)
            echo "Running quick test..."
            ./run.sh --producers 2 --consumers 2 --duration 30s --message-size 1024
            ;;
        2)
            echo "Running throughput test..."
            ./run.sh --producers 6 --consumers 6 --duration 5m --message-size 1024
            ;;
        3)
            echo "Enter custom parameters:"
            read -p "Producers [2]: " producers
            read -p "Consumers [2]: " consumers
            read -p "Duration [30s]: " duration
            read -p "Message size [1024]: " message_size
            
            ./run.sh \
                --producers ${producers:-2} \
                --consumers ${consumers:-2} \
                --duration ${duration:-30s} \
                --message-size ${message_size:-1024}
            ;;
        4)
            ./quick-tests.sh
            ;;
        *)
            echo "Invalid choice"
            exit 1
            ;;
    esac
else
    # Pass through command line arguments
    ./run.sh "$@"
fi 