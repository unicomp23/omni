#!/bin/bash

# Function to display help
show_help() {
    echo "Usage: $0 [OPTIONS] [REPORTS_DIR]"
    echo ""
    echo "Analyze Kafka consumer logs by hour or minute buckets."
    echo ""
    echo "OPTIONS:"
    echo "  -m, --minute    Analyze by minute instead of hour (default: hour)"
    echo "  -h, --help      Display this help message"
    echo ""
    echo "ARGUMENTS:"
    echo "  REPORTS_DIR     Directory containing the test reports (default: ./reports)"
    echo ""
    echo "EXAMPLES:"
    echo "  $0                     # Analyze by hour using default reports directory"
    echo "  $0 -m                  # Analyze by minute using default reports directory"
    echo "  $0 /path/to/reports    # Analyze by hour using custom directory"
    echo "  $0 -m /path/to/reports # Analyze by minute using custom directory"
    exit 0
}

# Check if Deno is installed
if ! command -v deno &> /dev/null; then
    echo "Deno is not installed. Please install it first."
    exit 1
fi

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Initialize variables
BUCKET_TYPE="hour"
REPORTS_DIR=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--minute)
            BUCKET_TYPE="minute"
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            # If not a switch, treat it as the reports directory
            REPORTS_DIR="$1"
            shift
            ;;
    esac
done

# Use default reports directory if none provided
REPORTS_DIR=${REPORTS_DIR:-"${SCRIPT_DIR}/reports"}

# Run the Deno script
if [ "$BUCKET_TYPE" = "minute" ]; then
    echo "Analyzing consumer logs by minute..."
else
    echo "Analyzing consumer logs by hour..."
fi

deno run --allow-read --allow-write "${SCRIPT_DIR}/analyze.hourly.reports.ts" "${REPORTS_DIR}" "${BUCKET_TYPE}"

# Check if the script executed successfully
if [ $? -eq 0 ]; then
    if [ "$BUCKET_TYPE" = "minute" ]; then
        echo "Per-minute analysis completed successfully."
    else
        echo "Hourly analysis completed successfully."
    fi
else
    echo "Error occurred during analysis."
    exit 1
fi 