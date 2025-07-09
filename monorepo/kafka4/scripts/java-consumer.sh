#!/bin/bash

# Run the Java Kafka consumer
echo "Running Java Kafka consumer..."
docker compose exec dev-java sh -c "
    # Install Maven if not present
    if ! command -v mvn &> /dev/null; then
        echo 'Installing Maven...'
        apt-get update -qq && apt-get install -y maven
    fi
    
    cd /workspace/java-project && mvn exec:java -Dexec.mainClass=\"com.example.kafka.KafkaConsumer\"
" 