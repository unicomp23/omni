#!/bin/bash

# Check if Deno is installed
if ! command -v deno &> /dev/null; then
    echo "Deno is not installed. Please install it first."
    exit 1
fi

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Get the reports directory from command line or use default
REPORTS_DIR=${1:-"${SCRIPT_DIR}/reports"}

# Run the Deno script
echo "Analyzing consumer logs by hour..."
deno run --allow-read --allow-write "${SCRIPT_DIR}/analyze.hourly.reports.ts" "${REPORTS_DIR}"

# Check if the script executed successfully
if [ $? -eq 0 ]; then
    echo "Hourly analysis completed successfully."
else
    echo "Error occurred during hourly analysis."
    exit 1
fi 