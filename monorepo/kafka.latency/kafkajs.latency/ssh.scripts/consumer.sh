#!/bin/bash

# Function to display the help message
usage() {
    echo "Usage: $0 [-n number_of_containers]"
    echo ""
    echo "Options:"
    echo "  -n    Number of Docker containers to run (default: 1)"
    echo "  -h    Display this help message"
    exit 1
}

# Default number of containers
NUM_CONTAINERS=36

# Parse command-line arguments
while getopts ":hn:" opt; do
  case ${opt} in
    h )
      usage
      ;;
    n )
      if [[ "$OPTARG" =~ ^[1-9][0-9]*$ ]]; then
        NUM_CONTAINERS=$OPTARG
      else
        echo "Error: -n requires a positive integer argument."
        usage
      fi
      ;;
    \? )
      echo "Error: Invalid option -$OPTARG" >&2
      usage
      ;;
    : )
      echo "Error: Option -$OPTARG requires an argument." >&2
      usage
      ;;
  esac
done

# Shift positional arguments to remove processed options
shift $((OPTIND -1))

# Source bashrc to ensure environment variables are loaded
source ~/.bashrc

# Print environment variables for debugging
echo "Bootstrap Brokers: $BOOTSTRAP_BROKERS"
echo "ECR Repo URI: $SHASTA_CDK_ECR_REPO_URI"

# Get AWS ECR login token and authenticate Docker
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$SHASTA_CDK_ECR_REPO_URI"

# Pull the latest image
docker pull "$SHASTA_CDK_ECR_REPO_URI":latest

# Generate a unique consumer group ID
CONSUMER_GROUP_ID="ssh-consumer-$(date +%s)"

# Function to run a single Docker container
run_container() {
    docker run --rm \
      -e "KAFKA_BROKERS=$BOOTSTRAP_BROKERS" \
      -e "DEBUG=kafkajs*" \
      "$SHASTA_CDK_ECR_REPO_URI":latest \
      --mode consume \
      --duration 1120 \
      --topic latency-test-010 \
      --brokers "$BOOTSTRAP_BROKERS" \
      --groupId "$CONSUMER_GROUP_ID" \
      --debug true
}

# Run the specified number of Docker containers in the background
for ((i=1; i<=NUM_CONTAINERS; i++)); do
    echo "Starting container $i..."
    run_container &
done

# Wait for all background processes to finish
wait

echo "All containers have finished execution."
