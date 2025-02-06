#!/bin/bash

# Check if Deno is installed
if ! command -v deno &> /dev/null; then
    echo "Deno is not installed. Please install it first."
    exit 1
fi

# Get the reports directory from sync.reports.sh
REPORTS_DIR="reports"

# Run the Deno script
echo "Analyzing consumer logs..."
deno run --allow-read --allow-write analyze.reports.ts "${REPORTS_DIR}" 