#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║         Guftago Chat — Free Permanent Static Tunnel      ║
# ║         Zero cost, zero config, static URL every time    ║
# ╚══════════════════════════════════════════════════════════╝

cd "$(dirname "$0")/.."

PORT=$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3000}
SUBDOMAIN="${TUNNEL_SUBDOMAIN:-guftago-chat-live}"

echo ""
echo "🐱 Starting Static Tunnel for Guftago Chat"
echo "=========================================="
echo "Port:      $PORT"
echo "Subdomain: $SUBDOMAIN"
echo "Static URL: https://${SUBDOMAIN}.loca.lt"
echo ""

while true; do
  echo "Connecting tunnel to https://${SUBDOMAIN}.loca.lt ..."
  npx --yes localtunnel --port "$PORT" --subdomain "$SUBDOMAIN"
  echo "Tunnel disconnected. Reconnecting in 3 seconds..."
  sleep 3
done
