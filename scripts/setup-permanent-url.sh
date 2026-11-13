#!/bin/sh
# Guftago Chat — Permanent URL Setup
# Creates a URL that NEVER changes

echo ""
echo "Guftago Chat - Permanent URL Setup"
echo "=================================="
echo ""
echo "This will create a PERMANENT URL that never changes."
echo "You need a FREE Cloudflare account (no credit card)."
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared > /dev/null 2>&1; then
  echo "cloudflared not found."
  echo "   Mac: brew install cloudflared"
  echo "   Android: pkg install cloudflared"
  exit 1
fi

echo "Step 1: Login to Cloudflare (browser will open)"
echo "  Create free account at https://dash.cloudflare.com/sign-up if needed"
echo ""
cloudflared tunnel login

echo ""
echo "Step 2: Creating tunnel 'guftago'..."
cloudflared tunnel create guftago 2>/dev/null || echo "Tunnel may already exist"

TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep guftago | awk '{print $1}')
if [ -z "$TUNNEL_ID" ]; then
  echo "Could not find tunnel. Try: cloudflared tunnel list"
  exit 1
fi
echo "   Tunnel ID: $TUNNEL_ID"

echo ""
echo "Step 3: Creating config file..."
mkdir -p ~/.cloudflared

# Write config using printf to avoid heredoc issues
printf 'tunnel: %s\n' "$TUNNEL_ID" > ~/.cloudflared/config.yml
printf 'credentials-file: %s/.cloudflared/%s.json\n' "$HOME" "$TUNNEL_ID" >> ~/.cloudflared/config.yml
printf '\n' >> ~/.cloudflared/config.yml
printf 'ingress:\n' >> ~/.cloudflared/config.yml
printf '  - service: http://localhost:3000\n' >> ~/.cloudflared/config.yml

echo "   Config saved to ~/.cloudflared/config.yml"

echo ""
echo "=================================="
echo "Tunnel created! Now you need a domain."
echo ""
echo "Option A (Free Cloudflare subdomain):"
echo "  1. Go to https://dash.cloudflare.com"
echo "  2. Add a free domain (or use your existing one)"
echo "  3. Run: cloudflared tunnel route dns guftago yourdomain.com"
echo "  4. Update ~/.cloudflared/config.yml with hostname: yourdomain.com"
echo ""
echo "Option B (No domain - use localhost.run):"
echo "  ssh -R 80:localhost:3000 nokey@localhost.run"
echo "  (gives a random URL, but stable for the session)"
echo ""
echo "Option C (No domain - use serveo.net):"
echo "  1. Visit https://console.serveo.net/ssh/keys to register your SSH key"
echo "  2. Then: ssh -R guftago:80:localhost:3000 serveo.net"
echo "  (gives stable URL: https://guftago.serveo.net)"
echo ""
echo "To start the named tunnel:"
echo "  cloudflared tunnel run guftago"
echo ""
echo "To auto-start on boot (Mac):"
echo "  Add to your startup: cloudflared tunnel run guftago &"
echo ""
echo "To auto-start on boot (Android/Termux):"
echo "  Add to ~/.termux/boot/start-guftago.sh:"
echo "  cloudflared tunnel run guftago &"
echo "=================================="