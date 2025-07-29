#!/bin/bash

# RedPanda Load Test - Bidirectional S3 Sync Runner
# Builds and runs the bidirectional S3 sync utility with hash-based integrity checking

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default configuration
DEFAULT_BUCKET="redpanda-load-test-358474168551-us-east-1"
DEFAULT_LOGS_DIR="./logs"
DEFAULT_REGION="us-east-1"
DEFAULT_HASH_TYPE="sha256"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
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

log_sync() {
    echo -e "${PURPLE}[SYNC]${NC} $1"
}

log_hash() {
    echo -e "${CYAN}[HASH]${NC} $1"
}

print_usage() {
    cat << EOF
RedPanda Load Test - Bidirectional S3 Sync Runner
═════════════════════════════════════════════════

USAGE:
    $0 [OPTIONS]

OPTIONS:
    -b, --bucket BUCKET      S3 bucket name (default: $DEFAULT_BUCKET)
    -l, --logs DIR           Logs directory (default: $DEFAULT_LOGS_DIR)
    -r, --region REGION      AWS region (default: $DEFAULT_REGION)
    --hash-type TYPE         Hash algorithm: md5|sha256 (default: $DEFAULT_HASH_TYPE)
    -c, --cleanup            Remove local files after successful sync
    -u, --upload-only        Only upload to S3, don't download
    -d, --download-only      Only download from S3, don't upload
    -o, --once               Run sync once and exit (default: continuous)
    --daemon                 Run as background daemon
    --stop                   Stop running daemon
    --kill                   Force kill any running sync processes
    --build-only             Just build the binary, don't run
    -h, --help               Show this help

ENVIRONMENT VARIABLES:
    S3_BUCKET               Override default bucket
    LOGS_DIR                Override default logs directory
    AWS_REGION              Override default AWS region
    HASH_TYPE               Hash algorithm (md5|sha256)
    CLEANUP_LOCAL           Set to 'true' to enable cleanup
    UPLOAD_ONLY             Set to 'true' for upload-only mode
    DOWNLOAD_ONLY           Set to 'true' for download-only mode
    SYNC_ONCE               Set to 'true' to run once

SYNC MODES:
    Bidirectional (default)  Both upload and download with hash comparison
    Upload-only             Only upload local .gz files to S3
    Download-only           Only download S3 .gz files to local

HASH-BASED SYNC:
    • SHA256/MD5 hashes ensure file integrity
    • Identical files (same hash) are skipped for efficiency
    • Different files sync based on modification time
    • Download verification ensures data integrity
    • S3 metadata stores hash information

EXAMPLES:
    # Bidirectional sync with SHA256 hashes (recommended)
    $0

    # Upload-only mode with cleanup (for production load test instances)
    $0 --upload-only --cleanup

    # Download-only mode (for analysis instances)
    $0 --download-only

    # One-time bidirectional sync with MD5 hashes
    $0 --hash-type md5 --once

    # Run as daemon with custom settings
    $0 --daemon --hash-type sha256 --cleanup

    # Stop daemon
    $0 --stop

DAEMON MANAGEMENT:
    The daemon mode creates a PID file at ./bidirectional-s3-sync.pid
    Logs are written to ./bidirectional-s3-sync.log

USE CASES:
    Production Load Test:    --upload-only --cleanup --daemon
    Analysis Instance:       --download-only
    Multi-Instance Sync:     Default bidirectional mode
    One-time Migration:      --once

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
    log_info "Building bidirectional S3 sync binary..."
    
    # Initialize go.mod if it doesn't exist
    if [[ ! -f "go.mod" ]]; then
        log_info "Initializing Go module..."
        go mod init bidirectional-s3-sync
    fi
    
    # Get dependencies
    log_info "Getting dependencies..."
    go mod tidy
    
    # Build the binary
    if go build -o bidirectional-s3-sync s3-sync-bidirectional.go; then
        log_success "Binary built successfully: ./bidirectional-s3-sync"
        log_hash "Supports MD5 and SHA256 hash algorithms"
        log_sync "Bidirectional sync with intelligent conflict resolution"
    else
        log_error "Failed to build binary"
        exit 1
    fi
}

