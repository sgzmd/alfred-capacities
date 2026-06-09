#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Get directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "Packaging Alfred Workflow..."

OUTPUT_NAME="Capacities_Quick_Capture.alfredworkflow"

# Remove existing build if it exists
if [ -f "$OUTPUT_NAME" ]; then
    rm "$OUTPUT_NAME"
fi

# Create zip archive containing only the necessary workflow components
zip -q -r "$OUTPUT_NAME" info.plist icon.png list_spaces.js send_to_daily_note.js

echo "Successfully created: $OUTPUT_NAME"
