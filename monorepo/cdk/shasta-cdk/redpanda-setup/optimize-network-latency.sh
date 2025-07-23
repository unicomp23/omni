#!/bin/bash

# Ultra-Low Latency Network Optimizations for RedPanda
# This script optimizes Linux kernel network settings for minimal latency

set -e

echo "🚀 Applying Ultra-Low Latency Network Optimizations"
echo "=================================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

echo "📡 Configuring kernel network parameters..."

# Create optimized sysctl configuration
cat > /etc/sysctl.d/99-redpanda-latency.conf << 'EOF'
# Ultra-Low Latency Network Optimizations for RedPanda

# TCP/IP Stack Optimizations
net.core.rmem_default = 262144
net.core.rmem_max = 134217728
net.core.wmem_default = 262144
net.core.wmem_max = 134217728
net.core.netdev_max_backlog = 5000
net.core.netdev_budget = 600
net.core.netdev_budget_usecs = 5000

# TCP Buffer Sizes (min, default, max)
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728

# TCP Congestion Control
net.ipv4.tcp_congestion_control = bbr
net.core.default_qdisc = fq

# Reduce TCP latency
net.ipv4.tcp_low_latency = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_fack = 1
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_no_delay_ack = 1

# Reduce context switching
net.core.busy_read = 50
net.core.busy_poll = 50

# Memory management
vm.swappiness = 1
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5

# CPU scheduling
kernel.sched_min_granularity_ns = 1000000
kernel.sched_wakeup_granularity_ns = 2000000
kernel.sched_migration_cost_ns = 5000000

# IRQ affinity and CPU isolation (if applicable)
# Note: Adjust based on your instance type
kernel.watchdog = 0

EOF

echo "✅ Kernel parameters configured"

# Apply the settings immediately
echo "🔄 Applying settings..."
sysctl -p /etc/sysctl.d/99-redpanda-latency.conf

# Optimize network interface settings
echo "🔧 Optimizing network interface settings..."
for interface in $(ls /sys/class/net/ | grep -E '^(eth|ens|enp)'); do
    if [ -d "/sys/class/net/$interface" ]; then
        echo "   Optimizing interface: $interface"
        
        # Enable hardware features if available
        ethtool -K $interface gso off 2>/dev/null || true
        ethtool -K $interface tso off 2>/dev/null || true
        ethtool -K $interface ufo off 2>/dev/null || true
        ethtool -K $interface gro off 2>/dev/null || true
        ethtool -K $interface lro off 2>/dev/null || true
        
        # Set interrupt coalescing for low latency
        ethtool -C $interface adaptive-rx off adaptive-tx off 2>/dev/null || true
        ethtool -C $interface rx-usecs 0 rx-frames 1 2>/dev/null || true
        ethtool -C $interface tx-usecs 0 tx-frames 1 2>/dev/null || true
        
        # Set ring buffer sizes
        ethtool -G $interface rx 4096 tx 4096 2>/dev/null || true
    fi
done

# Configure CPU governor for performance
echo "⚡ Setting CPU governor to performance mode..."
echo performance | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor >/dev/null 2>&1 || true

# Disable power management features that can cause latency
echo "🔋 Disabling power management features..."
echo 1 > /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null || true
echo 0 > /proc/sys/kernel/numa_balancing 2>/dev/null || true

# Configure IRQ affinity
echo "📡 Configuring IRQ affinity..."
# Pin network IRQs to specific CPUs (adjust based on your needs)
for irq in $(grep -E "(eth|ens|enp)" /proc/interrupts | cut -d: -f1 | tr -d ' '); do
    echo 2 > /proc/irq/$irq/smp_affinity 2>/dev/null || true
done

echo ""
echo "✅ Ultra-Low Latency Optimizations Applied Successfully!"
echo ""
echo "📊 Current Network Settings:"
echo "   TCP Congestion Control: $(sysctl -n net.ipv4.tcp_congestion_control)"
echo "   Default Queue Discipline: $(sysctl -n net.core.default_qdisc)"
echo "   CPU Governor: $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo 'N/A')"
echo ""
echo "⚠️  Note: Some settings require a reboot to take full effect"
echo "💡 Recommendation: Reboot the instance for optimal performance"
echo ""
echo "🎯 Expected improvements:"
echo "   • Reduced network stack latency"
echo "   • Better CPU cache utilization"
echo "   • Minimized context switching"
echo "   • Optimized interrupt handling" 