# Stop daemon if running
stop_daemon() {
    local pid_file="./bidirectional-s3-sync.pid"
    
    if [[ -f "$pid_file" ]]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log_info "Stopping bidirectional S3 sync daemon (PID: $pid)..."
            kill "$pid"
            
            # Wait for process to stop
            local count=0
            while kill -0 "$pid" 2>/dev/null && [[ $count -lt 10 ]]; do
                sleep 1
                ((count++))
            done
            
            if kill -0 "$pid" 2>/dev/null; then
                log_warn "Process didn't stop gracefully, force killing..."
                kill -9 "$pid" 2>/dev/null || true
            fi
            
            rm -f "$pid_file"
            log_success "Daemon stopped"
        else
            log_warn "PID file exists but process is not running"
            rm -f "$pid_file"
        fi
    else
        log_warn "No daemon PID file found"
    fi
}

# Force kill any running sync processes
force_kill() {
    log_info "Looking for running bidirectional S3 sync processes..."
    
    local pids=$(pgrep -f "bidirectional-s3-sync" | grep -v $$ || true)
    if [[ -n "$pids" ]]; then
        log_info "Killing bidirectional S3 sync processes: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        log_success "Processes killed"
    else
        log_info "No running bidirectional S3 sync processes found"
    fi
    
    # Clean up PID file
    rm -f "./bidirectional-s3-sync.pid"
}

# Check daemon status
check_daemon_status() {
    local pid_file="./bidirectional-s3-sync.pid"
    
    if [[ -f "$pid_file" ]]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log_success "Bidirectional S3 sync daemon is running (PID: $pid)"
            return 0
        else
            log_warn "PID file exists but process is not running"
            rm -f "$pid_file"
            return 1
        fi
    else
        log_info "Bidirectional S3 sync daemon is not running"
        return 1
    fi
}

# Run as daemon
run_daemon() {
    local bucket="$1"
    local logs_dir="$2"
    local region="$3"
    local hash_type="$4"
    local cleanup="$5"
    local upload_only="$6"
    local download_only="$7"
    
    # Check if already running
    if check_daemon_status >/dev/null 2>&1; then
        log_error "Daemon is already running"
        exit 1
    fi
    
    log_sync "Starting bidirectional S3 sync daemon..."
    
    # Build arguments
    local args=()
    [[ "$bucket" != "$DEFAULT_BUCKET" ]] && args+=("-bucket" "$bucket")
    [[ "$logs_dir" != "$DEFAULT_LOGS_DIR" ]] && args+=("-logs" "$logs_dir")
    [[ "$region" != "$DEFAULT_REGION" ]] && args+=("-region" "$region")
    [[ "$hash_type" != "$DEFAULT_HASH_TYPE" ]] && args+=("-hash" "$hash_type")
    [[ "$cleanup" == "true" ]] && args+=("-cleanup")
    [[ "$upload_only" == "true" ]] && args+=("-upload-only")
    [[ "$download_only" == "true" ]] && args+=("-download-only")
    
    # Start daemon
    nohup ./bidirectional-s3-sync "${args[@]}" > bidirectional-s3-sync.log 2>&1 &
    local pid=$!
    
    echo "$pid" > bidirectional-s3-sync.pid
    
    # Check if process started successfully
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
        log_success "Daemon started successfully (PID: $pid)"
        log_hash "Hash algorithm: $hash_type"
        log_sync "Mode: $(
            if [[ "$upload_only" == "true" ]]; then
                echo "Upload-only"
            elif [[ "$download_only" == "true" ]]; then
                echo "Download-only"
            else
                echo "Bidirectional"
            fi
        )"
        log_info "Logs: tail -f bidirectional-s3-sync.log"
        log_info "Stop: $0 --stop"
    else
        log_error "Failed to start daemon"
        rm -f bidirectional-s3-sync.pid
        exit 1
    fi
}

