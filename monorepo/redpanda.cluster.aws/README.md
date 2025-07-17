# Kafka Latency Load Test

A high-performance Go-based load test tool using franz-go that measures producer-to-consumer latency in Kafka/Redpanda clusters with multiple concurrent producers and consumer workers.

## Features

- **Multi-producer Architecture**: Configurable number of concurrent producers (default: 10)
- **Multi-consumer Workers**: Configurable number of consumer workers (default: 2)
- **JSONL Output**: Individual latency records written to `latency_records.jsonl`
- **Latency Optimization**: Optimized for low latency over high throughput
- **Iteration-based Testing**: Tests a specific number of messages (default: 100k)
- **Real-time Progress Reporting**: Live progress updates during testing
- **Graceful Shutdown**: Handles SIGINT/SIGTERM for clean termination

## Prerequisites

- Go 1.21 or later
- Access to a Kafka/Redpanda cluster

## Building

```bash
go mod tidy
go build -o kafka-latency-test
```

## Usage

### Basic usage with default settings:
```bash
./kafka-latency-test
```

### With custom configuration:
```bash
export REDPANDA_BROKERS="redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092"
export TOPIC="my-latency-test"
export TOTAL_MESSAGES=50000
export PRODUCER_RATE=1000
export NUM_PRODUCERS=5
export NUM_CONSUMER_WORKERS=1
export MESSAGE_SIZE=2048
./kafka-latency-test
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REDPANDA_BROKERS` | Comma-separated list of broker addresses | `localhost:9092` |
| `TOPIC` | Kafka topic name | `latency-test` |
| `TOTAL_MESSAGES` | Total number of messages to produce | `100000` |
| `PRODUCER_RATE` | Total messages per second across all producers | `2000` |
| `NUM_PRODUCERS` | Number of concurrent producers | `10` |
| `NUM_CONSUMER_WORKERS` | Number of consumer workers | `2` |
| `MESSAGE_SIZE` | Message size in bytes | `1024` |

## Latency Optimization

The tool is optimized for low latency over high throughput with the following settings:

### Producer Settings
- Small batch sizes (1KB)
- Minimal linger time (1ms)
- No compression
- Single in-flight request per broker
- AllISRAcks for consistency

### Consumer Settings
- Small fetch sizes (32KB max, 16KB per partition)
- Minimal wait time (10ms)
- Immediate fetching (1 byte minimum)
- Sequential fetches for predictable latency

## Output

### Console Output
```
=== Progress Report ===
Messages produced: 45000 / 100000
Messages consumed: 44500 / 100000
Elapsed time: 22.5s
Produce rate: 2000.00 msg/s
Consume rate: 1977.78 msg/s
Progress: 44.50%
=====================
```

### JSONL Output
Each latency measurement is written to `latency_records.jsonl`:

```json
{"message_id":1,"producer_id":-1,"consumer_id":0,"produce_time":1735334567123456789,"consume_time":1735334567125789123,"latency_ns":2332334,"latency_ms":2.332334,"topic":"latency-test","partition":0,"offset":123,"timestamp":"2024-12-27T20:36:07.125789123Z"}
{"message_id":2,"producer_id":-1,"consumer_id":1,"produce_time":1735334567123556789,"consume_time":1735334567126123456,"latency_ns":2566667,"latency_ms":2.566667,"topic":"latency-test","partition":1,"offset":89,"timestamp":"2024-12-27T20:36:07.126123456Z"}
```

### JSONL Fields
- `message_id`: Unique message identifier
- `producer_id`: Producer ID (-1 if not tracked)
- `consumer_id`: Consumer worker ID
- `produce_time`: Message production timestamp (nanoseconds)
- `consume_time`: Message consumption timestamp (nanoseconds)
- `latency_ns`: End-to-end latency in nanoseconds
- `latency_ms`: End-to-end latency in milliseconds
- `topic`: Kafka topic name
- `partition`: Partition number
- `offset`: Message offset
- `timestamp`: ISO 8601 timestamp of consumption

## Architecture

### Producers
- Multiple concurrent producers (configurable)
- Each producer maintains its own Kafka client
- Rate limiting distributed across all producers
- Atomic message counting to prevent overproduction

### Consumers
- Multiple consumer workers (configurable)
- Each consumer has its own consumer group
- Concurrent consumption for higher throughput
- Individual latency tracking per consumer

### Synchronization
- Atomic counters for message production/consumption tracking
- Thread-safe JSONL file writing
- Graceful shutdown coordination

## Data Analysis

The JSONL output can be analyzed using various tools:

### Using jq
```bash
# Average latency
jq -r '.latency_ms' latency_records.jsonl | awk '{sum+=$1} END {print "Average:", sum/NR, "ms"}'

# P95 latency
jq -r '.latency_ms' latency_records.jsonl | sort -n | awk '{all[NR] = $0} END{print "P95:", all[int(NR*0.95)]}'

# Messages per consumer
jq -r '.consumer_id' latency_records.jsonl | sort | uniq -c
```

### Using Python
```python
import json
import pandas as pd

# Load JSONL data
with open('latency_records.jsonl', 'r') as f:
    data = [json.loads(line) for line in f]

df = pd.DataFrame(data)
print(f"Average latency: {df['latency_ms'].mean():.2f}ms")
print(f"P95 latency: {df['latency_ms'].quantile(0.95):.2f}ms")
print(f"P99 latency: {df['latency_ms'].quantile(0.99):.2f}ms")
```

## Example Final Report

```
=== Final Report ===
Total messages produced: 100000
Total messages consumed: 100000
Total duration: 50.2s
Average produce rate: 1992.03 msg/s
Average consume rate: 1992.03 msg/s
JSONL records written to: latency_records.jsonl
===================
```

## Performance Considerations

- **Memory Usage**: Each latency record is immediately written to disk to minimize memory usage
- **Disk I/O**: JSONL writing is mutex-protected but may become a bottleneck at very high rates
- **Network**: Latency-optimized settings trade throughput for consistent low latency
- **Scaling**: Add more consumer workers if consumption falls behind production

## Notes

- Each consumer worker uses a separate consumer group for parallel consumption
- The test automatically stops when all messages are consumed
- Press Ctrl+C to stop the test early and see partial results
- The tool is optimized for latency measurement accuracy over maximum throughput
- Message ordering is not guaranteed across multiple producers 