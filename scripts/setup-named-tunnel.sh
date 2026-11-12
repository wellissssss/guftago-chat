#!/bin/sh
# ╔══════════════════════════════════════════════════════════╗
# ║         Guftago Chat — Named Tunnel Setup                ║
# ║         Creates a PERMANENT URL that never changes       ║
# ╚══════════════════════════════════════════════════════════╝

echo ""
echo "🐱 Setting up Permanent Tunnel for Guftago Chat"
echo "=============================================="
echo ""
echo "This will create a PERMANENT URL that never changes."
echo "You need a free Cloudflare account (no credit card)."
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
  echo "❌ cloudflared not found. Install it first:"
  echo "   Mac: brew install cloudflared"
  echo "   Android: pkg install cloudflared"
  exit 1
fi

echo "Step 1: Login to Cloudflare"
echo "  A browser window will open. Log in with your Cloudflare account."
echo "  If you don't have one, create a free account at https://dash.cloudflare.com/sign-up"
echo ""
cloudflared tunnel login

echo ""
echo "Step 2: Create the tunnel"
cloudflared tunnel create guftago-chat

echo ""
echo "Step 3: Configure the tunnel"
TUNNEL_ID=$(cloudflared tunnel list | grep guftago-chat | awk '{print $1}')
echo "   Tunnel ID: $TUNNEL_ID"

# Create config file
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: guftago-chat.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
EOF

echo ""
echo "Step 4: Route DNS (requires a domain)"
echo "  If you have a domain on Cloudflare:"
echo "    cloudflared tunnel route dns guftago-chat guftago-chat.yourdomain.com"
echo ""
echo "  If you don't have a domain, use Cloudflare's free subdomain:"
echo "    cloudflared tunnel route dns guftago-chat guftago-chat.pages.dev"
echo ""
echo "Step 5: Start the named tunnel"
echo "  cloudflared tunnel run guftago-chat"
echo ""
echo "Step 6: Auto-start on boot"
echo "  Add to your startup script:"
echo "    cloudflared tunnel run guftago-chat &"
echo ""
echo "=============================================="
echo "✅ Named tunnel setup complete!"
echo "   Your URL will be: https://guftago-chat.yourdomain.com"
echo "   This URL NEVER changes!"
echo "=============================================="