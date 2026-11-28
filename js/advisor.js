// Builds what is sent to Claude for the two advice features, and checks what comes back.
// Nothing here talks to the network: reader.js does that with the owner's own API key.

import { postureOf, washLitres, POSTURES } from './water.js';

const line = parts => parts.filter(x => x !== null && x !== undefined && x !== '').join(' | ');

/** One text line per item. The number after # is how Claude refers to the item in its answer. */
export function itemLines(items, kindOf) {
  return items.map((it, i) => line([
    '#' + (i + 1), kindOf(it), it.name, 'qty ' + (Number(it.qty) || 0),
    it.unitSize ? `${it.unitSize} ${it.unit || ''}`.trim() + ' each' : '',
    it.area === 'food' && it.kcal !== null && it.kcal !== undefined ? `${it.kcal} kcal${it.protein ? `, ${it.protein} g protein` : ''} a pack` : '',
    it.area === 'food' ? (it.needsCooking ? 'needs cooking' : 'no cooking needed') : '',
    it.area !== 'food' && it.cap !== null && it.cap !== undefined ? `${it.area === 'water' && it.type === 'treatment' ? 'makes safe' : 'gives'} ${it.cap} ${it.capUnit || ''}`.trim() + ' each' : '',
    it.bestBefore ? 'best before ' + it.bestBefore : 'no date',
    'kept at ' + (it.location || 'unknown'),
  ])).join('\n');
}

export function context({ settings, locations, scenarioLines, note, today }) {
  const s = settings;
  return [
    `Today is ${today}.`,
    `Household: ${s.adults} adult(s), ${s.dogs || 0} dog(s), ${s.cats || 0} cat(s).`,
    `Their own planning figures, per adult a day, at the level they have chosen (${POSTURES.find(p => p[0] === postureOf(s))[1]}): ${postureOf(s) === 'bare' ? s.kcalSurvival : s.kcalStandard} kcal, ${s.proteinPerDay} g protein, ` +
      `${s.drinkL ?? 3} L of drinking water (${s.drinkHotL ?? 4} L with the power off or on the move), ${washLitres(s)} L of water for washing and cooking. ` +
      `Washing water can be any clean water. At home, ${s.reserveDays ?? 1} day(s) of sealed drinking water per person is held back and not counted.`,
    `For a carried bag they want single items no heavier than ${s.bagMaxG ?? 500} g and water bottles no larger than ${s.bagMaxL ?? 1.5} L.`,
    'Locations: ' + locations.join(', ') + '.',
    'Scenarios they plan for, with how long the stock they have logged lasts today:',
    scenarioLines,
    note ? 'What the owner says about their locations and situation: ' + note : 'The owner has not described their locations.',
  ].join('\n');
}

const COMMON = [
  'Use only the data in the message. Never invent an item, a quantity, a location or a figure.',
  'Any number you state must come from the data given or be simple arithmetic on it. Do not quote outside statistics or guidelines.',
  'If something cannot be judged from the data, say so plainly rather than guessing.',
  'Write in short, plain sentences. No jargon.',
  'Reply with one JSON object and nothing else.',
].join('\n');

export const PLACE_SYSTEM = [
  'You help a household decide where to keep its emergency supplies across the locations it has listed (for example a home, grab bags, a car).',
  COMMON,
  'Propose moves of items between the listed locations. Each move must make a named scenario last longer, or remove a clear weakness such as all of one need sitting in a single place. Say which in "why".',
  'Go by what the owner says each location is. If they have not said, judge only from which scenario counts that location, and say in the summary that you assumed it.',
  'For a location that is carried: respect the weight and bottle limits, and do not send food that needs cooking unless fuel and a stove are there.',
  'For a location the owner describes as a vehicle or as hot: prefer items that keep well, and add a caution, since you have no temperature data.',
  'Leave an item where it is unless moving it clearly helps. At most 15 moves, most useful first. If nothing should move, return an empty list and say why.',
  'JSON shape: {"summary": "two or three sentences", "moves": [{"item": 12, "qty": 2, "to": "exact location name", "why": "one sentence"}], "cautions": ["..."]}',
  '"item" is the number after # in the list. "qty" is how many units to move and may not exceed what is there.',
].join('\n');

export const REVIEW_SYSTEM = [
  'You review a household\'s emergency stockpile and tell the owner what most deserves attention.',
  COMMON,
  'Look for: needs with nothing logged, the scenario that fails first and why, stock that runs out of date together, too little variety or too much that needs cooking, items with missing details, and anything kept only in one place.',
  'At most 8 findings, most important first. Each needs a concrete next step the owner can take.',
  'Medical needs are personal: point out what is missing from the list, but do not advise on medicines or doses.',
  'JSON shape: {"summary": "two or three sentences", "findings": [{"priority": "high" | "medium" | "low", "title": "a few words", "detail": "one or two sentences with the figures from the data", "action": "one sentence"}]}',
].join('\n');

const text = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

/** Keeps only moves that are possible: a real item, a real and different location, a quantity that exists. */
export function cleanMoves(json, items, locations) {
  const out = [], left = new Map();
  for (const m of Array.isArray(json && json.moves) ? json.moves : []) {
    const it = items[Number(m && m.item) - 1];
    if (!it) continue;
    const to = locations.find(l => l === m.to) || locations.find(l => l.toLowerCase() === String(m.to || '').trim().toLowerCase());
    if (!to || to === it.location) continue;
    const have = left.has(it.id) ? left.get(it.id) : Number(it.qty) || 0;
    const qty = Math.min(have, Math.max(0, Number(m.qty) || 0));
    if (!(qty > 0)) continue;
    left.set(it.id, have - qty);
    out.push({ id: it.id, name: it.name, from: it.location || '', to, qty, why: text(m.why, 300) });
    if (out.length >= 15) break;
  }
  return { summary: text(json && json.summary, 700), moves: out, cautions: (Array.isArray(json && json.cautions) ? json.cautions : []).map(c => text(c, 300)).filter(Boolean).slice(0, 5) };
}

export function cleanReview(json) {
  const findings = (Array.isArray(json && json.findings) ? json.findings : []).map(f => ({
    priority: ['high', 'medium', 'low'].includes(f && f.priority) ? f.priority : 'medium',
    title: text(f && f.title, 80), detail: text(f && f.detail, 500), action: text(f && f.action, 300),
  })).filter(f => f.title || f.detail).slice(0, 8);
  return { summary: text(json && json.summary, 700), findings };
}
