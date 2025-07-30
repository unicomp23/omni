# 1 Consumer Per Partition Architecture Guide

## Overview

This guide explains the implementation of a **1 consumer per partition** architecture for your Redpanda load testing setup, where each consumer is dedicated to processing exactly one partition.

## Architecture Changes Made

### Before
- **18 partitions** shared across **8 consumers**
- Some consumers handled 2-3 partitions each
- Consumer group auto-balancing determined partition assignment

### After  
- **18 partitions** with **18 consumers** (1:1 mapping)
- Each consumer processes exactly one partition
- Predictable, deterministic workload distribution

## Benefits

### 1. **Guaranteed Message Ordering**
- Each partition processed by exactly one consumer
- No race conditions between consumers for same partition
- Maintains Kafka's partition-level ordering guarantees

### 2. **Maximum Parallelism**
- No consumer waits for others to finish processing their partitions
- Each partition can be processed at its own optimal rate
- Better CPU and I/O utilization across consumers

### 3. **Predictable Performance**
- Each consumer has consistent, known workload
- Easier to reason about throughput and latency per partition
- More predictable resource usage patterns

### 4. **Better Latency Isolation**
- One slow partition doesn't block processing of other partitions
- Tail latencies are isolated to specific partitions
- Easier to identify performance bottlenecks

### 5. **No Rebalancing Overhead**
- With explicit partition assignment: zero rebalancing cost
- No coordination delays during consumer group changes
- More stable performance during scaling events

### 6. **Simplified Monitoring**
- Clear 1:1 mapping for metrics and debugging
- Easy to correlate consumer performance with specific partitions
- Better observability for troubleshooting

## Implementation Approaches

### Option 1: Consumer Group Auto-Balancing (Current)
```go
const numConsumers = numPartitions  // 18 consumers for 18 partitions
```

**Pros:**
- Simple configuration change
- Automatic partition reassignment on failures
- Standard Kafka consumer group semantics

**Cons:**
- Still subject to rebalancing delays
- Not guaranteed 1:1 during rebalancing
- Consumer group coordination overhead

### Option 2: Explicit Partition Assignment (Advanced)
```go
// Create consumer for specific partition
kgo.ConsumePartitions(map[string]map[int32]kgo.Offset{
    topicName: {
        partitionID: kgo.NewOffset().AtEnd(),
    },
})
```

**Pros:**
- Guaranteed 1:1 mapping always
- Zero rebalancing overhead
- Lowest possible latency
- Deterministic behavior

**Cons:**
- Manual failure handling required
- More complex deployment and scaling
- No automatic redistribution

## Performance Impact

### Expected Improvements
- **Lower P99+ latencies**: No cross-partition interference
- **Higher stable throughput**: Better parallelism
- **More consistent performance**: Predictable per-consumer load
- **Better tail latency**: Isolated slow partitions

### Resource Usage
- **18 consumers instead of 8**: ~2.25x consumer goroutines
- **Memory**: Moderate increase (18 consumer clients vs 8)
- **CPU**: Better utilization due to improved parallelism
- **Network**: More connections but better throughput distribution

## Load Test Configuration

Your updated configuration:
```go
const (
    numPartitions = 18
    numConsumers = numPartitions  // 1 consumer per partition
    numProducers = 1024           // Still 1,024 producers
    // ~57 producers per partition (1024/18)
    // ~114 messages/sec per partition (57 * 2 msg/s)
)
```

## Monitoring and Metrics

### Key Metrics to Track
1. **Per-Consumer Throughput**: Should be ~114 msg/sec per consumer
2. **Per-Partition Latency**: P50, P90, P99 per partition
3. **Consumer Lag**: Per-partition consumer lag
4. **Resource Usage**: CPU/memory per consumer goroutine

### Debugging Tips
- **Consumer ID = Partition ID**: Easy to correlate issues
- **Log Messages**: Include partition info in all consumer logs
- **Partition Performance**: Identify slow partitions easily

## When to Use This Pattern

### Ideal For:
- **Ordered Processing**: When message order within partitions matters
- **Predictable Performance**: When you need consistent latency/throughput
- **Load Testing**: When you want maximum parallelism for testing
- **High Throughput Systems**: When partition-level parallelism is critical

### Consider Alternatives When:
- **Low Message Volume**: Overhead of many consumers isn't worth it
- **Dynamic Scaling**: Need automatic consumer scaling
- **Resource Constrained**: Limited memory/CPU for many consumers
- **Simple Use Cases**: Basic fan-out pattern is sufficient

## Production Considerations

1. **Resource Planning**: Budget for 18 consumer goroutines + memory
2. **Monitoring**: Set up per-partition metrics and alerting  
3. **Failure Handling**: Implement proper consumer restart logic
4. **Scaling**: Plan for partition count changes
5. **Deployment**: Consider using explicit partition assignment for maximum control

## Testing Your Changes

Run your updated load test to verify:
- ✅ All 18 consumers start successfully
- ✅ Each consumer processes messages from its assigned partition
- ✅ Improved latency distribution (especially P95+)
- ✅ Better throughput consistency
- ✅ Resource usage remains acceptable

The 1 consumer per partition pattern should give you more predictable and potentially better performance for your Redpanda load testing scenarios.