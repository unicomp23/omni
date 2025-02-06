#!/bin/bash
set -e

# Run the consumer using the shasta_mynetwork
docker run --rm \
  --network shasta_mynetwork \
  --name kafka-consumer \
  -e DEBUG=kafkajs* \
  kafkajs-latency \
  --mode consume \
  --duration 30 \
  --topic latency-test-003 \
  --brokers "shasta-redpanda-1:9092" \
  --debug true
