#!/bin/bash

# Test Kafka connection and basic functionality
echo "Testing Kafka connection..."

# Check if containers are running
echo "1. Checking container status..."
docker compose ps

echo ""
echo "2. Testing network connectivity to Kafka from Go container..."
docker compose exec dev-golang sh -c "nc -zv kafka4 29092 && echo 'Internal Kafka connection: OK' || echo 'Internal Kafka connection: FAILED'"

echo ""
echo "3. Testing external Kafka connection..."
nc -zv localhost 9093 && echo "External Kafka connection: OK" || echo "External Kafka connection: FAILED"

echo ""
echo "4. Listing Kafka topics..."
docker compose exec kafka4 kafka-topics --bootstrap-server localhost:9092 --list

echo ""
echo "5. Testing Go environment..."
docker compose exec dev-golang go version

echo ""
echo "6. Checking Go project structure..."
docker compose exec dev-golang ls -la /golang-project/

echo ""
echo "✅ Connection test completed!" 