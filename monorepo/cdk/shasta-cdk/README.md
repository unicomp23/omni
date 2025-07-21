# RedPanda Low-Latency Cluster Deployment

Complete infrastructure-as-code solution for deploying and managing high-performance RedPanda clusters on AWS using CDK and automated scripts.

## 🚀 Quick Start

```bash
# 1. Deploy AWS infrastructure (VPC, EC2, storage, networking)
./deploy.sh deploy

# 2. Install & configure RedPanda cluster + run validation tests
./deploy.sh setup

# 3. Access your cluster (see output for SSH commands)
# 4. Run performance tests as needed
```

## 📋 Prerequisites

- **AWS CLI** configured with appropriate permissions
- **AWS CDK** installed (`npm install -g aws-cdk`)
- **EC2 Key Pair** named `john.davis` in `us-east-1` (or customize with environment variables)
- Key file `john.davis.pem` in the project root directory

## 🏗️ What Gets Deployed

### Infrastructure (CDK)
- **VPC** with public/private subnets across 3 availability zones
- **3x RedPanda Nodes** (i4i.2xlarge) with high-performance NVMe storage
- **1x Load Testing Instance** (c5n.4xlarge) for performance validation
- **Security Groups** configured for RedPanda ports (9092, 9644, 33145, 8081, 8082)
- **GP3 Storage** with 16,000 IOPS and 1,000 MB/s throughput per instance
- **Auto-assigned Public IPs** for external access

### RedPanda Configuration
- **3-node cluster** with automatic discovery and formation
- **Docker-based deployment** for reliability and consistency
- **Development mode** optimized for testing and performance evaluation
- **System tuning** applied for low-latency messaging
- **Comprehensive monitoring** and health checks

## 🛠️ Commands

```bash
./deploy.sh <command>
```

| Command | Description |
|---------|-------------|
| `deploy`, `d` | Deploy AWS infrastructure via CDK |
| `setup`, `i` | Install and configure RedPanda on deployed instances |
| `status`, `s` | Show current infrastructure deployment status |
| `test`, `t` | Show instructions for running performance tests |
| `destroy` | Destroy all AWS infrastructure ⚠️ |
| `help`, `h` | Show help message |

## 🔧 Configuration

### Environment Variables

```bash
AWS_REGION=us-east-1         # AWS deployment region
KEY_PAIR_NAME=john.davis     # EC2 key pair name
STACK_PREFIX=ShastaCdk       # CloudFormation stack prefix
```

### Custom Configuration Example

```bash
AWS_REGION=us-west-2 KEY_PAIR_NAME=my-key ./deploy.sh deploy
```

## 📊 Testing & Validation

### Automated Health Checks
The setup process automatically validates:
- ✅ Infrastructure deployment
- ✅ Instance connectivity
- ✅ RedPanda installation
- ✅ Cluster formation and node discovery
- ✅ API readiness (`/v1/status/ready` endpoints)
- ✅ Basic producer/consumer functionality

### Performance Testing Suite

After deployment, use the comprehensive performance testing tools:

```bash
# SSH to load testing instance (see setup output for exact command)
ssh -i john.davis.pem ec2-user@<load-test-ip>

# Quick performance test (100k messages)
./redpanda-performance-tests.sh quick

# Full performance suite
./redpanda-performance-tests.sh all

# Custom tests
./redpanda-performance-tests.sh throughput    # Throughput scaling
./redpanda-performance-tests.sh latency      # End-to-end latency
./redpanda-performance-tests.sh scaling      # Message size scaling
```

### Test Metrics Collected
- **Throughput**: Messages per second at various loads
- **Latency**: P50, P95, P99 message delivery times
- **Scaling**: Performance across different message sizes
- **Replication**: Impact of replication factor on performance
- **System Resources**: CPU, memory, disk, and network utilization

## 🔍 Cluster Management

### Access Your Cluster

After successful deployment, you'll receive SSH access commands:

```bash
# RedPanda nodes
ssh -i john.davis.pem ec2-user@<node-0-ip>
ssh -i john.davis.pem ec2-user@<node-1-ip>
ssh -i john.davis.pem ec2-user@<node-2-ip>

# Load testing instance
ssh -i john.davis.pem ec2-user@<load-test-ip>
```

### Common Operations

```bash
# Check cluster status
rpk cluster info --brokers $BOOTSTRAP_SERVERS

# List topics
rpk topic list --brokers $BOOTSTRAP_SERVERS

# Create a topic
rpk topic create my-topic --partitions 6 --replicas 3 --brokers $BOOTSTRAP_SERVERS

# Monitor cluster health
curl http://<node-ip>:9644/v1/status/ready

# Check Docker containers
sudo docker ps
sudo docker logs redpanda-node
```

