# Guftago — Season Handoff Document

> **Read this file completely before touching any code.**
> It replaces the exhausted session `ses_e30744a4cffecjbezGOf7eRpdc` ("Private couple chat website", 678 messages, ~650k tokens used of 1,048,576).
> That session died because auto-compaction failed with a `FreeUsageLimitError` (429), not because the work was finished.

**Last updated:** Nov 13, 2026
**Project:** Guftago (guftago = Urdu for "conversation / talk")
**Repo:** https://github.com/wellissssss/guftago-chat
**Local path:** `/Users/gohsa/Documents/Default Project`
**Version:** v1.0.0 (committed) + uncommitted work on top

---

## 1. What this project is

A **self-hosted, ultra-lightweight, real-time private chat for exactly two people**. Built for a friend to talk to his girlfriend without installing any app — just a browser.

- Hosted on a phone (Android/Termux) or a PC, running in the background
- Exposed publicly via **Cloudflare Tunnel** so both people can use it from anywhere
- **Login-code protected** — each person gets a different code
- Must stay lightweight: low CPU/RAM so it doesn't stress the hosting device
- Works on Android, iPhone, and desktop browsers

Not a group chat. Not a public room. Two people, one private space.

---

## 2. Current state — what already works

Everything below was built and manually tested during the last season.

### Core chat
- Real-time text messaging over Socket.IO
- Multi-line input, with an **Enter-to-Send toggle** (default: Enter = newline)
- Message editing (owner only), deletion (owner only, cleans up files)
- Copy message text
- **Reply to message** (swipe right on mobile, context menu on desktop)
- Emoji reactions (long-press / double-tap, plus quick-reaction row)
- Read receipts (✓ sent, ✓✓ delivered, blue ✓✓ read)
- Typing indicators
- Online/offline presence
- Timestamps + date separators
- Message pinning + pinned banner
- Message search with match highlighting
- Chat export as `.txt`
- Sync-on-reconnect (fetches messages missed while offline)

