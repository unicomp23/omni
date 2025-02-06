#!/bin/bash
set -euo pipefail

# Check if Lima VM exists
if ! limactl list | grep -q "default"; then
    echo "Creating new Lima VM..."
    limactl create --name=default default.yaml
    
    # Wait for VM to be ready
    echo "Waiting for VM to be ready..."
    limactl start default
    
    # Wait for services to initialize
    echo "Waiting for services to initialize..."
    sleep 15
    
    # Test network connectivity with retry
    echo "Testing network connectivity..."
    for i in {1..5}; do
        if limactl shell default ping -c 1 google.com >/dev/null 2>&1; then
            echo "Network is ready!"
            break
        fi
        if [ $i -eq 5 ]; then
            echo "Network connectivity test failed after 5 attempts"
            exit 1
        fi
        echo "Waiting for network... ($i/5)"
        sleep 2
    done
    
    # Setup Docker in the VM with error handling
    echo "Setting up Docker in VM..."
    if ! limactl shell default < setup-docker.sh; then
        echo "Docker setup failed. Check /tmp/docker-setup.log in the VM for details."
        echo "You can connect to the VM using: limactl shell default"
        exit 1
    fi
else
    echo "Starting existing Lima VM..."
    limactl start default
    
    # Wait for services to start
    echo "Waiting for services to initialize..."
    sleep 5
fi

# Wait for Docker to be ready with better error handling
echo "Waiting for Docker to be ready..."
for i in {1..10}; do
    if limactl shell default sudo docker info >/dev/null 2>&1; then
        echo "Docker is ready!"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "Docker failed to start. Checking Docker service status..."
        limactl shell default "sudo systemctl status docker && sudo journalctl -xeu docker"
        exit 1
    fi
    echo "Waiting for Docker... ($i/10)"
    sleep 2
done

echo "Lima VM is ready!"