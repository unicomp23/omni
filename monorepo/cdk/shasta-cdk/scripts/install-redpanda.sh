#!/bin/bash
set -euo pipefail

# RedPanda Installation Script for Amazon Linux 2023
# Based on official RedPanda documentation: https://github.com/redpanda-data/redpanda

echo "=== RedPanda Installation Script ==="
echo "Installing RedPanda on Amazon Linux 2023..."

# Debug system information
echo "DEBUG: System Information:"
echo "  Hostname: $(hostname)"
echo "  Architecture: $(uname -m)"
echo "  OS Release: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2)"
echo "  Available tools: curl=$(command -v curl || echo 'not found'), wget=$(command -v wget || echo 'not found')"
echo "  Working directory: $(pwd)"
echo "  User: $(whoami)"

# Update system
echo "Updating system packages..."
sudo yum update -y

# Install required dependencies
echo "Installing dependencies..."
# Use --allowerasing to handle curl-minimal conflicts on Amazon Linux 2023
if ! sudo yum install -y --allowerasing curl wget tar gzip util-linux-user; then
    echo "Warning: Failed to install curl, trying without it..."
    sudo yum install -y wget tar gzip util-linux-user
fi

# Install Docker if not already installed
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo yum install -y docker
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -a -G docker ec2-user
fi

# Check if RedPanda is already properly installed
if command -v redpanda &> /dev/null; then
    echo "DEBUG: Found redpanda in PATH, checking if it works..."
    if redpanda --version &> /dev/null; then
        echo "RedPanda is already installed: $(redpanda --version)"
        exit 0
    else
        echo "DEBUG: redpanda command exists but doesn't work, reinstalling..."
        echo "DEBUG: Error output:"
        redpanda --version 2>&1 || echo "Failed to get version"
        
        # Clean up broken installation
        echo "DEBUG: Cleaning up broken installation..."
        sudo rm -f /usr/local/bin/redpanda /usr/local/bin/rpk 2>/dev/null || true
        sudo rm -rf /opt/redpanda 2>/dev/null || true
        
        # Continue with installation to fix the broken installation
    fi
else
    echo "DEBUG: redpanda not found in PATH, proceeding with installation"
fi

# Determine architecture
ARCH=$(uname -m)
case $ARCH in
    x86_64)
        REDPANDA_ARCH="amd64"
        ;;
    aarch64)
        REDPANDA_ARCH="arm64"
        ;;
    *)
        echo "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

# Use Docker-based installation for better compatibility with Amazon Linux 2023
echo "Installing RedPanda via Docker (more reliable on Amazon Linux 2023)..."

cd /tmp

# Clean up any existing files
echo "DEBUG: Cleaning up any existing files..."
rm -f redpanda-*.rpm redpanda-*.tar.gz 2>/dev/null || true

# Install Docker if not running
if ! systemctl is-active --quiet docker; then
    echo "Starting Docker service..."
    sudo systemctl start docker
    # Add ec2-user to docker group if not already added
    sudo usermod -a -G docker ec2-user
fi

# Create RedPanda installation directory
sudo mkdir -p /opt/redpanda/bin
sudo mkdir -p /etc/redpanda

# Use a stable RedPanda version
REDPANDA_VERSION="24.2.7"

echo "Creating RedPanda wrapper scripts..."
# Create redpanda wrapper script
sudo tee /opt/redpanda/bin/redpanda > /dev/null <<'EOF'
#!/bin/bash
# RedPanda Docker wrapper

DOCKER_IMAGE="redpandadata/redpanda:v24.2.7"

# Pull image if not present
if ! docker image inspect "$DOCKER_IMAGE" &>/dev/null; then
    echo "Pulling RedPanda Docker image..."
    docker pull "$DOCKER_IMAGE"
fi

# Run redpanda in container with host networking for cluster formation
exec docker run --rm -i \
    --net=host \
    --pid=host \
    --privileged \
    -v /var/lib/redpanda:/var/lib/redpanda:z \
    -v /etc/redpanda:/etc/redpanda:z \
    -v /var/log/redpanda:/var/log/redpanda:z \
    "$DOCKER_IMAGE" \
    redpanda "$@"
EOF

# Create rpk wrapper script
sudo tee /opt/redpanda/bin/rpk > /dev/null <<'EOF'
#!/bin/bash
# RPK Docker wrapper

