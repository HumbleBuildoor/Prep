// Water: how long drinking and washing water last in one scenario.
// Pure, like calc.js, so it can be unit-tested in Node.
//
// Kinds of water item (the item's type):
//   drinking   sealed bottles                      drinking
//   filled     clean containers filled from a tap  drinking; replaced every 6 months
//   washing    buckets, a filled bath, unknown     washing only, or drinking once treated
//   treatment  a portable filter, tablets, drops   makes that many litres of washing or source water safe
//
// Order of use.  Drinking: the tap if it is safe, then water you filled (it keeps for months, not years), then sealed
// bottles down to the reserve, then treated water.  Washing: the tap even if unsafe, then washing stock, then a pool
// or river, then drinking water the rest of the scenario does not need.

const num = v => { if (v === null || v === undefined || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

export const POSTURES = [['bare', 'Bare minimum'], ['basic', 'Basic'], ['comfort', 'Comfortable']];

/** The household's posture. Older data only has the food switch (Survival or Standard), which maps onto it. */
export const postureOf = s => (POSTURES.some(p => p[0] === s.posture) ? s.posture : s.rationLevel === 'standard' ? 'basic' : 'bare');

/** on | unsafe | off. Away from home there is no tap. */
export const tapOf = scn => (scn.place === 'away' ? 'off' : scn.tapState === 'unsafe' ? 'unsafe' : scn.tap ? 'on' : 'off');

// How long the taps keep running after the power goes, for a building that only holds a tank's worth. In days.
const RUN_DAYS = { once: 0, hours: 0, day: 1, longer: 2 };
const HORIZON = 3650;

export function washLitres(s, posture) {
  const p = posture || postureOf(s);
  return num(p === 'comfort' ? s.washComfortL : p === 'basic' ? s.washBasicL : s.washBareL) ?? { bare: 2, basic: 5, comfort: 12 }[p];
}

/**
 * scn      the scenario
 * items    water items within reach in this scenario
 * s        settings: adults, drinkL, drinkHotL, wash*L, reserveDays, petWaterEach
 * a        the questionnaire's answers (tapInCut, tapRun, heaterL, source, carryL, floor, homeType, boilOk, containersL, tubL, warning)
 * o        { pets: how many animals drink from this stock, target: days the scenario runs, posture?: override }
 *
 * Returns { needed, D, W, drinkDays, washDays, washCounted, stock, tap, hot, fill, posture }.
 * Days are Infinity when the water comes from something that does not run out.
 */
export function plan(scn, items, s, a, o) {
  a = a || {}; o = o || {};
  const away = scn.place === 'away', people = Math.max(0, num(s.adults) || 0), target = num(o.target) || 0;
  const posture = o.posture || postureOf(s), hot = away || !scn.grid;
  const drink = num(s.drinkL) ?? 3, drinkHot = num(s.drinkHotL) ?? 4;
  const D = people * (hot ? drinkHot : drink) + (num(o.pets) || 0) * (num(s.petWaterEach) || 0);
  const W = away ? 0 : people * washLitres(s, posture);

  // The tap: what the scenario says, then what a power cut does to it in this building.
  const state = tapOf(scn);
  const tap = { state, stopsAfter: null, assumed: false, byPower: false };
  if (!away && !scn.grid && state !== 'off' && a.tapInCut !== 'yes' && !scn.real) {      // scn.real: live, so the tap is as reported
    tap.byPower = true;
    if (a.tapInCut === 'no') tap.stopsAfter = 0;
    else if (a.tapInCut === 'while' && RUN_DAYS[a.tapRun] !== undefined) tap.stopsAfter = RUN_DAYS[a.tapRun];
    else { tap.stopsAfter = 0; tap.assumed = true; }          // not answered or not sure: plan for the worse case
  }
  const tapOn = t => (tap.stopsAfter !== null && t >= tap.stopsAfter ? 'off' : state);
  const steady = t => tap.stopsAfter === null || t >= tap.stopsAfter;

  const sum = type => items.reduce((x, it) => x + ((it.type || 'drinking') === type ? (num(it.qty) || 0) * (num(it.cap) || 0) : 0), 0);
  const stock = { sealed: sum('drinking'), filled: sum('filled'), wash: sum('washing'), treat: sum('treatment'), heater: 0, reserve: 0 };
  // A storage heater holds drinkable water once the tap is off, if the tap was safe until then.
  if (!away && state !== 'unsafe') stock.heater = Math.max(0, num(a.heaterL) || 0);
  if (!away) stock.reserve = Math.min(stock.sealed, Math.max(0, num(s.reserveDays) ?? 1) * people * drink);

  const needed = !(state === 'on' && tap.stopsAfter === null);
  const out = { needed, D, W, drinkDays: Infinity, washDays: Infinity, washCounted: false, stock, tap, hot, posture, fill: null };
  if (!needed) return out;

  // Outside sources. A pool washes and nothing else. A river washes, and can be drunk once treated.
  const src = away ? [] : [].concat(a.source || []);
  const pool = src.includes('pool'), river = src.includes('river');
  // With the lifts out on an upper floor, outside water is limited to what can be carried up in a day.
  const upper = a.homeType !== 'landed' && a.floor !== 'ground';
  const carry = !scn.grid && upper ? Math.max(0, num(a.carryL) || 0) : Infinity;
  // Boiling on the normal hob. It needs the kitchen to work, and the household to accept boiled water.
  const boil = !away && !!scn.grid && a.boilOk !== 'no';

  let sealed = stock.sealed - stock.reserve, filled = stock.filled + stock.heater, wash = stock.wash, treat = stock.treat;
  let dDays = D > 0 ? null : Infinity, wDays = W > 0 ? null : Infinity;
  for (let t = 0; t < HORIZON && (dDays === null || wDays === null); t++) {
    const now = tapOn(t);
    let carryLeft = carry;
    if (dDays === null) {
      let need = now === 'on' ? 0 : D, finite = false;
      if (need > 0) {
        const a1 = Math.min(need, filled); filled -= a1; need -= a1;
        const a2 = Math.min(need, sealed); sealed -= a2; need -= a2;
        if (a1 + a2 > 0) finite = true;
      }
      if (need > 1e-9) {                                        // treated water
        const cap = boil ? Infinity : treat;
        let got = 0;
        if (now === 'unsafe') got = Math.min(need, cap);
        else {
          if (river) { got = Math.min(need, cap, carryLeft); carryLeft -= got; }
          const fromStock = Math.min(need - got, cap - got, wash);
          if (fromStock > 0) { wash -= fromStock; got += fromStock; finite = true; }
        }
        if (!boil && got > 0) { treat -= got; finite = true; }
        need -= got;
      }
      if (need > 1e-9) dDays = t + (D - need) / D;
      else if (!finite && steady(t)) dDays = Infinity;
    }
    if (wDays === null) {
      let need = now === 'off' ? W : 0, finite = false;
      if (need > 0) {
        const b1 = Math.min(need, wash); wash -= b1; need -= b1;
        if (b1 > 0) finite = true;
        if (need > 1e-9 && (pool || river)) { const b2 = Math.min(need, carryLeft); carryLeft -= b2; need -= b2; }
        if (need > 1e-9) {                                      // drinking water the rest of the scenario does not need
          const keep = D * Math.max(0, target - (t + 1));
          let spare = Math.max(0, sealed + filled - keep);
          const b3 = Math.min(need, spare, filled); filled -= b3; need -= b3; spare -= b3;
          const b4 = Math.min(need, spare, sealed); sealed -= b4; need -= b4;
          if (b3 + b4 > 0) finite = true;
        }
      }
      if (need > 1e-9) wDays = t + (W - need) / W;
      else if (!finite && steady(t) && (carry === Infinity || dDays !== null)) wDays = Infinity;
    }
  }
  out.drinkDays = dDays === null ? HORIZON : dDays;
  out.washDays = wDays === null ? HORIZON : wDays;
  out.washCounted = W > 0 && !(state === 'unsafe' && tap.stopsAfter === null);

  // The first move: fill what can be filled before the taps stop. Not counted above, because it may not be possible.
  const cont = Math.max(0, num(a.containersL) || 0), tub = Math.max(0, num(a.tubL) || 0);
  if (!away && state !== 'unsafe' && cont + tub > 0) {
    // Whether there is time to fill: 'running' while the taps still run, 'warning' when cuts are announced, 'maybe' when unknown.
    const way = tap.byPower ? (tap.assumed ? 'maybe' : a.tapInCut === 'no' || a.tapRun === 'once' ? 'no' : 'running')
      : a.warning === 'never' ? 'no' : a.warning === 'usually' ? 'warning' : 'maybe';
    out.fill = { drink: cont, wash: tub, way, drinkDays: D > 0 ? cont / D : 0, washDays: W > 0 ? tub / W : 0 };
  }
  return out;
}
