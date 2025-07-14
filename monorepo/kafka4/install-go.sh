#!/bin/bash

# Go Installation Script
# ======================
# This script installs the latest stable version of Go
#
# Features:
# - Detects system architecture automatically
# - Downloads and installs the latest Go version
# - Sets up GOROOT, GOPATH, and PATH environment variables
# - Backs up existing .bashrc before making changes
# - Verifies installation with a test program
# - Handles existing Go installations gracefully
# - Works with or without sudo privileges
#
# Usage:
#   ./install-go.sh                 # Install latest Go
#   make install-go                 # Install via Makefile
#   make setup                      # Complete setup (Go + dependencies)

set -e  # Exit on any error

# Configuration
GO_VERSION="1.23.4"  # Default stable version
GO_ARCH="linux-amd64"  # Default architecture
INSTALL_DIR="/usr/local"
GO_TAR="go${GO_VERSION}.${GO_ARCH}.tar.gz"
GO_URL="https://golang.org/dl/${GO_TAR}"
USER_HOME="${HOME}"
SHELL_RC="${USER_HOME}/.bashrc"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to detect architecture
detect_arch() {
    local arch=$(uname -m)
    case $arch in
        x86_64)
            echo "linux-amd64"
            ;;
        aarch64|arm64)
            echo "linux-arm64"
            ;;
        armv6l)
            echo "linux-armv6l"
            ;;
        *)
            log_error "Unsupported architecture: $arch"
            exit 1
            ;;
    esac
}

# Function to get latest Go version
get_latest_go_version() {
    local latest_version
    
    # Try multiple methods to get the latest version
    latest_version=$(curl -s "https://golang.org/VERSION?m=text" 2>/dev/null | head -1)
    
    # Check if we got a valid version (should start with 'go')
    if [[ -n "$latest_version" && "$latest_version" =~ ^go[0-9] ]]; then
        echo "${latest_version#go}"  # Remove 'go' prefix
    else
        # Try alternative method
        latest_version=$(curl -s "https://go.dev/VERSION?m=text" 2>/dev/null | head -1)
        if [[ -n "$latest_version" && "$latest_version" =~ ^go[0-9] ]]; then
            echo "${latest_version#go}"  # Remove 'go' prefix
        else
            # Try GitHub API as fallback
            latest_version=$(curl -s "https://api.github.com/repos/golang/go/releases/latest" 2>/dev/null | grep -o '"tag_name": "[^"]*' | grep -o '[^"]*$')
            if [[ -n "$latest_version" && "$latest_version" =~ ^go[0-9] ]]; then
                echo "${latest_version#go}"  # Remove 'go' prefix
            else
                log_warning "Could not fetch latest Go version, using default: $GO_VERSION"
                echo "$GO_VERSION"
            fi
        fi
    fi
}

# Function to check if Go is already installed
check_existing_go() {
    if command -v go >/dev/null 2>&1; then
        local current_version=$(go version | awk '{print $3}' | sed 's/go//')
        log_info "Go is already installed: version $current_version"
        
        if [[ "$current_version" == "$GO_VERSION" ]]; then
            log_success "Go $GO_VERSION is already installed and up to date"
            return 0
        else
            log_warning "Go $current_version is installed, but $GO_VERSION is available"
            read -p "Do you want to upgrade to Go $GO_VERSION? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Keeping existing Go installation"
                return 0
            fi
        fi
    fi
    return 1
}

# Function to remove existing Go installation
remove_existing_go() {
    log_info "Removing existing Go installation..."
    if [[ -d "$INSTALL_DIR/go" ]]; then
        if [[ $EUID -eq 0 ]]; then
            rm -rf "$INSTALL_DIR/go"
        else
            sudo rm -rf "$INSTALL_DIR/go"
        fi
        log_success "Removed existing Go installation"
    fi
}

# Function to download and install Go
install_go() {
    log_info "Starting Go installation..."
    
    # Detect architecture
    GO_ARCH=$(detect_arch)
    GO_TAR="go${GO_VERSION}.${GO_ARCH}.tar.gz"
    GO_URL="https://golang.org/dl/${GO_TAR}"
    
    log_info "Detected architecture: $GO_ARCH"
    log_info "Installing Go $GO_VERSION..."
    
    # Create temporary directory
    local temp_dir=$(mktemp -d)
    cd "$temp_dir"
    
    # Download Go
    log_info "Downloading Go from $GO_URL..."
    if ! curl -LO "$GO_URL"; then
        log_error "Failed to download Go"
        exit 1
    fi
    
    # Verify download
    if [[ ! -f "$GO_TAR" ]]; then
        log_error "Download failed: $GO_TAR not found"
        exit 1
    fi
    
    # Remove existing installation
    remove_existing_go
    
    # Extract Go
    log_info "Extracting Go to $INSTALL_DIR..."
    if [[ $EUID -eq 0 ]]; then
        tar -C "$INSTALL_DIR" -xzf "$GO_TAR"
    else
        sudo tar -C "$INSTALL_DIR" -xzf "$GO_TAR"
    fi
    
    # Cleanup
    cd /
    rm -rf "$temp_dir"
    
    log_success "Go extracted successfully"
}

