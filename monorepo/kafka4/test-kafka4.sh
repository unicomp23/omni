#!/bin/bash

echo "=== Kafka4 Broker Testing Guide ==="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo_test() {
    echo -e "${BLUE}🧪 Testing: $1${NC}"
}

echo_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

echo_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

echo_error() {
    echo -e "${RED}❌ $1${NC}"
}

echo "=== 1. Container Status Check ==="
echo_test "Kafka4 container status"
if docker ps | grep -q kafka4; then
    echo_success "kafka4 container is running"
    docker ps | grep kafka4
else
    echo_error "kafka4 container is not running"
    exit 1
fi
echo

echo "=== 2. Network Information ==="
echo_test "Getting kafka4 network details"
KAFKA_IP=$(docker inspect kafka4 | grep -A1 '"kafka4_kafka-network"' | grep '"IPAddress"' | cut -d'"' -f4)
echo "Kafka4 Container IP: $KAFKA_IP"
echo "Port Mapping: 9093 (host) -> 9092 (container)"
echo

echo "=== 3. Basic Connectivity Tests ==="
echo_test "Port connectivity tests"

echo "Testing host port 9093:"
if nc -z localhost 9093 2>/dev/null; then
    echo_success "Port 9093 is reachable on localhost"
else
    echo_warning "Port 9093 is not reachable on localhost"
fi

echo "Testing container IP port 9092:"
if nc -z $KAFKA_IP 9092 2>/dev/null; then
    echo_success "Port 9092 is reachable on container IP"
else
    echo_warning "Port 9092 is not reachable on container IP"
fi
echo

echo "=== 4. Kafka Tools Testing ==="
echo_test "Testing Kafka tools from container"

echo "4a. List topics (internal):"
docker exec kafka4 timeout 10s kafka-topics --bootstrap-server localhost:9092 --list 2>&1 | head -5

echo
echo "4b. Create test topic:"
TEST_TOPIC="connectivity-test-$(date +%s)"
echo "Creating topic: $TEST_TOPIC"
docker exec kafka4 kafka-topics --bootstrap-server localhost:9092 --create --topic $TEST_TOPIC --partitions 1 --replication-factor 1 2>&1 | head -3

echo
echo "4c. List topics again:"
docker exec kafka4 timeout 5s kafka-topics --bootstrap-server localhost:9092 --list 2>&1 | tail -5

echo

echo "=== 5. Test with Our Latency Tool ==="
echo_test "Testing our kafka-latency-test tool"

echo "5a. Test with host port mapping:"
echo "./kafka-latency-test -brokers localhost:9093 -count 2 -interval 500ms -cleanup-old=false"

echo
echo "5b. Test with container IP:"
echo "./kafka-latency-test -brokers $KAFKA_IP:9092 -count 2 -interval 500ms -cleanup-old=false"

echo
echo "5c. Test split mode (different terminals):"
echo "Terminal 1 (Consumer): ./kafka-latency-test -consumer-only -consumer-brokers localhost:9093 -topic $TEST_TOPIC"
echo "Terminal 2 (Producer): ./kafka-latency-test -producer-only -producer-brokers $KAFKA_IP:9092 -topic $TEST_TOPIC -count 5"

echo

echo "=== 6. Quick Working Tests ==="
echo_test "Suggested working commands"

echo "Option 1 - Container network from inside:"
echo "docker exec kafka4 kafka-console-producer --bootstrap-server localhost:9092 --topic test"

echo
echo "Option 2 - Host network:"
echo "# First ensure port 9093 is working, then:"
echo "./kafka-latency-test -brokers localhost:9093 -count 3 -interval 1s -cleanup-old=false"

echo
echo "Option 3 - Producer/Consumer split:"
echo "# Use the working endpoint for both"
echo "./kafka-latency-test -producer-brokers localhost:9093 -consumer-brokers localhost:9093 -count 3"

echo

echo "=== 7. Troubleshooting Commands ==="
echo_test "If tests fail, try these debugging commands"

echo "Check Kafka logs:"
echo "docker logs kafka4 | tail -20"

echo
echo "Check Kafka configuration:"
echo "docker exec kafka4 cat /etc/kafka/server.properties | grep -E 'listeners|advertised'"

echo
echo "Check what's listening on ports:"
echo "docker exec kafka4 netstat -tlnp | grep 9092"

echo
echo "Test from external network:"
echo "telnet localhost 9093"

echo

echo "=== 8. Manual Test Commands ==="
echo "Run these manually to test:"
echo
echo "# Basic connectivity"
echo "nc -zv localhost 9093"
echo "nc -zv $KAFKA_IP 9092"
echo
echo "# Kafka tools"
echo "docker exec kafka4 kafka-topics --bootstrap-server localhost:9092 --list"
echo
echo "# Our tool"
echo "./kafka-latency-test -brokers localhost:9093 -count 1 -cleanup-old=false"

echo
echo "=== Ready to test! ===" 