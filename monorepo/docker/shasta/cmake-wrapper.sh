#!/bin/bash
# Wrapper script to use system CMake
if [ -x /usr/bin/cmake ]; then
    exec /usr/bin/cmake "$@"
else
    echo "Error: /usr/bin/cmake not found or not executable" >&2
    exit 1
fi 