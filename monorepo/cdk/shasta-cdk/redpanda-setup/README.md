# RedPanda Native Cluster Setup

Automated setup tool for RedPanda clusters using native RPM packages on AWS EC2 instances. This tool reads your CDK stack outputs and configures a complete RedPanda cluster across multiple nodes using systemd services.

## Features

- **Native Installation**: Uses official RedPanda RPM packages for optimal performance
- **Multi-Node Cluster**: Automatically configures 3-node cluster with proper seed servers
- **Ultra-Low Latency**: Network optimizations and system tuning for sub-millisecond latency
- **Production Ready**: Systemd service management with proper logging and monitoring
- **Health Verification**: Comprehensive cluster health checks and validation
- **Non-Interactive Mode**: Supports automated deployment without user prompts

## Prerequisites

- AWS CDK stack deployed (`RedPandaClusterStack`)
- SSH access to EC2 instances
- Go 1.21+ for building the setup tool
- RedPanda RPM packages (installed automatically by CDK user data)

## Quick Start

```bash
# Navigate to setup directory
cd redpanda-setup

# Run automated setup
export NON_INTERACTIVE=true
./setup-cluster.sh
```

## Configuration

Environment variables control the setup behavior:

```bash
export STACK_NAME="RedPandaClusterStack"     # CloudFormation stack name
export AWS_DEFAULT_REGION="us-east-1"       # AWS region
export KEY_PATH="/data/.ssh/john.davis.pem" # SSH private key path
export REDPANDA_VERSION="v25.1.9"          # RedPanda version (for reference)
export NON_INTERACTIVE="true"               # Skip confirmation prompts
```

## Setup Process

The tool performs these steps on each node:

1. **System Preparation**
   - Stops any existing RedPanda services
   - Creates required directories (`/etc/redpanda`, `/var/lib/redpanda/data`)
   - Sets proper ownership and permissions

2. **Storage Configuration**
   - Verifies NVMe SSD storage mount (m7gd.8xlarge instances)
   - Sets proper ownership and permissions for high-performance storage
   - Ensures data directory is ready for RedPanda operations

3. **Network Optimization**
   - Applies ultra-low latency TCP settings
   - Configures system parameters for optimal performance
   - Sets CPU governor to performance mode

4. **Configuration Deployment**
   - Generates node-specific `redpanda.yaml` configuration
   - Configures cluster seed servers and node IDs
   - Sets up Kafka API, Admin API, and Schema Registry endpoints

4. **Service Management**
   - Starts RedPanda systemd service
   - Enables service for automatic startup
   - Verifies service health and connectivity

5. **Cluster Health Verification**
   - Waits for all brokers to join the cluster
   - Performs comprehensive health checks
   - Validates topic operations and admin functions

6. **Performance Optimization**
   - Enables write caching at the cluster level for improved performance
   - Configures relaxed durability mode for faster message acknowledgments
   - Verifies write caching configuration

## Usage

### Basic Setup
```bash
./setup-cluster.sh
```

### Non-Interactive Setup
```bash
export NON_INTERACTIVE=true
./setup-cluster.sh
```

### Custom Configuration
```bash
export REDPANDA_VERSION="v25.1.9"
export KEY_PATH="/path/to/your/key.pem"
./setup-cluster.sh
```

## Cluster Management

After setup, use the cluster utilities for ongoing management:

```bash
# Check cluster status
./cluster-utils.sh status

# View service logs
./cluster-utils.sh logs

# Restart all services
./cluster-utils.sh restart

# Create test topic
./cluster-utils.sh create-topic

# SSH to first node
./cluster-utils.sh shell
```

## Native Installation Benefits

### Performance Advantages
- **Zero Docker Overhead**: Direct system access for maximum performance
- **Native Networking**: Host networking without bridge overhead
- **System Integration**: Proper systemd service management
- **Resource Efficiency**: Direct memory and CPU access
- **Write Caching**: Automatically enabled for improved performance with relaxed durability

### Management Benefits
- **Standard Commands**: Use familiar `systemctl` commands
- **Native Logging**: Integrated with `journalctl` for log management
- **Service Dependencies**: Proper startup ordering and dependencies
- **System Monitoring**: Native integration with system monitoring tools

## Service Management

### Direct Service Control
```bash
# On any RedPanda node
sudo systemctl status redpanda
sudo systemctl start redpanda
sudo systemctl stop redpanda
sudo systemctl restart redpanda
```

### Log Management
```bash
# View recent logs
sudo journalctl -u redpanda --lines=50

# Follow logs in real-time
sudo journalctl -u redpanda -f

# View logs with timestamps
sudo journalctl -u redpanda --since "1 hour ago"
```

### Configuration Management
```bash
# View current configuration
cat /etc/redpanda/redpanda.yaml

# Validate configuration
sudo -u redpanda redpanda --config /etc/redpanda/redpanda.yaml --check

# Edit configuration (requires service restart)
sudo vi /etc/redpanda/redpanda.yaml
sudo systemctl restart redpanda
```

## RPK Client Usage

All RPK commands work directly without containers:

### Cluster Operations
```bash
# Cluster information
rpk cluster info

# Broker details
rpk redpanda admin brokers list

# Cluster health
rpk cluster health
```

