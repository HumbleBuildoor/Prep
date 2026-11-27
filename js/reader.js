// Reads a pack's label from photos with the Claude API, using the owner's own API key.
// The key and the photos go straight from this device to api.anthropic.com and nowhere else.
// Docs: https://platform.claude.com/docs/en/build-with-claude/vision
//       https://platform.claude.com/docs/en/manage-claude/authentication#browser-based-applications

import { num } from './calc.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const AREA_IDS = ['water', 'food', 'fuel', 'power', 'medical', 'hygiene', 'pets', 'kit'];

export class ReadError extends Error {
  constructor(code, userMessage) { super(userMessage); this.code = code; this.userMessage = userMessage; }
}

function headers(apiKey) {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',   // required for a request made from a browser
  };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function buildPrompt(area, categories, types) {
  const kinds = Object.entries(types || {}).filter(([a]) => !area || a === area).map(([a, list]) => a + ': ' + list.map(t => `"${t.id}" (${t.label})`).join(', ')).join('; ');
  return [
    'You are reading photos of ONE household supply item for an emergency-supplies tracker. The owner lives in Malaysia, where dates on packs are usually written day/month/year.',
    'Report only what is legibly printed on the item. Never estimate, infer or recall a value from memory: if something is not printed and readable, give null. If a date shows only a month and a year, use the last day of that month.',
    'Reply with one JSON object and nothing else. Use these keys, with null for anything you cannot read:',
    '- area: ' + (area ? 'use "' + area + '"' : 'the best fit of ' + AREA_IDS.map(a => '"' + a + '"').join(', ') + ' (kit means equipment or documents)'),
    '- name: a short description that includes the pack size, for example "Tuna chunks in water 185g"',
    '- brand',
    '- unitSize: the net size of one unit, as a number',
    '- unit: "g", "ml" or "pcs"',
    '- bestBefore: the best-before, use-by or expiry date as YYYY-MM-DD',
    '- barcode: the digits printed under the barcode',
    '- notes: one short line about anything unclear, for example which fields were unreadable or that energy was converted from kJ',
    kinds ? '- type: for an item that is not food, the kind of item: exactly one of the ids listed for its area, or null if none fits. ' + kinds : '',
    'For food also give:',
    '- category: exactly one of ' + (categories || []).join(' | '),
    '- kcalPer100: energy in kcal per 100 g or 100 ml as printed (if only kJ is printed, convert with kcal = kJ / 4.184)',
    '- proteinPer100: protein in g per 100 g or 100 ml',
    '- kcalPerPack and proteinPerPack: only if the label itself prints a figure for the whole pack',
    '- servingSize: the serving size in g or ml as printed, as a number',
    '- servingsPerPack: the number of servings per pack or container as printed',
    '- kcalPerServing and proteinPerServing: energy in kcal and protein in g per serving as printed (convert kJ as above)',
    '- drainedWeight: in g, only if a drained weight is printed',
    '- needsCooking: true if the pack says it must be cooked or needs boiling water, otherwise false',
    'For water also give litresPerUnit. For a power bank or battery give mAh and wattHours as printed. For medicine give unitsPerPack (tablets, capsules or doses in one pack).',
  ].filter(Boolean).join('\n');
}

export function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
}

