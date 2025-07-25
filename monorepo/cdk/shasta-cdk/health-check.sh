#!/bin/bash

# RedPanda Cluster Health Check Script
# Run this from the load test instance

set -e

echo "🔍 RedPanda Cluster Health Check"
echo "================================="
echo

# Check if environment variables are set
if [ -z "$RPK_BROKERS" ]; then
    echo "❌ RPK_BROKERS not set. Please source redpanda-env.sh first"
    exit 1
fi

echo "📊 Cluster Configuration:"
echo "  Brokers: $RPK_BROKERS"
echo "  Schema Registry: $RPK_SCHEMA_REGISTRY_URL"
echo "  Admin API: $RPK_ADMIN_API_URL"
echo

# Test 1: Basic connectivity
echo "🔗 Test 1: Basic Connectivity"
if rpk cluster info > /dev/null 2>&1; then
    echo "  ✅ Cluster connectivity: OK"
else
    echo "  ❌ Cluster connectivity: FAILED"
    exit 1
fi

# Test 2: Broker health
echo
echo "🖥️  Test 2: Broker Health"
broker_count=$(rpk redpanda admin brokers list --format json 2>/dev/null | jq length 2>/dev/null || echo "0")
if [ "$broker_count" -gt 0 ]; then
    echo "  ✅ Active brokers: $broker_count"
else
    echo "  ❌ No active brokers found"
    exit 1
fi

# Test 3: Topic operations
echo
echo "📝 Test 3: Topic Operations"
test_topic="health-check-$(date +%s)"
if rpk topic create "$test_topic" -p 3 -r 3 > /dev/null 2>&1; then
    echo "  ✅ Topic creation: OK"
    
    # Test producer
    if echo "health check message" | rpk topic produce "$test_topic" > /dev/null 2>&1; then
        echo "  ✅ Message production: OK"
        
        # Test consumer
        if rpk topic consume "$test_topic" --num 1 > /dev/null 2>&1; then
            echo "  ✅ Message consumption: OK"
        else
            echo "  ❌ Message consumption: FAILED"
        fi
    else
        echo "  ❌ Message production: FAILED"
    fi
    
    # Cleanup
    rpk topic delete "$test_topic" > /dev/null 2>&1 || true
else
    echo "  ❌ Topic creation: FAILED"
fi

# Test 4: Schema Registry (if available)
echo
echo "🗃️  Test 4: Schema Registry"
if curl -s "$RPK_SCHEMA_REGISTRY_URL/subjects" > /dev/null 2>&1; then
    echo "  ✅ Schema Registry: OK"
else
    echo "  ⚠️  Schema Registry: Not available or failed"
fi

# Test 5: Admin API
echo
echo "⚙️  Test 5: Admin API"
if curl -s "$RPK_ADMIN_API_URL/v1/cluster/health_overview" > /dev/null 2>&1; then
    echo "  ✅ Admin API: OK"
else
    echo "  ⚠️  Admin API: Not available or failed"
fi

echo
echo "🎉 Health check complete!"
echo
echo "📋 Detailed Cluster Info:"
rpk cluster info

echo
echo "🖥️  Broker Details:"
rpk redpanda admin brokers list

echo
echo "📊 Topics:"
rpk topic list 