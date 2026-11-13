# Guftago — Full Project Review, Bug Hunt & Fix Assignment for Hermes

> **You are taking over a live, running project.** Read this entire document before
> touching a single file. Everything marked **CONFIRMED** below was checked against
> the actual source at commit `4d3718a` and/or the running server on **Nov 13, 2026**.
> Anything marked **LIKELY** or **VERIFY** still needs you to prove it yourself.
>
> **Your job, in one sentence:** make Guftago usable again, then audit the whole
> project, fix the real defects, delete the dead code, and prove every change
> against the running app instead of against your own assumptions.
>
> **Four priorities, in this order:**
>
> 1. **Fix the login lockout.** It is blocking the user *right now*.
> 2. **Close the privacy holes.** The chat history is currently readable by anyone
>    who knows the URL. For a private chat app, this is worse than the login bug.
> 3. **Fix correctness and robustness defects** found in the audit register (§9).
> 4. **Delete dead code and unnecessary surface** (§10).
>
> Do not stop at priority 1. Do not "fix" things that are not broken. Do not claim
> anything works until you have run the test that proves it.

---

## 0. TL;DR for the impatient

- App is **Guftago**, a private 2-person chat. Node + Express + Socket.IO + SQLite.
- **Priority 1 — login:** the user cannot log in. They see *"This code has been
  used on another device, only one session per code."* It is **not** a wrong-code
  problem. `activeSessions` in `server.js` never releases a dead socket, so a tab
  that died 3 hours ago still "owns" the code forever. I reproduced it, proved it,
  and unblocked the user once. **It comes back within hours unless you fix the
  root cause.**
- **Priority 2 — privacy:** `GET /api/messages`, `GET /api/bookmarks` and
  `POST /api/upload` have **no authentication at all**. Anyone with the tunnel URL
  can read the entire chat history and upload files. `POST /api/upload` accepts
  HTML with an attacker-chosen extension, and `/uploads` serves it from the same
  origin — that is a working path to steal the login code out of `localStorage`.
- **Priority 3 — correctness:** ~18 smaller defects, each with file:line and a
  recommended fix in §9.
- **Priority 4 — dead code:** unused endpoints, an unused prepared statement, a
  lying file header, stale PWA metadata. List and evidence in §10.
- Work in the order in §12. Prove everything with the tests in §13, using the
  harness in §14. Do not report success until §15 is fully satisfied and you have
  pasted real output.

---

## 1. What Guftago is

A self-hosted, ultra-lightweight, real-time private chat for **exactly two people**.

- Hosted on a phone (Android/Termux) or a small PC, running in the background.
- Exposed to the internet through a **Cloudflare Tunnel**, so both people can use
  it from anywhere without installing an app — just a browser.
- **Login-code protected.** Each person gets their own code. A code is meant to
  be usable by one device at a time (that is the privacy feature).
- Must stay lightweight: low CPU/RAM, no build step, no framework, no bundler.
- Works on Android, iPhone, and desktop browsers.

`guftago` is Urdu for "conversation / talk". **The app is called Guftago.** It is
never "Couple Chat", even though the npm package name and the systemd/plist files
still say `couplechat` (historical artifact — do not rename them unless asked).

### What already works (do not break these)

Chat, media uploads (photo/video/audio/GIF files), voice recording, reactions,
replies, edit/delete, read receipts, self-destructing messages, scheduled
messages, drafts, bookmarking, search, export, chat stats, wallpapers,
dark/light theme, end-to-end encryption (ECDH P-256 + HKDF + AES-GCM), and an
admin panel that can generate partner codes, rename people, upload profile pics,
and kick sessions.

It is a small app — about 721 lines of server and 2059 lines of client — so a
complete audit is realistic. That is exactly what is being asked for.

---

## 2. Non-negotiable rules

These come from real friction. Breaking them will get the work rejected.

1. **Test before you claim anything works.** The user has said, verbatim:
   *"I told you before shipping anything check everything is working fine or not."*
   Two broken releases were shipped before. Do not be the third.
2. **The name is Guftago.** Not "Couple Chat". Check the `<h1>`, header, and title.
   Fix any user-visible occurrence you find (but see §11 before renaming files,
   services, or npm packages).
3. **No pink theme, no extra themes.** Dark/light toggle only. There are leftover
   pink values in `public/manifest.json` — see §11.
4. **The logo is `public/cat-logo.jpg`.** Do not swap it for another cat or an emoji.
5. **Keep it lightweight.** No frameworks, no build step, no new heavy dependency.
   `express`, `socket.io`, `dotenv`, `sharp`, `multer` — that is the whole list.
   Do not add `helmet`, `cors`, `express-rate-limit`, `socket.io-client`, a test
   framework, a bundler, or TypeScript. Solve these problems with what is already
   there, or with Node built-ins.
6. **Never commit `data/`.** It holds `chat.db` and all uploaded media. It is
   gitignored; keep it that way. Never delete `data/` to "fix" a problem.
7. **No GIF search API.** Tenor was shut down by Google (June 30, 2026) and the
   Klipy alternative was rejected by the user. Users paste GIF URLs or upload
   GIF files directly. Do not add an API key or a search endpoint.
8. **Audio recording requires HTTPS.** `getUserMedia` only works on `localhost`
   or a secure origin. Do not "fix" microphone failures on a plain-HTTP LAN URL —
   explain that it needs the tunnel.
9. **Bump the cache-buster when you change `public/` files.** `public/index.html`
   references `/style.css?v=11` and `/app.js?v=11`, and `public/sw.js` has
   `const CACHE = 'chat-v7'`. Change a cached asset → bump both, or the user will
   see stale code and report the bug as unfixed. **This has already happened.**
10. **Handoff docs and other agents' claims are inputs, not facts.** See §5.1.
11. **Do not widen the attack surface to save effort.** No `cors: '*'`, no
    unauthenticated endpoints, no `eval`, no new inline event handlers. If a fix
    requires opening a hole, pick a different fix.
12. **State your evidence.** Report exactly what you ran and what came back.

---

## 3. First things first — the working tree is dirty

There is uncommitted work sitting on top of the last commit. **Deal with it before
you start**, so your fix is a clean, reviewable diff and you can tell your changes
apart from the existing ones.

```bash
cd "/Users/gohsa/Documents/Default Project"
git status --short
git log --oneline -3
```

Expected state:

```
 M public/app.js        # E2EE client code
 M public/index.html    # encryption badge + cache-buster v11
 M public/style.css     # .enc-badge styles
 M server.js            # pubkey relay + userPubkeys map
```

That diff (144 insertions, 14 deletions) is a **complete, working E2EE feature**
from a previous session. HEAD should be `4d3718a`.

Choose one, and say which you chose:

```bash
# Option A (recommended): commit the existing work as its own commit
git add -A && git commit -m "feat: end-to-end encryption (ECDH P-256 + HKDF + AES-GCM)"

# Option B: stash it
git stash push -u -m "e2ee work in progress"
```

Do **not** delete that diff. It is real feature work, and it is the reason the
`enc-badge` element exists in the HTML. If you choose B, `git stash pop` before
you finish so the user gets their encryption back.

> If `HERMES_TASK.md` and `scripts/session-test.mjs` are still untracked, that is
> expected — they are the handoff package. Commit them with the E2EE work or in
> their own commit; do not delete them.

---

## 4. Stack, layout, run

| Layer | Choice |
|---|---|
| Runtime | Node.js **>= 22.5.0** (uses built-in `node:sqlite`) |
| Server | Express 4.x |
| Realtime | Socket.IO 4.x |
| Database | SQLite, single file `data/chat.db` |
| Images | `sharp` (server) + canvas (client) |
| Uploads | `multer` |
| Frontend | Vanilla HTML/CSS/JS — **no framework, no build step** |
| Tunnel | `cloudflared` |

> ⚠️ The local machine runs **Node v26.13.0**. `node:sqlite` prints an
> ExperimentalWarning. That is normal and not a bug.

