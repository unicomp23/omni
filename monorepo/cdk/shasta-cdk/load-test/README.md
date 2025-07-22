# RedPanda Load Test with franz-go

High-performance load testing tool for RedPanda clusters using the franz-go Kafka client library.

## Features

- **High-Performance**: Uses franz-go, one of the fastest Kafka clients for Go
- **Comprehensive Metrics**: Real-time throughput, latency, and error tracking
- **Flexible Configuration**: Configurable producers, consumers, message sizes, compression
- **Auto-Discovery**: Automatically discovers RedPanda brokers from CloudFormation
- **Topic Management**: Automatically creates topics with specified partitions
- **Multiple Compression**: Support for gzip, snappy, lz4, zstd compression

## Quick Start

1. **Upload to S3** (from your local machine):
   ```bash
   aws s3 sync ./load-test/ s3://redpanda-load-test-{account}-{region}/
   ```

2. **SSH to Load Test Instance**:
   ```bash
   ssh -i ~/.ssh/john.davis.pem ec2-user@{load-test-instance-ip}
   ```

3. **Download and Run**:
   ```bash
   cd ~/scripts
   ./download-and-run-load-test.sh
   ```

## Manual Usage

If you prefer to run manually:

```bash
cd ~/load-test-scripts
./run.sh
```

### Command Line Options

```bash
./run.sh --help
```

Options:
- `--producers N`: Number of producer goroutines (default: 6)
- `--consumers N`: Number of consumer goroutines (default: 6) 
- `--message-size N`: Message size in bytes (default: 1024)
- `--duration D`: Test duration (default: 300s)
- `--compression TYPE`: Compression type: none, gzip, snappy, lz4, zstd (default: snappy)
- `--topic NAME`: Topic name (default: load-test-topic)
- `--partitions N`: Number of topic partitions (default: 12)

## Example Test Scenarios

### 1. Default Load Test
```bash
./run.sh
# 6 producers, 6 consumers, 1KB messages, 5 minutes
```

### 2. High Throughput Test
```bash
./run.sh --producers 12 --consumers 12 --message-size 512 --duration 10m
```

### 3. Large Message Test  
```bash
./run.sh --producers 4 --consumers 4 --message-size 16384 --compression zstd
```

### 4. Compression Comparison
```bash
# Test different compression algorithms
./run.sh --compression none --topic no-compression
./run.sh --compression snappy --topic snappy-compression
./run.sh --compression zstd --topic zstd-compression
```

### 5. Latency Test (Small load)
```bash
./run.sh --producers 1 --consumers 1 --message-size 128
```

## Environment Variables

- `REDPANDA_BROKERS`: Comma-separated broker addresses (auto-discovered if not set)
- `AWS_DEFAULT_REGION`: AWS region for CloudFormation discovery (default: us-east-1)

## Metrics Output

The load test provides real-time metrics every 10 seconds:

```
=== Load Test Metrics (Elapsed: 1m30s) ===
Messages: Sent=450000, Received=449500, Errors=0
Current Rate: Sent=5000/s, Received=4995/s
Average Rate: Sent=5000/s, Received=4994/s
Throughput: Sent=5.12 MB/s, Received=5.11 MB/s
Consumer Lag: 500 messages
```

Final comprehensive results are displayed at test completion.

## Performance Tuning

### Producer Optimization
- Increase `--producers` for higher throughput
- Tune batch size in code for latency vs throughput
- Use appropriate compression for your data

### Consumer Optimization  
- Match `--consumers` to `--partitions` for optimal parallelism
- Monitor consumer lag to ensure consumers keep up

### Message Size Impact
- Smaller messages: Higher message rates, lower data throughput
- Larger messages: Lower message rates, higher data throughput
- Network and CPU usage varies significantly

## Troubleshooting

### Connection Issues
```bash
# Verify RedPanda brokers are accessible
telnet {redpanda-ip} 9092
```

### Auto-Discovery Issues
```bash
# Manually set brokers if auto-discovery fails
export REDPANDA_BROKERS="10.0.1.100:9092,10.0.2.100:9092,10.0.3.100:9092"
./run.sh
```

### Build Issues
```bash
# Manually build if needed
/usr/local/go/bin/go mod tidy
/usr/local/go/bin/go build -o load-test .
```

## Architecture

- **Producers**: Generate random payloads with timestamps and headers
- **Consumers**: Consume messages in parallel consumer groups  
- **Topics**: Auto-created with configurable partitions and replication
- **Metrics**: Thread-safe atomic counters for accurate measurements
- **Compression**: Configurable compression algorithms for bandwidth testing

## Dependencies

- Go 1.21+
- franz-go v1.15.4+
- AWS CLI (for auto-discovery)
- Access to RedPanda cluster

## Files

- `main.go`: Core load test application
- `go.mod`: Go module dependencies
- `run.sh`: Convenient run script with auto-discovery
- `README.md`: This documentation 