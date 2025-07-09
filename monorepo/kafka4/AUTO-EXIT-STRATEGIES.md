# Auto-Exit Strategies for Kafka Consumers

This document describes the **timer-based coordination** approach for Kafka consumers that ensures predictable, graceful exits without timeouts or hanging processes.

## Overview

The timer-based coordination strategy allows consumers to exit gracefully after a predetermined time period, making it ideal for:
- ✅ **Performance testing** with predictable timing
- ✅ **Automated testing** without manual intervention
- ✅ **Batch processing** with known time windows
- ✅ **Load testing** with consistent behavior

## Implementation

### Go Consumer: `coordinated-consumer.go`

**Key Features:**
- Timer-based exit after calculated duration
- Timeout protection for PollFetches to prevent blocking
- Latency tracking with JSONL output
- Clean shutdown with completion messages

**How it works:**
1. **Timer Setup**: Consumer calculates exit time: `(messages × spacing) + buffer`
2. **Timeout Loop**: Uses 200ms timeout on PollFetches to prevent blocking
3. **Exit Check**: Checks timer on each loop iteration
4. **Graceful Exit**: Completes processing and logs final statistics

### Example Usage

```bash
# Basic coordinated test
./scripts/run-coordinated-test.sh

# Custom configuration: 3 producers, 2 consumers, 10 messages, 500ms spacing
./scripts/run-coordinated-test.sh 3 2 10 500 1000

# Quick test: 1 producer, 1 consumer, 5 messages, 200ms spacing
./scripts/run-coordinated-test.sh 1 1 5 200
```

## Timer-Based Coordination Benefits

### ✅ **Predictable Exit Timing**
- Consumers exit after calculated time period
- No dependency on message count per consumer
- Works with any partition distribution

### ✅ **No Hanging Processes**
- PollFetches uses 200ms timeout to prevent blocking
- Timer check runs regularly in main loop
- Clean shutdown with completion messages

### ✅ **Scalable Design**
- Works with multiple producers and consumers
- No coordination overhead between processes
- Scales with any number of partitions

### ✅ **Testing Reliability**
- Consistent behavior across test runs
- Automated exit without manual intervention
- Generates complete latency data for analysis

## Configuration Options

The coordinated test script supports flexible configuration:

```bash
./scripts/run-coordinated-test.sh [NUM_PRODUCERS] [NUM_CONSUMERS] [MESSAGE_COUNT] [SPACING_MS] [BUFFER_MS]
```

**Parameters:**
- `NUM_PRODUCERS`: Number of producer processes (default: 2)
- `NUM_CONSUMERS`: Number of consumer processes (default: 3)
- `MESSAGE_COUNT`: Messages per producer (default: 4)
- `SPACING_MS`: Milliseconds between messages (default: 800)
- `BUFFER_MS`: Consumer buffer time in ms (default: 2000)

## Test Workflow

### 1. **Setup Phase**
```bash
# Clean and create fresh topics
./scripts/topic-manager.sh fresh
```

### 2. **Execution Phase**
```bash
# Start consumers first (calculate exit time)
# Start producers (emit messages with timing metadata)
# Wait for completion (all processes exit gracefully)
```

### 3. **Analysis Phase**
```bash
# Calculate percentiles
./calculate-percentiles.sh <latency-file>.jsonl

# Compare configurations  
./compare-percentiles.sh file1.jsonl file2.jsonl "Config 1" "Config 2"

# Basic analysis
./analyze-latency-logs.sh <latency-file>.jsonl
```

## Example Test Results

### Test Configuration
- **Producers**: 2
- **Consumers**: 3  
- **Messages**: 10 per producer
- **Spacing**: 200ms
- **Buffer**: 1000ms

### Results
```
📊 Latency Percentiles Analysis
===============================
📈 Total Records: 168

📊 Basic Statistics:
  • Min:        0.518797 ms
  • Max:        108.57873 ms  
  • Average:    23.252443 ms
  • Median:     0.8583 ms

📈 Percentile Distribution:
  • P50:         0.8583 ms
  • P75:      28.108255 ms
  • P90:     108.385102 ms
  • P95:      108.57873 ms
  • P99:      108.57873 ms

🎯 Performance Classification:
🟡 Good: P95 < 500ms
```

## Best Practices

### **1. Buffer Time Selection**
- **Short tests**: Buffer = 1000-2000ms
- **Long tests**: Buffer = 2000-5000ms
- **Rule of thumb**: Buffer ≥ message processing time

### **2. Timeout Configuration**
- **PollFetches timeout**: 200ms (prevents blocking)
- **Sleep on empty**: 100ms (reduces CPU usage)
- **Balance**: Fast exit vs CPU efficiency

### **3. Test Configuration**
- **Start small**: 1-2 producers, 1-2 consumers
- **Scale up**: Increase producers/consumers gradually
- **Monitor**: Check logs for timing accuracy

### **4. Analysis Workflow**
1. **Run test**: `./scripts/run-coordinated-test.sh`
2. **Check completion**: Verify all processes exited cleanly
3. **Calculate percentiles**: Use analysis scripts
4. **Compare configurations**: Test different parameters

## Troubleshooting

### **Consumer Doesn't Exit**
- **Check timeout**: Ensure PollFetches has timeout
- **Verify timer**: Check timer calculation logic
- **Review logs**: Look for blocking operations

### **Incomplete Data**
- **Increase buffer**: Give consumers more time
- **Check timing**: Verify producer emission timing
- **Monitor partitions**: Ensure even distribution

### **Performance Issues**
- **Reduce spacing**: Increase message frequency
- **Optimize consumers**: Check processing efficiency
- **Scale horizontally**: Add more consumers

## Technical Details

### **Timer Calculation**
```go
// Consumer calculates exit time based on producer pattern
waitDuration := time.Duration(waitTimeMs) * time.Millisecond
startTime := time.Now()

// Exit when timer expires
if time.Since(startTime) >= waitDuration {
    // Graceful exit
    break
}
```

### **Timeout Protection**
```go
// Prevent blocking on PollFetches
timeoutCtx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
fetches := client.PollFetches(timeoutCtx)
cancel()
```

### **Latency Tracking**
```go
// Calculate and record latency
latency := receivedAt.Sub(payload.SentAt)
latencyMs := float64(latency.Nanoseconds()) / 1e6

// Output JSONL record
latencyRecord := LatencyRecord{
    MessageID:    payload.ID,
    Producer:     payload.Producer,
    Consumer:     consumerName,
    LatencyMs:    latencyMs,
    // ... other fields
}
```

## Conclusion

The timer-based coordination approach provides:
- **Predictable exit behavior** for automated testing
- **Clean shutdown** without hanging processes  
- **Scalable design** for performance testing
- **Comprehensive latency data** for analysis

This strategy eliminates the common issues with timeout-based approaches and provides a robust foundation for Kafka performance testing and analysis. 