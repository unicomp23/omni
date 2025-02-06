#!/bin/bash

port=${1:-2222}  # Default to 2222 if no argument is provided

if [ "$port" != "2222" ] && [ "$port" != "2223" ]; then
    echo "Invalid port. Please use 2222 or 2223."
    exit 1
fi

ssh-keygen -R [localhost]:$port
echo "login password: pwd"
ssh -p $port -o StrictHostKeyChecking=no root@localhost
