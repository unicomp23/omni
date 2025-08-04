# Redpanda Rebalance Trigger Guide

This guide explains how to cause rebalances in your Redpanda cluster once per hour (or any custom interval).

## 🎯 **Available Solutions**

### **Option 1: Consumer Restart Approach (Recommended)**
- **File**: `rebalance_trigger.go`
- **Method**: Creates temporary consumers that join/leave the consumer group
- **Safety**: High - minimal impact on existing consumers
- **Predictability**: High - consistent rebalance timing

### **Option 2: Partition Reassignment Approach**
- **File**: `cmd/partition-rebalancer/main.go` 
- **Method**: Uses Kafka admin API to reassign partitions
- **Safety**: Medium - affects data placement
- **Impact**: Higher - causes actual data movement

## 🚀 **Quick Start** (All scripts rebuild from latest source automatically)

### Method 1: Complete Load Test with Rebalancing (Recommended)
```bash
# Run load test with automatic hourly rebalancing
./run_with_rebalance.sh                    # Uses consumer method (default)
./run_with_rebalance.sh consumer           # Consumer-based rebalancing  
./run_with_rebalance.sh partition          # Partition-based rebalancing
```

### Method 2: Separate Components
```bash
# Terminal 1: Load test only
./run_loadtest_only.sh

# Terminal 2: Choose your rebalancer
./run_consumer_rebalancer.sh               # Consumer-based (recommended)
./run_partition_rebalancer.sh              # Partition-based
```

### Method 3: Build Everything First
```bash
# Build all binaries from latest source
./build_all.sh

# Then run individual components
./loadtest &                               # Load test in background
./rebalance_consumer                       # Consumer rebalancer
```

### Method 4: Quick Timing Test
```bash
# Test actual rebalance timing in your cluster
./test_rebalance_timing.sh
```

## ⚙️ **Configuration Options**

### Environment Variables
```bash
# Set custom broker list
export REDPANDA_BROKERS="broker1:9092,broker2:9092,broker3:9092"

# Set rebalance interval (for partition rebalancer)
export REBALANCE_INTERVAL_MINUTES=60  # Default: 60 minutes
```

### Code Configuration
Edit the constants in the respective `.go` files:

**rebalance_trigger.go**:
```go
const (
    rebalanceInterval = 1 * time.Hour        // Change this
    consumerLifetime  = 30 * time.Second     // How long temp consumer stays
)
```

**partition_rebalancer.go**:
```go
// Set via REBALANCE_INTERVAL_MINUTES env var or modify default
interval := 1 * time.Hour
```

## 📊 **How It Works**

### Consumer Restart Approach
1. Every hour, creates a temporary consumer with a unique group ID
2. Consumer joins the main consumer group (`loadtest-group-rebalance-trigger`)
3. Stays alive for 30 seconds (configurable)
4. Exits, causing the consumer group to rebalance
5. Main consumers redistribute partitions

### Partition Reassignment Approach  
1. Every hour, queries current partition assignments
2. Rotates replica assignments (moves first replica to end)
3. Triggers Kafka partition reassignment via admin API
4. Monitors reassignment progress
5. Causes consumer group rebalancing as partitions move

## 🔍 **Monitoring**

Both approaches provide detailed logging:

```bash
🔄 Rebalance trigger started - will trigger rebalance every 1h0m0s
🔄 Triggering initial rebalance...
🔄 Creating temporary consumer to trigger rebalance...
🔄 Temporary consumer joining group (will stay for 30s)...
🔄 Temporary consumer leaving group to trigger rebalance...
✅ Rebalance triggered successfully
```

## 🧪 **Testing**

### Verify Rebalancing is Working
1. Start your main load test
2. Start the rebalance trigger
3. Watch the logs for consumer group rebalancing events
4. Check consumer lag and partition assignments

### Quick Test (1-minute intervals)
```bash
# Edit rebalance_trigger.go temporarily:
const rebalanceInterval = 1 * time.Minute

# Run and observe frequent rebalances
go run rebalance_trigger.go
```

## 🛡️ **Safety Considerations**

### Consumer Restart Approach (Recommended)
- ✅ Safe for production
- ✅ Minimal performance impact  
- ✅ No data movement
- ✅ Predictable timing

### Partition Reassignment Approach (Use with caution)
- ⚠️ Causes actual data movement
- ⚠️ May impact performance during reassignment
- ⚠️ More complex error handling needed
- ✅ Tests cluster rebalancing under load

## 🎛️ **Custom Intervals**

Want different intervals? Modify the constants:

```go
// Every 30 minutes
const rebalanceInterval = 30 * time.Minute

// Every 2 hours  
const rebalanceInterval = 2 * time.Hour

// Every 15 minutes (for testing)
const rebalanceInterval = 15 * time.Minute
```

## 🔧 **Script Features**

All scripts include these development-friendly features:

- **🔄 Always Fresh**: Rebuilds from latest source before running
- **🧹 Clean Builds**: Removes old binaries to prevent confusion  
- **📝 Verbose Output**: Shows exactly what's being built with `-v` flag
- **🛡️ Safe Cleanup**: Proper shutdown handling for background processes
- **⚙️ Environment Aware**: Respects `REDPANDA_BROKERS` and other env vars

## 🔧 **Integration with Existing Load Test**

The rebalance triggers are designed to work alongside your existing load test without interference:

- Uses separate consumer group IDs
- Minimal resource usage
- Proper cleanup on shutdown
- Respects existing broker configurations
- Always builds from latest source changes

## 📈 **Performance Impact**

### Expected Impact
- **Consumer Restart**: ~1-2 second rebalance period
- **Partition Reassignment**: 30 seconds to 5 minutes depending on data size

### Monitoring During Rebalance
Your existing latency monitoring will capture rebalance-induced latency spikes, which is perfect for studying rebalance behavior.

## 📦 **Available Scripts**

| Script | Purpose | Rebuilds | Use Case |
|--------|---------|----------|----------|
| `run_with_rebalance.sh` | Complete solution | ✅ | Production testing |
| `run_loadtest_only.sh` | Load test without rebalancing | ✅ | Baseline measurements |
| `run_consumer_rebalancer.sh` | Consumer-based rebalancer only | ✅ | Standalone rebalancing |
| `run_partition_rebalancer.sh` | Partition-based rebalancer only | ✅ | Advanced rebalancing |
| `test_rebalance_timing.sh` | Timing measurement | ✅ | Performance analysis |
| `build_all.sh` | Build all binaries | ✅ | Prepare for manual runs |

---

Choose **Consumer-based approach** (`./run_with_rebalance.sh` or `./run_consumer_rebalancer.sh`) for most use cases. It's safe, predictable, and has minimal impact while providing the rebalancing behavior you need for testing.