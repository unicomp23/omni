# How to Check if Redpanda Brokers Have Joined the Cluster

This guide provides multiple methods to verify that your Redpanda brokers have successfully joined the cluster and are functioning properly.

## Quick Reference

### 🚀 Fastest Methods

```bash
# Quick automated check (recommended)
./quick_cluster_check.sh

# Comprehensive automated check
./check_redpanda_cluster_membership.sh

# Manual check from load test instance
ssh -i ~/.ssh/john.davis.pem ec2-user@<loadtest-ip>
source ~/.bashrc
/opt/kafka/bin/kafka-topics.sh --list --bootstrap-server $REDPANDA_BROKERS
```

## Method 1: Automated Scripts (Recommended)

### A. Quick Cluster Check
```bash
./quick_cluster_check.sh
```

**What it does:**
- Checks cluster accessibility from load test instance
- Verifies all 3 brokers are connected
- Runs a quick health test
- Checks individual broker health
- Provides RPK cluster info

**Advantages:**
- Fast (5-10 seconds)
- Comprehensive overview
- Color-coded output
- No manual SSH required

### B. Comprehensive Cluster Check
```bash
./check_redpanda_cluster_membership.sh
```

**What it does:**
- Detailed health checks for each broker
- Container status verification
- Log analysis
- Built-in health script execution
- Comprehensive cluster testing
- Troubleshooting guidance

**Advantages:**
- Most thorough verification
- Detailed diagnostics
- Automatic retry logic
- Troubleshooting recommendations

## Method 2: Manual Verification via Load Test Instance

### Step 1: Connect to Load Test Instance
```bash
# Get the load test instance IP
./get_redpanda_loadtest_ip.sh

# Or directly:
ssh -i ~/.ssh/john.davis.pem ec2-user@<loadtest-ip>
```

### Step 2: Check Cluster Connectivity
```bash
# Load environment variables
source ~/.bashrc
echo $REDPANDA_BROKERS  # Should show: redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092

# List topics (tests cluster connectivity)
/opt/kafka/bin/kafka-topics.sh --list --bootstrap-server $REDPANDA_BROKERS

# Check broker API versions (shows all connected brokers)
/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server $REDPANDA_BROKERS
```

### Step 3: Verify All Brokers Are Connected
```bash
# This should show 3 brokers with their IDs
/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server $REDPANDA_BROKERS 2>/dev/null | grep "^[0-9]" | wc -l
```

### Step 4: Test Cluster Functionality
```bash
# Create a test topic
/opt/kafka/bin/kafka-topics.sh --create --topic test-cluster \
  --bootstrap-server $REDPANDA_BROKERS \
  --partitions 3 --replication-factor 3

# Produce a test message
echo "Hello Redpanda Cluster" | /opt/kafka/bin/kafka-console-producer.sh \
  --topic test-cluster --bootstrap-server $REDPANDA_BROKERS

# Consume the message
/opt/kafka/bin/kafka-console-consumer.sh \
  --topic test-cluster --bootstrap-server $REDPANDA_BROKERS \
  --from-beginning --max-messages 1

# Clean up
/opt/kafka/bin/kafka-topics.sh --delete --topic test-cluster --bootstrap-server $REDPANDA_BROKERS
```

## Method 3: Direct Broker Verification

### Step 1: Get Broker IPs
```bash
./get_redpanda_broker_ips.sh
```

### Step 2: Connect to Individual Brokers
```bash
# Connect to each broker
ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-public-ip>
```

### Step 3: Check Container Status
```bash
# Check if Redpanda container is running
docker ps --filter name=redpanda-broker

# Check container logs
docker logs redpanda-broker-1  # (or 2, 3 depending on broker)
```

### Step 4: Use Built-in Health Check
```bash
# Run the built-in health check script
/usr/local/bin/redpanda-health-check.sh

# Manual health check
docker exec redpanda-broker-1 rpk cluster health --brokers localhost:9092
```

### Step 5: Get Detailed Cluster Info
```bash
# Get cluster information
docker exec redpanda-broker-1 rpk cluster info --brokers localhost:9092

# Check cluster status
docker exec redpanda-broker-1 rpk cluster status --brokers localhost:9092

# List cluster members
docker exec redpanda-broker-1 rpk cluster members --brokers localhost:9092
```

## Method 4: RPK Commands Reference

### Basic Cluster Commands
```bash
# From inside any broker container
docker exec redpanda-broker-X rpk cluster health --brokers localhost:9092
docker exec redpanda-broker-X rpk cluster info --brokers localhost:9092
docker exec redpanda-broker-X rpk cluster status --brokers localhost:9092
docker exec redpanda-broker-X rpk cluster members --brokers localhost:9092
```

### Topic Management
```bash
# List topics
docker exec redpanda-broker-X rpk topic list --brokers localhost:9092

# Create topic
docker exec redpanda-broker-X rpk topic create test-topic --brokers localhost:9092

# Describe topic
docker exec redpanda-broker-X rpk topic describe test-topic --brokers localhost:9092
```

