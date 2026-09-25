#!/usr/bin/env bash
#
# Package the Alfred workflow via Makefile.
#
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

make package