```
Default Project/
├── server.js                 # Express + Socket.IO + SQLite + uploads + cleanup (~721 lines)
├── package.json              # scripts: start, dev, background
├── .env                      # PORT, APP_NAME, ADMIN_CODE, names, cleanup settings (gitignored)
├── README.md                 # full setup guide
├── START_HERE.md             # quick start
├── GUFTAGO_HANDOFF.md        # previous season's handoff notes
├── HERMES_TASK.md            # ← this file
├── public/
│   ├── index.html            # both screens (login + chat) in one page (~273 lines)
│   ├── app.js                # all client logic (~2059 lines, one IIFE)
│   ├── style.css             # all styling (~910 lines, dark/light tokens)
│   ├── sw.js                 # service worker, CACHE = 'chat-v7'
│   ├── manifest.json         # PWA manifest
│   └── cat-logo.jpg          # the logo — keep it
├── scripts/
│   ├── session-test.mjs      # ← test harness I wrote for you (§14)
│   ├── start.sh / stop.sh / tunnel.sh
│   └── setup-termux.sh, setup-named-tunnel.sh, deploy-android.sh, *.plist, *.service
└── data/                     # gitignored: chat.db, uploads/{photos,videos,audio,gifs}
```

### Run it

```bash
npm start                  # foreground, port 3000
npm run background         # nohup, logs to data/server.log, pid in data/server.pid
curl -s localhost:3000/api/health   # → {"status":"ok","uptime":...,"users":N}
```

`public/` is served from disk, so HTML/CSS/JS edits need only a browser refresh.
**`server.js` edits require a restart.** Check the port before you start — the
server may already be running (§5).

### Environment (`.env`)

```
PORT=3000
APP_NAME=Guftago
ADMIN_CODE=ADMIN-MASTER        # admin's login code
ADMIN_NAME=...
PARTNER_CODE=...               # fallback seed only; real partner codes are generated in the admin panel
PARTNER_NAME=...
CLEANUP_PHOTOS_DAYS / VIDEOS / AUDIO / GIFS / INTERVAL_HOURS
```

The database `access_codes` table is the source of truth for valid codes;
`PARTNER_CODE` only seeds a default on first run.

### Database shape (relevant bits)

```sql
-- server.js:34-43
CREATE TABLE IF NOT EXISTS access_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,     -- ← UNIQUE; this matters in §9 C9
  role TEXT NOT NULL DEFAULT 'partner',
  name TEXT,
  profile_pic TEXT,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  used_at INTEGER                -- ← written on login, never read; see §9 C14
);
```

The `messages` table holds text/media rows; `filename` points into
`data/uploads/<folder>/`, and `url` is derived from it in `formatMessage`.

---

## 5. Live-state baseline — verify before you believe anything

### 5.1 The verification rule

The user reports that they "linked my data with anti-gravity" and told another
agent ("anti-gram") to verify everything before the review. Treat that as
**unverified input**. So does this document. Specifically:

- A previous agent saying "it works" is not evidence.
- A handoff doc describing a feature is not evidence that the feature currently works.
- Reading code and imagining the runtime behaviour is not evidence. This document
  labels those reads **LIKELY** or **VERIFY** for that reason.
- **Evidence** is: a command you ran, the exact output, and the state you observed.
- Two subagents from a prior session were started and never reported success
  (`ses_e2ee4c5f7ffedAbE1YNz8IngGt`, `ses_e2ee45d49ffeKGt4nFEyTDPim6`). Re-verify
  anything attributed to them.

If your belief and the running app disagree, the running app wins.

### 5.2 Baseline recipe — run this first, paste the output in your report

```bash
cd "/Users/gohsa/Documents/Default Project"

# 1. Repo state
git status --short
git log --oneline -3
git remote -v

# 2. Is something already listening?
lsof -nP -iTCP:3000 -sTCP:LISTEN

# 3. Live app state
curl -s localhost:3000/api/health
curl -s -H "x-admin-code: $ADMIN_CODE" localhost:3000/api/admin/sessions

# 4. Data state (do not modify)
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/chat.db');
for(const t of ['messages','access_codes']) console.log(t, d.prepare('SELECT COUNT(*) c FROM '+t).get().c)"
find data/uploads -type f | wc -l
du -h data/chat.db
```

The state I observed on Nov 13, 2026 (use it as a comparison, not as truth):

```
node 8519 ... TCP *:3000 (LISTEN)
{"status":"ok","uptime":14504.4,"users":0}
[]
messages 9
access_codes 2
6        # files under data/uploads
32K      # data/chat.db
```

If `users` is non-zero while no browser is open, you are looking at the bug in §6
— write that number down before you change anything.

### 5.3 Confidence labels used in this document

| Label | Meaning |
|---|---|
| **CONFIRMED** | I read the exact code and/or reproduced it against the running server. Assume it is true unless you disprove it. |
| **LIKELY** | The code path clearly allows it, but I did not execute the exploit. Prove it before you claim it in your report. |
| **VERIFY** | A suspicion worth checking. It may be a false alarm. Check, then either fix it or say why it is not a bug. |

### 5.4 Unblocking a locked session (only if you need to)

If you cannot log in or run the harness because a ghost owns the code:

```bash
node scripts/session-test.mjs sessions            # see what holds the code
node scripts/session-test.mjs kick ADMIN-MASTER   # force-release it
node scripts/session-test.mjs probe ADMIN-MASTER  # should now PASS
```

This is a workaround, **not** the fix. If you find yourself using it twice, the
root cause is still there.

### 5.5 Leave the app usable when you finish

When you are done, the server must be running, `users` must be `0` (or exactly
the number of real open browsers), `sessions` must contain no ghost, and the admin
code must still be able to log in. A broken app at the end of a "fix" is a failed
task. If you must stop the server, say so explicitly in the report and tell the
user how to start it.

---

## 6. Priority 1 — the login bug

### 6.1 What the user sees

They open the app, it auto-logs-in with their saved code, and instead of the chat
they get a popup:

> **Code Already In Use**
> This code is being used on another device. Only one session per code is allowed.

and then they are bounced back to the login screen with
*"Code already in use. Try a different code."* Their code is correct. Nothing is
wrong with their password. They are locked out of their own account.

### 6.2 Proof — I reproduced it

Health check showed a user connected while no browser was open:

```
GET /api/health  →  {"status":"ok","uptime":11762,"users":1}
```

The ghost was 3 hours old:

```
GET /api/admin/sessions  →  [{"code":"ADMIN-MASTER","name":"Admin","role":"admin",
                              "connectedAt":"Fri Nov 13 2026 19:38:22 GMT+0530"}]
```

A fresh handshake against the live server was rejected:

```
sid=Z4g7TuEbGTo4g3kNAAAK
POST 40{"code":"ADMIN-MASTER"}  → ok
GET  (poll)                     → 44{"message":"This code is already in use. Only one session per code allowed."}
```

Kicking the ghost fixed it instantly, which proves the code and the account were
fine all along:

```
POST /api/admin/kick-session {"code":"ADMIN-MASTER"}  → {"success":true}
GET  /api/admin/sessions                              → []
GET  /api/health                                      → {"users":0}
```

I then reproduced the whole cycle with the harness in §14 — connect, abandon the
socket, attempt to reconnect → rejected. Same error, every time.

### 6.3 Root cause

`activeSessions` is a plain `Map` of `code → socket` with **no expiry, no
takeover, and no reliable release**.

`server.js:156` (as of `4d3718a`):

```js
const activeSessions = new Map(); // code -> socket
```

`io.use` middleware (`server.js:159-173`):

```js
const entry = findCode(code);
if (!entry) return next(new Error('Invalid code'));

// Check if code is already in use by an active session
const existingSocket = activeSessions.get(code);
if (existingSocket && existingSocket.connected) {
  return next(new Error('This code is already in use. Only one session per code allowed.'));
}

socket.partner = { ... };
activeSessions.set(code, socket);   // ← claimed BEFORE the connection is confirmed
next();
```

The `disconnect` handler (`server.js:337-349`) is the only thing that ever frees a code:

```js
socket.on('disconnect', () => {
  if (activeSessions.get(socket.partner.code) === socket) {
    activeSessions.delete(socket.partner.code);
  }
  ...
});
```

### 6.4 Why `disconnect` is not enough — the full defect list

Fix all of these. Each one is an independent way to get locked out.

