// Prep relay: a Cloudflare Worker that passes encrypted changes between one household's devices.
// It stores only scrambled text. The key never leaves the devices, so nothing here can be read by the host.
// Needs one binding: a D1 database named DB. The tables are created on first use.

const MAX_BODY = 200000;      // largest single encrypted record, in characters
const MAX_PUSH = 200;         // records accepted in one request
const PAGE = 300;             // records returned in one request
const MAX_ROWS = 200000;      // records kept for one household

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

let ready = false;
async function init(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS households (hh TEXT PRIMARY KEY, auth TEXT NOT NULL, created INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, hh TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE (hh, id))'),
    db.prepare('CREATE INDEX IF NOT EXISTS changes_hh_seq ON changes (hh, seq)'),
  ]);
  ready = true;
}

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname;
    if (request.method === 'GET') return json(200, { ok: true, service: 'prep-relay', version: 1 });
    if (request.method !== 'POST' || (path !== '/v1/sync' && path !== '/v1/wipe')) return json(404, { error: 'not found' });
    if (!env.DB) return json(500, { error: 'The relay has no database attached. Add a D1 binding named DB.' });

    let q;
    try { q = JSON.parse(await request.text()); } catch (e) { return json(400, { error: 'bad request' }); }
    const hh = typeof q.hh === 'string' && /^[a-f0-9]{32}$/.test(q.hh) ? q.hh : null;
    const auth = typeof q.auth === 'string' && q.auth.length >= 20 && q.auth.length <= 100 ? q.auth : null;
    if (!hh || !auth) return json(400, { error: 'bad request' });

    const db = env.DB;
    await init(db);
    const hash = await sha256(auth);
    const row = await db.prepare('SELECT auth FROM households WHERE hh = ?').bind(hh).first();
    if (row && row.auth !== hash) return json(403, { error: 'wrong code' });
    if (!row) {
      if (path === '/v1/wipe') return json(200, { ok: true });
      if (!q.create) return json(404, { error: 'unknown household' });
      await db.prepare('INSERT OR IGNORE INTO households (hh, auth, created) VALUES (?, ?, ?)').bind(hh, hash, Date.now()).run();
    }

    if (path === '/v1/wipe') {
      await db.batch([db.prepare('DELETE FROM changes WHERE hh = ?').bind(hh), db.prepare('DELETE FROM households WHERE hh = ?').bind(hh)]);
      return json(200, { ok: true });
    }

    const push = Array.isArray(q.push) ? q.push : [];
    if (push.length > MAX_PUSH) return json(413, { error: 'too many records in one request' });
    const good = push.filter(p => p && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 200 && typeof p.body === 'string' && p.body.length <= MAX_BODY);
    if (good.length !== push.length) return json(400, { error: 'bad record' });
    if (good.length) {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM changes WHERE hh = ?').bind(hh).first();
      if ((n ? n.n : 0) + good.length > MAX_ROWS) return json(507, { error: 'household is full' });
      const now = Date.now(), ins = db.prepare('INSERT OR IGNORE INTO changes (hh, id, body, at) VALUES (?, ?, ?, ?)');
      for (let i = 0; i < good.length; i += 50) await db.batch(good.slice(i, i + 50).map(p => ins.bind(hh, p.id, p.body, now)));
    }

    const since = Number.isInteger(q.since) && q.since >= 0 ? q.since : 0;
    const res = await db.prepare('SELECT seq, id, body FROM changes WHERE hh = ? AND seq > ? ORDER BY seq LIMIT ?').bind(hh, since, PAGE + 1).all();
    const rows = res.results || [], more = rows.length > PAGE, page = rows.slice(0, PAGE);
    return json(200, { ok: true, changes: page, more, cursor: page.length ? page[page.length - 1].seq : since });
  },
};
