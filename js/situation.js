// The situation questionnaire: what a survival consultant would ask about the household, its places and its means.
// Answers are picked from buttons. Nothing asks for an address. An option's third entry is what that answer flags.

const DK = ['dk', 'Not sure'];
export const KINDS = [['home', 'Home'], ['bag', 'Grab bag'], ['vehicle', 'Vehicle'], ['safehouse', 'Second place or safehouse'], ['storage', 'Storage'], ['other', 'Other']];

export const SECTIONS = [
  { id: 'people', title: 'Your people', intro: 'Who you are planning for, beyond the head count.', qs: [
    { id: 'children', q: 'Any children in the household?', opts: [['none', 'No'], ['baby', 'Baby or toddler', 'A baby or toddler needs its own supplies: formula or food, nappies, medicine.'], ['child', 'Child'], ['teen', 'Teenager']], multi: true },
    { id: 'mobility', q: 'Can everyone walk a few kilometres carrying a bag?', opts: [['yes', 'Yes'], ['slow', 'With difficulty', 'Someone would struggle on foot, so leaving by car and leaving early matter more.'], ['no', 'Someone cannot', 'Someone cannot leave on foot. Plan around staying put or leaving early by vehicle.']] },
    { id: 'dependence', q: 'Does anyone depend on daily medication or powered equipment?', opts: [['no', 'No'], ['meds', 'Daily medication', 'Someone depends on daily medication. Log it under Medical with the doses a day so the scenarios count it.'], ['power', 'Powered equipment', 'Someone depends on powered equipment. Backup power for it comes before everything else.']], multi: true },
    { id: 'firstaid', q: 'Has anyone had first-aid training?', opts: [['recent', 'Yes, recently'], ['old', 'Yes, long ago'], ['no', 'No', 'Nobody has first-aid training. A basic course is the cheapest preparation there is.']] },
    { id: 'drivers', q: 'How many of you can drive?', opts: [['all', 'All adults'], ['one', 'One', 'Only one of you drives. If that person is hurt or away, the car is not an option.'], ['none', 'None']] },
    { id: 'swim', q: 'Can everyone swim?', opts: [['yes', 'Yes'], ['some', 'Some'], ['no', 'No']] },
  ] },
  { id: 'home', title: 'Your home', intro: 'What the building gives you, and what it takes away, when services stop.', qs: [
    { id: 'homeType', q: 'What kind of home?', opts: [['highrise', 'Condo or flat'], ['landed', 'Landed house'], ['other', 'Other']] },
    { id: 'floor', q: 'Which floor?', opts: [['ground', 'Ground'], ['low', '1 to 5'], ['mid', '6 to 15'], ['high', '16 or above', 'On a high floor, a power cut means stairs for every trip and for carrying water.']] },
    { id: 'tapInCut', q: 'In a power cut, does water still come out of the taps?', opts: [['yes', 'Yes'], ['while', 'For a while, then stops'], ['no', 'No', 'No tap water in a power cut, so every power cut is also a water cut for you.'], [DK[0], DK[1], 'Find out from building management whether taps run in a power cut, and for how long.']] },
    { id: 'cooking', q: 'How do you normally cook?', opts: [['mains', 'Piped gas'], ['cylinder', 'Gas cylinder'], ['electric', 'Electric or induction'], ['portable', 'Portable stove only']], multi: true },
    { id: 'backup', q: 'What backup power do you have?', opts: [['none', 'None', 'No backup power at all. A power bank per phone is the first step.'], ['banks', 'Power banks'], ['station', 'Power station'], ['generator', 'Generator'], ['solar', 'Solar panel']], multi: true },
    { id: 'heat', q: 'Without power, can the home stay bearable?', opts: [['yes', 'Yes, windows and airflow'], ['hot', 'It gets very hot', 'The home gets very hot without power. Battery fans and extra drinking water belong on the list.'], [DK[0], DK[1]]] },
    { id: 'flood', q: 'Does your street or car park flood?', opts: [['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often', 'Flooding is common where you live. Decide in advance where the car goes when heavy rain is forecast.'], [DK[0], DK[1]]] },
    { id: 'access', q: 'Does getting in or out depend on power?', opts: [['no', 'No'], ['lifts', 'Lifts only'], ['doors', 'Access cards or electric gates', 'Doors or gates need power. Find out how they open in a power cut.'], [DK[0], DK[1]]], multi: true },
    { id: 'space', q: 'How much room is there to store supplies?', opts: [['little', 'Very little'], ['some', 'Some'], ['plenty', 'Plenty']] },
  ] },
  { id: 'water', title: 'Water', intro: 'Where water comes from when the tap does not.', qs: [
    { id: 'warning', q: 'Do you get warning before a water cut?', opts: [['usually', 'Usually'], ['sometimes', 'Sometimes'], ['never', 'Never']] },
    { id: 'containers', q: 'Empty containers you could fill, in total?', opts: [['none', 'None', 'No containers to fill. They are cheap, and filling them when a cut is announced is the best single step.'], ['small', 'Under 20 L'], ['medium', '20 to 60 L'], ['large', 'Over 60 L']] },
    { id: 'tub', q: 'A bathtub or large tank you could fill?', opts: [['yes', 'Yes'], ['no', 'No']] },
    { id: 'treat', q: 'How could you make water safe to drink?', opts: [['boil', 'Boil it'], ['filter', 'A filter'], ['tablets', 'Tablets or drops'], ['none', 'No way yet', 'No way to treat water. Stored bottles are then your only drinking water.']], multi: true },
    { id: 'source', q: 'Any water nearby if the taps stay off?', opts: [['pool', 'A pool'], ['river', 'River or lake'], ['rain', 'Rain I could collect'], ['none', 'Nothing', 'No other water source nearby, so long cuts depend entirely on what you store.'], [DK[0], DK[1]]], multi: true },
  ] },
  { id: 'toilet', title: 'Toilet and hygiene', intro: 'Flushing needs far more water than drinking.', qs: [
    { id: 'toiletPlan', q: 'With no tap water, what is the toilet plan?', opts: [['flush', 'Flush with a bucket'], ['bags', 'Lined bucket and bags'], ['none', 'No plan yet', 'No toilet plan for a water cut. Strong bags and a bucket solve it for very little.']] },
    { id: 'waste', q: 'If rubbish is not collected, where does it go?', opts: [['room', 'A place away from living space'], ['none', 'Nowhere yet']] },
  ] },
  { id: 'comms', title: 'Power, news and contact', intro: 'How you find out what is happening and reach each other.', qs: [
    { id: 'radio', q: 'A radio that works without mains?', opts: [['yes', 'Yes'], ['car', 'Only the car radio'], ['no', 'No', 'No battery or wind-up radio. When phones and internet are down it is the only news.']] },
    { id: 'twoWay', q: 'Any two-way radios?', opts: [['none', 'None'], ['walkie', 'Walkie-talkies'], ['mesh', 'Mesh radios']], multi: true },
    { id: 'offlineMaps', q: 'Offline maps saved on your phones?', opts: [['yes', 'Yes'], ['no', 'No', 'No offline maps. Download your city and routes while you have a connection.']] },
    { id: 'paperContacts', q: 'Key phone numbers written on paper?', opts: [['yes', 'Yes'], ['no', 'No', 'Key numbers exist only in your phones. Write them down.']] },
    { id: 'charging', q: 'How could you charge phones in a long cut?', opts: [['banks', 'Power banks'], ['car', 'The car'], ['solar', 'Solar'], ['none', 'No way', 'No way to charge a phone in a long power cut.']], multi: true },
  ] },
  { id: 'vehicle', title: 'Your vehicle', intro: 'A car is shelter, transport, power and storage, if it is ready.', qs: [
    { id: 'hasCar', q: 'Do you have a vehicle?', opts: [['yes', 'Yes'], ['two', 'More than one'], ['no', 'No']] },
    { id: 'fuelType', q: 'What does it run on?', opts: [['petrol', 'Petrol'], ['diesel', 'Diesel'], ['hybrid', 'Hybrid'], ['ev', 'Electric', 'An electric vehicle cannot be refuelled in a long power cut. Keep it charged.']] },
    { id: 'tank', q: 'How full is it usually?', opts: [['half', 'Always above half'], ['varies', 'It varies'], ['low', 'Often low', 'The tank is often low. Refilling at half costs nothing and is the main vehicle preparation.']] },
    { id: 'terrain', q: 'Can it handle flooded or rough roads?', opts: [['yes', 'Yes, high and four-wheel drive'], ['some', 'Somewhat'], ['no', 'No']] },
    { id: 'parked', q: 'Where is it parked?', opts: [['basement', 'Basement'], ['covered', 'Covered, above ground'], ['open', 'Open air']] },
    { id: 'carKit', q: 'What does it carry?', opts: [['tools', 'Tools'], ['jump', 'Jump starter'], ['tyre', 'Tyre kit or spare'], ['water', 'Water'], ['none', 'Nothing', 'The car carries no kit. A tyre kit, jump starter and water come first.']], multi: true },
    { id: 'spareFuel', q: 'Any spare fuel stored safely?', opts: [['yes', 'Yes'], ['no', 'No']] },
  ] },
  { id: 'bags', title: 'Your grab bags', intro: 'A bag only counts if you can pick it up and go.', qs: [
    { id: 'bagEach', q: 'A bag for each adult?', opts: [['yes', 'Yes'], ['one', 'One shared'], ['no', 'None yet', 'No grab bags yet.']] },
    { id: 'bagWhere', q: 'Where are they kept?', opts: [['door', 'By the door'], ['closet', 'Put away at home'], ['car', 'In the car']], multi: true },
    { id: 'bagCarried', q: 'Has each person carried theirs for an hour?', opts: [['yes', 'Yes'], ['no', 'No', 'The bags have not been carried for an hour. Most first bags turn out too heavy.']] },
    { id: 'bagChecked', q: 'When were the contents last checked?', opts: [['recent', 'Within 6 months'], ['old', 'Longer ago', 'The bags have not been checked in over six months.'], ['never', 'Never', 'The bags have never been checked.']] },
    { id: 'bagClothes', q: 'Clothes, sturdy shoes and rain cover in them?', opts: [['yes', 'Yes'], ['part', 'Partly'], ['no', 'No']] },
  ] },
  { id: 'places', title: 'Somewhere else to go', intro: 'Leaving is only a plan if there is a destination.', qs: [
    { id: 'elsewhere', q: 'Is there another place you could go?', opts: [['family', 'Family or friends'], ['second', 'A second home'], ['land', 'Land'], ['none', 'Nowhere yet', 'No destination if you had to leave. Agree one with family or friends.']], multi: true },
    { id: 'distance', q: 'How far is the nearest of those?', opts: [['near', 'Under 10 km'], ['mid', '10 to 50 km'], ['far', '50 to 200 km'], ['vfar', 'Over 200 km']] },
    { id: 'reach', q: 'How would you get there?', opts: [['car', 'Car'], ['foot', 'On foot'], ['public', 'Public transport']], multi: true },
    { id: 'stocked', q: 'Is anything stored there?', opts: [['yes', 'Yes'], ['little', 'A little'], ['no', 'No']] },
    { id: 'landWater', q: 'If it is land: is there water and shelter?', opts: [['both', 'Both'], ['water', 'Water only'], ['shelter', 'Shelter only'], ['neither', 'Neither'], ['na', 'Not land']] },
  ] },
  { id: 'area', title: 'Your area', intro: 'What is around you, and what you think is most likely.', qs: [
    { id: 'worries', q: 'Which events concern you most?', opts: [['flood', 'Flood'], ['power', 'Long power cut'], ['water', 'Long water cut'], ['haze', 'Haze'], ['unrest', 'Unrest'], ['lockdown', 'Lockdown or outbreak'], ['quake', 'Earthquake'], ['fire', 'Fire'], ['supply', 'Shops empty'], ['war', 'War']], multi: true },
    { id: 'hospital', q: 'How far is the nearest hospital?', opts: [['near', 'Under 5 km'], ['mid', '5 to 20 km'], ['far', 'Over 20 km'], [DK[0], DK[1]]] },
    { id: 'neighbours', q: 'Neighbours you could rely on?', opts: [['several', 'Several'], ['few', 'One or two'], ['none', 'None', 'No neighbours you could rely on. Knowing one or two is worth more than most gear.']] },
    { id: 'mgmt', q: 'Do you have building or area management contacts?', opts: [['yes', 'Yes'], ['no', 'No']] },
  ] },
  { id: 'money', title: 'Money and documents', intro: 'Cards and phones stop working before cash does.', qs: [
    { id: 'cash', q: 'Cash at home would cover how long?', opts: [['none', 'None', 'No cash at home. Card machines and cash machines stop in a power cut.'], ['days', 'A few days'], ['weeks', 'Two weeks'], ['month', 'A month or more']] },
    { id: 'smallNotes', q: 'Is some of it in small notes?', opts: [['yes', 'Yes'], ['no', 'No']] },
    { id: 'docs', q: 'Copies of key documents?', opts: [['paper', 'Paper copies'], ['digital', 'Digital copies'], ['none', 'None', 'No copies of key documents. Photograph them and keep a paper set in a bag.']], multi: true },
    { id: 'passports', q: 'Passports valid for at least six months?', opts: [['yes', 'Yes'], ['no', 'No'], [DK[0], DK[1]]] },
    { id: 'insurance', q: 'Do you know what your insurance covers?', opts: [['yes', 'Yes'], ['no', 'No']] },
  ] },
  { id: 'pets', title: 'Your pets', intro: 'Skip this if you have none.', qs: [
    { id: 'carriers', q: 'A carrier or lead for each pet?', opts: [['yes', 'Yes'], ['some', 'For some'], ['no', 'No', 'Not every pet has a carrier or lead, so leaving with them would be hard.']] },
    { id: 'petCar', q: 'Do they travel calmly by car?', opts: [['yes', 'Yes'], ['some', 'Some do'], ['no', 'No']] },
    { id: 'petRecords', q: 'Vaccination records to hand?', opts: [['yes', 'Yes'], ['no', 'No']] },
    { id: 'petMeds', q: 'Any pet on regular medication?', opts: [['no', 'No'], ['yes', 'Yes']] },
  ] },
  { id: 'plan', title: 'Your plan', intro: 'What you have already agreed between you.', qs: [
    { id: 'rally', q: 'An agreed place to meet if you are apart?', opts: [['yes', 'Yes'], ['no', 'No', 'No agreed meeting place. Pick one near home and one further away.']] },
    { id: 'outContact', q: 'Someone outside the area you would both call?', opts: [['yes', 'Yes'], ['no', 'No']] },
    { id: 'trigger', q: 'Have you decided what would make you leave?', opts: [['yes', 'Yes'], ['rough', 'Roughly'], ['no', 'No', 'No decided trigger for leaving. People who decide in advance leave earlier.']] },
    { id: 'practised', q: 'Have you ever run through it?', opts: [['yes', 'Yes'], ['part', 'Partly'], ['no', 'No']] },
    { id: 'whoDoes', q: 'Does each of you know your jobs in the first hour?', opts: [['yes', 'Yes'], ['no', 'No']] },
  ] },
];

