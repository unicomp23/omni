# Shasta CDK Project

Complete solution for deploying and load testing RedPanda clusters on AWS using CDK, native RPM packages, and franz-go.

## Quick Overview

This project provides a complete infrastructure-as-code solution for:
1. **AWS Infrastructure**: VPC, EC2, Security Groups using CDK
2. **RedPanda Setup**: Automated cluster deployment using native installation
3. **Load Testing**: High-performance testing using franz-go client

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ • CDK Deploy    │───▶│ • Native RPM    │───▶│ • franz-go Client│
│ • VPC Setup     │    │ • systemd svc   │    │ • Go Load Test  │
│ • EC2 Instances │───▶│ • systemd svc   │───▶│ • Go Load Test  │
│ • Security Grps │    │ • systemd svc   │    │ • Metrics       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
    Infrastructure         RedPanda Cluster       Load Testing
```

## 🚀 Quick Start (Complete Automated Workflow)

### **NEW: One-Command Load Testing** ⭐

The easiest way to run load tests is using our complete automation:

```bash
# Deploy infrastructure first (if not done)
cdk deploy RedPandaClusterStack

# Run complete automated load test
./run-complete-load-test.sh
```

**That's it!** This script will:
1. 🔍 Auto-discover your cluster from CloudFormation
2. 📦 Copy load test code to the instance  
3. 🔨 Install Go and build the binary
4. 🚀 Run a 30-second load test

### Custom Load Test Parameters

```bash
# High throughput test
PRODUCERS=6 CONSUMERS=6 DURATION=5m ./run-complete-load-test.sh

# Large message test
MESSAGE_SIZE=16384 COMPRESSION=zstd ./run-complete-load-test.sh

# Latency test
PRODUCERS=1 CONSUMERS=1 DURATION=2m ./run-complete-load-test.sh
```

## 📊 **Proven Performance Results**

Our automation has successfully achieved:

- **Throughput**: 291,165+ messages/sec with 2 producers
- **Data Rate**: 284+ MB/sec send throughput
- **Receive Rate**: 582,323+ messages/sec 
- **Scalability**: Tested with 1KB messages, snappy compression
- **Reliability**: 9.3M+ messages processed in 32 seconds

*Results from actual test run on i4i.2xlarge instances*

## 🛠️ Manual Step-by-Step (If Needed)

### 1. Deploy Infrastructure
```bash
# Deploy CDK stack
npm install
cdk deploy RedPandaClusterStack
```

### 2. Setup RedPanda Cluster
```bash
# Run the automated setup
cd redpanda-setup
./setup-cluster.sh
```

### 3. Load Testing Options

**Option A: Complete Automation (Recommended)**
```bash
./run-complete-load-test.sh
```

**Option B: Manual S3 Upload + SSH**
```bash
# Upload to S3
./upload-to-s3.sh

# SSH to load test instance  
ssh -i /data/.ssh/john.davis.pem ec2-user@{load-test-instance-ip}

