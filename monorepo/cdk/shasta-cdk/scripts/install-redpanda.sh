#!/bin/bash
set -euo pipefail

# RedPanda Installation Script for Amazon Linux 2023
# Based on official RedPanda documentation: https://github.com/redpanda-data/redpanda

echo "=== RedPanda Installation Script ==="
echo "Installing RedPanda on Amazon Linux 2023..."

# Update system
echo "Updating system packages..."
sudo yum update -y

# Install required dependencies
echo "Installing dependencies..."
sudo yum install -y curl wget tar gzip util-linux-user

# Install Docker if not already installed
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo yum install -y docker
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -a -G docker ec2-user
fi

# Check if RedPanda is already installed
if command -v redpanda &> /dev/null; then
    echo "RedPanda is already installed: $(redpanda --version)"
    exit 0
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

# Get latest RedPanda version (fallback to 25.1.8 if API fails)
echo "Determining latest RedPanda version..."
REDPANDA_VERSION="25.1.8"
if command -v curl &> /dev/null; then
    LATEST_VERSION=$(curl -s https://api.github.com/repos/redpanda-data/redpanda/releases/latest | grep -o '"tag_name": "v[^"]*"' | cut -d'"' -f4 | sed 's/^v//' || echo "25.1.8")
    if [[ -n "$LATEST_VERSION" ]]; then
        REDPANDA_VERSION="$LATEST_VERSION"
    fi
fi

echo "Installing RedPanda version: $REDPANDA_VERSION"

# Download and install RedPanda from tar.gz
echo "Downloading RedPanda binary..."
REDPANDA_URL="https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/raw/names/redpanda-${REDPANDA_ARCH}/versions/${REDPANDA_VERSION}/redpanda-${REDPANDA_VERSION}-${REDPANDA_ARCH}.tar.gz"

cd /tmp
curl -LO "$REDPANDA_URL"

# Extract to /opt/redpanda
echo "Installing RedPanda to /opt/redpanda..."
sudo mkdir -p /opt/redpanda
sudo tar -xzf "redpanda-${REDPANDA_VERSION}-${REDPANDA_ARCH}.tar.gz" -C /opt/redpanda --strip-components=1

# Create symlinks for global access
echo "Creating symbolic links..."
sudo ln -sf /opt/redpanda/bin/redpanda /usr/local/bin/redpanda
sudo ln -sf /opt/redpanda/bin/rpk /usr/local/bin/rpk

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
rm -f /tmp/redpanda-*.tar.gz

# Verify installation
echo "Verifying RedPanda installation..."
/usr/local/bin/redpanda --version
/usr/local/bin/rpk version

echo "✅ RedPanda installation completed successfully!"
echo "Version: $(/usr/local/bin/redpanda --version)"
echo ""
echo "Next steps:"
echo "1. Configure RedPanda using: /usr/local/bin/rpk cluster config"
echo "2. Start RedPanda service"
echo "3. Use RPK CLI for cluster management" 