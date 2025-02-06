#!/bin/bash
set -e

# Start time measurement
start_time=$(($(date +%s%N)/1000000))

# Run the publisher using the shasta_mynetwork
docker run --rm \
  --network shasta_mynetwork \
  --name kafka-publisher \
  -e DEBUG=kafkajs* \
  kafkajs-latency \
  --mode publish \
  --iterations 10000 \
  --topic latency-test-003 \
  --publishers 16 \
  --brokers "shasta-redpanda-1:9092" \
  --partitions 36 \
  --debug true

# End time measurement and calculate elapsed time
end_time=$(($(date +%s%N)/1000000))
elapsed=$((end_time - start_time))
echo "Total execution time: ${elapsed} milliseconds"
