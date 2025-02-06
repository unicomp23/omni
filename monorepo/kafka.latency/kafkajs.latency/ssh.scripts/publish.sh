#!/bin/bash

# Function to display the help message
usage() {
    echo "Usage: $0 [options]"
    echo
    echo "Options:"
    echo "  -n, --num-containers NUMBER   Specify the number of Docker containers to run (default: 1)"
    echo "  -h, --help                    Display this help message"
    echo
    echo "Example:"
    echo "  $0 --num-containers 5"
    exit 1
}

# Default number of containers
NUM_CONTAINERS=36

# Parse command-line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -n|--num-containers)
            if [[ -n "$2" && "$2" =~ ^[1-9][0-9]*$ ]]; then
                NUM_CONTAINERS="$2"
                shift
            else
                echo "Error: --num-containers requires a positive integer argument."
                usage
            fi
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
    shift
done

# Source bashrc to ensure environment variables are loaded
source ~/.bashrc

# Print environment variables for debugging
echo "Bootstrap Brokers: $BOOTSTRAP_BROKERS"
echo "ECR Repo URI: $SHASTA_CDK_ECR_REPO_URI"

# Authenticate Docker to ECR
echo "Authenticating Docker with Amazon ECR..."
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$SHASTA_CDK_ECR_REPO_URI"

# Check if Docker login was successful
if [ $? -ne 0 ]; then
    echo "Docker login to ECR failed. Please check your AWS credentials and ECR repository URI."
    exit 1
fi

# Pull the latest image
echo "Pulling the latest Docker image from ECR..."
docker pull "$SHASTA_CDK_ECR_REPO_URI":latest

if [ $? -ne 0 ]; then
    echo "Docker pull failed. Please ensure the image exists in the specified ECR repository."
    exit 1
fi

# Generate a unique consumer group ID
CONSUMER_GROUP_ID="ssh-consumer-$(date +%s)"

# Function to run a Docker container
run_container() {
    docker run --rm \
      -e "KAFKA_BROKERS=$BOOTSTRAP_BROKERS" \
      -e "DEBUG=kafkajs*" \
      "$SHASTA_CDK_ECR_REPO_URI":latest \
      --mode publish \
      --iterations 2000 \
      --topic latency-test-010 \
      --publishers 64 \
      --brokers "$BOOTSTRAP_BROKERS" \
      --partitions 36 \
      --sleep 500
}

# Run the specified number of Docker containers in the background
for ((i=1; i<=NUM_CONTAINERS; i++)); do
    echo "Starting Docker container #$i..."
    run_container &
done

# Wait for all background Docker containers to finish
wait

echo "All Docker containers have completed execution."
