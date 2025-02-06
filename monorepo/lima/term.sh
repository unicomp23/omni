#!/bin/bash
set -euo pipefail

# Ensure SSH agent is running and has keys
if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    eval $(ssh-agent)
fi

# Check if any keys are loaded
if ! ssh-add -l &>/dev/null; then
    echo "Loading SSH keys..."
    ssh-add
fi

# Connect to Lima VM with SSH agent forwarding
limactl shell default 

# Added GitHub SSH connection test
echo "Testing GitHub SSH connection..."
ssh -T git@github.com || true 