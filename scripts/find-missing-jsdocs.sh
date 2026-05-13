#!/bin/bash
# Scans frontend JS scripts for functions missing JSDoc method descriptions
# Lists files and function names without JSDoc

set -e

# Directory to scan
JS_DIR="$(dirname "$0")/../flyover-gpx/assets/js"

# Find all .js files in the frontend assets directory
find "$JS_DIR" -type f -name '*.js' | while read -r file; do
  # Use awk to find function definitions not immediately preceded by a JSDoc comment
  awk '
    # Store a rolling buffer of the last 5 lines
    {
      for (i=4; i>=1; i--) prev[i]=prev[i-1];
      prev[0]=$0;
    }

    # Helper: check if any of the last 4 lines (above) start a JSDoc block
    function has_jsdoc() {
      for (i=1; i<=4; i++) {
        if (prev[i] ~ /\/\*\*/) return 1;
        if (prev[i] ~ /\*\//) break; # Stop if we hit end of another block
      }
      return 0;
    }

    /^[ \t]*function[ \t]+[a-zA-Z0-9_]+[ \t]*\(/ {
      if (!has_jsdoc()) {
        match($0, /function[ \t]+([a-zA-Z0-9_]+)/, arr);
        if (arr[1] != "") {
          print FILENAME ":" NR ": function " arr[1];
        }
      }
    }
    /^[ \t]*[a-zA-Z0-9_]+[ \t]*=[ \t]*function[ \t]*\(/ {
      if (!has_jsdoc()) {
        match($0, /([a-zA-Z0-9_]+)[ \t]*=[ \t]*function/, arr);
        if (arr[1] != "") {
          print FILENAME ":" NR ": function " arr[1];
        }
      }
    }
    /^[ \t]*[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+[ \t]*=[ \t]*function[ \t]*\(/ {
      if (!has_jsdoc()) {
        match($0, /([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)[ \t]*=[ \t]*function/, arr);
        if (arr[1] != "") {
          print FILENAME ":" NR ": function " arr[1];
        }
      }
    }
  ' "$file"
done
