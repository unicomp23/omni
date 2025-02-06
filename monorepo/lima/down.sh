#!/bin/bash
set -euo pipefail

# Check if VM exists
if limactl list | grep -q "default"; then
    echo "Stopping Lima VM..."
    limactl stop default
    echo "Removing Lima VM..."
    limactl delete default
    echo "Lima VM cleaned up"
else
    echo "No Lima VM found"
fi 