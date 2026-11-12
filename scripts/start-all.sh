#!/bin/sh
# ╔══════════════════════════════════════════════════════════╗
# ║         Guftago Chat — Start Everything                  ║
# ║         Starts server + tunnel in background             ║
# ╚══════════════════════════════════════════════════════════╝

cd "$(dirname "$0")/.."

# Create data dirs
mkdir -p data/uploads/photos data/uploads/videos data/uploads/audio data/uploads/gifs

# Kill any existing processes
pkill -f "node server.js" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# Start server
nohup node server.js > data/server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > data/server.pid
echo "✅ Server started (PID: $SERVER_PID)"

# Wait for server to be ready
sleep 2

# Start tunnel
nohup cloudflared tunnel --url http://localhost:$(grep '^PORT=' .env | cut -d= -f2 || echo 3000) > data/tunnel.log 2>&1 &
TUNNEL_PID=$!
echo $TUNNEL_PID > data/tunnel.pid
echo "✅ Tunnel started (PID: $TUNNEL_PID)"

# Wait for tunnel URL
echo "⏳ Waiting for public URL..."
for i in $(seq 1 20); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare.com' data/tunnel.log 2>/dev/null | head -1)
  if [ -n "$URL" ]; then
    echo ""
    echo "========================================"
    echo "🎉 Guftago Chat is LIVE!"
    echo "========================================"
    echo ""
    echo "  📱 Local:  http://localhost:$(grep '^PORT=' .env | cut -d= -f2 || echo 3000)"
    echo "  🌐 Public: $URL"
    echo ""
    echo "  Admin code: $(grep '^ADMIN_CODE=' .env | cut -d= -f2)"
    echo ""
    echo "  To stop: bash scripts/stop-all.sh"
    echo "========================================"
    break
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "⚠️  Tunnel URL not found yet. Check data/tunnel.log"
fi