// The To do list: what to act on next, drawn from the scenarios' gaps, the dates on items and the questionnaire.
// Pure functions, so they can be unit-tested in Node.

import { num, daysLeft, checkDue } from './calc.js';

// A check (recharge a power bank, test a torch) is flagged this many days before it is due, not months ahead like a best-before date.
export const CHECK_DAYS = 3;

/**
 * The dated entries of everything in stock, sorted into how soon they fall due.
 * Returns { over, checks, d30, first, soon, later, undated } where each list holds { it, d, kind, date, check }.
 */
export function dates(items, s, today) {
  const b = { over: [], checks: [], d30: [], first: [], soon: [], later: [], undated: 0 };
  for (const it of items) {
    if (it.deleted || ((num(it.qty) || 0) <= 0 && it.area !== 'kit')) continue;
    const entries = [];
    if (it.bestBefore) entries.push({ kind: it.area === 'medical' ? 'Expires' : 'Best before', date: it.bestBefore, check: false });
    const cd = checkDue(it);
    if (cd) entries.push({ kind: it.area === 'water' ? 'Refill' : 'Check', date: cd, check: true });
    if (!entries.length && it.area !== 'kit') b.undated++;
    for (const e of entries) {
      const d = daysLeft(e.date, today);
      // A check is a reminder, not a shelf life: it only needs attention in its last few days.
      const k = d < 0 ? 'over' : e.check ? (d <= CHECK_DAYS ? 'checks' : 'later') : d < 30 ? 'd30' : d < s.eatFirstDays ? 'first' : d < s.soonDays ? 'soon' : 'later';
      b[k].push({ it, d, ...e });
    }
  }
  for (const k of ['over', 'checks', 'd30', 'first', 'soon', 'later']) b[k].sort((x, y) => x.d - y.d);
  return b;
}

/** Whether a to-do shows: it has not been hidden, and any day it was put off to has arrived. off is { key: 'hide' | 'YYYY-MM-DD' }. */
export function isOn(off, key, today) {
  const v = off && off[key];
  return !v || (v !== 'hide' && String(v) <= today);
}

/** Drops put-off entries whose day has come, so the saved list does not grow for ever. */
export function tidy(off, today) {
  const out = {};
  for (const [k, v] of Object.entries(off || {})) if (v === 'hide' || String(v) > today) out[k] = v;
  return out;
}

/** The date n days after today, as YYYY-MM-DD. */
export function dayAfter(today, n) {
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
}

/**
 * The next few actions. One from each group in turn, so the list is a mix of something to buy,
 * something to do at home and something to find out, never three trips to the shop.
 */
export function next(groups, n = 3) {
  const out = [], lists = groups.map(g => g.slice());
  while (out.length < n && lists.some(l => l.length)) for (const l of lists) { if (l.length && out.length < n) out.push(l.shift()); }
  return out;
}
