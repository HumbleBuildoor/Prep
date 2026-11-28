// Areas, quick-fill templates, starting settings, preset scenarios and where the default figures come from.
// Nothing personal lives in this file: a household's own data stays in the browser's storage.

export const AREAS = [
  { id: 'water', name: 'Water', short: 'Water', capLabel: 'Litres in one unit', capUnit: 'L',
    types: [{ id: 'drinking', label: 'Sealed drinking water' }, { id: 'filled', label: 'Drinking water you filled' },
      { id: 'washing', label: 'Washing water' }, { id: 'treatment', label: 'Filter, tablets or drops' }] },
  { id: 'food', name: 'Food', short: 'Food', types: null },
  { id: 'fuel', name: 'Cooking fuel', short: 'Fuel', capLabel: 'Burn time of one unit (minutes)', capUnit: 'min',
    types: [{ id: 'butane', label: 'Butane can' }, { id: 'gas', label: 'Gas cylinder' }, { id: 'other', label: 'Other fuel' }] },
  { id: 'power', name: 'Power', short: 'Power', capLabel: 'Watt-hours in one unit', capUnit: 'Wh',
    types: [{ id: 'powerbank', label: 'Power bank' }, { id: 'station', label: 'Power station' }, { id: 'other', label: 'Other' }] },
  { id: 'medical', name: 'Medical', short: 'Medical', capLabel: 'Doses in one pack', capUnit: 'doses',
    types: [{ id: 'daily', label: 'Regular medication' }, { id: 'otc', label: 'Over the counter' }, { id: 'firstaid', label: 'First aid' }, { id: 'other', label: 'Other' }] },
  { id: 'hygiene', name: 'Hygiene', short: 'Hygiene', capLabel: 'One unit lasts one person (days)', capUnit: 'person-days',
    types: [{ id: 'toiletpaper', label: 'Toilet paper' }, { id: 'soap', label: 'Soap' }, { id: 'wipes', label: 'Wipes' },
      { id: 'sanitary', label: 'Sanitary products' }, { id: 'binbags', label: 'Bin bags' }, { id: 'bleach', label: 'Bleach or disinfectant' }, { id: 'other', label: 'Other' }] },
  { id: 'pets', name: 'Pets', short: 'Pets', capLabel: 'One pack feeds one pet (days)', capUnit: 'pet-days',
    types: [{ id: 'dogfood', label: 'Dog food' }, { id: 'catfood', label: 'Cat food' }, { id: 'litter', label: 'Litter' }, { id: 'other', label: 'Other' }] },
  { id: 'kit', name: 'Kit and documents', short: 'Kit',
    types: [{ id: 'light', label: 'Light' }, { id: 'radio', label: 'Radio' }, { id: 'stove', label: 'Stove' }, { id: 'tools', label: 'Tools' },
      { id: 'documents', label: 'Documents' }, { id: 'cash', label: 'Cash' }, { id: 'other', label: 'Other' }] },
];

// The areas the app works with today. Cooking fuel is kept as its own kind of item but shown inside Power.
export const ACTIVE = ['water', 'food', 'fuel', 'power', 'pets'];
export const UI_AREAS = [{ id: 'water', name: 'Water', short: 'Water' }, { id: 'food', name: 'Food', short: 'Food' }, { id: 'power', name: 'Power and fuel', short: 'Power' }, { id: 'pets', name: 'Pets', short: 'Pets' }];
export const uiArea = id => (id === 'fuel' ? 'power' : id);

export const areaOf = id => AREAS.find(a => a.id === id) || AREAS[1];

export function typeLabel(area, type) {
  const a = areaOf(area);
  const t = (a.types || []).find(x => x.id === type);
  return t ? t.label : (type || 'Other');
}