DOCKER_IMAGE="redpandadata/redpanda:v24.2.7"

# Pull image if not present
if ! docker image inspect "$DOCKER_IMAGE" &>/dev/null; then
    echo "Pulling RedPanda Docker image..."
    docker pull "$DOCKER_IMAGE"
fi

# Run rpk in container with host networking
exec docker run --rm -i \
    --net=host \
    -v /var/lib/redpanda:/var/lib/redpanda:z \
    -v /etc/redpanda:/etc/redpanda:z \
    -v /var/log/redpanda:/var/log/redpanda:z \
    "$DOCKER_IMAGE" \
    rpk "$@"
EOF

# Make scripts executable
sudo chmod +x /opt/redpanda/bin/redpanda /opt/redpanda/bin/rpk

# Create symlinks for global access
sudo ln -sf /opt/redpanda/bin/redpanda /usr/local/bin/redpanda
sudo ln -sf /opt/redpanda/bin/rpk /usr/local/bin/rpk

echo "✅ RedPanda Docker wrappers created successfully"

# Create redpanda user and group
echo "Creating redpanda user and group..."
if ! id redpanda &>/dev/null; then
    sudo useradd --system --shell /bin/false --home-dir /var/lib/redpanda --create-home redpanda
fi

# Create necessary directories
echo "Creating RedPanda directories..."
sudo mkdir -p /etc/redpanda
sudo mkdir -p /var/lib/redpanda
sudo mkdir -p /var/log/redpanda
sudo chown -R redpanda:redpanda /var/lib/redpanda /var/log/redpanda

# System optimization for low latency
echo "Applying system optimizations..."
sudo tee -a /etc/sysctl.conf > /dev/null <<EOF

# RedPanda Low-Latency Optimizations
net.core.rmem_default = 262144
net.core.rmem_max = 16777216
net.core.wmem_default = 262144
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
vm.swappiness = 1
vm.dirty_ratio = 80
vm.dirty_background_ratio = 5
kernel.numa_balancing = 0
EOF

sudo sysctl -p

# Install RPK (RedPanda Keeper) - the CLI tool
echo "Setting up RPK configuration..."
sudo -u ec2-user mkdir -p /home/ec2-user/.config/rpk

# Set up environment variables
echo "Setting up environment variables..."
sudo tee -a /home/ec2-user/.bashrc > /dev/null <<EOF

# RedPanda Environment Variables
export REDPANDA_HOME=/opt/redpanda
export PATH=\$PATH:/opt/redpanda/bin
export REDPANDA_CONFIG_FILE=/etc/redpanda/redpanda.yaml
EOF

# Clean up
echo "DEBUG: Cleaning up downloaded files..."
ls -la /tmp/redpanda-* 2>/dev/null || echo "No redpanda files to clean"
rm -f /tmp/redpanda-*.tar.gz /tmp/redpanda-*.rpm

# Verify installation
echo "DEBUG: Verifying RedPanda Docker wrapper installation..."
echo "DEBUG: Checking redpanda wrapper script..."
if command -v redpanda &> /dev/null; then
    echo "DEBUG: redpanda found in PATH: $(command -v redpanda)"
    echo "DEBUG: redpanda wrapper script exists and is executable"
else
    echo "ERROR: redpanda not found in PATH"
    exit 1
fi

echo "DEBUG: Checking rpk wrapper script..."
if command -v rpk &> /dev/null; then
    echo "DEBUG: rpk found in PATH: $(command -v rpk)"
    echo "DEBUG: rpk wrapper script exists and is executable"
else
    echo "ERROR: rpk not found in PATH"
    exit 1
fi

echo "DEBUG: Final installation verification..."
echo "  RedPanda wrapper: $(ls -la /usr/local/bin/redpanda)"
echo "  RPK wrapper: $(ls -la /usr/local/bin/rpk)"
echo "  Installation directory: $(ls -la /opt/redpanda/bin/)"

echo "✅ RedPanda Docker wrapper installation completed successfully!"
echo "Note: RedPanda will run in Docker containers for better compatibility"
echo ""
echo "Next steps:"
echo "1. Configure RedPanda using: /usr/local/bin/rpk cluster config"
echo "2. Start RedPanda service"
echo "3. Use RPK CLI for cluster management" 