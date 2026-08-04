#!/usr/bin/env bash
# deploy.sh — push the smokeless-range-software code to the Raspberry Pi and
# (re)start it as a background service, so you "just transfer the code" and it
# runs. Idempotent: safe to run over and over.
#
# Usage:
#   ./deploy.sh                      # auto-discover the Pi (uses find-pi.sh)
#   ./deploy.sh pi@192.168.4.1       # explicit target
#   ./deploy.sh pi@shooterrange.local
#
# Env overrides:
#   PI_USER   (default: pi)          SSH user if target has no "user@"
#   REMOTE_DIR(default: ~/smokeless-range-software)
#   NO_SERVICE=1                     skip installing the systemd service
#   NO_DEPS=1                        skip pip install of requirements
#
# What it does:
#   1) resolves the target host (arg > auto-discovery)
#   2) rsyncs the code (excluding venv / caches / build junk)
#   3) creates a venv + installs requirements (numpy, opencv) once
#   4) installs & starts a systemd service so the app auto-runs on boot
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_USER="${PI_USER:-pi}"
REMOTE_DIR="${REMOTE_DIR:-\$HOME/smokeless-range-software}"
SERVICE_NAME="shooterrange"

# ---- 1. Resolve target -----------------------------------------------------
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "==> No target given, auto-discovering the Pi..."
  # Grab the first reachable host from find-pi.sh.
  HOST_LINE="$(PI_USER="$PI_USER" "$HERE/find-pi.sh" | awk '/reachable:/ {print $2; exit}')" || true
  if [ -z "${HOST_LINE:-}" ]; then
    echo "Could not auto-discover the Pi. Pass it explicitly:"
    echo "   ./deploy.sh ${PI_USER}@<pi-ip>"
    exit 1
  fi
  TARGET="$HOST_LINE"
fi
# Add default user if the target is a bare host.
case "$TARGET" in
  *@*) : ;;
  *) TARGET="${PI_USER}@${TARGET}" ;;
esac
echo "==> Target: ${TARGET}"
echo "==> Remote dir: ${REMOTE_DIR}"

# ---- 2. Sync code ----------------------------------------------------------
echo "==> Syncing code with rsync..."
rsync -az --delete \
  --exclude '.venv' \
  --exclude 'venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'wokwi/build*' \
  --exclude '3d/exports' \
  --exclude '.git' \
  "$HERE/" "${TARGET}:${REMOTE_DIR}/"

# ---- 3 + 4. Set up venv, deps, and the service on the Pi -------------------
NO_DEPS="${NO_DEPS:-0}"
NO_SERVICE="${NO_SERVICE:-0}"

ssh "$TARGET" \
  REMOTE_DIR="$REMOTE_DIR" \
  SERVICE_NAME="$SERVICE_NAME" \
  NO_DEPS="$NO_DEPS" \
  NO_SERVICE="$NO_SERVICE" \
  'bash -s' <<'REMOTE'
set -euo pipefail
cd "$(eval echo "$REMOTE_DIR")"
REMOTE_DIR="$(pwd)"
RUN_USER="$(id -un)"

if [ "${NO_DEPS}" != "1" ]; then
  echo "==> [pi] Ensuring venv + Python deps..."
  # picamera2/libcamera come from apt and must be visible inside the venv.
  python3 -m venv --system-site-packages .venv
  ./.venv/bin/pip install --upgrade pip >/dev/null
  ./.venv/bin/pip install -r requirements.txt
  echo "    (reminder: sudo apt install -y python3-picamera2 python3-libcamera if not already)"
fi

if [ "${NO_SERVICE}" != "1" ]; then
  echo "==> [pi] Installing systemd service '${SERVICE_NAME}'..."
  sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<UNIT
[Unit]
Description=ShooterRange smokeless-range software (control server + scoring)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REMOTE_DIR}
ExecStart=${REMOTE_DIR}/.venv/bin/python ${REMOTE_DIR}/app.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}"
  sudo systemctl restart "${SERVICE_NAME}"
  sleep 1
  sudo systemctl --no-pager --lines=15 status "${SERVICE_NAME}" || true
else
  echo "==> [pi] Skipping service; run manually: ./.venv/bin/python app.py"
fi
echo "==> [pi] Done."
REMOTE

echo
echo "==> Deploy complete."
echo "    Control server: http://${TARGET#*@}:8080/api/health"
echo "    Logs:  ssh ${TARGET} 'journalctl -u ${SERVICE_NAME} -f'"
echo "    Stop:  ssh ${TARGET} 'sudo systemctl stop ${SERVICE_NAME}'"
