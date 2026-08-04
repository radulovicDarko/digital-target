#!/usr/bin/env bash
# Build Arduino sketch for Wokwi simulation.
# Run from this folder: ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
arduino-cli compile --fqbn arduino:avr:uno --output-dir build sketch/sketch.ino
echo "OK -> build/sketch.ino.hex"
