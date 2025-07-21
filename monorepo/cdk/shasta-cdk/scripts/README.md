# RedPanda Cluster Automation Scripts

This directory contains comprehensive automation scripts for deploying, managing, and testing RedPanda clusters on AWS.

## 📁 Scripts Overview

### 🚀 Deployment & Infrastructure

#### `aws-redpanda-deploy.sh`
**Main deployment orchestration script**
- Deploys complete RedPanda infrastructure via AWS CDK
- Manages CloudFormation stacks
- Handles prerequisites checking and validation
- Provides cluster status monitoring

```bash
# Deploy complete infrastructure
./aws-redpanda-deploy.sh deploy

# Check deployment status
./aws-redpanda-deploy.sh status

# Show connection information
./aws-redpanda-deploy.sh info

# Run performance tests
./aws-redpanda-deploy.sh test

# Destroy infrastructure (careful!)
./aws-redpanda-deploy.sh destroy
```

### 🔧 Installation & Configuration

#### `install-redpanda.sh`
**RedPanda binary installation script**
- Downloads and installs latest RedPanda version
- Sets up system users and directories
- Applies low-latency system optimizations
- Configures environment variables

```bash
# Install RedPanda on an EC2 instance
sudo ./install-redpanda.sh
```

#### `setup-redpanda-cluster.sh`
**Cluster configuration and startup script**
- Generates RedPanda configuration files
- Creates systemd services
- Sets up cluster networking
- Initializes cluster with default topics

```bash
# Set up RedPanda node (run on each node)
NODE_ID=0 ./setup-redpanda-cluster.sh
NODE_ID=1 ./setup-redpanda-cluster.sh  
NODE_ID=2 ./setup-redpanda-cluster.sh
```

### 🧪 Testing & Benchmarking

#### `redpanda-performance-tests.sh`
**Comprehensive performance testing suite**
- Throughput scaling tests
- Latency measurement
- Message size impact analysis
- Replication factor benchmarks

```bash
# Run all performance tests
./redpanda-performance-tests.sh all

# Run quick performance test
./redpanda-performance-tests.sh quick

# Run specific test types
./redpanda-performance-tests.sh throughput
./redpanda-performance-tests.sh latency
./redpanda-performance-tests.sh size
./redpanda-performance-tests.sh replication
```

## 🔄 Integration with CDK

These scripts are automatically integrated into the CDK deployment:

1. **Layer 1 (ShastaCdkStackL1)**: Creates VPC, security groups, base infrastructure
2. **RedPanda Stack**: Deploys cluster nodes with these scripts in user data
3. **Load Test Instance**: Includes performance testing tools and scripts

## 📋 Prerequisites

### AWS Prerequisites
- AWS CLI configured (`aws configure`)
- AWS CDK installed (`npm install -g aws-cdk`)
- EC2 Key Pair named `john.davis` (or set `KEY_PAIR_NAME` env var)
- Appropriate AWS permissions for EC2, VPC, CloudFormation

### System Prerequisites (for manual installation)
- Amazon Linux 2023 or compatible
- Root/sudo access
- Internet connectivity
- Docker (auto-installed by scripts)

## 🚀 Quick Start

### 1. Complete Automated Deployment

```bash
# Deploy everything
./scripts/aws-redpanda-deploy.sh deploy

# Wait for deployment to complete (~15-20 minutes)
# Scripts will automatically:
# - Create VPC and networking
# - Deploy 3 RedPanda nodes across AZs
# - Set up load testing instance
# - Install and configure RedPanda
# - Initialize cluster
```

### 2. Manual Step-by-Step (if needed)

```bash
# On each RedPanda node:
sudo ./scripts/install-redpanda.sh
NODE_ID=0 ./scripts/setup-redpanda-cluster.sh  # Set NODE_ID appropriately

# On load test instance:
./scripts/redpanda-performance-tests.sh quick
```

## 🏗️ Architecture Details

The scripts create a cluster with:

- **3 RedPanda Nodes** (i4i.2xlarge) in private subnets across 3 AZs
- **1 Load Test Instance** (c5n.4xlarge) in public subnet
- **High-performance storage** (GP3 with 16K IOPS, 1GB/s throughput)
- **Low-latency optimizations** (network tuning, memory locking, etc.)

## 🔧 Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | us-east-1 | AWS deployment region |
| `KEY_PAIR_NAME` | john.davis | EC2 key pair for SSH access |
| `STACK_PREFIX` | ShastaCdk | CloudFormation stack name prefix |
| `NODE_ID` | 0 | RedPanda node identifier (0, 1, 2) |
| `CLUSTER_SIZE` | 3 | Number of nodes in cluster |
| `BOOTSTRAP_SERVERS` | localhost:9092 | Kafka bootstrap servers |

### Port Configuration

| Service | Port | Description |
|---------|------|-------------|
| Kafka API | 9092 | Client connections |
| Schema Registry | 8081 | Schema management |
| REST Proxy | 8082 | HTTP API |
| Admin API | 9644 | Management and metrics |
| RPC | 33145 | Internal cluster communication |

## 📊 Performance Testing

The performance testing suite includes:

### Test Categories

1. **Throughput Scaling** - Tests different partition counts and throughput targets
2. **Message Size Impact** - Analyzes performance across various message sizes
3. **End-to-End Latency** - Measures producer to consumer latency
4. **Replication Factor** - Compares performance with different replication settings

### Sample Test Results Structure

```
/home/ec2-user/test-results/
├── throughput-scaling-20241201-143022/
│   ├── throughput-12p-100000tps.log
│   └── ...
├── message-size-20241201-143022/
│   ├── msgsize-1024b.log
│   └── ...
├── performance-summary-20241201-143022.txt
└── ...
```

## 🔗 Access Methods

### SSH Access
```bash
# Connect to load test instance
ssh -i john.davis.pem ec2-user@<load-test-public-ip>

# Connect to RedPanda nodes (via bastion/load-test instance)
ssh -i john.davis.pem ec2-user@<redpanda-private-ip>
```

### AWS SSM Session Manager
```bash
# List available instances
aws ec2 describe-instances --filters "Name=tag:shasta-role,Values=redpanda-node,load-test"

# Connect without SSH key
aws ssm start-session --target <instance-id>
```

## 🛠️ Troubleshooting

### Common Issues

1. **CDK Bootstrap Required**
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/us-east-1
   ```

2. **Key Pair Not Found**
   - Create key pair in AWS Console or update `KEY_PAIR_NAME`

3. **Cluster Not Ready**
   - Allow 10-15 minutes for full initialization
   - Check CloudWatch logs for user data script execution

4. **Permission Denied**
   - Ensure scripts are executable: `chmod +x scripts/*.sh`
   - Check AWS IAM permissions

### Useful Commands

```bash
# Check RedPanda service status
sudo systemctl status redpanda

# View cluster information
rpk cluster info --brokers $KAFKA_BROKERS

# Monitor system resources
htop
iotop
iostat -x 1

# Check network connectivity
telnet <node-ip> 9092
```

## 🧹 Cleanup

### Destroy Infrastructure
```bash
./scripts/aws-redpanda-deploy.sh destroy
```

**⚠️ Warning**: This will permanently delete all resources!

### Manual Cleanup (if needed)
```bash
# Stop services
sudo systemctl stop redpanda

# Remove installation
sudo rm -rf /opt/redpanda /var/lib/redpanda /etc/redpanda

# Remove user
sudo userdel redpanda
```

## 📚 Additional Resources

- [RedPanda Documentation](https://docs.redpanda.com/)
- [RedPanda GitHub](https://github.com/redpanda-data/redpanda)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Kafka Performance Testing](https://kafka.apache.org/documentation/#basic_ops_benchmarking)

## 🤝 Support

For issues with these scripts:
1. Check the deployment logs in CloudFormation console
2. Review EC2 instance system logs
3. Verify AWS permissions and prerequisites
4. Consult the troubleshooting section above 