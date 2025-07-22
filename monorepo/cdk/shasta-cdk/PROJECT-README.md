# RedPanda Cluster & Load Testing on AWS

Complete solution for deploying and load testing RedPanda clusters on AWS using CDK, Docker containers, and franz-go.

## 🏗️ Architecture Overview

This project provides:
1. **CDK Stack**: AWS infrastructure (EC2, VPC, Security Groups, S3)
2. **RedPanda Setup**: Automated cluster deployment using Docker
3. **Load Testing**: High-performance testing using franz-go
4. **Management Tools**: Cluster monitoring and maintenance utilities

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   CDK Deployment    │    │  RedPanda Setup     │    │   Load Testing      │
│                     │    │                     │    │                     │
│ • EC2 Instances     │───▶│ • Docker Containers │───▶│ • franz-go Client   │
│ • VPC & Networking  │    │ • Cluster Config    │    │ • Producer/Consumer │
│ • Security Groups   │    │ • Health Checks     │    │ • Performance Metrics│
│ • S3 Bucket        │    │ • Management Utils  │    │ • Multiple Scenarios │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
```

## 🚀 Quick Start (Complete Workflow)

### 1. Deploy Infrastructure
```bash
# Deploy CDK stack
npm install
cdk deploy RedPandaClusterStack

# Note the outputs: RedPanda IPs, Load Test instance IP, S3 bucket
```

### 2. Setup RedPanda Cluster
```bash
# Run the automated setup
cd redpanda-setup
./setup-cluster.sh

# This will:
# - Discover your EC2 instances from CDK
# - SSH to each node and install RedPanda via Docker
# - Configure the cluster with proper replication
# - Verify cluster health
```

### 3. Deploy Load Testing Code
```bash
# Upload load test to S3 (from your local machine)
./upload-to-s3.sh

# SSH to load test instance
ssh -i ~/.ssh/john.davis.pem ec2-user@{load-test-instance-ip}

# Download and run load test
cd ~/scripts
./download-and-run-load-test.sh
```

### 4. Run Load Tests
```bash
# On the load test instance:
cd ~/load-test-scripts

# Quick test
./quick-tests.sh

# Or custom test
./run.sh --producers 12 --consumers 12 --duration 5m
```

## 📁 Project Structure

```
.
├── lib/
│   ├── redpanda-cluster-stack.ts    # CDK stack definition
│   └── shasta-cdk-stack.ts          # Base infrastructure
├── redpanda-setup/                  # RedPanda cluster setup
│   ├── main.go                      # Setup tool (Go)
│   ├── setup-cluster.sh             # Convenience script
│   ├── cluster-utils.sh             # Management utilities
│   └── README.md                    # Setup documentation
├── load-test/                       # Load testing suite  
│   ├── main.go                      # franz-go load test
│   ├── run.sh                       # Load test runner
│   ├── quick-tests.sh               # Predefined scenarios
│   └── README.md                    # Load test documentation
├── upload-to-s3.sh                  # Upload script for local use
└── PROJECT-README.md                # This file
```

## 🔧 Component Details

### CDK Stack Features
- **3 RedPanda Nodes**: i4i.2xlarge instances across AZs
- **Load Test Instance**: c5n.4xlarge for high network performance  
- **S3 Integration**: Bucket for load test code deployment
- **Security Groups**: Proper port configuration for RedPanda services
- **VPC Integration**: Uses existing Shasta VPC infrastructure

### RedPanda Setup Features
- **Docker-based**: Uses official RedPanda images
- **Auto-configuration**: Generates proper cluster configs
- **CDK Integration**: Reads instance IPs from CloudFormation
- **SSH Automation**: Handles all remote setup tasks
- **Health Verification**: Validates cluster after setup

### Load Testing Features
- **High Performance**: franz-go client (fastest Kafka client for Go)
- **Comprehensive Metrics**: Throughput, latency, consumer lag
- **Flexible Configuration**: Multiple producers/consumers, message sizes
- **Compression Support**: All major algorithms (gzip, snappy, lz4, zstd)
- **Auto-discovery**: Finds RedPanda brokers automatically

## 🎯 Load Test Scenarios

### Predefined Tests (`./quick-tests.sh`)
1. **Quick Test**: Light load, 30 seconds
2. **Throughput Test**: High load, 5 minutes  
3. **Large Messages**: 16KB messages with compression
4. **Compression Comparison**: Test all algorithms
5. **Latency Test**: Low load for latency measurement
6. **Stress Test**: Maximum load, 10 minutes

### Custom Testing
```bash
./run.sh \
    --producers 12 \
    --consumers 12 \
    --message-size 4096 \
    --duration 10m \
    --compression zstd \
    --topic high-throughput-test
