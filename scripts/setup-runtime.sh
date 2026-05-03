#!/bin/bash

# Flyover GPX Runtime Setup Script
# This script installs ONLY production dependencies in the plugin directory.

# Exit on error
set -e

# Change to project root
cd "$(dirname "$0")/.."

PLUGIN_DIR="flyover-gpx"

echo "🚚 Setting up production runtime dependencies in $PLUGIN_DIR..."

if [ ! -d "$PLUGIN_DIR" ]; then
    echo "❌ Plugin directory $PLUGIN_DIR not found."
    exit 1
fi

cd "$PLUGIN_DIR"

if command -v composer >/dev/null 2>&1; then
    echo "  - Running composer install --no-dev..."
    composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist --ignore-platform-reqs
else
    echo "❌ Composer not found. Please install composer."
    exit 1
fi

echo "✅ Runtime dependencies installed (no-dev)."
