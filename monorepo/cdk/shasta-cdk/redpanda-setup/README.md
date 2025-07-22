# RedPanda Cluster Setup Tool

Automated setup tool for RedPanda clusters using Docker containers on AWS EC2 instances. This tool reads your CDK stack outputs and configures a complete RedPanda cluster across multiple nodes.

## Features

- **CDK Integration**: Automatically discovers node IPs from CloudFormation outputs
- **Docker-based**: Uses official RedPanda Docker images for consistent deployment
- **Multi-node Clustering**: Configures proper cluster membership and seed servers
- **SSH Automation**: Handles all SSH connections and remote commands
- **Health Verification**: Validates cluster health after setup
- **Production Ready**: Configures proper replication and persistence

## Prerequisites

1. **Deployed CDK Stack**: Your `RedPandaClusterStack` must be deployed
2. **SSH Access**: SSH key pair for EC2 instances
3. **AWS CLI**: Configured with appropriate permissions
4. **Go 1.21+**: For building the setup tool

## Quick Start

1. **Build and Run**:
   ```bash
   cd redpanda-setup
   ./setup-cluster.sh
   ```

2. **Or run manually**:
   ```bash
   go build -o redpanda-setup .
   ./redpanda-setup
   ```

## Configuration

Set environment variables to customize the setup:

```bash
export STACK_NAME="RedPandaClusterStack"    # CloudFormation stack name
export AWS_DEFAULT_REGION="us-east-1"       # AWS region
export KEY_PATH="$HOME/.ssh/john.davis.pem" # SSH private key path
export REDPANDA_VERSION="v23.3.3"           # RedPanda Docker image version
```

## What It Does

### 1. **Discovery Phase**
- Fetches CloudFormation outputs from your CDK stack
- Extracts private and public IPs of RedPanda nodes
- Validates cluster configuration

### 2. **Node Setup Phase**
For each node:
- Connects via SSH using your key pair
- Creates necessary directories (`/opt/redpanda/conf`, `/opt/redpanda/data`)
- Pulls RedPanda Docker image
- Generates cluster-aware configuration file
- Starts RedPanda container with proper networking

### 3. **Verification Phase**
- Waits for cluster to stabilize (30 seconds)
- Runs health checks using `rpk` commands
- Verifies cluster connectivity and topic operations

## Generated Configuration

Each node gets a custom `redpanda.yaml` configuration:

```yaml
redpanda:
  data_directory: /var/lib/redpanda/data
  node_id: 0  # Unique per node
  rpc_server:
    address: 10.0.1.100  # Node's private IP
    port: 33145
  kafka_api:
    - address: 10.0.1.100
      port: 9092
  admin:
    - address: 10.0.1.100
      port: 9644
  seed_servers:  # All cluster nodes
    - host:
        address: 10.0.1.100
        port: 33145
    - host:
        address: 10.0.2.100
        port: 33145
    # ... etc
  developer_mode: false
  auto_create_topics_enabled: true

pandaproxy:
  pandaproxy_api:
    - address: 10.0.1.100
      port: 8082

schema_registry:
  schema_registry_api:
    - address: 10.0.1.100
      port: 8081
```

## Docker Configuration

Each RedPanda container runs with:

- **Network Mode**: Host networking for optimal performance
- **Persistent Storage**: `/opt/redpanda/data` mounted for data persistence
- **Configuration**: Custom config mounted from `/opt/redpanda/conf`
- **Restart Policy**: `unless-stopped` for automatic recovery
- **Resource Access**: Full access to instance resources

## Post-Setup Usage

### Check Cluster Status
```bash
# SSH to any node
ssh -i ~/.ssh/john.davis.pem ec2-user@{node-public-ip}

# Check cluster info
sudo docker exec redpanda rpk cluster info

# List topics
sudo docker exec redpanda rpk topic list

# Create a test topic
sudo docker exec redpanda rpk topic create test-topic -p 12 -r 3
```

### Access RedPanda Services

From within the VPC:
- **Kafka API**: `{node-private-ip}:9092`
- **Admin API**: `{node-private-ip}:9644`
- **REST Proxy**: `{node-private-ip}:8082`
- **Schema Registry**: `{node-private-ip}:8081`

### Bootstrap Brokers

Use this for your Kafka clients:
```
{node1-ip}:9092,{node2-ip}:9092,{node3-ip}:9092
```

The setup tool prints this at the end.

## Troubleshooting

### SSH Connection Issues
```bash
# Test SSH connectivity
ssh -i ~/.ssh/john.davis.pem ec2-user@{node-public-ip} 'echo "Connection OK"'

# Check security group allows SSH (port 22)
```

### CloudFormation Issues
```bash
# Verify stack exists and is deployed
aws cloudformation describe-stacks --stack-name RedPandaClusterStack

# Check outputs are available
aws cloudformation describe-stacks --stack-name RedPandaClusterStack \
    --query 'Stacks[0].Outputs'
```

### Container Issues
```bash
# SSH to node and check Docker
ssh -i ~/.ssh/john.davis.pem ec2-user@{node-ip}

# Check if container is running
sudo docker ps | grep redpanda

# Check container logs
sudo docker logs redpanda

# Restart container if needed
sudo docker restart redpanda
```

### Cluster Issues
```bash
# Check if nodes can communicate (from any node)
sudo docker exec redpanda rpk cluster info

# Check specific node status
sudo docker exec redpanda rpk redpanda admin brokers list

# View detailed logs
sudo docker exec redpanda cat /var/lib/redpanda/logs/redpanda.log
```

## File Structure

```
redpanda-setup/
├── go.mod              # Go module dependencies
├── main.go             # Main setup application
├── setup-cluster.sh    # Convenience setup script
├── README.md           # This documentation
└── cluster-utils.sh    # Utility scripts (optional)
```

## Advanced Usage

### Custom RedPanda Version
```bash
REDPANDA_VERSION="v23.2.8" ./setup-cluster.sh
```

### Different Key Path
```bash
KEY_PATH="/path/to/custom-key.pem" ./setup-cluster.sh
```

### Different Stack Name
```bash
STACK_NAME="MyCustomStack" ./setup-cluster.sh
```

## Integration with Load Testing

After setup, use the bootstrap brokers with your franz-go load test:

```bash
# Get the bootstrap brokers from setup output, then:
cd ../load-test
export REDPANDA_BROKERS="{brokers-from-setup}"
./run.sh
```

## Security Considerations

- SSH keys should be properly secured (600 permissions)
- RedPanda containers run with host networking for performance
- Security groups control access to RedPanda ports
- All data persists in `/opt/redpanda/data` on each instance

## Performance Notes

- Uses host networking to avoid Docker networking overhead
- Data persistence ensures cluster survives container restarts
- Each node gets dedicated instance resources (i4i.2xlarge)
- Production-ready configuration with replication enabled

This tool provides a complete, production-ready RedPanda cluster setup that integrates seamlessly with your CDK infrastructure! 