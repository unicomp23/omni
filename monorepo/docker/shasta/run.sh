#!/bin/bash
set -euo pipefail

# Ensure SSH agent is running
if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    eval $(ssh-agent)
    export SSH_AUTH_SOCK
fi

# Start the containers with build
docker-compose up -d --build

echo "Development environment is ready!"
echo "You can connect using: ssh -p 2222 root@localhost"
