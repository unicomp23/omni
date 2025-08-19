#!/bin/bash
# Run load test with environment variables

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source environment variables
if [ -f "$SCRIPT_DIR/load-test.env" ]; then
    echo "Loading environment from load-test.env..."
    source "$SCRIPT_DIR/load-test.env"
else
    echo "Warning: load-test.env not found, using defaults"
fi

# Check if main executable exists
if [ ! -f "$SCRIPT_DIR/main" ]; then
    echo "Building load test..."
    cd "$SCRIPT_DIR"
    go build -o main .
fi

# Run the load test with any passed arguments
echo "Starting load test..."
cd "$SCRIPT_DIR"
./main "$@"
