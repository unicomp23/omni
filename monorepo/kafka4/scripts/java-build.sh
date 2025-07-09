#!/bin/bash

# Build the Java project
echo "Building Java project with Maven..."
docker compose exec dev-java sh -c "
    # Install Maven if not present
    if ! command -v mvn &> /dev/null; then
        echo 'Installing Maven...'
        apt-get update -qq && apt-get install -y maven
    fi
    
    cd /workspace/java-project && mvn clean compile
" 