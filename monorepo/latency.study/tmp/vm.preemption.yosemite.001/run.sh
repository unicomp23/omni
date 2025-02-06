#!/bin/bash

# Check if a filename is provided
if [ $# -eq 0 ]; then
    echo "Please provide a CSV filename as an argument."
    exit 1
fi

# Run the Deno script with the provided filename
deno run --allow-read --allow-write --allow-net --allow-env main.ts "$1"
