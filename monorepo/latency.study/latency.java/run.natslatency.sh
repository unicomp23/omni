#!/bin/bash

# Set the Java version to use
export JAVA_HOME=/usr/lib/jvm/java-11-amazon-corretto

# Check if the mode argument is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <mode>"
    echo "mode: 'core' or 'js' (for JetStream)"
    exit 1
fi

# Compile and run the Java application
mvn clean compile exec:java -Dexec.mainClass="com.cantina.msklatency.EntryPoint" -Dexec.args="natslatency $1"