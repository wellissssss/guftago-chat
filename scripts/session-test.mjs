#!/usr/bin/env node
/**
 * Guftago — session/one-code-per-device test harness.
 *
 * No dependencies. Speaks raw Engine.IO v4 over HTTP long-polling, which is
 * exactly what Socket.IO falls back to and what the browser client does on
 * the wire. Use this to prove the "code already in use" bug is fixed without
 * needing a browser or an extra npm package.
 *
 * Usage:
 *   node scripts/session-test.mjs health
 *   node scripts/session-test.mjs sessions
 *   node scripts/session-test.mjs probe  <CODE> [deviceId]
 *   node scripts/session-test.mjs ghost  <CODE> [deviceId]
 *   node scripts/session-test.mjs hold   <CODE> [deviceId] [seconds]
 *   node scripts/session-test.mjs kick   <CODE>
 *   node scripts/session-test.mjs takeover <CODE> [deviceId]
 *   node scripts/session-test.mjs logout  <CODE> [deviceId]
 *   node scripts/session-test.mjs reload <CODE> [deviceId] [times]
 *
 * Env:
 *   BASE_URL    default http://localhost:3000
 *   ADMIN_CODE  required by `sessions` and `kick`
 *
 * Exit code 0 = expectation met, 1 = expectation failed, 2 = harness error.
 */

const BASE = (process.env.BASE_URL || process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : process.env.BASE_URL) || 'http://localhost:3000';

const ADMIN_CODE = process.env.ADMIN_CODE || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Engine.IO primitives ──────────────────────────────────────────────

/** Open an Engine.IO session. Returns the sid, or throws. */
async function openEngine() {
  const res = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&t=${Date.now()}${Math.random()}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.text();
  // Payload is a single packet: '0' + JSON handshake
  if (!body.startsWith('0')) throw new Error(`Unexpected handshake payload: ${body.slice(0, 200)}`);
  let handshake;
  try {
    handshake = JSON.parse(body.slice(1));
  } catch {
    throw new Error(`Handshake JSON parse failed: ${body.slice(0, 200)}`);
  }
  if (!handshake.sid) throw new Error(`Handshake had no sid: ${body.slice(0, 200)}`);
  return handshake;
}

/** POST one packet to the session. */
async function send(sid, packet) {
  const res = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: packet,
    signal: AbortSignal.timeout(10_000),
  });
  return res.text();
}

