// Prep: the app shell, views and dialogs. Data lives in IndexedDB on this device (see db.js).

import * as C from './calc.js';
import { AREAS, areaOf, typeLabel, TEMPLATES, MODELS, DEFAULT_SETTINGS, DEFAULT_SCENARIOS, SOURCES } from './defaults.js';
import * as DB from './db.js';
import { readLabel, testKey } from './reader.js';

const APP_VERSION = '1.4.0';
const MAX_PHOTOS = 3;

// ---------- small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = v => (v === null || v === undefined ? '' : v);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
const nowISO = () => new Date().toISOString();
const n0 = v => Math.round(v).toLocaleString('en-MY');
const n1 = v => (Math.round(Number(v) * 10) / 10).toLocaleString('en-MY', { maximumFractionDigits: 1 });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fdate = s => { if (!s) return 'No date'; const [y, m, d] = s.split('-'); return `${Number(d)} ${MON[Number(m) - 1]} ${y}`; };
const fmtDays = d => (!Number.isFinite(d) ? 'n/a' : d >= 100 ? n0(d) : n1(d));
const dayWords = d => (d < 0 ? `${-d} day${d === -1 ? '' : 's'} past` : `${d} day${d === 1 ? '' : 's'} left`);
const plural = (n, word) => `${n} ${Number(n) === 1 ? word : word === 'person' ? 'people' : word + 's'}`;
const round3 = n => Math.round(n * 1000) / 1000;

function amount(v, unit) {
  switch (unit) {
    case 'L': return n1(v) + ' L';
    case 'kcal': return n0(v) + ' kcal';
    case 'g': return n0(v) + ' g';
    case 'min': return n0(v) + ' min';
    case 'Wh': return n0(v) + ' Wh';
    case 'doses': return n0(v) + ' doses';
    default: return n1(v) + ' ' + unit;
  }
}

// ---------- state ----------
const S = {
  items: [], events: [], settings: { ...DEFAULT_SETTINGS }, scenarios: DEFAULT_SCENARIOS.map(x => ({ ...x })),
  view: 'ready', f: { q: '', area: '', loc: '', st: '', sort: 'due', act: '' },
  apiKey: '', deviceId: '', lastBackupAt: '', persisted: null, installEvt: null, swReg: null, updateReady: false, updateRequested: false, error: '',
};
const main = $('#main'), dlg = $('#dlg'), askDlg = $('#ask');
const live = () => S.items.filter(i => !i.deleted);
const today = () => C.todayStr();

async function load() {
  await DB.openDB();
  const [items, events, settings, scenarios, apiKey, deviceId, lastBackupAt] = await Promise.all([
    DB.all('items'), DB.all('events'), DB.get('meta', 'settings'), DB.get('meta', 'scenarios'),
    DB.get('meta', 'apiKey'), DB.get('meta', 'deviceId'), DB.get('meta', 'lastBackupAt')]);
  S.items = items;
  S.events = events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  S.scenarios = Array.isArray(scenarios) && scenarios.length ? scenarios : DEFAULT_SCENARIOS.map(x => ({ ...x }));
  S.apiKey = apiKey || '';
  S.lastBackupAt = lastBackupAt || '';
  S.deviceId = deviceId || uid();
  if (!deviceId) await DB.put('meta', S.deviceId, 'deviceId');
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.textContent = ''; }, 3500);
}

function ask(message, okLabel, danger) {
  return new Promise(resolve => {
    askDlg.innerHTML = `<div class="dlg"><p class="askmsg">${esc(message)}</p><div class="actions">
      <button class="btn" data-v="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(okLabel)}</button></div></div>`;
    askDlg.onclick = e => { const b = e.target.closest('[data-v]'); if (b) { askDlg.close(); resolve(b.dataset.v === '1'); } };
    askDlg.oncancel = () => resolve(false);
    askDlg.showModal();
  });
}

/** Runs a save and tells the person plainly if it failed. */
async function guard(fn) {
  try { await fn(); return true; } catch (e) {
    console.error(e);
    toast(e && e.name === 'QuotaExceededError' ? 'The phone is out of storage space. Free some space and try again.' : 'That did not save. Try again.');
    return false;
  }
}

/** Saves an item together with its log entry, in one step: both are written, or neither. */
async function commit(item, type, delta) {
  item.updatedAt = nowISO();
  const ev = { id: uid(), itemId: item.id, item: item.name, type, delta: round3(delta || 0), qtyAfter: item.qty, at: item.updatedAt, device: S.deviceId };
  await DB.putAll([['items', item], ['events', ev]]);
  const i = S.items.findIndex(x => x.id === item.id);
  if (i >= 0) S.items[i] = item; else S.items.push(item);
  S.events.unshift(ev);
}

async function saveSettings() { await DB.put('meta', S.settings, 'settings'); }
async function saveScenarios() { await DB.put('meta', S.scenarios, 'scenarios'); }

async function keepStorage() {
  // Ask the browser not to clear this app's data when the phone runs low on space.
  try {
    if (navigator.storage && navigator.storage.persist) S.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch (e) { /* not supported */ }
}

// ---------- images ----------
async function shrink(file, max, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('image'))), 'image/jpeg', quality));
}

async function thumbOf(blob) {
  const bmp = await createImageBitmap(blob);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 96, 96);
  if (bmp.close) bmp.close();
  return c.toDataURL('image/jpeg', 0.7);
}

const blobToDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

function dataURLToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const mime = (dataUrl.slice(0, comma).match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- item display ----------
function dueInfo(it) {
  const due = C.nextDue(it);
  if (!due.date) {
    const quiet = it.area === 'kit';
    return { cls: quiet ? '' : 'nodate', label: quiet ? '' : 'No date', text: quiet ? '' : 'No date on record', days: null, kind: '', date: '' };
  }
  const d = C.daysLeft(due.date, today());
  if (due.kind === 'check') {
    const cls = d < 0 ? 'expired' : d < 30 ? 'eatfirst' : 'ok';
    return { cls, label: d < 0 ? 'Check overdue' : d < 30 ? 'Check soon' : 'OK', text: `Check by ${fdate(due.date)} · ${dayWords(d)}`, days: d, kind: 'check', date: due.date };
  }
  const st = C.expiryStatus(it, S.settings, today());
  const label = { expired: 'Past date', eatfirst: it.area === 'food' ? 'Eat first' : 'Use first', soon: 'Soon', ok: 'OK' }[st];
  return { cls: st, label, text: `${fdate(due.date)} · ${dayWords(d)}`, days: d, kind: 'expiry', date: due.date };
}

function capText(it) {
  const c = C.num(it.cap);
  switch (it.area) {
    case 'food': return C.num(it.kcal) !== null ? `${n0(it.kcal)} kcal a pack` : '';
    case 'water': return c !== null ? `${n1(c)} L each` : '';
    case 'fuel': return c !== null ? `${n0(c)} min each` : '';
    case 'power': return c !== null ? `${n0(c)} Wh each` : '';
    case 'medical': return c !== null ? `${n0(c)} doses${C.num(it.perDay) ? `, ${n1(it.perDay)} a day` : ''}` : '';
    case 'hygiene': return c !== null ? `lasts one person ${n1(c)} days` : '';
    case 'pets': return c !== null ? `feeds one pet ${n1(c)} days` : '';
    default: return '';
  }
}

const SOURCE_PILL = { LABEL: ['p-label', 'Label'], ONLINE: ['p-ref', 'Similar product'], GENERIC: ['p-ref', 'Generic figure'] };
function sourcePill(source) {
  const [cls, label] = SOURCE_PILL[source] || ['p-estimate', 'Estimate'];
  return `<span class="pill ${cls}">${label}</span>`;
}

function isLow(it) {
  const q = C.num(it.qty) || 0, m = C.num(it.minQty);
  return q === 0 || (m !== null && q < m);
}

function rowHTML(it) {
  const di = dueInfo(it), miss = C.missing(it), a = areaOf(it.area);
  const thumb = it.thumb ? `<img class="thumb" alt="" src="${esc(it.thumb)}">` : `<span class="thumb" aria-hidden="true">${esc(a.short.charAt(0))}</span>`;
  const size = C.num(it.unitSize) !== null ? `${n1(it.unitSize)} ${it.unit || ''}` : '';
  const kind = it.area === 'food' ? it.category : typeLabel(it.area, it.type);
  const meta = [it.brand, size, it.location].filter(Boolean).map(esc).join(' · ');
  const line2 = [di.text, capText(it)].filter(Boolean).map(esc).join(' · ');
  const chips = [
    `<span class="pill p-area">${esc(a.short)}${kind ? ' · ' + esc(kind) : ''}</span>`,
    di.label ? `<span class="pill p-${di.cls}">${esc(di.label)}</span>` : '',
    it.area === 'food' && C.num(it.kcal) !== null ? sourcePill(it.source) : '',
    miss.length ? '<span class="pill p-draft">Needs details</span>' : '',
    isLow(it) ? `<span class="pill p-expired">${(C.num(it.qty) || 0) === 0 ? 'Out' : 'Low'}</span>` : '',
  ].join('');
  return `<li class="row s-${di.cls || 'plain'}"><button class="row-main" data-act="edit" data-id="${esc(it.id)}">${thumb}
    <span class="row-text"><span class="nm">${esc(it.name)}</span>${meta ? `<span class="mt">${meta}</span>` : ''}${line2 ? `<span class="mt">${line2}</span>` : ''}<span class="chips">${chips}</span></span></button>
    <div class="row-qty"><b>${esc(n1(C.num(it.qty) || 0))}</b><small>in stock</small><button class="btn small" data-act="use" data-id="${esc(it.id)}">Use / add</button></div></li>`;
}

const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;

// ---------- view: Ready ----------
function scenarioKcal(scn) { return C.kcalFor(scn, S.settings); }

function scenarioView(scn, r) {
  const logged = r.needs.filter(n => n.logged), unlogged = r.needs.filter(n => !n.logged);
  let lim = null;
  for (const n of logged) if (!lim || n.days < lim.days) lim = n;
  let cls, verdict;
  if (!r.needs.length) { cls = 'ok'; verdict = 'Nothing needs stocking for this one.'; }
  else if (!logged.length) { cls = 'none'; verdict = 'Nothing logged for this yet.'; }
  else if (lim.days < r.target) {
    cls = lim.days / r.target >= 0.5 ? 'short' : 'bad';
    const many = lim.lines.filter(l => l.essential !== false).length > 1;
    verdict = `Limited by <b>${esc(lim.name)}${many && lim.limit ? ' (' + esc(lim.limit.label.toLowerCase()) + ')' : ''}</b>: ${fmtDays(lim.days)} of ${r.target} days`;
  } else { cls = unlogged.length ? 'short' : 'ok'; verdict = unlogged.length ? `What is logged covers ${r.target} days.` : `Covered for ${r.target} days.`; }
  const chip = n => {
    if (!n.logged) return `<span class="need n-none">${esc(areaOf(n.id).short)} <b>not logged</b></span>`;
    const c = n.days >= r.target ? 'ok' : n.days >= r.target / 2 ? 'short' : 'bad';
    return `<span class="need n-${c}">${esc(areaOf(n.id).short)} <b>${fmtDays(n.days)}</b></span>`;
  };
  return { cls, verdict, chips: r.needs.map(chip).join(''), unlogged };
}

function gapAmount(g) {
  const adults = C.num(S.settings.adults) || 1;
  if (g.unit === 'kcal') return `${n0(g.short)} kcal, about ${n1(g.short / 3600)} kg of dry rice`;
  if (g.unit === 'g') return `${n0(g.short)} g of protein`;
  if (g.unit === 'min') return `${n0(g.short)} minutes of flame`;
  if (g.unit === 'person-days') return `${n0(g.short / adults)} more days for ${plural(adults, 'adult')}`;
  if (g.unit === 'pet-days') return `${n0(g.short)} pet-days of food`;
  return amount(g.short, g.unit);
}

function viewReady() {
  const s = S.settings, items = live(), t = C.totals(items);
  const hh = [plural(s.adults, 'adult'), s.dogs ? plural(s.dogs, 'dog') : '', s.cats ? plural(s.cats, 'cat') : ''].filter(Boolean).join(', ');
  let h = `<div class="ration"><div class="seg" role="group" aria-label="Ration level">
      <button data-act="ration" data-v="survival" aria-pressed="${s.rationLevel !== 'standard'}">Survival ${n0(s.kcalSurvival)}</button>
      <button data-act="ration" data-v="standard" aria-pressed="${s.rationLevel === 'standard'}">Standard ${n0(s.kcalStandard)}</button></div>
    <span class="note">kcal per adult a day · ${esc(hh)}</span></div>`;
  if (!items.length) {
    h += `<div class="card"><h2>Start here</h2><p class="note">Add your first item with a photo of the pack, or bring in a backup file. Each scenario below fills in as you log what you have.</p>
      <div class="actions start"><button class="btn primary" data-act="add">Add item</button><a class="btn" href="#more">Import a backup</a></div></div>`;
  }
  h += '<h2 class="sect">Scenarios</h2><ul class="rows">' + S.scenarios.map(scn => {
    const v = scenarioView(scn, C.evaluate(scn, items, s, today(), typeLabel));
    return `<li class="row scn s-${v.cls}"><button class="row-main col" data-act="scn" data-id="${esc(scn.id)}">
      <span class="scn-head"><span class="nm">${esc(scn.name)}</span><span class="target">${plural(scn.days, 'day')}</span></span>
      <span class="verdict">${v.verdict}</span>${v.chips ? `<span class="chips">${v.chips}</span>` : ''}</button></li>`;
  }).join('') + `</ul><div class="actions start"><button class="btn small" data-act="scn-new">Add scenario</button></div>`;

  if (items.some(i => i.area === 'food')) {
    h += `<div class="card"><h2>Meals from your stock</h2><p class="note">Builds breakfast, lunch, dinner and a snack from what you have, oldest first, to your ration and protein targets.</p>
      <div class="actions start"><button class="btn primary" data-act="meals">Plan meals</button></div></div>`;
  }
  const gs = C.gaps(S.scenarios, items, s, today(), typeLabel);
  h += `<div class="card"><h2>To cover every scenario</h2>` + (gs.length ? `<ul class="gaps">` + gs.map(g =>
    `<li><span class="g-what"><b>${esc(g.needName)}${g.label && g.label !== g.needName && g.need !== 'water' && g.need !== 'fuel' && g.need !== 'power' ? ': ' + esc(g.label) : ''}</b>
      <small>short in ${g.scenarios.length} of ${S.scenarios.length} scenarios, most in "${esc(g.worst)}"</small></span><span class="g-amt">${esc(gapAmount(g))}</span></li>`).join('') + '</ul>'
    : '<p class="note">Every scenario is covered by what you have logged.</p>') + '</div>';

  const jump = (label, n, f) => `<a href="#supplies" data-jump="${f}"><span>${label}</span><b>${n}</b></a>`;
  h += `<div class="card"><h2>In stock</h2><div class="tiles">
      <div class="tile"><div class="n">${n1(t.water)} L</div><div class="l">water</div></div>
      <div class="tile"><div class="n">${n0(t.kcal)}</div><div class="l">kcal of food, ${n0(t.protein)} g protein</div></div>
      <div class="tile"><div class="n">${n0(t.fuel)} min</div><div class="l">cooking flame</div></div>
      <div class="tile"><div class="n">${n0(t.power)} Wh</div><div class="l">stored power</div></div></div>
    <div class="attn">${jump('Items logged', t.rows, 'st=')}${jump('Need details', t.drafts, 'st=draft')}${jump('Nutrition is an estimate', t.estimates, 'st=estimate')}${jump('Quantity not counted', t.uncounted, 'st=uncounted')}</div></div>`;
  return h;
}

// ---------- view: Supplies ----------
function filtered() {
  const f = S.f, q = f.q.trim().toLowerCase();
  const list = live().filter(it => {
    if (f.area && it.area !== f.area) return false;
    if (f.loc && it.location !== f.loc) return false;
    if (q && ![it.name, it.brand, it.notes, it.barcode, it.category].join(' ').toLowerCase().includes(q)) return false;
    if (f.st === 'draft') return C.missing(it).length > 0;
    if (f.st === 'uncounted') return !it.confirmed;
    if (f.st === 'low') return isLow(it);
    if (f.st === 'estimate') return it.area === 'food' && C.num(it.kcal) !== null && !['LABEL', 'ONLINE', 'GENERIC'].includes(it.source);
    if (f.st === 'notlabel') return it.area === 'food' && C.num(it.kcal) !== null && it.source !== 'LABEL';
    if (f.st) return dueInfo(it).cls === f.st;
    return true;
  });
  const dueKey = it => C.nextDue(it).date || '9999';
  const sorters = {
    due: (a, b) => dueKey(a).localeCompare(dueKey(b)) || String(a.name).localeCompare(String(b.name)),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
    recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
  };
  return list.sort(sorters[f.sort] || sorters.due);
}

function viewSupplies() {
  const f = S.f, s = S.settings, list = filtered(), total = live().length;
  const chip = (id, label) => `<button class="chip" data-act="area" data-v="${id}" aria-pressed="${f.area === id}">${esc(label)}</button>`;
  return `<div class="chiprow" role="group" aria-label="Area">${chip('', 'All')}${AREAS.map(a => chip(a.id, a.short)).join('')}</div>
    <div class="filters"><input type="search" id="f-q" data-f="q" placeholder="Search name, brand or notes" value="${esc(f.q)}" aria-label="Search">
      <select id="f-loc" data-f="loc" aria-label="Location">${opt('', 'All locations', f.loc)}${s.locations.map(l => opt(l, l, f.loc)).join('')}</select>
      <select id="f-st" data-f="st" aria-label="Status">${opt('', 'Any status', f.st)}${opt('expired', 'Past date or check overdue', f.st)}${opt('eatfirst', 'Use first', f.st)}${opt('soon', 'Soon', f.st)}${opt('nodate', 'No date', f.st)}${opt('low', 'Low or out', f.st)}${opt('draft', 'Needs details', f.st)}${opt('uncounted', 'Quantity not counted', f.st)}${opt('estimate', 'Nutrition is an estimate', f.st)}${opt('notlabel', 'Nutrition not from the label', f.st)}</select>
      <select id="f-sort" data-f="sort" aria-label="Sort">${opt('due', 'Due first', f.sort)}${opt('name', 'Name', f.sort)}${opt('recent', 'Recently changed', f.sort)}</select></div>
    <p class="note">${list.length} of ${total} items</p>
    ${list.length ? '<ul class="rows">' + list.map(rowHTML).join('') + '</ul>' : `<p class="empty">${total ? 'Nothing matches these filters.' : 'No items yet. Tap Add item to log the first one.'}</p>`}`;
}

// ---------- view: Due ----------
function viewDue() {
  const s = S.settings, buckets = { over: [], d30: [], first: [], soon: [], later: [] };
  let undated = 0;
  for (const it of live()) {
    if ((C.num(it.qty) || 0) <= 0 && it.area !== 'kit') continue;
    const entries = [];
    if (it.bestBefore) entries.push({ kind: it.area === 'medical' ? 'Expires' : 'Best before', date: it.bestBefore, check: false });
    const cd = C.checkDue(it);
    if (cd) entries.push({ kind: 'Check', date: cd, check: true });
    if (!entries.length && it.area !== 'kit') undated++;
    for (const e of entries) {
      const d = C.daysLeft(e.date, today());
      const b = d < 0 ? 'over' : d < 30 ? 'd30' : d < s.eatFirstDays ? 'first' : d < s.soonDays ? 'soon' : 'later';
      buckets[b].push({ it, d, ...e });
    }
  }
  const row = e => `<li class="row s-${e.d < 0 ? 'expired' : e.d < s.eatFirstDays ? 'eatfirst' : e.d < s.soonDays ? 'soon' : 'ok'}"><button class="row-main" data-act="edit" data-id="${esc(e.it.id)}">
      <span class="row-text"><span class="nm">${esc(e.it.name)}</span><span class="mt">${esc(e.kind)} ${esc(fdate(e.date))} · ${esc(dayWords(e.d))} · ${esc(e.it.location || '')}</span></span></button>
      ${e.check ? `<div class="row-qty"><button class="btn small" data-act="checked" data-id="${esc(e.it.id)}">Checked</button></div>` : `<div class="row-qty"><b>${esc(n1(C.num(e.it.qty) || 0))}</b><small>in stock</small></div>`}</li>`;
  const sect = (title, arr) => arr.length ? `<h2 class="sect">${esc(title)} (${arr.length})</h2><ul class="rows">${arr.sort((a, b) => a.d - b.d).map(row).join('')}</ul>` : '';
  const any = Object.values(buckets).some(a => a.length);
  return sect('Overdue', buckets.over) + sect('Next 30 days', buckets.d30) + sect(`Within ${s.eatFirstDays} days`, buckets.first) +
    sect(`Within ${s.soonDays} days`, buckets.soon) +
    (buckets.later.length ? `<details class="fold"><summary>Later (${buckets.later.length})</summary><ul class="rows">${buckets.later.sort((a, b) => a.d - b.d).map(row).join('')}</ul></details>` : '') +
    (any ? '' : '<p class="empty">Nothing with a date yet. Dates and check intervals you enter on items show up here.</p>') +
    (undated ? `<p class="note"><a href="#supplies" data-jump="st=nodate">${plural(undated, 'item')} with no date</a>: check the pack and add one.</p>` : '');
}

// ---------- view: Log ----------
function viewLog() {
  const f = S.f, types = ['ADD', 'USE', 'RESTOCK', 'EDIT', 'CHECK', 'DELETE', 'IMPORT'];
  const rows = S.events.filter(e => !f.act || e.type === f.act).slice(0, 400);
  return `<div class="filters"><select id="f-act" data-f="act" aria-label="Action">${opt('', 'All actions', f.act)}${types.map(t => opt(t, t, f.act)).join('')}</select></div>` +
    (rows.length ? `<div class="card"><div class="scroll"><table><thead><tr><th>When</th><th>Action</th><th>Item</th><th>Change</th><th>Left</th></tr></thead><tbody>${rows.map(e => {
      const d = new Date(e.at);
      const when = isNaN(d) ? e.at : d.toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<tr><td>${esc(when)}</td><td>${esc(e.type)}</td><td>${esc(e.item)}</td><td>${e.delta > 0 ? '+' : ''}${esc(val(e.delta))}</td><td>${esc(val(e.qtyAfter))}</td></tr>`;
    }).join('')}</tbody></table></div><p class="note">Newest first. Showing up to 400 entries.</p></div>`
      : '<p class="empty">No entries yet. Adding, using, restocking, editing and checking items are recorded here.</p>');
}

// ---------- view: More ----------
function viewMore() {
  const s = S.settings;
  const N = (id, label, value, step) => `<label class="f">${label}<input id="${id}" type="number" inputmode="decimal" step="${step || 'any'}" min="0" value="${esc(val(value))}"></label>`;
  const keyState = S.apiKey ? `A key is saved on this phone (ends in ${esc(S.apiKey.slice(-4))}).` : 'No key saved.';
  const backup = S.lastBackupAt ? `Last backup: ${esc(fdate(S.lastBackupAt.slice(0, 10)))}.` : 'No backup made yet.';
  const persisted = S.persisted === null ? 'not known on this browser' : S.persisted ? 'yes' : 'not yet';
  return `<form class="card" id="set-form"><h2>Household and rules</h2><div class="grid2">
      ${N('s-adults', 'Adults', s.adults, 1)}${N('s-dogs', 'Dogs', s.dogs, 1)}${N('s-cats', 'Cats', s.cats, 1)}
      ${N('s-ksurv', 'Survival ration, kcal per adult', s.kcalSurvival, 1)}${N('s-kstd', 'Standard ration, kcal per adult', s.kcalStandard, 1)}${N('s-kact', 'On the move, kcal per adult', s.kcalActive, 1)}
      ${N('s-prot', 'Protein, g per adult a day', s.proteinPerDay, 1)}${N('s-water', 'Water, litres per person a day', s.waterPerPerson)}${N('s-petw', 'Water, litres per pet a day', s.petWaterEach)}
      ${N('s-flame', 'Cooking flame, minutes a day', s.flameMinPerDay, 1)}${N('s-power', 'Power, Wh a day', s.powerWhPerDay, 1)}
      ${N('s-oil', 'Oil counts for at most (% of calories)', Math.round(s.oilCap * 100), 1)}${N('s-sweet', 'Sweeteners count for at most (%, 0 = no cap)', Math.round(s.sweetCap * 100), 1)}
      ${N('s-eat', 'Use first under (days)', s.eatFirstDays, 1)}${N('s-soon', 'Soon under (days)', s.soonDays, 1)}</div>
      <label class="c"><input id="s-protlim" type="checkbox"${s.proteinLimits !== false ? ' checked' : ''}><span>Protein can limit the days of food</span></label>
      <label class="c"><input id="s-expired" type="checkbox"${s.countExpired ? ' checked' : ''}><span>Count stock that is past its best-before date (medicine past expiry never counts)</span></label>
      <div class="grid2"><label class="f">Locations, one per line<textarea id="s-locs" rows="6">${esc(s.locations.join('\n'))}</textarea></label>
      <label class="f">Food categories, one per line<textarea id="s-fcats" rows="6">${esc(s.foodCategories.join('\n'))}</textarea></label></div>
      <p class="note">Oil is the category named "${esc(s.oilCategory)}" and sweeteners the one named "${esc(s.sweetCategory)}".</p>
      <div class="actions"><button class="btn primary" type="submit">Save</button></div></form>

    <form class="card" id="key-form"><h2>Reading labels from photos</h2>
      <p class="note">With your own Anthropic API key, Claude reads the pack from your photos and fills in the form for you to check. The key is stored only on this phone. Photos and the key are sent to Anthropic when you tap Read label, and nowhere else. Anyone who can unlock this phone could copy the key, so use one made for this app with a spend limit.</p>
      <p class="note" id="key-state">${keyState}</p>
      <label class="f">API key<input id="k-key" class="secret" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="sk-ant-…"></label>
      <label class="f">Model<select id="k-model">${MODELS.map(m => opt(m.id, m.label, s.apiModel)).join('')}</select></label>
      <div class="actions">${S.apiKey ? '<button class="btn danger" type="button" data-act="key-remove">Remove key</button><button class="btn" type="button" data-act="key-test">Test</button>' : ''}<button class="btn primary" type="submit">Save</button></div></form>

    <div class="card"><h2>Backup</h2>
      <p class="note">Everything is stored on this phone only. A backup file is your copy if the phone is lost, and the way to move data to another device. ${backup}</p>
      <label class="c"><input id="b-photos" type="checkbox"><span>Include photos (a much larger file)</span></label>
      <div class="actions start"><button class="btn primary" data-act="backup">Save a backup file</button>
        <label class="btn" for="b-file">Import a backup file</label><input class="vh" id="b-file" type="file" accept=".json,application/json">
        <button class="btn" data-act="csv">Export food list for Excel</button></div>
      <p class="note">Protected from automatic clean-up by the browser: ${persisted}.</p></div>

    <details class="card"><summary><h2>Where the default figures come from</h2></summary><ul class="sources">${SOURCES.map(x =>
      `<li><b>${esc(x.what)}</b><span>${esc(x.why)}</span>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.from)}</a>` : `<i>${esc(x.from)}</i>`}</li>`).join('')}</ul></details>

    <div class="card"><h2>About</h2><p class="note">Prep ${APP_VERSION}. Works without a connection once installed.</p>
      <div class="actions start">${S.installEvt ? '<button class="btn primary" data-act="install">Install on this phone</button>' : ''}<button class="btn" data-act="update">Check for an update</button></div></div>`;
}

