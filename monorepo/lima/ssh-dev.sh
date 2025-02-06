#!/bin/bash
set -euo pipefail

# Ensure SSH agent is running
if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    eval $(ssh-agent)
fi

# Check if any keys are loaded
if ! ssh-add -l &>/dev/null; then
    echo "Loading SSH keys..."
    ssh-add
fi

# Connect directly to the dev container through Lima's port forwarding
ssh -A -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 root@localhost

# The password is 'pwd' as set in the Dockerfile 