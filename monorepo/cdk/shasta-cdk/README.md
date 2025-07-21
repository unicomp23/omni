# RedPanda Cluster Automation

This Go application automates the setup of a RedPanda cluster on AWS EC2 instances and runs comprehensive load testing using the franz-go Kafka client library.

## Features

- **Automated Cluster Setup**: SSH into EC2 instances and configure RedPanda containers using the official [RedPanda Docker image](https://hub.docker.com/r/redpandadata/redpanda)
- **Load Testing**: Multi-producer, multi-consumer testing with throughput and latency metrics
- **Health Monitoring**: Cluster health verification and monitoring
- **Flexible Configuration**: Customizable test parameters via command-line flags

## Prerequisites

- AWS EC2 instances deployed (use the provided CDK stack)
- SSH private key (`john.davis.pem`)
- Docker installed on all EC2 instances (handled by CDK user data)
- Go 1.21 or later

## Quick Start

1. **Deploy Infrastructure**:
   ```bash
   # From the CDK directory
   cdk deploy ShastaCdkStackL1 ShastaCdkStackL2 RedPandaClusterStack
   ```

2. **Build and Run**:
   ```bash
   go mod tidy
   go build -o redpanda-automation .
   ./redpanda-automation
   ```

## Usage

### Basic Usage
```bash
./redpanda-automation
```

### Advanced Usage
```bash
./redpanda-automation \
  -key /path/to/john.davis.pem \
  -producers 5 \
  -consumers 3 \
  -messages 50000 \
  -size 2048 \
  -duration 10m \
  -topic performance-test
```

### Command-Line Options

| Flag | Description | Default |
|------|-------------|---------|
| `-key` | Path to SSH private key | `/data/.ssh/john.davis.pem` |
| `-setup` | Set up RedPanda cluster | `true` |
| `-test` | Run load test | `true` |
| `-skip-setup` | Skip cluster setup (use existing) | `false` |
| `-producers` | Number of producer goroutines | `3` |
| `-consumers` | Number of consumer goroutines | `3` |
| `-messages` | Messages per producer | `10000` |
| `-size` | Message size in bytes | `1024` |
| `-duration` | Test duration | `5m` |
| `-topic` | Kafka topic name | `load-test-topic` |

### Example Commands

**Setup cluster only**:
```bash
./redpanda-automation -test=false
```

**Run test only (skip setup)**:
```bash
./redpanda-automation -skip-setup -setup=false
```

**High-throughput test**:
```bash
./redpanda-automation \
  -producers 10 \
  -consumers 5 \
  -messages 100000 \
  -size 512 \
  -duration 15m
```

## Architecture

### Cluster Configuration

- **3 RedPanda Nodes**: Deployed across different AZs for high availability
- **Replication Factor**: 3 (full replication across all nodes)
- **Topics**: 3 partitions for load balancing
- **Network**: Host networking for optimal performance
- **Storage**: GP3 EBS volumes with high IOPS

### Load Test Design

- **Producers**: Multiple goroutines sending messages concurrently
- **Consumers**: Consumer groups for distributed processing  
- **Metrics**: Throughput (msg/sec), latency, success rate
- **Reliability**: Error handling and retry logic

## Infrastructure Details

The CDK stack creates:

- **RedPanda Nodes**:
  - Instance Type: `i4i.2xlarge` (high-performance, NVMe SSD)
  - Public IPs: `54.237.232.219`, `44.200.162.222`, `54.234.45.204`
  - Private IPs: `10.0.0.62`, `10.0.1.15`, `10.0.2.154`

- **Load Test Instance**:
  - Instance Type: `c5n.4xlarge` (network-optimized)
  - Public IP: `54.173.123.191`

- **Ports**:
  - Kafka API: `9092`
  - Schema Registry: `8081`
  - REST Proxy: `8082`
  - Admin API: `9644`
  - RPC: `33145`

## Monitoring and Debugging

### SSH Access
```bash
# RedPanda nodes
ssh -i /data/.ssh/john.davis.pem ec2-user@54.237.232.219  # Node 0
ssh -i /data/.ssh/john.davis.pem ec2-user@44.200.162.222  # Node 1
ssh -i /data/.ssh/john.davis.pem ec2-user@54.234.45.204  # Node 2

# Load test instance
ssh -i /data/.ssh/john.davis.pem ec2-user@54.173.123.191
```

### Container Management
```bash
# Check RedPanda container status
sudo docker ps | grep redpanda

# View RedPanda logs
sudo docker logs redpanda-0

# RedPanda CLI commands
sudo docker exec redpanda-0 rpk cluster info
sudo docker exec redpanda-0 rpk topic list
sudo docker exec redpanda-0 rpk topic create test-topic
```

### Performance Monitoring
```bash
# System resources
htop
iotop

# Network statistics
sudo netstat -i
ss -tuln
```

## Troubleshooting

### Common Issues

1. **SSH Connection Failed**:
   - Verify key file permissions: `chmod 600 /data/.ssh/john.davis.pem`
   - Check security groups allow SSH (port 22)

2. **Container Start Failed**:
   - Check Docker service: `sudo systemctl status docker`
   - Review container logs: `sudo docker logs redpanda-X`

3. **Cluster Formation Issues**:
   - Verify all nodes can communicate on port 33145
   - Check seed server configuration in redpanda.yaml

4. **Load Test Failures**:
   - Ensure topic exists and has correct replication
   - Verify bootstrap servers are reachable
   - Check for network connectivity issues

### Performance Tuning

For optimal performance:
- Use GP3 volumes with high IOPS provisioning
- Enable SR-IOV networking on compatible instances
- Tune RedPanda configuration for your workload
- Monitor CPU, memory, and network utilization

## Dependencies

- `github.com/twmb/franz-go` - High-performance Kafka client
- `golang.org/x/crypto/ssh` - SSH client for automation
- RedPanda Docker image from [Docker Hub](https://hub.docker.com/r/redpandadata/redpanda)

## License

This automation tool is designed for educational and testing purposes. 