#!/bin/bash

# Flyover GPX Cleanup Script
# This script removes build artifacts and temporary staging directories.

# Exit on error
set -e

# Change to project root
cd "$(dirname "$0")/.."

echo "🧹 Cleaning up build artifacts..."

# Remove dist directory
if [ -d "dist" ]; then
    echo "  - Removing dist/"
    rm -rf dist
fi

# Remove staging directories
if [ -d "staging_build" ]; then
    echo "  - Removing staging_build/"
    rm -rf staging_build
fi

# Optional: remove local log files if they exist
if [ -d "flyover-gpx/logs" ]; then
    echo "  - Removing local logs/"
    rm -rf flyover-gpx/logs
fi

echo "✅ Cleanup complete."
