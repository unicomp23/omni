#!/bin/bash

# Ensure we're in the right directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if the process_latencies.js exists
if [ ! -f "process_latencies.js" ]; then
    echo "process_latencies.js not found in current directory"
    exit 1
fi

# Check if downloaded_logs directory exists
if [ ! -d "downloaded_logs" ]; then
    echo "downloaded_logs directory not found"
    exit 1
fi

echo "Starting latency analysis..."
echo "Found these event files:"
find ./downloaded_logs -name "kafka-latency-events.jsonl" -ls

# Run the Node.js script
node process_latencies.js

echo "Analysis complete!" 