#!/bin/bash

cd ./target.src

# Check if the file extension argument is provided
if [ $# -eq 0 ]; then
  echo "Usage: $0 <file_extension>"
  echo "Example: $0 .ts"
  exit 1
fi

# Get the file extension from the argument
extension="$1"

# Validate the file extension
if [[ ! $extension =~ ^\.[a-zA-Z0-9]+$ ]]; then
  echo "Invalid file extension: $extension"
  echo "File extension must start with a dot and contain only alphanumeric characters."
  exit 1
fi

# Find all files with the specified extension and process each file
find -L . -name "*$extension" -type f -not -path "*/node_modules/*" -print0 | while IFS= read -r -d '' file; do
  # Get the relative file path
  relative_path="${file#./}"

  # Use diff and sed to simulate the file as "new" in udiff format with the correct file path
  diff -u /dev/null "$file" | sed "1s|--- /dev/null|--- /dev/null\n+++ $relative_path|; 2s|^+++ .*$||"

  # Add a newline for readability
  echo ""
done
