# Advanced RedPanda Latency Optimizations

## Phase 3: Advanced Optimizations for <10ms p99

### 1. **Partition Strategy Optimization**
```bash
# Current: 6 partitions, 3 brokers
# Optimal: Match partition count to consumer count for 1:1 mapping
# Best practice: 2x brokers = 6 partitions (already optimal)

# For higher throughput, consider:
rpk topic create high-throughput-topic -p 12 -r 3  # 2x current partitions
```

### 2. **Producer Configuration Tuning**
```go
// In your load test client, add these producer settings:
client, err := kgo.NewClient(
    // Current settings...
    
    // Additional ultra-low latency settings:
    kgo.RequestTimeoutOverhead(100*time.Millisecond),  // vs 1s current
    kgo.ProduceRequestTimeout(50*time.Millisecond),    // vs 100ms current
    kgo.ConnIdleTimeout(60*time.Second),               // vs 30s current
    kgo.RequestRetries(0),                             // Fail fast, no retries
    
    // Connection pooling for consistent latency
    kgo.WithHooks(&kgo.Hooks{
        OnConnect: func(meta kgo.BrokerMetadata, conn net.Conn) {
            // Set TCP_NODELAY at connection level
            if tcpConn, ok := conn.(*net.TCPConn); ok {
                tcpConn.SetNoDelay(true)
            }
        },
    }),
)
```

### 3. **Consumer Group Optimization**
```bash
# Current consumer settings are good, but for extreme latency:
rpk group describe load-test-group
rpk group seek load-test-group --to end  # Skip to latest

# Configure consumer session timeouts
--session-timeout 3s          # vs 10s default
--heartbeat-interval 1s       # vs 3s default
```

### 4. **Storage Mount Optimizations**
```bash
# Add to /etc/fstab for RedPanda data directory:
/dev/nvme0n1p1 /var/lib/redpanda/data xfs rw,noatime,nodiratime,nobarrier,inode64,logbufs=8,logbsize=256k,sunit=1024,swidth=1024 0 0

# Remount with optimized options:
sudo mount -o remount,nobarrier,nodiratime /var/lib/redpanda/data
```

### 5. **Kernel Bypass Considerations (Future)**
For sub-millisecond p99.99 requirements:

```bash
# DPDK setup (advanced users only)
# 1. Install DPDK
wget https://fast.dpdk.org/rel/dpdk-23.11.tar.xz
tar xf dpdk-23.11.tar.xz
cd dpdk-23.11
meson build
ninja -C build
sudo ninja -C build install

# 2. Configure hugepages
echo 2048 | sudo tee /proc/sys/vm/nr_hugepages
sudo mount -t hugetlbfs hugetlbfs /mnt/huge

# 3. Bind network interface to DPDK
sudo modprobe uio_pci_generic
sudo ./usertools/dpdk-devbind.py --bind=uio_pci_generic eth0
```

## Monitoring and Verification

### Real-time Latency Monitoring
```bash
# Monitor RedPanda metrics
rpk cluster health --watch

# System-level monitoring
sudo perf record -g -- your-load-test
sudo perf report

# Network latency monitoring
ss -i  # Check retransmissions
sar -n DEV 1  # Network utilization
```

### Load Test Verification Script
```bash
#!/bin/bash
# verify-optimizations.sh
echo "Running verification load test..."

# Before optimization
echo "Baseline test..."
./load-test -duration=30s -producers=2 -consumers=3 > baseline.log

# After optimization  
echo "Optimized test..."
./load-test -duration=30s -producers=2 -consumers=3 > optimized.log

# Compare results
echo "=== RESULTS COMPARISON ==="
echo "Baseline p99: $(grep 'p99:' baseline.log)"
echo "Optimized p99: $(grep 'p99:' optimized.log)"
```

## Extreme Optimization Checklist

- [ ] **RedPanda Config**: Applied latency-optimized configuration
- [ ] **System Tuning**: Kernel parameters, CPU governor, memory settings
- [ ] **Network Stack**: BBR, aggressive TCP settings, interface tuning
- [ ] **I/O Optimization**: NVMe scheduler, mount options, write barriers
- [ ] **Process Priority**: RT scheduling, memory locking, CPU affinity
- [ ] **Memory Management**: Hugepages, THP disabled, swapping minimized
- [ ] **Interrupt Handling**: IRQ affinity, NAPI tuning, CPU isolation

## Expected Results After All Optimizations

| Metric | Current | Target | Methods |
|--------|---------|--------|---------|
| **p50** | 2.1ms | <1ms | RedPanda config + system tuning |
| **p90** | 3.5ms | <2ms | Network optimization + CPU tuning |
| **p95** | 3.8ms | <5ms | Memory management + I/O optimization |
| **p99** | 500ms | <10ms | All optimizations combined |
| **p99.9** | 800ms | <25ms | Process priority + interrupt handling |
| **p99.99** | 900ms | <100ms | Kernel bypass considerations |

## Troubleshooting High Latency

### Common Causes of Tail Latency Spikes:
1. **GC Pauses**: Monitor RedPanda memory usage
2. **Network Buffer Exhaustion**: Check `netstat -s`
3. **Context Switching**: Monitor with `vmstat 1`
4. **I/O Wait**: Check with `iotop -o`
5. **CPU Throttling**: Verify governor is 'performance'
6. **Memory Pressure**: Check `free -h` and swap usage

### Debug Commands:
```bash
# Check for latency culprits
sudo trace-cmd record -p function_graph -g rpk &
# Run load test
sudo trace-cmd report

# Monitor system calls
sudo strace -c -p $(pgrep redpanda)

# Check network drops
cat /proc/net/dev | grep -E "(drop|err)"
```

This completes the comprehensive latency optimization strategy targeting <10ms p99 latency. 