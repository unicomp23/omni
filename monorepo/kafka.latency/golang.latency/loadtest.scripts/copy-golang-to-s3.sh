#!/bin/bash

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Set the source and destination
SOURCE_DIR="../../golang.latency"
S3_BUCKET="s3://cantina-jd/golang"

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: golang directory not found"
    exit 1
fi

# Sync with S3, excluding the reports directory
echo "Syncing golang directory to $S3_BUCKET..."
aws s3 sync "$SOURCE_DIR" "$S3_BUCKET" --exclude "loadtest.scripts/reports/*"

if [ $? -eq 0 ]; then
    echo "Successfully synced golang directory to S3"
else
    echo "Error occurred while syncing to S3"
    exit 1
fi
