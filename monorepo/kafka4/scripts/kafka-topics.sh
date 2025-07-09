#!/bin/bash

# Kafka topics management helper
ACTION=${1:-list}
TOPIC=${2:-test-topic}

case $ACTION in
    "list")
        echo "Listing all Kafka topics..."
        docker compose exec kafka4 kafka-topics --bootstrap-server kafka4:29092 --list
        ;;
    "create")
        echo "Creating topic: $TOPIC"
        docker compose exec kafka4 kafka-topics --bootstrap-server kafka4:29092 --create --topic $TOPIC --partitions 3 --replication-factor 1
        ;;
    "describe")
        echo "Describing topic: $TOPIC"
        docker compose exec kafka4 kafka-topics --bootstrap-server kafka4:29092 --describe --topic $TOPIC
        ;;
    "delete")
        echo "Deleting topic: $TOPIC"
        docker compose exec kafka4 kafka-topics --bootstrap-server kafka4:29092 --delete --topic $TOPIC
        ;;
    *)
        echo "Usage: ./scripts/kafka-topics.sh [action] [topic_name]"
        echo "Actions:"
        echo "  list               - List all topics"
        echo "  create [topic]     - Create a topic"
        echo "  describe [topic]   - Describe a topic"
        echo "  delete [topic]     - Delete a topic"
        ;;
esac 