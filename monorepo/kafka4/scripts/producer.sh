#!/bin/bash

# Run the Go producer
echo "Running Go Kafka producer..."
docker compose exec dev-golang sh -c "cd /golang-project/producer && go run ." 