#!/bin/bash

# RedPanda Load Test - S3 Download Runner
# Builds and runs the S3 download utility to retrieve log files from S3

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default configuration
DEFAULT_BUCKET="redpanda-load-test-358474168551-us-east-1"
DEFAULT_OUTPUT_DIR="./downloads"
DEFAULT_REGION="us-east-1"
DEFAULT_PREFIX="latency-logs/"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_usage() {
    cat << EOF
RedPanda Load Test - S3 Download Runner
═════════════════════════════════════

USAGE:
    $0 [OPTIONS]

OPTIONS:
    -b, --bucket BUCKET      S3 bucket name (default: $DEFAULT_BUCKET)
    -o, --output DIR         Local output directory (default: $DEFAULT_OUTPUT_DIR)
    -r, --region REGION      AWS region (default: $DEFAULT_REGION)
    -p, --prefix PREFIX      S3 key prefix (default: $DEFAULT_PREFIX)
    -t, --pattern PATTERN    Filter files by pattern (substring match)
    -m, --max NUM            Maximum number of files to process (0 = all)
    -f, --overwrite          Overwrite existing local files
    -l, --list               List files only, don't download
    -d, --detailed           Show detailed information when listing
    --build-only             Just build the binary, don't run
    -h, --help               Show this help

ENVIRONMENT VARIABLES:
    S3_BUCKET               Override default bucket
    OUTPUT_DIR              Override default output directory
    AWS_REGION              Override default AWS region
    AWS_PROFILE             AWS profile name (default: 358474168551_admin)
    S3_PREFIX               Override default S3 prefix
    PATTERN                 Filter pattern for files
    MAX_FILES               Maximum number of files to process
    OVERWRITE_FILES         Set to 'true' to overwrite existing files

EXAMPLES:
    # List all available files
    $0 --list

    # List files with detailed info, limited to 20 most recent
    $0 --list --detailed --max 20

    # List files matching a pattern
    $0 --list --pattern "2024-01-15"

    # Download all files to default directory
    $0

    # Download files matching pattern to custom directory
    $0 --pattern "2024-01-15" --output ./custom-logs --max 10

    # Download with overwrite enabled
    $0 --overwrite

    # Download from custom bucket and prefix
    $0 --bucket my-bucket --prefix "logs/" --output ./downloads

    # Just build the binary
    $0 --build-only

NOTES:
    - Files are sorted by modification time (newest first)
    - Existing files are skipped unless --overwrite is used
    - Directory structure from S3 is preserved locally
    - File timestamps are preserved from S3 metadata

EOF
}

# Check if Go is installed
check_go() {
    if ! command -v go &> /dev/null; then
        log_error "Go is not installed or not in PATH"
        log_info "Please install Go: https://golang.org/doc/install"
        exit 1
    fi
    
    local go_version=$(go version | awk '{print $3}' | sed 's/go//')
    log_info "Using Go version: $go_version"
}

# Build the Go binary
build_binary() {
    log_info "Building S3 download binary..."
    
    # Initialize go.mod if it doesn't exist
    if [[ ! -f "go.mod" ]]; then
        log_info "Initializing Go module..."
        go mod init s3-download
    fi
    
    # Get dependencies
    log_info "Getting dependencies..."
    go mod tidy
    
    # Build the binary
    if go build -o s3-download ./cmd/s3-download; then
        log_success "Binary built successfully: ./s3-download"
    else
        log_error "Failed to build binary"
        exit 1
    fi
}

# Parse arguments
BUCKET="$DEFAULT_BUCKET"
OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
REGION="$DEFAULT_REGION"
PREFIX="$DEFAULT_PREFIX"
PATTERN=""
MAX_FILES=""
OVERWRITE="false"
LIST_ONLY="false"
DETAILED="false"
BUILD_ONLY="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--bucket)
            BUCKET="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -p|--prefix)
            PREFIX="$2"
            shift 2
            ;;
        -t|--pattern)
            PATTERN="$2"
            shift 2
            ;;
        -m|--max)
            MAX_FILES="$2"
            shift 2
            ;;
        -f|--overwrite)
            OVERWRITE="true"
            shift
            ;;
        -l|--list)
            LIST_ONLY="true"
            shift
            ;;
        -d|--detailed)
            DETAILED="true"
            shift
            ;;
        --build-only)
            BUILD_ONLY="true"
            shift
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
done

# Apply environment variable overrides
BUCKET="${S3_BUCKET:-$BUCKET}"
OUTPUT_DIR="${OUTPUT_DIR:-$OUTPUT_DIR}"
REGION="${AWS_REGION:-$REGION}"
PREFIX="${S3_PREFIX:-$PREFIX}"
PATTERN="${PATTERN:-$PATTERN}"
MAX_FILES="${MAX_FILES:-$MAX_FILES}"
[[ "${OVERWRITE_FILES:-}" == "true" ]] && OVERWRITE="true"

# Main execution
echo "RedPanda Load Test - S3 Download Runner"
echo "═════════════════════════════════════"
echo

# Check prerequisites
check_go

# Build binary
build_binary

if [[ "$BUILD_ONLY" == "true" ]]; then
    log_success "Build completed"
    exit 0
fi

# Display configuration
log_info "Configuration:"
log_info "  Bucket: $BUCKET"
log_info "  Prefix: $PREFIX"
if [[ "$LIST_ONLY" == "true" ]]; then
    log_info "  Mode: List only"
else
    log_info "  Output Directory: $OUTPUT_DIR"
    log_info "  Overwrite Existing: $OVERWRITE"
fi
[[ -n "$PATTERN" ]] && log_info "  Pattern Filter: $PATTERN"
[[ -n "$MAX_FILES" ]] && log_info "  Max Files: $MAX_FILES"
log_info "  Region: $REGION"
[[ "$DETAILED" == "true" ]] && log_info "  Detailed Output: enabled"
echo

# Build arguments for execution
args=()
[[ "$BUCKET" != "$DEFAULT_BUCKET" ]] && args+=("-bucket" "$BUCKET")
[[ "$OUTPUT_DIR" != "$DEFAULT_OUTPUT_DIR" ]] && args+=("-output" "$OUTPUT_DIR")
[[ "$REGION" != "$DEFAULT_REGION" ]] && args+=("-region" "$REGION")
[[ "$PREFIX" != "$DEFAULT_PREFIX" ]] && args+=("-prefix" "$PREFIX")
[[ -n "$PATTERN" ]] && args+=("-pattern" "$PATTERN")
[[ -n "$MAX_FILES" ]] && args+=("-max" "$MAX_FILES")
[[ "$OVERWRITE" == "true" ]] && args+=("-overwrite")
[[ "$LIST_ONLY" == "true" ]] && args+=("-list")
[[ "$DETAILED" == "true" ]] && args+=("-detailed")

# Run the download
if [[ "$LIST_ONLY" == "true" ]]; then
    log_info "Listing S3 objects..."
else
    log_info "Starting S3 download..."
fi

exec ./s3-download "${args[@]}" 