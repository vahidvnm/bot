#!/usr/bin/env bash
# ============================================================
# One-shot bootstrap for a fresh Ubuntu 22.04 / 24.04 VM
# (Oracle Cloud Always Free, or any VPS with a public IP).
#
#   sudo bash deploy/setup.sh bot.example.com
#
# Free domain ideas (no purchase needed):
#   - duckdns.org           free subdomain, takes 1 minute
#   - <public-ip>.sslip.io  zero signup at all, e.g. 1.2.3.4.sslip.io
#   - <name>.nip.io         same idea as sslip.io
#
# Idempotent: safe to re-run; re-running updates the app.
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="/opt/ton-airdrop"
REPO_URL="${REPO_URL:-https://github.com/vahidvnm/bot.git}"
BRANCH="${BRANCH:-arena/ca6f6f6e-bot}"
SERVICE_USER="airdrop"

if [[ $EUID -ne 0 ]]; then
  echo "✗ Run as root:  sudo bash deploy/setup.sh <your-domain>"
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "✗ Usage: sudo bash deploy/setup.sh <your-domain>"
  echo "  e.g.  sudo bash deploy/setup.sh bot.example.com"
  echo "        sudo bash deploy/setup.sh 1.2.3.4.sslip.io"
  exit 1
fi

echo "==> [1/7] System packages (git, curl, caddy, ufw)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq git curl ca-certificates caddy ufw

# SSH must stay reachable before enabling the firewall
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
echo "    ufw active: 22, 80, 443 open"

echo "==> [2/7] Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -yq nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

echo "==> [3/7] Service user + app directory"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
fi
mkdir -p "$APP_DIR"

echo "==> [4/7] Fetching app ($REPO_URL @ $BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

echo "==> [5/7] Install dependencies + production build"
su -s /bin/bash "$SERVICE_USER" -c "cd '$APP_DIR' && npm ci --silent && npm run build"
echo "    build OK (dist/server + dist/client)"

echo "==> [6/7] Environment file"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "    created $APP_DIR/.env — you must edit it (step below)"
else
  echo "    $APP_DIR/.env already exists — keeping it"
fi
chmod 600 "$APP_DIR/.env"
chown "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/.env"

echo "==> [7/7] Caddy (auto-HTTPS) + systemd service"
install -m 644 "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
sed -i "s|__DOMAIN__|$DOMAIN|g" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  || { echo "✗ Caddyfile validation failed"; exit 1; }
systemctl enable --now caddy >/dev/null 2>&1
systemctl reload caddy

install -m 644 "$APP_DIR/deploy/ton-airdrop.service" /etc/systemd/system/ton-airdrop.service
systemctl daemon-reload
systemctl enable ton-airdrop >/dev/null 2>&1
systemctl restart ton-airdrop
sleep 2

if systemctl is-active --quiet ton-airdrop && systemctl is-active --quiet caddy; then
  STATUS="✓ RUNNING"
else
  STATUS="⚠ check: journalctl -u ton-airdrop -e"
fi

cat <<EOF

──────────────────────────────────────────────────────
  Setup done: $STATUS

  App URL :  https://$DOMAIN
  Logs    :  journalctl -u ton-airdrop -f
  App dir :  $APP_DIR
──────────────────────────────────────────────────────

 NEXT STEPS (required for the Telegram bot):

  1. Edit the config:
       nano $APP_DIR/.env
     Fill in:  BOT_TOKEN, BOT_USERNAME, ADMIN_IDS,
               WEBAPP_URL=https://$DOMAIN,
               ALLOW_DEMO_MODE=false

  2. Restart the app:
       systemctl restart ton-airdrop

  3. Telegram → @BotFather → /newbot (if you don't have one yet)
     Then /newapp → paste https://$DOMAIN as the Mini App URL.
     Add your bot as ADMIN of your channel for channel quests.

  4. Keep it awake (free instances sleep / helps monitoring):
     point UptimeRobot or similar at https://$DOMAIN/api/health

  ⚠ Oracle Cloud console: make sure inbound Security List rules
     allow TCP 22, 80 and 443 to this VM.

  Update the app later with:
       sudo bash $APP_DIR/deploy/update.sh
EOF