# Parse arguments
BUCKET="$DEFAULT_BUCKET"
LOGS_DIR="$DEFAULT_LOGS_DIR"
REGION="$DEFAULT_REGION"
HASH_TYPE="$DEFAULT_HASH_TYPE"
CLEANUP="false"
UPLOAD_ONLY="false"
DOWNLOAD_ONLY="false"
RUN_ONCE="false"
DAEMON_MODE="false"
STOP_DAEMON="false"
FORCE_KILL="false"
BUILD_ONLY="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--bucket)
            BUCKET="$2"
            shift 2
            ;;
        -l|--logs)
            LOGS_DIR="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        --hash-type)
            HASH_TYPE="$2"
            shift 2
            ;;
        -c|--cleanup)
            CLEANUP="true"
            shift
            ;;
        -u|--upload-only)
            UPLOAD_ONLY="true"
            shift
            ;;
        -d|--download-only)
            DOWNLOAD_ONLY="true"
            shift
            ;;
        -o|--once)
            RUN_ONCE="true"
            shift
            ;;
        --daemon)
            DAEMON_MODE="true"
            shift
            ;;
        --stop)
            STOP_DAEMON="true"
            shift
            ;;
        --kill)
            FORCE_KILL="true"
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
LOGS_DIR="${LOGS_DIR:-$LOGS_DIR}"
REGION="${AWS_REGION:-$REGION}"
HASH_TYPE="${HASH_TYPE:-$HASH_TYPE}"
[[ "${CLEANUP_LOCAL:-}" == "true" ]] && CLEANUP="true"
[[ "${UPLOAD_ONLY:-}" == "true" ]] && UPLOAD_ONLY="true"
[[ "${DOWNLOAD_ONLY:-}" == "true" ]] && DOWNLOAD_ONLY="true"
[[ "${SYNC_ONCE:-}" == "true" ]] && RUN_ONCE="true"

# Validate hash type
if [[ "$HASH_TYPE" != "md5" && "$HASH_TYPE" != "sha256" ]]; then
    log_error "Invalid hash type: $HASH_TYPE (must be md5 or sha256)"
    exit 1
fi

# Validate sync mode
if [[ "$UPLOAD_ONLY" == "true" && "$DOWNLOAD_ONLY" == "true" ]]; then
    log_error "Cannot specify both --upload-only and --download-only"
    exit 1
fi

# Handle special modes first
if [[ "$STOP_DAEMON" == "true" ]]; then
    stop_daemon
    exit 0
fi

if [[ "$FORCE_KILL" == "true" ]]; then
    force_kill
    exit 0
fi

# Main execution
echo "RedPanda Load Test - Bidirectional S3 Sync Runner"
echo "═════════════════════════════════════════════════"
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
log_info "  Logs Directory: $LOGS_DIR"
log_info "  Region: $REGION"
log_hash "  Hash Algorithm: $HASH_TYPE"
log_info "  Cleanup Local Files: $CLEANUP"
log_sync "  Upload Mode: $(if [[ "$UPLOAD_ONLY" == "true" ]]; then echo "Only"; elif [[ "$DOWNLOAD_ONLY" == "true" ]]; then echo "Disabled"; else echo "Enabled"; fi)"
log_sync "  Download Mode: $(if [[ "$DOWNLOAD_ONLY" == "true" ]]; then echo "Only"; elif [[ "$UPLOAD_ONLY" == "true" ]]; then echo "Disabled"; else echo "Enabled"; fi)"
log_info "  Run Once: $RUN_ONCE"
log_info "  Daemon Mode: $DAEMON_MODE"
echo

# Run the sync
if [[ "$DAEMON_MODE" == "true" ]]; then
    run_daemon "$BUCKET" "$LOGS_DIR" "$REGION" "$HASH_TYPE" "$CLEANUP" "$UPLOAD_ONLY" "$DOWNLOAD_ONLY"
else
    # Build arguments for direct execution
    args=()
    [[ "$BUCKET" != "$DEFAULT_BUCKET" ]] && args+=("-bucket" "$BUCKET")
    [[ "$LOGS_DIR" != "$DEFAULT_LOGS_DIR" ]] && args+=("-logs" "$LOGS_DIR")
    [[ "$REGION" != "$DEFAULT_REGION" ]] && args+=("-region" "$REGION")
    [[ "$HASH_TYPE" != "$DEFAULT_HASH_TYPE" ]] && args+=("-hash" "$HASH_TYPE")
    [[ "$CLEANUP" == "true" ]] && args+=("-cleanup")
    [[ "$UPLOAD_ONLY" == "true" ]] && args+=("-upload-only")
    [[ "$DOWNLOAD_ONLY" == "true" ]] && args+=("-download-only")
    [[ "$RUN_ONCE" == "true" ]] && args+=("-once")
    
    log_sync "Starting bidirectional S3 sync..."
    exec ./bidirectional-s3-sync "${args[@]}"
fi 