const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Keeps only well-formed values, so a stray answer can never put nonsense into the form. */
export function normalise(o, categories, types) {
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const kind = ((types || {})[o.area] || []).find(t => same(t.id, o.type) || same(t.label, o.type));
  const unit = ['g', 'ml', 'pcs'].includes(o.unit) ? o.unit : null;
  const date = typeof o.bestBefore === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.bestBefore) ? o.bestBefore : null;
  const pos = v => { const n = num(v); return n !== null && n >= 0 ? n : null; };
  return {
    area: AREA_IDS.includes(o.area) ? o.area : null,
    name: str(o.name), brand: str(o.brand),
    unitSize: pos(o.unitSize), unit,
    bestBefore: date,
    barcode: o.barcode ? String(o.barcode).replace(/\D/g, '') || null : null,
    notes: str(o.notes),
    category: (categories || []).find(c => o.category && same(c, o.category)) || null,
    type: kind ? kind.id : null,
    kcalPer100: pos(o.kcalPer100), proteinPer100: pos(o.proteinPer100),
    kcalPerPack: pos(o.kcalPerPack), proteinPerPack: pos(o.proteinPerPack),
    drainedWeight: pos(o.drainedWeight),
    servingSize: pos(o.servingSize), servingsPerPack: pos(o.servingsPerPack),
    kcalPerServing: pos(o.kcalPerServing), proteinPerServing: pos(o.proteinPerServing),
    needsCooking: typeof o.needsCooking === 'boolean' ? o.needsCooking : null,
    litresPerUnit: pos(o.litresPerUnit), mAh: pos(o.mAh), wattHours: pos(o.wattHours), unitsPerPack: pos(o.unitsPerPack),
  };
}

async function call(apiKey, body) {
  let res;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) });
  } catch (e) {
    throw new ReadError('network', 'Could not reach Anthropic. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.ok) return data || {};
  const msg = data && data.error && typeof data.error.message === 'string' ? data.error.message : '';
  const detail = msg ? ' (' + msg.slice(0, 160) + ')' : '';
  switch (res.status) {
    case 401:
      if (msg.startsWith('CORS requests are not allowed'))
        throw new ReadError('cors', 'Your Anthropic organization does not allow requests from a browser, so this key cannot be used in the app. Use a key from another organization.');
      throw new ReadError('key', 'Anthropic rejected the API key. Check it under More.');
    case 402: throw new ReadError('billing', 'There is a billing problem on your Anthropic account.' + detail);
    case 403: throw new ReadError('permission', 'This API key is not allowed to do that.' + detail);
    case 404: throw new ReadError('model', 'The chosen model is not available to this key. Pick another under More.');
    case 413: throw new ReadError('size', 'The photos are too large to send. Use fewer photos.');
    case 429: throw new ReadError('limit', 'A rate or spend limit was reached. Try again later.' + detail);
    case 400: throw new ReadError('request', 'Anthropic could not accept the request.' + detail);
    default: throw new ReadError('busy', 'Anthropic\'s service is busy or had an error. Try again in a minute.');
  }
}

/**
 * Sends up to three photos and returns the fields that could be read.
 * area: the area the person already chose, or null to let Claude suggest one.
 */
export async function readLabel({ apiKey, model, blobs, area, categories, types }) {
  const content = [];
  for (const b of blobs.slice(0, 3)) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(b) } });
  }
  content.push({ type: 'text', text: buildPrompt(area, categories, types) });   // images first, then the question
  const data = await call(apiKey, { model, max_tokens: 4096, messages: [{ role: 'user', content }] });
  const text = (Array.isArray(data.content) ? data.content : []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  const json = extractJson(text);
  if (!json || typeof json !== 'object') {
    throw new ReadError('parse', data.stop_reason === 'max_tokens'
      ? 'The answer was cut short. Try again with fewer photos.'
      : 'The photos could not be read. Try a sharper, closer photo, or type the details in.');
  }
  return normalise(json, categories, types);
}

/** Asks a text-only question and returns the JSON object in the answer. Sends no photos. */
export async function askJson({ apiKey, model, system, prompt }) {
  const data = await call(apiKey, { model, max_tokens: 4096, system, messages: [{ role: 'user', content: prompt }] });
  const text = (Array.isArray(data.content) ? data.content : []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  const json = extractJson(text);
  if (!json || typeof json !== 'object') throw new ReadError('parse', data.stop_reason === 'max_tokens' ? 'The answer was cut short. Try again.' : 'The answer could not be read. Try again.');
  return json;
}

/** Makes the smallest possible request to confirm that the key and model work. */
export async function testKey(apiKey, model) {
  await call(apiKey, { model, max_tokens: 64, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] });
  return true;
}
