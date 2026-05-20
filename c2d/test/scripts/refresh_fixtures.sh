#!/bin/bash
# Copies the proof artefacts from the offchain circuit into the test fixtures
# directory, where the test can read them.
#
# Run this whenever the offchain circuit is rebuilt and re-proved.
#
# Usage: from c2d/test/, run `bash scripts/refresh_fixtures.sh`.

set -e

CIRCUIT_DIR="$(cd "$(dirname "$0")/../../offchain-circuit" && pwd)"
FIXTURES_DIR="$(cd "$(dirname "$0")/../fixtures" && pwd)"

if [ ! -d "$CIRCUIT_DIR/target/proof" ]; then
  echo "Error: $CIRCUIT_DIR/target/proof does not exist."
  echo "Run nargo execute and bb prove first; see c2d/README.md."
  exit 1
fi

cp "$CIRCUIT_DIR/target/proof/proof.json"          "$FIXTURES_DIR/proof.json"
cp "$CIRCUIT_DIR/target/proof/vk.json"             "$FIXTURES_DIR/vk.json"
cp "$CIRCUIT_DIR/target/proof/public_inputs.json"  "$FIXTURES_DIR/public_inputs.json"

echo "Copied proof artefacts into $FIXTURES_DIR/"
ls -la "$FIXTURES_DIR/"