const VIEWS = { ready: viewReady, supplies: viewSupplies, due: viewDue, log: viewLog, more: viewMore };

function render() {
  const a = document.activeElement, id = a && main.contains(a) ? a.id : '';
  let pos = null;
  try { pos = a.selectionStart; } catch (e) { /* not a text field */ }
  main.innerHTML = '<div class="wrap">' + (S.error ? `<div class="card"><h2>Something went wrong</h2><p class="note">${esc(S.error)}</p></div>` : VIEWS[S.view]()) + '</div>';
  document.querySelectorAll('#nav a').forEach(l => {
    if (l.getAttribute('href') === '#' + S.view) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current');
  });
  if (id) {
    const e = document.getElementById(id);
    if (e) { e.focus(); if (pos !== null) try { e.setSelectionRange(pos, pos); } catch (x) { /* ignore */ } }
  }
}

function renderBanner() {
  const b = $('#banner');
  let h = '';
  if (S.updateReady) h += '<div class="banner info"><span>A new version is ready.</span><button class="btn small" data-act="apply-update">Update now</button></div>';
  const days = S.lastBackupAt ? C.daysLeft(today(), S.lastBackupAt.slice(0, 10)) : null;
  if (live().length >= 5 && (days === null || days > 30)) {
    h += `<div class="banner warn"><span>${days === null ? 'No backup yet.' : `Last backup was ${days} days ago.`} Your data is only on this phone.</span><a class="btn small" href="#more">Back up</a></div>`;
  }
  b.innerHTML = h;
}

function route() {
  const h = (location.hash || '').slice(1);
  S.view = VIEWS[h] ? h : 'ready';
  render();
  main.scrollTop = 0;
}

function refresh() { render(); renderBanner(); }

// ---------- dialogs ----------
let dlgCleanup = null;
function openDlg(build) {
  if (dlgCleanup) { dlgCleanup(); dlgCleanup = null; }
  dlg.onclick = dlg.onchange = dlg.oninput = dlg.onsubmit = null;
  build();
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}
// The close event arrives after the fact, so a dialog that was reopened straight away must be left alone.
dlg.addEventListener('close', () => {
  if (dlg.open) return;
  if (dlgCleanup) { dlgCleanup(); dlgCleanup = null; }
  dlg.innerHTML = '';
});

