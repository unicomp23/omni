#!/bin/bash

# Redpanda Broker Cluster Status Check Script
# Run this script on any Redpanda broker EC2 instance

echo "🔍 Redpanda Cluster Status Check"
echo "=================================="

# Function to get the broker ID from hostname or container name
get_broker_id() {
    local hostname=$(hostname)
    if [[ $hostname =~ redpanda-broker-([0-9]+) ]]; then
        echo "${BASH_REMATCH[1]}"
    else
        echo "1"  # Default fallback
    fi
}

BROKER_ID=$(get_broker_id)
CONTAINER_NAME="redpanda-broker-${BROKER_ID}"

echo "📋 Basic Information"
echo "-------------------"
echo "Hostname: $(hostname)"
echo "Container: $CONTAINER_NAME"
echo "Private IP: $(curl -s http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null || echo 'Unable to fetch')"
echo "Public IP: $(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'Unable to fetch')"
echo

echo "🐳 Container Status"
echo "------------------"
if docker ps | grep -q "$CONTAINER_NAME"; then
    echo "✅ Container $CONTAINER_NAME is running"
    docker ps | grep "$CONTAINER_NAME" | awk '{print "   Status: " $7 " " $8 " " $9}'
else
    echo "❌ Container $CONTAINER_NAME is not running"
    echo "   Available containers:"
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep redpanda || echo "   No Redpanda containers found"
    exit 1
fi
echo

echo "🏥 Cluster Health"
echo "----------------"
HEALTH_OUTPUT=$(docker exec "$CONTAINER_NAME" rpk cluster health --brokers localhost:9092 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Cluster health check successful"
    echo "$HEALTH_OUTPUT" | sed 's/^/   /'
else
    echo "❌ Cluster health check failed"
    echo "   Trying to connect to cluster..."
fi
echo

echo "🌐 Broker Information"
echo "--------------------"
BROKERS_OUTPUT=$(docker exec "$CONTAINER_NAME" rpk cluster brokers --brokers localhost:9092 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Broker list retrieved successfully"
    echo "$BROKERS_OUTPUT" | sed 's/^/   /'
    
    # Count brokers
    BROKER_COUNT=$(echo "$BROKERS_OUTPUT" | grep -c "ID")
    echo "   Total brokers in cluster: $BROKER_COUNT"
else
    echo "❌ Unable to retrieve broker information"
fi
echo

echo "📊 Cluster Information"
echo "---------------------"
CLUSTER_INFO=$(docker exec "$CONTAINER_NAME" rpk cluster info --brokers localhost:9092 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Cluster info retrieved successfully"
    echo "$CLUSTER_INFO" | sed 's/^/   /'
else
    echo "❌ Unable to retrieve cluster information"
fi
echo

echo "📝 Topics"
echo "--------"
TOPICS_OUTPUT=$(docker exec "$CONTAINER_NAME" rpk topic list --brokers localhost:9092 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Topic list retrieved successfully"
    if [ -n "$TOPICS_OUTPUT" ]; then
        echo "$TOPICS_OUTPUT" | sed 's/^/   /'
    else
        echo "   No topics found"
    fi
else
    echo "❌ Unable to retrieve topic list"
fi
echo

echo "🔗 Network Connectivity"
echo "----------------------"
echo "Checking /etc/hosts for broker hostnames:"
grep redpanda /etc/hosts | sed 's/^/   /' || echo "   No Redpanda entries in /etc/hosts"
echo

echo "Testing inter-broker connectivity:"
for i in {1..3}; do
    if [ $i -ne $BROKER_ID ]; then
        echo -n "   redpanda-broker-$i:33145 (RPC) - "
        timeout 3 bash -c "echo >/dev/tcp/redpanda-broker-$i/33145" 2>/dev/null && echo "✅ Connected" || echo "❌ Failed"
        
        echo -n "   redpanda-broker-$i:9092 (Kafka) - "
        timeout 3 bash -c "echo >/dev/tcp/redpanda-broker-$i/9092" 2>/dev/null && echo "✅ Connected" || echo "❌ Failed"
    fi
done
echo

echo "📈 Admin API Status"
echo "------------------"
ADMIN_STATUS=$(docker exec "$CONTAINER_NAME" curl -s http://localhost:9644/v1/status/ready 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Admin API accessible"
    echo "   Status: $ADMIN_STATUS"
else
    echo "❌ Admin API not accessible"
fi
echo

echo "🔧 Quick Diagnostics"
echo "-------------------"
echo "Container logs (last 10 lines):"
docker logs "$CONTAINER_NAME" --tail 10 2>/dev/null | sed 's/^/   /' || echo "   Unable to retrieve logs"
echo

echo "Resource usage:"
echo "   Memory: $(docker exec "$CONTAINER_NAME" cat /proc/meminfo | grep MemAvailable | awk '{print $2 " " $3}' 2>/dev/null || echo 'Unable to check')"
echo "   Disk: $(df -h / | tail -1 | awk '{print $4 " available"}' 2>/dev/null || echo 'Unable to check')"
echo

echo "📋 Summary"
echo "==========="
# Quick summary
if docker ps | grep -q "$CONTAINER_NAME"; then
    if docker exec "$CONTAINER_NAME" rpk cluster health --brokers localhost:9092 >/dev/null 2>&1; then
        echo "✅ Broker is healthy and cluster is accessible"
    else
        echo "⚠️  Broker is running but cluster may have issues"
    fi
else
    echo "❌ Broker is not running"
fi

echo
echo "💡 Next Steps:"
echo "   - To create a test topic: docker exec $CONTAINER_NAME rpk topic create test-topic --brokers localhost:9092"
echo "   - To check detailed logs: docker logs $CONTAINER_NAME"
echo "   - To monitor metrics: docker exec $CONTAINER_NAME curl -s http://localhost:9644/metrics"
echo "   - To check from load test instance: ssh to load test instance and run cluster check scripts" 