| # | Defect | Where | Why it matters |
|---|---|---|---|
| D1 | No TTL / heartbeat. A socket that dies without a clean close keeps the entry forever as long as `.connected` is truthy. | `activeSessions`, `io.use` | This is the reported lockout. A force-quit app, a dropped wifi, a phone that sleeps — any of these leaves a ghost that survives for hours. |
| D2 | No takeover path. A second connection from the **same** device just gets rejected. | `io.use` | Two tabs in the same browser, or a reload racing an old socket, locks the user out of their own account. **This is the most likely everyday trigger.** |
| D3 | No device identity. The client sends only `{ code }`. | `public/app.js` `connectSocket` | The server cannot tell "same phone, new tab" from "someone on another phone". So it cannot safely allow the first and block the second. |
| D4 | No `pagehide` / `beforeunload` handler. Closing the tab does not tell the server anything. | `public/app.js` | Every tab close is a potential ghost. |
| D5 | No logout button anywhere. | `public/app.js`, `public/index.html` | The user has no way to voluntarily release their code. |
| D6 | Auto-login fires on **every** page load. | `public/app.js:256-257` | Each reload creates a new socket immediately, competing with the old one → triggers D2 constantly. |
| D7 | `activeSessions.set(...)` runs inside `io.use`, **before** the connection is confirmed. | `io.use:171` | If the transport aborts mid-handshake, the entry is written and no `disconnect` ever fires → a ghost is born. |
| D8 | `connect_error` only handles the literal substring `already in use`. | `public/app.js:472-492` | Any other error (network blip, auth failure, server restart) produces **no UI at all** and retries forever in silence. The user sees a dead screen. |
| D9 | `POST /api/login` writes `used_at` on every successful login. | `server.js:442-443` | The column implies "this code is consumed / single-use", but nothing reads it, and login does not check `activeSessions`. So the REST call succeeds and the failure surfaces later as a Socket.IO popup — confusing UX and a misleading database. |

**One more consequence worth understanding:** because `POST /api/login` does not
consult `activeSessions`, the user gets a *successful* login response, sees the
chat screen for a moment, and only then the socket fails. The error looks like a
crash rather than a session conflict. Your fix should make the failure appear
before the chat screen opens, or better, not happen at all.

---

## 7. Required behaviour after the login fix

The privacy rule survives: **at most one live session per code, across devices.**
What changes is that the server can now tell the difference between a live
session and a dead one, and between the same device and a different one.

### B1. Same device, reload / new tab → never blocked

- On first load, generate a stable device id and persist it:
  `localStorage['guftago:deviceId']` (e.g. `crypto.randomUUID()`).
- Send it in the Socket.IO auth payload: `io({ auth: { code, deviceId } })`.
- On connect, if `activeSessions` holds an entry for this code **with the same
  `deviceId`**, silently disconnect the old socket and replace it. No error, no
  prompt. The user simply sees their chat.

### B2. Different device → explicit takeover prompt, not a silent wall

- If the held session has a **different** `deviceId` and is **genuinely alive**
  (seen within the TTL), reject the new connection with a distinguishable error,
  e.g. `err.data = { code: 'CODE_IN_USE', since: <lastSeen>, deviceLabel }`.
- The client must render a real choice:
  **"Use here instead"** → emits a `takeover` event, server disconnects the old
  socket and promotes the new one.
  **"Cancel"** → stays on the login screen, no retry storm.
