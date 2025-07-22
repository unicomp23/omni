#!/bin/bash

# Quick test scenarios for RedPanda load testing

set -e

echo "RedPanda Quick Test Scenarios"
echo "============================"
echo ""
echo "Select a test scenario:"
echo "1. Quick Test (30s, light load)"
echo "2. Throughput Test (5min, high load)"
echo "3. Large Messages (2min, 16KB messages)"
echo "4. Compression Test (compare all algorithms)"
echo "5. Latency Test (low load, small messages)"
echo "6. Stress Test (10min, maximum load)"
echo "7. Custom Test"
echo ""

read -p "Enter choice (1-7): " choice

case $choice in
    1)
        echo "Running Quick Test..."
        ./run.sh --producers 2 --consumers 2 --duration 30s --message-size 512
        ;;
    2)
        echo "Running Throughput Test..."
        ./run.sh --producers 12 --consumers 12 --duration 5m --message-size 1024
        ;;
    3)
        echo "Running Large Message Test..."
        ./run.sh --producers 4 --consumers 4 --duration 2m --message-size 16384 --compression zstd
        ;;
    4)
        echo "Running Compression Comparison..."
        echo "Testing no compression..."
        ./run.sh --producers 4 --consumers 4 --duration 1m --compression none --topic compression-none
        echo ""
        echo "Testing snappy compression..."  
        ./run.sh --producers 4 --consumers 4 --duration 1m --compression snappy --topic compression-snappy
        echo ""
        echo "Testing zstd compression..."
        ./run.sh --producers 4 --consumers 4 --duration 1m --compression zstd --topic compression-zstd
        ;;
    5)
        echo "Running Latency Test..."
        ./run.sh --producers 1 --consumers 1 --duration 2m --message-size 128 --topic latency-test
        ;;
    6)
        echo "Running Stress Test..."
        echo "WARNING: This will generate high load for 10 minutes!"
        read -p "Continue? (y/N): " confirm
        if [[ $confirm == [yY] ]]; then
            ./run.sh --producers 20 --consumers 20 --duration 10m --message-size 2048
        else
            echo "Cancelled."
        fi
        ;;
    7)
        echo "Custom Test - Edit the following command and run:"
        echo "./run.sh --producers 6 --consumers 6 --message-size 1024 --duration 5m --compression snappy"
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac 