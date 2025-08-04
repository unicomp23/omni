#!/bin/bash

# Show all available rebalancing options
# Usage: ./show_options.sh

echo "🎯 Redpanda Rebalance Options (Always Rebuilds from Latest Source)"
echo "=================================================================="
echo ""

echo "🚀 COMPLETE SOLUTIONS (Load Test + Rebalancing)"
echo "------------------------------------------------"
echo "   ./run_with_rebalance.sh          # Consumer method (recommended)"
echo "   ./run_with_rebalance.sh consumer # Consumer method (explicit)"
echo "   ./run_with_rebalance.sh partition # Partition method"
echo ""

echo "🔧 INDIVIDUAL COMPONENTS"
echo "------------------------"
echo "   ./run_loadtest_only.sh           # Load test only (no rebalancing)"
echo "   ./run_consumer_rebalancer.sh     # Consumer rebalancer only"
echo "   ./run_partition_rebalancer.sh    # Partition rebalancer only"
echo ""

echo "🧪 TESTING & ANALYSIS"
echo "---------------------"
echo "   ./test_rebalance_timing.sh       # Measure actual rebalance timing"
echo "   ./build_all.sh                   # Build all binaries (no run)"
echo ""

echo "⚙️ ENVIRONMENT VARIABLES"
echo "------------------------"
echo "   REDPANDA_BROKERS=broker1:9092,broker2:9092,broker3:9092"
echo "   REBALANCE_INTERVAL_MINUTES=60    # For partition method"
echo ""

echo "📊 TIMING CHARACTERISTICS"
echo "-------------------------"
echo "   Detection Time:   100ms - 8s    (depends on failure type)"
echo "   Completion Time:  1.7s - 11.5s  (depends on scenario)"
echo "   Rebalance Impact: 2s - 8s       (elevated latency period)"
echo ""

echo "💡 RECOMMENDATIONS"
echo "------------------"
echo "   🥇 Start with:    ./run_with_rebalance.sh"
echo "   🔍 For timing:    ./test_rebalance_timing.sh"
echo "   📈 For analysis:  ./run_loadtest_only.sh + rebalancer separately"
echo ""

echo "📖 For detailed information, see:"
echo "   • REBALANCE_README.md           - Complete guide"
echo "   • REBALANCE_TIMING_ANALYSIS.md  - Timing analysis"