- The displaced socket receives a `session:replaced` event ("Your session was
  opened on another device") and its client returns to the login screen. Do not
  reuse the existing `revoked` handler verbatim if that handler deletes the
  stored code — a takeover on the same account should not wipe the user's saved
  login.

### B3. Server-side liveness with a TTL

- Track `lastSeen` per session, updated on connect, on every message/event, and
  on the Socket.IO heartbeat (`socket.conn.on('packet')` or `ping`/`pong`).
- A `setInterval` sweep (every ~15s) evicts any entry whose `lastSeen` is older
  than **TTL = 60s**, disconnecting the socket if it is still technically open
  but silent.
- Must be `unref()`'d or cleared on shutdown so it does not hold the process open
  (this is also a §9 defect — see C7).
- Pick TTL ≥ Socket.IO's default `pingInterval(25s) + pingTimeout(20s) = 45s`, so
  a healthy idle socket is never evicted. 60s is the recommended value.

### B4. Explicit and implicit release

- Add a **Logout** button in the chat header (and/or admin panel). On click:
  emit `logout`, wait for the ack, `socket.disconnect()`, clear the stored auth
  (`code`, `user`, `myName`, `otherName`, `myPic`, `otherPic`, draft if
  appropriate), and return to the login screen. The code must be free
  **immediately** — verify with the harness.
- Add `window.addEventListener('pagehide', ...)` and `beforeunload` handlers that
  do a best-effort `socket.disconnect()` (or send a `logout` with
  `keepalive`-style fire-and-forget). Do **not** clear the saved code on
  `pagehide` — that would log the user out on every navigation.

### B5. No ghost from an aborted handshake

- Move `activeSessions.set()` out of `io.use` and into the `connection` handler,
  **after** the socket is confirmed. In `io.use` only validate and stash
  `socket.partner`.
- Also release on `socket.conn.on('close')` and on `connection_error`, so an
  aborted transport never leaves an entry behind.

### B6. Honest `connect_error` handling

Replace the substring check with a real branch:

- `err.data?.code === 'CODE_IN_USE'` → takeover prompt (B2).
- `Invalid code` → show it on the login form and stop retrying.
- Anything else → show a visible "Can't reach the server — retrying…" banner and
  retry with **capped exponential backoff** (e.g. 1s, 2s, 4s, 8s, 15s max,
  ~10 attempts), then stop and show a manual Retry button. Never retry forever
  in silence.

### B7. Clean up the `used_at` lie

- Remove the `used_at` write from `POST /api/login`, **or** repurpose it to a
  clearly-named `last_login_at` column (add via migration, keep the old column).
  Whichever you choose, login must not imply the code is consumed.
- Make `POST /api/login` aware of `activeSessions` so it can return
  `409 { error, code: 'CODE_IN_USE' }` instead of a false success. The frontend
  should handle that before calling `showChat()`.

### B8. Admin panel must stay useful

- `/api/admin/sessions` should expose `lastSeen`, `deviceId` (shortened), and a
  `connected` boolean, so the operator can see whether a session is real.
- `POST /api/admin/kick-session` must work **even if** the socket still looks
  connected (force `socket.disconnect(true)`), and must also succeed for a stale
  entry with no socket object (delete the entry and return success).

---

## 8. Priority 2 — security defects (read this before you touch the API)

These are independent of the login bug and, for a privacy app, arguably worse.
All are **CONFIRMED** unless labelled otherwise.

The root cause is the same in every case: **the REST API has no session concept.**
Socket.IO checks the code; `app.get` / `app.post` do not. `requireAdmin`
(`server.js:473-478`) only guards the admin endpoints, and it trusts a
client-supplied header.

### S1 — The entire message history is public

`server.js:637-643`:

```js
app.get('/api/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  const rows = getMessages.all(limit, offset);
  res.json(rows.map(formatMessage));
});
```

No code, no header, no check. `curl https://<tunnel>/api/messages` returns every
message, including media URLs, sender names, and message contents that are meant
to be end-to-end encrypted in transit. **CONFIRMED by reading the route; verify
with T9.**

### S2 — Bookmarks are public

`server.js:645-648` — same problem, `GET /api/bookmarks`. **CONFIRMED; T10.**

### S3 — Uploads are unauthenticated, and the extension is attacker-controlled

`server.js:602` — `app.post('/api/upload', upload.single('file'), ...)` — no auth.
`server.js:145-148`:

```js
filename: (req, file, cb) => {
  const ext = path.extname(file.originalname) || '';
  cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
},
```

`file.originalname` is fully client-controlled, and the declared MIME type is
client-controlled too. `type` is then inferred from `file.mimetype`
(`server.js:605-608`); anything that is not `video/*`, `audio/*`, or `image/gif`
falls through to `photo`. `sharp` compression is attempted only for `photo`
(`server.js:611`) and its failure is swallowed (`catch (e) { console.error(...) }`),
so the original bytes and the original extension stay on disk.

### S4 — `/uploads` serves attacker-controlled HTML from the app's own origin

`server.js:134`:

```js
app.use('/uploads', express.static(uploadsDir));
```

`express.static` sets `Content-Type` from the file extension. Upload
`evil.html` (or `evil.svg`) → it is stored at
`data/uploads/photos/<ts>-<rand>.html` → `GET /uploads/photos/<ts>-<rand>.html`
returns it as `text/html` **on the same origin as the app**. Any script in it can
read `localStorage`, which contains the user's `code`, `adminCode`, `user`,
`myName`, `myPic`. That is a complete account takeover, and the app has no
CSP to stop it. **S3 + S4 chain is LIKELY-exploitable until you test it; treat it
as real. T11/T12.**

### S5 — The login endpoint has no rate limit

`server.js:438` accepts unlimited attempts. Generated codes are 8 characters from
a 32-character alphabet (`generateCode`, `server.js:63-68`), so brute force is
impractical — **but** the admin UI lets a human choose a custom code as short as
**4 characters** (`server.js:486`, `server.js:593`). A 4-character code from a
32-character alphabet is 1,048,576 combinations, trivially enumerable over HTTP
at a few hundred requests per second. **CONFIRMED; T14.**

### S6 — `cors: { origin: '*' }`

`server.js:122`:

```js
const io = new Server(server, { cors: { origin: '*' } });
```

Any website can open a Socket.IO connection to the tunnel. Socket.IO itself
requires the code, so this is not an instant breach, but it removes the browser
as a barrier and enables cross-origin probing. Narrow it to the app's own origin
(`true` / same-origin, or an explicit allow-list). **CONFIRMED.**

### S7 — `change-admin-code` can permanently lock the admin out

`server.js:591-599`:

```js
app.post('/api/admin/change-admin-code', requireAdmin, (req, res) => {
  const { newCode } = req.body;
  if (!newCode || newCode.length < 4) return res.status(400).json({ error: '...' });
  db.prepare("UPDATE access_codes SET active = 0 WHERE role = 'admin'").run();   // ← deactivates first
  db.prepare("INSERT INTO access_codes (code, role, name, created_at, active) VALUES (?, 'admin', ?, ?, 1)")
    .run(newCode, ADMIN_NAME, Date.now());                                        // ← UNIQUE may throw
  res.json({ code: newCode, message: '...' });
});
```

`access_codes.code` is `UNIQUE` (`server.js:36`). Because the old admin code is
deactivated **before** the insert, and there is no `try/catch`, two outcomes are
possible and both are bad:

- If `newCode` already exists (e.g. the current admin code, or a partner code),
  the insert throws → Express returns **500**, and **no admin code is active**.
  The admin is locked out permanently, with no UI path back in.
- If `newCode` is valid and unused, it works — but the old code is silently
  deactivated without confirmation, and the user's browser still has the old one
  saved, which will fail on the next load.

Fix: validate first (reject existing/inactive-but-reserved codes with 400), use a
transaction, insert before deactivating, and return the new code. **CONFIRMED;
T15.**

### S8 — `escHtml` does not escape quotes, but it is used in attribute positions

`public/app.js:181`:

```js
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
```

`textContent` → `innerHTML` escapes `&`, `<`, `>` and **not** `"` or `'`. It is
then interpolated into quoted attributes, e.g.:

```js
// app.js:633
bubble = replyCtx + `<div class="message-media"><img src="${escHtml(msg.url)}" alt="photo" loading="lazy"></div>`;
// app.js:641
`<button class="audio-play-btn" data-url="${escHtml(msg.url)}">▶</button>`
// app.js:1744, :1905
`<button ... data-code="${escHtml(s.code)}" ...>`
```

For uploaded media `msg.url` is server-derived (`/uploads/...`), so the practical
risk is low there. But for a **GIF message** `msg.url` is `m.content`, which is a
URL the other participant pasted (`server.js:365`), and nothing validates it
(`/api/gif/validate` exists but is never called). A URL like
`x" onerror="fetch('/api/messages')"` breaks out of the attribute. **LIKELY;
verify in T13.** Fix `escHtml` to also escape `"`, `'`, and `` ` `` — that is a
one-line change and closes the class of bug.

### S9 — Static files have no `nosniff`, and `/uploads` has no download policy

`server.js:125-134` sets `Cache-Control` on html/css/js and nothing else. There is
no `X-Content-Type-Options: nosniff` anywhere. Combined with S4 this makes MIME
confusion attacks easier. Add `nosniff` globally, and make `/uploads` send
`Content-Disposition: attachment` (or serve user media from a route that forces a
safe content type) for anything that is not a known image/video/audio type.
**CONFIRMED.**

### What "fixed" means for §8

- `GET /api/messages`, `GET /api/bookmarks`, `POST /api/upload` reject requests
  without a valid code (401/403), and the legitimate client still works.
- Uploads reject any file whose real type is not image/video/audio, and never
  preserve a `.html`/`.svg`/`.js` extension.
- `/uploads` responses carry `nosniff` and cannot execute script on the app origin.
- Login is rate-limited with a simple in-memory counter (no new dependency).
- `change-admin-code` cannot leave the system with zero active admin codes.
- `cors` is not `'*'`.

Pick the authentication mechanism that fits the existing architecture. The
cleanest minimal option is a signed session token issued by `POST /api/login`
(e.g. an HMAC over `code + issuedAt` using a secret from `.env`) and sent by the
client as `x-session` on every REST call. Do **not** send the raw code in a
header on every request if you can avoid it, and do not store the raw code in
`localStorage` beyond what already exists. If you choose a different scheme,
write down why in the report.

**Test contract — T9–T13 will call it exactly like this**, so that a green test
means "the route is protected and still works" and not "the route returned some
4xx for some reason":

- `POST /api/login` keeps its current request shape, and on success also returns
  the REST credential in a top-level `token` field.
- Every authenticated REST route accepts that credential as `x-session: <token>`.

If you pick a different header name, keep the `token` field, say which header in
your report, and translate the `curl` lines. Do **not** weaken an assertion to
"any 4xx": with no token you cannot tell *401 because unauthenticated* from
*401 because the route is broken*, which is the whole point of the test.

---

## 9. Priority 3 — correctness & robustness register

Each row is a separate defect. Fix the **CONFIRMED** ones. Investigate the
**LIKELY**/**VERIFY** ones and either fix them or explain why they are not bugs.
Do not "fix" by rewriting large areas — keep diffs surgical.

| # | Sev | Conf | Defect | Where | Fix |
|---|---|---|---|---|---|
| C1 | high | CONFIRMED | Duplicate `dblclick` listener on every message bubble. Two handlers fire → reaction picker opens twice / toggles closed immediately. | `public/app.js:732` **and** `:755` (identical line) | Delete one. Then verify the picker opens exactly once per double-tap. |
| C2 | med | CONFIRMED | `isAdmin` is read before it is assigned. `otherName` falls back to `'Admin'` for an admin, and `'Partner'` handling is wrong on first login. | `public/app.js:229` reads `isAdmin`; `:232` assigns it | Assign `isAdmin` before the `otherName` line. |
| C3 | med | CONFIRMED | `onlineUsers` is a `Set` keyed by **userId only**. The same user opening a second tab deletes the other tab's presence on disconnect; `users` in `/api/health` is wrong. | `server.js:176`, `:181`, `:346` | Key by `socket.id` (a `Map` socketId → userId), and report the distinct user count in health. |
| C4 | med | CONFIRMED | N+1 query: `formatMessage` runs a `SELECT` per message with a reply. `GET /api/messages?limit=200` can issue 201 queries. | `server.js:372` | Batch: one query joining `messages` to the parent row, or preload reply targets into a `Map` before mapping. |
| C5 | low | CONFIRMED | The folder-name ternary is duplicated 5× with the same logic. Easy to drift. | `server.js:328`, `:363`, `:404`, `:626`, `:684` | One `folderFor(type)` helper. |
| C6 | low | CONFIRMED | `deleteOldMedia` prepared statement is defined and never used. | `server.js:117` | Delete it (see §10). |
| C7 | med | CONFIRMED | Two `setInterval`s are not `unref()`'d, and graceful shutdown does not clear them. `SIGTERM` waits on open handles, so `npm run background` + `kill` can hang. | `server.js:699`, `:702`, shutdown `:719-721` | Keep handles, `clearInterval` both in a shared `shutdown()`, `unref()` them, and close the HTTP server before `exit`. |
| C8 | med | CONFIRMED | Upload `type` is inferred from the client-supplied MIME string, and the `sharp` failure path keeps the original file. | `server.js:605-626` | Sniff the real type (`sharp().metadata()` for images; a magic-byte check for others) or reject anything not on an allow-list. See S3/S4. |
| C9 | high | CONFIRMED | `change-admin-code` deactivates the old code before inserting the new one, with no duplicate check and no transaction. `UNIQUE` collision → 500 → zero active admin codes → permanent lockout. | `server.js:591-599` | See S7. |
| C10 | med | CONFIRMED | All admin routes trust `x-admin-code` / `body.adminCode`, but the client stores `adminCode` in `localStorage` and sends it from JS. Any XSS (S4/S8) exfiltrates it. | `server.js:473-478`, `app.js:1731`+ | Acceptable **only after** S4/S8 are fixed. Otherwise move to the session token from §8. |
| C11 | low | CONFIRMED | `GET /api/health` publishes the live user count and uptime to the world. Minor info leak, but free to remove. | `server.js:665-667` | Keep `status`/`uptime`; drop `users`, or require the admin code for it. |
| C12 | med | VERIFY | The `revoked` handler (`public/app.js:441-469`) deletes the saved code. If a takeover reuses it, the user loses their login on the other device. | `app.js:441-469` | Confirm the behaviour, then use a distinct `session:replaced` event (B2) that does not clear the saved code. |
| C13 | low | CONFIRMED | Inline `onclick`/`onmouseover` handlers are generated as strings (`window._ctxReact(...)` etc.). They work only because the functions are on `window`, and they block a future CSP. | `app.js:450`, `:481`, `:1443-1452` | Replace with `addEventListener` and `data-*` attributes. Not urgent, but do it in the file you are already editing. |
| C14 | low | CONFIRMED | `POST /api/login` writes `used_at` on every login; nothing reads it. | `server.js:442-443` | See B7. |
| C15 | low | CONFIRMED | Scheduled-message tick broadcasts with `io.emit('message', ...)`. With two users this is harmless, but it ignores per-code targeting and will send to any future observer. | `server.js:705` | Emit only to the sockets for the two valid codes, or leave it and note it as intentional. |
| C16 | low | CONFIRMED | The server file header is wrong on both counts: says "Couple Chat" and "better-sqlite3", but the code uses `node:sqlite`. | `server.js:1-2` | `// Guftago — Ultra-lightweight self-hosted private chat server` / `node:sqlite`. |
| C17 | low | CONFIRMED | `package.json` still has `"name": "couple-chat"`. | `package.json` | See §11 — probably leave it, but decide explicitly. |
| C18 | low | VERIFY | `runCleanup` deletes message rows but does not delete dependent rows (reactions, bookmarks are columns, reply targets may dangle). If there is no `ON DELETE CASCADE`, reply previews can go blank. | `server.js:670-690` | Check the schema; if no cascade, delete dependents explicitly or null the `reply_to`. |
| C19 | low | VERIFY | `formatMessage` splits `reactions` on `,` and `:`. An emoji or user value containing either character corrupts the parse. | `server.js:352-360` | Acceptable for fixed emoji + fixed user ids; confirm nothing else writes this column. |
| C20 | low | VERIFY | `express.json({ limit: '1mb' })` applies to all routes, but uploads use `multipart`. A 1 MB JSON body is generous for a two-person chat; no issue found, but check `multer` limits exist. | `server.js:124`, `:150-155` | Confirm `limits` are set; if not, add `fileSize` and `files: 1`. |

> **Do not "fix" C13 by adding a CSP you then have to fight.** Either convert the
> inline handlers properly or leave them and note it. Half-measures break the UI.

---

## 10. Priority 4 — dead code & unnecessary surface

Delete only what you can prove is unused. For each item, the **evidence** is a
grep over the whole repo (`public/`, `scripts/`, `server.js`). Paste the grep in
your report. If something is referenced, do not delete it — instead say so.

| # | Item | Evidence | Action |
|---|---|---|---|
| X1 | `POST /api/gif/validate` (`server.js:651-663`) | `grep -rn "gif/validate" .` → no hits outside `server.js` | Delete the route. GIF URLs are pasted, not validated; see rule 7. |
| X2 | `GET /api/profile-pics` (`server.js:584-589`) | `grep -rn "profile-pics" public/ scripts/` → no hits | Delete the route. Profile pics arrive via `/api/login` and `/api/admin/update-pic`. |
| X3 | `const deleteOldMedia = db.prepare(...)` (`server.js:117`) | Only occurrence in the repo | Delete the line (C6). |
| X4 | Wrong file header (`server.js:1-2`) | Read it | Correct it (C16). |
| X5 | Pink PWA palette (`public/manifest.json`) | `background_color: "#fff5f7"`, `theme_color: "#ff6b8a"` | Replace with the dark palette from `public/style.css`. |
| X6 | Wrong icon MIME + sizes (`public/manifest.json`) | `/cat-logo.jpg` declared `"type": "image/png"`, one `192` entry | Set `image/jpeg`, verify real dimensions with `sips -g pixelWidth -g pixelHeight public/cat-logo.jpg`, fix/duplicate the icon entries. |
| X7 | Stale service worker cache (`public/sw.js`) | `const CACHE = 'chat-v7'` | Bump to `chat-v8` **when** you change cached assets. |
| X8 | Stale cache-buster (`public/index.html`) | `/style.css?v=11`, `/app.js?v=11` | Bump to `v12` in the same change. |
| X9 | `require('path')` / `require('fs')` etc. | Check each `require` is used | Remove any genuinely unused import. Do not remove `sharp`/`multer` — they are used. |

### Explicitly **not** dead — do not delete

- `userPubkeys` and the pubkey relay in `server.js` — used by E2EE.
- The `enc-badge` element and its CSS — E2EE status indicator.
- `public/cat-logo.jpg` — the required logo.
- `scripts/setup-termux.sh`, `scripts/*.plist`, `scripts/*.service`,
  `scripts/deploy-android.sh` — deployment paths the user actually uses, even if
  they reference the old `couplechat` name.
- `GUFTAGO_HANDOFF.md`, `README.md`, `START_HERE.md` — documentation.
- The `self_destruct` / `scheduled` machinery in `server.js` — features in use.

If a "dead" item turns out to be referenced by a file you did not grep (a shell
script, the service unit, the README), leave it and report it.

---

## 11. Housekeeping: naming, manifest, cache, and scope of renames

These are cheap, but they are the ones that make the user think nothing changed.

1. **Name.** User-visible text must say **Guftago**. Check `public/index.html`
   `<title>`, the `<h1>`, `document.title` assignments in `app.js`, and the
   login/chat headings. `APP_NAME` in `.env` is already `Guftago`.
2. **Code-level names stay.** `package.json` `"name": "couple-chat"` and the
   `couplechat` service/plist paths are historical. Renaming them means editing
   `scripts/*.service`, `scripts/*.plist`, `scripts/deploy-android.sh`, and the
   install docs, and re-testing install on the phone. **Leaving them is
   acceptable and probably wiser.** Decide, do it consistently, and say why.
3. **Manifest.** Fix the pink palette (X5) and the icon MIME/sizes (X6). Keep
   `cat-logo.jpg`.
4. **Caching.** One change that touches `public/` assets = bump `?v=` in
   `index.html` **and** `CACHE` in `sw.js`. If you forget, the user will report a
   fixed bug as still broken. Verify by hard-reloading once after the change.
5. **No new themes.** Dark and light only. Do not add a colour picker or a third
   palette while "cleaning up".

---

## 12. Suggested implementation order

Work in this order so you always have a testable state. Commit after each phase.

1. **Baseline.** Run §5.2, paste the output, record `users`/`sessions`/counts.
2. **Clean tree.** Commit or stash the E2EE diff (§3). Confirm `git status`.
3. **Login, server side.** Session record `{ socket, deviceId, lastSeen, connectedAt }`,
   TTL sweep (unref'd), `io.use` validates only, claim in `connection`, release on
   `close`/`connection_error`, `logout` handler, takeover event, `CODE_IN_USE`
   shape, `used_at` fix, admin endpoints updated. Restart. Run `probe` `ghost`
   `reload`.
4. **Login, client side.** `deviceId` persistence, socket auth, `pagehide`/
   `beforeunload`, logout button, takeover prompt, `session:replaced` handler,
   capped retry + error banner, handle `409` before `showChat()`.
5. **Run T1–T8.** Fix until green. Do not proceed with a red login suite.
6. **Security.** S1–S9 in the order S3/S4 (upload + static) → S1/S2 (read auth) →
   S5 (rate limit) → S7 (admin code) → S8 (escHtml) → S6/S9 (headers, cors).
   Re-run T9–T12 after each step so the client does not break.
7. **Correctness.** C1–C20, smallest first. C1 and C2 are one-liners — do them
   early so you can see the UI working.
8. **Dead code.** X1–X9. After each deletion, `node --check server.js` and
   restart, then re-run the smoke test.
9. **Housekeeping.** Manifest, cache buster, name. Then a **hard reload** in a
   real browser and one manual pass of T18.
10. **Final verification.** §15. Paste real output. Leave the server healthy.

If you run out of time, stopping after step 6 is a coherent, shippable state.
Stopping after step 3 is **not** — a half-fixed session layer is worse than the
current bug.

---

## 13. Acceptance tests — all must pass

Run these against a **restarted** server. Paste the real output in your report.
Any single failure means the task is not done. Where a test says "EXPECT: FAIL",
that describes the **unfixed** behaviour and is there to prove the test can fail.

Set up once:

```bash
cd "/Users/gohsa/Documents/Default Project"
export ADMIN_CODE=$(grep '^ADMIN_CODE=' .env | cut -d= -f2-)
export BASE_URL=http://localhost:3000
npm start &   # or: npm run background
sleep 2
```

### Login suite (T1–T8)

#### T1 — Ghost session expires on its own

```bash
node scripts/session-test.mjs ghost   ADMIN-MASTER dev-ghost
node scripts/session-test.mjs probe   ADMIN-MASTER dev-probe   # EXPECT: FAIL (ghost holds the code)
sleep 65
node scripts/session-test.mjs probe   ADMIN-MASTER dev-probe   # EXPECT: PASS (TTL evicted the ghost)
node scripts/session-test.mjs sessions                          # EXPECT: []
```

Pass criteria: the first `probe` fails, the one after 65s succeeds, with no admin
intervention, and `sessions` shows no leftover entry.

> **Honesty note (I tested this):** the *current* server also passes this test
> when the abandoned transport eventually dies, because Engine.IO's ping timeout
> closes it and the old `disconnect` handler then frees the code. So T1 is a
> regression guard, not proof that the bug is fixed. The tests that actually
> distinguish the bug from the fix are **T2, T3, T4, T5** — a ghost that survives
> for hours (the user's real case) is exactly the case where the transport never
> dies, which the harness cannot reproduce on demand. Do not treat a green T1 as
> "login fixed".

#### T2 — Two tabs, same device → takeover, no lockout

```bash
node scripts/session-test.mjs hold   ADMIN-MASTER dev-A 20 &
sleep 2
node scripts/session-test.mjs probe  ADMIN-MASTER dev-A   # EXPECT: PASS
wait
```

Pass criteria: the second connect with the **same** `deviceId` is accepted and the
first is silently replaced. No error packet.

#### T3 — Different device → explicit conflict, old socket notified

Start the holder in the background and leave it running; run the probe and the
takeover **while it is alive**:

```bash
node scripts/session-test.mjs hold  ADMIN-MASTER dev-A 40 &
HOLDER=$!
sleep 2
node scripts/session-test.mjs probe ADMIN-MASTER dev-B     # EXPECT: FAIL with CODE_IN_USE, not a generic message
node scripts/session-test.mjs takeover ADMIN-MASTER dev-B  # EXPECT: PASS, exit 0
kill $HOLDER 2>/dev/null; wait $HOLDER 2>/dev/null
```

`takeover` reports which protocol shape it used (`emit "takeover"` or
`auth.takeover = true`). **Either is fine — pick one, implement it, and tell the
harness which one won** by leaving that shape in place. It exits 1 if neither
works, so this command *is* the test.

Pass criteria: `probe` with a different device id is rejected with a
machine-readable code, `takeover` promotes the new device and exits 0, and the
held socket receives `session:replaced` (visible as an `event:` line in `hold`'s
output) instead of dying silently.

#### T4 — Logout frees the code immediately

```bash
node scripts/session-test.mjs logout ADMIN-MASTER dev-A   # EXPECT: PASS, exit 0
```

`logout` runs the whole sequence for you: it connects as `dev-A`, emits
`logout`, then probes from a different device **while the first socket is still
open**. That detail matters — a clean socket close also frees the code, so a
test that closes first would pass even if `logout` did nothing. It exits 1 with
`logout did not release the code` if the release only happened on close.

Today it prints:

```
OK    session established as "dev-A"
      logout sent — probing from a different device while the first socket is still open
FAIL  connect rejected: This code is already in use. Only one session per code allowed.
FAIL  logout did not release the code; it only freed on transport close
```

Pass criteria: exit 0, within ~1s, no waiting for the TTL.

#### T5 — Ten rapid reloads, same device, never locked out

```bash
node scripts/session-test.mjs reload ADMIN-MASTER dev-A 10
```

Pass criteria: `10/10 ok`, `PASS`.

#### T6 — Admin kick still works

```bash
node scripts/session-test.mjs ghost  ADMIN-MASTER
node scripts/session-test.mjs sessions            # ghost visible, with lastSeen
node scripts/session-test.mjs kick   ADMIN-MASTER # EXPECT: {"success":true}
node scripts/session-test.mjs probe  ADMIN-MASTER # EXPECT: PASS
```

Pass criteria: kick succeeds even though the socket looks connected, and the code
is immediately reusable.

#### T7 — No ghost survives longer than the TTL

```bash
node scripts/session-test.mjs ghost ADMIN-MASTER
sleep 70
node scripts/session-test.mjs sessions   # EXPECT: []  (or an entry with fresh lastSeen only)
node scripts/session-test.mjs health     # EXPECT: users: 0
```

Pass criteria: the admin session list contains nothing older than 60s.

#### T8 — Nothing else regressed (manual, in a browser)

Two windows: use two tabs in the **same** profile to test the same-device path,
and one private window to test the different-device path (expect the takeover
prompt there).

- [ ] Send a text message both ways.
- [ ] Upload a photo, a video, an audio file, and a GIF file.
- [ ] React to a message; reply to a message.
- [ ] Edit and delete a message.
- [ ] Read receipts update.
- [ ] Self-destruct timer fires.
- [ ] A scheduled message sends.
- [ ] Draft saves and restores after reload.
- [ ] Search returns results; export downloads.
- [ ] Stats panel opens with sane numbers.
- [ ] Dark/light toggle works; `cat-logo.jpg` still displays.
- [ ] `enc-badge` still appears once both clients exchange keys.
- [ ] Admin panel: generate a partner code, rename, upload a profile pic.
- [ ] `curl -s localhost:3000/api/health` → `{"status":"ok",...}` with **no stale
      `users` count** when no browser is open.

### Security suite (T9–T15)

Each of these must **fail against the current code** and **pass after your fix**.
Capture both if you can; at minimum capture the post-fix pass.

#### T9 — Message history requires auth

```bash
curl -s -o /dev/null -w '%{http_code}\n' $BASE_URL/api/messages              # EXPECT: 401
curl -s -o /dev/null -w '%{http_code}\n' "$BASE_URL/api/messages?limit=500"  # EXPECT: 401

# Prove a real session can still read it. TOKEN is reused in T10–T13.
TOKEN=$(curl -s -X POST $BASE_URL/api/login -H 'Content-Type: application/json' \
  -d "{\"code\":\"$ADMIN_CODE\"}" | tr -d ' \n' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "token length: ${#TOKEN}"                                               # EXPECT: > 0

curl -s -o /dev/null -w '%{http_code}\n' -H "x-session: $TOKEN" $BASE_URL/api/messages  # EXPECT: 200
curl -s -H "x-session: $TOKEN" $BASE_URL/api/messages | head -c 200; echo    # EXPECT: a JSON array
```

Pass criteria: anonymous → 401; with a token → 200 and the same history the UI
shows. **If `TOKEN` is empty, stop and fix the login response first** — every
remaining API test is meaningless without it.

#### T10 — Bookmarks require auth

```bash
curl -s -o /dev/null -w '%{http_code}\n' $BASE_URL/api/bookmarks                        # EXPECT: 401
curl -s -o /dev/null -w '%{http_code}\n' -H "x-session: $TOKEN" $BASE_URL/api/bookmarks # EXPECT: 200
```

#### T11 — Upload requires auth

```bash
printf 'x' > /tmp/hx.txt

# Unauthenticated → rejected, and nothing is written:
curl -s -o /dev/null -w '%{http_code}\n' -F "file=@/tmp/hx.txt" $BASE_URL/api/upload     # EXPECT: 401

# Authenticated but wrong type → rejected for the *type*, not for auth:
printf '<script>document.title="pwn"</script>' > /tmp/hx.html
curl -s -o /dev/null -w '%{http_code}\n' -H "x-session: $TOKEN" \
  -F "file=@/tmp/hx.html;type=text/html" $BASE_URL/api/upload                           # EXPECT: 415 (not 401)

# Authenticated and legitimate → accepted (proves the guard is not just "always 4xx"):
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' \
  | base64 -d > /tmp/hx.png
curl -s -H "x-session: $TOKEN" -F "file=@/tmp/hx.png;type=image/png" $BASE_URL/api/upload | head -c 300; echo
```

Pass criteria: 401 / **415** / 200 respectively. Three distinct outcomes, three
different reasons — if all three are 401 the auth wiring is wrong; if the HTML
upload is 200 the type check is missing. Confirm nothing landed in `data/uploads`:

```bash
find data/uploads -name '*.html' -o -name '*.svg' | head
```

#### T12 — Disallowed file types are rejected (and real ones are not)

```bash
# Every one of these must be refused with 415, using the T9 token:
for f in hx.html; do printf '<script>document.title="pwn"</script>' > /tmp/$f; done
printf 'not-an-image' > /tmp/hx.svg
printf 'MZ\x90\x00' > /tmp/hx.exe

for f in /tmp/hx.html /tmp/hx.svg /tmp/hx.exe; do
  printf '%s ' "$f"
  curl -s -o /dev/null -w '%{http_code}\n' -H "x-session: $TOKEN" -F "file=@$f" $BASE_URL/api/upload
done   # EXPECT: 415 415 415

# And the allow-list still works for all four kinds the chat actually sends:
printf 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' | base64 -d > /tmp/hx.gif
for f in /tmp/hx.png /tmp/hx.gif; do
  printf '%s ' "$f"
  curl -s -o /dev/null -w '%{http_code}\n' -H "x-session: $TOKEN" -F "file=@$f" $BASE_URL/api/upload
done   # EXPECT: 200 200
```

Pass criteria: rejections are `415`, accepted files are `200`, and
`find data/uploads -name '*.html' -o -name '*.svg' -o -name '*.exe'` prints
nothing. `video/mp4` and `audio/webm` can be checked the same way with any small
real sample you have; if you do not have one, say so rather than skipping
silently.

> The point of the split: `401` means "you are not allowed to upload",
> `415` means "you are allowed, but that file type is not". A single test that
> accepts any 4xx proves neither.

#### T13 — Nothing from `/uploads`, and no message, can execute script

Three separate assertions. All three must hold.

**1. Storage — HTML/SVG never lands on disk** (repeat of T12, so T13 stands alone):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "x-session: $TOKEN" \
  -F "file=@/tmp/hx.html;type=text/html" $BASE_URL/api/upload     # EXPECT: 415
find data/uploads -name '*.html' -o -name '*.svg' | head          # EXPECT: empty
```

**2. Headers — what *is* served cannot be sniffed or rendered as a document:**

```bash
# Use a file you uploaded in T11/T12:
ls data/uploads/photos data/uploads/videos data/uploads/audio data/uploads/gifs 2>/dev/null
curl -sI "$BASE_URL/uploads/photos/<that-file>" \
  | grep -iE '^(content-type|x-content-type-options|content-disposition)'
```

Pass criteria: `X-Content-Type-Options: nosniff` is present, the `Content-Type`
is the real media type (never `text/html`), and either
`Content-Disposition: attachment` is set or the response is a verified image
served with `nosniff`. Check the same for `/index.html` and `/app.js` — `nosniff`
should be global, per S9.

**3. Rendering — the S8 escape hole** (this one is a browser step, not curl):

The vulnerable path is `escHtml` not escaping quotes while being used inside
`src="..."` (`public/app.js:181`, used at `:290`, `:633`, `:641`, `:1744`,
`:1905`). Send a GIF message whose URL is:

```
x" onerror="console.log('PWNED')
```

Then in DevTools:

- Console shows **no** `PWNED` line.
- `document.title` is still `Guftago` (a successful injection that changed the
  title is easy to spot).
- Elements panel: the generated `<img>` has **no** `onerror` attribute; the
  payload sits inside the `src` value only. After the fix the markup should read
  `src="x&quot; onerror=..."`.

Use `console.log` rather than `alert` so nothing blocks the page, and do not
paste the payload into a browser you would have to close by hand.

#### T14 — Login is rate-limited

```bash
for i in $(seq 1 30); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST $BASE_URL/api/login \
    -H 'Content-Type: application/json' -d '{"code":"ZZZZ"}'
done; echo
```

Pass criteria: after a small burst you see `429` (or an equivalent throttled
response), and a **correct** code still works afterwards (do not lock the real
user out with your rate limiter — exempt successful attempts, or use a long
window and a high limit).

#### T15 — Changing the admin code cannot brick the app

```bash
# Pick a code that already exists (e.g. the current admin code) and try to reuse it.
curl -s -X POST $BASE_URL/api/admin/change-admin-code \
  -H "x-admin-code: $ADMIN_CODE" -H 'Content-Type: application/json' \
  -d "{\"newCode\":\"$ADMIN_CODE\"}"
```

Pass criteria: HTTP 400 with a clear message, **the old admin code still logs in**,
`sessions` still works, and no 500. Then do a legitimate change to a fresh code,
verify login with the new code, and change it back so the user is not surprised
(steps 3–5 of the user's saved login must still work).

### Robustness & cleanup suite (T16–T18)

#### T16 — Graceful shutdown is actually graceful

```bash
npm run background
PID=$(cat data/server.pid)
time kill -TERM $PID
sleep 1
ps -p $PID > /dev/null && echo "STILL RUNNING (bad)" || echo "exited"
```

Pass criteria: exits in **under 2 seconds**, no `STILL RUNNING`, and
`lsof -iTCP:3000` is empty. Restart afterwards.

#### T17 — No dead code left behind

```bash
grep -rn "gif/validate\|profile-pics\|deleteOldMedia" server.js public/ scripts/
grep -n "better-sqlite3\|Couple Chat" server.js
grep -n '"name"' package.json
```

Pass criteria: the first grep is empty; the header no longer says
`better-sqlite3`/`Couple Chat`; the `package.json` name is either unchanged **and
explained** or fully renamed with all scripts/docs updated.

#### T18 — Clean console and clean cache

1. Bump `?v=` and `CACHE`, restart, hard reload.
2. Open DevTools → Console. Reload, log in, send one message, open the reaction
   picker, open the admin panel.
3. Pass criteria: **zero uncaught errors**, zero 404s for `cat-logo.jpg`/manifest
   icons, no duplicate reaction picker, and the app still works in a second tab.

---

## 14. The test harness I wrote for you

`scripts/session-test.mjs` — zero dependencies, raw Engine.IO v4 over HTTP
long-polling (exactly what Socket.IO uses on the wire). I verified it works
against the unfixed server. It is part of the deliverable; keep it working.

```
$ node scripts/session-test.mjs health
{"status":"ok","uptime":11872,"users":0}

$ node scripts/session-test.mjs ghost ADMIN-MASTER
OK    ghost created, sid=acoFwCIvQLN58n3kAAAN — abandoning it now (no 41, no ping replies)

$ node scripts/session-test.mjs probe ADMIN-MASTER
FAIL  connect rejected: This code is already in use. Only one session per code allowed.

$ node scripts/session-test.mjs kick ADMIN-MASTER
{"success":true}

$ node scripts/session-test.mjs probe ADMIN-MASTER
PASS  connect accepted (sid=6unKnOYN7a35hxjxAAAP)

$ node scripts/session-test.mjs health
{"status":"ok","uptime":11913,"users":0}
```

That failure → kick → pass cycle **is the bug**, reproduced in six commands.

Commands:

| Command | What it does |
|---|---|
| `health` | `GET /api/health` |
| `sessions` | `GET /api/admin/sessions` (needs `ADMIN_CODE`) |
| `probe <CODE> [deviceId]` | one connect attempt → `PASS`/`FAIL`, exit 0/1 |
| `ghost <CODE> [deviceId]` | connect, then abandon the socket (no close, no pong) |
| `hold <CODE> [deviceId] [s]` | hold a live session and answer pings, printing `event:` lines |
| `kick <CODE>` | `POST /api/admin/kick-session` |
| `takeover <CODE> [deviceId]` | force the session onto this device; tries `emit "takeover"` then `auth.takeover` |
| `logout <CODE> [deviceId]` | connect, emit `logout`, then prove the code is free **without** closing the socket first |
| `reload <CODE> [deviceId] [n]` | n rapid reconnect cycles, prints `n/n ok` |

`deviceId` is only sent when you pass it — the harness never invents one. The
pre-fix server ignores the field; your fixed server must treat a *missing* id as
its own device (that is what a browser with storage cleared looks like). Every
test about device identity (T1–T5) passes explicit ids like `dev-A` / `dev-B`;
do the same by hand, or you are accidentally testing the anonymous path.

How it talks to the server (read this before you change the protocol):

```
GET  /socket.io/?EIO=4&transport=polling&t=<ts>        → strip leading '0', parse sid
POST /socket.io/?EIO=4&transport=polling&sid=<sid>     body: 40{"code":"<CODE>","deviceId":"..."}
GET  /socket.io/?EIO=4&transport=polling&sid=<sid>     → 40{"sid":...} success | 44{"message":"..."} error
```

Payloads are split on `\x1e`; `2` = ping, `3` = pong, `41` = close,
`42[...]` = event. If you add fields to the auth payload, update the harness's
`connect()` so the tests keep exercising the real path. If you change the error
shape, `44` parsing still works, but the assertions on `err.data.code` are what
matter for T3.

`ghost` never answers the `2` ping, so the server drops the transport after
`pingTimeout` — same as a force-quit browser. That is deliberate.

---

## 15. Definition of done

You may only say "done" when **all** of these are true, and your report contains
the evidence for each:

1. `git status` is explained: every changed file is one you intentionally changed.
   No stray temp files, no `data/`, no `node_modules`, no `.env`.
2. T1–T7 pass, with real pasted output, against a **restarted** server.
3. T8's manual checklist is complete, and you say which browser and profile you
   used.
4. T9–T15 pass: unauthenticated reads and uploads are rejected with `401`, and
   disallowed upload types with `415` — **distinct codes, not "any 4xx"** — while
   a real PNG/GIF still uploads, login is throttled, and the admin code cannot
   brick the app.
5. T16 passes: `SIGTERM` exits in under 2s and frees port 3000.
6. T17 passes: the dead-code greps are empty, the file header is truthful, and
   the naming decision is documented.
7. `node --check server.js` and `node --check scripts/session-test.mjs` pass.
8. `node --check public/app.js` passes (it is a classic script, not a module, so
   this is a syntax check only — it will not catch runtime errors).
9. The server is running at the end, `users` is `0` or the true number of open
   browsers, and `sessions` has no ghost (§5.5).
10. The real admin code still logs in, in a real browser, and the chat loads.
11. No new dependency was added. `package.json` dependencies are unchanged.
12. `data/` is untouched except for test uploads you cleaned up, and `chat.db`
    still has the user's messages.
13. Every **CONFIRMED** item in §9 is fixed, and every **LIKELY**/**VERIFY** item
    is either fixed or explicitly dismissed with a reason.
14. Every deletion in §10 came with a grep proving it was unused.
15. Your report follows §18 and leads with what you ran, not what you think.

Anything less is "partially done". Say that instead — it is more useful than a
false success.

---

## 16. Gotchas that will waste your time

- **The server may already be running** (PID 8519 on port 3000 at handoff time).
  `npm start` will fail with `EADDRINUSE`. Check `lsof -nP -iTCP:3000` first, and
  restart rather than starting a second process.
- **`public/` changes need a hard reload, not a server restart.** `server.js`
  changes need a restart, not a browser reload. Getting this backwards produces
  "your fix didn't work" reports.
- **The service worker caches aggressively.** If the UI looks unchanged, bump
  `CACHE`, hard reload, and check the Network tab for a stale `app.js`.
- **`POST /api/login` succeeding does not mean the socket will connect.** That is
  the whole bug. Never treat the REST 200 as proof of login.
- **`express.static` serves from disk on every request.** Deleting a file under
  `data/uploads` takes effect immediately; there is no cache to clear.
- **`node:sqlite` is synchronous and experimental.** `db.prepare(...).run()`
  throws on constraint violations — wrap the admin-code change in `try/catch`
  (S7) or it becomes a 500.
- **`escHtml` is not an HTML escaper for attributes.** It does not escape quotes
  (S8). If you add a new template string with `"${...}"`, use a proper escaper.
- **Socket.IO clients reconnect automatically.** If you add a rate limiter that
  counts reconnects, you will throttle a healthy client after a network blip.
  Count only *new* handshakes from a new device, or use a generous window.
- **The phone is the production host.** Anything you add must run on
  Node ≥22.5 with no native build step and low RAM. `sharp` is already there;
  nothing else new gets in.
- **Do not test destructive things on `data/chat.db`.** Copy it to
  `data/chat.db.bak` before any migration, and never `rm -rf data/`.
- **Two browser tabs count as the same device** if you share `localStorage`.
  A private window is a different device. Use that deliberately in T8.
- **The E2EE diff is uncommitted.** If you `git checkout -- server.js` to undo a
  mistake, you will also destroy the pubkey relay. Commit or stash it first (§3).

---

## 17. Out of scope / do not touch

- **Do not add features.** No read-receipt redesign, no new emoji picker, no new
  themes, no voice-note UI changes. This is a fix-and-audit task.
- **Do not add a framework, bundler, TypeScript, or test framework.** See rule 5.
- **Do not rename files, services, plists, or the npm package** unless you do the
  complete rename in §11 and re-test the phone deployment. Partial renames are
  worse than none.
- **Do not change the E2EE scheme.** It works; it is uncommitted; it is not part
  of this task. If you touch `server.js` near the pubkey relay, preserve it.
- **Do not remove the two-person constraint.** One admin code + one partner code
  is the product. A multi-user rewrite is a different project.
- **Do not commit `data/`, `.env`, or any uploaded file.** Rule 6.
- **Do not add a GIF search API.** Rule 7. No Tenor, no Klipy, no Giphy.
- **Do not "fix" microphone-on-HTTP.** Rule 8.
- **Do not silently change the admin code** during testing without changing it
  back, and never leave the user's browser with a code that no longer works.

---

## 18. Report format

Keep it short and evidence-first. Use exactly this structure:

```markdown
# Guftago — Fix Report

## 1. State at start
- git status / HEAD:
- port 3000:
- /api/health:
- /api/admin/sessions:
- data: messages=N, codes=N, uploads=N

## 2. What I changed (by priority)
### P1 login
- file:line — change — why
### P2 security
- ...
### P3 correctness
- ...
### P4 dead code
- item — grep evidence — action

## 3. Test results (paste real output)
### T1 ... (command + output + PASS/FAIL)
### ...
### T18

## 4. Decisions & deviations
- Protocol shape chosen for takeover:
- Auth mechanism for REST:
- admin-code rename decision:
- Anything I did not fix, and why:

## 5. Final state
- server: running/stopped, PID, port
- /api/health:
- /api/admin/sessions:
- git status:
- New dependencies: none

## 6. What the user should do next
- (one or two lines, e.g. hard-reload, log in with the code, report anything odd)
```

Rules for the report:

- **Lead with evidence, not adjectives.** "T3 passed, output below" beats
  "takeover works now".
- If a test failed, say it failed. Do not omit it.
- If you changed the behaviour of a feature (e.g. added a rate limit), say what
  the user will notice.
- If you left something broken, name it and say why.
