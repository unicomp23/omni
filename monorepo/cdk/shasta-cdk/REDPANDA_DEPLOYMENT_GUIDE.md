# RedPanda Low-Latency Cluster Deployment Guide

## Overview

This CDK stack deploys a high-performance RedPanda cluster spanning 3 availability zones with a dedicated load testing instance. All instances are SSH-accessible via `john.davis.pem` and AWS SSM Session Manager.

## Architecture

- **RedPanda Cluster**: 3 x i4i.2xlarge instances (one per AZ)
- **Load Testing Instance**: 1 x c5n.4xlarge instance
- **VPC**: Dedicated VPC with public and private subnets across 3 AZs
- **Storage**: GP3 EBS volumes with high IOPS (16,000) and throughput (1,000 MB/s)
- **Security**: Comprehensive security groups for RedPanda ports and SSH access

## RedPanda Configuration

### Low-Latency Optimizations

The cluster is configured with the following optimizations:

- **Network Tuning**: Increased socket buffer sizes
- **Memory Locking**: Prevents swapping to disk
- **CPU Tuning**: Optimized for low latency
- **Disk Scheduler**: Optimized for SSD performance
- **Swappiness**: Set to 1 to minimize swapping

### Ports

- **9092**: Kafka API (client connections)
- **8081**: Schema Registry API
- **8082**: REST Proxy API
- **33145**: Admin/RPC API
- **9644**: Prometheus metrics

## Deployment Steps

### Prerequisites

1. Ensure you have AWS CLI configured
2. Have the `john.davis.pem` key pair in your AWS account in us-east-1
3. Install AWS CDK: `npm install -g aws-cdk`
4. Install dependencies: `npm install`

### Deploy the Infrastructure

```bash
# Deploy Layer 1 first (VPC, base resources)
cdk deploy ShastaCdkStackL1

# Deploy the RedPanda cluster
cdk deploy RedPandaClusterStack

# Optionally deploy Layer 2 (existing producer/consumer instances)
cdk deploy ShastaCdkStackL2
```

### Post-Deployment

1. Wait for all instances to initialize (5-10 minutes)
2. Check instance status in AWS Console
3. Verify RedPanda cluster health via SSH

## Accessing the Cluster

### SSH Access

```bash
# Connect to RedPanda nodes (replace with actual private IPs)
ssh -i john.davis.pem ec2-user@<redpanda-node-private-ip>

# Connect to load test instance (replace with actual public IP)  
ssh -i john.davis.pem ec2-user@<load-test-instance-public-ip>
```

### SSM Session Manager Access

```bash
# List instances
aws ec2 describe-instances --filters "Name=tag:shasta-role,Values=redpanda-node" --query 'Reservations[].Instances[].InstanceId'

# Connect via SSM
aws ssm start-session --target <instance-id>
```

## Cluster Management

### RedPanda CLI (rpk) Commands

```bash
# SSH into any RedPanda node
ssh -i john.davis.pem ec2-user@<redpanda-node-ip>

# Check cluster status
docker exec redpanda-0 rpk cluster info

# List topics
docker exec redpanda-0 rpk topic list

# Create a topic
docker exec redpanda-0 rpk topic create test-topic --partitions 12 --replicas 3

# Produce messages
docker exec -it redpanda-0 rpk topic produce test-topic

# Consume messages
docker exec -it redpanda-0 rpk topic consume test-topic
```

### Monitoring

```bash
# Check RedPanda container logs
docker logs redpanda-0

# Check system metrics
htop
iotop
```

## Load Testing

### Pre-installed Tools

The load testing instance comes with:

- Kafka CLI tools (`/opt/kafka/bin/`)
- Python Kafka libraries
- Custom performance test script

### Running Performance Tests

```bash
# SSH into load test instance
ssh -i john.davis.pem ec2-user@<load-test-instance-public-ip>

# Run the included performance test
cd ~/load-test-scripts
./kafka-perf-test.sh
```

### Custom Load Tests

```bash
# Producer performance test
kafka-producer-perf-test.sh \
  --topic load-test-topic \
  --num-records 1000000 \
  --record-size 1024 \
  --throughput 100000 \
  --producer-props bootstrap.servers=$KAFKA_BROKERS

# Consumer performance test
kafka-consumer-perf-test.sh \
  --bootstrap-server $KAFKA_BROKERS \
  --topic load-test-topic \
  --messages 1000000 \
  --show-detailed-stats
```

## Environment Variables

### RedPanda Nodes

- `REDPANDA_BROKERS`: localhost:9092
- `NODE_ID`: Node identifier (0, 1, 2)
- `REDPANDA_CONFIG_FILE`: /etc/redpanda/redpanda.yaml

### Load Test Instance

- `KAFKA_BROKERS`: RedPanda cluster bootstrap servers
- `KAFKA_HOME`: /opt/kafka
- `PATH`: Includes Kafka CLI tools

## Troubleshooting

### Common Issues

1. **Cluster not forming**: Check hostname resolution in `/etc/hosts`
2. **Connection timeouts**: Verify security group rules
3. **High latency**: Check system tuning and disk performance
4. **RedPanda not starting**: Check Docker logs and configuration

### Useful Commands

```bash
# Check RedPanda status
systemctl status docker
docker ps -a

# Test network connectivity between nodes
telnet <other-node-ip> 9092

# Check system tuning
sysctl -a | grep net.core

# Monitor disk performance
iostat -x 1
```

## Scaling

### Adding More Nodes

1. Modify the `azCount` variable in the stack
2. Update the seed servers configuration
3. Redeploy the stack
4. Join new nodes to the cluster

### Vertical Scaling

1. Stop RedPanda on the node
2. Change instance type in CDK
3. Redeploy
4. Restart RedPanda

## Clean Up

```bash
# Destroy all stacks (be careful!)
cdk destroy RedPandaClusterStack
cdk destroy ShastaCdkStackL2  # if deployed
cdk destroy ShastaCdkStackL1
```

## Performance Tuning Tips

1. **Network**: Use placement groups for lowest latency
2. **Storage**: Consider i4i instances with NVMe SSDs for ultra-low latency
3. **CPU**: Pin RedPanda to specific CPU cores
4. **Memory**: Increase heap size for heavy workloads
5. **Partitions**: Use 2-3x the number of partitions as brokers

## Support

For RedPanda-specific issues, consult:
- [RedPanda Documentation](https://docs.redpanda.com/)
- [RedPanda GitHub](https://github.com/redpanda-data/redpanda)
- AWS EC2 performance best practices 