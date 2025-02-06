#!/bin/bash
set -e

# Get AWS account ID and set region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION="us-east-1"
STACK_NAME="ShastaCdkStackL1"

# Authenticate with ECR
echo "🔑 Authenticating with ECR..."
if ! aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com; then
    echo "❌ ECR authentication failed"
    exit 1
fi

# Get ECR repository URI
echo "📦 Getting ECR repository URI..."
ECR_REPO_URI=$(aws cloudformation describe-stacks --region ${AWS_REGION} --stack-name ${STACK_NAME} --query 'Stacks[0].Outputs[?ExportName==`ShastaCdkEcrRepoUri`].OutputValue' --output text)

# Create and use buildx builder
echo "🏗️  Setting up multi-architecture builder..."
docker run --privileged --rm tonistiigi/binfmt --install all
docker buildx ls
docker buildx create --use

# Build and push multi-architecture image
echo "🏗️  Building and pushing multi-architecture image..."
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ${ECR_REPO_URI}:latest \
  --push \
  .

echo "✅ Multi-architecture image push complete!"
