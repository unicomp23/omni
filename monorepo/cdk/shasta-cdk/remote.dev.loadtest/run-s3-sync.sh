#!/bin/bash

# RedPanda Load Test - S3 Sync Runner
# Builds and runs the S3 sync utility to upload compressed log files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default configuration
DEFAULT_BUCKET="redpanda-load-test-060795946368-us-east-2"
DEFAULT_LOGS_DIR="./logs"
DEFAULT_REGION="us-east-2"

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
RedPanda Load Test - S3 Sync Runner
═══════════════════════════════════

USAGE:
    $0 [OPTIONS]

OPTIONS:
    -b, --bucket BUCKET      S3 bucket name (default: $DEFAULT_BUCKET)
    -l, --logs DIR           Logs directory (default: $DEFAULT_LOGS_DIR)
    -r, --region REGION      AWS region (default: $DEFAULT_REGION)
    -c, --cleanup            Remove local files after successful upload
    -o, --once               Run sync once and exit (default: continuous)
    -d, --daemon             Run as background daemon
    -s, --stop               Stop running daemon
    -k, --kill               Force kill any running sync processes
    --build-only             Just build the binary, don't run
    -h, --help               Show this help

ENVIRONMENT VARIABLES:
    S3_BUCKET               Override default bucket
    LOGS_DIR                Override default logs directory
    AWS_REGION              Override default AWS region
    CLEANUP_LOCAL           Set to 'true' to enable cleanup
    SYNC_ONCE               Set to 'true' to run once

EXAMPLES:
    # Run continuously with defaults
    $0

    # Run once with cleanup enabled
    $0 --once --cleanup

    # Run as background daemon
    $0 --daemon

    # Run with custom settings
    $0 --bucket my-bucket --logs /custom/logs --region us-west-2

    # Stop background daemon
    $0 --stop

DAEMON MANAGEMENT:
    The daemon mode creates a PID file at ./s3-sync.pid
    Logs are written to ./s3-sync.log

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
    log_info "Building S3 sync binary..."
    
    # Initialize go.mod if it doesn't exist
    if [[ ! -f "go.mod" ]]; then
        log_info "Initializing Go module..."
        go mod init s3-sync
    fi
    
    # Get dependencies
    log_info "Getting dependencies..."
    go mod tidy
    
    # Build the binary
    if go build -o s3-sync ./cmd/s3-sync; then
        log_success "Binary built successfully: ./s3-sync"
    else
        log_error "Failed to build binary"
        exit 1
    fi
}

# Stop daemon if running
stop_daemon() {
    local pid_file="./s3-sync.pid"
    
    if [[ -f "$pid_file" ]]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log_info "Stopping S3 sync daemon (PID: $pid)..."
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
    log_info "Looking for running S3 sync processes..."
    
    local pids=$(pgrep -f "s3-sync" | grep -v $$ || true)
    if [[ -n "$pids" ]]; then
        log_info "Killing S3 sync processes: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        log_success "Processes killed"
    else
        log_info "No running S3 sync processes found"
    fi
    
    # Clean up PID file
    rm -f "./s3-sync.pid"
}

# Check daemon status
check_daemon_status() {
    local pid_file="./s3-sync.pid"
    
    if [[ -f "$pid_file" ]]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log_success "S3 sync daemon is running (PID: $pid)"
            return 0
        else
            log_warn "PID file exists but process is not running"
            rm -f "$pid_file"
            return 1
        fi
    else
        log_info "S3 sync daemon is not running"
        return 1
    fi
}

# Run as daemon
run_daemon() {
    local bucket="$1"
    local logs_dir="$2"
    local region="$3"
    local cleanup="$4"
    
    # Check if already running
    if check_daemon_status >/dev/null 2>&1; then
        log_error "Daemon is already running"
        exit 1
    fi
    
    log_info "Starting S3 sync daemon..."
    
    # Build arguments
    local args=()
    [[ "$bucket" != "$DEFAULT_BUCKET" ]] && args+=("-bucket" "$bucket")
    [[ "$logs_dir" != "$DEFAULT_LOGS_DIR" ]] && args+=("-logs" "$logs_dir")
    [[ "$region" != "$DEFAULT_REGION" ]] && args+=("-region" "$region")
    [[ "$cleanup" == "true" ]] && args+=("-cleanup")
    
    # Start daemon
    nohup ./s3-sync "${args[@]}" > s3-sync.log 2>&1 &
    local pid=$!
    
    echo "$pid" > s3-sync.pid
    
    # Check if process started successfully
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
        log_success "Daemon started successfully (PID: $pid)"
        log_info "Logs: tail -f s3-sync.log"
        log_info "Stop: $0 --stop"
    else
        log_error "Failed to start daemon"
        rm -f s3-sync.pid
        exit 1
    fi
}

# Parse arguments
BUCKET="$DEFAULT_BUCKET"
LOGS_DIR="$DEFAULT_LOGS_DIR"
REGION="$DEFAULT_REGION"
CLEANUP="false"
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
        -c|--cleanup)
            CLEANUP="true"
            shift
            ;;
        -o|--once)
            RUN_ONCE="true"
            shift
            ;;
        -d|--daemon)
            DAEMON_MODE="true"
            shift
            ;;
        -s|--stop)
            STOP_DAEMON="true"
            shift
            ;;
        -k|--kill)
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
[[ "${CLEANUP_LOCAL:-}" == "true" ]] && CLEANUP="true"
[[ "${SYNC_ONCE:-}" == "true" ]] && RUN_ONCE="true"

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
echo "RedPanda Load Test - S3 Sync Runner"
echo "═══════════════════════════════════"
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
log_info "  Cleanup Local Files: $CLEANUP"
log_info "  Run Once: $RUN_ONCE"
log_info "  Daemon Mode: $DAEMON_MODE"
echo

# Run the sync
if [[ "$DAEMON_MODE" == "true" ]]; then
    run_daemon "$BUCKET" "$LOGS_DIR" "$REGION" "$CLEANUP"
else
    # Build arguments for direct execution
    args=()
    [[ "$BUCKET" != "$DEFAULT_BUCKET" ]] && args+=("-bucket" "$BUCKET")
    [[ "$LOGS_DIR" != "$DEFAULT_LOGS_DIR" ]] && args+=("-logs" "$LOGS_DIR")
    [[ "$REGION" != "$DEFAULT_REGION" ]] && args+=("-region" "$REGION")
    [[ "$CLEANUP" == "true" ]] && args+=("-cleanup")
    [[ "$RUN_ONCE" == "true" ]] && args+=("-once")
    
    log_info "Starting S3 sync..."
    exec ./s3-sync "${args[@]}"
fi 