const ALL = SECTIONS.flatMap(s => s.qs);
const picked = (a, q) => { const v = a ? a[q.id] : undefined; return Array.isArray(v) ? v : v ? [v] : []; };

export function progress(answers, other) {
  const done = ALL.filter(q => picked(answers, q).length || (other && other[q.id])).length;
  return { done, total: ALL.length };
}

/** What the answers flag, most basic needs first (the order of the sections). */
export function flags(answers) {
  const out = [];
  for (const s of SECTIONS) for (const q of s.qs) for (const o of q.opts) if (o[2] && picked(answers, q).includes(o[0])) out.push({ section: s.title, text: o[2] });
  return out;
}

/** Plain text of everything answered, for Ask Claude. */
export function summary(sit, locations) {
  const a = (sit && sit.answers) || {}, notes = (sit && sit.notes) || {}, kinds = (sit && sit.kinds) || {}, other = (sit && sit.other) || {}, lines = [];
  const named = (locations || []).filter(l => kinds[l]).map(l => `${l} is a ${(KINDS.find(k => k[0] === kinds[l]) || ['', kinds[l]])[1].toLowerCase()}`);
  if (named.length) lines.push('Locations: ' + named.join('; ') + '.');
  for (const s of SECTIONS) {
    const parts = s.qs.filter(q => picked(a, q).length || other[q.id]).map(q => `${q.q} ${picked(a, q).map(v => (q.opts.find(o => o[0] === v) || [v, v])[1]).concat(other[q.id] ? ['in their own words: ' + other[q.id]] : []).join(', ')}.`);
    if (notes[s.id]) parts.push('Note: ' + notes[s.id]);
    if (parts.length) lines.push(s.title + ' — ' + parts.join(' '));
  }
  return lines.join('\n');
}