```

## 📊 Expected Performance

With the default i4i.2xlarge instances:
- **Throughput**: 100K+ messages/sec per producer
- **Latency**: Sub-millisecond at moderate loads
- **Bandwidth**: 100+ MB/sec per node
- **Concurrent Connections**: Thousands of producer/consumer clients

## 🛠️ Management Commands

### Cluster Management
```bash
cd redpanda-setup
./cluster-utils.sh status      # Check cluster health
./cluster-utils.sh info        # Detailed cluster info  
./cluster-utils.sh topics      # List topics
./cluster-utils.sh restart     # Restart all containers
./cluster-utils.sh shell       # SSH to first node
./cluster-utils.sh brokers     # Show bootstrap brokers
```

### Manual Operations
```bash
# SSH to any RedPanda node
ssh -i ~/.ssh/john.davis.pem ec2-user@{redpanda-node-ip}

# Check container status
sudo docker ps | grep redpanda

# View RedPanda logs
sudo docker logs redpanda

# Use rpk CLI
sudo docker exec redpanda rpk cluster info
sudo docker exec redpanda rpk topic create test-topic -p 12 -r 3
```

## ⚙️ Configuration

### Environment Variables
```bash
# RedPanda Setup
export STACK_NAME="RedPandaClusterStack"
export AWS_DEFAULT_REGION="us-east-1"
export KEY_PATH="$HOME/.ssh/john.davis.pem"
export REDPANDA_VERSION="v23.3.3"

# Load Testing  
export REDPANDA_BROKERS="10.0.1.100:9092,10.0.2.100:9092,10.0.3.100:9092"
export BUCKET_NAME="redpanda-load-test-123456789-us-east-1"
```

### RedPanda Configuration
Each node gets optimized configuration:
- **Production Mode**: `developer_mode: false`
- **Auto-create Topics**: Enabled for testing convenience
- **Proper Clustering**: All nodes as seed servers
- **Service Endpoints**: Kafka, Admin, Schema Registry, REST Proxy
- **Persistent Storage**: Data survives container restarts

## 📈 Monitoring & Metrics

### Load Test Metrics (Real-time)
```
=== Load Test Metrics (Elapsed: 2m30s) ===
Messages: Sent=750000, Received=749500, Errors=0
Current Rate: Sent=5000/s, Received=4995/s  
Average Rate: Sent=5000/s, Received=4994/s
Throughput: Sent=5.12 MB/s, Received=5.11 MB/s
Consumer Lag: 500 messages
```

### Cluster Health Monitoring
```bash
# Quick health check
./cluster-utils.sh status

# Detailed cluster info
./cluster-utils.sh info

# Check specific metrics
ssh -i ~/.ssh/john.davis.pem ec2-user@{node-ip}
sudo docker exec redpanda rpk cluster partitions
sudo docker exec redpanda rpk redpanda admin brokers list
```

## 🔐 Security

- **VPC Isolation**: All instances in private/public subnets
- **Security Groups**: Restrictive access (SSH from anywhere, RedPanda within VPC)
- **IAM Roles**: Minimal required permissions
- **SSH Keys**: EC2 key pair authentication
- **S3 Access**: Load test instance can read/write to dedicated bucket

## 🚨 Troubleshooting

### Common Issues

**CDK Deployment Fails**
```bash
# Check AWS credentials
aws sts get-caller-identity

# Verify VPC exists (from base stack)
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=ShastaVPC"
```

**RedPanda Setup Fails**
```bash
# Check SSH connectivity
ssh -i ~/.ssh/john.davis.pem ec2-user@{node-ip} 'echo "SSH OK"'

# Verify Docker is running
ssh -i ~/.ssh/john.davis.pem ec2-user@{node-ip} 'sudo docker --version'
```

**Load Test Issues**
```bash
# Check broker connectivity
telnet {redpanda-private-ip} 9092

# Verify S3 access
aws s3 ls s3://{bucket-name}/
```

## 🔄 Complete Workflow Example

```bash
# 1. Deploy infrastructure
cdk deploy RedPandaClusterStack

# 2. Setup RedPanda cluster  
cd redpanda-setup
./setup-cluster.sh

# 3. Upload and run load tests
./upload-to-s3.sh
ssh -i ~/.ssh/john.davis.pem ec2-user@{load-test-ip}
cd ~/scripts && ./download-and-run-load-test.sh

# 4. Monitor and manage
cd redpanda-setup
./cluster-utils.sh status
./cluster-utils.sh info
```

## 📚 Further Reading

- [RedPanda Documentation](https://docs.redpanda.com/)
- [franz-go Client Library](https://github.com/twmb/franz-go)
- [AWS CDK TypeScript Guide](https://docs.aws.amazon.com/cdk/v2/guide/work-with-cdk-typescript.html)
- [Kafka Performance Testing Best Practices](https://kafka.apache.org/documentation/#bestpractices)

This project provides a complete, production-ready RedPanda testing environment with automated setup and comprehensive load testing capabilities! 🎯 