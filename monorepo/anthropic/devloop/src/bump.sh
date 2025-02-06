#!/bin/bash

# Directory where the file will be moved
target_dir="./history"

# Check if the target directory exists, create it if it doesn't
if [ ! -d "$target_dir" ]; then
    mkdir -p "$target_dir"
fi

# Get the current time in milliseconds since the epoch and pad it to 20 digits
epoch_millis=$(printf "%020d" $(date +%s%3N))

# Construct the new filename with the padded epoch milliseconds
new_filename="${target_dir}/ai.log.${epoch_millis}.txt"

# Move and rename the file
mv ai.log.txt "$new_filename"

echo "File moved to $new_filename"
