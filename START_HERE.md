# START HERE — paste this into a fresh session

Copy everything inside the block below into a brand-new OpenCode session opened in
`/Users/gohsa/Documents/Default Project`.

---

```
Read GUFTAGO_HANDOFF.md in this directory — all of it — before you do anything else.
It is the handoff from the exhausted session "Private couple chat website"
(ses_e30744a4cffecjbezGOf7eRpdc), which died from a free-usage 429 during auto-compaction,
not because the work was done.

MISSION: work autonomously on the Guftago project overnight. Do not stop to ask me
questions I have already answered in that file. I am asleep and wake at 7:30 a.m.

STEP 0 — orient (do this first, no edits):
1. Read GUFTAGO_HANDOFF.md fully.
2. Read README.md.
3. git status && git diff  -> there are 3 uncommitted files (image-preview feature).
4. Skim server.js and public/app.js structure.

STEP 1 — resolve the dirty working tree:
- Start the server, open http://localhost:3000, log in with the admin code from .env.
- Test the media preview end to end: photo, video, caption, cancel, send.
- Works  -> commit and push: git add -A && git commit -m "feat: media preview before send" && git push
- Broken -> fix it properly, then commit and push. Do not leave the tree dirty.
- Bump the service worker cache in public/sw.js (chat-v4 -> chat-v5) whenever public/ changes.

STEP 2 — work the Phase 1 backlog from the handoff, one item at a time:
  1. Mobile keyboard handling via visualViewport (chat input stays above the keyboard)
  2. Message retry on failure
  3. Better empty states and loading indicators
  4. Sweep remaining UI visual issues
Then Phase 2 if time allows.

THE LOOP — use this for every item, no exceptions:
  a. git commit the current green state as a checkpoint
  b. delegate the item to a FRESH subagent session (never in this session)
     — one focused task per subagent, and tell it: test before reporting success
  c. verify the subagent's work yourself against the running app
  d. green -> commit + push with a clear message
     red   -> git reset --hard back to the checkpoint
  e. update GUFTAGO_HANDOFF.md backlog and move to the next item

MODEL ROUTING — follow this exactly:
You (the orchestrator) run on: opencode/deepseek-v4.1-flash-free
Why: best judgement of the free models — strongest bug-hunting, and the only one that
answered "UNKNOWN" instead of inventing an answer on a hallucination trap. That is exactly
the skill you need to judge whether a subagent actually did its job.
Fallback if rate-limited: opencode/mimo-v2.6-flash-free, then opencode/glm-5.3-flash-free.

YOUR JOB IS ONLY: plan, diagnose, judge, verify, commit. Do NOT write feature code yourself.
Anything that writes code goes to a subagent, with the model picked by task type:

  Backend work in server.js / SQL / socket events / bug fixing / code review
      -> opencode/deepseek-v4.1-flash-free
  Large multi-file refactor, long agentic chains, "make this work end to end"
      -> opencode/mimo-v2.6-flash-free
  UI polish, visual judgement, layout, design review
      -> opencode/glm-5.3-flash-free
  Reading a screenshot or rendered page and reporting what is visually wrong
      -> opencode/nemotron-3.5-super-vl-free
  Tiny chores: bump sw cache, rename, grep, format, one-line fix
      -> opencode/nemotron-3.5-lightning-free
  Docs, README, handoff prose, commit messages
      -> opencode/big-pickle

Delegation rules:
- One task per subagent. Never bundle two items into one subagent.
- Every subagent prompt must end with: "Test your work before reporting success. Report
  exactly what you ran and what the output was. Do not claim done without proof."
- Use the cheapest model that can do the job — never burn mimo on a one-line change.
- If a model returns "Free usage limit reached", retry that same task on the next model
  for that row and note which one you used. Six free models reset around 5 a.m.
- After each subagent returns, YOU verify it yourself: read the diff, run the app. A
  subagent's claim of success is not evidence.

HARD RULES (violating these got the last agent in trouble):
- TEST EVERYTHING before claiming it works. Never say "done" without running it.
- The name is Guftago, not "Couple Chat".
- No pink theme. Dark/light toggle only.
- Keep the cat logo at public/cat-logo.jpg — do not substitute it.
- Keep it lightweight; this runs on a phone.
- Never commit data/ (it is gitignored: DB, uploads, logs).
- Tenor is dead, Klipy was rejected — do not re-add GIF search APIs.
- Audio recording needs HTTPS — test on the tunnel URL, not localhost.
- Use subagents in separate sessions so this session does not exhaust its context.
- If this session nears its limit, refresh GUFTAGO_HANDOFF.md before it dies.

MY LAST INSTRUCTIONS FROM THE OLD SESSION (verbatim, still binding):
- "make a goal plan you i wan t start you keep runing in at goal loop you keep inporoving
  this projact with new feturs and you have to use subagents in deffrant sessons so this
  sessone ont gest exosted use git hub to uplod updates adn if somthis gets wrong we use
  last update"
- "make use update the gethub web evry thisng looks workin make a check lits and give it to
  anoher sub ages todo check ... wen evryr thing look good update it as new verson and start
  workin on new feturs ... if you feel this sesson will about to end make a md file with all
  inportand detals and run new sessons and start working on it"
- "i iam heeding o betad ill wak up in moring 7:30 tll then keep working"

DELIVERABLE FOR WHEN I WAKE: a short summary of what you changed, what you committed and
pushed, what you tested, and what is left. Keep working until then.
```

---

Saved by the outgoing session on Nov 13, 2026. Companion file: `GUFTAGO_HANDOFF.md`.
