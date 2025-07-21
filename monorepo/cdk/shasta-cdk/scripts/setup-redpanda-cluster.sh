#!/bin/bash
set -euo pipefail

# RedPanda Docker Cluster Setup Script
# Sets up a RedPanda node using Docker containers for better compatibility

echo "=== RedPanda Docker Cluster Setup Script ==="

# Configuration parameters
NODE_ID="${NODE_ID:-0}"
CLUSTER_SIZE="${CLUSTER_SIZE:-3}"
DATA_DIR="${DATA_DIR:-/var/lib/redpanda/data}"
LOG_DIR="${LOG_DIR:-/var/log/redpanda}"
CONFIG_DIR="${CONFIG_DIR:-/etc/redpanda}"

# Network configuration
KAFKA_PORT="${KAFKA_PORT:-9092}"
ADMIN_PORT="${ADMIN_PORT:-9644}"
RPC_PORT="${RPC_PORT:-33145}"
SCHEMA_REGISTRY_PORT="${SCHEMA_REGISTRY_PORT:-8081}"
PANDAPROXY_PORT="${PANDAPROXY_PORT:-8082}"

# Get private IP address (using IMDSv2)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
PRIVATE_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)
echo "Node private IP: $PRIVATE_IP"

echo "Configuring RedPanda Docker node $NODE_ID..."

# Create directories with proper permissions
sudo mkdir -p "$DATA_DIR" "$LOG_DIR" "$CONFIG_DIR"
sudo chown -R 101:101 "$DATA_DIR" "$LOG_DIR" "$CONFIG_DIR"  # RedPanda Docker user

# Stop any existing RedPanda container
echo "Stopping any existing RedPanda container..."
sudo docker stop redpanda-node 2>/dev/null || true
sudo docker rm redpanda-node 2>/dev/null || true

# Pull RedPanda Docker image
REDPANDA_IMAGE="redpandadata/redpanda:v24.2.7"
echo "Pulling RedPanda Docker image..."
sudo docker pull "$REDPANDA_IMAGE"

# Start RedPanda container with cluster configuration
echo "Starting RedPanda Docker container..."

# Determine if this is the first node (for bootstrap)
if [[ $NODE_ID -eq 0 ]]; then
    echo "Starting as bootstrap node (node 0)..."
    sudo docker run -d \
        --name redpanda-node \
        --hostname "redpanda-${NODE_ID}" \
        -p 9092:9092 \
        -p 9644:9644 \
        -p 33145:33145 \
        -p 8081:8081 \
        -p 8082:8082 \
        -v "$DATA_DIR:/var/lib/redpanda/data:Z" \
        -v "$LOG_DIR:/var/log/redpanda:Z" \
        -v "$CONFIG_DIR:/etc/redpanda:Z" \
        "$REDPANDA_IMAGE" \
        redpanda start \
        --node-id="$NODE_ID" \
        --kafka-addr="0.0.0.0:9092" \
        --advertise-kafka-addr="$PRIVATE_IP:9092" \
        --pandaproxy-addr="0.0.0.0:8082" \
        --advertise-pandaproxy-addr="$PRIVATE_IP:8082" \
        --schema-registry-addr="0.0.0.0:8081" \
        --rpc-addr="0.0.0.0:33145" \
        --advertise-rpc-addr="$PRIVATE_IP:33145" \
        --mode dev-container \
        --smp 2 \
        --reserve-memory 1G \
        --check=false
else
    echo "Starting as cluster member (node $NODE_ID)..."
    # Wait a bit for the bootstrap node to be ready
    echo "Waiting 30 seconds for bootstrap node to be ready..."
    sleep 30
    
    sudo docker run -d \
        --name redpanda-node \
        --hostname "redpanda-${NODE_ID}" \
        -p 9092:9092 \
        -p 9644:9644 \
        -p 33145:33145 \
        -p 8081:8081 \
        -p 8082:8082 \
        -v "$DATA_DIR:/var/lib/redpanda/data:Z" \
        -v "$LOG_DIR:/var/log/redpanda:Z" \
        -v "$CONFIG_DIR:/etc/redpanda:Z" \
        "$REDPANDA_IMAGE" \
        redpanda start \
        --node-id="$NODE_ID" \
        --kafka-addr="0.0.0.0:9092" \
        --advertise-kafka-addr="$PRIVATE_IP:9092" \
        --pandaproxy-addr="0.0.0.0:8082" \
        --advertise-pandaproxy-addr="$PRIVATE_IP:8082" \
        --schema-registry-addr="0.0.0.0:8081" \
        --rpc-addr="0.0.0.0:33145" \
        --advertise-rpc-addr="$PRIVATE_IP:33145" \
        --seeds="${BOOTSTRAP_NODE_IP:-redpanda-0}:33145" \
        --mode dev-container \
        --smp 2 \
        --reserve-memory 1G \
        --check=false
fi

# Wait for container to start
echo "Waiting for RedPanda container to start..."
sleep 10

# Check if container is running
if sudo docker ps | grep -q redpanda-node; then
    echo "✅ RedPanda container started successfully"
else
    echo "❌ RedPanda container failed to start"
    echo "Container logs:"
    sudo docker logs redpanda-node 2>/dev/null || echo "No logs available"
    exit 1
fi

# Wait for RedPanda to be ready
echo "Waiting for RedPanda to be ready..."
for i in {1..30}; do
    if curl -s "http://$PRIVATE_IP:$ADMIN_PORT/v1/status/ready" 2>/dev/null | grep -q "ready"; then
        echo "✅ RedPanda is ready!"
        break
    fi
    if [[ $i -eq 30 ]]; then
        echo "❌ RedPanda failed to become ready after 5 minutes"
        echo "Container status:"
        sudo docker ps -a | grep redpanda-node || echo "Container not found"
        echo "Container logs:"
        sudo docker logs redpanda-node 2>/dev/null | tail -50 || echo "No logs available"
        exit 1
    fi
    echo "Waiting for RedPanda to be ready... ($i/30)"
    sleep 10
done

# Create systemd service for container management
echo "Creating systemd service for RedPanda container..."
sudo tee /etc/systemd/system/redpanda.service > /dev/null <<EOF
[Unit]
Description=RedPanda Docker Container
Requires=docker.service
After=docker.service
StartLimitIntervalSec=0

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/docker start redpanda-node
ExecStop=/usr/bin/docker stop redpanda-node
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable redpanda

# Show cluster status
echo "Checking cluster status..."
timeout 30s sudo docker exec redpanda-node rpk cluster info 2>/dev/null || {
    echo "⚠️  Cluster not fully ready yet - this is normal during initial setup"
}

echo "✅ RedPanda Docker node $NODE_ID setup completed!"
echo ""
echo "Node Information:"
echo "  Private IP: $PRIVATE_IP"
echo "  Kafka API: $PRIVATE_IP:$KAFKA_PORT"
echo "  Admin API: $PRIVATE_IP:$ADMIN_PORT"
echo "  RPC: $PRIVATE_IP:$RPC_PORT"
echo "  Container: redpanda-node"
echo ""
echo "Use 'docker ps' to check container status"
echo "Use 'docker logs redpanda-node -f' to follow logs"
echo "Use 'systemctl status redpanda' to check systemd service" 