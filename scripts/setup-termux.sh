#!/data/data/com.termux/files/usr/bin/bash
# Couple Chat — One-command Termux (Android) setup

set -e
echo "=== Couple Chat — Termux Setup ==="

# Update packages
pkg update -y && pkg upgrade -y

# Install Node.js
pkg install -y nodejs

# No build tools needed — uses Node.js built-in SQLite (node:sqlite)
# Requires Node.js 22.5+ (Termux provides this)

# Install cloudflared for tunnel
pkg install -y cloudflared 2>/dev/null || {
  echo "cloudflared not in pkg, downloading binary..."
  ARCH=$(uname -m)
  case "$ARCH" in
    aarch64) CF_ARCH="arm64" ;;
    armv7l)  CF_ARCH="arm" ;;
    x86_64)  CF_ARCH="amd64" ;;
    *)       CF_ARCH="arm64" ;;
  esac
  curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o $PREFIX/bin/cloudflared
  chmod +x $PREFIX/bin/cloudflared
}

echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"

# Install dependencies
cd "$(dirname "$0")/.."
npm install

echo ""
echo "=== Setup complete! ==="
echo "Edit .env to set your partner codes and names."
echo "Then run: bash scripts/start.sh"
echo "For public access: bash scripts/tunnel.sh"
