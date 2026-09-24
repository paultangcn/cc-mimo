#!/bin/bash
# Installs cc-mimo on macOS:
#   - cc-mimo-shim as a per-user launchd service (starts at login, restarts if it dies)
#   - the `ccmimo` command into ~/.local/bin
#   - starter configs in ~/.config/cc-mimo/ (never overwritten)
# Usage: scripts/install-macos.sh | scripts/install-macos.sh --uninstall
set -euo pipefail

LABEL="cc-mimo.shim"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CONF_DIR="$HOME/.config/cc-mimo"
SHIM_CONFIG="${CCMIMO_SHIM_CONFIG:-$CONF_DIR/shim.json}"
LOG="$HOME/Library/Logs/cc-mimo-shim.log"
BIN="$HOME/.local/bin/ccmimo"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  [ -L "$BIN" ] && rm -f "$BIN"
  echo "cc-mimo uninstalled (configs left in $CONF_DIR)"
  exit 0
fi

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found in PATH" >&2; exit 1; }

mkdir -p "$CONF_DIR" "$(dirname "$BIN")"
created=0
[ -f "$SHIM_CONFIG" ] || { cp "$REPO/examples/shim.json" "$SHIM_CONFIG"; echo "created $SHIM_CONFIG"; created=1; }
[ -f "$CONF_DIR/config.sh" ] || { cp "$REPO/examples/config.sh" "$CONF_DIR/config.sh"; echo "created $CONF_DIR/config.sh"; created=1; }
if [ "$created" = 1 ]; then
  echo "edit the file(s) above (gateway client key, MiMo provider), then rerun this script"
  exit 0
fi

ln -sf "$REPO/bin/ccmimo" "$BIN"

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$REPO/shim/server.js</string></array>
  <key>EnvironmentVariables</key><dict><key>CCMIMO_SHIM_CONFIG</key><string>$SHIM_CONFIG</string></dict>
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
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "note: add ~/.local/bin to your PATH to use ccmimo";; esac
