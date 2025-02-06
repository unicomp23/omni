#!/bin/bash

# Check if environment variables are set, if not, prompt for them
if [ -z "$SUMO_ACCESS_ID" ]; then
    echo "SUMO_ACCESS_ID is not set. You will be prompted for it when running the script."
fi

if [ -z "$SUMO_ACCESS_KEY" ]; then
    echo "SUMO_ACCESS_KEY is not set. You will be prompted for it when running the script."
fi

# Run the Deno script
deno run --allow-read --allow-write --allow-net --allow-env main.ts