/** Poll once for packets. Returns the raw payload string. */
async function poll(sid) {
  const res = await fetch(
    `${BASE}/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}&t=${Date.now()}${Math.random()}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (res.status !== 200) throw new Error(`poll HTTP ${res.status}`);
  return res.text();
}

/**
 * Attempt a Socket.IO namespace connect with an auth payload.
 * Returns { ok, packets, message }.
 * ok=false means the server rejected the handshake (packet 44).
 */
async function namespaceConnect(sid, auth) {
  await send(sid, `40${JSON.stringify(auth)}`);
  // Give the server a moment, then read everything queued.
  await sleep(400);
  const payload = await poll(sid);
  const packets = splitPayload(payload);
  const errorPacket = packets.find((p) => p.startsWith('44'));
  if (errorPacket) {
    let message = errorPacket.slice(2);
    try {
      message = JSON.parse(message).message || message;
    } catch { /* keep raw */ }
    return { ok: false, packets, message };
  }
  const connected = packets.find((p) => p.startsWith('40'));
  return { ok: Boolean(connected), packets, message: null };
}

/** Engine.IO polling payloads concatenate packets with a 0x1e record separator. */
function splitPayload(payload) {
  if (!payload) return [];
  return payload.split('\x1e').filter(Boolean);
}

/** Cleanly close an Engine.IO session. */
async function closeEngine(sid) {
  try { await send(sid, '41'); } catch { /* already gone */ }
  try { await poll(sid); } catch { /* expected to fail after close */ }
}

// ── Admin HTTP helpers ────────────────────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(ADMIN_CODE ? { 'x-admin-code': ADMIN_CODE } : {}),
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const health = () => api('/api/health');
const sessions = () => api('/api/admin/sessions');
const kick = (code) =>
  api('/api/admin/kick-session', { method: 'POST', body: JSON.stringify({ code }) });

// ── Commands ──────────────────────────────────────────────────────────

const log = (...a) => console.log(...a);

async function cmdHealth() {
  const r = await health();
  log(JSON.stringify(r.body));
  return 0;
}

async function cmdSessions() {
  if (!ADMIN_CODE) {
    log('ERROR: set ADMIN_CODE env var (read it from .env)');
    return 2;
  }
  const r = await sessions();
  log(JSON.stringify(r.body, null, 2));
  return 0;
}

async function cmdKick(code) {
  if (!ADMIN_CODE) { log('ERROR: set ADMIN_CODE env var'); return 2; }
  const r = await kick(code);
  log(JSON.stringify(r.body));
  return r.status < 400 ? 0 : 1;
}

/** Single connect attempt. Exit 0 if accepted, 1 if rejected. */
async function cmdProbe(code, deviceId) {
  const hs = await openEngine();
  const auth = { code };
  if (deviceId) auth.deviceId = deviceId;
  const r = await namespaceConnect(hs.sid, auth);
  if (r.ok) {
    log(`PASS  connect accepted (sid=${hs.sid})`);
    log(`      packets: ${JSON.stringify(r.packets.slice(0, 4))}`);
    await closeEngine(hs.sid);
    return 0;
  }
  log(`FAIL  connect rejected: ${r.message}`);
  await closeEngine(hs.sid);
  return 1;
}

/**
 * Create a ghost session: connect, then abandon the socket without a close
 * handshake and without answering Engine.IO pings. This is what a killed tab,
 * a dropped wifi connection, or a force-quit browser does in real life.
 */
async function cmdGhost(code, deviceId) {
  const hs = await openEngine();
  const r = await namespaceConnect(hs.sid, { code, ...(deviceId ? { deviceId } : {}) });
  if (!r.ok) {
    log(`FAIL  could not create ghost, connect rejected: ${r.message}`);
    return 1;
  }
  log(`OK    ghost created, sid=${hs.sid} — abandoning it now (no 41, no ping replies)`);
  log(`      it should be evicted by the server within the TTL`);
  return 0;
}

/** Hold a session open and answer pings, so it stays genuinely alive. */
async function cmdHold(code, deviceId, seconds) {
  const dur = Number(seconds || 30);
  const hs = await openEngine();
  const r = await namespaceConnect(hs.sid, { code, ...(deviceId ? { deviceId } : {}) });
  if (!r.ok) {
    log(`FAIL  connect rejected: ${r.message}`);
    await closeEngine(hs.sid);
    return 1;
  }
  log(`OK    holding session sid=${hs.sid} for ${dur}s — run another command now`);
  const deadline = Date.now() + dur * 1000;
  while (Date.now() < deadline) {
    let payload;
    try {
      payload = await poll(hs.sid);
    } catch {
      await sleep(500);
      continue;
    }
    for (const p of splitPayload(payload)) {
      if (p === '2') await send(hs.sid, '3'); // ping -> pong
      else if (p.startsWith('42')) log(`      event: ${p.slice(2)}`);
    }
  }
  await closeEngine(hs.sid);
  log('OK    released');
  return 0;
}

/**
 * Attempt a takeover of a code held by another device.
 *
 * The exact protocol is yours to design. This command tries both plausible
 * shapes and reports which one the server accepted:
 *   1. connect normally, then emit a `takeover` event
 *   2. reconnect with `takeover: true` in the auth payload
 */
async function cmdTakeover(code, deviceId) {
  const dev = deviceId || 'harness-device-b';

  // Shape 1: emit an event on the (possibly rejected) namespace
  const a = await openEngine();
  const initial = await namespaceConnect(a.sid, { code, deviceId: dev });
  if (initial.ok) {
    log('PASS  accepted without a conflict — nothing to take over');
    await closeEngine(a.sid);
    return 0;
  }
  log(`      conflict reported: ${initial.message}`);
  await send(a.sid, '42["takeover"]');
  await sleep(600);
  let after = '';
  try { after = await poll(a.sid); } catch { /* namespace may be closed */ }
  await closeEngine(a.sid);
  const packets = splitPayload(after);
  if (packets.some((p) => p.startsWith('40'))) {
    log('PASS  takeover event promoted the session (shape: emit "takeover")');
    return 0;
  }
  log(`      event shape did not promote. packets: ${JSON.stringify(packets)}`);

  // Shape 2: re-handshake with takeover flag
  const b = await openEngine();
  const second = await namespaceConnect(b.sid, { code, deviceId: dev, takeover: true });
  await closeEngine(b.sid);
  if (second.ok) {
    log('PASS  takeover accepted (shape: auth.takeover = true)');
    return 0;
  }
  log(`FAIL  neither takeover shape was accepted: ${second.message}`);
  return 1;
}

/**
 * Connect, send a `logout` event, close, then immediately probe from a
 * DIFFERENT device. The code must be free within ~1s, without waiting for TTL.
 */
async function cmdLogout(code, deviceId) {
  const dev = deviceId || 'harness-device-a';
  const hs = await openEngine();
  const r = await namespaceConnect(hs.sid, { code, deviceId: dev });
  if (!r.ok) {
    log(`FAIL  could not establish a session to log out of: ${r.message}`);
    await closeEngine(hs.sid);
    return 1;
  }
  log(`OK    session established as "${dev}"`);
  await send(hs.sid, '42["logout"]');
  await sleep(300);

  // Probe WITHOUT closing the first socket. If the code is free now, the
  // `logout` event freed it. If the probe fails, logout did nothing and only
  // the transport close (which we do afterwards) would have freed it.
  log('      logout sent — probing from a different device while the first socket is still open');
  const verdict = await cmdProbe(code, 'harness-after-logout');

  await closeEngine(hs.sid); // clean up only after the verdict
  if (verdict === 0) log('PASS  the code was freed by logout alone, not by closing the socket');
  else log('FAIL  logout did not release the code; it only freed on transport close');
  return verdict;
}

/**
 * Simulate repeated page reloads from the SAME device.
 * Every iteration: fresh Engine.IO session, same deviceId, connect, clean close.
 * All iterations must succeed.
 */
async function cmdReload(code, deviceId, times) {
  const n = Number(times || 10);
  const dev = deviceId || 'harness-device';
  let failures = 0;
  for (let i = 1; i <= n; i++) {
    const hs = await openEngine();
    const r = await namespaceConnect(hs.sid, { code, deviceId: dev });
    if (r.ok) {
      log(`  ${i}/${n}  ok`);
    } else {
      failures++;
      log(`  ${i}/${n}  REJECTED: ${r.message}`);
    }
    await closeEngine(hs.sid);
    await sleep(150);
  }
  if (failures === 0) {
    log(`PASS  ${n} consecutive reloads from device "${dev}" all connected`);
    return 0;
  }
  log(`FAIL  ${failures}/${n} reloads were rejected`);
  return 1;
}

// ── Entry point ───────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

const commands = {
  health: cmdHealth,
  sessions: cmdSessions,
  probe: cmdProbe,
  ghost: cmdGhost,
  hold: cmdHold,
  kick: cmdKick,
  takeover: cmdTakeover,
  logout: cmdLogout,
  reload: cmdReload,
};

if (!cmd || !commands[cmd]) {
  log(`Guftago session test harness — target ${BASE}`);
  log('');
  log('Commands:');
  log('  health                          server health + connected user count');
  log('  sessions                        admin view of active sessions');
  log('  probe    <CODE> [deviceId]      one connect attempt, PASS/FAIL');
  log('  ghost    <CODE> [deviceId]      create an abandoned (ghost) session');
  log('  hold     <CODE> [deviceId] [s]  hold a live session open');
  log('  kick     <CODE>                 admin force-release a code');
  log('  takeover <CODE> [deviceId]      force a session onto this device');
  log('  logout   <CODE> [deviceId]      log out, then prove the code is free');
  log('  reload   <CODE> [deviceId] [n]  n consecutive reloads from one device');
  log('');
  log('Env: BASE_URL, ADMIN_CODE');
  process.exit(cmd ? 2 : 0);
}

try {
  process.exit(await commands[cmd](...args));
} catch (err) {
  console.error(`HARNESS ERROR: ${err.message}`);
  process.exit(2);
}
