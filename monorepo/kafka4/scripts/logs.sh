#!/bin/bash

# View container logs
SERVICE=${1:-kafka4}

echo "Viewing logs for $SERVICE..."
echo "Available services: kafka4, dev-golang"
echo "Usage: ./scripts/logs.sh [service_name]"
echo ""

docker compose logs -f $SERVICE 