### Media
- Photo sharing — client-side canvas compression + server-side `sharp`
- Video sharing up to 20MB, streamed
- Audio notes — 128kbps Opus, real waveform, noise cancellation
- GIF sharing — **upload or paste a URL** (see gotcha #3 below)
- Drag & drop file upload

### Auth & security
- Admin-controlled password system (custom or randomly generated codes)
- Admin can **deactivate any code instantly** → the connected partner gets a popup and is kicked
- **Single session per code** — first login claims the code, so a leaked code can't be reused
- Admin can kick any live session from the panel
- Users can only edit/delete **their own** messages
- Code validation: min 4 chars, duplicate check

### Profile & UI
- Custom display names (admin sets the name, partner sees it)
- Cat profile pictures (Cataas API + DiceBear fallback)
- Dark/Light theme toggle
- WhatsApp-inspired design using WDS tokens
- Cute login page — floating hearts, rotating taglines
- PWA — "Add to Home Screen", service worker cache `chat-v4`
- Sound notifications + haptic feedback
- Admin panel (⚙️, admin only): code generation, code list, deactivate, kick session, live sessions, name update, picture update, admin-code change

### Infrastructure
- SQLite via Node's built-in `node:sqlite` — one file, `data/chat.db`
- Auto-cleanup of old media (configurable per type in `.env`)
- Cloudflare quick tunnel + named-tunnel setup script
- Termux/Android deployment script
- PM2 + Termux:Boot autostart options
- macOS launchd plist and Linux systemd unit included

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22.5+ (uses built-in `node:sqlite` — no native DB dep). Dev machine runs v26.13.0 |
| Server | Express 4.x |
| Realtime | Socket.IO 4.x |
| Database | SQLite, single file at `data/chat.db` |
| Images | `sharp` server-side + canvas client-side |
| Uploads | `multer` |
| Frontend | Vanilla HTML / CSS / JS — **no framework, no build step** |
| Tunnel | `cloudflared` |
| Process manager | PM2 (optional) |

Dependencies are deliberately few: `express`, `socket.io`, `dotenv`, `sharp`, `multer`.

---

## 4. File map

```
Default Project/
├── server.js              # Express + Socket.IO + SQLite + uploads + cleanup (~700 lines)
├── package.json           # scripts: start, dev, background
├── .env                   # PORT, APP_NAME, ADMIN_CODE, names, cleanup settings
├── .env.example           # template
├── README.md              # full setup guide
├── GUFTAGO_HANDOFF.md     # ← this file
├── data/                  # gitignored
│   ├── chat.db            # SQLite
│   ├── uploads/{photos,videos,audio,gifs}/
│   ├── server.log, tunnel.log, server.pid
├── public/
│   ├── index.html         # login + chat + admin panel + GIF panel
│   ├── style.css          # WhatsApp-inspired, WDS tokens
│   ├── app.js             # all frontend logic (~1300 lines)
│   ├── manifest.json      # PWA
│   ├── sw.js              # service worker, cache 'chat-v4'
│   └── cat-logo.jpg       # logo (user-supplied image)
└── scripts/
    ├── setup-termux.sh, start.sh, stop.sh, start-all.sh, tunnel.sh
    ├── deploy-android.sh
    ├── setup-named-tunnel.sh
    ├── com.couplechat.plist      # macOS launchd
    └── couplechat.service        # Linux systemd
```

---

## 5. API surface

### HTTP
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Validate access code, return role/name/pic |
| POST | `/api/upload` | Multipart media upload (`file`) |
| GET | `/api/messages` | Message history |
| POST | `/api/gif/validate` | Validate a pasted GIF URL |
| GET | `/api/profile-pics` | Cat pictures (Cataas + DiceBear fallback) |
| GET | `/api/health` | Health check |
| POST | `/api/admin/generate-code` | Create a code |
| GET | `/api/admin/codes` | List codes |
| POST | `/api/admin/deactivate-code` | Revoke a code |
| POST | `/api/admin/kick-session` | Force-disconnect a session |
| GET | `/api/admin/sessions` | List live sessions |
| POST | `/api/admin/update-name` | Change display name |
| POST | `/api/admin/update-pic` | Change profile picture |
| POST | `/api/admin/change-admin-code` | Rotate admin code |

All `/api/admin/*` routes are behind `requireAdmin`.

### Socket.IO events
**Client → server:** `sync`, `message`, `typing`, `reaction`, `read`, `edit`, `pin`, `delete`
**Server → client:** `message`, `message:sent`, `message:edited`, `message:pinned`, `message:deleted`, `reaction`, `presence`, `revoked`

`revoked` is what fires the "access revoked by admin" popup.

---

## 6. Database schema

### `access_codes`
`id`, `code`, `role` ('admin' | 'partner'), `name`, `profile_pic`, `created_at`, `active` (1/0), `used_at`

### `messages`
`id`, `sender` ('admin' | 'partner'), `type` ('text' | 'photo' | 'video' | 'audio' | 'gif'), `content` (text / file path / GIF URL), `filename`, `mimetype`, `size`, `reply_to`, `pinned`, `created_at`, `read_at`

### `reactions`
`id`, `message_id`, `user`, `emoji`, `created_at`

---

## 7. Running it

```bash
# Dev / local
cd "/Users/gohsa/Documents/Default Project"
npm start                    # or: npm run background

# Public access from anywhere (second terminal)
bash scripts/tunnel.sh       # prints https://<random>.trycloudflare.com
```

- Local URL: `http://localhost:3000`
- The Cloudflare **quick tunnel URL changes on every restart** — for a stable URL run `scripts/setup-named-tunnel.sh` once.
- **Audio recording requires HTTPS.** On phones, use the tunnel URL, not `localhost`.

Current `.env` (values redacted here — read the real file):
`PORT=3000`, `APP_NAME=Guftago`, `ADMIN_NAME=Admin`, `PARTNER_NAME=Partner`, cleanup 30/14/30/30 days, interval 24h.

---

## 8. What was in progress when the season died

This matters — the working tree is **dirty**.

### Uncommitted changes (feature complete, not committed)
`git diff --stat`:
```
public/app.js     | 71 +++++++++++++++++++++++++++++++++++++++++++++++++++----
public/index.html | 14 +++++++++++
public/style.css  | 31 ++++++++++++++++++++++++
```

This is the **"image preview before send"** feature:
- `#preview-overlay` modal with preview card, caption input, Cancel/Send buttons (`index.html`)
- `previewFile` / `previewUrl` state, object-URL lifecycle, image & video preview rendering (`app.js` ~line 600)
- Styling for `.preview-overlay`, `.preview-card`, `.preview-media`, `.preview-caption`, `.preview-actions` (`style.css`)

**It is implemented but was never tested end-to-end and never committed.** First job for the new season: verify it, then commit or revert.

### Two subagents left dangling
- `ses_e2ee4c5f7ffedAbE1YNz8IngGt` — "Add image preview before send" → ended `idle`, no completion report
- `ses_e2ee45d49ffeKGt4nFEyTDPim6` — "Improve mobile keyboard handling" → ended `idle`, no completion report

Assume neither reported success. Re-verify both against the actual code.

### State right now
- Server was running on port 3000 (PID was 24914 at handoff time — re-check with `lsof -ti:3000`)
- `data/chat.db`: **0 messages**, 2 access codes (test data was cleared)
- Git: single commit `3de2076 "Initial commit: Guftago chat app"`, then 3 modified files
- Service worker cache is `chat-v4` — **bump it** whenever you change `public/` assets or users will see stale files

---

## 9. Backlog — priority order

### Phase 1 — finish what was started (do these first)
1. ~~**Verify + commit the image-preview feature**~~ — **DONE** in `c105a1e`. E2E harness `preview-test.js` (Playwright, 17 checks) passes 17/17: photo preview, `<img>` actually loads, cancel sends nothing, send adds bubble + caption, video preview, Escape closes, zero console/page errors. Three defects fixed in the same commit: page title / iOS app title were "Chat" (now Guftago), a page-load `TypeError: Cannot read properties of null (reading 'on')` from a notification listener registered on a null socket (moved into `connectSocket`'s message handler — background sound + haptic alerts work again), and asset/`sw.js` cache versions bumped (`chat-v5`, `?v=3`).
2. **Mobile keyboard handling** via `visualViewport` — chat input should stay above the keyboard ← **NEXT**
3. Message retry on failure
4. Better empty states and loading indicators
5. Sweep for remaining UI visual issues

### Phase 2 — features
6. Custom chat wallpaper picker
7. Sound on send/receive toggle
8. Message bookmarking
9. Read-time display ("read at 9:42 PM")
10. Chat stats (message count, media count)
11. Draft messages (save unsent text)
12. Scheduled messages
13. Self-destructing messages

### Phase 3 — advanced
14. End-to-end encryption (Web Crypto API)
15. P2P mode (WebRTC) — optional
16. Better PWA: offline message queue
17. Push notifications
18. Multi-language support

---

## 10. Hard-won rules — do not repeat past mistakes

These came from real friction last season. Ignoring them will get you the same angry feedback.

1. **Test before you say it's done.** The user's exact words: *"I told you before shipping anything check everything is working fine or not."* Last season shipped broken code twice (`otherPic is not defined`, and a mangled login page). Always start the server and exercise the flow.
2. **Use the `ponytail` tool** that is already installed on this machine. The user asked for it twice and got ignored both times — it was a genuine sore point. Repo: https://github.com/dietrichgebert/ponytail
3. **The name is Guftago.** Not "Couple Chat". The repo, `<h1>`, and header all say Guftago.
4. **No pink theme, no extra themes.** The user rejected the pink palette explicitly. Dark/light toggle only.
5. **The logo is a specific cat image** the user supplied (`public/cat-logo.jpg`). Do not substitute a different cat or an emoji.
6. **The login word is "guftago"** (Urdu), not "CHAT". The user went through several rounds to get this right.
7. **UI quality bar is high.** Vague "make it prettier" requests mean: study how real chat apps look, then rebuild — not tweak colors.
8. **The admin has total control**: change password any time, deactivate a code instantly, kick sessions, set names and pictures.
9. **Codes are single-use-per-session.** First person to log in with a code owns it; a leaked code must not work.
10. **Keep it lightweight.** Every feature must justify its CPU/RAM cost on a phone host.
11. **Use subagents in separate sessions** so the main session doesn't burn its context. One focused task per subagent, with testing required before it reports success.
12. **GitHub is the safety net.** Checkpoint before each change, push when green, `git reset --hard` when red.
13. **When the session nears its limit, write a handoff MD** — that's why this file exists.

---

## 11. Gotchas that will bite you

1. **Tenor is dead.** Google shut down the Tenor API on **June 30, 2026**. GIF search was removed. Current behaviour: users paste a GIF URL or upload a GIF file. Do not try to re-add Tenor.
2. **Klipy was rejected.** Their API requires a website URL and justification the project can't provide. Don't build on it.
3. **Audio recording needs HTTPS.** `getUserMedia` fails silently-ish on plain HTTP. Test on the tunnel URL.
4. **Service worker caching hides changes.** Bump `CACHE` in `public/sw.js` (currently `chat-v5`) and the `?v=` query strings in `public/index.html` whenever you touch `public/`.
5. **Tunnel URL rotates** on every restart unless a named tunnel is configured.
6. **`node:sqlite` requires Node ≥ 22.5.** It's built in; don't swap in `better-sqlite3` unless there's a real reason.
7. **Auto-cleanup deletes media** older than the configured days. Test with cleanup disabled if you're debugging old messages.
8. **Do not commit `data/`** — it's gitignored and holds the DB, uploads, and logs.

---

## 12. The user's final prompts — verbatim

These are the last instructions given in the exhausted session, in order. They define the intended operating mode.

**seq 4644** — the goal-loop mandate:
> make a goal plan you i wan t start you keep runing in at goal loop you keep inporoving this projact with new feturs and you have to use subagents in deffrant sessons so this sessone ont gest exosted use git hub to uplod updates adn if somthis gets wrong we use last update i hop you under stand

**seq 4656** — the delivery process:
> make use update the gethub web evry thisng looks workin make a check lits and give it to anoher sub ages todo check we you feel update looks good wen evryr thing look good update it as new verson and start workin on new feturs make sub agesb as poibal and make use that agtes dont use hthis sesonns be cuse we useed 650k total and we have lemets in this seson 1048576 if you feel this sesson will about to end make a md file with all inportand detals and run new sessons and start working on it

**seq 4694** — the overnight instruction:
> i iam heeding o betad ill wak up in moring 7:30 tll then keep working

**seq 4722, 4730** — nudges: `continew`, `continew`

**seq 4737** — second-to-last prompt:
> make a prompt with all ionstrotins so i continew this sesson in new sesson

**seq 4745** — last prompt: `hi`

Interpretation: the user went to bed expecting the agent to keep improving the project autonomously overnight, using subagents, committing to GitHub, and handing off via an MD file if the session ran out. The session ran out. **This file is that handoff.**

---

## 13. How to continue — suggested first 30 minutes

1. Read this file, then `README.md`, then skim `server.js` and `public/app.js`.
2. `git status` and `git diff` — confirm the uncommitted image-preview work.
3. Start the server: `npm start` (or `npm run background`), open `http://localhost:3000`.
4. **Test the image preview feature end to end.** Photo, video, caption, cancel, send.
5. If it works → commit and push:
   `git add -A && git commit -m "feat: media preview before send" && git push`
   If it's broken → `git checkout -- public/` and rebuild it properly.
6. Bump the service worker cache to `chat-v5`.
7. Move to Phase 1 item 2: mobile keyboard handling with `visualViewport`.
8. Follow the loop from §12: checkpoint → delegate to a fresh subagent → test → commit/push → next item.
9. Re-write/refresh this handoff file before this session also runs out.

---

## 14. Session facts for reference

| | |
|---|---|
| Exhausted session ID | `ses_e30744a4cffecjbezGOf7eRpdc` |
| Session title | Private couple chat website |
| Messages | 678 (83 user) |
| Tokens used | ~650k of 1,048,576 |
| Cause of death | auto-compaction failed, `FreeUsageLimitError` 429 |
| Git commit at handoff | `c105a1e` |
| Uncommitted files | none — tree clean after the preview-feature commit |

---

## 15. Model routing — which model does what

The main session is an **orchestrator**, not a coder. It plans, diagnoses, judges, verifies and commits. All code-writing is delegated to subagents, and each subagent gets the model that suits its task.

### Orchestrator (the main session)

**`opencode/deepseek-v4.1-flash-free`** — best judgement of the free models. Strongest bug-hunting in benchmarking, and the only free model that answered `UNKNOWN` on a hallucination trap instead of inventing an answer. That matters more than raw speed for the agent whose job is deciding whether work is real.

Fallback order: `mimo-v2.6-flash-free` → `glm-5.3-flash-free`.

### Task → model table

| Subagent task | Model | Why |
|---|---|---|
| Backend: `server.js`, SQL, socket events, bug fixing, code review | `deepseek-v4.1-flash-free` | benchlm 64.4, Coding #18, best at finding real defects |
| Large multi-file refactor, long agentic chains | `mimo-v2.6-flash-free` | #4 agentic on OpenCode, 67.2% SWE-bench, 185 tps |
| UI polish, layout, design review | `glm-5.3-flash-free` | best multimodal + grounded, cleanest instruction-following |
| Read a screenshot / rendered page, report visual defects | `nemotron-3.5-super-vl-free` | the only free vision-language model |
| Tiny chores: bump SW cache, rename, grep, format | `nemotron-3.5-lightning-free` | fastest and cheapest; fine for mechanical edits |
| Docs, README, handoff prose, commit messages | `big-pickle` | best general writing/chat model |

### Rules

1. One task per subagent — never bundle.
2. Every subagent prompt ends with: *"Test your work before reporting success. Report exactly what you ran and what the output was. Do not claim done without proof."*
3. Cheapest capable model wins. Don't spend mimo on a one-liner.
4. On `Free usage limit reached`, retry on the next model for that row and record the swap.
5. **The orchestrator verifies every subagent's output itself** — reads the diff, runs the app. A subagent saying "done" is not evidence.

### Availability

| Working | Blocked (reset ~5 a.m.) |
|---|---|
| `deepseek-v4.1-flash-free` | `iceman-free` |
| `nemotron-3.5-super-vl-free` | `inkling-2-small-free` |
| `mimo-v2.6-flash-free` | `longcat-2.5-free` |
| `nemotron-3.5-lightning-free` | `flint-40b-free` |
| `glm-5.3-flash-free` | `minimax-m3.1-flash-free` |
| `big-pickle` | `beam-free` |

An overnight run before 5 a.m. has six models to rotate through. After 5 a.m., twelve.

