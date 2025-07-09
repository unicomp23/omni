#!/bin/bash

# Run the Go producer
echo "Running Go Kafka producer..."
docker compose exec dev-golang sh -c "cd /golang-project && go run test-producer.go" 