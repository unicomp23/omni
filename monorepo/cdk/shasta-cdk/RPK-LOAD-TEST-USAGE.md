# RPK Environment Variables on Load Test Instance

## Overview

The RedPanda cluster setup now automatically configures RPK (RedPanda Kafka client) environment variables on the load test instance, making it easy to use `rpk` commands without manual configuration.

## RPK Variables Available

After running the setup, the following RPK environment variables are automatically configured on the load test instance:

### Core Connectivity
- **`RPK_BROKERS`**: Bootstrap brokers for all Kafka operations
- **`REDPANDA_BROKERS`**: Alternative name for bootstrap brokers  
- **`KAFKA_BROKERS`**: Alternative name for bootstrap brokers
- **`BOOTSTRAP_BROKERS`**: Alternative name for bootstrap brokers

### RPK Service URLs
- **`RPK_SCHEMA_REGISTRY_URL`**: Schema Registry endpoint (port 8081)
- **`RPK_ADMIN_API_URL`**: Admin API endpoint (port 33145)  
- **`RPK_REST_PROXY_URL`**: REST Proxy endpoint (port 8082)

### Connection Settings
- **`RPK_TLS_ENABLED`**: Set to `false` (no encryption)
- **`RPK_SASL_MECHANISM`**: Empty (no authentication)

## Variable Locations

RPK variables are available in multiple locations on the load test instance:

1. **`~/.bashrc`** - Loaded automatically when you SSH to the instance
2. **`~/redpanda-env.sh`** - Standalone script you can source anytime
3. **Current session** - Immediately available after setup

## Example Usage

### SSH to Load Test Instance
```bash
ssh -i /data/.ssh/john.davis.pem ec2-user@{load-test-ip}
```

### Basic RPK Commands
```bash
# All variables are automatically available
echo $RPK_BROKERS
# Output: 10.1.1.100:9092,10.1.2.100:9092,10.1.3.100:9092

# Test cluster connectivity
rpk cluster info

# List topics
rpk topic list

# Create topic
rpk topic create test-topic --partitions 12 --replicas 3

# Produce messages
echo "Hello World" | rpk topic produce test-topic

# Consume messages  
rpk topic consume test-topic --num 1
```

### Schema Registry Operations
```bash
# RPK automatically uses RPK_SCHEMA_REGISTRY_URL
rpk registry schema list

# Create schema
rpk registry schema create test-subject --schema @schema.json
```

### Cluster Management
```bash
# RPK automatically uses RPK_ADMIN_API_URL
rpk cluster config list

# Check cluster health
rpk cluster health
```

### Manual Environment Loading
```bash
# If you need to reload environment variables
source ~/redpanda-env.sh

# This will print confirmation:
# RedPanda environment variables loaded:
#   Brokers: 10.1.1.100:9092,10.1.2.100:9092,10.1.3.100:9092
#   Schema Registry: http://10.1.1.100:8081
#   Admin API: http://10.1.1.100:33145
#   REST Proxy: http://10.1.1.100:8082
```

## Example Values

Typical variable values after setup:
```bash
RPK_BROKERS="10.1.1.100:9092,10.1.2.100:9092,10.1.3.100:9092"
RPK_SCHEMA_REGISTRY_URL="http://10.1.1.100:8081"
RPK_ADMIN_API_URL="http://10.1.1.100:33145" 
RPK_REST_PROXY_URL="http://10.1.1.100:8082"
RPK_TLS_ENABLED="false"
RPK_SASL_MECHANISM=""
```

## How It Works

1. **Setup Process**: When you run `./setup-cluster.sh`, the Go tool automatically:
   - Discovers cluster node IPs from CloudFormation
   - SSHs to the load test instance
   - Configures all RPK variables in `.bashrc` and `~/redpanda-env.sh`
   - Sets variables in the current session

2. **Auto-Discovery**: RPK service URLs are constructed using the first cluster node's private IP

3. **Persistence**: Variables survive instance reboots (stored in `.bashrc`)

4. **Redundancy**: Multiple variable names and locations ensure compatibility

## Troubleshooting

### Check Variables
```bash
# Verify all RPK variables are set
env | grep RPK

# Check specific variable
echo $RPK_BROKERS
```

### Re-source Environment
```bash
# Reload variables from .bashrc
source ~/.bashrc

# Or use the standalone script
source ~/redpanda-env.sh
```

### Manual Configuration (if auto-setup fails)
```bash
export RPK_BROKERS="10.1.1.100:9092,10.1.2.100:9092,10.1.3.100:9092"
export RPK_SCHEMA_REGISTRY_URL="http://10.1.1.100:8081"
export RPK_ADMIN_API_URL="http://10.1.1.100:33145"
export RPK_REST_PROXY_URL="http://10.1.1.100:8082"
```

## Integration with Load Tests

The load test scripts automatically inherit these environment variables, making it seamless to run performance tests against the properly configured cluster. 