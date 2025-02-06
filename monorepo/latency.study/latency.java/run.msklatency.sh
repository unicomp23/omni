#!/bin/bash

# Set the Java version to use
export JAVA_HOME=/usr/lib/jvm/java-11-amazon-corretto

# Display usage message
echo "Usage: $0"
echo "This script runs the MSK Latency test."

# Compile and run the Java application
mvn clean compile exec:java -Dexec.mainClass="com.cantina.msklatency.EntryPoint" -Dexec.args="msklatency"