### Cluster Metadata
```bash
# Get cluster metadata
docker exec redpanda-broker-X rpk cluster metadata --brokers localhost:9092

# Check cluster configuration
docker exec redpanda-broker-X rpk cluster config --brokers localhost:9092
```

## Method 5: AWS CloudWatch Logs

### Check Application Logs
```bash
# View logs in AWS Console
# Go to CloudWatch → Log Groups → /aws/ec2/redpanda

# Or via CLI
aws logs describe-log-streams --log-group-name /aws/ec2/redpanda
aws logs get-log-events --log-group-name /aws/ec2/redpanda --log-stream-name redpanda-broker-1
```

## Method 6: Network Connectivity Tests

### Test Inter-Broker Communication
```bash
# From one broker, test connectivity to others
ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip>

# Test RPC port connectivity
telnet redpanda-broker-2 33145
telnet redpanda-broker-3 33145

# Test Kafka API connectivity
telnet redpanda-broker-2 9092
telnet redpanda-broker-3 9092
```

### DNS Resolution Test
```bash
# Verify broker hostnames resolve correctly
nslookup redpanda-broker-1
nslookup redpanda-broker-2
nslookup redpanda-broker-3

# Check /etc/hosts entries
cat /etc/hosts | grep redpanda
```

## Expected Healthy Cluster Indicators

### ✅ What to Look For

1. **Cluster Health**: `rpk cluster health` shows "Healthy"
2. **Broker Count**: 3 brokers visible in cluster info
3. **Topic Creation**: Can create topics with replication factor 3
4. **Message Flow**: Can produce and consume messages
5. **No Errors**: No connection errors in logs
6. **Container Status**: All containers show "Up" status
7. **Network Connectivity**: All brokers can reach each other on port 33145

### ❌ Warning Signs

1. **Cluster Health**: Shows "Unhealthy" or connection errors
2. **Missing Brokers**: Less than 3 brokers in cluster info
3. **Topic Creation Fails**: Cannot create topics with replication factor 3
4. **Connection Timeouts**: Brokers cannot reach each other
5. **Container Issues**: Containers restarting or stopped
6. **Log Errors**: Raft election failures, network errors, or join failures

## Troubleshooting Common Issues

### Issue 1: Broker Not Joining Cluster
```bash
# Check container logs for errors
docker logs redpanda-broker-X 2>&1 | grep -i error

# Check if broker can reach other brokers
telnet redpanda-broker-Y 33145

# Verify DNS resolution
nslookup redpanda-broker-Y

# Check security groups allow port 33145
```

### Issue 2: Cluster Health Shows Unhealthy
```bash
# Check individual broker health
docker exec redpanda-broker-X rpk cluster health --brokers localhost:9092

# Check cluster members
docker exec redpanda-broker-X rpk cluster members --brokers localhost:9092

# Look for Raft election issues in logs
docker logs redpanda-broker-X 2>&1 | grep -i raft
```

### Issue 3: Cannot Create Topics
```bash
# Check if cluster has enough brokers for replication
docker exec redpanda-broker-X rpk cluster info --brokers localhost:9092

# Try creating topic with lower replication factor
docker exec redpanda-broker-X rpk topic create test --replication-factor 1 --brokers localhost:9092
```

### Issue 4: Network Connectivity Issues
```bash
# Check security groups
aws ec2 describe-security-groups --group-ids <security-group-id>

# Test connectivity between brokers
ssh -i ~/.ssh/john.davis.pem ec2-user@<broker-ip>
nc -zv redpanda-broker-Y 33145  # Test RPC port
nc -zv redpanda-broker-Y 9092   # Test Kafka API port
```

## Performance Verification

### Latency Test
```bash
# From load test instance
cd ~/redpanda-testing
./low-latency-test.sh

# Or manual latency test
/opt/kafka/bin/kafka-run-class.sh kafka.tools.EndToEndLatency \
  $REDPANDA_BROKERS test-latency 1000 1 1024
```

### Throughput Test
```bash
# Producer performance test
/opt/kafka/bin/kafka-producer-perf-test.sh \
  --topic perf-test --num-records 1000000 --record-size 1024 \
  --throughput 50000 --producer-props bootstrap.servers=$REDPANDA_BROKERS

# Consumer performance test
/opt/kafka/bin/kafka-consumer-perf-test.sh \
  --topic perf-test --bootstrap-server $REDPANDA_BROKERS \
  --messages 1000000
```

## Summary

The most efficient way to check if brokers have joined the cluster is:

1. **Quick Check**: `./quick_cluster_check.sh` (fastest)
2. **Detailed Check**: `./check_redpanda_cluster_membership.sh` (most thorough)
3. **Manual Verification**: Connect to load test instance and run Kafka commands
4. **Individual Broker Check**: SSH to brokers and use `rpk` commands

Choose the method that best fits your needs:
- **Development/Testing**: Use the automated scripts
- **Production Monitoring**: Implement automated health checks
- **Troubleshooting**: Use manual verification and log analysis
- **Performance Validation**: Use the load test instance for benchmarking 