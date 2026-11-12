#!/data/data/com.termux/files/usr/bin/bash
# Couple Chat — Start server in background

cd "$(dirname "$0")/.."

# Create data dir
mkdir -p data/uploads/{photos,videos,audio,gifs}

# Start server
nohup node server.js > data/server.log 2>&1 &
echo $! > data/server.pid
echo "Started Couple Chat (PID: $(cat data/server.pid))"
echo "Logs: data/server.log"
echo "Local: http://localhost:$(grep PORT .env | cut -d= -f2)"
