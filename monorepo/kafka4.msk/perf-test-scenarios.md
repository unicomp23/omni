# Kafka Latency Performance Test Scenarios

## Quick Tests (< 1 minute)

### Burst Test - Maximum Throughput
```bash
./kafka-latency-test -count 1000 -interval 0s -output burst-test.jsonl
```
**Purpose**: Test maximum message throughput with no artificial delays

### Low Latency Test 
```bash
./kafka-latency-test -count 500 -interval 10ms -output low-latency.jsonl
```
**Purpose**: Measure latency under high-frequency message flow

## Medium Tests (1-5 minutes)

### Sustained Load Test
```bash
./kafka-latency-test -count 5000 -interval 50ms -output sustained-load.jsonl
```
**Purpose**: Test steady-state performance over time

### Variable Load Simulation
```bash
# Run multiple tests back-to-back with different intervals
./kafka-latency-test -count 1000 -interval 100ms -output var-load-1.jsonl
./kafka-latency-test -count 1000 -interval 25ms -output var-load-2.jsonl  
./kafka-latency-test -count 1000 -interval 5ms -output var-load-3.jsonl
```

## Extended Tests (5+ minutes)

### Endurance Test
```bash
./kafka-latency-test -count 20000 -interval 100ms -output endurance-test.jsonl
```
**Purpose**: Long-running test to detect performance degradation

### Stress Test - High Volume
```bash
./kafka-latency-test -count 50000 -interval 10ms -output stress-test.jsonl
```
**Purpose**: Push system limits with high message volume

## Split Testing Scenarios

### Producer Load Testing
```bash
# Terminal 1: Consumer
./kafka-latency-test -consumer-only -output load-test-consumer.jsonl

# Terminal 2: Multiple producers (run sequentially or parallel)
./kafka-latency-test -producer-only -count 10000 -interval 5ms -topic load-test
```

### Consumer Lag Testing
```bash
# Terminal 1: Producer (fast)
./kafka-latency-test -producer-only -count 10000 -interval 1ms

# Terminal 2: Consumer (delayed start)
sleep 30 && ./kafka-latency-test -consumer-only -output lag-test.jsonl
```

## Analysis Commands

### Real-time Monitoring
```bash
# Monitor latency records in real-time
tail -f latency-records.jsonl | jq '.latency_ms'

# Count messages processed
wc -l latency-records.jsonl

# Average latency
cat latency-records.jsonl | jq -r '.latency_ms' | awk '{sum+=$1; count++} END {print "Avg latency:", sum/count, "ms"}'
```

### Quick Analysis
```bash
# Min/Max/Avg latency
cat latency-records.jsonl | jq -r '.latency_ms' | sort -n | awk '
  BEGIN {min=999999; max=0; sum=0; count=0}
  {
    if($1 < min) min=$1
    if($1 > max) max=$1
    sum+=$1; count++
  }
  END {print "Min:", min"ms", "Max:", max"ms", "Avg:", sum/count"ms", "Count:", count}
'

# Latency percentiles
cat latency-records.jsonl | jq -r '.latency_ms' | sort -n > /tmp/latencies.txt
total=$(wc -l < /tmp/latencies.txt)
p50=$(sed -n "$((total/2))p" /tmp/latencies.txt)
p95=$(sed -n "$((total*95/100))p" /tmp/latencies.txt)
p99=$(sed -n "$((total*99/100))p" /tmp/latencies.txt)
echo "P50: ${p50}ms, P95: ${p95}ms, P99: ${p99}ms"
```

## Parameter Reference

| Flag | Description | Example Values |
|------|-------------|----------------|
| `-count` | Number of messages | `100`, `1000`, `50000` |
| `-interval` | Time between messages | `10ms`, `100ms`, `1s`, `0s` |
| `-topic` | Kafka topic name | `latency-test`, `perf-test` |
| `-output` | JSONL output file | `results.jsonl`, `perf-test.jsonl` |
| `-group` | Consumer group | `latency-consumer-group` |
| `-brokers` | Kafka broker address | `localhost:9093` |
| `-producer-only` | Run only producer | No value |
| `-consumer-only` | Run only consumer | No value | 