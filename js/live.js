// Live mode: an event that is happening now. One shared record holds what is working, what has been done and when.
// Pure functions, so they can be unit-tested in Node.

import { dayNum } from './calc.js';
import * as W from './water.js';

const num = v => { if (v === null || v === undefined || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const n1 = v => String(Math.round(v * 10) / 10);
const L = v => n1(v) + ' L';

/** A new event. It starts from a scenario's conditions and length when one is given. now is an ISO time, day the local date. */
export function start(scn, id, now, day, by) {
  const state = scn ? { tap: W.tapOf(scn), grid: !!scn.grid, shops: !!scn.shops } : { tap: 'on', grid: true, shops: true };
  return { id, on: true, name: scn ? scn.name : 'Live', startedAt: now, startDay: day, by: by || '', days: scn ? num(scn.days) || 3 : 3, daysAt: now,
    state, since: { tap: now, grid: now, shops: now }, done: {}, used: {} };
}

/** Day 1 is the day it started. */
export const dayNumber = (live, today) => Math.max(1, dayNum(today) - dayNum(live.startDay) + 1);

/** Days still to get through, out of the length expected. Today counts until its water has been logged as used. */
export const daysLeft = (live, today) => (num(live.days) || 0) - (dayNumber(live, today) - 1) - (live.used && live.used[today] ? 1 : 0);

/**
 * The scenario the calculation runs on while live: what the household says is true right now, not what a rule predicts,
 * looking ahead over the days still expected (at least one).
 */
export function scenario(live, today, now) {
  const st = live.state, t0 = Date.parse((live.since && live.since.grid) || live.startedAt);
  // offFor: days the power has been off so far, so that what was in the fridge and freezer stops counting once it has spoiled.
  return { id: 'live', name: live.name, days: Math.max(1, daysLeft(live, today)), place: 'home', tap: st.tap === 'on', tapState: st.tap === 'unsafe' ? 'unsafe' : '',
    grid: !!st.grid, shops: !!st.shops, ration: 'household', real: true, offFor: !st.grid && now && Number.isFinite(t0) ? Math.max(0, (now - t0) / 864e5) : 0 };
}

const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
export const same = (a, b) => canon(a) === canon(b);

/**
 * Two copies of the record become one, so two people can tick and switch things at the same time.
 * A different event: the one started later stands. The same event: each part of the state goes to whoever changed it
 * last, ticks and logged days from both are kept, and ending it on one device ends it everywhere.
 */
export function merge(a, b) {
  if (!a || !a.id) return b || null;
  if (!b || !b.id) return a;
  if (a.id !== b.id) return String(a.startedAt) >= String(b.startedAt) ? a : b;
  const out = { ...a, state: { ...a.state }, since: { ...a.since }, done: { ...a.done }, used: { ...a.used } };
  for (const k of Object.keys(b.state || {})) {
    if (String((b.since || {})[k] || '') > String((a.since || {})[k] || '')) { out.state[k] = b.state[k]; out.since[k] = b.since[k]; }
  }
  for (const [k, v] of Object.entries(b.done || {})) if (!out.done[k] || String(v.at) > String(out.done[k].at)) out.done[k] = v;
  for (const [k, v] of Object.entries(b.used || {})) if (!out.used[k]) out.used[k] = v;
  if (String(b.daysAt || '') > String(a.daysAt || '')) { out.days = b.days; out.daysAt = b.daysAt; }
  const ended = [a.endedAt, b.endedAt].filter(Boolean).sort()[0];
  if (ended) { out.on = false; out.endedAt = ended; }
  return out;
}

/**
 * What to do now, in the order to do it. Keys are stable, so a tick survives the list being worked out again.
 * c: { answers: the questionnaire, water: the water plan for the live scenario, left: days still expected,
 *      heat: what there is to cook on (calc.heatFor), clock?: turns an ISO time into words, for the fridge and freezer deadlines }.
 * A step is { key, text, detail, act? }. act 'fill' means ticking it asks how much was filled.
 */
export function steps(live, c) {
  const st = live.state, a = c.answers || {}, p = c.water || null, out = [];
  const cont = Math.max(0, num(a.containersL) || 0), tub = Math.max(0, num(a.tubL) || 0), heater = Math.max(0, num(a.heaterL) || 0);
  const src = [].concat(a.source || []), pool = src.includes('pool'), river = src.includes('river');
  const tapsMayStop = !st.grid && st.tap !== 'off' && a.tapInCut !== 'yes';

  if (st.tap === 'off' || tapsMayStop) {
    const what = [cont ? `your containers (${L(cont)})` : '', tub ? `the tub (${L(tub)})` : ''].filter(Boolean).join(' and ');
    out.push({ key: 'fill', act: 'fill', text: `Fill ${what || 'every clean container you have'} while water still comes out`,
      detail: (tapsMayStop ? 'Your taps may stop while the power is off. ' : 'If the taps still run, the building is on its tank. ') + 'Fill what you will drink first, then the tub and buckets for washing.' });
  }
  if (st.tap === 'off' && heater > 0) out.push({ key: 'heater', text: `Turn the water heater off. Its ${L(heater)} is drinking water`, detail: 'Let it cool before you drain it.' });
  if (st.tap === 'unsafe') {
    out.push({ key: 'nodrink', text: 'Tell everyone: do not drink from the tap or cook with it', detail: 'It is still fine for washing.' });
    if ((c.heat ? c.heat.kitchen || c.heat.stove : st.grid) && a.boilOk !== 'no') out.push({ key: 'boil', text: 'Boil tap water for drinking: a rolling boil for 1 minute, then let it cool', detail: 'Use bottled water first if you have it. Boiling does not remove fuel or chemicals.' });
  }
  if (!st.grid) {
    // Without power the fridge and freezer are on a clock, and cooking depends on what the household cooks on.
    const full = a.freezerFull === 'full', t0 = Date.parse(live.since && live.since.grid ? live.since.grid : live.startedAt);
    const by = h => (c.clock && Number.isFinite(t0) ? `: until ${c.clock(new Date(t0 + h * 3600e3).toISOString())}` : '');
    out.push({ key: 'fridge', text: 'Keep the fridge and freezer shut', detail: `Fridge food is safe for about 4 hours${by(4)}. A ${full ? 'full freezer holds for about 48 hours' : 'freezer that is half full holds for about 24 hours'}${by(full ? 48 : 24)}.` });
    out.push({ key: 'eatfresh', text: 'Eat from the fridge first, then the freezer as it thaws', detail: 'Once those times have passed, throw out what is left of the food that spoils.' });
    const h = c.heat;
    if (h && !h.kitchen) out.push(h.stove
      ? { key: 'stove', text: 'Cook on the portable stove, on the balcony or beside a wide-open window', detail: 'Never in a closed room, because of carbon monoxide. Boiling drinking water comes before cooking.' }
      : { key: 'nocook', text: 'There is no way to cook: eat food that needs no cooking', detail: h.owns ? 'You have a portable stove but nowhere ventilated to use it.' : 'Your hob does not work without power, and no portable stove is on record.' });
  }
  if (st.tap !== 'on') out.push({ key: 'news', text: 'Find out how long it will last', detail: 'Ask your water company or building management, then set the days on State.' });

  if (c.left !== undefined && c.left <= 0) out.push({ key: 'longer:' + live.days, text: 'This has lasted longer than you expected', detail: 'Set a new number of days on State, so the figures look far enough ahead.' });
  if (p && p.needed) {
    const days = Math.max(1, num(c.left) || 0);
    if (p.drinkDays < days) {
      const short = (days - p.drinkDays) * p.D;
      out.push(st.shops
        ? { key: 'buy', text: `Buy drinking water today: ${L(short)} more covers the ${n1(days)} ${days === 1 ? 'day' : 'days'} still expected`, detail: 'Shops are open now.' }
        : { key: 'stretch', text: `Drinking water is ${L(short)} short of the ${n1(days)} ${days === 1 ? 'day' : 'days'} still expected`, detail: 'Drink what you need. Look for a way to get more, or a place to go that has water.' });
    }
    if (p.washCounted) {
      // Washing water in stock may not cover the days: a pool or river makes fetching it a daily job, otherwise it has to be stretched.
      if (p.stock.wash < p.W * days && (pool || river)) out.push({ key: 'fetch', text: `Fetch washing water from the ${pool ? 'pool' : 'river'}: ${L(p.W)} a day`, detail: pool ? 'Pool water is for washing only.' : 'River water must be boiled or treated before anyone drinks it.' });
      else if (p.washDays < days) out.push({ key: 'washless', text: 'Save washing water for hands and dishes', detail: 'It runs out before the days you expect. Wipes cover the rest, or step your level down on State.' });
    }
  }
  return out;
}

/**
 * Today's water, item by item, in the order to use it: water you filled before sealed bottles, never the reserve.
 * items: water items in reach.  p: the water plan.  tapNow: on | unsafe | off.
 * Returns { lines: [{ id, name, litres, units, use: 'drink' | 'wash' }], drinkShort, washShort } in litres.
 */
export function dayWater(items, p, tapNow) {
  const out = { lines: [], drinkShort: 0, washShort: 0 };
  if (!p || !p.needed || tapNow === 'on') return out;
  const has = it => (num(it.qty) || 0) * (num(it.cap) || 0);
  const take = (list, need, use, hold) => {
    let keep = hold || 0;                                      // litres of this kind that must stay untouched
    const total = list.reduce((x, it) => x + has(it), 0);
    let room = Math.max(0, total - keep);
    for (const it of list) {
      if (need <= 1e-9 || room <= 1e-9) break;
      const litres = Math.min(need, has(it), room);
      if (litres <= 0) continue;
      out.lines.push({ id: it.id, name: it.name, litres, units: litres / num(it.cap), use });
      need -= litres; room -= litres;
    }
    return need;
  };
  const kind = t => items.filter(it => !it.deleted && (it.type || 'drinking') === t && has(it) > 0);
  const oldest = (x, y) => String(x.bestBefore || x.lastChecked || '').localeCompare(String(y.bestBefore || y.lastChecked || '')) || String(x.name).localeCompare(String(y.name));
  let d = p.D;
  d = take(kind('filled').sort(oldest), d, 'drink');
  d = take(kind('drinking').sort(oldest), d, 'drink', p.stock.reserve);
  out.drinkShort = Math.max(0, d);
  if (tapNow === 'off' && p.W > 0) out.washShort = Math.max(0, take(kind('washing').sort(oldest), p.W, 'wash'));
  return out;
}