# Function to setup environment
setup_environment() {
    log_info "Setting up Go environment..."
    
    # Setup Go paths
    local go_root="$INSTALL_DIR/go"
    local go_path="$USER_HOME/go"
    
    # Backup existing shell rc
    if [[ -f "$SHELL_RC" ]]; then
        cp "$SHELL_RC" "$SHELL_RC.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Remove existing Go paths from shell rc
    if [[ -f "$SHELL_RC" ]]; then
        grep -v "# Go environment" "$SHELL_RC" > "$SHELL_RC.tmp" || true
        grep -v "export GOROOT=" "$SHELL_RC.tmp" > "$SHELL_RC.tmp2" || true
        grep -v "export GOPATH=" "$SHELL_RC.tmp2" > "$SHELL_RC.tmp3" || true
        grep -v "export PATH.*go/bin" "$SHELL_RC.tmp3" > "$SHELL_RC.tmp4" || true
        mv "$SHELL_RC.tmp4" "$SHELL_RC"
        rm -f "$SHELL_RC.tmp" "$SHELL_RC.tmp2" "$SHELL_RC.tmp3" 2>/dev/null || true
    fi
    
    # Add Go environment to shell rc
    cat >> "$SHELL_RC" << EOF

# Go environment
export GOROOT=$go_root
export GOPATH=$go_path
export PATH=\$GOROOT/bin:\$GOPATH/bin:\$PATH
EOF
    
    # Create GOPATH directory
    mkdir -p "$go_path"
    
    log_success "Go environment configured in $SHELL_RC"
}

# Function to verify installation
verify_installation() {
    log_info "Verifying Go installation..."
    
    # Source the shell rc to get the new PATH
    export GOROOT="$INSTALL_DIR/go"
    export GOPATH="$USER_HOME/go"
    export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"
    
    # Test Go installation
    if command -v go >/dev/null 2>&1; then
        local installed_version=$(go version)
        log_success "Go installed successfully: $installed_version"
        
        # Test Go functionality
        log_info "Testing Go functionality..."
        local test_dir=$(mktemp -d)
        cd "$test_dir"
        
        # Create a simple test program
        cat > hello.go << 'EOF'
package main

import "fmt"

func main() {
    fmt.Println("Hello, Go!")
}
EOF
        
        # Test compilation and execution
        if go run hello.go > /dev/null 2>&1; then
            log_success "Go is working correctly"
        else
            log_error "Go installation verification failed"
            exit 1
        fi
        
        # Cleanup
        cd /
        rm -rf "$test_dir"
        
        # Show Go environment
        log_info "Go environment:"
        echo "  GOROOT: $GOROOT"
        echo "  GOPATH: $GOPATH"
        echo "  Go version: $(go version)"
        
    else
        log_error "Go installation failed - go command not found"
        exit 1
    fi
}

# Main installation function
main() {
    log_info "Go Installation Script"
    log_info "====================="
    
    # Check if running as root
    if [[ $EUID -eq 0 ]]; then
        log_warning "Running as root. Go will be installed system-wide."
    else
        log_info "Running as regular user. May require sudo for system installation."
    fi
    
    # Get latest Go version
    if command -v curl >/dev/null 2>&1; then
        latest_version=$(get_latest_go_version)
        if [[ "$latest_version" != "$GO_VERSION" ]]; then
            log_info "Latest Go version available: $latest_version"
            GO_VERSION="$latest_version"
        fi
    else
        log_warning "curl not found, using default Go version: $GO_VERSION"
    fi
    
    # Check for existing installation
    if check_existing_go; then
        log_success "Go installation is already up to date"
        exit 0
    fi
    
    # Install Go
    install_go
    
    # Setup environment
    setup_environment
    
    # Verify installation
    verify_installation
    
    log_success "Go installation completed successfully!"
    log_info "Please run 'source ~/.bashrc' or restart your terminal to use Go"
    log_info "Or run: export PATH=$INSTALL_DIR/go/bin:\$PATH"
}

# Run main function
main "$@" 