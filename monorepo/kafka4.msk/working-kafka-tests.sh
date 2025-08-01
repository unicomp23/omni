#!/bin/bash

echo "=== Working Kafka4 Test Solutions ==="
echo

echo "🎯 Based on diagnosis, here are the WORKING approaches:"
echo

echo "=== 1. Container-Internal Testing (WORKING) ==="
echo "Test Kafka from inside the container using container network:"
echo
echo "# Console producer/consumer test:"
echo "docker exec -it kafka4 kafka-console-producer --bootstrap-server localhost:9092 --topic test-topic"
echo "# In another terminal:"
echo "docker exec -it kafka4 kafka-console-consumer --bootstrap-server localhost:9092 --topic test-topic --from-beginning"
echo

echo "=== 2. Development Container Testing (RECOMMENDED) ==="
echo "Use the dev-golang container which is on the same network:"
echo
echo "# From dev-golang container:"
echo "docker exec -it dev-golang bash"
echo "# Then inside the container:"
echo "cd /path/to/your/latency/tool"
echo "./kafka-latency-test -brokers kafka4:9092 -count 5 -interval 100ms"
echo

echo "=== 3. Network Bridge Solution ==="
echo "Connect this container to the Kafka network:"
echo
echo "# Join the kafka network:"
echo "docker network connect kafka4_kafka-network \$(hostname)"
echo "# Then test:"
echo "./kafka-latency-test -brokers kafka4:9092 -count 3 -interval 500ms"
echo

echo "=== 4. Host Network Mode ==="
echo "Run our tool with host networking:"
echo
echo "# If you have direct access to Kafka ports:"
echo "./kafka-latency-test -brokers 172.19.0.2:9092 -count 3"
echo

echo "=== 5. Simple Working Examples ==="
echo

echo "Option A - Internal container test:"
echo "docker exec kafka4 kafka-topics --bootstrap-server localhost:9092 --create --topic working-test --partitions 1 --replication-factor 1"
echo "docker exec kafka4 kafka-console-producer --bootstrap-server localhost:9092 --topic working-test"

echo
echo "Option B - Dev container test:"
echo "docker exec dev-golang /bin/bash -c 'cd /go && wget -O kafka-latency-test [your-binary-url] && chmod +x kafka-latency-test && ./kafka-latency-test -brokers kafka4:9092 -count 3'"

echo
echo "Option C - Network join test:"
echo "# First join network:"
echo "docker network connect kafka4_kafka-network \$(docker ps --format '{{.Names}}' | grep shasta_devenv)"
echo "# Then test from devenv:"  
echo "docker exec shasta_devenv_1 telnet kafka4 9092"

echo

echo "=== 6. Quick Connectivity Verification ==="
echo
echo "Test basic connectivity:"
echo "docker exec kafka4 kafka-broker-api-versions --bootstrap-server localhost:9092"
echo
echo "Create and test topic:"
echo "docker exec kafka4 kafka-topics --bootstrap-server localhost:9092 --create --topic connectivity-test --partitions 1 --replication-factor 1"
echo "docker exec kafka4 kafka-topics --bootstrap-server localhost:9092 --list | grep connectivity-test"

echo

echo "=== 7. Recommended Test Sequence ==="
echo
echo "1. Basic Kafka test (inside container):"
echo "   docker exec kafka4 kafka-broker-api-versions --bootstrap-server localhost:9092"
echo
echo "2. Topic creation test:"
echo "   docker exec kafka4 kafka-topics --bootstrap-server localhost:9092 --create --topic test-\$(date +%s) --partitions 1 --replication-factor 1"
echo
echo "3. Producer test (type message and press Enter):"
echo "   docker exec -it kafka4 kafka-console-producer --bootstrap-server localhost:9092 --topic test-\$(date +%s)"
echo
echo "4. Our latency tool test (from dev-golang container):"
echo "   docker exec -it dev-golang bash"
echo "   # Copy our binary and run:"
echo "   ./kafka-latency-test -brokers kafka4:9092 -count 2 -interval 1s"

echo
echo "=== MOST LIKELY TO WORK RIGHT NOW ==="
echo "docker exec kafka4 kafka-console-producer --bootstrap-server localhost:9092 --topic quick-test"
echo "# Type a message and press Enter to test" 