// One tap fills in the fields of a common item. Every value stays editable.
export const TEMPLATES = {
  water: [
    { label: '500 ml bottle', set: { name: 'Water bottle 500 ml', type: 'drinking', unitSize: 500, unit: 'ml', cap: 0.5 } },
    { label: '1.5 L bottle', set: { name: 'Water bottle 1.5 L', type: 'drinking', unitSize: 1500, unit: 'ml', cap: 1.5 } },
    { label: '5 L', set: { name: 'Water 5 L', type: 'drinking', unitSize: 5000, unit: 'ml', cap: 5 } },
    { label: '10 L', set: { name: 'Water 10 L', type: 'drinking', unitSize: 10000, unit: 'ml', cap: 10 } },
    { label: 'Filled container', set: { name: 'Filled water container', type: 'filled', checkEveryMonths: 6, basis: 'Water you fill yourself is replaced every 6 months, so a reminder is set.' } },
    { label: 'Bucket for washing', set: { name: 'Bucket of washing water', type: 'washing' } },
  ],
  fuel: [
    { label: 'Butane can 250 g', set: { name: 'Butane can 250 g', type: 'butane', unitSize: 250, unit: 'g', cap: 70 } },
  ],
  power: [
    { label: 'Power bank 10,000 mAh', set: { name: 'Power bank 10,000 mAh', type: 'powerbank', cap: 31, checkEveryMonths: 3, basis: '10,000 mAh × 3.7 V × 0.85 = 31 Wh (estimate; use the Wh printed on the label if there is one).' } },
    { label: 'Power bank 20,000 mAh', set: { name: 'Power bank 20,000 mAh', type: 'powerbank', cap: 63, checkEveryMonths: 3, basis: '20,000 mAh × 3.7 V × 0.85 = 63 Wh (estimate; use the Wh printed on the label if there is one).' } },
  ],
  hygiene: [
    { label: 'Soap bar 100 g', set: { name: 'Soap bar 100 g', type: 'soap', unitSize: 100, unit: 'g', cap: 12, basis: '100 g at 250 g per person per month = 12 person-days.' } },
    { label: 'Toilet roll', set: { name: 'Toilet roll', type: 'toiletpaper' } },
  ],
  kit: [
    { label: 'Torch', set: { name: 'Torch', type: 'light', checkEveryMonths: 6 } },
    { label: 'Radio', set: { name: 'Radio', type: 'radio', checkEveryMonths: 6 } },
    { label: 'Passport', set: { name: 'Passport', type: 'documents' } },
    { label: 'Cash', set: { name: 'Emergency cash', type: 'cash', checkEveryMonths: 12 } },
  ],
};

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (strongest, dearest)' },
];

export const DEFAULT_SETTINGS = {
  adults: 2, dogs: 0, cats: 0,
  rationLevel: 'survival', kcalSurvival: 1600, kcalStandard: 2100, kcalActive: 2700, proteinPerDay: 60, proteinLimits: true,
  // Water, in litres per person a day. Washing follows the posture: bare minimum, basic or comfortable.
  drinkL: 3, drinkHotL: 4, washBareL: 2, washBasicL: 5, washComfortL: 12, reserveDays: 1, waterAlertDays: 2, petWaterEach: 0.3,
  waterPerPerson: 4,          // the single figure used before water was split into drinking and washing; kept for older versions
  flameMinPerDay: 30, boilMinPerL: 4, powerWhPerDay: 50,
  noResupplyDays: 3,           // shops that are open are still not counted on for this many days at the start of an event
  oilCap: 0.1, oilCategory: 'Oil & Fat', sweetCap: 0, sweetCategory: 'Honey & Sweeteners',
  eatFirstDays: 90, soonDays: 180, bagMaxG: 500, bagMaxL: 1.5, bagMinKcal100: 300, areas: ACTIVE.slice(), countExpired: true,
  locations: ['Home', 'Bag 1', 'Bag 2', 'Car'],
  foodCategories: ['Rice & Grains', 'Noodles & Porridge', 'Protein (canned)', 'Soups', 'Vegetables', 'Fruit & Snacks',
    'Crackers & Biscuits', 'Honey & Sweeteners', 'Beverages', 'Oil & Fat', 'Seasoning'],
  hygieneEssentials: ['toiletpaper', 'soap'],
  apiModel: 'claude-sonnet-5-5',
};

