#!/bin/bash

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Set AWS region and disable pager
AWS_REGION="us-east-1"
export AWS_PAGER=""

# Create local directory for reports if it doesn't exist
LOCAL_DIR="reports"
mkdir -p "${LOCAL_DIR}"

# Sync reports FROM S3 to local
echo "Downloading reports from S3..."
aws s3 sync "s3://cantina-jd/golang.reports/data/" "${LOCAL_DIR}" \
    --region ${AWS_REGION} \
    --exclude "*" \
    --include "*.jsonl" \
    --include "*.log"

# Sync reports FROM local TO S3
echo "Uploading reports to S3..."
aws s3 sync "${LOCAL_DIR}" "s3://cantina-jd/golang.reports/data/" \
    --region ${AWS_REGION} \
    --exclude "*" \
    --include "*.jsonl" \
    --include "*.log" \
    --include "*.json"

echo "Bidirectional sync completed with directory: ${LOCAL_DIR}"
ls -lR "${LOCAL_DIR}" 