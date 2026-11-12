#!/data/data/com.termux/files/usr/bin/bash
# ╔══════════════════════════════════════════════════════════╗
# ║         Guftago Chat — One-Command Android Setup          ║
# ║         Run this in Termux on your Android phone          ║
# ╚══════════════════════════════════════════════════════════╝

set -e

echo ""
echo "🐱 Setting up Guftago Chat on Android..."
echo "========================================"
echo ""

# ── Step 1: Update Termux ──
echo "📦 Step 1/6: Updating Termux packages..."
pkg update -y -q 2>/dev/null || true
pkg upgrade -y -q 2>/dev/null || true

# ── Step 2: Install Node.js ──
echo "📦 Step 2/6: Installing Node.js..."
if ! command -v node &> /dev/null; then
  pkg install -y nodejs
fi
NODE_VER=$(node --version)
echo "   Node.js: $NODE_VER"

# Check Node version (need 22.5+)
NODE_MAJOR=$(echo $NODE_VER | cut -d. -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "   ⚠️  Node.js 22+ required. Installing LTS..."
  pkg install -y nodejs-lts 2>/dev/null || true
fi

# ── Step 3: Install cloudflared ──
echo "📦 Step 3/6: Installing Cloudflare Tunnel..."
if ! command -v cloudflared &> /dev/null; then
  pkg install -y cloudflared 2>/dev/null || {
    echo "   Downloading cloudflared binary..."
    ARCH=$(uname -m)
    case "$ARCH" in
      aarch64) CF_ARCH="arm64" ;;
      armv7l)  CF_ARCH="arm" ;;
      x86_64)  CF_ARCH="amd64" ;;
      *)       CF_ARCH="arm64" ;;
    esac
    curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o "$PREFIX/bin/cloudflared"
    chmod +x "$PREFIX/bin/cloudflared"
  }
fi
echo "   cloudflared: $(cloudflared --version 2>&1 | head -1)"

# ── Step 4: Install PM2 (process manager) ──
echo "📦 Step 4/6: Installing PM2 (auto-restart)..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2 2>/dev/null || echo "   PM2 install skipped (optional)"
fi

# ── Step 5: Install Termux:Boot ──
echo "📦 Step 5/6: Setting up auto-start on boot..."
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-guftago.sh << 'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/guftago
pm2 resurrect 2>/dev/null || nohup node server.js > data/server.log 2>&1 &
BOOT
chmod +x ~/.termux/boot/start-guftago.sh

# ── Step 6: Download project ──
echo "📦 Step 6/6: Setting up project files..."
PROJECT_DIR="$HOME/guftago"
if [ ! -d "$PROJECT_DIR" ]; then
  # If running from project directory, copy files
  if [ -f "./server.js" ]; then
    cp -r . "$PROJECT_DIR"
  else
    echo "   ⚠️  Please copy the project files to ~/guftago first."
    echo "   Or run this script from the project directory."
  fi
fi

cd "$PROJECT_DIR"
mkdir -p data/uploads/{photos,videos,audio,gifs}

# Install npm dependencies (if not already)
if [ ! -d "node_modules" ]; then
  echo "   Installing npm dependencies..."
  npm install --silent 2>&1 | tail -3
fi

echo ""
echo "========================================"
echo "✅ Setup complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Edit your config:  nano ~/guftago/.env"
echo "  2. Start server:      cd ~/guftago && bash scripts/start.sh"
echo "  3. Start tunnel:      cd ~/guftago && bash scripts/tunnel.sh"
echo ""
echo "Auto-start on boot: ✅ Enabled"
echo "Background process: ✅ PM2 configured"
echo ""
echo "To keep running 24/7:"
echo "  - Disable battery optimization for Termux in Android Settings"
echo "  - Keep phone plugged in when possible"
echo ""