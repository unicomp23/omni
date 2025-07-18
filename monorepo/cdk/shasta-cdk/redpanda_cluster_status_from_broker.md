# Checking Redpanda Cluster Status from Broker EC2 Instance

## Prerequisites
- SSH access to a Redpanda broker instance
- Redpanda container running on the instance

## Method 1: Using RPK (Redpanda Keeper) Commands

### Basic Cluster Health Check
```bash
# Check overall cluster health
docker exec redpanda-broker-1 rpk cluster health --brokers localhost:9092

# Alternative: Check from host (if rpk is installed on host)
rpk cluster health --brokers localhost:9092
```

### Detailed Cluster Information
```bash
# Get comprehensive cluster info
docker exec redpanda-broker-1 rpk cluster info --brokers localhost:9092

# Check cluster metadata
docker exec redpanda-broker-1 rpk cluster metadata --brokers localhost:9092
```

### Broker-Specific Status
```bash
# List all brokers in the cluster
docker exec redpanda-broker-1 rpk cluster brokers --brokers localhost:9092

# Check specific broker status
docker exec redpanda-broker-1 rpk cluster status --brokers localhost:9092
```

### Topic and Partition Information
```bash
# List all topics
docker exec redpanda-broker-1 rpk topic list --brokers localhost:9092

# Create a test topic to verify cluster functionality
docker exec redpanda-broker-1 rpk topic create test-topic --brokers localhost:9092 --partitions 3 --replicas 3

# Check topic details
docker exec redpanda-broker-1 rpk topic describe test-topic --brokers localhost:9092
```

## Method 2: Using Direct Container Commands

### Check Container Status
```bash
# Check if Redpanda container is running
docker ps | grep redpanda

# Check container logs
docker logs redpanda-broker-1 --tail 50

# Check container health
docker exec redpanda-broker-1 rpk redpanda admin brokers list
```

### Internal Redpanda Status
```bash
# Check Redpanda admin API
docker exec redpanda-broker-1 curl -s http://localhost:9644/v1/status/ready

# Check cluster configuration
docker exec redpanda-broker-1 rpk cluster config status --brokers localhost:9092

# Check partition leadership
docker exec redpanda-broker-1 rpk cluster partitions --brokers localhost:9092
```

## Method 3: Network and Connectivity Tests

### Test Inter-Broker Communication
```bash
# Test connectivity to other brokers (replace with actual IPs)
ping redpanda-broker-2
ping redpanda-broker-3

# Test RPC port connectivity
telnet redpanda-broker-2 33145
telnet redpanda-broker-3 33145

# Test Kafka API connectivity
telnet redpanda-broker-2 9092
telnet redpanda-broker-3 9092
```

### Check Network Configuration
```bash
# Check current IP addresses
curl -s http://169.254.169.254/latest/meta-data/local-ipv4    # Private IP
curl -s http://169.254.169.254/latest/meta-data/public-ipv4   # Public IP

# Check /etc/hosts for broker hostnames
cat /etc/hosts | grep redpanda

# Check network interfaces
ip addr show
```

## Method 4: Using Built-in Health Check Script

```bash
# Run the health check script (created during deployment)
/usr/local/bin/redpanda-health-check.sh

# Check script contents
cat /usr/local/bin/redpanda-health-check.sh
```

## Method 5: Production and Performance Monitoring

### Check Resource Usage
```bash
# Check memory usage
docker exec redpanda-broker-1 rpk redpanda admin brokers list --format json | jq '.[] | {id, membership_status, is_alive}'

# Check disk usage
df -h
docker exec redpanda-broker-1 du -sh /var/lib/redpanda/data

# Check CPU and memory
htop
docker stats redpanda-broker-1
```

### Performance Metrics
```bash
# Check metrics endpoint
docker exec redpanda-broker-1 curl -s http://localhost:9644/metrics | grep -E "(redpanda_|kafka_)"

# Check partition count and replication
docker exec redpanda-broker-1 rpk topic describe-all --brokers localhost:9092
```

## Method 6: Troubleshooting Commands

### Common Issues and Diagnostics
```bash
# Check if all expected brokers are visible
docker exec redpanda-broker-1 rpk cluster brokers --brokers localhost:9092 | wc -l
# Should return 3 (for 3-broker cluster)

# Check for any error messages
docker logs redpanda-broker-1 2>&1 | grep -i error | tail -20

# Check cluster membership
docker exec redpanda-broker-1 rpk cluster info --brokers localhost:9092 | grep -E "(Broker|ID|Host)"

# Test produce/consume functionality
docker exec redpanda-broker-1 rpk topic produce test-topic --brokers localhost:9092 <<< "test message"
docker exec redpanda-broker-1 rpk topic consume test-topic --brokers localhost:9092 --offset start --num 1
```

## Quick Status Check Script

Create a quick status script on the broker:

```bash
cat > /tmp/quick_status.sh << 'EOF'
#!/bin/bash
echo "=== Redpanda Cluster Status ==="
echo "Container Status:"
docker ps | grep redpanda || echo "❌ No Redpanda container running"

echo -e "\nCluster Health:"
docker exec redpanda-broker-1 rpk cluster health --brokers localhost:9092 2>/dev/null || echo "❌ Cannot connect to cluster"

echo -e "\nBroker Count:"
BROKER_COUNT=$(docker exec redpanda-broker-1 rpk cluster brokers --brokers localhost:9092 2>/dev/null | wc -l)
echo "Active brokers: $BROKER_COUNT"

echo -e "\nCluster Info:"
docker exec redpanda-broker-1 rpk cluster info --brokers localhost:9092 2>/dev/null || echo "❌ Cannot get cluster info"
EOF

chmod +x /tmp/quick_status.sh
/tmp/quick_status.sh
```

## Expected Healthy Output

When the cluster is healthy, you should see:
- `rpk cluster health` returns "Healthy" status
- `rpk cluster brokers` shows all 3 brokers
- `rpk cluster info` shows proper cluster metadata
- Container logs show no critical errors
- All brokers can communicate on port 33145 (RPC)
- All brokers respond on port 9092 (Kafka API)

## Common Issues and Solutions

1. **"Connection refused"**: Check if container is running and ports are open
2. **"No brokers available"**: Check network connectivity and security groups
3. **"Partial cluster"**: Some brokers may still be starting up
4. **"Leadership election"**: Normal during startup, should resolve quickly

Use these commands to diagnose and monitor your Redpanda cluster health from any broker instance! 