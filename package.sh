#!/usr/bin/env bash
#
# Package the Alfred workflow into a .alfredworkflow zip. Runs unit tests
# first; optionally runs the live e2e smoke test if a token is set.

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

OUTPUT_NAME="Capacities_Quick_Capture.alfredworkflow"

echo "→ node --test test/"
node --test 'test/*.test.js'

if [ -n "$CAPACITIES_TOKEN" ] && [ "${SKIP_E2E:-0}" != "1" ]; then
    echo "→ node scripts/e2e.js"
    node scripts/e2e.js
elif [ "${SKIP_E2E:-0}" != "1" ]; then
    echo "  (skipping e2e — set CAPACITIES_TOKEN to a test-space token to run it, or SKIP_E2E=1 to silence)"
fi

echo "→ Packaging Alfred workflow..."

# Remove existing build if it exists
if [ -f "$OUTPUT_NAME" ]; then
    rm "$OUTPUT_NAME"
fi

# Files that must land inside the .alfredworkflow. Anything not listed here is
# not shipped — keep tests, scripts, and dev-only files out.
zip -q -r "$OUTPUT_NAME" \
    info.plist \
    icon.png \
    jxa-bootstrap.js \
    runner.js \
    ops.js \
    flows.js \
    transport/jxa.js \
    send_to_daily_note.js \
    setup.js \
    log.js

echo "Successfully created: $OUTPUT_NAME"
