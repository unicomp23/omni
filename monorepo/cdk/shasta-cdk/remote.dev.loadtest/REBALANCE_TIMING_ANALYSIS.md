# Redpanda Rebalance Timing Analysis

Based on your current configuration, here are the timing characteristics for rebalance detection and completion.

## ⏱️ **Current Configuration Summary**

### **Redpanda Broker Settings** (`redpanda-latency-config.yaml`)
```yaml
group_initial_rebalance_delay: 100ms     # vs 3s default - 97% faster
group_new_member_join_timeout: 5s        # vs 30s default - faster joins  
group_min_session_timeout_ms: 1000       # vs 6000ms default
group_max_session_timeout_ms: 30000      # vs 300000ms default
```

### **Consumer Settings** (`main.go`)
```go
SessionTimeout(6 * time.Second)           # Ultra-aggressive detection
HeartbeatInterval(2 * time.Second)        # 1/3 of session timeout
RebalanceTimeout(15 * time.Second)        # Total rebalance time limit
MetadataMaxAge(30 * time.Second)          # Metadata refresh frequency
```

---

## 🔍 **Phase 1: Rebalance Detection Time**

### **Consumer Departure Detection**
| Scenario | Detection Time | Configuration |
|----------|----------------|---------------|
| **Graceful shutdown** | `~100ms` | `group_initial_rebalance_delay` |
| **Network failure** | `6-8 seconds` | `SessionTimeout + HeartbeatInterval` |
| **Process crash** | `6-8 seconds` | `SessionTimeout + HeartbeatInterval` |

### **Consumer Arrival Detection**  
| Scenario | Detection Time | Configuration |
|----------|----------------|---------------|
| **New consumer joins** | `100ms - 5s` | `group_initial_rebalance_delay` to `group_new_member_join_timeout` |
| **Consumer reconnect** | `100ms - 2s` | Depends on metadata refresh timing |

---

## ⚡ **Phase 2: Rebalance Completion Time**

### **Your Optimized Setup**
```
Total Rebalance Time: 2-8 seconds (typical)
├── Detection Phase:     0.1-6s  (depends on failure type)
├── Coordination Phase:  0.5-1s   (group coordination)
├── Partition Assignment: 0.1-0.5s (18 partitions, 18 consumers)
└── Consumer Startup:    1-2s     (consumer initialization)
```

### **Breakdown by Consumer Count**
| Consumers | Assignment Time | Total Rebalance | Notes |
|-----------|----------------|-----------------|-------|
| **18 (your setup)** | `0.1-0.5s` | `2-8s` | 1:1 consumer-to-partition ratio |
| **36** | `0.2-1s` | `3-10s` | Some consumers get multiple partitions |
| **100+** | `1-3s` | `5-15s` | Complex assignment calculations |

---

## 📊 **Timing Scenarios**

### **🟢 Best Case (Graceful Consumer Restart)**
```
├── Detection:           100ms    (group_initial_rebalance_delay)
├── Group Coordination:  500ms    (fast with 18 consumers)
├── Partition Assignment: 100ms    (simple 1:1 mapping)
├── Consumer Recovery:   1000ms   (consumer startup)
└── Total:              ~1.7s
```

### **🟡 Typical Case (Consumer Network Hiccup)**
```
├── Detection:           6000ms   (session timeout expiry)
├── Group Coordination:  800ms    (standard coordination)
├── Partition Assignment: 200ms    (assignment calculation)
├── Consumer Recovery:   1500ms   (consumer restart)
└── Total:              ~8.5s
```

### **🔴 Worst Case (Multiple Consumer Failures)**
```
├── Detection:           6000ms   (session timeout)
├── Group Coordination:  2000ms   (multiple rounds)
├── Partition Assignment: 500ms    (complex reassignment)
├── Consumer Recovery:   3000ms   (staggered recovery)
└── Total:              ~11.5s
```

---

## 🎯 **Your Rebalance Triggers**

### **Consumer-Based Trigger** (`rebalance_consumer`)
```
Detection Time:  100ms - 2s     (immediate group change detection)
Completion Time: 1.5s - 4s      (fast, predictable)
Total Impact:    ~2-6s          (minimal disruption)
```

### **Partition-Based Trigger** (`rebalance_partition`)  
```
Detection Time:  5s - 30s       (metadata refresh cycles)
Completion Time: 3s - 10s       (depends on partition movement)
Total Impact:    ~8-40s         (higher impact but more thorough)
```

---

## 🔧 **Tuning for Different Requirements**

### **🚀 Ultra-Fast Rebalancing (< 2s total)**
```go
// Even more aggressive settings
kgo.SessionTimeout(3 * time.Second)
kgo.HeartbeatInterval(1 * time.Second)  
kgo.RebalanceTimeout(5 * time.Second)
```

```yaml
# Redpanda config
group_initial_rebalance_delay: 50ms
group_new_member_join_timeout: 2s
```

### **🛡️ Stable Rebalancing (5-10s total)**
```go
// More conservative for stability
kgo.SessionTimeout(10 * time.Second)
kgo.HeartbeatInterval(3 * time.Second)
kgo.RebalanceTimeout(30 * time.Second)
```

### **📊 Production Balanced (current)**
Your current settings strike a good balance between speed and stability.

---

## 🧪 **Measuring Actual Times**

### **Enable Rebalance Logging**
Your load test already captures latency spikes during rebalancing. Look for:

```
📊 Consumer X: Processed 10000 events (latency spike indicates rebalance)
🔄 Rebalance triggered successfully
```

### **Expected Latency Pattern**
```
Normal latency:     1-5ms
During rebalance:   50-500ms  (brief spike)
Recovery time:      2-8s      (return to normal)
```

### **Monitoring Commands**
```bash
# Watch consumer group rebalancing in real-time
# (if you have Kafka tools available)
kafka-consumer-groups.sh --bootstrap-server broker:9092 --describe --group loadtest-group

# Monitor partition assignments
kafka-topics.sh --bootstrap-server broker:9092 --describe --topic loadtest-topic
```

---

## 📈 **Performance Impact During Rebalance**

### **Expected Behavior**
- **Message Loss**: None (Kafka guarantees)
- **Latency Spike**: 50-500ms for 2-8 seconds
- **Throughput Drop**: 10-30% during rebalance period
- **Recovery**: Full performance within 1-2 seconds post-rebalance

### **Your Load Test Will Show**
- Clear latency spikes in P99/P99.9 metrics
- Brief throughput reduction every hour
- Quick recovery to baseline performance

This gives you excellent data for studying rebalance behavior under load!