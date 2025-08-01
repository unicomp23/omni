#!/bin/bash

echo "=== Kafka Latency Test Examples ==="
echo

# Make the binary executable
chmod +x kafka-latency-test

echo "1. Standard test (same brokers for producer and consumer):"
echo "./kafka-latency-test -brokers localhost:9093 -count 100 -interval 10ms"
echo

echo "2. Different brokers for producer and consumer:"
echo "./kafka-latency-test -producer-brokers 172.19.0.2:9092 -consumer-brokers localhost:9093 -count 50"
echo

echo "3. Producer on container network, consumer on host:"
echo "./kafka-latency-test -producer-brokers kafka4:9092 -consumer-brokers localhost:9093 -count 100"
echo

echo "4. Split testing with different networks:"
echo "   Terminal 1 (Consumer on host network):"
echo "   ./kafka-latency-test -consumer-only -consumer-brokers localhost:9093 -topic test-topic-12345678"
echo
echo "   Terminal 2 (Producer on container network):"
echo "   ./kafka-latency-test -producer-only -producer-brokers kafka4:9092 -topic test-topic-12345678 -count 1000"
echo

echo "5. Cross-network latency testing:"
echo "./kafka-latency-test -producer-brokers remote-kafka:9092 -consumer-brokers local-kafka:9092 -count 200"
echo

echo "6. Host to container latency:"
echo "./kafka-latency-test -producer-brokers localhost:9093 -consumer-brokers 172.19.0.2:9092 -count 500 -interval 5ms"
echo

echo "=== Quick Test Commands ==="
echo

echo "Test with container IP (if accessible):"
echo "./kafka-latency-test -brokers 172.19.0.2:9092 -count 5 -interval 500ms -wait-time 2s"
echo

echo "Test with host port mapping:"
echo "./kafka-latency-test -brokers localhost:9093 -count 5 -interval 500ms -wait-time 2s"
echo

echo "Test producer/consumer on different endpoints:"
echo "./kafka-latency-test -producer-brokers 172.19.0.2:9092 -consumer-brokers 172.19.0.2:9092 -count 5 -interval 500ms"
echo

echo "=== Network Troubleshooting ==="
echo

echo "Check container connectivity:"
echo "docker exec kafka4 kafka-topics --bootstrap-server localhost:9092 --list"
echo

echo "Check host connectivity:"  
echo "nc -zv localhost 9093"
echo

echo "Get kafka4 container IP:"
echo "docker inspect kafka4 | grep IPAddress"
echo

echo "Test from current location:"
echo "nc -zv 172.19.0.2 9092" 