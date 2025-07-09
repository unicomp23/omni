#!/bin/bash

# Run the Go consumer
echo "Running Go Kafka consumer..."
docker compose exec dev-golang sh -c "cd /golang-project && go run test-consumer.go" 