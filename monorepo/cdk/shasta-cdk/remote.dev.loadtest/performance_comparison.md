# Performance Comparison: 8 vs 18 Consumers

## Configuration Comparison

| Metric | Before (8 consumers) | After (18 consumers) | Change |
|--------|---------------------|---------------------|---------|
| **Partitions** | 18 | 18 | Same |
| **Consumers** | 8 | 18 | +125% |
| **Partitions per Consumer** | 2-3 (uneven) | 1 (exact) | More balanced |
| **Consumer Goroutines** | 8 | 18 | +10 goroutines |
| **Expected Memory** | ~8MB | ~18MB | +10MB |

## Expected Performance Improvements

### Throughput Distribution
```
Before: 8 consumers sharing 18 partitions
├── Consumer 0: Partitions 0,1,2     (~171 msg/s)
├── Consumer 1: Partitions 3,4,5     (~171 msg/s)  
├── Consumer 2: Partitions 6,7,8     (~171 msg/s)
├── Consumer 3: Partitions 9,10,11   (~171 msg/s)
├── Consumer 4: Partitions 12,13,14  (~171 msg/s)
├── Consumer 5: Partitions 15,16,17  (~171 msg/s)
├── Consumer 6: Partitions 0,1       (~114 msg/s) [uneven]
└── Consumer 7: Partition 2           (~57 msg/s)  [uneven]

After: 18 consumers, 1 partition each
├── Consumer 0: Partition 0    (~114 msg/s)
├── Consumer 1: Partition 1    (~114 msg/s)
├── Consumer 2: Partition 2    (~114 msg/s)
├── ...
└── Consumer 17: Partition 17  (~114 msg/s)
```

### Latency Improvements
- **P50**: Similar or slightly better
- **P90**: 10-20% improvement (less queuing)
- **P95**: 15-25% improvement (no cross-partition blocking)
- **P99**: 20-30% improvement (better isolation)
- **P99.9+**: 30-50% improvement (tail latency isolation)

### Resource Usage
```
Memory per consumer: ~1MB
CPU per consumer: ~2% per core
Network connections: +10 (18 vs 8)

Total overhead: ~10MB RAM, minimal CPU impact
```

## Load Distribution Analysis

### Message Flow (1,024 producers → 18 partitions)
```
1,024 producers ÷ 18 partitions = ~57 producers per partition
57 producers × 2 msg/s = ~114 messages/sec per partition
18 partitions × 114 msg/s = ~2,048 total messages/sec
```

### Consumer Workload
Each consumer now processes:
- **~114 messages/sec** (vs 171-256 with uneven distribution)
- **Consistent workload** across all consumers
- **No partition interference** within same consumer

## Monitoring Recommendations

### Key Metrics to Track
1. **Per-Consumer Metrics**:
   ```
   consumer_messages_per_second{consumer_id="0",partition="0"}
   consumer_latency_p99{consumer_id="0",partition="0"} 
   consumer_lag{consumer_id="0",partition="0"}
   ```

2. **Partition Balance**:
   ```bash
   # Should be ~114 msg/s for each partition
   rpk topic consume loadtest-topic --print-partition-stats
   ```

3. **Resource Usage**:
   ```bash
   # Monitor goroutine count (should be ~34 total: 16 producers + 18 consumers)
   curl http://localhost:6060/debug/pprof/goroutine?debug=2
   ```

## Expected Test Results

### Latency Distribution
```
Before (8 consumers):
P50:  ~15ms     P90:  ~45ms     P95:  ~65ms
P99:  ~120ms    P99.9: ~300ms   P99.99: ~800ms

After (18 consumers):  
P50:  ~12ms     P90:  ~35ms     P95:  ~50ms
P99:  ~85ms     P99.9: ~200ms   P99.99: ~400ms
```

### Throughput Consistency
- **Before**: Variable (some consumers overloaded)
- **After**: Consistent 114 msg/s per consumer
- **Overall**: Same ~2,048 msg/s total, better distributed

## Trade-offs Summary

### Pros ✅
- Better latency isolation (P95+ improvements)
- More predictable performance 
- Easier debugging (1:1 consumer:partition mapping)
- Maximum parallelism for load testing
- Better resource utilization

### Cons ⚠️
- Slightly higher memory usage (+10MB)
- More goroutines (+10)
- More network connections (+10)
- Slightly more complex monitoring

**Verdict**: The benefits significantly outweigh the minimal costs for a load testing scenario focused on measuring latency and throughput characteristics.