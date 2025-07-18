# Redpanda Stack for Low Latency Testing

This stack creates a Redpanda cluster optimized for low latency with 3 brokers across 3 availability zones, along with a load test node for performance testing.

## Architecture

### Components
- **VPC**: Dedicated VPC (10.1.0.0/16) with public and private subnets across 3 AZs
- **Brokers**: 3 x C5n.xlarge instances running Redpanda in private subnets
- **Load Test Node**: 1 x C5n.large instance in public subnet for testing
- **Security Group**: Configured for all necessary Redpanda ports
- **Placement Group**: Cluster placement group for low network latency
- **S3 Bucket**: Dedicated S3 bucket for data storage and metrics

### Low Latency Optimizations
- **Instance Types**: C5n.xlarge with enhanced networking capabilities
- **Storage**: GP3 EBS volumes with 3000 IOPS and 125 MiB/s throughput
- **Network Tuning**: TCP buffer sizes optimized for low latency
- **Redpanda Config**: 
  - Immediate rebalancing (`group_initial_rebalance_delay_ms: 0`)
  - Fast member join timeout (`group_new_member_join_timeout_ms: 5000`)
  - Optimized segment sizes and cache settings

## Prerequisites

1. **AWS Key Pair**: Ensure you have the `john.davis.pem` key file for SSH access
   ```bash
   # Make sure the key file has correct permissions
   chmod 400 john.davis.pem
   ```

2. **CDK Prerequisites**: Ensure AWS CDK is installed and configured
   ```bash
   npm install -g aws-cdk
   cdk bootstrap
   ```

   Note: The stack uses the existing `john.davis` key pair for SSH access.

## Deployment

1. **Deploy the Stack**:
   ```bash
   cdk deploy ShastaRedpandaStack
   ```

2. **Get Stack Outputs**:
   ```bash
   aws cloudformation describe-stacks --stack-name ShastaRedpandaStack --query 'Stacks[0].Outputs'
   ```

## Testing the Cluster

### Connect to Load Test Node

There are multiple ways to connect to the load test node:

**💡 Recommended**: Use SSM Session Manager for the most secure and convenient access without managing SSH keys.

#### Option 1: SSM Session Manager (Recommended)
```bash
# Get the load test instance ID
LOAD_TEST_INSTANCE_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaLoadTest" --query 'Reservations[0].Instances[0].InstanceId' --output text)

# Connect using SSM Session Manager
aws ssm start-session --target $LOAD_TEST_INSTANCE_ID
```

#### Option 2: EC2 Instance Connect
```bash
# Get the load test instance ID
LOAD_TEST_INSTANCE_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaLoadTest" --query 'Reservations[0].Instances[0].InstanceId' --output text)

# Connect using EC2 Instance Connect
aws ec2-instance-connect ssh --instance-id $LOAD_TEST_INSTANCE_ID --os-user ec2-user
```

#### Option 3: Traditional SSH (if needed)
```bash
# Get the public IP from stack outputs
LOAD_TEST_IP=$(aws cloudformation describe-stacks --stack-name ShastaRedpandaStack --query 'Stacks[0].Outputs[?OutputKey==`RedpandaLoadTestIP`].OutputValue' --output text)

# SSH into the load test node using john.davis.pem
ssh -i john.davis.pem ec2-user@$LOAD_TEST_IP
```

### Access Method Benefits

| Method | Pros | Cons | Best For |
|--------|------|------|----------|
| **SSM Session Manager** | • No SSH keys to manage<br>• Works with private instances<br>• Audit logging built-in<br>• No public IP required | • Requires AWS CLI | Production environments, security-conscious deployments |
| **EC2 Instance Connect** | • No SSH keys to manage<br>• Works from browser<br>• Short-lived credentials | • Public instances only<br>• Limited to 60-second sessions | Quick access, development |
| **Traditional SSH** | • Standard SSH workflow<br>• Works with any SSH client<br>• Persistent connections | • Key management required<br>• Public IP needed | Development, automation scripts |

### Run Latency Tests

#### 1. Basic RPK Commands
```bash
# Create a test topic
rpk topic create test-topic --partitions 1 --replicas 3

# Produce a test message
echo "test message" | rpk topic produce test-topic

# Consume messages
rpk topic consume test-topic --from-beginning
```

#### 2. Python Latency Test
```bash
# Run the pre-installed latency test
python3 ~/latency_test.py
```

