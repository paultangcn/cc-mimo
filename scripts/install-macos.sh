#!/bin/bash
# Installs claudex-shim as a per-user launchd service (starts at login, restarts if it dies).
# Usage: scripts/install-macos.sh            install / reinstall
#        scripts/install-macos.sh --uninstall
set -euo pipefail

LABEL="claudex.shim"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${CLAUDEX_SHIM_CONFIG:-$HOME/.config/claudex/shim.json}"
LOG="$HOME/Library/Logs/claudex-shim.log"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "claudex-shim uninstalled (config left at $CONFIG)"
  exit 0
fi

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found in PATH" >&2; exit 1; }

if [ ! -f "$CONFIG" ]; then
  mkdir -p "$(dirname "$CONFIG")"
  cp "$REPO/examples/shim.json" "$CONFIG"
  echo "created $CONFIG from examples/shim.json - edit it (upstream key, native search provider), then rerun this script"
  exit 0
fi

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$REPO/shim/server.js</string></array>
  <key>EnvironmentVariables</key><dict><key>CLAUDEX_SHIM_CONFIG</key><string>$CONFIG</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 1
tail -1 "$LOG"