### Topic Management
```bash
# List topics
rpk topic list

# Create topic
rpk topic create my-topic -p 12 -r 3

# Describe topic
rpk topic describe my-topic

# Delete topic
rpk topic delete my-topic
```

### Data Operations
```bash
# Produce messages
rpk topic produce my-topic

# Consume messages
rpk topic consume my-topic

# Produce from file
cat messages.txt | rpk topic produce my-topic
```

## Troubleshooting

### Service Issues

**Service won't start:**
```bash
# Check service status
sudo systemctl status redpanda

# View detailed logs
sudo journalctl -u redpanda --lines=100 --no-pager

# Check configuration
sudo -u redpanda redpanda --config /etc/redpanda/redpanda.yaml --check
```

**Service crashes:**
```bash
# Check system resources
free -h
df -h /var/lib/redpanda/data

# Check file permissions
ls -la /etc/redpanda/redpanda.yaml
ls -la /var/lib/redpanda/data
```

### Network Issues

**Can't connect to cluster:**
```bash
# Test local connectivity
rpk cluster info --brokers localhost:9092

# Test remote connectivity
rpk cluster info --brokers <node-ip>:9092

# Check port bindings
sudo netstat -tlnp | grep redpanda
```

**Cluster formation issues:**
```bash
# Check seed server connectivity
telnet <seed-server-ip> 33145

# Verify cluster configuration
grep -A 10 seed_servers /etc/redpanda/redpanda.yaml
```

### Configuration Issues

**Invalid configuration:**
```bash
# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('/etc/redpanda/redpanda.yaml'))"

# Check RedPanda config validation
sudo -u redpanda redpanda --config /etc/redpanda/redpanda.yaml --check
```

### Performance Issues

**High latency:**
```bash
# Check network optimizations
sudo sysctl net.ipv4.tcp_congestion_control
sudo sysctl net.core.busy_read

# Monitor system performance
htop
iotop -o
```

## Directory Structure

```
/etc/redpanda/                 # Configuration files
├── redpanda.yaml             # Main configuration

/var/lib/redpanda/            # Data directory
└── data/                     # RedPanda data files

/opt/redpanda/                # Binary installation
└── bin/redpanda              # Main binary

/usr/bin/rpk                  # RPK client binary
```

## Network Ports

| Port  | Purpose           | Protocol |
|-------|-------------------|----------|
| 9092  | Kafka API         | TCP      |
| 8081  | Schema Registry   | TCP      |
| 8082  | REST Proxy        | TCP      |
| 9644  | Admin API         | TCP      |
| 33145 | RPC (Inter-node)  | TCP      |

## Configuration Template

The tool generates configuration files with these key settings:

```yaml
redpanda:
  data_directory: /var/lib/redpanda/data
  node_id: <unique-node-id>
  rpc_server:
    address: <private-ip>
    port: 33145
  kafka_api:
  - address: <private-ip>
    port: 9092
  admin:
  - address: <private-ip>
    port: 9644
  seed_servers:
  - host: { address: <node-0-ip>, port: 33145 }
  - host: { address: <node-1-ip>, port: 33145 }
  - host: { address: <node-2-ip>, port: 33145 }
  developer_mode: false
  auto_create_topics_enabled: true
```

## Write Caching Configuration

Write caching is automatically enabled during cluster setup for improved performance. This feature provides better throughput and lower latency by acknowledging messages as soon as they are received and acknowledged by a majority of brokers, without waiting for disk writes.

### What Write Caching Does

- **Improved Performance**: Messages are acknowledged faster, reducing latency
- **Relaxed Durability**: Trades some durability for performance gains
- **Majority Acknowledgment**: Still ensures majority of brokers receive the message
- **User Topics Only**: Does not apply to transactions or consumer offsets

### Manual Configuration

To check or modify write caching settings:

```bash
# Check current write caching setting
rpk cluster config get write_caching_default

# Enable write caching (already done by setup)
rpk cluster config set write_caching_default true

# Disable write caching if needed
rpk cluster config set write_caching_default false
```

### Per-Topic Override

You can override the cluster-level setting for specific topics:

```bash
# Enable write caching for a specific topic
rpk topic alter-config my-topic --set write.caching=true

# Disable write caching for a specific topic
rpk topic alter-config my-topic --set write.caching=false

# Remove topic-level override (use cluster default)
rpk topic alter-config my-topic --delete write.caching
```

### Performance Considerations

- **Use Case**: Best for workloads that can tolerate some data loss for better performance
- **Data Safety**: Not recommended for critical financial or transactional data
- **Throughput**: Can significantly improve message throughput and reduce latency
- **Recovery**: In case of multiple simultaneous broker failures, some recent messages may be lost

## Security Considerations

- **File Permissions**: Configuration files owned by `redpanda:redpanda`
- **Service User**: RedPanda runs as dedicated `redpanda` user
- **Network Security**: Security groups restrict access to required ports
- **SSH Access**: Key-based authentication for management access

## Monitoring Integration

The native installation integrates with standard Linux monitoring tools:

- **systemd**: Service status and health monitoring
- **journald**: Centralized logging with rotation
- **Prometheus**: Metrics endpoint available on port 9644
- **System Tools**: Compatible with htop, iotop, netstat, etc.

This provides better observability compared to containerized deployments and integrates seamlessly with existing monitoring infrastructure. 