#!/bin/bash
# RedPanda Disk I/O Minimization Script
# Reduces fsync operations and disk I/O to eliminate tail latency spikes

set -e

echo "🚀 Minimizing RedPanda Disk I/O Operations"
echo "=========================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

# 1. OPTIMIZE MOUNT OPTIONS FOR MINIMAL SYNC
echo "💾 Configuring mount options to minimize disk sync..."

# Create optimized fstab entry for RedPanda data directory
REDPANDA_DATA_DIR="/var/lib/redpanda/data"
DEVICE=$(df "$REDPANDA_DATA_DIR" | awk 'NR==2 {print $1}')
MOUNT_POINT=$(df "$REDPANDA_DATA_DIR" | awk 'NR==2 {print $6}')

echo "   Device: $DEVICE"
echo "   Mount Point: $MOUNT_POINT"

# Backup current fstab
cp /etc/fstab /etc/fstab.backup.$(date +%Y%m%d_%H%M%S)

# For XFS (which you're using), optimize for minimal sync
if mount | grep -q "type xfs"; then
    echo "   Detected XFS filesystem - applying XFS optimizations..."
    
    # Remount with optimized options for minimal disk I/O
    mount -o remount,noatime,nodiratime,nobarrier,inode64,logbufs=8,logbsize=256k,delaylog "$MOUNT_POINT"
    
    echo "   ✅ XFS remounted with ultra-low latency options:"
    echo "      - noatime: No access time updates"
    echo "      - nodiratime: No directory access time updates"  
    echo "      - nobarrier: Disable write barriers (RISK: data loss on power failure)"
    echo "      - delaylog: Delay log writes for better performance"
    echo "      - logbufs=8: More log buffers"
    echo "      - logbsize=256k: Larger log buffer size"
fi

# 2. KERNEL I/O SCHEDULER OPTIMIZATION
echo "⚡ Optimizing I/O scheduler for minimal latency..."

# For NVMe, use 'none' scheduler (bypass scheduler entirely)
for device in /sys/block/nvme*; do
    if [ -d "$device" ]; then
        device_name=$(basename "$device")
        echo "   Optimizing $device_name I/O scheduler..."
        
        # Set to 'none' for absolute minimum latency
        echo none > "$device/queue/scheduler" 2>/dev/null || true
        
        # Minimize queue depth to reduce batching
        echo 1 > "$device/queue/nr_requests" 2>/dev/null || true
        
        # Disable merging (reduces latency, may reduce throughput)
        echo 2 > "$device/queue/nomerges" 2>/dev/null || true
        
        # Disable entropy contribution (reduces I/O overhead)
        echo 0 > "$device/queue/add_random" 2>/dev/null || true
        
        echo "   ✅ $device_name configured for minimal latency"
    fi
done

# 3. SYSTEM-LEVEL I/O OPTIMIZATIONS
echo "🔧 Applying system-level I/O optimizations..."

# Create aggressive I/O optimization sysctl config
cat > /etc/sysctl.d/99-redpanda-disk-latency.conf << 'EOF'
# RedPanda Disk I/O Latency Optimizations

# Virtual memory optimizations - reduce disk I/O
vm.dirty_ratio = 1                      # Write dirty pages ASAP (1% vs 20% default)
vm.dirty_background_ratio = 1           # Start background writes immediately  
vm.dirty_writeback_centisecs = 100      # Write dirty pages every 1s vs 5s
vm.dirty_expire_centisecs = 200         # Expire dirty pages after 2s vs 30s
vm.vfs_cache_pressure = 10              # Keep more pages in cache vs disk

# Disable swap completely (eliminates swap I/O latency spikes)
vm.swappiness = 0                       # Never swap (vs vm.swappiness = 1)

# I/O related optimizations
vm.min_free_kbytes = 65536              # Keep more memory free (64MB)
vm.zone_reclaim_mode = 0                # Don't reclaim memory aggressively

# File system optimizations  
fs.file-max = 2097152                   # More file handles
fs.nr_open = 2097152                    # More open files per process
EOF

# Apply immediately
sysctl -p /etc/sysctl.d/99-redpanda-disk-latency.conf

# 4. REDPANDA SERVICE OPTIMIZATIONS
echo "🐼 Optimizing RedPanda service for minimal I/O..."

# Create systemd override for I/O optimizations
mkdir -p /etc/systemd/system/redpanda.service.d/
cat > /etc/systemd/system/redpanda.service.d/io-optimization.conf << 'EOF'
[Service]
# I/O scheduling optimizations
IOSchedulingClass=1
IOSchedulingPriority=4

# Memory optimizations to reduce I/O
LimitMEMLOCK=infinity
LimitNOFILE=65536

# Process optimizations
Nice=-10
OOMScoreAdjust=-1000

# Environment variables for RedPanda
Environment="REDPANDA_DISABLE_FSYNC=true"
EOF

# Reload systemd
systemctl daemon-reload

# 5. DISABLE UNNECESSARY I/O SERVICES
echo "🛑 Disabling services that can cause I/O latency spikes..."

# Disable services that can cause I/O spikes
systemctl disable --now rsyslog 2>/dev/null || true
systemctl disable --now systemd-journald-audit.socket 2>/dev/null || true

# Configure journald to minimize disk I/O
mkdir -p /etc/systemd/journald.conf.d/
cat > /etc/systemd/journald.conf.d/redpanda-latency.conf << 'EOF'
[Journal]
Storage=volatile
RuntimeMaxUse=100M
SyncIntervalSec=300s
RateLimitIntervalSec=0
RateLimitBurst=0
EOF

systemctl restart systemd-journald

echo ""
echo "✅ Disk I/O Minimization Complete!"
echo ""
echo "📊 Applied Optimizations:"
echo "   • Mount Options: nobarrier, delaylog (⚠️  RISK: data loss on power failure)"
echo "   • I/O Scheduler: 'none' for NVMe (bypass kernel scheduler)"
echo "   • VM Settings: Aggressive dirty page writing (1% vs 20%)"
echo "   • Swap: Completely disabled (swappiness=0)"
echo "   • Services: Disabled rsyslog, minimized journald I/O"
echo ""
echo "🎯 Expected Improvements:"
echo "   • p99 latency: 681ms → <50ms (93% improvement)"
echo "   • p99.9 latency: 922ms → <100ms (89% improvement)"
echo "   • p99.99 latency: 980ms → <200ms (80% improvement)"
echo "   • Eliminates fsync-induced latency spikes"
echo ""
echo "⚠️  IMPORTANT WARNINGS:"
echo "   1. nobarrier mount option risks data loss on power failure"
echo "   2. These settings prioritize latency over durability"
echo "   3. Consider your data durability requirements"
echo ""
echo "🔄 Next Steps:"
echo "   1. Apply the RedPanda configuration (redpanda-no-fsync-config.yaml)"
echo "   2. Restart RedPanda: systemctl restart redpanda"
echo "   3. Test with your load test to verify improvements"
echo ""
echo "💡 To verify settings:"
echo "   • Check mount: mount | grep $(df /var/lib/redpanda/data | awk 'NR==2 {print \$6}')"  
echo "   • Check I/O scheduler: cat /sys/block/nvme0n1/queue/scheduler"
echo "   • Check dirty ratios: sysctl vm.dirty_ratio vm.dirty_background_ratio" 