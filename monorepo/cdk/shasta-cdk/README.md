## RedPanda AWS CDK Project

Ultra-low latency RedPanda cluster deployment on AWS using CDK with native installation.

- **Infrastructure as Code**: AWS CDK TypeScript for reproducible AWS resource creation
- **Automated Cluster Setup**: SSH into EC2 instances and configure RedPanda natively using official RPM packages
- **Load Testing Framework**: Built-in Go-based load testing with franz-go client
- **Performance Optimized**: Network tuning, CPU pinning, and memory optimization for sub-millisecond latency
- **Production Ready**: Multi-AZ deployment with proper security groups and monitoring

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- SSH key pair for EC2 access (`john.davis.pem` by default)
- Native Redpanda installation (handled by CDK user data)

## Quick Start

1. **Deploy Infrastructure**:
   ```bash
   npm install
   cdk deploy RedPandaClusterStack
   ```

2. **Setup Cluster**:
   ```bash
   cd redpanda-setup
   export NON_INTERACTIVE=true  # Optional: skip confirmation prompt
   ./setup-cluster.sh
   ```

3. **Run Load Tests**:
   ```bash
   cd load-test
   ./run.sh
   ```

## Project Structure

```
├── lib/
│   ├── redpanda-cluster-stack.ts    # Main CDK stack for RedPanda
│   └── shasta-cdk-stack*.ts         # Additional infrastructure
├── redpanda-setup/
│   ├── main.go                      # Cluster configuration tool
│   ├── setup-cluster.sh             # Main setup script
│   └── cluster-utils.sh             # Management utilities
├── load-test/
│   ├── main.go                      # Go load testing client
│   └── run.sh                       # Load test runner
└── bin/shasta-cdk.ts                # CDK app entry point
```

## Architecture

The solution deploys:

1. **VPC**: Dedicated network with public/private subnets across 3 AZs
2. **EC2 Instances**: c5.4xlarge nodes with native RedPanda installation
3. **Security Groups**: Properly configured for RedPanda ports (9092, 8081, 8082, 33145, 9644)
4. **Load Test Instance**: Separate c5n.4xlarge for testing
5. **S3 Bucket**: For load test scripts and results

## Native Installation Benefits

✅ **Better Performance**: No Docker overhead, direct system access  
✅ **Easy Management**: Standard `systemctl` commands  
✅ **Native Integration**: Proper systemd service management  
✅ **Direct RPK Access**: `rpk` commands work without containers  

## Usage

### Cluster Management

```bash
# Check cluster status
./cluster-utils.sh status

# View service logs
./cluster-utils.sh logs

# Restart services
./cluster-utils.sh restart

# Create test topic
./cluster-utils.sh create-topic
```

### Direct Node Access

SSH to any node for direct management:

```bash
# SSH to first node
ssh -i /data/.ssh/john.davis.pem ec2-user@<node-ip>

# Check service status
sudo systemctl status redpanda

# View logs
sudo journalctl -u redpanda --lines=50

# Use RPK directly
rpk cluster info
rpk topic list
rpk topic create test-topic -p 12 -r 3
```

### Load Testing

```bash
cd load-test
# Run complete load test
./run.sh

# Or use the automated script
../run-complete-load-test.sh
```

## Troubleshooting

### Service Issues
- Check service status: `sudo systemctl status redpanda`
- View recent logs: `sudo journalctl -u redpanda --lines=100`
- Restart service: `sudo systemctl restart redpanda`

### Network Issues
- Test connectivity: `rpk cluster info --brokers <node-ip>:9092`
- Check ports: `sudo netstat -tlnp | grep redpanda`

### Configuration Issues
- View config: `cat /etc/redpanda/redpanda.yaml`
- Validate config: `sudo -u redpanda redpanda --config /etc/redpanda/redpanda.yaml --check`

## Performance Features

- **Host Networking**: Direct system network access
- **CPU Pinning**: Dedicated CPU cores (0-3)
- **Memory Optimization**: 8GB allocation with swappiness tuning
- **Network Tuning**: TCP optimizations for ultra-low latency
- **Storage**: GP3 EBS with 16,000 IOPS

## Configuration

Environment variables for setup:

```bash
export STACK_NAME="RedPandaClusterStack"
export AWS_DEFAULT_REGION="us-east-1"
export KEY_PATH="/data/.ssh/john.davis.pem"
export REDPANDA_VERSION="v25.1.9"
export NON_INTERACTIVE="true"  # Skip confirmation prompts
```

## Tech Stack

- **Infrastructure**: AWS CDK (TypeScript)
- **RedPanda**: Native RPM installation (v25.1.9)
- **Orchestration**: Go application with SSH
- **Load Testing**: franz-go client
- **Monitoring**: systemd/journald logging

## Bootstrap Brokers

After successful deployment, use these endpoints:
```
<private-ip-1>:9092,<private-ip-2>:9092,<private-ip-3>:9092
```

The setup outputs the exact broker addresses for your cluster. 