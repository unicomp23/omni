#!/bin/bash

echo "=== Testing Kafka Services from Docker Compose ==="
echo

echo "🎯 Your docker-compose.yml has TWO Kafka-compatible services:"
echo "   1. Redpanda (ports 9092, 29092)"
echo "   2. Apache Kafka (ports 9094, 9095)"
echo

echo "=== 1. Testing Redpanda Service ==="
echo "🔗 Redpanda connection tests:"
echo

echo "Internal port (9092):"
echo "./kafka-latency-test -brokers redpanda:9092 -count 5 -interval 200ms"
echo

echo "External port (29092):"
echo "./kafka-latency-test -brokers localhost:29092 -count 5 -interval 200ms"
echo

echo "Cross-network test:"
echo "./kafka-latency-test -producer-brokers redpanda:9092 -consumer-brokers localhost:29092 -count 5"
echo

echo "=== 2. Testing Apache Kafka Service ==="
echo "🔗 Apache Kafka connection tests:"
echo

echo "Internal port (9094):"
echo "./kafka-latency-test -brokers kafka:9094 -count 5 -interval 200ms"
echo

echo "External port (9095):"
echo "./kafka-latency-test -brokers localhost:9095 -count 5 -interval 200ms"
echo

echo "Cross-network test:"
echo "./kafka-latency-test -producer-brokers kafka:9094 -consumer-brokers localhost:9095 -count 5"
echo

echo "=== 3. Cross-Service Latency Testing ==="
echo "🔀 Test latency between different Kafka services:"
echo

echo "Redpanda → Apache Kafka:"
echo "./kafka-latency-test -producer-brokers redpanda:9092 -consumer-brokers kafka:9094 -count 10 -topic cross-service-test"
echo

echo "Apache Kafka → Redpanda:"
echo "./kafka-latency-test -producer-brokers kafka:9094 -consumer-brokers redpanda:9092 -count 10 -topic cross-service-test"
echo

echo "=== 4. Network Connectivity Checks ==="
echo "📡 Check if services are accessible:"
echo

echo "# Check Redpanda:"
echo "nc -zv localhost 29092"
echo "nc -zv redpanda 9092 # (if on same network)"
echo

echo "# Check Apache Kafka:"
echo "nc -zv localhost 9095"
echo "nc -zv kafka 9094 # (if on same network)"
echo

echo "=== 5. Join Networks ==="
echo "🌐 Connect to the compose networks:"
echo

echo "# Join the mynetwork from compose:"
echo "docker network connect \$(docker network ls --filter name=shasta --format '{{.Name}}' | grep mynetwork) \$(hostname)"
echo

echo "# Or more specifically:"
echo "docker network connect shasta_mynetwork \$(hostname)"
echo

echo "=== 6. Quick Working Tests ==="
echo "🚀 Immediate tests you can run:"
echo

echo "Test 1 - External ports (should work immediately):"
echo "./kafka-latency-test -brokers localhost:29092 -count 3 -interval 500ms"
echo "./kafka-latency-test -brokers localhost:9095 -count 3 -interval 500ms"
echo

echo "Test 2 - After joining network:"
echo "./kafka-latency-test -brokers redpanda:9092 -count 3 -interval 500ms"
echo "./kafka-latency-test -brokers kafka:9094 -count 3 -interval 500ms"
echo

echo "Test 3 - Cross-service comparison:"
echo "./kafka-latency-test -producer-brokers localhost:29092 -consumer-brokers localhost:9095 -count 5"
echo

echo "=== 7. Start Services ==="
echo "📦 To start your compose services:"
echo

echo "cd /path/to/docker-compose-directory"
echo "docker-compose up -d"
echo "# Wait for services to be ready"
echo "docker-compose ps"

echo
echo "=== 8. Performance Comparison Testing ==="
echo "⚡ Compare Redpanda vs Apache Kafka performance:"
echo

echo "# Test Redpanda latency:"
echo "./kafka-latency-test -brokers localhost:29092 -count 100 -interval 10ms -output redpanda-latency.jsonl"
echo

echo "# Test Apache Kafka latency:"
echo "./kafka-latency-test -brokers localhost:9095 -count 100 -interval 10ms -output kafka-latency.jsonl"
echo

echo "# Compare results:"
echo "echo 'Redpanda stats:' && cat redpanda-latency.jsonl | jq -r '.latency_ms' | sort -n | awk 'BEGIN{sum=0;count=0} {sum+=\$1;count++} END{print \"Avg:\",sum/count,\"ms\"}'"
echo "echo 'Kafka stats:' && cat kafka-latency.jsonl | jq -r '.latency_ms' | sort -n | awk 'BEGIN{sum=0;count=0} {sum+=\$1;count++} END{print \"Avg:\",sum/count,\"ms\"}'"

echo
echo "=== Ready to test with your compose services! ===" 