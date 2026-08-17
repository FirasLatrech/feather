#!/bin/sh
# Builds feather-cli in release mode and places it where Tauri's externalBin expects it.
set -e
cd "$(dirname "$0")/../src-tauri"
TRIPLE=$(rustc -vV | sed -n 's/host: //p')
mkdir -p binaries
EXT=""; case "$TRIPLE" in *windows*) EXT=".exe";; esac
# tauri-build checks that externalBin exists even when building the CLI itself → placeholder first.
[ -e "binaries/feather-cli-$TRIPLE$EXT" ] || : > "binaries/feather-cli-$TRIPLE$EXT"
cargo build --release --bin feather-cli
cp -f "target/release/feather-cli$EXT" "binaries/feather-cli-$TRIPLE$EXT" && chmod +x "binaries/feather-cli-$TRIPLE$EXT"
echo "feather-cli → binaries/feather-cli-$TRIPLE$EXT"
