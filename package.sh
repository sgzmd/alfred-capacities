#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Get directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "Packaging Alfred Workflow..."

OUTPUT_NAME="Capacities_Quick_Capture.alfredworkflow"

# Build output must exist before packaging.
if [ ! -f "dist/info.plist" ] || [ ! -f "dist/daily-note.js" ] || [ ! -f "dist/capture.js" ]; then
    echo "Build output is missing. Run npm run build first." >&2
    exit 1
fi

# Remove existing build if it exists
if [ -f "$OUTPUT_NAME" ]; then
    rm "$OUTPUT_NAME"
fi

# Create an archive containing only production workflow components.
(
    cd dist
    zip -q "../$OUTPUT_NAME" \
        info.plist \
        icon.png \
        daily-note.js \
        daily-log.js \
        capture.js \
        capacities-worker.js
)

echo "Successfully created: $OUTPUT_NAME"