// ---------- use / restock ----------
function openUse(id) {
  const it = S.items.find(x => x.id === id);
  if (!it) return;
  let n = 1;
  const same = o => o.id !== it.id && !o.deleted && o.area === it.area && (C.num(o.qty) || 0) > 0 &&
    String(o.name).toLowerCase() === String(it.name).toLowerCase() && (o.brand || '') === (it.brand || '');
  const earlier = S.items.filter(o => same(o) && o.bestBefore && (!it.bestBefore || o.bestBefore < it.bestBefore))
    .sort((a, b) => a.bestBefore.localeCompare(b.bestBefore))[0];
  const draw = () => {
    const have = C.num(it.qty) || 0;
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h2>${esc(it.name)}</h2><button class="btn small" data-x="close">Close</button></div>
      <p class="note">${esc([it.location, it.bestBefore ? fdate(it.bestBefore) : '', n1(have) + ' in stock'].filter(Boolean).join(' · '))}</p>
      ${earlier ? `<div class="banner warn"><span>An earlier batch runs out of date on ${esc(fdate(earlier.bestBefore))} (${esc(earlier.location || '')}, ${esc(n1(earlier.qty))} in stock). Use that one first.</span><button class="btn small" data-x="switch">Switch to it</button></div>` : ''}
      <div class="stepper"><button class="btn" data-x="minus" aria-label="One fewer">−</button>
        <input id="u-n" type="number" inputmode="decimal" step="any" min="0" value="${esc(n)}" aria-label="How many"><button class="btn" data-x="plus" aria-label="One more">+</button></div>
      <div class="actions"><button class="btn" data-x="restock">Restock</button><button class="btn primary" data-x="use"${have <= 0 ? ' disabled' : ''}>Use</button></div>
      ${C.num(it.checkEveryMonths) ? `<div class="actions"><button class="btn" data-x="checked">Mark as checked today</button></div>` : ''}
      <p class="note">Part of a pack is fine: use 0.5 for half. Restock adds units with the same date. For a new date, open the item and choose New batch.</p></div>`;
  };
  openDlg(() => {
    draw();
    dlg.oninput = e => { if (e.target.id === 'u-n') n = C.num(e.target.value) ?? 0; };
    dlg.onclick = async e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const x = b.dataset.x;
      if (x === 'close') return dlg.close();
      if (x === 'minus') { n = Math.max(0, round3(n - 1)); return draw(); }
      if (x === 'plus') { n = round3(n + 1); return draw(); }
      if (x === 'switch') { dlg.close(); return openUse(earlier.id); }
      if (x === 'checked') { dlg.close(); return markChecked(it.id); }
      if (!(n > 0)) { toast('Enter how many.'); return; }
      const have = C.num(it.qty) || 0;
      const delta = x === 'use' ? -Math.min(n, have) : n;
      b.disabled = true;
      const ok = await guard(async () => {
        await commit({ ...it, qty: round3(have + delta) }, x === 'use' ? 'USE' : 'RESTOCK', delta);
      });
      if (!ok) { b.disabled = false; return; }
      dlg.close(); refresh();
      const left = round3(have + delta);
      toast(`${x === 'use' ? 'Used' : 'Added'} ${n1(Math.abs(delta))}. ${n1(left)} left${left === 0 ? ', item kept at 0.' : '.'}`);
    };
  });
}

async function markChecked(id) {
  const it = S.items.find(x => x.id === id);
  if (!it) return;
  await guard(async () => {
    await commit({ ...it, lastChecked: today() }, 'CHECK', 0);
  });
  refresh();
  toast('Marked as checked today.');
}

// ---------- add / edit item ----------
function openItem(id, preset) {
  const s = S.settings;
  const orig = id ? S.items.find(x => x.id === id) : null;
  const isNew = !orig;
  const v = Object.assign({
    area: S.view === 'supplies' && S.f.area ? S.f.area : 'food', type: '', category: s.foodCategories[0] || '', name: '', brand: '',
    location: s.locations[0] || '', qty: 1, confirmed: false, unitSize: '', unit: 'g', bestBefore: '', kcal: '', protein: '', source: '',
    basis: '', needsCooking: false, cap: '', perDay: '', checkEveryMonths: '', lastChecked: '', minQty: '', barcode: '', notes: '', thumb: '',
  }, orig ? JSON.parse(JSON.stringify(orig)) : {}, preset || {});
  for (const k of ['unitSize', 'kcal', 'protein', 'cap', 'perDay', 'checkEveryMonths', 'minQty']) if (v[k] === null || v[k] === undefined) v[k] = '';
  const calc = { k: '', p: '', w: '' };
  const open = { more: false, calc: false };
  let existing = [], pending = [], note = null, err = '', reading = false, areaTouched = !isNew || !!preset;
  const removed = new Set(), urls = [];
  const origK = orig ? String(val(orig.kcal)) : null, origP = orig ? String(val(orig.protein)) : null;
  const kept = () => existing.filter(p => !removed.has(p.id));
  const fixType = () => {
    if (v.area === 'food') { if (!v.category) v.category = s.foodCategories[0] || ''; return; }
    const types = areaOf(v.area).types;
    if (!types.some(t => t.id === v.type)) v.type = types[0].id;
  };
  fixType();

  const F = (fid, label, value, attrs) => `<label class="f">${label}<input id="${fid}" value="${esc(val(value))}" ${attrs || ''}></label>`;
  const N = (fid, label, value, attrs) => F(fid, label, value, `type="number" inputmode="decimal" step="any" min="0" ${attrs || ''}`);
  const SEL = (fid, label, options, cur) => {
    if (cur && !options.some(o => o.id === cur)) options = options.concat([{ id: cur, label: cur }]);
    return `<label class="f">${label}<select id="${fid}">${options.map(o => opt(o.id, o.label, cur)).join('')}</select></label>`;
  };
  const HINT = {
    water: 'A 1.5 L bottle is 1.5.',
    fuel: 'Use the burn time for your own stove. Makers quote about 65 to 75 minutes for a 250 g can at full flame.',
    power: 'Use the Wh printed on the label if there is one.',
    medical: 'Regular medication counts toward a scenario only when you enter the doses taken a day.',
    hygiene: 'Soap: 250 g lasts one person a month, so a 100 g bar is 12 days. For other things, use your own experience.',
    pets: 'Use the feeding guide on the pack for your pet\'s weight. Litter and other items need no figure.',
  };

  function draw() {
    const a = areaOf(v.area);
    const types = v.area === 'food' ? s.foodCategories.map(c => ({ id: c, label: c })) : a.types;
    const tpl = isNew ? (TEMPLATES[v.area] || []) : [];
    const checks = `<div class="grid2">${N('i-checkm', 'Check or recharge every (months)', v.checkEveryMonths, 'step="1"')}
      <label class="f">Last checked<input id="i-lastc" type="date" value="${esc(v.lastChecked)}"></label></div>`;
    const checksUp = v.area === 'kit' || v.area === 'power';
    let special = '';
    if (v.area === 'food') {
      special = `<fieldset><legend>Nutrition for one pack</legend><div class="grid2">${N('i-kcal', 'kcal per pack', v.kcal)}${N('i-prot', 'Protein, g per pack', v.protein)}</div>
        <details id="i-calc"${open.calc ? ' open' : ''}><summary>Work it out from the per-100 g figures (optional)</summary><div class="grid2 gap-top">
          ${N('c-k', 'kcal per 100 g or ml', calc.k)}${N('c-p', 'Protein, g per 100 g or ml', calc.p)}${N('c-w', 'Weight you eat, g or ml (drained weight for fish in oil or brine)', calc.w)}</div>
          <div class="actions start gap-top"><button class="btn small" type="button" data-x="calc">Calculate the two figures above</button></div></details>
        <p class="note" id="i-basis">${esc(v.basis)}</p>
        <label class="c"><input type="radio" name="i-src" value="LABEL"${v.source === 'LABEL' ? ' checked' : ''}><span>Copied from the pack label, and I checked it</span></label>
        <label class="c"><input type="radio" name="i-src" value="ONLINE"${v.source === 'ONLINE' ? ' checked' : ''}><span>From a similar product found online</span></label>
        <label class="c"><input type="radio" name="i-src" value="GENERIC"${v.source === 'GENERIC' ? ' checked' : ''}><span>A generic reference figure, for example USDA</span></label>
        <label class="c"><input type="radio" name="i-src" value="ESTIMATE"${v.source === 'ESTIMATE' ? ' checked' : ''}><span>This is an estimate</span></label>
        <label class="c"><input id="i-cook" type="checkbox"${v.needsCooking ? ' checked' : ''}><span>Needs cooking or boiling water</span></label>
        <div id="i-kwarn"></div></fieldset>`;
    } else if (a.capLabel) {
      special = `<fieldset><legend>${esc(a.name)}: what one unit gives</legend><div class="grid2">${N('i-cap', esc(a.capLabel), v.cap)}
        ${v.area === 'medical' ? N('i-perday', 'Doses taken a day (leave blank if not taken daily)', v.perDay) : ''}</div>
        ${v.area === 'power' ? `<details><summary>Work out Wh from mAh</summary><div class="grid2 gap-top">${N('c-mah', 'Capacity in mAh', '')}</div><div class="actions start gap-top"><button class="btn small" type="button" data-x="mah">Fill in Wh</button></div></details>` : ''}
        <p class="note">${esc(HINT[v.area] || '')}</p><p class="note" id="i-basis">${esc(v.basis)}</p></fieldset>`;
    }
    dlg.innerHTML = `<form class="dlg" id="item-form" novalidate>
      <div class="dlg-head"><h2>${isNew ? (preset && preset._batch ? 'New batch' : 'Add item') : 'Edit item'}</h2><button class="btn small" type="button" data-x="close">Close</button></div>
      ${SEL('i-area', 'Area', AREAS.map(x => ({ id: x.id, label: x.name })), v.area)}
      ${tpl.length ? `<div class="chiprow" role="group" aria-label="Quick fill">${tpl.map((t, i) => `<button class="chip" type="button" data-x="tpl" data-i="${i}">${esc(t.label)}</button>`).join('')}</div>` : ''}
      <fieldset><legend>Photos</legend><div class="photos" id="ph"></div>
        <div class="actions start"><input class="vh" id="i-cam" type="file" accept="image/*" capture="environment">
          <label class="btn" for="i-gal">Choose photos</label><input class="vh" id="i-gal" type="file" accept="image/*" multiple>
          <button class="btn primary" type="button" data-x="read" id="i-read">Read label</button></div>
        <p class="note">${S.apiKey ? 'Use the camera button at the bottom right. Up to 3 photos: front of pack, nutrition or specification panel, date. Reading sends them to Anthropic with your key. Unreadable fields are left blank, never guessed.'
          : 'Use the camera button at the bottom right. Up to 3 photos. To have Claude read the label, add your API key under More. Without it, type the details, now or later.'}</p>
        <div id="i-note">${note ? `<div class="banner ${note.cls}"><span>${esc(note.text)}</span></div>` : ''}</div></fieldset>
      <div id="i-match"></div>
      ${F('i-name', 'Name', v.name)}
      <div class="grid2">${F('i-brand', 'Brand', v.brand)}${SEL('i-type', v.area === 'food' ? 'Category' : 'Type', types, v.area === 'food' ? v.category : v.type)}</div>
      <div class="grid2">${N('i-qty', 'How many you have', v.qty)}${SEL('i-loc', 'Location', s.locations.map(l => ({ id: l, label: l })), v.location)}</div>
      <div class="grid2"><label class="f">${v.area === 'medical' ? 'Expiry date' : 'Best before or expiry'}<input id="i-bb" type="date" value="${esc(v.bestBefore)}"></label>
        <div class="grid2 tight">${N('i-size', 'Size of one unit', v.unitSize)}${SEL('i-unit', 'Unit', [{ id: 'g', label: 'g' }, { id: 'ml', label: 'ml' }, { id: 'pcs', label: 'pcs' }], v.unit)}</div></div>
      <label class="c"><input id="i-conf" type="checkbox"${v.confirmed ? ' checked' : ''}><span>I counted this quantity myself</span></label>
      ${special}
      ${checksUp ? `<fieldset><legend>Checks</legend>${checks}</fieldset>` : ''}
      <details id="i-more"${open.more ? ' open' : ''}><summary>More: minimum to keep, barcode, notes${checksUp ? '' : ', checks'}</summary><div class="grid2 gap-top">
        ${N('i-min', 'Minimum to keep (flags it as low below this)', v.minQty)}${F('i-bar', 'Barcode number', v.barcode, 'inputmode="numeric"')}</div>
        ${checksUp ? '' : `<div class="gap-top">${checks}</div>`}
        <label class="f gap-top">Notes<textarea id="i-notes">${esc(v.notes)}</textarea></label></details>
      <div class="fabwrap"><label class="fab" for="i-cam"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg><span>Photo</span></label></div>
      <div id="i-err">${err ? `<div class="banner bad"><span>${esc(err)}</span></div>` : ''}</div>
      <div class="actions">${isNew ? '' : '<button class="btn danger" type="button" data-x="del">Delete</button><button class="btn" type="button" data-x="batch">New batch</button>'}<button class="btn primary" type="submit" id="i-save">Save</button></div></form>`;
    paintPhotos(); kwarn(); match();
  }

  function paintPhotos() {
    const ph = $('#ph', dlg);
    if (!ph) return;
    ph.textContent = '';
    const add = (url, onRemove) => {
      const box = document.createElement('span');
      box.className = 'photo';
      const im = document.createElement('img');
      im.alt = 'Photo of the item'; im.src = url;
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'photo-x'; rm.textContent = '×'; rm.setAttribute('aria-label', 'Remove photo');
      rm.onclick = onRemove;
      box.append(im, rm); ph.appendChild(box);
    };
    kept().forEach(p => add(p.url, () => { removed.add(p.id); paintPhotos(); }));
    pending.forEach((p, i) => add(p.url, () => { pending.splice(i, 1); paintPhotos(); }));
    const rb = $('#i-read', dlg);
    if (rb) { rb.disabled = reading || !(kept().length + pending.length); rb.textContent = reading ? 'Reading…' : 'Read label'; }
  }

  function kwarn() {
    const box = $('#i-kwarn', dlg), k = $('#i-kcal', dlg);
    if (box && k) box.innerHTML = k.value === '' ? '<div class="banner warn"><span>No kcal figure: this item will not count toward days of food.</span></div>' : '';
  }

  function match() {
    const box = $('#i-match', dlg);
    if (!box) return;
    box.textContent = '';
    if (!isNew) return;
    const name = ($('#i-name', dlg).value || '').trim().toLowerCase(), bar = ($('#i-bar', dlg).value || '').trim();
    const brand = ($('#i-brand', dlg).value || '').trim().toLowerCase();
    const m = live().find(o => (bar && o.barcode === bar) || (name && String(o.name).toLowerCase() === name && String(o.brand || '').toLowerCase() === brand));
    if (!m) return;
    const d = document.createElement('div');
    d.className = 'banner info';
    const sp = document.createElement('span');
    sp.textContent = `You already have "${m.name}" (${n1(C.num(m.qty) || 0)} in stock, ${fdate(m.bestBefore)}, ${m.location || ''}). Save here to add a separate batch.`;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn small'; b.textContent = 'Restock that one';
    b.onclick = () => { dlg.close(); openUse(m.id); };
    d.append(sp, b); box.appendChild(d);
  }

  function collect() {
    const g = fid => { const e = $('#' + fid, dlg); return e ? e.value : undefined; };
    const take = (k, fid) => { const x = g(fid); if (x !== undefined) v[k] = x; };
    take('name', 'i-name'); take('brand', 'i-brand'); take('location', 'i-loc'); take('qty', 'i-qty'); take('unitSize', 'i-size'); take('unit', 'i-unit');
    take('bestBefore', 'i-bb'); take('kcal', 'i-kcal'); take('protein', 'i-prot'); take('cap', 'i-cap'); take('perDay', 'i-perday');
    take('checkEveryMonths', 'i-checkm'); take('lastChecked', 'i-lastc'); take('minQty', 'i-min'); take('barcode', 'i-bar'); take('notes', 'i-notes');
    const t = g('i-type');
    if (t !== undefined) { if (v.area === 'food') v.category = t; else v.type = t; }
    const conf = $('#i-conf', dlg); if (conf) v.confirmed = conf.checked;
    const cook = $('#i-cook', dlg); if (cook) v.needsCooking = cook.checked;
    if (dlg.querySelector('[name=i-src]')) { const src = dlg.querySelector('[name=i-src]:checked'); v.source = src ? src.value : ''; }
    if (g('c-k') !== undefined) { calc.k = g('c-k'); calc.p = g('c-p'); calc.w = g('c-w'); }
    const more = $('#i-more', dlg); if (more) open.more = more.open;
    const cd = $('#i-calc', dlg); if (cd) open.calc = cd.open;
  }

  function perPack() {
    const k = C.num(calc.k), p = C.num(calc.p), w = C.num(calc.w);
    if (!w || (k === null && p === null)) return false;
    let maths = '';
    if (k !== null) { v.kcal = Math.round(k * w / 100); maths = `${k} kcal per 100 × ${w} = ${v.kcal} kcal.`; }
    if (p !== null) { v.protein = Math.round(p * w / 10) / 10; maths += ` Protein ${p} g per 100 × ${w} = ${v.protein} g.`; }
    v.basis = maths.trim();
    return true;
  }

  function applyRead(o) {
    const set = (k, x) => { if (x !== null && x !== undefined && x !== '') v[k] = x; };
    if (!areaTouched && o.area) { v.area = o.area; fixType(); }
    set('name', o.name); set('brand', o.brand); set('unitSize', o.unitSize); set('unit', o.unit); set('bestBefore', o.bestBefore); set('barcode', o.barcode);
    if (v.area === 'food') {
      set('category', o.category);
      if (o.needsCooking !== null) v.needsCooking = o.needsCooking;
      // Weight eaten: the drained weight if printed, else serving size x servings, else the net size of the pack.
      const servings = o.servingsPerPack, served = o.servingSize && servings ? Math.round(o.servingSize * servings * 10) / 10 : null;
      const w = o.drainedWeight || served || ((o.unit === 'g' || o.unit === 'ml') ? o.unitSize : null);
      calc.k = val(o.kcalPer100); calc.p = val(o.proteinPer100); calc.w = val(w);
      v.basis = '';
      if (o.kcalPerPack === null && o.proteinPerPack === null && servings && (o.kcalPerServing !== null || o.proteinPerServing !== null)) {
        const parts = [];
        if (o.kcalPerServing !== null) { v.kcal = Math.round(o.kcalPerServing * servings); parts.push(`${o.kcalPerServing} kcal a serving × ${servings} servings = ${v.kcal} kcal.`); }
        else if (o.kcalPer100 !== null && w) { v.kcal = Math.round(o.kcalPer100 * w / 100); parts.push(`${o.kcalPer100} kcal per 100 × ${w} = ${v.kcal} kcal.`); }
        if (o.proteinPerServing !== null) { v.protein = Math.round(o.proteinPerServing * servings * 10) / 10; parts.push(`Protein ${o.proteinPerServing} g a serving × ${servings} = ${v.protein} g.`); }
        else if (o.proteinPer100 !== null && w) { v.protein = Math.round(o.proteinPer100 * w / 10) / 10; parts.push(`Protein ${o.proteinPer100} g per 100 × ${w} = ${v.protein} g.`); }
        v.basis = parts.join(' ');
      } else if (o.kcalPerPack !== null || o.proteinPerPack !== null) {
        const parts = [];
        if (o.kcalPerPack !== null) { v.kcal = o.kcalPerPack; parts.push('kcal'); }
        if (o.proteinPerPack !== null) { v.protein = o.proteinPerPack; parts.push('protein'); }
        v.basis = `Per-pack ${parts.join(' and ')} as printed on the label.`;
        if (o.kcalPerPack === null && o.kcalPer100 !== null && w) { v.kcal = Math.round(o.kcalPer100 * w / 100); v.basis += ` kcal: ${o.kcalPer100} per 100 × ${w} = ${v.kcal}.`; }
        if (o.proteinPerPack === null && o.proteinPer100 !== null && w) { v.protein = Math.round(o.proteinPer100 * w / 10) / 10; v.basis += ` Protein: ${o.proteinPer100} g per 100 × ${w} = ${v.protein} g.`; }
      } else if (perPack()) v.basis += o.drainedWeight ? ' Based on the drained weight.' : served ? ` Weight is ${o.servingSize} per serving × ${servings} servings.` : '';
      if (calc.k !== '' || calc.p !== '') open.calc = true;
      v.source = '';                                   // the person must confirm where the figures come from
    } else if (v.area === 'water') {
      if (o.litresPerUnit !== null) v.cap = o.litresPerUnit; else if (o.unit === 'ml' && o.unitSize) v.cap = o.unitSize / 1000;
    } else if (v.area === 'power') {
      if (o.wattHours !== null) { v.cap = o.wattHours; v.basis = 'Wh as printed on the label.'; }
      else if (o.mAh !== null) { v.cap = Math.round(o.mAh * 3.7 / 1000 * 0.85); v.basis = `${n0(o.mAh)} mAh × 3.7 V × 0.85 = ${v.cap} Wh (estimate; the label gave no Wh).`; }
    } else if (v.area === 'medical') {
      if (o.unitsPerPack !== null) v.cap = o.unitsPerPack;
    } else if (v.area === 'hygiene' && v.type === 'soap' && o.unit === 'g' && o.unitSize && v.cap === '') {
      v.cap = Math.round(o.unitSize / (250 / 30)); v.basis = `${o.unitSize} g at 250 g per person per month = ${v.cap} person-days.`;
    }
    if (o.notes) v.notes = v.notes ? v.notes + ' ' + o.notes : o.notes;
    const miss = C.missing({ ...v, source: v.source || (v.area === 'food' ? 'x' : '') }).filter(m => m !== 'name');
    if (!v.bestBefore && v.area !== 'kit') miss.push('date');
    note = { cls: miss.length ? 'warn' : 'info', text: 'Read from your photos. Check every figure against the pack before you save.' + (miss.length ? ` Not found: ${miss.join(', ')}.` : '') };
  }

  async function doRead() {
    if (!S.apiKey) { toast('Add your API key under More first.'); return; }
    const blobs = pending.map(p => p.blob).concat(kept().map(p => p.blob)).slice(0, MAX_PHOTOS);
    if (!blobs.length) { toast('Add a photo first.'); return; }
    if (!navigator.onLine) { note = { cls: 'bad', text: 'You are offline. Reading a label needs a connection. You can save now and read later.' }; collect(); draw(); return; }
    reading = true; paintPhotos();
    try {
      const out = await readLabel({ apiKey: S.apiKey, model: s.apiModel, blobs, area: areaTouched ? v.area : null, categories: s.foodCategories });
      collect(); applyRead(out);
    } catch (e) {
      collect();
      note = { cls: 'bad', text: e && e.userMessage ? e.userMessage : 'The photos could not be read. Try a sharper, closer photo, or type the details in.' };
    }
    reading = false; err = ''; draw();
  }

  async function addFiles(files) {
    const room = MAX_PHOTOS - kept().length - pending.length;
    if (room <= 0) { toast(`Up to ${MAX_PHOTOS} photos an item. Remove one first.`); return; }
    for (const f of Array.from(files).slice(0, room)) {
      try {
        const blob = await shrink(f, 1568);
        const url = URL.createObjectURL(blob);
        urls.push(url); pending.push({ blob, url });
      } catch (e) { toast('That photo could not be opened.'); }
    }
    paintPhotos();
  }

  async function save() {
    collect();
    const qty = C.num(v.qty), problems = [];
    const photos = kept().length + pending.length;
    if (qty === null || qty < 0) problems.push('Enter how many you have, 0 or more.');
    if (!String(v.name).trim() && !photos) problems.push('Give it a name, or add a photo and fill in the rest later.');
    if (v.area === 'food' && (v.kcal !== '' || v.protein !== '') && !v.source) problems.push('Say where the nutrition figures come from.');
    if (problems.length) { err = problems.join(' '); draw(); const e = $('#i-err', dlg); if (e) e.scrollIntoView({ block: 'center' }); return; }
    const btn = $('#i-save', dlg);
    if (btn) btn.disabled = true;
    const a = areaOf(v.area), now = nowISO(), tdy = today();
    const item = Object.assign({}, orig || {}, {
      id: orig ? orig.id : uid(), area: v.area, type: v.area === 'food' ? '' : v.type, category: v.area === 'food' ? v.category : '',
      name: String(v.name).trim() || `Unnamed ${a.short.toLowerCase()} item`, brand: String(v.brand).trim(), location: v.location,
      qty: round3(qty), confirmed: !!v.confirmed, unitSize: C.num(v.unitSize), unit: v.unit, bestBefore: v.bestBefore || '',
      kcal: v.area === 'food' ? C.num(v.kcal) : null, protein: v.area === 'food' ? C.num(v.protein) : null,
      source: v.area === 'food' ? v.source : '', basis: v.basis || '', needsCooking: v.area === 'food' && !!v.needsCooking,
      cap: v.area === 'food' || v.area === 'kit' ? null : C.num(v.cap), perDay: v.area === 'medical' ? C.num(v.perDay) : null,
      checkEveryMonths: C.num(v.checkEveryMonths), lastChecked: v.lastChecked || (C.num(v.checkEveryMonths) ? tdy : ''),
      minQty: C.num(v.minQty), barcode: String(v.barcode).trim(), notes: String(v.notes).trim(), createdAt: orig ? orig.createdAt || now : now,
    });
    if (item.confirmed && !(orig && orig.confirmed)) item.countedAt = tdy;
    const ok = await guard(async () => {
      for (const pid of removed) await DB.del('photos', pid);
      for (const p of pending) await DB.put('photos', { id: uid(), itemId: item.id, blob: p.blob, at: now });
      const first = kept()[0] || pending[0];
      if (!first) item.thumb = '';
      else if (!item.thumb || removed.size || (pending.length && !kept().length)) item.thumb = await thumbOf(first.blob);
      await commit(item, isNew ? 'ADD' : 'EDIT', isNew ? item.qty : item.qty - (C.num(orig.qty) || 0));
    });
    if (!ok) { if (btn) btn.disabled = false; return; }
    dlg.close(); refresh(); toast('Saved.');
    if (S.persisted === null || S.persisted === false) keepStorage();
  }

  openDlg(() => {
    dlgCleanup = () => urls.forEach(u => URL.revokeObjectURL(u));
    draw();
    if (orig) {
      DB.byIndex('photos', 'itemId', orig.id).then(recs => {
        existing = recs.map(r => { const url = URL.createObjectURL(r.blob); urls.push(url); return { id: r.id, blob: r.blob, url }; });
        paintPhotos();
      }).catch(() => {});
    }
    dlg.onchange = e => {
      const t = e.target;
      if (t.id === 'i-area') { collect(); v.area = t.value; areaTouched = true; v.basis = ''; fixType(); draw(); }
      else if (t.id === 'i-cam' || t.id === 'i-gal') { const files = t.files; addFiles(files).then(() => { t.value = ''; }); }
    };
    dlg.oninput = e => {
      const t = e.target;
      if (t.id === 'i-kcal' || t.id === 'i-prot') {
        v.basis = ''; const b = $('#i-basis', dlg); if (b) b.textContent = '';
        if (!isNew && orig.source === 'LABEL' && (String($('#i-kcal', dlg).value) !== origK || String($('#i-prot', dlg).value) !== origP))
          dlg.querySelectorAll('[name=i-src]').forEach(r => { r.checked = false; });
        kwarn();
      } else if (t.id === 'i-cap') { v.basis = ''; const b = $('#i-basis', dlg); if (b) b.textContent = ''; }
      else if (t.id === 'i-name' || t.id === 'i-brand' || t.id === 'i-bar') match();
    };
    dlg.onclick = e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const x = b.dataset.x;
      if (x === 'close') dlg.close();
      else if (x === 'read') doRead();
      else if (x === 'tpl') { collect(); Object.assign(v, TEMPLATES[v.area][Number(b.dataset.i)].set); areaTouched = true; draw(); }
      else if (x === 'calc') { collect(); if (perPack()) { open.calc = true; draw(); } else toast('Enter the weight and at least one per-100 figure.'); }
      else if (x === 'mah') {
        const m = C.num($('#c-mah', dlg).value);
        if (!m) { toast('Enter the mAh figure.'); return; }
        collect(); v.cap = Math.round(m * 3.7 / 1000 * 0.85); v.basis = `${n0(m)} mAh × 3.7 V × 0.85 = ${v.cap} Wh (estimate; use the Wh on the label if there is one).`; draw();
      } else if (x === 'batch') {
        const base = { ...orig, _batch: true, bestBefore: '', qty: 1, confirmed: false, thumb: '' };
        delete base.id; delete base.createdAt; delete base.updatedAt; delete base.countedAt;
        dlg.close(); openItem(null, base);
      } else if (x === 'del') {
        ask(`Delete "${orig.name}" for good? To keep its history, set the quantity to 0 instead.`, 'Delete', true).then(async yes => {
          if (!yes) return;
          const ok = await guard(async () => {
            const photos = await DB.byIndex('photos', 'itemId', orig.id);
            for (const p of photos) await DB.del('photos', p.id);
            await commit({ ...orig, deleted: true, qty: 0, thumb: '' }, 'DELETE', -(C.num(orig.qty) || 0));
          });
          if (ok) { dlg.close(); refresh(); toast('Deleted.'); }
        });
      }
    };
    dlg.onsubmit = e => { e.preventDefault(); save(); };
  });
}

// ---------- scenarios ----------
function openScenario(id) {
  const scn = S.scenarios.find(x => x.id === id);
  if (!scn) return;
  const s = S.settings, r = C.evaluate(scn, live(), s, today(), typeLabel);
  const away = scn.place === 'away';
  const cond = [away ? 'Away from home' : 'At home', scn.tap && !away ? 'tap water works' : 'no tap water', scn.grid && !away ? 'mains power works' : 'no mains power',
    scn.shops && !away ? 'shops open' : 'no shops', `${n0(scenarioKcal(scn))} kcal per adult a day`];
  const where = away ? (scn.locations && scn.locations.length ? 'Counting only: ' + scn.locations.join(', ') + '.' : 'No locations chosen, so everything is counted. Edit the scenario to pick the bags.') : '';
  let rows = '';
  for (const n of r.needs) {
    rows += `<tr class="grp"><th colspan="3">${esc(n.name)}</th><th>${n.logged ? fmtDays(n.days) + ' of ' + r.target + ' days' : 'not logged'}</th></tr>`;
    for (const l of n.lines) {
      const uses = l.unit === 'person-days' ? plural(n1(l.perDay), 'person') : l.unit === 'pet-days' ? plural(n1(l.perDay), 'pet') : amount(l.perDay, l.unit) + ' a day';
      rows += `<tr><td>${esc(l.label)}${l.essential === false ? ' <small>(not counted)</small>' : ''}</td><td>${esc(amount(l.have, l.unit))}</td><td>${esc(uses)}</td><td>${fmtDays(l.days)} days</td></tr>`;
    }
  }
  const notes = [];
  const food = r.needs.find(n => n.id === 'food');
  if (food) {
    const i = food.info;
    if (!i.kitchen && i.cook > 0) notes.push(`${n0(i.cook)} kcal of your food needs cooking. ${n0(i.cookUsable)} kcal of it is counted, limited by how long the fuel lasts.`);
    if (i.oil > i.oilUsed + 1) notes.push(`Oil is capped at ${Math.round(s.oilCap * 100)}% of calories: ${n0(i.oilUsed)} of ${n0(i.oil)} kcal counted.`);
    if (i.sweet > i.sweetUsed + 1) notes.push(`Sweeteners are capped at ${Math.round(s.sweetCap * 100)}% of calories: ${n0(i.sweetUsed)} of ${n0(i.sweet)} kcal counted.`);
    if (i.noKcal) notes.push(`${plural(i.noKcal, 'food item')} with no kcal figure count as zero.`);
  }
  openDlg(() => {
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h2>${esc(scn.name)}</h2><button class="btn small" data-x="close">Close</button></div>
      <p class="note">${esc(plural(scn.days, 'day'))} · ${esc(cond.join(' · '))}. ${esc(where)}</p>
      ${r.needs.length ? `<div class="scroll"><table><thead><tr><th>Need</th><th>You have</th><th>Uses</th><th>Lasts</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note">With water, power and shops all working, nothing needs stocking.</p>'}
      ${notes.map(t => `<p class="note">${esc(t)}</p>`).join('')}
      <div class="actions"><button class="btn" data-x="edit">Edit scenario</button></div></div>`;
    dlg.onclick = e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'close') dlg.close(); else { dlg.close(); openScenarioEdit(id); }
    };
  });
}

function openScenarioEdit(id) {
  const s = S.settings;
  const orig = id ? S.scenarios.find(x => x.id === id) : null;
  const v = Object.assign({ name: '', days: 7, place: 'home', tap: false, grid: false, shops: false, ration: 'household', locations: [], petsAlong: true }, orig || {});
  const locs = Array.isArray(v.locations) ? v.locations : [];
  const C_ = (fid, label, on) => `<label class="c"><input id="${fid}" type="checkbox"${on ? ' checked' : ''}><span>${label}</span></label>`;
  openDlg(() => {
    dlg.innerHTML = `<form class="dlg" id="scn-form"><div class="dlg-head"><h2>${orig ? 'Edit scenario' : 'Add scenario'}</h2><button class="btn small" type="button" data-x="close">Close</button></div>
      <div class="grid2"><label class="f">Name<input id="n-name" required value="${esc(v.name)}"></label>
        <label class="f">How many days to cover<input id="n-days" type="number" inputmode="numeric" min="1" step="1" required value="${esc(v.days)}"></label></div>
      <div class="grid2"><label class="f">Where you are<select id="n-place">${opt('home', 'At home', v.place)}${opt('away', 'Away from home', v.place)}</select></label>
        <label class="f">Food ration<select id="n-ration">${opt('household', 'Household level (Survival or Standard)', v.ration)}${opt('active', `On the move (${n0(s.kcalActive)} kcal)`, v.ration)}</select></label></div>
      <fieldset><legend>What still works (at home)</legend>${C_('n-tap', 'Tap water works', v.tap)}${C_('n-grid', 'Mains power works', v.grid)}${C_('n-shops', 'Shops are open', v.shops)}</fieldset>
      <fieldset><legend>Count only these locations (none ticked = all)</legend>${s.locations.map((l, i) => C_('n-loc-' + i, esc(l), locs.includes(l))).join('')}
        ${C_('n-pets', 'Pets come along when away', v.petsAlong !== false)}</fieldset>
      <div class="actions">${orig ? '<button class="btn danger" type="button" data-x="del">Delete</button>' : ''}<button class="btn primary" type="submit">Save</button></div></form>`;
    dlg.onclick = e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'close') return dlg.close();
      ask(`Delete the scenario "${orig.name}"?`, 'Delete', true).then(async yes => {
        if (!yes) return;
        S.scenarios = S.scenarios.filter(x => x.id !== orig.id);
        if (await guard(saveScenarios)) { dlg.close(); refresh(); }
      });
    };
    dlg.onsubmit = async e => {
      e.preventDefault();
      const name = $('#n-name', dlg).value.trim(), days = C.num($('#n-days', dlg).value);
      if (!name || !days || days < 1) { toast('Enter a name and the number of days.'); return; }
      const next = { id: orig ? orig.id : uid(), name, days: Math.round(days), place: $('#n-place', dlg).value, ration: $('#n-ration', dlg).value,
        tap: $('#n-tap', dlg).checked, grid: $('#n-grid', dlg).checked, shops: $('#n-shops', dlg).checked,
        locations: s.locations.filter((l, i) => $('#n-loc-' + i, dlg).checked), petsAlong: $('#n-pets', dlg).checked };
      if (orig) S.scenarios = S.scenarios.map(x => (x.id === orig.id ? next : x)); else S.scenarios.push(next);
      if (await guard(saveScenarios)) { dlg.close(); refresh(); }
    };
  });
}

// ---------- meal planner ----------
function openMeals() {
  const s = S.settings;
  const bagLocs = [...new Set(S.scenarios.filter(x => x.place === 'away').flatMap(x => (Array.isArray(x.locations) ? x.locations : [])))];
  const state = { canCook: true, skipBags: bagLocs.length > 0 };
  const kcal = s.rationLevel === 'standard' ? s.kcalStandard : s.kcalSurvival;
  const qtyText = l => {
    const packs = Math.round(l.packs * 100) / 100, whole = Math.abs(packs - Math.round(packs)) < 0.005;
    if (whole) return plural(Math.round(packs), 'pack');
    return l.unitSize && (l.unit === 'g' || l.unit === 'ml') ? `${n0(l.packs * l.unitSize)} ${l.unit} (${packs} of a pack)` : `${packs} of a pack`;
  };
  const mealHTML = m => `<div class="meal"><h3>${esc(m.name)} <small>${n0(m.kcal)} kcal · ${n0(m.protein)} g protein</small></h3><ul>${m.lines.map(l =>
    `<li><span>${esc(l.name)}</span><span>${esc(qtyText(l))}</span></li>`).join('')}</ul></div>`;
  const dayFlags = d => (d.full ? '' : '<span class="pill p-eatfirst">Short</span>') + (d.proteinMet ? '' : '<span class="pill p-soon">Low protein</span>') + (d.mostlySugar ? '<span class="pill p-expired">Mostly sugar</span>' : '');
  let plan = null;
  const draw = () => {
    const locations = state.skipBags ? s.locations.filter(l => !bagLocs.includes(l)) : null;
    plan = C.planMeals(live(), s, today(), { kcalPerAdult: kcal, canCook: state.canCook, locations });
    const d1 = plan.days[0];
    const protDays = plan.days.filter(d => d.proteinMet).length;
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h2>Meals from your stock</h2><button class="btn small" data-x="close">Close</button></div>
      <p class="note">${esc(plural(s.adults, 'adult'))} at ${n0(kcal)} kcal each a day (${n0(plan.target)} kcal), ${n0(plan.proteinTarget)} g protein. Oldest stock is used first.</p>
      <label class="c"><input id="m-cook" type="checkbox"${state.canCook ? ' checked' : ''}><span>We can cook (fuel or power is available)</span></label>
      ${bagLocs.length ? `<label class="c"><input id="m-bags" type="checkbox"${state.skipBags ? ' checked' : ''}><span>Leave the grab bags alone (${esc(bagLocs.join(', '))})</span></label>` : ''}
      ${d1 ? `<div class="banner info"><span>This stock makes ${plural(plan.days.length, 'day')} of meals, ${plan.fullDays} of them at the full ration in a row. The protein target is met on ${plural(protDays, 'day')}.${plan.leftoverKcal > 500 ? ` About ${n0(plan.leftoverKcal)} kcal is left over after that, mostly oil or scraps.` : ''}</span></div>
        <h2 class="sect">Today ${dayFlags(d1)}</h2>${d1.meals.map(mealHTML).join('')}
        <p class="note">Day total: ${n0(d1.kcal)} kcal and ${n0(d1.protein)} g protein.</p>
        <div class="actions"><button class="btn primary" data-x="eat">Log today's meals as eaten</button></div>
        ${plan.days.slice(1).map(d => `<details class="day"><summary>Day ${d.day} · ${n0(d.kcal)} kcal · ${n0(d.protein)} g protein ${dayFlags(d)}</summary>${d.meals.map(mealHTML).join('')}</details>`).join('')}`
      : '<div class="banner warn"><span>There is not enough food with a kcal figure to make a day of meals under these settings.</span></div>'}</div>`;
  };
  openDlg(() => {
    draw();
    dlg.onchange = e => {
      if (e.target.id === 'm-cook') { state.canCook = e.target.checked; draw(); }
      else if (e.target.id === 'm-bags') { state.skipBags = e.target.checked; draw(); }
    };
    dlg.onclick = async e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'close') return dlg.close();
      const d1 = plan.days[0];
      const use = new Map();
      for (const m of d1.meals) for (const l of m.lines) use.set(l.id, (use.get(l.id) || 0) + l.packs);
      if (!(await ask(`Log today's meals as eaten? This takes ${plural(use.size, 'item')} out of stock.`, 'Log as eaten', false))) return;
      const ok = await guard(async () => {
        for (const [id, packs] of use) {
          const it = S.items.find(x => x.id === id);
          if (!it) continue;
          const have = C.num(it.qty) || 0, delta = -Math.min(round3(packs), have);
          if (delta < 0) await commit({ ...it, qty: round3(have + delta) }, 'USE', delta);
        }
      });
      if (ok) { dlg.close(); refresh(); toast(`Logged ${plural(use.size, 'item')} as eaten.`); }
    };
  });
}

