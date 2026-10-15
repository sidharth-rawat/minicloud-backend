#!/usr/bin/env bash
#
# MiniCloud EC2 bootstrap (Ubuntu). Configures env + secrets, starts infra,
# builds backend & frontend, and installs the Caddy + systemd services.
#
# PREREQUISITES (install these first — see DEPLOY.md):
#   docker + docker compose, node 20+, caddy, git
#   repos cloned at ~/minicloud/minicloud-backend and ~/minicloud/minicloud-frontend
#
# Usage:   ./deploy/bootstrap.sh <EC2_PUBLIC_IP>
# Example: ./deploy/bootstrap.sh 13.233.1.50
set -euo pipefail

IP="${1:?Usage: ./deploy/bootstrap.sh <EC2_PUBLIC_IP>}"
API_HOST="api.${IP}.sslip.io"
APP_HOST="app.${IP}.sslip.io"

BACKEND="$HOME/minicloud/minicloud-backend"
FRONTEND="$HOME/minicloud/minicloud-frontend"

echo "==> API  will be https://${API_HOST}"
echo "==> App  will be https://${APP_HOST}"

# ── 1. Infra (PostgreSQL + Redis) ───────────────────────────────────────────
cd "$BACKEND"
docker compose up -d

# ── 2. Backend .env (generate real secrets) ─────────────────────────────────
if [ ! -f .env ]; then
  JWT="$(openssl rand -hex 32)"
  WEBHOOK="$(openssl rand -hex 32)"
  cat > .env <<EOF
PORT=4000
DATABASE_URL=postgresql://myuser:mysecretpassword@localhost:5433/mydatabase
JWT_SECRET_KEY=${JWT}
TOKEN_HEADER_KEY=Authorization
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=MySecurePassword123
GITHUB_WEBHOOK_SECRET=${WEBHOOK}
DEPLOY_APP_PORT=3000
DEPLOY_HEALTH_PATH=/health
DEPLOY_CONTAINER_MEMORY=512m
DEPLOY_CONTAINER_CPUS=1
WORKER_CONCURRENCY=3
CORS_ORIGIN=https://${APP_HOST}
EOF
  echo "==> Wrote $BACKEND/.env (generated JWT + webhook secrets)"
  echo "    GITHUB_WEBHOOK_SECRET=${WEBHOOK}   <-- paste this into the GitHub webhook UI"
else
  echo "==> $BACKEND/.env already exists — leaving it untouched"
fi

# ── 3. Build backend ────────────────────────────────────────────────────────
npm install
npx prisma migrate deploy
npm run build

# ── 4. Build frontend (points at the HTTPS API) ─────────────────────────────
cd "$FRONTEND"
echo "VITE_API_URL=https://${API_HOST}" > .env
npm install
npm run build
sudo mkdir -p /var/www/minicloud
sudo rm -rf /var/www/minicloud/*
sudo cp -r dist/* /var/www/minicloud/

# ── 5. Caddy (auto-HTTPS reverse proxy) ─────────────────────────────────────
sudo sed "s/<IP>/${IP}/g" "$BACKEND/deploy/Caddyfile.example" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy || sudo systemctl restart caddy

# ── 6. Backend as a systemd service ─────────────────────────────────────────
sudo cp "$BACKEND/deploy/minicloud.service" /etc/systemd/system/minicloud.service
sudo systemctl daemon-reload
sudo systemctl enable --now minicloud
sudo systemctl restart minicloud

echo ""
echo "============================================================"
echo " MiniCloud is live:"
echo "   Dashboard : https://${APP_HOST}"
echo "   API       : https://${API_HOST}/health"
echo "   Webhook   : https://${API_HOST}/webhooks/github"
echo "============================================================"
echo " Check logs: journalctl -u minicloud -f"