// tap, grid and shops say what still works. tapState: 'unsafe' marks a tap that runs but must not be drunk untreated.
// "household" ration follows the posture switch on Ready.
export const DEFAULT_SCENARIOS = [
  { id: 'water-cut', name: 'Water cut at home', days: 7, place: 'home', tap: false, grid: true, shops: true, ration: 'household' },
  { id: 'power-cut', name: 'Power cut at home', days: 3, place: 'home', tap: true, grid: false, shops: true, ration: 'household' },
  { id: 'flood', name: 'Flood, stuck at home', days: 5, place: 'home', tap: false, grid: false, shops: false, ration: 'household' },
  { id: 'bags', name: 'Leave with the bags', days: 3, place: 'away', tap: false, grid: false, shops: false, ration: 'active', locations: ['Bag 1', 'Bag 2'], petsAlong: true },
  { id: 'shops-closed', name: 'Shops closed', days: 30, place: 'home', tap: true, grid: true, shops: false, ration: 'household' },
  { id: 'all-off', name: 'Everything off', days: 14, place: 'home', tap: false, grid: false, shops: false, ration: 'household' },
];

export const SOURCES = [
  { what: 'Drinking water, 3 litres per person a day, 4 in heat or on the move',
    why: 'Sphere gives 2.5 to 3 L a day for drinking and food as a survival need, more in a hot climate. A WHO technical note gives 3 to 4 L. The app uses 4 L when the power is off or you are on the move.',
    url: 'https://sphereprototype.conted.ox.ac.uk/standards/watersupply/accessAndWaterQuantity.html', from: 'Sphere standards' },
  { what: 'Washing and cooking water: 2, 5 or 12 litres per person a day',
    why: 'Sphere gives 2 to 6 L for basic hygiene and 3 to 6 L for basic cooking. Bare minimum is the low end of hygiene alone, Basic the low ends of both, Comfortable the high ends of both. With drinking that makes 5, 8 and 15 L. Sphere’s minimum total is 7.5 L, so Bare minimum is for a few days only.',
    url: 'https://sphereprototype.conted.ox.ac.uk/standards/watersupply/accessAndWaterQuantity.html', from: 'Sphere standards' },
  { what: 'Water you fill yourself, replaced every 6 months',
    why: 'Public-health advice for tap water stored in clean food-grade containers. Sealed bottles keep to their printed date. Bottled water is used before treated water.',
    url: 'https://www.cdc.gov/healthywater/emergency/creating-storing-emergency-water-supply.html', from: 'CDC' },
  { what: 'One sealed day of drinking water held back',
    why: 'A working rule, not a published figure: at home the plan never uses the last sealed day per person, so there is water to leave with. Set it to 0 to count everything.',
    url: '', from: 'Working rule. Change it under Rations and rules.' },
  { what: 'Pool water is for washing only',
    why: 'Health departments list swimming pools among water not to drink. Some guidance allows it after treatment; the app takes the cautious line. Flood water is never used, because sewage and chemicals cannot be boiled out.',
    url: 'https://doh.wa.gov/sites/default/files/legacy/Documents/Pubs/331-115-PrinterFriendly.pdf', from: 'Washington State Department of Health' },
  { what: 'Standard ration, 2,100 kcal per adult',
    why: 'The planning figure relief agencies use for emergency rations. Survival (1,600) is a deliberate short-term deficit ration.',
    url: 'https://www.unhcr.org/uk/sites/uk/files/legacy-pdf/3b9cbef7a.pdf', from: 'UNHCR food and nutrition guidelines' },
  { what: 'On the move, 2,700 kcal per adult',
    why: 'Midpoint of the "active" estimates for a man (3,000) and a woman (2,400) aged 26 to 30. Carrying a pack on foot can need more.',
    url: 'https://www.fda.gov/media/112972/download', from: 'Dietary Guidelines for Americans' },
  { what: 'Soap, 250 g per person per month',
    why: 'Minimum bathing soap in humanitarian hygiene standards. It sets how long a bar lasts.',
    url: 'https://sswm.info/humanitarian-crises/prolonged-encampments/hygiene-promotion-community-mobilisation/important/selecting-and-distributing-hygiene-items', from: 'Sphere standards' },
  { what: 'Pet water, 0.3 litres per small pet a day',
    why: 'The veterinary maintenance formula (30 × body weight in kg + 70 ml a day) gives about 0.2 L for a 4 to 5 kg animal. 0.3 L adds a margin. Raise it for larger pets.',
    url: 'https://www.merckvetmanual.com/emergency-medicine-and-critical-care/fluid-therapy/maintenance-fluid-plan-in-animals', from: 'Merck Veterinary Manual' },
  { what: 'Butane can, 70 minutes',
    why: 'Makers of common 10,000 BTU cassette stoves quote about 65 to 75 minutes per 250 g can at full flame. A low flame lasts longer. Check your stove.',
    url: 'https://www.mtckitchen.com/iwatani-portable-butane-stove-cassette-feu-ecopremium-epr-a', from: 'Iwatani EPR-A specification (retailer listing)' },
  { what: 'Boiling makes water safe: a rolling boil for 1 minute',
    why: 'It kills bacteria, viruses and parasites. It does not remove fuel or chemicals, so flood water is never used.',
    url: 'https://cdc.gov/water-emergency/about', from: 'CDC' },
  { what: 'Boiling a litre of water, about 4 minutes of flame',
    why: 'Arithmetic, not a measurement. Heating a litre from about 28°C to the boil takes roughly 300 kJ; butane holds about 46 MJ a kilogram, and a pot on a small stove captures perhaps 40 to 50% of it. That is 13 to 16 g of gas a litre, about 4 minutes at 70 minutes a can. Time a litre on your own stove and change it.',
    url: '', from: 'Estimate. Change it under Rations and rules.' },
  { what: 'A portable stove counts only with somewhere ventilated to use it',
    why: 'US public-health guidance says never to use a portable gas camp stove indoors, because of carbon monoxide. The app takes the cautious line: a balcony, or beside a wide-open window, and never in a closed room.',
    url: 'https://www.cdc.gov/co/faqs.htm', from: 'CDC' },
  { what: 'Fridge 4 hours, freezer 24 to 48 hours without power',
    why: 'With the doors kept shut, a fridge keeps food safe for about 4 hours, a full freezer for about 48 hours and a half-full one for about 24.',
    url: 'https://www.foodsafety.gov/blog/avoid-foodborne-illness-during-temporary-power-outages', from: 'FoodSafety.gov' },
  { what: 'No shopping for the first 3 days of an event',
    why: 'A working rule, not a published figure: open shops are busiest and emptiest at the start, so food, fuel and pet food are counted for those days even when shops are open. Set it to 0 to count on open shops from day one.',
    url: '', from: 'Working rule. Change it under Rations and rules.' },
  { what: 'Power, 50 Wh a day; power bank Wh from mAh',
    why: 'An estimate, not a published standard: two phone charges at roughly 15 to 20 Wh each plus a small light. Power bank energy is mAh × 3.7 V ÷ 1000, times 0.85 for conversion loss.',
    url: '', from: 'Estimate. Change it to match your devices.' },
  { what: 'Scenario lengths',
    why: 'Three days for a grab bag and two weeks at home follow common public-health advice. The other lengths are planning choices. Change them freely.',
    url: 'https://www.cdc.gov/water-emergency/about/how-to-create-and-store-an-emergency-water-supply.html', from: 'CDC' },
];

// The household's relay (a Cloudflare Worker). It only ever receives encrypted data. It can be changed when starting sync.
export const RELAY_URL = 'https://prep-relay.joshuamoh9901xs.workers.dev';