#### 3. Manual Latency Testing with RPK
```bash
# Create latency test topic
rpk topic create latency-test --partitions 1 --replicas 3

# In one terminal - start consumer
rpk topic consume latency-test --format json

# In another terminal - produce with timestamps
for i in {1..100}; do
  echo '{"id":'$i',"timestamp":'$(date +%s%N)'}' | rpk topic produce latency-test --key test-$i
  sleep 0.001
done
```

#### 4. S3 Operations
```bash
# Test S3 connectivity
python3 ~/s3_test.py

# List S3 bucket contents
bash ~/s3_helper.sh

# Upload test data to S3
echo "test data" > test.txt
aws s3 cp test.txt s3://$REDPANDA_S3_BUCKET/test.txt

# Download from S3
aws s3 cp s3://$REDPANDA_S3_BUCKET/test.txt downloaded.txt

# Store performance metrics
echo '{"latency": 5.2, "throughput": 10000}' > metrics.json
aws s3 cp metrics.json s3://$REDPANDA_S3_BUCKET/metrics/$(date +%s).json
```

## Monitoring and Troubleshooting

### Check Cluster Status
```bash
# From load test node
rpk cluster info
rpk cluster health
```

### Check Broker Logs

#### From Load Test Node
```bash
# Connect to load test node (using SSM - recommended)
LOAD_TEST_INSTANCE_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaLoadTest" --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ssm start-session --target $LOAD_TEST_INSTANCE_ID

# Check if brokers are accessible
rpk cluster info

# Test connectivity to individual brokers
rpk topic list --brokers 10.1.1.100:9092
rpk topic list --brokers 10.1.2.100:9092
rpk topic list --brokers 10.1.3.100:9092
```

#### Direct Broker Access (via SSM)
```bash
# Connect directly to broker instances
BROKER1_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaBroker1" --query 'Reservations[0].Instances[0].InstanceId' --output text)
BROKER2_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaBroker2" --query 'Reservations[0].Instances[0].InstanceId' --output text)
BROKER3_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=ShastaRedpandaStack/RedpandaBroker3" --query 'Reservations[0].Instances[0].InstanceId' --output text)

# Connect to broker 1
aws ssm start-session --target $BROKER1_ID

# Check Redpanda status
sudo systemctl status redpanda
sudo journalctl -u redpanda -f

# Check Redpanda logs
sudo tail -f /var/log/redpanda/redpanda.log
```

### Performance Metrics
```bash
# Check topic performance
rpk topic describe latency-test --print-usage

# Monitor consumer lag
rpk group describe test-group --print-lag
```

## Configuration Details

### Redpanda Configuration
- **Ports**: 9092 (Kafka), 9644 (Admin), 8081 (Schema Registry), 8082 (REST Proxy), 33145 (RPC)
- **Replication Factor**: 3 (for durability)
- **Optimized for**: Low latency over high throughput

### Network Configuration
- **VPC CIDR**: 10.1.0.0/16
- **Public Subnets**: 10.1.1.0/24, 10.1.2.0/24, 10.1.3.0/24
- **Private Subnets**: 10.1.4.0/24, 10.1.5.0/24, 10.1.6.0/24

### S3 Configuration
- **Bucket Name**: `redpanda-data-{account-id}-{region}`
- **Permissions**: Read/Write access for all EC2 instances
- **Encryption**: S3 managed encryption
- **Usage**: Performance metrics, test data, backups

### Access Methods
- **SSM Session Manager**: Secure shell access without SSH keys or public IPs
- **EC2 Instance Connect**: Browser-based or CLI SSH access for public instances
- **Traditional SSH**: Key-based SSH access (keys stored in Parameter Store)
- **Instance Connect Endpoints**: Secure access to private instances via AWS service

## Expected Latency Performance

With this configuration, you should expect:
- **P50 Latency**: < 5ms
- **P95 Latency**: < 15ms  
- **P99 Latency**: < 25ms

Results will vary based on:
- Message size
- Network conditions
- Producer/consumer configuration
- Topic configuration (partitions, replication factor)

## Cleanup

To remove the stack:
```bash
cdk destroy ShastaRedpandaStack
```

## Cost Considerations

This stack uses:
- 3 x C5n.xlarge instances (~$0.216/hour each)
- 1 x C5n.large instance (~$0.108/hour)
- EBS GP3 volumes (100GB each)
- VPC resources (NAT Gateway, etc.)
- S3 bucket (storage and requests)

**Estimated monthly cost**: ~$600-700 (varies by region and usage) 