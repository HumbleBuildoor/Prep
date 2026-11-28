import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';
import { DEFAULT_SETTINGS, DEFAULT_SCENARIOS } from '../js/defaults.js';

const TODAY = '2026-11-27';
const S = { ...DEFAULT_SETTINGS, areas: ['water', 'food', 'fuel', 'power', 'medical', 'hygiene', 'pets'], adults: 2, dogs: 1, cats: 2 };
const scn = id => DEFAULT_SCENARIOS.find(x => x.id === id);
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const food = (o) => ({ area: 'food', qty: 1, location: 'Home', category: 'Rice & Grains', source: 'LABEL', ...o });

test('dates: days left, month arithmetic, status thresholds', () => {
  assert.equal(C.daysLeft('2027-01-01', TODAY), 35);
  assert.equal(C.daysLeft('', TODAY), null);
  assert.equal(C.addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(C.addMonths('2026-01-15', 12), '2027-01-15');
  assert.equal(C.expiryStatus({ bestBefore: '2026-11-26' }, S, TODAY), 'expired');
  assert.equal(C.expiryStatus({ bestBefore: '2027-02-24' }, S, TODAY), 'eatfirst');   // 89 days
  assert.equal(C.expiryStatus({ bestBefore: '2027-02-25' }, S, TODAY), 'soon');       // exactly 90 is no longer "eat first"
  assert.equal(C.expiryStatus({ bestBefore: '2027-05-26' }, S, TODAY), 'ok');         // exactly 180
  assert.equal(C.expiryStatus({}, S, TODAY), 'nodate');
});

test('next due is the earlier of expiry and the next check', () => {
  assert.deepEqual(C.nextDue({ bestBefore: '2027-06-01', checkEveryMonths: 3, lastChecked: '2026-11-01' }), { date: '2027-02-01', kind: 'check' });
  assert.deepEqual(C.nextDue({ bestBefore: '2027-01-01', checkEveryMonths: 3, lastChecked: '2026-11-01' }), { date: '2027-01-01', kind: 'expiry' });
  assert.deepEqual(C.nextDue({}), { date: '', kind: '' });
});

test('oil cap matches the closed form min(oil, food * cap / (1 - cap))', () => {
  const r = C.applyCaps(63149, [{ have: 35360, cap: 0.1 }]);
  near(r.used[0], 63149 * 0.1 / 0.9, 1e-4);
  near(r.total, 63149 / 0.9, 1e-4);
  const small = C.applyCaps(63149, [{ have: 1000, cap: 0.1 }]);
  assert.equal(small.used[0], 1000);
  assert.equal(C.applyCaps(0, [{ have: 5000, cap: 0.1 }]).total, 0);      // oil alone feeds nobody
  assert.equal(C.applyCaps(100, [{ have: 50, cap: 0 }]).total, 150);      // cap 0 means no cap
});

test('water cut: drinking sets the days, washing is counted beside it, one sealed day is held back', () => {
  const items = [{ area: 'water', qty: 10, cap: 1.5, location: 'Home' }];
  const r = C.evaluate(scn('water-cut'), items, S, TODAY);
  assert.deepEqual(r.needs.map(n => n.id), ['water']);
  const [d, w] = r.needs[0].lines;
  near(d.perDay, 2 * 3 + 3 * 0.3); near(w.perDay, 2 * 2);                // 3 L to drink, 2 L to wash at bare minimum, pets on top
  near(r.minDays, (15 - 6) / 6.9);                                        // 6 L, a day for two people, is the reserve
  assert.equal(w.days, 0); assert.equal(w.soft, true); assert.equal(r.needs[0].limit.key, 'water');
  assert.equal(r.status, 'bad');
  near(r.needs[0].info.stock.reserve, 6);
  near(C.evaluate(scn('water-cut'), items, { ...S, reserveDays: 0 }, TODAY).minDays, 15 / 6.9);
});

test('shops closed with power on: kitchen works, so all food counts and fuel is not needed', () => {
  const items = [food({ kcal: 3600, protein: 70, qty: 3, needsCooking: true }), food({ kcal: 800, protein: 40, qty: 4, category: 'Protein (canned)' })];
  const r = C.evaluate(scn('shops-closed'), items, S, TODAY);
  const f = r.needs.find(n => n.id === 'food');
  near(f.lines[0].have, 3 * 3600 + 4 * 800);
  near(f.lines[0].days, 14000 / 3200);
  near(f.lines[1].days, (210 + 160) / 120);
  assert.equal(f.limit.key, 'protein');                                  // protein runs out first here
  const relaxed = C.evaluate(scn('shops-closed'), items, { ...S, proteinLimits: false }, TODAY).needs.find(n => n.id === 'food');
  assert.equal(relaxed.limit.key, 'kcal'); near(relaxed.days, 14000 / 3200);
  assert.ok(!r.needs.some(n => n.id === 'fuel'));
  assert.ok(!r.needs.some(n => n.id === 'water'));
});

test('power off at home: food that needs cooking is limited by fuel', () => {
  const rice = food({ kcal: 3600, qty: 3, needsCooking: true });         // 10,800 kcal
  const tins = food({ kcal: 800, qty: 4, category: 'Protein (canned)' }); //  3,200 kcal
  const none = C.evaluate(scn('all-off'), [rice, tins], S, TODAY).needs.find(n => n.id === 'food');
  near(none.lines[0].have, 3200);                                         // no fuel: rice does not count
  const twoCans = { area: 'fuel', qty: 2, cap: 30, location: 'Home' };    // 60 min = 2 days at 30 min a day
  const r = C.evaluate(scn('all-off'), [rice, tins, twoCans], S, TODAY);
  const f = r.needs.find(n => n.id === 'food');
  near(f.lines[0].have, 3200 + 2 * 3200);                                 // rice counts for the 2 fuel days only
  near(r.needs.find(n => n.id === 'fuel').days, 2);
});

test('leaving with the bags counts only the chosen locations and uses the active ration', () => {
  const items = [food({ kcal: 280, qty: 2, location: 'Bag 1' }), food({ kcal: 280, qty: 2, location: 'Bag 2' }), food({ kcal: 3600, qty: 3, location: 'Home' })];
  const r = C.evaluate(scn('bags'), items, S, TODAY);
  const f = r.needs.find(n => n.id === 'food');
  near(f.lines[0].have, 1120);
  near(f.lines[0].perDay, 2 * 2700);
  assert.ok(r.needs.some(n => n.id === 'water') && r.needs.some(n => n.id === 'power'));
});

test('ration switch changes the household kcal figure', () => {
  const items = [food({ kcal: 3200, qty: 10 })];
  near(C.evaluate(scn('shops-closed'), items, S, TODAY).needs[0].lines[0].days, 10);
  near(C.evaluate(scn('shops-closed'), items, { ...S, rationLevel: 'standard' }, TODAY).needs[0].lines[0].days, 32000 / 4200);
});

test('expired stock: counted by default, never for medicine, and optional for the rest', () => {
  const old = food({ kcal: 1000, qty: 1, bestBefore: '2026-01-01' });
  near(C.evaluate(scn('shops-closed'), [old], S, TODAY).needs[0].lines[0].have, 1000);
  near(C.evaluate(scn('shops-closed'), [old], { ...S, countExpired: false }, TODAY).needs[0].lines[0].have, 0);
  const med = { area: 'medical', name: 'Tablet A', qty: 1, cap: 30, perDay: 1, location: 'Home', bestBefore: '2026-01-01' };
  const r = C.evaluate(scn('shops-closed'), [med], S, TODAY).needs.find(n => n.id === 'medical');
  assert.equal(r.lines[0].have, 0);
});

test('medical: every regular medicine must be within reach; batches of one medicine add up', () => {
  const a1 = { area: 'medical', name: 'Tablet A', qty: 1, cap: 30, perDay: 2, location: 'Home' };
  const a2 = { area: 'medical', name: 'tablet a', qty: 1, cap: 10, perDay: 2, location: 'Bag 1' };
  const b = { area: 'medical', name: 'Tablet B', qty: 1, cap: 60, perDay: 1, location: 'Home' };
  const plaster = { area: 'medical', name: 'Plasters', qty: 1, location: 'Home' };
  const home = C.evaluate(scn('shops-closed'), [a1, a2, b, plaster], S, TODAY).needs.find(n => n.id === 'medical');
  assert.equal(home.lines.length, 2);
  near(home.days, 20);
  const bags = C.evaluate(scn('bags'), [a1, a2, b, plaster], S, TODAY).needs.find(n => n.id === 'medical');
  near(bags.lines.find(l => l.key === 'med:tablet a').days, 5);
  assert.equal(bags.days, 0);                                             // Tablet B is not in a bag
  assert.ok(!C.evaluate(scn('shops-closed'), [plaster], S, TODAY).needs.some(n => n.id === 'medical'));
});

test('hygiene: the essentials set the days; other types are shown but do not limit', () => {
  const soap = { area: 'hygiene', type: 'soap', qty: 2, cap: 12, location: 'Home' };
  const wipes = { area: 'hygiene', type: 'wipes', qty: 1, cap: 2, location: 'Home' };
  const h = C.evaluate(scn('shops-closed'), [soap, wipes], S, TODAY).needs.find(n => n.id === 'hygiene');
  assert.equal(h.days, 0);                                                // no toilet paper logged
  near(h.lines.find(l => l.key === 'soap').days, 12);
  assert.equal(h.lines.find(l => l.key === 'wipes').essential, false);
});

test('pets: dog and cat food are separate lines, divided by the number of each', () => {
  const dog = { area: 'pets', type: 'dogfood', qty: 1, cap: 20, location: 'Home' };
  const cat = { area: 'pets', type: 'catfood', qty: 2, cap: 15, location: 'Home' };
  const p = C.evaluate(scn('shops-closed'), [dog, cat], S, TODAY).needs.find(n => n.id === 'pets');
  near(p.lines[0].days, 20); near(p.lines[1].days, 15); near(p.days, 15);
  assert.ok(!C.evaluate(scn('shops-closed'), [dog], { ...S, dogs: 0, cats: 0 }, TODAY).needs.some(n => n.id === 'pets'));
});

test('gaps: the largest shortfall of each line across all scenarios', () => {
  const items = [{ area: 'water', qty: 10, cap: 1.5, location: 'Home' }];
  const g = C.gaps(DEFAULT_SCENARIOS, items, S, TODAY);
  const w = g.find(x => x.key === 'water:water');
  // A power cut is a water cut too until the household says its taps keep running.
  assert.deepEqual(w.scenarios.sort(), ['Everything off', 'Flood, stuck at home', 'Leave with the bags', 'Power cut at home', 'Water cut at home'].sort());
  near(w.short, 14 * 8.9 - 9);                                            // 15 L less the 6 L reserve
  assert.equal(w.worst, 'Everything off');
  const wash = g.find(x => x.key === 'water:wash');
  near(wash.short, 14 * 4); assert.equal(wash.label, 'Washing water');
});

test('a scenario with nothing to stock is covered', () => {
  const r = C.evaluate({ days: 3, place: 'home', tap: true, grid: true, shops: true }, [], S, TODAY);
  assert.equal(r.needs.length, 0); assert.equal(r.status, 'ok');
});

test('missing details and CSV columns', () => {
  assert.deepEqual(C.missing({ area: 'food', name: 'x' }), ['kcal']);
  assert.deepEqual(C.missing({ area: 'food', name: 'x', kcal: 0 }), ['nutrition source']);
  assert.deepEqual(C.missing({ area: 'food', name: 'Salt', kcal: 0, source: 'LABEL' }), []);
  assert.deepEqual(C.missing({ area: 'kit', name: 'Torch' }), []);
  const csv = C.foodCSV([food({ name: 'Rice, "long" grain', brand: 'B', unitSize: 1000, unit: 'g', qty: 3, kcal: 3600, protein: 70, confirmed: true, bestBefore: '2027-01-01', notes: '' }),
    { area: 'water', name: 'w', qty: 1 }], S, TODAY).split('\n');
  assert.equal(csv[0], 'Item,Brand,Category,Unit size,Unit,Qty,Qty confirmed,kcal/unit,Total kcal,Protein/unit,Total protein,Best before,Days left,Status,Location,Notes');
  assert.equal(csv.length, 2);
  assert.equal(csv[1], '"Rice, ""long"" grain",B,Rice & Grains,1000,g,3,Y,3600,10800,70,210,2027-01-01,35,EAT FIRST <90d,Home,');
});

test('meal planner: fills each day to the target, eats the oldest first, respects cooking and the oil cap', () => {
  const stock = [
    food({ id: 'rice', name: 'Rice 1kg', kcal: 3600, protein: 66, qty: 2, needsCooking: true, bestBefore: '' }),
    food({ id: 'tunaOld', name: 'Tuna', kcal: 150, protein: 21, qty: 6, category: 'Protein (canned)', bestBefore: '2027-01-01' }),
    food({ id: 'tunaNew', name: 'Tuna', kcal: 150, protein: 21, qty: 6, category: 'Protein (canned)', bestBefore: '2028-01-01' }),
    food({ id: 'crackers', name: 'Crackers', kcal: 1800, protein: 28, qty: 2, category: 'Crackers & Biscuits', bestBefore: '2027-06-01' }),
    food({ id: 'nuts', name: 'Nuts', kcal: 1040, protein: 30, qty: 2, category: 'Fruit & Snacks', bestBefore: '2027-06-01' }),
    food({ id: 'oil', name: 'Olive oil', kcal: 4120, protein: 0, qty: 1, category: 'Oil & Fat', bestBefore: '2028-01-01' }),
    food({ id: 'salt', name: 'Salt', kcal: 0, qty: 1, category: 'Seasoning' }),
    { area: 'water', id: 'w', qty: 5, cap: 1.5 },
  ];
  const r = C.planMeals(stock, S, TODAY, { kcalPerAdult: 1600 });
  assert.equal(r.target, 3200);
  assert.ok(r.days.length >= 4, 'plans several days');
  const d1 = r.days[0];
  assert.ok(d1.full && d1.kcal <= 3200 * 1.12, `day 1 is near the target, got ${d1.kcal}`);
  assert.deepEqual(d1.meals.map(m => m.name).slice(0, 4), ['Breakfast', 'Lunch', 'Dinner', 'Snack']);
  const ids = d1.meals.flatMap(m => m.lines.map(l => l.id));
  const packsOf = id => d1.meals.reduce((a, m) => a + m.lines.filter(l => l.id === id).reduce((x, l) => x + l.packs, 0), 0);
  assert.ok(ids.includes('tunaOld') && (!ids.includes('tunaNew') || packsOf('tunaOld') === 6), 'the older batch is used up before the newer one is touched');
  assert.ok(d1.proteinMet, `day 1 meets the protein target, got ${d1.protein}`);
  assert.ok(!ids.includes('salt') && !ids.includes('w'), 'only food with calories is planned');
  const oil = d1.meals.find(m => m.name === 'Oil over the meals');
  assert.ok(oil && oil.kcal <= d1.kcal * 0.1 + 1, 'oil stays within 10% of the day');
  const used = {}; for (const d of r.days) for (const m of d.meals) for (const l of m.lines) used[l.id] = (used[l.id] || 0) + l.packs;
  for (const it of stock) if (used[it.id]) assert.ok(used[it.id] <= it.qty + 1e-6, `${it.id} is not over-used`);
  const total = r.days.reduce((a, d) => a + d.kcal, 0) + r.leftoverKcal;
  near(total, stock.reduce((a, i) => a + (i.area === 'food' ? i.qty * (i.kcal || 0) : 0), 0), 1e-3);   // nothing lost or invented
  const noCook = C.planMeals(stock, S, TODAY, { kcalPerAdult: 1600, canCook: false });
  assert.ok(!noCook.days.some(d => d.meals.some(m => m.lines.some(l => l.id === 'rice'))), 'no rice without a way to cook');
  assert.ok(noCook.days.length < r.days.length);
  assert.equal(C.planMeals([], S, TODAY, { kcalPerAdult: 1600 }).days.length, 0);
});

import { normalise, buildPrompt } from '../js/reader.js';
test('label read: category and type are matched to the lists, never invented', () => {
  const types = { pets: [{ id: 'dogfood', label: 'Dog food' }, { id: 'catfood', label: 'Cat food' }] };
  const cats = ['Rice & Grains', 'Protein (canned)'];
  assert.equal(normalise({ area: 'food', category: 'protein (canned) ' }, cats, types).category, 'Protein (canned)');
  assert.equal(normalise({ area: 'food', category: 'Fish' }, cats, types).category, null);
  assert.equal(normalise({ area: 'pets', type: 'Cat food' }, cats, types).type, 'catfood');
  assert.equal(normalise({ area: 'pets', type: 'toiletpaper' }, cats, types).type, null);
  assert.match(buildPrompt(null, cats, types), /"catfood" \(Cat food\)/);
});

import * as ADV from '../js/advisor.js';
test('advice: impossible moves are dropped and quantities are capped', () => {
  const items = [{ id: 'a', name: 'Tuna', qty: 3, location: 'Home' }, { id: 'b', name: 'Rice', qty: 1, location: 'Home' }];
  const locs = ['Home', 'Bag', 'Car'];
  const r = ADV.cleanMoves({ summary: 'x', moves: [
    { item: 1, qty: 2, to: 'bag', why: 'short' }, { item: 1, qty: 5, to: 'Car' },      // second is capped to the 1 that is left
    { item: 2, qty: 1, to: 'Home' }, { item: 9, qty: 1, to: 'Bag' }, { item: 2, qty: 1, to: 'Shed' }, { item: 2, qty: 0, to: 'Bag' },
  ] }, items, locs);
  assert.deepEqual(r.moves.map(m => [m.id, m.qty, m.to]), [['a', 2, 'Bag'], ['a', 1, 'Car']]);
  assert.equal(ADV.cleanMoves(null, items, locs).moves.length, 0);
  assert.equal(ADV.cleanReview({ findings: [{ priority: 'urgent', title: 'T' }, {}] }).findings[0].priority, 'medium');
  assert.match(ADV.itemLines([{ area: 'food', name: 'Tuna', qty: 2, kcal: 151, protein: 20.7, needsCooking: false, location: 'Home' }], () => 'Food'), /#1 \| Food \| Tuna \| qty 2 \| 151 kcal, 20.7 g protein a pack \| no cooking needed \| no date \| kept at Home/);
});

import * as SY from '../js/sync.js';
test('sync: code round trip, same keys on every device, records only open with the right key and id', async () => {
  const code = SY.makeCode('https://prep-relay.example.workers.dev/');
  const p = SY.parseCode(' ' + code + '\n');
  assert.equal(p.url, 'https://prep-relay.example.workers.dev');
  assert.equal(SY.parseCode(code.slice(0, -1)), null);
  assert.equal(SY.parseCode('PREP1.' + Buffer.from('http://evil.example').toString('base64url') + '.' + code.split('.')[2]), null);
  const a = await SY.deriveKeys(p.secret), b = await SY.deriveKeys(SY.parseCode(code).secret);
  assert.equal(a.hh, b.hh); assert.equal(a.auth, b.auth); assert.match(a.hh, /^[a-f0-9]{32}$/);
  const body = await SY.seal(a.key, 'x1', { t: 'item', v: { name: 'Tuna slices' } });
  assert.ok(!body.includes('Tuna') && !Buffer.from(body, 'base64').toString('latin1').includes('Tuna'));
  assert.deepEqual(await SY.unseal(b.key, 'x1', body), { t: 'item', v: { name: 'Tuna slices' } });
  await assert.rejects(SY.unseal(b.key, 'x2', body));
  const other = await SY.deriveKeys(SY.parseCode(SY.makeCode('https://r.example')).secret);
  await assert.rejects(SY.unseal(other.key, 'x1', body));
});

test('sync merge: both devices using stock both count, later edit wins, tombstones stay deleted', () => {
  const item = { id: 'i1', area: 'food', name: 'Rice', qty: 5, updatedAt: '2026-01-02' };
  const local = { items: [{ ...item, qty: 3 }, { id: 'i2', area: 'food', name: 'Old name', qty: 1, updatedAt: '2026-01-01' }],
    events: [{ id: 'e0', itemId: 'i1', delta: 5 }, { id: 'e1', itemId: 'i1', delta: -2 }, { id: 'f0', itemId: 'i2', delta: 1 }], meta: { settings: { at: '2026-01-05', v: { adults: 2 } } } };
  const m = SY.merge(local, [
    { t: 'event', v: { id: 'e0', itemId: 'i1', delta: 5 } }, { t: 'event', v: { id: 'e2', itemId: 'i1', delta: -1 } },
    { t: 'item', v: { ...item, qty: 4, updatedAt: '2026-01-03' } },
    { t: 'item', v: { id: 'i2', area: 'food', name: 'New name', qty: 0, deleted: true, updatedAt: '2026-01-04' } },
    { t: 'item', v: { id: 'i2', area: 'food', name: 'Stale', qty: 9, updatedAt: '2025-12-01' } },
    { t: 'meta', k: 'settings', at: '2026-01-04', v: { adults: 9 } }, { t: 'meta', k: 'scenarios', at: '2026-01-04', v: [] }, { t: 'junk' }, null,
  ]);
  assert.deepEqual(m.events.map(e => e.id), ['e2']);
  assert.equal(m.items.find(i => i.id === 'i1').qty, 2);            // 5 - 2 - 1
  assert.equal(m.items.find(i => i.id === 'i2').deleted, true);
  assert.deepEqual(Object.keys(m.meta), ['scenarios']);             // the older settings do not replace newer local ones
});

import * as SIT from '../js/situation.js';
test('situation: every question and option id is unique, and flags and summary follow the answers', () => {
  const ids = SIT.SECTIONS.flatMap(s => s.qs.map(q => q.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SIT.SECTIONS) for (const q of s.qs) assert.equal(new Set(q.opts.map(o => o[0])).size, q.opts.length, q.id);
  const answers = { containersL: 0, treat: ['boil', 'filter'], rally: 'no' };
  const followUps = SIT.SECTIONS.flatMap(s => s.qs).filter(q => q.when).length;        // only asked when another answer calls for them
  assert.deepEqual(SIT.progress(answers), { done: 3, total: ids.length - followUps });
  assert.equal(SIT.progress({ tapInCut: 'while' }).total, ids.length - followUps + 1);
  assert.deepEqual(SIT.flags(answers).map(f => f.section), ['Water', 'Your plan']);
  const text = SIT.summary({ answers, notes: { water: 'Pool on level 5' }, kinds: { 'Tank 300': 'vehicle' } }, ['Home', 'Tank 300']);
  assert.match(text, /Locations: Tank 300 is a vehicle\./);
  assert.match(text, /Water — .*How could you make water safe to drink\? Boil it, A filter\. Note: Pool on level 5/);
  assert.equal(SIT.summary({}, []), '');
  assert.equal(SIT.progress({}, { cash: 'Gold and USDT' }).done, 1);
  const own = SIT.summary({ answers: { cash: 'days' }, other: { cash: 'Also some foreign notes', fuelType: 'LPG conversion' } }, []);
  assert.match(own, /A few days, in their own words: Also some foreign notes\./);
  assert.match(own, /What does it run on\? in their own words: LPG conversion\./);
});

test('areas switched off are not judged: by default no medical or hygiene need appears', () => {
  const D = { ...DEFAULT_SETTINGS, adults: 2, dogs: 1, cats: 2 };
  const ids = C.evaluate(scn('all-off'), [{ area: 'medical', name: 'Tablet', qty: 1, cap: 30, perDay: 1, location: 'Home' }], D, TODAY).needs.map(n => n.id);
  assert.deepEqual(ids, ['water', 'food', 'fuel', 'power', 'pets']);
  assert.ok(C.evaluate(scn('all-off'), [], S, TODAY).needs.some(n => n.id === 'hygiene'));
});

import * as TD from '../js/todo.js';
test('gaps: drinking water leads, then whatever runs out soonest', () => {
  // Food lasts longest, power runs out at once, water sits between: water still leads, then power, then food.
  const items = [
    { area: 'water', qty: 10, cap: 1.5, location: 'Home' },
    food({ qty: 10, kcal: 3200, protein: 120, location: 'Home' }),
  ];
  const g = C.gaps(DEFAULT_SCENARIOS, items, S, TODAY);
  assert.equal(g[0].key, 'water:water');
  const rest = g.slice(1).map(x => x.soonest);
  assert.deepEqual(rest, rest.slice().sort((a, b) => a - b));
  // Nothing is in the bags, so that is where water fails soonest.
  assert.equal(g[0].soonest, 0); assert.equal(g[0].soonestIn, 'Leave with the bags'); assert.equal(g[0].soonestTarget, 3);
  const w = C.gaps(DEFAULT_SCENARIOS.filter(x => x.id !== 'bags'), items, S, TODAY)[0];
  near(w.soonest, 9 / 8.9); assert.equal(w.soonestIn, 'Power cut at home'); assert.equal(w.soonestTarget, 3);   // 4 L each with the power off
});

test('to do: dates are bucketed, checks only in their last days, put-off entries come back', () => {
  const it = (o) => Object.assign({ id: 'x' + Math.random(), area: 'food', qty: 1, name: 'n' }, o);
  const d = TD.dates([
    it({ name: 'old', bestBefore: '2026-11-01' }), it({ name: 'month', bestBefore: '2026-12-10' }), it({ name: 'first', bestBefore: '2027-01-15' }),
    it({ name: 'far', bestBefore: '2028-01-01' }), it({ name: 'none' }), it({ name: 'gone', qty: 0, bestBefore: '2026-11-01' }),
    it({ name: 'bank', area: 'power', checkEveryMonths: 3, lastChecked: '2026-08-31' }),      // due 30 Nov: within 3 days
    it({ name: 'bank2', area: 'power', checkEveryMonths: 3, lastChecked: '2026-11-01' }),     // due Feb: later
  ], S, '2026-11-29');
  assert.deepEqual(d.over.map(e => e.it.name), ['old']);
  assert.deepEqual(d.checks.map(e => e.it.name), ['bank']);
  assert.deepEqual(d.d30.map(e => e.it.name), ['month']);
  assert.deepEqual(d.first.map(e => e.it.name), ['first']);
  assert.deepEqual(d.later.map(e => e.it.name).sort(), ['bank2', 'far']);
  assert.equal(d.undated, 1);
  const off = { a: 'hide', b: '2026-12-06', c: '2026-11-29' };
  assert.equal(TD.isOn(off, 'a', '2026-11-29'), false); assert.equal(TD.isOn(off, 'b', '2026-11-29'), false);
  assert.equal(TD.isOn(off, 'b', '2026-12-06'), true); assert.equal(TD.isOn(off, 'zzz', '2026-11-29'), true);
  assert.deepEqual(TD.tidy(off, '2026-11-29'), { a: 'hide', b: '2026-12-06' });
  assert.equal(TD.dayAfter('2026-12-28', 7), '2027-01-04');
  assert.deepEqual(TD.next([['g1', 'g2', 'g3'], ['d1'], [], ['f1']], 3), ['g1', 'd1', 'f1']);
  assert.deepEqual(TD.next([['g1', 'g2', 'g3'], [], []], 3), ['g1', 'g2', 'g3']);
});

test('situation: "not sure" becomes a job, and key questions wait for an answer', () => {
  const f = SIT.findOuts({ tapInCut: 'dk', cooking: ['cylinder'], containersL: 40 }, {});
  assert.deepEqual(f.map(x => x.key), ['find:tapInCut', 'find:treat']);
  assert.ok(f[0].unknown && /building management/.test(f[0].text));
  assert.ok(!f[1].unknown && f[1].text.startsWith('Answer: '));
  assert.equal(f[0].step, 2); assert.equal(f[1].step, 3);
  assert.deepEqual(SIT.findOuts({ tapInCut: 'yes', cooking: ['cylinder'], containersL: 40 }, { treat: 'A still' }), []);
  // a follow-up question is a job only while it applies
  assert.deepEqual(SIT.findOuts({ tapInCut: 'while', tapRun: 'dk', cooking: ['cylinder'], containersL: 0, treat: ['boil'] }, {}).map(x => x.key), ['find:tapRun']);
  assert.deepEqual(SIT.findOuts({ tapInCut: 'yes', tapRun: 'dk', cooking: ['cylinder'], containersL: 0, treat: ['boil'] }, {}), []);
  // "not sure" no longer doubles as a flag
  assert.deepEqual(SIT.flags({ tapInCut: 'dk' }), []);
  assert.equal(SIT.flags({ containersL: 0 })[0].key, 'flag:containersL:0');
  assert.match(SIT.summary({ answers: { containersL: 60 } }, []), /could you fill\? 60 L\./);
});

import * as WT from '../js/water.js';
const WS = { adults: 2, drinkL: 3, drinkHotL: 4, washBareL: 2, washBasicL: 5, washComfortL: 12, reserveDays: 1, petWaterEach: 0.3 };
const wi = (type, qty, cap) => ({ area: 'water', type, qty, cap });
const WCUT = { place: 'home', tap: false, grid: true, shops: true }, PCUT = { place: 'home', tap: true, grid: false, shops: true };
const wplan = (scn, items, a, target, s) => WT.plan(scn, items, s || WS, a || {}, { pets: 3, target: target || 7 });

test('water: posture maps from the old food switch and sets washing litres and the ration', () => {
  assert.equal(WT.postureOf({ rationLevel: 'standard' }), 'basic'); assert.equal(WT.postureOf({ rationLevel: 'survival' }), 'bare');
  assert.equal(WT.postureOf({ rationLevel: 'survival', posture: 'comfort' }), 'comfort');
  assert.equal(WT.washLitres(WS, 'basic'), 5); assert.equal(WT.washLitres({ ...WS, posture: 'comfort' }), 12); assert.equal(WT.washLitres({}), 2);
  assert.equal(C.kcalFor({}, { ...S, posture: 'bare' }), 1600); assert.equal(C.kcalFor({}, { ...S, posture: 'basic' }), 2100); assert.equal(C.kcalFor({}, { ...S, posture: 'comfort' }), 2100);
  assert.equal(WT.tapOf({ tap: true }), 'on'); assert.equal(WT.tapOf({ tap: false, tapState: 'unsafe' }), 'unsafe'); assert.equal(WT.tapOf({ tap: false }), 'off'); assert.equal(WT.tapOf({ tap: true, place: 'away' }), 'off');
});

test('water: washing never spends water that drinking needs before the scenario ends', () => {
  const p = wplan(WCUT, [wi('drinking', 40, 1.5)]);                       // 60 L, 6 L held back, 54 L usable
  near(p.D, 6.9); near(p.W, 4); near(p.stock.reserve, 6);
  near(p.drinkDays, 7);                                                   // 48.3 L drunk over the 7 days
  near(p.washDays, 5.7 / 4);                                              // the 5.7 L left over goes to washing
  const more = wplan(WCUT, [wi('drinking', 40, 1.5), wi('washing', 2, 20)]);
  assert.ok(more.washDays >= 7 && more.drinkDays >= 7);
  const little = wplan(WCUT, [wi('drinking', 2, 1.5)]);                   // 3 L: all of it is the reserve
  near(little.stock.reserve, 3); assert.equal(little.drinkDays, 0);
});

test('water: a power cut is a water cut unless the taps keep running', () => {
  const items = [wi('drinking', 40, 1.5)];
  const unknown = wplan(PCUT, items, {}, 3);
  assert.ok(unknown.needed && unknown.tap.assumed && unknown.tap.byPower); near(unknown.D, 8.9);       // 4 L each with the power off
  assert.equal(wplan(PCUT, items, { tapInCut: 'dk' }, 3).tap.assumed, true);
  assert.equal(wplan(PCUT, items, { tapInCut: 'yes' }, 3).needed, false);
  const no = wplan(PCUT, items, { tapInCut: 'no' }, 3);
  assert.equal(no.tap.stopsAfter, 0); assert.equal(no.tap.assumed, false);
  const day = wplan(PCUT, items, { tapInCut: 'while', tapRun: 'day' }, 3);
  assert.equal(day.tap.stopsAfter, 1); near(day.drinkDays - no.drinkDays, 1);                            // one more day before the stock is touched
  assert.equal(wplan(PCUT, items, { tapInCut: 'while', tapRun: 'dk' }, 3).tap.assumed, true);
  // with mains power on, a working tap needs no stock at all
  assert.equal(wplan({ place: 'home', tap: true, grid: true }, items, {}, 3).needed, false);
});

test('water: an unsafe tap washes; drinking comes from stock, then boiling or treatment', () => {
  const UNSAFE = { place: 'home', tap: false, tapState: 'unsafe', grid: true, shops: true };
  const boil = wplan(UNSAFE, []);
  assert.equal(boil.drinkDays, Infinity); assert.equal(boil.washDays, Infinity); assert.equal(boil.washCounted, false);
  const bottled = wplan(UNSAFE, [wi('drinking', 40, 1.5)], { boilOk: 'no' });
  near(bottled.drinkDays, 54 / 6.9);
  near(wplan(UNSAFE, [wi('drinking', 40, 1.5), wi('treatment', 1, 50)], { boilOk: 'no' }).drinkDays, 104 / 6.9);
  // with the power off there is no hob to boil on, so only stock and treatment count
  const dark = wplan({ ...UNSAFE, grid: false }, [wi('treatment', 2, 10)], { tapInCut: 'yes' });
  near(dark.drinkDays, 20 / 8.9);
});

test('water: washing stock can be treated for drinking, and drinking takes it first', () => {
  const OFF = { place: 'home', tap: false, grid: false, shops: false };
  const p = wplan(OFF, [wi('washing', 5, 20), wi('treatment', 1, 30)], {}, 14);
  near(p.drinkDays, 30 / 8.9); near(p.washDays, 70 / 4);
  assert.equal(wplan(OFF, [wi('washing', 5, 20)], {}, 14).drinkDays, 0);          // untreated washing water is not drunk
});

test('water: a pool washes only, a river can be treated, and stairs cap what is carried', () => {
  const items = [wi('drinking', 40, 1.5)];
  const pool = wplan(WCUT, items, { source: ['pool'] });
  assert.equal(pool.washDays, Infinity); near(pool.drinkDays, 54 / 6.9);          // pool water is never drunk
  const river = wplan(WCUT, items, { source: ['river'] });
  assert.equal(river.drinkDays, Infinity);                                        // boiled on the hob
  near(wplan(WCUT, items, { source: ['river'], boilOk: 'no' }).drinkDays, 54 / 6.9);
  const stairs = wplan(PCUT, items, { tapInCut: 'no', source: ['pool'], floor: 'high' }, 3);
  assert.ok(stairs.washDays < 10);                                                // nothing carried up: washing falls back on spare bottles
  assert.equal(wplan(PCUT, items, { tapInCut: 'no', source: ['pool'], floor: 'high', carryL: 20 }, 3).washDays, Infinity);
  assert.equal(wplan(PCUT, items, { tapInCut: 'no', source: ['pool'], floor: 'ground' }, 3).washDays, Infinity);
});

test('water: away from home there is no reserve and no washing; a heater and the first fill are reported', () => {
  const away = WT.plan({ place: 'away' }, [wi('drinking', 4, 1.5)], WS, {}, { pets: 3, target: 3 });
  near(away.drinkDays, 6 / 8.9); assert.equal(away.stock.reserve, 0); assert.equal(away.W, 0); assert.equal(away.washCounted, false);
  const heater = wplan(WCUT, [], { heaterL: 30 });
  near(heater.drinkDays, 30 / 6.9);
  const fill = wplan(WCUT, [], { containersL: 60, tubL: 150, warning: 'usually' }).fill;
  assert.equal(fill.way, 'warning'); near(fill.drinkDays, 60 / 6.9); near(fill.washDays, 150 / 4);
  assert.equal(wplan(WCUT, [], { containersL: 60, warning: 'never' }).fill.way, 'no');
  assert.equal(wplan(PCUT, [], { containersL: 60, tapInCut: 'while', tapRun: 'hours' }, 3).fill.way, 'running');
  assert.equal(wplan(PCUT, [], { containersL: 60, tapInCut: 'no' }, 3).fill.way, 'no');
  assert.equal(wplan(PCUT, [], { containersL: 60 }, 3).fill.way, 'maybe');
  assert.equal(wplan(WCUT, [], {}).fill, null);
});

test('water in a scenario: the answers reach the calculation, and each level changes the washing figure', () => {
  const items = [{ area: 'water', type: 'drinking', qty: 40, cap: 1.5, location: 'Home' }];
  const withAnswers = a => ({ ...S, situation: { answers: a } });
  assert.ok(C.evaluate(scn('power-cut'), items, S, TODAY).needs.some(n => n.id === 'water'));
  assert.ok(!C.evaluate(scn('power-cut'), items, withAnswers({ tapInCut: 'yes' }), TODAY).needs.some(n => n.id === 'water'));
  const bare = C.evaluate(scn('water-cut'), items, S, TODAY).needs[0], comfort = C.evaluate(scn('water-cut'), items, { ...S, posture: 'comfort' }, TODAY).needs[0];
  near(bare.lines[1].perDay, 4); near(comfort.lines[1].perDay, 24);
  near(bare.days, 7); near(comfort.days, 7);                                      // drinking is the same at every level
  assert.ok(comfort.lines[1].days < bare.lines[1].days);
  const t = C.totals([{ area: 'water', type: 'drinking', qty: 2, cap: 5 }, { area: 'water', type: 'filled', qty: 1, cap: 20 }, { area: 'water', type: 'washing', qty: 3, cap: 10 }, { area: 'water', type: 'treatment', qty: 1, cap: 100 }]);
  assert.equal(t.water, 30); assert.equal(t.wash, 30); assert.equal(t.treat, 100);
  assert.deepEqual(C.missing({ area: 'water', type: 'treatment', name: 'Tablets' }), ['litres it treats']);
});