## 🏛️ Architecture

### Network Layout
```
┌─── VPC (10.0.0.0/16) ───────────────────────────┐
│                                                 │
│  ┌─ AZ-a ─┐  ┌─ AZ-b ─┐  ┌─ AZ-c ─┐          │
│  │ Public  │  │ Public  │  │ Public  │          │
│  │ 10.0.0  │  │ 10.0.1  │  │ 10.0.2  │          │
│  │         │  │         │  │         │          │
│  │ RP-0    │  │ RP-1    │  │ RP-2    │          │
│  │ Test    │  │         │  │         │          │
│  └─────────┘  └─────────┘  └─────────┘          │
└─────────────────────────────────────────────────┘
```

### RedPanda Cluster Layout
- **Node 0**: Bootstrap node (10.0.0.x)
- **Node 1**: Cluster member (10.0.1.x)  
- **Node 2**: Cluster member (10.0.2.x)
- **Load Tester**: Performance testing (10.0.0.x)

### Port Configuration
- **9092**: Kafka API
- **9644**: Admin API
- **33145**: Internal RPC
- **8081**: Schema Registry
- **8082**: HTTP Proxy

## 🔐 Security

### Security Groups
- **Inbound**: SSH (22), RedPanda ports (9092, 9644, 33145, 8081, 8082)
- **Outbound**: All traffic allowed
- **Source**: Your IP for SSH, cluster IPs for inter-node communication

### IAM Permissions
Instances have minimal IAM roles for:
- EC2 metadata service access
- CloudWatch logs (if enabled)
- Systems Manager for remote access

## 🚨 Troubleshooting

### Common Issues

**Infrastructure deployment fails**
```bash
# Check AWS credentials and permissions
aws sts get-caller-identity
cdk bootstrap  # If first time using CDK in region
```

**RedPanda setup fails**
```bash
# Check instance connectivity
ssh -i john.davis.pem ec2-user@<node-ip> "curl -s http://169.254.169.254/latest/meta-data/local-ipv4"

# Check Docker status
ssh -i john.davis.pem ec2-user@<node-ip> "sudo docker ps -a"

# View detailed logs
ssh -i john.davis.pem ec2-user@<node-ip> "sudo docker logs redpanda-node"
```

**Cluster formation issues**
```bash
# Verify network connectivity between nodes
ssh -i john.davis.pem ec2-user@<node-0-ip> "telnet <node-1-ip> 33145"

# Check security group rules
aws ec2 describe-security-groups --group-names <security-group-name>
```

### Log Locations
- **Setup logs**: Console output during `./deploy.sh setup`
- **RedPanda logs**: Docker container logs via `docker logs redpanda-node`
- **Performance test results**: `/home/ec2-user/test-results/` on load test instance

## 💰 Cost Optimization

### Instance Types & Estimated Costs (us-east-1)
- **3x i4i.2xlarge**: ~$1.40/hour (~$1,000/month)
- **1x c5n.4xlarge**: ~$0.77/hour (~$550/month)
- **Storage & Network**: ~$200/month
- **Total**: ~$1,750/month

### Cost Reduction Options
- Use smaller instance types for non-production testing
- Stop instances when not in use (storage costs remain)
- Use Spot instances for development (add to CDK configuration)

## 🗑️ Cleanup

```bash
# Destroy all AWS resources
./deploy.sh destroy

# Confirm deletion in AWS Console
# - CloudFormation stacks removed
# - EC2 instances terminated  
# - EBS volumes deleted
# - VPC and networking cleaned up
```

**⚠️ Warning**: This permanently deletes all data and resources. Ensure you have backups if needed.

## 📚 Additional Resources

- **RedPanda Documentation**: https://docs.redpanda.com
- **AWS CDK Guide**: https://docs.aws.amazon.com/cdk/
- **Performance Tuning**: See `scripts/redpanda-performance-tests.sh`
- **Monitoring Setup**: Consider adding CloudWatch integration

## 🤝 Support

For issues with this deployment:
1. Check the troubleshooting section above
2. Review CloudFormation and EC2 console for infrastructure issues
3. SSH into instances to debug RedPanda-specific problems
4. Check security groups and network connectivity

---

**Built with**: AWS CDK, Docker, RedPanda, and comprehensive automation scripts for production-ready cluster deployment.