#!/bin/sh
# Guftago Chat — Stop Everything

cd "$(dirname "$0")/.."

pkill -f "node server.js" 2>/dev/null && echo "✅ Server stopped" || echo "Server not running"
pkill -f "cloudflared tunnel" 2>/dev/null && echo "✅ Tunnel stopped" || echo "Tunnel not running"
pkill -f "serveo.net" 2>/dev/null && echo "✅ Serveo stopped" || true
pkill -f "localhost.run" 2>/dev/null && echo "✅ localhost.run stopped" || true

rm -f data/server.pid data/tunnel.pid
echo "Done."