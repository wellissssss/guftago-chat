#!/data/data/com.termux/files/usr/bin/bash
# Couple Chat — Stop server

cd "$(dirname "$0")/.."

if [ -f data/server.pid ]; then
  PID=$(cat data/server.pid)
  kill $PID 2>/dev/null && echo "Stopped (PID: $PID)" || echo "Process not running"
  rm -f data/server.pid
else
  echo "No PID file found. Trying pkill..."
  pkill -f "node server.js" 2>/dev/null && echo "Stopped" || echo "Not running"
fi
