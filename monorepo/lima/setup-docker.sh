#!/bin/bash
set -euo pipefail

# Enable debug logging
exec 1> >(tee -a "/tmp/docker-setup.log") 2>&1
echo "Starting Docker setup at $(date)"

# Update package list
sudo apt-get update

# Install dependencies
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    apt-transport-https

# Ensure directories exist
sudo install -m 0755 -d /etc/apt/keyrings

# Add Docker's official GPG key with retry logic
for i in {1..3}; do
    echo "Attempting to download Docker GPG key (attempt $i/3)..."
    if curl -fsSL --retry 2 --retry-delay 1 https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg; then
        echo "Successfully downloaded GPG key"
        break
    fi
    if [ $i -eq 3 ]; then
        echo "Failed to download Docker GPG key after 3 attempts"
        exit 1
    fi
    sleep 2
done

sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update package list again
sudo apt-get update || {
    echo "Failed to update package list"
    exit 1
}

# Remove any existing Docker installations
sudo apt-get remove -y docker docker-engine docker.io containerd runc || true

# Install Docker packages
sudo apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

# Configure Docker daemon
sudo mkdir -p /etc/docker
cat << EOF | sudo tee /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

# Stop all Docker-related services
sudo systemctl stop docker.socket docker.service containerd || true
sudo rm -f /var/run/docker.pid /var/run/docker-containerd.pid || true

# Start containerd and Docker
sudo systemctl start containerd || {
    echo "Failed to start containerd"
    sudo systemctl status containerd
    exit 1
}

sudo systemctl start docker || {
    echo "Failed to start Docker"
    sudo systemctl status docker
    exit 1
}

# Wait for Docker to be ready
echo "Waiting for Docker to start..."
for i in {1..10}; do
    if sudo docker info >/dev/null 2>&1; then
        echo "Docker is ready!"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "Docker failed to start after 10 attempts"
        echo "Docker service status:"
        sudo systemctl status docker
        echo "Docker daemon logs:"
        sudo journalctl -xeu docker
        exit 1
    fi
    echo "Waiting for Docker... ($i/10)"
    sleep 2
done

# Add current user to docker group
sudo usermod -aG docker $USER

# Test Docker installation
echo "Testing Docker installation..."
sudo docker run --rm hello-world

echo "Docker installation complete!" 