#!/bin/bash

# Start the Kafka + Go development environment
echo "Starting Kafka and Go development containers..."
docker compose up -d

echo "Waiting for Kafka to be ready..."
docker compose logs -f kafka4 &
LOG_PID=$!

# Wait for Kafka to be healthy
while ! docker compose ps | grep "kafka4" | grep -q "healthy"; do
    sleep 2
done

# Stop the log following
kill $LOG_PID 2>/dev/null || true

echo "✅ Environment is ready!"
echo ""
echo "Access the Go development container:"
echo "  docker compose exec dev-golang sh"
echo ""
echo "Or use the helper scripts:"
echo "  ./scripts/shell.sh    - Access Go container"
echo "  ./scripts/producer.sh - Run producer"
echo "  ./scripts/consumer.sh - Run consumer"
echo "  ./scripts/logs.sh     - View logs"
echo "  ./scripts/stop.sh     - Stop containers" 