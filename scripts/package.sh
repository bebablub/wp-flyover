#!/bin/bash

# Flyover GPX Packaging Script
# This script creates a production-ready WordPress plugin ZIP.

# Exit on error
set -e

# Change to project root (one level up from this script)
cd "$(dirname "$0")/.."

# Configuration
PLUGIN_NAME="flyover-gpx"
MAIN_FILE="flyover-gpx/flyover-gpx.php"
DIST_DIR="dist"
STAGING_DIR="staging_build"

echo "📦 Packaging $PLUGIN_NAME..."

# 1. Extract version from main plugin file
VERSION=$(grep -m 1 "Version:" "$MAIN_FILE" | awk '{print $NF}')
if [ -z "$VERSION" ]; then
    echo "❌ Could not find version in $MAIN_FILE"
    exit 1
fi
echo "🔹 Version: $VERSION"

# 2. Cleanup old builds
echo "🧹 Cleaning up..."
rm -rf "$DIST_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$DIST_DIR"
mkdir -p "$STAGING_DIR/$PLUGIN_NAME"

# 3. Copy files to staging
echo "📂 Staging files..."
# Use rsync if available, otherwise cp. Exclude obvious dev stuff.
if command -v rsync >/dev/null 2>&1; then
    rsync -am --exclude='node_modules' --exclude='tests' --exclude='vendor' --exclude='.git*' flyover-gpx/ "$STAGING_DIR/$PLUGIN_NAME/"
else
    cp -r flyover-gpx/* "$STAGING_DIR/$PLUGIN_NAME/"
fi

# 4. Install production dependencies
echo "🚚 Installing production dependencies..."
cd "$STAGING_DIR/$PLUGIN_NAME"
if command -v composer >/dev/null 2>&1; then
    composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist --ignore-platform-reqs
else
    echo "❌ Composer not found. Please install composer to package production dependencies."
    exit 1
fi
cd ../..

# 5. Remove unnecessary files from staging
echo "✂️ Removing development artifacts..."
rm -rf "$STAGING_DIR/$PLUGIN_NAME/tests"
rm -rf "$STAGING_DIR/$PLUGIN_NAME/node_modules"
rm -f  "$STAGING_DIR/$PLUGIN_NAME/phpunit.xml.dist"
rm -f  "$STAGING_DIR/$PLUGIN_NAME/jest.config.js"
rm -f  "$STAGING_DIR/$PLUGIN_NAME/package.json"
rm -f  "$STAGING_DIR/$PLUGIN_NAME/package-lock.json"
rm -f  "$STAGING_DIR/$PLUGIN_NAME/composer.json"
rm -f  "$STAGING_DIR/$PLUGIN_NAME/composer.lock"

# Remove test directories from vendor
find "$STAGING_DIR/$PLUGIN_NAME/vendor" -type d \( -name "tests" -o -name "test" -o -name "Tests" -o -name "Test" \) -exec rm -rf {} + 2>/dev/null || true

# 6. Create ZIP
ZIP_FILE="$DIST_DIR/$PLUGIN_NAME-$VERSION.zip"
echo "🗜️ Creating ZIP: $ZIP_FILE..."

# Use python3 to create zip as a fallback for missing 'zip' command
cd "$STAGING_DIR"
python3 -c "import os, zipfile; 
with zipfile.ZipFile('../$ZIP_FILE', 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk('$PLUGIN_NAME'):
        for file in files:
            path = os.path.join(root, file)
            zf.write(path)"
cd ..

# 7. Cleanup staging
rm -rf "$STAGING_DIR"

echo "✅ Done! Package created at $ZIP_FILE"