// ---------- backup ----------
async function exportBackup(withPhotos) {
  const data = { app: 'prep', format: 1, exportedAt: nowISO(), deviceId: S.deviceId, settings: S.settings, scenarios: S.scenarios, items: S.items, events: S.events };
  if (withPhotos) {
    const photos = await DB.all('photos');
    data.photos = [];
    for (const p of photos) data.photos.push({ id: p.id, itemId: p.itemId, at: p.at, dataUrl: await blobToDataURL(p.blob) });
  }
  download(JSON.stringify(data), `prep-backup-${today()}.json`, 'application/json');
  S.lastBackupAt = nowISO();
  await DB.put('meta', S.lastBackupAt, 'lastBackupAt');
  refresh();
  toast('Backup saved to your downloads.');
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
  if (!data || data.app !== 'prep' || !Array.isArray(data.items)) { toast('That file is not a Prep backup.'); return; }
  const fresh = live().length === 0;
  const local = new Map(S.items.map(i => [i.id, i]));
  const incoming = data.items.filter(i => i && typeof i.id === 'string' && typeof i.area === 'string');
  const writeItems = [];
  let added = 0, updated = 0;
  for (const it of incoming) {
    const cur = local.get(it.id);
    if (!cur) { added++; writeItems.push(it); local.set(it.id, it); }
    else if (String(it.updatedAt || '') > String(cur.updatedAt || '')) { updated++; writeItems.push(it); local.set(it.id, it); }
  }
  const seen = new Set(S.events.map(e => e.id));
  const newEvents = (Array.isArray(data.events) ? data.events : []).filter(e => e && typeof e.id === 'string' && !seen.has(e.id));
  const kept = incoming.length - added - updated;
  const yes = await ask(`This backup has ${plural(incoming.length, 'item')}: ${added} new, ${updated} newer than yours, ${kept} already up to date, plus ${newEvents.length} new log ${newEvents.length === 1 ? 'entry' : 'entries'}. ` +
    (fresh ? 'Its household settings and scenarios will be used.' : 'Your own settings and scenarios stay as they are.') + ' Nothing of yours is deleted.', 'Import', false);
  if (!yes) return;
  const ok = await guard(async () => {
    // Quantities follow the log: an item's quantity is the sum of its entries.
    const allEvents = S.events.concat(newEvents);
    const sums = new Map();
    for (const e of allEvents) sums.set(e.itemId, (sums.get(e.itemId) || 0) + (C.num(e.delta) || 0));
    const fix = [];
    for (const it of local.values()) {
      if (!sums.has(it.id)) continue;
      const q = Math.max(0, round3(sums.get(it.id)));
      if (q !== it.qty && !it.deleted) { it.qty = q; fix.push(it); }
    }
    const items = writeItems.concat(fix.filter(i => !writeItems.includes(i)));
    await DB.putAll(newEvents.map(e => ['events', e]).concat(items.map(i => ['items', i])));
    if (fresh && data.settings && typeof data.settings === 'object') { S.settings = { ...DEFAULT_SETTINGS, ...data.settings }; await saveSettings(); }
    const scns = (Array.isArray(data.scenarios) ? data.scenarios : []).filter(x => x && typeof x.id === 'string' && typeof x.name === 'string');
    if (fresh && scns.length) { S.scenarios = scns; await saveScenarios(); }
    if (Array.isArray(data.photos)) {
      const have = new Set((await DB.all('photos')).map(p => p.id));
      for (const p of data.photos) {
        if (!p || have.has(p.id) || typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/')) continue;
        await DB.put('photos', { id: p.id, itemId: p.itemId, at: p.at, blob: dataURLToBlob(p.dataUrl) });
      }
    }
    await load();
  });
  if (ok) { refresh(); toast(`Imported: ${added} new, ${updated} updated.`); keepStorage(); }
}

// ---------- page events ----------
document.addEventListener('click', async e => {
  const j = e.target.closest('[data-jump]');
  if (j) { const [k, v] = j.dataset.jump.split('='); Object.assign(S.f, { q: '', area: '', loc: '', st: '' }); S.f[k] = v || ''; return; }
  const b = e.target.closest('[data-act]');
  if (!b || dlg.contains(b) || askDlg.contains(b)) return;
  const act = b.dataset.act, id = b.dataset.id;
  switch (act) {
    case 'add': openItem(null); break;
    case 'edit': openItem(id); break;
    case 'use': openUse(id); break;
    case 'checked': markChecked(id); break;
    case 'scn': openScenario(id); break;
    case 'scn-new': openScenarioEdit(null); break;
    case 'meals': openMeals(); break;
    case 'area': S.f.area = b.dataset.v; render(); break;
    case 'ration': S.settings.rationLevel = b.dataset.v; await guard(saveSettings); render(); break;
    case 'backup': await guard(() => exportBackup($('#b-photos').checked)); break;
    case 'csv': download(C.foodCSV(S.items, S.settings, today()), `food-inventory-${today()}.csv`, 'text/csv'); toast('Food list saved to your downloads.'); break;
    case 'key-remove':
      if (await ask('Remove the API key from this phone?', 'Remove', true)) { S.apiKey = ''; await guard(() => DB.del('meta', 'apiKey')); render(); toast('Key removed.'); }
      break;
    case 'key-test':
      b.disabled = true; b.textContent = 'Testing…';
      try { await testKey(S.apiKey, S.settings.apiModel); toast('The key works.'); } catch (x) { toast(x && x.userMessage ? x.userMessage : 'The test failed.'); }
      render(); break;
    case 'install': if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; render(); } break;
    case 'update':
      if (S.swReg) { try { await S.swReg.update(); } catch (x) { /* offline */ } toast(S.updateReady || (S.swReg.waiting && navigator.serviceWorker.controller) ? 'A new version is ready.' : 'You have the latest version, or you are offline.'); }
      else toast('Updates are not available in this browser.');
      break;
    case 'apply-update':
      S.updateRequested = true;
      if (S.swReg && S.swReg.waiting) S.swReg.waiting.postMessage('skipWaiting'); else location.reload();
      break;
  }
});

