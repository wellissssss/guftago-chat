#!/data/data/com.termux/files/usr/bin/bash
# Couple Chat — Expose server publicly via Cloudflare Tunnel
# Gives you a public HTTPS URL like https://random-name.trycloudflare.com

cd "$(dirname "$0")/.."

PORT=$(grep '^PORT=' .env | cut -d= -f2)
PORT=${PORT:-3000}

echo "Starting Cloudflare Tunnel on port $PORT..."
echo "Your public URL will appear below. Share it with your partner!"
echo ""

cloudflared tunnel --url http://localhost:$PORT
