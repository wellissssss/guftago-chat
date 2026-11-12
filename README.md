# 💕 Couple Chat — Ultra-Lightweight Private Chat

A self-hosted, real-time private chat for **two people**. No app install needed — works on any browser (Android, iPhone, desktop). Hosted on your phone, exposed publicly via free Cloudflare Tunnel.

## Features
- 🔐 Login code gate (unique code per partner)
- 💬 Real-time text chat
- 📷 Photo sharing (auto-compressed)
- 🎥 Video sharing (up to 20MB, streamed)
- 🎙️ Audio notes (voice messages, up to 60s)
- 🎞️ GIF sharing (upload or search via Tenor)
- 😍 Emoji reactions on messages
- 🟢 Online/offline status
- ⌨️ Typing indicators
- ✓✓ Read receipts
- 🕐 Timestamps
- 📱 PWA — "Add to Home Screen" on phones

## Quick Start (Android — Recommended)

### 1. Install Termux
Download from F-Droid (not Play Store — Play Store version is outdated):
https://f-droid.org/en/packages/com.termux/

### 2. Setup
```bash
# In Termux:
termux-setup-storage
pkg install git
git clone <your-repo-url> couple-chat
cd couple-chat
bash scripts/setup-termux.sh
```

### 3. Configure
```bash
nano .env
```
Set your partner codes and names:
```
PARTNER1_CODE=your-friends-code
PARTNER1_NAME=Friend Name
PARTNER2_CODE=girlfriends-code
PARTNER2_NAME=Girlfriend Name
```

### 4. Start server
```bash
bash scripts/start.sh
```

### 5. Expose publicly (for access from anywhere)
```bash
# In a second Termux session (swipe from left, tap "New Session"):
bash scripts/tunnel.sh
```
You'll get a URL like `https://random-name.trycloudflare.com` — share this with your partner!

### 6. Keep running in background
- Disable battery optimization for Termux: Settings → Apps → Termux → Battery → "Unrestricted"
- Use `tmux` to keep sessions alive across phone restarts

## iOS Setup (Limited)
iOS is very restricted for running servers. Options:
1. **iSH** app (Alpine Linux in iOS) — can run Node.js but slow and unreliable
2. **a-Shell** — limited
3. **Recommended**: Use an Android phone or a cheap VPS ($5/month) instead

## Desktop Setup (Mac/Linux/Windows)
```bash
# Install Node.js 18+ from https://nodejs.org
npm install
# Edit .env with your codes
npm start
# For public access, install cloudflared:
# Mac: brew install cloudflared
# Then: cloudflared tunnel --url http://localhost:3000
```

## Configuration (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `PARTNER1_CODE` | Login code for partner 1 | PARTNER-A |
| `PARTNER1_NAME` | Display name for partner 1 | Partner 1 |
| `PARTNER2_CODE` | Login code for partner 2 | PARTNER-B |
| `PARTNER2_NAME` | Display name for partner 2 | Partner 2 |
| `TENOR_API_KEY` | Free Tenor API key for GIF search | (empty) |
| `CLEANUP_*_DAYS` | Auto-delete old media after N days | 30/14/30/30 |
| `CLEANUP_INTERVAL_HOURS` | How often cleanup runs | 24 |

## GIF Search Setup (Optional)
1. Go to https://tenor.com/developer/keyregistration
2. Register (free) and get an API key
3. Add it to `.env`: `TENOR_API_KEY=your-key-here`
4. Restart server

Without a key, GIF upload and URL paste still work — only search is disabled.

## Running as Background Service

### Android (Termux)
```bash
bash scripts/start.sh    # Start
bash scripts/stop.sh     # Stop
# Logs: data/server.log
```

### Mac (launchd — auto-start on boot)
```bash
# Copy the plist file
cp scripts/com.couplechat.plist ~/Library/LaunchAgents/
# Edit the plist to set the correct path
launchctl load ~/Library/LaunchAgents/com.couplechat.plist
```

### Linux (systemd)
```bash
sudo cp scripts/couplechat.service /etc/systemd/system/
sudo systemctl enable couplechat
sudo systemctl start couplechat
```

## Storage & Maintenance
- Photos auto-compressed to ~200KB
- Videos capped at 20MB
- Audio notes ~50-100KB each
- Auto-cleanup removes old media (configurable in .env)
- Database: `data/chat.db` (SQLite, single file, easy to backup)
- Uploads: `data/uploads/` (photos, videos, audio, gifs)

## Backup
```bash
# Backup everything
cp -r data/ backup-$(date +%Y%m%d)/
```

## Troubleshooting

### Server won't start
- Check Node.js is installed: `node --version`
- Check port isn't in use: `lsof -i :3000`
- Check logs: `cat data/server.log`

### Audio recording doesn't work
- Audio recording requires HTTPS (not HTTP)
- Use the Cloudflare Tunnel URL (which provides HTTPS)
- Or test on localhost (which is treated as secure)

### Partner can't connect
- Make sure tunnel is running: `bash scripts/tunnel.sh`
- Share the full URL including https://
- Check phone has internet connection

### Storage filling up
- Reduce cleanup days in .env
- Manually delete old files from data/uploads/
- Compress videos before sharing

## Tech Stack
- **Node.js** + **Express** — server
- **Socket.IO** — real-time messaging
- **better-sqlite3** — database (single file)
- **sharp** — image compression
- **multer** — file uploads
- **Vanilla JS/CSS** — frontend (no framework)

## License
MIT
