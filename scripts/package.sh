#!/bin/bash

# Flyover GPX Packaging Script
# This script creates a production-ready WordPress plugin ZIP.

set -e

# Change to project root (one level up from this script)
cd "$(dirname "$0")/.."

# Configuration
PLUGIN_NAME="flyover-gpx"
MAIN_FILE="flyover-gpx/flyover-gpx.php"
DIST_DIR="dist"
STAGING_DIR="staging_build"

echo "📦 Packaging $PLUGIN_NAME..."

# 1. Extract and SANITIZE version from main plugin file
VERSION=$(grep -m 1 "Version:" "$MAIN_FILE" \
    | sed -E 's/.*Version:[[:space:]]*//' \
    | tr -cd '0-9A-Za-z._-')

if [ -z "$VERSION" ]; then
    echo "❌ Could not find valid version in $MAIN_FILE"
    exit 1
fi

echo "🔹 Version: $VERSION"

# Ask for optimization
read -p "❓ Do you want to optimize/minify JavaScript files? (y/N) " OPTIMIZE_JS
OPTIMIZE_JS=${OPTIMIZE_JS:-n}

# 2. Cleanup old builds
echo "🧹 Cleaning up..."
rm -rf "$DIST_DIR" "$STAGING_DIR"
mkdir -p "$DIST_DIR" "$STAGING_DIR/$PLUGIN_NAME"

# 3. Copy files to staging
echo "📂 Staging files..."
if command -v rsync >/dev/null 2>&1; then
    rsync -am \
        --exclude='node_modules' \
        --exclude='tests' \
        --exclude='vendor' \
        --exclude='.git*' \
        flyover-gpx/ "$STAGING_DIR/$PLUGIN_NAME/"
else
    cp -r flyover-gpx/* "$STAGING_DIR/$PLUGIN_NAME/"
fi

# 4. Install production dependencies
echo "🚚 Installing production dependencies..."
cd "$STAGING_DIR/$PLUGIN_NAME"

if command -v composer >/dev/null 2>&1; then
    composer install \
        --no-dev \
        --optimize-autoloader \
        --no-interaction \
        --prefer-dist \
        --ignore-platform-reqs
else
    echo "❌ Composer not found. Please install composer."
    exit 1
fi

cd ../..

# 5. Remove unnecessary files
echo "✂️ Removing development artifacts..."
rm -rf \
    "$STAGING_DIR/$PLUGIN_NAME/tests" \
    "$STAGING_DIR/$PLUGIN_NAME/node_modules"

rm -f \
    "$STAGING_DIR/$PLUGIN_NAME/phpunit.xml.dist" \
    "$STAGING_DIR/$PLUGIN_NAME/jest.config.js" \
    "$STAGING_DIR/$PLUGIN_NAME/package.json" \
    "$STAGING_DIR/$PLUGIN_NAME/package-lock.json" \
    "$STAGING_DIR/$PLUGIN_NAME/composer.json" \
    "$STAGING_DIR/$PLUGIN_NAME/composer.lock"

find "$STAGING_DIR/$PLUGIN_NAME/vendor" -type d \
    \( -iname "test" -o -iname "tests" \) \
    -exec rm -rf {} + 2>/dev/null || true

# 6. Optimize JS & CSS (optional)
if [[ "$OPTIMIZE_JS" =~ ^[Yy]$ ]]; then
    echo "⚡ Optimizing assets..."

    JS_DIR="$STAGING_DIR/$PLUGIN_NAME/assets/js"
    CSS_DIR="$STAGING_DIR/$PLUGIN_NAME/assets/css"

    if [ -d "$JS_DIR" ]; then
        for f in "$JS_DIR"/*.js; do
            [ -f "$f" ] || continue
            echo "  - Minifying JS: $(basename "$f")"
            npx terser "$f" --compress --mangle -o "$f"
        done
    fi

    if [ -d "$CSS_DIR" ]; then
        for f in "$CSS_DIR"/*.css; do
            [ -f "$f" ] || continue
            echo "  - Minifying CSS: $(basename "$f")"
            sed -i 's/\/\*.*\*\///g' "$f"
            sed -i ':a;N;$!ba;s/\n/ /g' "$f"
            sed -i 's/ \+/ /g' "$f"
            sed -i 's/ *[:;{}] */\0/g' "$f"
        done
    fi
fi

# 7. Create ZIP (robust, CRLF & Unicode safe)
ZIP_FILE="$DIST_DIR/$PLUGIN_NAME-$VERSION.zip"
echo "🗜️ Creating ZIP: $ZIP_FILE..."

cd "$STAGING_DIR"

python3 - "$ZIP_FILE" "$PLUGIN_NAME" <<'EOF'
import os
import sys
import zipfile

zip_file = sys.argv[1]
plugin_dir = sys.argv[2]

zip_path = os.path.join("..", zip_file)

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk(plugin_dir):
        for name in files:
            path = os.path.join(root, name)
            zf.write(path, arcname=path)
EOF

cd ..

# 8. Cleanup
rm -rf "$STAGING_DIR"

echo "✅ Done! Package created at $ZIP_FILE"