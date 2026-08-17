#!/bin/sh
# Feather installer for macOS — downloads the latest release, installs to /Applications,
# and clears the Gatekeeper quarantine flag (the app is open source but not notarized yet).
#   curl -fsSL https://raw.githubusercontent.com/FirasLatrech/feather/main/install.sh | sh
set -e
REPO="FirasLatrech/feather"
ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) SUFFIX="aarch64" ;;
  x86_64)        SUFFIX="x64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac
echo "→ Finding the latest Feather release…"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o "https://[^\"]*Feather_[^\"]*_${SUFFIX}\.dmg" | head -1)
if [ -z "$URL" ]; then
  # Intel build may not exist yet; fall back to any dmg
  URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o "https://[^\"]*\.dmg" | head -1)
fi
[ -n "$URL" ] || { echo "Could not find a download. See https://github.com/$REPO/releases"; exit 1; }
TMP=$(mktemp -d)
echo "→ Downloading $(basename "$URL")…"
curl -fL --progress-bar "$URL" -o "$TMP/Feather.dmg"
echo "→ Installing to /Applications…"
MNT=$(hdiutil attach "$TMP/Feather.dmg" -nobrowse -quiet | grep -o "/Volumes/.*" | head -1)
rm -rf /Applications/Feather.app
cp -R "$MNT/Feather.app" /Applications/
hdiutil detach "$MNT" -quiet || true
rm -rf "$TMP"
# Grant access: remove the quarantine flag so Gatekeeper doesn't report the app as "damaged".
xattr -cr /Applications/Feather.app
echo "✓ Feather installed. Opening…"
open -a /Applications/Feather.app
