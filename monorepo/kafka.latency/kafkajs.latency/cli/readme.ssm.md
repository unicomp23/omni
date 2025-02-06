#!/bin/bash

# Switch to ec2-user and ensure proper environment
sudo su - ec2-user << 'EOF'

# Set timestamp and container name
timestamp=$(date +%Y%m%d_%H%M%S)
CONTAINER_NAME="kafka-consumer-0-${timestamp}"
TEST_ID="012"

# Source bashrc to get environment variables
source ~/.bashrc

# Ensure ECR login with hardcoded account ID
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 358474168551.dkr.ecr.us-east-1.amazonaws.com

# Run consumer with hardcoded ECR repo URI and mounted volumes
docker run -d \
    --name "$CONTAINER_NAME" \
    -e "KAFKA_BROKERS=$BOOTSTRAP_BROKERS" \
    -e DEBUG=kafkajs* \
    -v /tmp:/tmp \
    358474168551.dkr.ecr.us-east-1.amazonaws.com/shasta-cdk-ecr-repo:latest \
    --mode consume \
    --duration 7800 \
    --topic latency-test-${TEST_ID} \
    --brokers "$BOOTSTRAP_BROKERS" \
    --groupId "latency-test-group-${TEST_ID}" \
    --partitions 36 \
    --debug true

# Show container status
echo "Container status:"
docker ps | grep "$CONTAINER_NAME"

EOF
--------------------------------------------------
#!/bin/bash

# Switch to ec2-user and ensure proper environment
sudo su - ec2-user << 'EOF'

# Set timestamp and container name
timestamp=$(date +%Y%m%d_%H%M%S)
CONTAINER_NAME="kafka-producer-0-${timestamp}"
TEST_ID="012"

# Source bashrc to get environment variables
source ~/.bashrc

# Ensure ECR login with hardcoded account ID
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 358474168551.dkr.ecr.us-east-1.amazonaws.com

# Run producer with hardcoded ECR repo URI and mounted volumes
docker run -d \
    --name "$CONTAINER_NAME" \
    -e "KAFKA_BROKERS=$BOOTSTRAP_BROKERS" \
    -e DEBUG=kafkajs* \
    -v /tmp:/tmp \
    358474168551.dkr.ecr.us-east-1.amazonaws.com/shasta-cdk-ecr-repo:latest \
    --mode publish \
    --iterations 7200 \
    --publishers 10 \
    --brokers "$BOOTSTRAP_BROKERS" \
    --partitions 36 \
    --sleep 1000 \
    --topic latency-test-${TEST_ID}

# Show container status
echo "Container status:"
docker ps | grep "$CONTAINER_NAME"

EOF
--------------------------------------------------
finishing eta at 9:15 am
