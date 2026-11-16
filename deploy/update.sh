#!/usr/bin/env bash
# Update the app on a server that was provisioned with setup.sh:
#   sudo bash deploy/update.sh        (from anywhere, uses /opt/ton-airdrop)
set -euo pipefail

APP_DIR="/opt/ton-airdrop"
BRANCH="${BRANCH:-arena/ca6f6f6e-bot}"

if [[ $EUID -ne 0 ]]; then
  echo "✗ Run as root:  sudo bash deploy/update.sh"
  exit 1
fi

cd "$APP_DIR"
echo "==> Pulling $BRANCH"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --quiet --hard "origin/$BRANCH"

echo "==> Rebuilding"
su -s /bin/bash airdrop -c "cd '$APP_DIR' && npm ci --silent && npm run build"
chown -R airdrop:airdrop "$APP_DIR"

echo "==> Restarting service"
systemctl restart ton-airdrop
sleep 2
systemctl is-active --quiet ton-airdrop \
  && echo "✓ Updated and running (journalctl -u ton-airdrop -f)" \
  || { echo "✗ Service failed — journalctl -u ton-airdrop -e"; exit 1; }
