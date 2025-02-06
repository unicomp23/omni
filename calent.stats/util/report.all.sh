#!/bin/bash

# Base directory for calent data
BASE_DIR="/tmp/_tmp/s3/calent"

# Check if base directory exists
if [ ! -d "$BASE_DIR" ]; then
    echo "Error: Base directory $BASE_DIR does not exist"
    exit 1
fi

# Iterate through all subdirectories in the base directory
for dir in "$BASE_DIR"/*/; do
    if [ -d "$dir" ]; then
        echo "Processing directory: $dir"
        node ./parse_percentile.js "$dir" --quiet
    fi
done

echo "Processing complete"