# Run auto-setup script
./auto-setup-and-run.sh
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
│   ├── auto-setup-and-run.sh       # NEW: Auto-setup script
│   └── README.md                    # Load test documentation
├── run-complete-load-test.sh        # NEW: Complete automation
├── upload-to-s3.sh                  # S3 upload script
└── PROJECT-README.md                # This file
```

## 🔧 Component Details

### CDK Stack Features
- **3 RedPanda Nodes**: i4i.2xlarge instances across AZs
- **Load Test Instance**: c5n.4xlarge for high network performance  
- **S3 Integration**: Bucket for load test code deployment
- **Security Groups**: Proper port configuration for RedPanda services
- **VPC Integration**: Uses existing Shasta VPC infrastructure

### Complete Automation Features ⭐
- **Auto-Discovery**: Finds cluster IPs from CloudFormation
- **SSH Automation**: Handles all file transfers and setup
- **Go Installation**: Installs dependencies on target instance
- **Binary Building**: Compiles load test for target architecture
- **Parameter Support**: Configurable producers, consumers, duration, etc.
- **Error Handling**: Robust error checking and user feedback

### RedPanda Setup Features
- **Multi-AZ Deployment**: 3 nodes across different availability zones
- **High-Performance Instances**: c5.4xlarge with GP3 storage  
- **Native Installation**: RPM packages with systemd service management
- **Production Configuration**: Proper replication, persistence, monitoring
- **Network Optimized**: Host networking, TCP tuning, CPU pinning
- **Management Tools**: Built-in utilities for cluster operations

### Load Testing Features
- **High Performance**: franz-go client (fastest Kafka client for Go)
- **Comprehensive Metrics**: Throughput, latency, consumer lag
- **Detailed Percentiles**: p50, p90, p95, p99, p99.9, p99.99 latency analysis ⭐
- **Flexible Configuration**: Multiple producers/consumers, message sizes
- **Compression Support**: All major algorithms (gzip, snappy, lz4, zstd)
- **Auto-discovery**: Finds RedPanda brokers automatically

## 🎯 Load Test Scenarios

### Automated Quick Tests
```bash
# Using complete automation with different scenarios
PRODUCERS=2 CONSUMERS=2 DURATION=30s ./run-complete-load-test.sh    # Quick test
PRODUCERS=6 CONSUMERS=6 DURATION=5m ./run-complete-load-test.sh      # Throughput test  
MESSAGE_SIZE=16384 COMPRESSION=zstd ./run-complete-load-test.sh       # Large messages
PRODUCERS=1 CONSUMERS=1 ./run-complete-load-test.sh                   # Latency test
```

### Manual Scenarios (on load test instance)
```bash
# Quick test
./auto-setup-and-run.sh --producers 2 --consumers 2 --duration 30s

# Throughput test
./auto-setup-and-run.sh --producers 12 --consumers 12 --duration 5m

# Custom test
./auto-setup-and-run.sh --producers 4 --consumers 4 --message-size 4096 --compression zstd
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

### Load Test Management
```bash
# Complete automation (recommended)
./run-complete-load-test.sh

# Check what's running
ssh -i /data/.ssh/john.davis.pem ec2-user@{load-test-ip} 'ps aux | grep load-test'

# Re-run with different parameters
PRODUCERS=8 CONSUMERS=8 ./run-complete-load-test.sh
```

## ⚙️ Configuration

### Environment Variables
```bash
# Complete Automation
export AWS_PROFILE="358474168551_admin"      # AWS profile
export AWS_DEFAULT_REGION="us-east-1"        # AWS region
export STACK_NAME="RedPandaClusterStack"     # CloudFormation stack
export KEY_PATH="/data/.ssh/john.davis.pem"  # SSH key path

# Load Test Parameters
export PRODUCERS=6          # Number of producer threads
export CONSUMERS=6          # Number of consumer threads
export DURATION=5m          # Test duration
export MESSAGE_SIZE=1024    # Message size in bytes
export COMPRESSION=snappy   # Compression type
```

## 🔐 Security

- **VPC Isolation**: All instances in private/public subnets
- **Security Groups**: Restrictive access (SSH from anywhere, RedPanda within VPC)
- **IAM Roles**: Minimal required permissions
- **SSH Keys**: EC2 key pair authentication
- **S3 Access**: Load test instance can read/write to dedicated bucket

## 🚨 Troubleshooting

### Complete Automation Issues

**Permission Denied**
```bash
chmod +x run-complete-load-test.sh
./run-complete-load-test.sh
```

**AWS Credentials**
```bash
export AWS_PROFILE=358474168551_admin
aws sts get-caller-identity  # Verify credentials
```

**SSH Key Issues**
```bash
chmod 600 /data/.ssh/john.davis.pem
export KEY_PATH="/data/.ssh/john.davis.pem"
```

### Traditional Troubleshooting

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
ssh -i /data/.ssh/john.davis.pem ec2-user@{node-ip} 'echo "SSH OK"'

# Verify RedPanda cluster
ssh -i /data/.ssh/john.davis.pem ec2-user@{node-ip} 'rpk cluster info'

# Test topic operations  
ssh -i /data/.ssh/john.davis.pem ec2-user@{node-ip} 'rpk topic create test-topic -p 3 -r 3'

# Check service status
ssh -i /data/.ssh/john.davis.pem ec2-user@{node-ip} 'sudo systemctl status redpanda'
```

## 🔄 Complete Workflow Example

```