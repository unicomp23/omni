#!/bin/bash

# Stop the Docker Compose environment
echo "Stopping containers..."
docker compose down

echo "✅ Containers stopped."
echo ""
echo "To remove volumes as well (clean slate):"
echo "  docker compose down -v" 