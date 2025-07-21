#!/bin/bash
set -euo pipefail

# Simple RedPanda Cluster Deployment Script
# Wrapper around the main aws-redpanda-deploy.sh script

echo "🚀 RedPanda Low-Latency Cluster Deployment"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [[ ! -f "bin/shasta-cdk.ts" ]] || [[ ! -d "scripts" ]]; then
    echo "❌ Error: Please run this script from the CDK project root directory"
    echo "   Expected files: bin/shasta-cdk.ts, scripts/"
    exit 1
fi

# Make sure scripts are executable
chmod +x scripts/*.sh

# Check if user wants to deploy or just see help
case "${1:-deploy}" in
    "deploy"|"d")
        echo "🔧 Starting infrastructure deployment (CDK)..."
        echo ""
        exec ./scripts/aws-infrastructure-deploy.sh deploy
        ;;
    "status"|"s")
        echo "📊 Checking deployment status..."
        echo ""
        exec ./scripts/aws-infrastructure-deploy.sh status
        ;;
    "setup"|"i")
        echo "⚙️  Setting up RedPanda on deployed infrastructure..."
        echo ""
        exec ./scripts/setup-cluster-post-deploy.sh
        ;;
    "test"|"t")
        echo "🧪 Running performance tests..."
        echo ""
        echo "First deploy infrastructure, then set up RedPanda:"
        echo "./deploy.sh deploy && ./deploy.sh setup"
        ;;
    "destroy"|"delete")
        echo "💥 Destroying infrastructure..."
        echo ""
        exec ./scripts/aws-infrastructure-deploy.sh destroy
        ;;
    "help"|"h"|*)
        cat << 'EOF'
RedPanda Low-Latency Cluster Deployment

Usage:
  ./deploy.sh [COMMAND]

Commands:
  deploy, d     Deploy AWS infrastructure (EC2, VPC, etc.) via CDK
  setup, i      Install and configure RedPanda on deployed instances
  status, s     Show current infrastructure deployment status  
  test, t       Show instructions for running performance tests
  destroy       Destroy all AWS infrastructure (CAREFUL!)
  help, h       Show this help message

What gets deployed:
  ✅ VPC with public/private subnets across 3 AZs
  ✅ 3x RedPanda nodes (i4i.2xlarge) for low latency
  ✅ 1x Load testing instance (c5n.4xlarge) 
  ✅ Security groups configured for RedPanda ports
  ✅ High-performance GP3 storage with 16K IOPS
  ✅ Automation scripts for management and testing
  ✅ SSH access via john.davis.pem key
  ✅ AWS SSM Session Manager access

Quick Start:
  1. Ensure AWS CLI is configured: aws configure
  2. Have john.davis.pem key pair in us-east-1
  3. Deploy infrastructure: ./deploy.sh deploy
  4. Set up RedPanda: ./deploy.sh setup
  5. Test cluster via SSH (see output for details)

Environment Variables (optional):
  AWS_REGION=us-east-1         # AWS region
  KEY_PAIR_NAME=john.davis     # EC2 key pair name
  STACK_PREFIX=ShastaCdk       # CloudFormation stack prefix

Example with custom settings:
  AWS_REGION=us-west-2 KEY_PAIR_NAME=my-key ./deploy.sh deploy

For detailed documentation, see:
  - REDPANDA_DEPLOYMENT_GUIDE.md
  - scripts/README.md

EOF
        ;;
esac 