main.addEventListener('input', e => { if (e.target.dataset.f === 'q') { S.f.q = e.target.value; render(); } });

main.addEventListener('change', e => {
  const f = e.target.dataset.f;
  if (f && f !== 'q') { S.f[f] = e.target.value; render(); return; }
  if (e.target.id === 'b-file' && e.target.files && e.target.files[0]) { const file = e.target.files[0]; e.target.value = ''; importBackup(file); }
});

main.addEventListener('submit', async e => {
  e.preventDefault();
  const g = id => C.num($('#' + id).value);
  if (e.target.id === 'set-form') {
    const lines = id => $('#' + id).value.split('\n').map(x => x.trim()).filter(Boolean);
    let locs = lines('s-locs'), cats = lines('s-fcats');
    const usedL = [...new Set(live().map(i => i.location).filter(Boolean))].filter(x => !locs.includes(x));
    const usedC = [...new Set(live().filter(i => i.area === 'food').map(i => i.category).filter(Boolean))].filter(x => !cats.includes(x));
    if (usedL.length || usedC.length) { locs = locs.concat(usedL); cats = cats.concat(usedC); toast('Kept because items still use them: ' + usedL.concat(usedC).join(', ')); }
    Object.assign(S.settings, {
      adults: Math.round(g('s-adults') ?? 1), dogs: Math.round(g('s-dogs') ?? 0), cats: Math.round(g('s-cats') ?? 0),
      kcalSurvival: g('s-ksurv') || 1600, kcalStandard: g('s-kstd') || 2100, kcalActive: g('s-kact') || 2700, proteinPerDay: g('s-prot') ?? 0,
      waterPerPerson: g('s-water') ?? 0, petWaterEach: g('s-petw') ?? 0, flameMinPerDay: g('s-flame') ?? 0, powerWhPerDay: g('s-power') ?? 0,
      oilCap: Math.min(0.95, (g('s-oil') ?? 0) / 100), sweetCap: Math.min(0.95, (g('s-sweet') ?? 0) / 100),
      eatFirstDays: Math.round(g('s-eat') ?? 90), soonDays: Math.round(g('s-soon') ?? 180),
      proteinLimits: $('#s-protlim').checked, countExpired: $('#s-expired').checked,
      locations: locs.length ? locs : DEFAULT_SETTINGS.locations.slice(), foodCategories: cats.length ? cats : DEFAULT_SETTINGS.foodCategories.slice(),
    });
    if (await guard(saveSettings)) { refresh(); if (!usedL.length && !usedC.length) toast('Saved.'); }
  } else if (e.target.id === 'key-form') {
    const key = $('#k-key').value.trim();
    S.settings.apiModel = $('#k-model').value;
    const ok = await guard(async () => { await saveSettings(); if (key) { await DB.put('meta', key, 'apiKey'); S.apiKey = key; } });
    if (ok) { render(); toast(key ? 'Key saved on this phone.' : 'Saved.'); }
  }
});

window.addEventListener('hashchange', route);
const net = () => { $('#net').hidden = navigator.onLine; };
window.addEventListener('online', net);
window.addEventListener('offline', net);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.view === 'more') render(); });

// ---------- start ----------
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    S.swReg = reg;
    const ready = () => { S.updateReady = true; renderBanner(); };
    const watch = w => { if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ready(); }); };
    if (reg.waiting && navigator.serviceWorker.controller) ready();
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.updateRequested) location.reload(); });
  } catch (e) { /* the app still works without offline support */ }
}

async function start() {
  net();
  try {
    await load();
    if (navigator.storage && navigator.storage.persisted) { try { S.persisted = await navigator.storage.persisted(); } catch (e) { /* ignore */ } }
  } catch (e) {
    console.error(e);
    S.error = 'This browser would not open the app\'s storage. Private or incognito windows often block it. Open the app in a normal window.';
  }
  route(); renderBanner();
  registerSW();
}
start();
