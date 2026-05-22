#!/usr/bin/env bash
# Install local-pilot as a systemd --user service: it then runs in the
# background, restarts on failure, and (with linger) survives reboots.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NPM="$(command -v npm)" || { echo "error: npm is not on PATH" >&2; exit 1; }
NODE="$(command -v node)" || { echo "error: node is not on PATH" >&2; exit 1; }
NODE_DIR="$(dirname "$NODE")"

echo "==> Installing dependencies and building the web UI…"
"$NPM" install
"$NPM" run build

UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/local-pilot.service"
mkdir -p "$UNIT_DIR"

echo "==> Writing $UNIT"
cat > "$UNIT" <<EOF
[Unit]
Description=local-pilot — web UI for Claude Code

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=$NPM start
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
# Override settings here if you like, e.g.:
# Environment=PORT=8787
# Environment=LOCAL_PILOT_TOKEN=your-own-token

[Install]
WantedBy=default.target
EOF

echo "==> Enabling and starting the service"
systemctl --user daemon-reload
systemctl --user enable --now local-pilot.service

sleep 2
echo
systemctl --user --no-pager --lines=0 status local-pilot.service || true
echo

if ! loginctl show-user "$(id -un)" 2>/dev/null | grep -q '^Linger=yes'; then
  echo "NOTE: to keep local-pilot running after you log out and across reboots, run:"
  echo "    sudo loginctl enable-linger $(id -un)"
  echo
fi

TOKEN_FILE="${LOCAL_PILOT_DATA:-$HOME/.local-pilot}/token"
echo "Access token — enter this when signing in from a browser:"
if [ -f "$TOKEN_FILE" ]; then
  echo "    $(cat "$TOKEN_FILE")"
else
  echo "    not generated yet — check $TOKEN_FILE once the service is running"
fi
echo
echo "Done. Manage it with: systemctl --user {status,restart,stop} local-pilot"
echo "Logs: journalctl --user -u local-pilot -f"
