#!/bin/bash

# Set the Java version to use
export JAVA_HOME=/usr/lib/jvm/java-11-amazon-corretto

# Check if the mode argument is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <mode> [port]"
    echo "mode: 'server' or 'client'"
    echo "port: UDP port number (default: 12345)"
    exit 1
fi

MODE=$1
PORT=${2:-12345}

# Compile the Java application
mvn clean compile

# Run the Java application
mvn exec:java -Dexec.mainClass="com.cantina.msklatency.EntryPoint" -Dexec.args="pingpong $MODE $PORT"