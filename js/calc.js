// Pure calculations: dates, status, and the scenario readiness engine.
// No DOM and no storage in here, so this file can be unit-tested in Node.

export const DAY = 864e5;

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const pad = n => String(n).padStart(2, '0');

/** Today's calendar date on this device, as YYYY-MM-DD. */
export function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function dayNum(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

/** Whole days from today to a date. Negative when the date has passed. Null when there is no date. */
export function daysLeft(date, today) {
  return date ? dayNum(date) - dayNum(today) : null;
}

export function addMonths(date, months) {
  const [y, m, d] = String(date).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + Math.round(months), 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return first.getUTCFullYear() + '-' + pad(first.getUTCMonth() + 1) + '-' + pad(Math.min(d, last));
}

/** expired | eatfirst | soon | ok | nodate, from the best-before or expiry date. */
export function expiryStatus(item, s, today) {
  const d = daysLeft(item.bestBefore, today);
  if (d === null) return 'nodate';
  if (d < 0) return 'expired';
  if (d < s.eatFirstDays) return 'eatfirst';
  if (d < s.soonDays) return 'soon';
  return 'ok';
}

/** Date the next check or recharge is due, or '' when the item has no check interval. */
export function checkDue(item) {
  const every = num(item.checkEveryMonths);
  if (!every) return '';
  const base = item.lastChecked || String(item.createdAt || '').slice(0, 10);
  return base ? addMonths(base, every) : '';
}

/** The earlier of the expiry date and the next check. */
export function nextDue(item) {
  const a = item.bestBefore || '', b = checkDue(item);
  if (a && b) return a <= b ? { date: a, kind: 'expiry' } : { date: b, kind: 'check' };
  if (a) return { date: a, kind: 'expiry' };
  if (b) return { date: b, kind: 'check' };
  return { date: '', kind: '' };
}

/** Details an item still needs before it can count toward a scenario. */
export function missing(item) {
  const m = [];
  if (!item.name) m.push('name');
  const cap = num(item.cap);
  switch (item.area) {
    case 'food':
      if (num(item.kcal) === null) m.push('kcal');
      else if (!item.source) m.push('nutrition source');
      break;
    case 'water': if (cap === null) m.push('litres'); break;
    case 'fuel': if (cap === null) m.push('burn time'); break;
    case 'power': if (cap === null) m.push('watt-hours'); break;
    case 'hygiene': if ((item.type === 'toiletpaper' || item.type === 'soap') && cap === null) m.push('how long it lasts'); break;
    case 'pets': if ((item.type === 'dogfood' || item.type === 'catfood') && cap === null) m.push('how long it lasts'); break;
    case 'medical': if (num(item.perDay) && cap === null) m.push('doses'); break;
  }
  return m;
}

/**
 * Caps how much of the total some groups may supply (oil, sweeteners).
 * groups: [{have, cap}] where cap is a share of the final total (0.1 = 10%). A cap of 0 means no cap.
 * With one capped group this equals: used = min(have, base * cap / (1 - cap)).
 */
export function applyCaps(base, groups) {
  // Start by assuming every capped group is limited by its cap, then release the ones that are not.
  const bound = groups.map(g => g.cap > 0 && g.cap < 1);
  let total = 0;
  for (let round = 0; round <= groups.length; round++) {
    let free = base, share = 0;
    groups.forEach((g, i) => { if (bound[i]) share += g.cap; else free += g.have; });
    total = share < 1 ? free / (1 - share) : Infinity;
    let changed = false;
    groups.forEach((g, i) => { if (bound[i] && g.cap * total >= g.have) { bound[i] = false; changed = true; } });
    if (!changed) break;
  }
  const used = groups.map((g, i) => (bound[i] ? g.cap * total : g.have));
  return { total, used };
}

export function kcalFor(scn, s) {
  if (scn.ration === 'active') return num(s.kcalActive) || 0;
  return (s.rationLevel === 'standard' ? num(s.kcalStandard) : num(s.kcalSurvival)) || 0;
}

function usable(item, scn, s, today) {
  if (item.deleted) return false;
  if (!((num(item.qty) || 0) > 0)) return false;
  if (Array.isArray(scn.locations) && scn.locations.length && !scn.locations.includes(item.location)) return false;
  const d = daysLeft(item.bestBefore, today);
  if (d !== null && d < 0) {
    if (item.area === 'medical') return false;       // medicine past its expiry never counts
    if (!s.countExpired) return false;
  }
  return true;
}

const stock = arr => arr.reduce((a, it) => a + (num(it.qty) || 0) * (num(it.cap) || 0), 0);

function line(key, label, have, unit, perDay, extra) {
  return Object.assign({ key, label, have, unit, perDay, days: perDay > 0 ? have / perDay : Infinity }, extra || {});
}

function need(id, name, lines, target, extra) {
  // Lines marked essential:false are shown for information but never limit the need.
  let limit = null;
  for (const l of lines) if (l.essential !== false && (!limit || l.days < limit.days)) limit = l;
  return Object.assign({ id, name, lines, days: limit ? limit.days : Infinity, limit, target }, extra || {});
}

/**
 * Works out how many days one scenario is covered for, need by need.
 * scn: { days, place:'home'|'away', tap, grid, shops, ration:'household'|'active', locations?, petsAlong? }
 * labelOf(area, type) is optional and only used for display names of hygiene types.
 */
export function evaluate(scn, items, s, today, labelOf) {
  const adults = Math.max(0, num(s.adults) || 0);
  const dogs = Math.max(0, num(s.dogs) || 0), cats = Math.max(0, num(s.cats) || 0), pets = dogs + cats;
  const away = scn.place === 'away';
  const target = num(scn.days) || 0;
  const inScope = items.filter(it => usable(it, scn, s, today));
  const by = area => inScope.filter(it => it.area === area);
  const needFood = !scn.shops || away;
  const kitchen = !!scn.grid && !away;                 // the normal kitchen works
  const petsIn = pets > 0 && (!away || scn.petsAlong !== false);
  const needs = [];

  const fuel = by('fuel');
  const fuelHave = stock(fuel);
  const flame = num(s.flameMinPerDay) || 0;
  const fuelDays = flame > 0 ? fuelHave / flame : Infinity;

  if (!scn.tap || away) {
    const perDay = adults * (num(s.waterPerPerson) || 0) + (petsIn ? pets * (num(s.petWaterEach) || 0) : 0);
    const w = by('water');
    needs.push(need('water', 'Water', [line('water', 'Drinking water', stock(w), 'L', perDay)], target, { logged: w.length > 0 }));
  }

  if (needFood) {
    const D = adults * kcalFor(scn, s);
    const f = by('food');
    const sweetCap = num(s.sweetCap) || 0;
    let oil = 0, sweet = 0, cook = 0, rest = 0, protein = 0, noKcal = 0;
    for (const it of f) {
      const q = num(it.qty) || 0, k = num(it.kcal);
      if (k === null) noKcal++;
      const kc = q * (k || 0);
      protein += q * (num(it.protein) || 0);
      if (it.category && it.category === s.oilCategory) oil += kc;
      else if (sweetCap > 0 && it.category && it.category === s.sweetCategory) sweet += kc;
      else if (it.needsCooking) cook += kc;
      else rest += kc;
    }
    // Food that must be cooked only counts for as long as there is a way to cook it.
    const cookUsable = (kitchen || !Number.isFinite(fuelDays)) ? cook : Math.min(cook, fuelDays * D);
    const capped = applyCaps(rest + cookUsable, [{ have: oil, cap: num(s.oilCap) || 0 }, { have: sweet, cap: sweetCap }]);
    needs.push(need('food', 'Food', [
      line('kcal', 'Calories', capped.total, 'kcal', D),
      line('protein', 'Protein', protein, 'g', adults * (num(s.proteinPerDay) || 0), { essential: s.proteinLimits !== false }),
    ], target, { logged: f.length > 0, info: { cook, cookUsable, oil, oilUsed: capped.used[0], sweet, sweetUsed: capped.used[1], noKcal, kitchen } }));
  }

  if (needFood && !kitchen && !away) {
    needs.push(need('fuel', 'Cooking fuel', [line('fuel', 'Burn time', fuelHave, 'min', flame)], target, { logged: fuel.length > 0 }));
  }

  if (!scn.grid || away) {
    const p = by('power');
    needs.push(need('power', 'Power', [line('power', 'Stored power', stock(p), 'Wh', num(s.powerWhPerDay) || 0)], target, { logged: p.length > 0 }));
  }

  if (!scn.shops || away) {
    // Every regular medicine the household has logged must be within reach in this scenario.
    const daily = items.filter(it => !it.deleted && it.area === 'medical' && (num(it.perDay) || 0) > 0);
    if (daily.length) {
      const groups = new Map();
      const keyOf = it => String(it.name || '').trim().toLowerCase();
      for (const it of daily) {
        const k = keyOf(it);
        if (!groups.has(k)) groups.set(k, { key: 'med:' + k, label: it.name, have: 0, perDay: 0 });
        const g = groups.get(k);
        g.perDay = Math.max(g.perDay, num(it.perDay));
      }
      const reach = by('medical').filter(it => (num(it.perDay) || 0) > 0);
      for (const it of reach) groups.get(keyOf(it)).have += (num(it.qty) || 0) * (num(it.cap) || 0);
      needs.push(need('medical', 'Medical', [...groups.values()].map(g => line(g.key, g.label, g.have, 'doses', g.perDay)), target, { logged: reach.length > 0 }));
    }

    const h = by('hygiene');
    const ess = Array.isArray(s.hygieneEssentials) ? s.hygieneEssentials : [];
    const types = new Map(ess.map(t => [t, 0]));
    for (const it of h) {
      const t = it.type || 'other';
      types.set(t, (types.get(t) || 0) + (num(it.qty) || 0) * (num(it.cap) || 0));
    }
    const lines = [...types.entries()].map(([t, have]) =>
      line(t, labelOf ? labelOf('hygiene', t) : t, have, 'person-days', adults, { essential: ess.includes(t) }));
    if (lines.length) needs.push(need('hygiene', 'Hygiene', lines, target, { logged: h.length > 0 }));
  }

  if (petsIn && (!scn.shops || away)) {
    const p = by('pets');
    const have = t => stock(p.filter(it => it.type === t));
    const lines = [];
    if (dogs > 0) lines.push(line('dogfood', 'Dog food', have('dogfood'), 'pet-days', dogs));
    if (cats > 0) lines.push(line('catfood', 'Cat food', have('catfood'), 'pet-days', cats));
    needs.push(need('pets', 'Pets', lines, target, { logged: p.length > 0 }));
  }

  let limiting = null;
  for (const n of needs) if (!limiting || n.days < limiting.days) limiting = n;
  const minDays = limiting ? limiting.days : Infinity;
  const ratio = target > 0 ? minDays / target : Infinity;
  const status = !needs.length || ratio >= 1 ? 'ok' : ratio >= 0.5 ? 'short' : 'bad';
  return { needs, limiting, minDays, target, ratio, status };
}

/** What to add so that every scenario is covered: the largest shortfall of each line across scenarios. */
export function gaps(scenarios, items, s, today, labelOf) {
  const out = new Map();
  for (const scn of scenarios) {
    const r = evaluate(scn, items, s, today, labelOf);
    for (const n of r.needs) {
      for (const l of n.lines) {
        if (l.essential === false || !(l.days < r.target)) continue;
        const short = r.target * l.perDay - l.have;
        const key = n.id + ':' + l.key;
        const g = out.get(key) || { key, need: n.id, needName: n.name, label: l.label, unit: l.unit, short: 0, worst: '', scenarios: [] };
        g.scenarios.push(scn.name);
        if (short > g.short) { g.short = short; g.worst = scn.name; }
        out.set(key, g);
      }
    }
  }
  // Most scenarios first; ties go in order of urgency: water, then food, fuel, power, medical, hygiene, pets.
  const rank = id => { const i = ['water', 'food', 'fuel', 'power', 'medical', 'hygiene', 'pets'].indexOf(id); return i < 0 ? 99 : i; };
  return [...out.values()].sort((a, b) => b.scenarios.length - a.scenarios.length || rank(a.need) - rank(b.need) || a.label.localeCompare(b.label));
}

/** Plain totals of what is in stock, ignoring scenarios. */
export function totals(items) {
  const t = { water: 0, kcal: 0, protein: 0, fuel: 0, power: 0, rows: 0, drafts: 0, estimates: 0, uncounted: 0, byArea: {} };
  for (const it of items) {
    if (it.deleted) continue;
    const q = num(it.qty) || 0, cap = num(it.cap) || 0;
    t.rows++;
    t.byArea[it.area] = (t.byArea[it.area] || 0) + 1;
    if (missing(it).length) t.drafts++;
    if (!it.confirmed) t.uncounted++;
    if (it.area === 'food') {
      t.kcal += q * (num(it.kcal) || 0);
      t.protein += q * (num(it.protein) || 0);
      if (num(it.kcal) !== null && !['LABEL', 'ONLINE', 'GENERIC'].includes(it.source)) t.estimates++;
    } else if (it.area === 'water') t.water += q * cap;
    else if (it.area === 'fuel') t.fuel += q * cap;
    else if (it.area === 'power') t.power += q * cap;
  }
  return t;
}

export const CSV_HEAD = ['Item', 'Brand', 'Category', 'Unit size', 'Unit', 'Qty', 'Qty confirmed', 'kcal/unit', 'Total kcal',
  'Protein/unit', 'Total protein', 'Best before', 'Days left', 'Status', 'Location', 'Notes'];

const STATUS_WORD = (st, s) => ({
  expired: 'EXPIRED', eatfirst: 'EAT FIRST <' + s.eatFirstDays + 'd', soon: 'SOON <' + s.soonDays + 'd', ok: 'OK', nodate: 'Check date',
}[st]);

/** Food rows in the same 16 columns as the Inventory sheet of the Excel workbook. */
export function foodCSV(items, s, today) {
  const q = v => {
    v = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const rows = [CSV_HEAD.join(',')];
  const food = items.filter(it => !it.deleted && it.area === 'food')
    .sort((a, b) => (a.bestBefore || '9999').localeCompare(b.bestBefore || '9999') || String(a.name).localeCompare(String(b.name)));
  for (const it of food) {
    const qty = num(it.qty) || 0, k = num(it.kcal), p = num(it.protein), d = daysLeft(it.bestBefore, today);
    rows.push([it.name, it.brand, it.category, it.unitSize, it.unit, qty, it.confirmed ? 'Y' : 'N', k, k === null ? '' : qty * k,
      p, p === null ? '' : Math.round(qty * p * 100) / 100, it.bestBefore || '', d === null ? '' : d,
      STATUS_WORD(expiryStatus(it, s, today), s), it.location, it.notes].map(q).join(','));
  }
  return rows.join('\n');
}

// ---------- meal planner ----------
// Builds meals from what is in stock, day by day, until it runs out. Rule-based, so it works offline
// and always gives the same answer for the same stock.

const ROLE_BY_CATEGORY = {
  'rice & grains': 'staple', 'noodles & porridge': 'staple', 'crackers & biscuits': 'staple',
  'protein (canned)': 'protein', 'soups': 'protein', 'vegetables': 'veg', 'fruit & snacks': 'snack',
  'honey & sweeteners': 'sweet', 'beverages': 'drink',
};

export function mealRole(item, s) {
  const cat = String(item.category || '');
  if (cat && cat === s.oilCategory) return 'oil';
  const known = ROLE_BY_CATEGORY[cat.toLowerCase()];
  if (known) return known;
  const k = num(item.kcal) || 0, p = num(item.protein) || 0;
  if (k > 0 && p * 4 / k >= 0.25) return 'protein';     // a category the app does not know: judge by what is in it
  return item.needsCooking ? 'staple' : 'snack';
}

const SLOTS = [
  { name: 'Breakfast', share: 0.25, roles: [['staple', 0.5], ['drink', 0.3], ['sweet', 0.2]] },
  { name: 'Lunch', share: 0.30, roles: [['protein', 0.35], ['staple', 0.5], ['veg', 0.15]] },
  { name: 'Dinner', share: 0.30, roles: [['protein', 0.35], ['staple', 0.5], ['veg', 0.15]] },
  { name: 'Snack', share: 0.15, roles: [['snack', 0.7], ['drink', 0.3]] },
];
const FALLBACK = ['staple', 'snack', 'drink', 'veg', 'sweet', 'protein'];   // protein is scarce, so it is the last resort for filling up

/**
 * opts: { kcalPerAdult, canCook = true, maxDays = 60, locations? }
 * Returns { days: [{ day, meals: [{ name, lines: [{ id, name, packs, kcal, protein }] }], kcal, protein, full, proteinMet }],
 *           target, proteinTarget, fullDays, proteinDays, leftoverKcal }
 */
export function planMeals(items, s, today, opts) {
  const o = Object.assign({ canCook: true, maxDays: 60 }, opts || {});
  const adults = Math.max(0, num(s.adults) || 0);
  const D = adults * (num(o.kcalPerAdult) || 0), P = adults * (num(s.proteinPerDay) || 0);
  const cap = Math.min(0.9, Math.max(0, num(s.oilCap) || 0));
  const pool = [];
  for (const it of items) {
    if (it.deleted || it.area !== 'food') continue;
    const q = num(it.qty) || 0, k = num(it.kcal) || 0;
    if (q <= 0 || k <= 0) continue;
    if (Array.isArray(o.locations) && o.locations.length && !o.locations.includes(it.location)) continue;
    const d = daysLeft(it.bestBefore, today);
    if (d !== null && d < 0 && !s.countExpired) continue;
    if (it.needsCooking && !o.canCook) continue;
    const n = k <= 700 ? 1 : Math.ceil(k / 450);          // big packs are eaten in portions of about 450 kcal
    pool.push({ it, role: mealRole(it, s), left: q, step: 1 / n, kcal: k, protein: num(it.protein) || 0,
      order: it.bestBefore || '0000-00-00' });              // undated stock is treated as the oldest
  }
  pool.sort((a, b) => a.order.localeCompare(b.order) || String(a.it.name).localeCompare(String(b.it.name)));
  const roleOf = new Map(pool.map(p => [p.it.id, p.role]));
  const startKcal = pool.reduce((a, p) => a + p.left * p.kcal, 0);
  const hasOil = pool.some(p => p.role === 'oil');
  const foodTarget = hasOil ? D * (1 - cap) : D;
  const days = [];
  if (D <= 0) return { days, target: D, proteinTarget: P, fullDays: 0, proteinDays: 0, leftoverKcal: 0 };

  const take = (meal, entry) => {
    const packs = Math.min(entry.step, entry.left);
    entry.left = Math.round((entry.left - packs) * 1e6) / 1e6;
    let line = meal.lines.find(l => l.id === entry.it.id);
    if (!line) { line = { id: entry.it.id, name: entry.it.name, unitSize: num(entry.it.unitSize), unit: entry.it.unit, packs: 0, kcal: 0, protein: 0 }; meal.lines.push(line); }
    line.packs = Math.round((line.packs + packs) * 1e6) / 1e6;
    line.kcal += packs * entry.kcal; line.protein += packs * entry.protein;
    meal.kcal += packs * entry.kcal; meal.protein += packs * entry.protein;
    return packs * entry.kcal;
  };
  const fits = (kcalSoFar, e, limit) => kcalSoFar + Math.min(e.step, e.left) * e.kcal <= limit;
  // The oldest item of a role that still fits under the limit (so one large pack does not block a smaller one).
  const pick = (role, kcalSoFar, limit, prefer) => {
    const ok = p => p.role === role && p.left > 1e-9 && fits(kcalSoFar, p, limit);
    return (prefer && pool.find(p => ok(p) && prefer(p))) || pool.find(ok);
  };
  const next = role => pool.find(p => p.role === role && p.left > 1e-9);

  for (let day = 1; day <= o.maxDays; day++) {
    const meals = SLOTS.map(sl => ({ name: sl.name, lines: [], kcal: 0, protein: 0 }));
    let dayProtein = 0, proteinDue = 0;
    SLOTS.forEach((sl, i) => {
      const meal = meals[i], budget = foodTarget * sl.share;
      const hasProteinRole = sl.roles.some(r => r[0] === 'protein');
      if (hasProteinRole) proteinDue += P / 2;              // lunch and dinner each carry half the day's protein
      for (const [role, share] of sl.roles) {
        let got = 0, e;
        // Breakfast prefers a staple that needs no cooking. Protein is added until the day's protein is on track.
        const prefer = role === 'staple' && sl.name === 'Breakfast' ? p => !p.it.needsCooking : null;
        const want = () => (role === 'protein' && P > 0 ? dayProtein < proteinDue : got < budget * share);
        while (want() && (e = pick(role, meal.kcal, budget * 1.1, prefer))) {
          const before = meal.protein; got += take(meal, e); dayProtein += meal.protein - before;
        }
      }
      for (const role of FALLBACK) {                        // top up when a role has run out
        let e;
        while (meal.kcal < budget * 0.92 && (e = pick(role, meal.kcal, budget * 1.15))) {
          const before = meal.protein; take(meal, e); dayProtein += meal.protein - before;
        }
      }
    });
    let kcal = meals.reduce((a, m) => a + m.kcal, 0);
    for (const role of FALLBACK) {                          // last pass: close the gap left by portion sizes
      let e;
      while (kcal < foodTarget * 0.97 && (e = pick(role, kcal, foodTarget * 1.04))) kcal += take(meals[3], e);
    }
    if (hasOil && kcal > 0) {                                // oil goes over the meals, up to its cap
      const oilMeal = { name: 'Oil over the meals', lines: [], kcal: 0, protein: 0 };
      const allow = Math.min(kcal * cap / (1 - cap), Math.max(0, D - kcal));
      let e;
      while ((e = next('oil')) && oilMeal.kcal < allow) {
        const want = Math.min((allow - oilMeal.kcal) / e.kcal, e.left);
        if (want <= 1e-6) break;
        const saved = e.step; e.step = want; take(oilMeal, e); e.step = saved;
      }
      if (oilMeal.kcal > 0) { meals.push(oilMeal); kcal += oilMeal.kcal; }
    }
    const protein = meals.reduce((a, m) => a + m.protein, 0);
    if (kcal < D * 0.5) break;                               // not enough left to call it a day of food
    const sweetKcal = meals.reduce((a, m) => a + m.lines.reduce((x, l) => x + (roleOf.get(l.id) === 'sweet' ? l.kcal : 0), 0), 0);
    days.push({ day, meals: meals.filter(m => m.lines.length), kcal, protein, full: kcal >= D * 0.95, proteinMet: P <= 0 || protein >= P * 0.95,
      mostlySugar: sweetKcal > kcal * 0.5 });
  }
  let fullDays = 0; while (fullDays < days.length && days[fullDays].full) fullDays++;
  let proteinDays = 0; while (proteinDays < days.length && days[proteinDays].proteinMet) proteinDays++;
  const leftoverKcal = Math.max(0, startKcal - days.reduce((a, d) => a + d.kcal, 0));
  return { days, target: D, proteinTarget: P, fullDays, proteinDays, leftoverKcal };
}
