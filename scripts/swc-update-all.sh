#!/usr/bin/env bash

# This bumps all swc crates in Cargo.lock to the latest version.
# Before, update the swc_core version range in all Cargo.tomls to the latest version.

set -eu

echo "Listing all swc crates"

swc_crates=$(cargo metadata --format-version=1 --all-features | jq '.packages .[] | select(.repository == "https://github.com/swc-project/swc.git" or .repository == "https://github.com/swc-project/plugins.git") | .name' -r)

command="cargo update"
for crate in $swc_crates; do
  command="$command -p $crate"
done

echo "Running: $command"
eval $command
