// Sync between a household's devices through a relay that only ever sees scrambled data.
// The pairing code holds the relay address and a 256-bit secret. From the secret each device derives
// the household's id, a token the relay checks, and the encryption key. The key never leaves the device.

const te = new TextEncoder(), td = new TextDecoder();
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

export class SyncError extends Error {
  constructor(code, userMessage) { super(code); this.code = code; this.userMessage = userMessage; }
}

export function cleanUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u) ? u : '';
}

export function makeCode(url) {
  return 'PREP1.' + b64u(te.encode(cleanUrl(url))) + '.' + b64u(crypto.getRandomValues(new Uint8Array(32)));
}

export function parseCode(code) {
  const m = /^PREP1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(String(code || '').trim());
  if (!m) return null;
  try {
    const url = cleanUrl(td.decode(unb64u(m[1]))), secret = unb64u(m[2]);
    return url && secret.length === 32 ? { url, secret } : null;
  } catch (e) { return null; }
}

export async function deriveKeys(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const bits = async (label, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('prep/' + label) }, base, n * 8));
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('prep/enc') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { hh: hex(await bits('household', 16)), auth: b64u(await bits('auth', 32)), key };
}

/** Encrypts one record. The record's id is bound in, so a record cannot be swapped for another on the relay. */
export async function seal(key, id, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(id) }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  let s = '';
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function unseal(key, id, body) {
  const raw = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: te.encode(id) }, key, raw.subarray(12));
  return JSON.parse(td.decode(pt));
}

export async function post(url, path, body) {
  let res;
  try { res = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { throw new SyncError('network', 'Could not reach the relay. Check your connection.'); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.ok && data && data.ok) return data;
  if (res.status === 403) throw new SyncError('code', 'The relay did not accept this code.');
  if (res.status === 404) throw new SyncError('unknown', 'No household uses this code. Check it was copied in full.');
  if (res.status === 507) throw new SyncError('full', 'The relay has no room left for this household.');
  if (res.status === 429 || res.status === 1027) throw new SyncError('limit', 'The relay has reached its daily limit. It will work again tomorrow.');
  throw new SyncError('relay', 'The relay had a problem' + (data && data.error ? ' (' + String(data.error).slice(0, 120) + ')' : '') + '. Try again later.');
}

/**
 * Merges records received from the relay into local data. Pure: returns what to write.
 *   items: last change wins, by updatedAt.   events: kept if not seen before.   meta: last change wins, by at.
 * Quantities are then rebuilt from the full log, so two devices using stock at the same time both count.
 */
export function merge(local, incoming) {
  const items = new Map(local.items.map(i => [i.id, i])), seen = new Set(local.events.map(e => e.id));
  const meta = { ...local.meta }, newEvents = [], changed = new Map(), newMeta = {};
  for (const r of incoming) {
    if (!r || typeof r !== 'object') continue;
    if (r.t === 'item' && r.v && typeof r.v.id === 'string' && typeof r.v.area === 'string') {
      const cur = items.get(r.v.id);
      if (!cur || String(r.v.updatedAt || '') > String(cur.updatedAt || '')) { items.set(r.v.id, r.v); changed.set(r.v.id, r.v); }
    } else if (r.t === 'event' && r.v && typeof r.v.id === 'string' && !seen.has(r.v.id)) {
      seen.add(r.v.id); newEvents.push(r.v);
    } else if (r.t === 'meta' && (r.k === 'settings' || r.k === 'scenarios' || r.k === 'live') && typeof r.at === 'string' && r.at > String((meta[r.k] && meta[r.k].at) || '')) {
      meta[r.k] = { at: r.at, v: r.v }; newMeta[r.k] = meta[r.k];
    }
  }
  const sums = new Map();
  for (const e of local.events.concat(newEvents)) sums.set(e.itemId, (sums.get(e.itemId) || 0) + (Number(e.delta) || 0));
  for (const it of items.values()) {
    if (!sums.has(it.id) || it.deleted) continue;
    const q = Math.max(0, Math.round(sums.get(it.id) * 1000) / 1000);
    if (q !== it.qty) { const next = { ...it, qty: q }; items.set(it.id, next); changed.set(it.id, next); }
  }
  return { items: [...changed.values()], events: newEvents, meta: newMeta };
}
