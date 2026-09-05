/**
 * Runs the real apps-script/*.gs against a fixture spreadsheet.
 *
 *   node tools/test.js
 *
 * Two halves. The first re-checks the rules that were already true before
 * costing existed — version selection, the double-submit reader, who may call
 * what — because those are what a costing change could break without saying so.
 * The second checks costing itself.
 */
'use strict';
const { load } = require('./gas.js');
const fx = require('./fixture.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const NOW = '2026-09-04T10:00:00+08:00';
let pass = 0, fail = 0;
const results = [];

function ok(name, cond, detail) {
  if (cond) { pass++; results.push(['ok', name, '']); }
  else { fail++; results.push(['FAIL', name, detail === undefined ? '' : String(detail)]); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, 'got ' + g + ', wanted ' + w);
}
function group(t) { results.push(['', '', '']); results.push(['--', t, '']); }

const boot = opt => load(fx.build(opt), { now: NOW });
const { ctx } = boot();
const find = (list, id) => list.find(r => r.id === id);

const lib = ctx.all_();
const byId = id => find(lib.recipes, id);

/* ======================================================== the existing rules */
group('Version selection and the log reader');

eq('library holds every recipe once', lib.count, 12);
eq('counts', lib.counts, { approved: 9, rejected: 1, unreviewed: 2 });
eq('next id follows the highest RCP number', lib.nextId, 'RCP-0385');

eq('a rejected V2.0 leaves V1.0 live and V3.0 becomes the live one',
   byId('RCP-0018').version, 'V3.0');
eq('the rejected version is still counted in the version history',
   byId('RCP-0018').versionCount, 3);
eq('the live version lends its own detail, not the rejected one\'s',
   byId('RCP-0018').price, '13.90');

eq('the same submission written twice reads as one recipe, not two',
   byId('RCP-0153').ing.length, 4);
eq('a pending version does not become the live one',
   byId('RCP-0380').version, 'V1.0');
eq('but the highest version ever used is remembered, so the next mints above it',
   byId('RCP-0380').top, 'V2.0');
eq('an approved version outranks a newer unapproved one',
   byId('RCP-0384').version, 'V3.0');

eq('text in the quantity column is kept rather than dropped',
   byId('RCP-0006').ing.map(i => i.n + '=' + i.q),
   ['Kopi Base=', 'Condensed Milk=', 'Ice=150']);
eq('the Chinese name comes through', byId('RCP-0002').zh, '蜜瓜抹茶气泡水');
eq('a recipe with no status at all reads as unreviewed', byId('RCP-0005').status, 'Unreviewed');

group('The approvals queue');
const q = ctx.queue_(), have = {};
q.forEach(x => { have[x.id + '|' + x.toVersion] = 1; });
const pending = ctx.sheetPending_(have);
eq('exactly the versions still awaiting a decision are offered',
   pending.map(p => p.id + ' ' + p.toVersion).sort(), ['RCP-0153 V2.0', 'RCP-0380 V2.0']);
ok('a version the library has moved past is history, not a decision',
   !pending.some(p => p.id === 'RCP-0384'), 'RCP-0384 V1.0 was offered');
ok('an approved version does not come back',
   !pending.some(p => p.id === 'RCP-0018'), 'RCP-0018 was offered');

group('Who may call what');
const tok = who => { const r = ctx.signIn(who, who + '-pw'); ok('sign in as ' + who, r.ok, r.error); return r.token; };
const T = { manager: tok('manager'), sakura: tok('sakura'), robin: tok('robin') };
const can = (fnName, token) => { try { ctx.api(fnName, null, token); return true; } catch (e) { return false; } };

ok('a wrong password is refused', !ctx.signIn('manager', 'nope').ok);
ok('an unknown name is refused', !ctx.signIn('nobody', 'x').ok);
ok('the approved feed is open to anyone', can('feed', ''));
ok('the full library is not', !can('all', ''));
ok('prices are not', !can('prices', ''));
ok('the dashboard is not', !can('dashboard', ''));
ok('the queue is not', !can('pending', ''));
ok('BI can read the full library', can('all', T.sakura));
ok('BI can read prices', can('prices', T.sakura));
ok('BI can read the queue', can('pending', T.robin));
ok('BI cannot approve', (() => {
  try { ctx.api('approve', { id: 'RCP-0001', version: 'V1.0', decision: 'APPROVED' }, T.sakura); return false; }
  catch (e) { return /only the manager/i.test(e.message); }
})());
{
  /* A token rewritten to claim a role has to fail its own signature. */
  const parts = T.sakura.split('.');
  const body = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  body.role = 'manager';
  const forged = Buffer.from(JSON.stringify(body)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + parts[1];
  ok('a token edited to say manager is refused', !can('all', forged));
}

/* ================================================================= costing  */
group('The arithmetic');

const P = ctx.priceTable_();
eq('cost per unit is pack cost over units per pack',
   P.items['kopi base'].perUnit, 18 / 1000);
eq('an ingredient listed with no numbers has no cost per unit',
   P.items['gula melaka syrup'].perUnit, null);
eq('but its AutoCount code still comes through',
   P.items['gula melaka syrup'].code, 'AC-SYRP-020');
eq('free is not the same as unpriced', P.items['ice'].perUnit, 0);

eq('a fully priced recipe costs what its lines add up to', byId('RCP-0001').cost, 2.35);
eq('and again, with a powder priced per gram', byId('RCP-0002').cost, 1.75);
eq('water and ice cost nothing rather than blocking the total',
   byId('RCP-0002').ing.length, 4);
eq('cost is rounded once, at the end', byId('RCP-0018').cost, 3.29);

group('What blocks a cost');
eq('one unpriced ingredient leaves the whole recipe without a cost',
   byId('RCP-0003').cost, null);
eq('and names it', byId('RCP-0003').unpriced, ['Gula Melaka Syrup']);
eq('a quantity that is not a number blocks it too',
   byId('RCP-0004').cost, null);
eq('and is reported separately, because it is a different fix',
   byId('RCP-0004').unmeasured, ['LIME']);
eq('every offending quantity is named', byId('RCP-0006').unmeasured,
   ['Kopi Base', 'Condensed Milk']);
eq('a recipe with nothing in the way is not marked pending',
   byId('RCP-0001').costPending, false);
eq('a blocked one is', byId('RCP-0003').costPending, true);

group('Gross margin');
eq('margin is what is left of the selling price', byId('RCP-0001').margin, 63.8);
eq('and again', byId('RCP-0002').margin, 86.4);
eq('no cost, no margin', byId('RCP-0003').margin, null);
eq('no selling price, no margin — it is never inferred from cost alone',
   byId('RCP-0005').margin, null);
eq('a costed recipe with no price still shows its cost', byId('RCP-0005').cost, 1.83);

group('A cost that cannot be right');
ok('a drink costing more than it sells for is flagged', !!byId('RCP-0007').costCheck);
eq('and the dearest line is named, because that is the one to look at',
   byId('RCP-0007').costCheck.worst, 'Cheese Foam');
eq('the figure is still shown rather than hidden', byId('RCP-0007').cost, 482.25);
ok('a healthy recipe is not flagged', byId('RCP-0001').costCheck === null);

group('Cost never leaks to the open feed');
const anon = ctx.api('feed', null, '');
const staffFeed = ctx.api('feed', null, T.sakura);
eq('signed out, the feed carries no cost at all',
   anon.recipes.filter(r => 'cost' in r).length, 0);
eq('and says so', anon.costing, false);
eq('signed in, every approved recipe carries one', staffFeed.costing, true);
eq('the two feeds hold the same recipes', anon.count, staffFeed.count);
eq('the feed is the approved recipes and nothing else', anon.count, 9);
ok('a rejected recipe is in neither', !find(staffFeed.recipes, 'RCP-0377'));
eq('a costed recipe in the feed carries its margin',
   find(staffFeed.recipes, 'RCP-0001').margin, 63.8);
eq('and a blocked one carries the reason instead',
   find(staffFeed.recipes, 'RCP-0003').unpriced, ['Gula Melaka Syrup']);

group('The dashboard tile');
const dash = ctx.dashboard_();
eq('costing done and pending add up to the library',
   dash.library.costingDone + dash.library.costingPending, dash.library.total);
eq('costed', dash.library.costingDone, 7);
eq('pending', dash.library.costingPending, 5);
ok('the blockers are listed worst first',
   dash.costingBlockers.every((b, i, a) => i === 0 || a[i - 1].recipes >= b.recipes));
eq('LIME blocks two recipes and says why',
   dash.costingBlockers.find(b => b.name === 'LIME'),
   { name: 'LIME', recipes: 2, reason: 'quantity is not a number' });
eq('an unpriced ingredient says the other why',
   dash.costingBlockers.find(b => b.name === 'Gula Melaka Syrup').reason, 'no price');
eq('every blocker is a real ingredient of a real recipe',
   dash.costingBlockers.reduce((n, b) => n + b.recipes, 0),
   lib.recipes.reduce((n, r) => n + new Set(r.unpriced.concat(r.unmeasured)).size, 0));

group('The approvals card');
const p153 = pending.find(p => p.id === 'RCP-0153');
const p380 = pending.find(p => p.id === 'RCP-0380');
eq('a submission filed on the old connector is now costed from its own rows',
   p380.costPerServing, 2.72);   /* 1.26 espresso + 1.32 coconut + 0.135 syrup */
eq('and is no longer reported as pending when it is not', p380.costingPending, false);
eq('one that genuinely cannot be costed still says so', p153.costingPending, true);
eq('and names what is missing', p153.unpriced, ['Apple Juice', 'Camellia Tea']);
eq('the card costs the version being decided, not the live one',
   p380.ingredients.map(i => i.n + '=' + i.q),
   ['Espresso=30', 'Coconut Milk=150', 'Sugar Syrup=15']);

group('The ingredient list the intake prices from');
const pr = ctx.prices_();
eq('every ingredient in the library appears',
   Object.keys(pr.items).length,
   new Set(lib.recipes.flatMap(r => r.ing.map(i => i.n.trim().toLowerCase()))).size);
ok('one that has never been priced is present as a gap, not absent',
   'apple juice' in pr.items && pr.items['apple juice'].cost === null);
eq('coverage counts what is left to do',
   pr.coverage.used - pr.coverage.priced, pr.coverage.missing);
ok('the basis is stated rather than assumed', /Pack Cost.*Units Per Pack/.test(pr.basis));
eq('the tab it read is named', pr.tab, 'Prices');
/* The intake prices a line client-side from exactly these fields. */
{
  const e = pr.items['kopi base'];
  eq('the intake can still do its own arithmetic from cost and per',
     Math.round(120 / e.per * e.cost * 100) / 100, 2.16);
}

group('Before the Prices tab exists');
const bare = load(fx.build({ withPrices: false }), { now: NOW }).ctx;
const bl = bare.all_();
eq('nothing breaks', bl.count, 12);
eq('every recipe reports no cost', bl.recipes.filter(r => r.cost !== null).length, 0);
eq('and every one is pending', bl.recipes.filter(r => r.costPending).length, 12);
eq('no margin is invented', bl.recipes.filter(r => r.margin !== null).length, 0);
eq('the dashboard says none are costed', bare.dashboard_().library.costingDone, 0);
eq('and the ingredient list is still complete',
   Object.keys(bare.prices_().items).length, Object.keys(pr.items).length);
eq('with the tab reported as absent', bare.prices_().tab, null);
eq('and nothing priced', bare.prices_().coverage.priced, 0);

/* ============================================ filling Prices from AutoCount */
group('Reading the pack size off the item name');
{
  const cat = require('./catalogue.js');
  const bare = () => load(fx.build({ withPrices: false }), {
    now: NOW,
    properties: { GC_SYNC_URL: 'https://sync.test/latest', GC_SYNC_TOKEN: 'read-token' },
    fetch: (url, params) => {
      lastFetch = { url, params };
      return { code: 200, body: cat.build() };
    }
  });
  let lastFetch = null;
  const A = bare();

  eq('kilograms become grams', A.ctx.acPackSize_('COFFEE BEAN 1KG'), { qty: 1000, unit: 'G', text: '1 KG' });
  eq('grams stay grams', A.ctx.acPackSize_('MATCHA POWDER 200G (PREMIUM)'), { qty: 200, unit: 'G', text: '200 G' });
  eq('litres become millilitres', A.ctx.acPackSize_('SOYA MILK 1L'), { qty: 1000, unit: 'ML', text: '1 L' });
  eq('a decimal pack is read whole', A.ctx.acPackSize_('MONIN SYRUP 0.7L'), { qty: 700, unit: 'ML', text: '0.7 L' });
  eq('n x size is multiplied out', A.ctx.acPackSize_('TEA BAG 375G (7.5G*50PCS)'),
     { qty: 375, unit: 'G', text: '375 G' });
  ok('a name with no size says so', A.ctx.acPackSize_('GULA MELAKA SYRUP') === null);
  ok('a code that merely contains letters and digits is not a size',
     A.ctx.acPackSize_('LAVAZZA BLUE ESPRESSO 100%') === null);
  /* Grams to millilitres is a density, and this must never do it. */
  ok('there is no gram-to-millilitre conversion',
     !A.ctx.acSameUnit_('ML', 'G') && !A.ctx.acSameUnit_('G', 'ML'));
  ok('but a recipe in ML accepts a pack read in ML', A.ctx.acSameUnit_('ML', 'ML'));
  ok('and KG on the recipe side counts as grams', A.ctx.acSameUnit_('KG', 'G'));
  ok('an unrecorded recipe unit matches nothing', !A.ctx.acSameUnit_('', 'G'));

  group('Which items may be offered at all');
  const cata = A.ctx.acCatalogue_(...(function () { const c = cat.build(); return [c.items, c.supplierPrices]; })());
  const codes = cata.map(c => c.code);
  ok('an inactive item is never offered', codes.indexOf('C010AN99') < 0);
  ok('an item with no purchase price is never offered', codes.indexOf('S001SG05') < 0);
  ok('an ordinary priced item is', codes.indexOf('C010AN02') >= 0);

  group('Matching, and refusing to match');
  const m = name => A.ctx.acMatch_(name, cata);
  eq('a name only one item can mean matches it',
     m('Gran Espresso Coffee Bean').full.map(x => x.item.code), ['110052']);
  ok('a generic word matches many and therefore none',
     m('Milk').full.length > 1, 'Milk matched ' + m('Milk').full.length);
  ok('Matcha Powder is ambiguous in the real catalogue and must stay so',
     m('Matcha Powder').full.length > 1);
  eq('an ingredient nothing resembles finds nothing at all',
     m('Kopi Base').full.length + m('Kopi Base').near.length, 0);
  ok('one word in common is not a resemblance',
     m('Kopi Base').near.every(c => c.score > 0.5));
  ok('the shortlist prefers an item that can actually be priced',
     m('Matcha Powder').full[0].item.pack !== null);
  ok('two codes for the identical product are shown once',
     A.ctx.acShortlist_(m('Matcha Powder').full, 6).indexOf('C010AN02X') < 0,
     A.ctx.acShortlist_(m('Matcha Powder').full, 6));
  ok('but a genuinely different product is still offered',
     A.ctx.acShortlist_(m('Matcha Powder').full, 6).indexOf('C010AN05') >= 0);
  ok('and shows the cost per unit worked out',
     /RM0\.13500 per G/.test(A.ctx.acShortlist_(m('Matcha Powder').full, 6)));

  group('What the preview says would change');
  {
    const D = bare();
    D.ss.insertSheet('Prices');
    /* Nothing in the tab yet, so every row this builds is an addition. */
    const first = D.ctx.acFill_(true);
    eq('with an empty tab nothing is an update', first.counts.changed, 0);
    eq('and nothing is unchanged either', first.counts.same, 0);
    ok('every row it would write counts as added', first.counts.added > 0);
    eq('added covers every row', first.counts.added,
       first.counts.chosen + first.counts.matched + first.counts.waiting +
       first.counts.blocked + first.counts.none);
    eq('a blocked or unmatched row carries no price', first.counts.blank,
       first.counts.waiting + first.counts.blocked + first.counts.none);
    eq('and blocked splits into the two reasons', first.counts.blocked,
       first.counts.uomClash + first.counts.noPack);

    /* Write it, then preview again: the same numbers must now read as unchanged. */
    D.ctx.acFill_();
    const again = D.ctx.acFill_(true);
    eq('running it twice would add nothing', again.counts.added, 0);
    eq('and change nothing', again.counts.changed, 0);
    ok('every row is identical to what is there', again.counts.same > 0);
    eq('while it still prices the same ingredients',
       again.counts.chosen + again.counts.matched,
       first.counts.chosen + first.counts.matched);

    ok('the report answers the price question in words',
       /row\(s\) added, 0 with a different price or pack size/.test(again.report),
       again.report.split('WHAT WOULD CHANGE')[1]);
    ok('and says a zero price is impossible rather than merely absent',
       /A price of zero is impossible here/.test(again.report));
    ok('and names the unit clashes separately from the missing pack sizes',
       /are a unit clash/.test(again.report) && /have no pack size/.test(again.report));
    ok('and reports on shared item codes either way',
       /ONE ITEM CODE, MORE THAN ONE INGREDIENT|No item code is used by two/.test(again.report));
    ok('dupCodes is a list, not a count', Array.isArray(again.counts.dupCodes));
  }

  group('The dry run, before anything is written');
  {
    /* acFill_ clears the whole Prices tab and rewrites it. A preview that does
       not predict that exactly is worse than none, so the test is not that the
       dry run says something sensible — it is that the real run agrees with it. */
    const B = bare();
    B.ss.insertSheet('Prices');
    const before = () => JSON.stringify(B.ss.getSheetByName('Prices').getRange(1, 1, 5, 11).getValues());
    const was = before();
    const dry = B.ctx.acFill_(true);
    ok('it says out loud that nothing was written',
       /DRY RUN, THE PRICES TAB HAS NOT BEEN TOUCHED/.test(dry.report));
    ok('and reports itself as a dry run', dry.dryRun === true);
    eq('the tab really is untouched', before(), was);
    const real = B.ctx.acFill_();
    eq('the real run prices exactly what the preview said',
       JSON.stringify(real.counts), JSON.stringify(dry.counts));
    eq('over exactly the same ingredients', real.ingredients, dry.ingredients);
    ok('and the real run does not claim to be a preview', !real.dryRun);
    ok('only the real one says nothing about being untouched',
       !/HAS NOT BEEN TOUCHED/.test(real.report));
    /* A preview must not leave a tab behind either. */
    const C = bare();
    const none = C.ctx.acFill_(true);
    ok('with no Prices tab it explains rather than creating one',
       /no Prices tab yet/.test(none.report) && !C.ss.getSheetByName('Prices'));
  }

  group('The run');
  const first = A.ctx.acFill_();
  const tab = () => {
    const sh = A.ss.getSheetByName('Prices');
    const out = {};
    sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues()
      .forEach(r => { out[String(r[0])] = r; });
    return out;
  };
  let rows = tab();
  eq('it asked the sync server for both datasets and for cost',
     /datasets=items,supplierPrices&cost=include/.test(lastFetch.url), true);
  eq('and sent the read token as a bearer',
     lastFetch.params.headers.Authorization, 'Bearer read-token');
  eq('every ingredient in the log gets a row', Object.keys(rows).length, A.ctx.acIngredients_().length);

  ok('a unique match with a usable pack size is priced outright',
     rows['Coconut Milk'][1] === 8.8 && rows['Coconut Milk'][2] === 1000,
     JSON.stringify(rows['Coconut Milk'].slice(0, 4)));
  eq('and is stamped as coming from AutoCount', rows['Coconut Milk'][5], 'AUTOCOUNT');
  ok('a pack sold by weight never prices a line poured by volume',
     rows['Cheese Foam'][1] === '');
  ok('an ambiguous ingredient is NOT priced', rows['Matcha Powder'][1] === '');
  ok('but is given a shortlist to choose from', String(rows['Matcha Powder'][9]).indexOf('C010AN02') >= 0);
  ok('a unique match whose pack size is unknown is not priced',
     rows['Gula Melaka Syrup'][1] === '' && rows['Gula Melaka Syrup'][3] === 'S001GM09');
  ok('and says that is why', /does not say how much/.test(String(rows['Gula Melaka Syrup'][8])));
  ok('a pack in grams does not price a line poured in millilitres',
     rows['Yuzu Puree'][1] === '');
  ok('and names the reason as a density rather than arithmetic',
     /density/.test(String(rows['Yuzu Puree'][8])));
  ok('an ingredient AutoCount does not stock says so',
     /in-house/.test(String(rows['Kopi Base'][8])));

  group('Choosing a code, and running it again');
  {
    const sh = A.ss.getSheetByName('Prices');
    const at = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
                 .findIndex(r => String(r[0]) === 'Matcha Powder') + 2;
    sh.getRange(at, 4).setValue('C010AN02');
  }
  A.ctx.acFill_();
  rows = tab();
  eq('the chosen code is priced exactly', [rows['Matcha Powder'][1], rows['Matcha Powder'][2]], [27, 200]);
  eq('cost per gram follows from it', rows['Matcha Powder'][1] / rows['Matcha Powder'][2], 0.135);
  eq('and the item it resolved to is named', rows['Matcha Powder'][6], 'MATCHA POWDER 200G (PREMIUM)');

  group('A person who prices a row by hand keeps it');
  {
    const sh = A.ss.getSheetByName('Prices');
    const at = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
                 .findIndex(r => String(r[0]) === 'Kopi Base') + 2;
    sh.getRange(at, 2).setValue(18);
    sh.getRange(at, 3).setValue(1000);
    sh.getRange(at, 6).setValue('Sakura');
  }
  A.ctx.acFill_();
  rows = tab();
  eq('their price survives a rerun', [rows['Kopi Base'][1], rows['Kopi Base'][2]], [18, 1000]);
  eq('and so does their name', rows['Kopi Base'][5], 'Sakura');
  eq('the machine still owns the rows it filled', rows['Coconut Milk'][5], 'AUTOCOUNT');

  group('An ingredient that leaves the log');
  {
    const sh = A.ss.getSheetByName('Prices');
    /* A row somebody priced, for an ingredient no recipe uses any more. */
    sh.getRange(sh.getLastRow() + 1, 1, 1, 6)
      .setValues([['Pandan Essence', 12, 500, '', 'ML', 'Robin']]);
    A.ctx.acFill_();
    const kept = tab()['Pandan Essence'];
    ok('a priced row for an ingredient no recipe uses is not thrown away', !!kept);
    eq('with the price intact', [kept[1], kept[2], kept[5]], [12, 500, 'Robin']);
    ok('and it says why it is still there', /No recipe in the log uses this/.test(String(kept[8])));
  }

  group('And then costing works');
  {
    /* The whole point, end to end: choose the codes for one drink's three
       ingredients, run the bridge, and the Recipe Finder has a cost per cup. */
    const sh = A.ss.getSheetByName('Prices');
    const at = name => sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
                         .findIndex(r => String(r[0]) === name) + 2;
    sh.getRange(at('Oolong Tea'), 4).setValue('J010SP11');   /* RM14.24 / 1000 ML */
    sh.getRange(at('Cheese Foam'), 4).setValue('N005RI09');  /* RM22.00 / 1000 ML */
    sh.getRange(at('Sugar Syrup'), 4).setValue('S001SG09');  /* RM 9.00 / 1000 ML */
    A.ctx.acFill_();

    const table = A.ctx.priceTable_();
    eq('the tab prices_() reads is the tab the bridge wrote',
       table.items['matcha powder'].perUnit, 0.135);
    /* Compared with a tolerance: 14.24/1000 is not exactly 0.01424 in binary
       floating point, and it does not need to be — costOf_ rounds once, at the
       end, which is what keeps the money right. */
    ok('and the chosen codes are priced per millilitre',
       Math.abs(table.items['oolong tea'].perUnit - 0.01424) < 1e-12,
       table.items['oolong tea'].perUnit);

    const foam = A.ctx.all_().recipes.find(r => r.id === 'RCP-0007');
    /* 160 x 0.01424 + 40 x 0.022 + 10 x 0.009 */
    eq('a drink whose every line is now priced has a cost per cup', foam.cost, 3.25);
    eq('and a gross margin against its selling price', foam.margin, 76.6);
    eq('and is no longer pending', foam.costPending, false);
    ok('and is not flagged, because RM3.25 against RM13.90 is plausible',
       foam.costCheck === null);
  }

  group('When it cannot run');
  {
    const noProps = load(fx.build({ withPrices: false }), { now: NOW, properties: {},
      fetch: () => ({ code: 200, body: cat.build() }) });
    let err = '';
    try { noProps.ctx.acFill_(); } catch (e) { err = e.message; }
    ok('missing settings stop it before anything is written', /Script Properties/.test(err), err);
    ok('and it says nothing was changed', /Nothing was changed/.test(err));

    const refused = load(fx.build({ withPrices: false }), { now: NOW,
      properties: { GC_SYNC_URL: 'https://sync.test/latest', GC_SYNC_TOKEN: 'wrong' },
      fetch: () => ({ code: 401, body: { error: 'Unauthorized dashboard read' } }) });
    err = '';
    try { refused.ctx.acFill_(); } catch (e) { err = e.message; }
    ok('a refused read is reported, not swallowed', /401/.test(err), err);
    ok('and changes nothing', /Nothing was changed/.test(err));

    const noCost = load(fx.build({ withPrices: false }), { now: NOW,
      properties: { GC_SYNC_URL: 'https://sync.test/latest', GC_SYNC_TOKEN: 'read-token' },
      fetch: () => ({ code: 200, body: { items: cat.build().items } }) });
    err = '';
    try { noCost.ctx.acFill_(); } catch (e) { err = e.message; }
    ok('a snapshot without prices is refused rather than half-used',
       /carries no items or no prices/.test(err), err);
  }
}

group('Moving the secrets into Script Properties');
{
  const bag = {};
  /* A live project: real values in the file, nothing in Script Properties. */
  const before = load(fx.build(), { now: NOW, properties: bag });
  const tokenBefore = before.ctx.signIn('manager', 'manager-pw').token;
  ok('it works before the migration', before.ctx.signIn('manager', 'manager-pw').ok);

  const report = before.ctx.moveSecretsToProperties();
  eq('all six settings are written',
     Object.keys(bag).sort(),
     ['GC_APP_FOLDER', 'GC_AUTH_SALT', 'GC_AUTH_SECRET',
      'GC_SHA_MANAGER', 'GC_SHA_ROBIN', 'GC_SHA_SAKURA']);
  ok('and it says so', /All 6 settings are in Script Properties/.test(report));
  /* A report that printed a secret would defeat the whole exercise. */
  ok('no secret value appears in the report',
     Object.keys(bag).every(k => report.indexOf(bag[k]) < 0), report);
  ok('only a four-character fingerprint of each', /\(\w{4}\)/.test(report));

  /* Now the file is the public one — placeholders — and the properties are set.
     That is exactly what pasting Web.gs whole produces. */
  const after = load(fx.build(), { now: NOW, secrets: false, properties: bag });
  ok('the salt resolves from the property', !/^PASTE-/.test(after.ctx.AUTH_SALT));
  ok('the Drive folder resolves', !/^PASTE-/.test(after.ctx.APP_FOLDER));
  ok('every name still signs in', ['manager', 'sakura', 'robin']
     .every(n => after.ctx.signIn(n, n + '-pw').ok));
  ok('a wrong password is still refused', !after.ctx.signIn('manager', 'nope').ok);
  eq('roles survive', after.ctx.signIn('sakura', 'sakura-pw').role, 'bi');

  /* The signing key is carried across unchanged, so the migration does not sign
     anybody out — which is the difference between a migration and an outage. */
  eq('a session opened before the move is still valid after it',
     after.ctx.readToken_(tokenBefore).role, 'manager');

  ok('and the whole site still reads', after.ctx.all_().count === 12);
  ok('preflight is happy with a migrated project', /READY to deploy/.test(after.ctx.preflight()));

  group('Secrets.gs against the OLD Web.gs, which is where it actually runs');
  {
    /* It is pasted into a project whose Web.gs is still the previous version:
       USER_SHAPE and shaProp_ do not exist there. A bare reference to either
       would be a ReferenceError and the migration would die on line one. */
    const old = load(fx.build(), { now: NOW, properties: {} });
    delete old.ctx.USER_SHAPE;
    delete old.ctx.shaProp_;
    let err = '', map = null;
    try { map = old.ctx.secretMap_(); } catch (e) { err = e.message; }
    ok('secretMap_ survives a project that has neither', !err, err);
    eq('and still names all six settings', map && map.map(m => m.key).sort(),
       ['GC_APP_FOLDER', 'GC_AUTH_SALT', 'GC_AUTH_SECRET',
        'GC_SHA_MANAGER', 'GC_SHA_ROBIN', 'GC_SHA_SAKURA']);
    const bag2 = {};
    const old2 = load(fx.build(), { now: NOW, properties: bag2 });
    delete old2.ctx.USER_SHAPE;
    delete old2.ctx.shaProp_;
    err = '';
    try { old2.ctx.moveSecretsToProperties(); } catch (e) { err = e.message; }
    ok('and the whole migration runs there', !err, err);
    eq('writing the same six settings', Object.keys(bag2).length, 6);
  }

  group('Running the migration on the wrong copy');
  {
    /* The accident that matters: somebody runs it on a fresh public checkout.
       It must refuse, not overwrite six working settings with placeholders. */
    const keep = Object.assign({}, bag);
    const fresh = load(fx.build(), { now: NOW, secrets: false, properties: keep });
    /* Blank the properties this run would read from, leaving only placeholders. */
    const empty = {};
    const naked = load(fx.build(), { now: NOW, secrets: false, properties: empty });
    const out = naked.ctx.moveSecretsToProperties();
    eq('nothing is written from a file that has only placeholders',
       Object.keys(empty).length, 0);
    ok('and it says which settings it refused', /NOT WRITTEN/.test(out));
    ok('and that nothing was broken', /nothing was broken/.test(out));

    /* Same again on a project that HAS been migrated. There is nothing to
       refuse here: the fallback design means the constants resolve from the
       properties, so it reads back exactly what is already stored. That is why
       a fresh checkout cannot damage a live project either way. */
    const out2 = fresh.ctx.moveSecretsToProperties();
    eq('existing settings are left exactly as they were', keep, bag);
    ok('and it reports them as already correct rather than rewriting them',
       /ALREADY CORRECT/.test(out2) && !/WROTE/.test(out2), out2);
    ok('the project still signs people in', fresh.ctx.signIn('robin', 'robin-pw').ok);
  }

  group('Running it twice');
  {
    const twice = load(fx.build(), { now: NOW, properties: {} });
    twice.ctx.moveSecretsToProperties();
    const second = twice.ctx.moveSecretsToProperties();
    ok('the second run changes nothing', /ALREADY CORRECT/.test(second));
    ok('and writes nothing', !/WROTE/.test(second), second);
  }

  group('checkSecrets, before and after the paste');
  {
    const set = load(fx.build(), { now: NOW, secrets: false, properties: bag });
    ok('a migrated project reports all six present',
       /All six settings are present/.test(set.ctx.checkSecrets()));
    const none = load(fx.build(), { now: NOW, secrets: false, properties: {} });
    const r = none.ctx.checkSecrets();
    ok('an unmigrated one names what is missing', /MISSING  GC_AUTH_SALT/.test(r));
    ok('and counts them', /6 setting\(s\) missing/.test(r));
  }
}

group('The preflight check, which is what stands between a paste and a broken site');
{
  /* secrets:false leaves the PASTE- placeholders exactly as committed. */
  const raw = load(fx.build(), { now: NOW, secrets: false, properties: {} }).ctx.preflight();
  ok('an unfilled paste is NOT READY', /NOT READY/.test(raw));
  ok('and says deploying would break the live site', /break the live site/.test(raw));
  ok('the salt is named', /AUTH_SALT is still the placeholder/.test(raw));
  ok('the signing key is named', /AUTH_SECRET is still the placeholder/.test(raw));
  ok('the Drive folder is named', /APP_FOLDER is still the placeholder/.test(raw));
  ok('every account with a placeholder hash is named',
     (raw.match(/still has the placeholder hash/g) || []).length === 3);
  ok('the pages cannot be checked without the folder, and it says so',
     /Cannot check the pages until APP_FOLDER/.test(raw));

  const good = load(fx.build(), { now: NOW,
    properties: { GC_SYNC_URL: 'https://s/x', GC_SYNC_TOKEN: 't' } }).ctx.preflight();
  ok('a filled-in project is READY', /READY to deploy/.test(good) && !/NOT READY/.test(good));
  ok('and confirms the four pages are the tested copies', /index\.html  24635/.test(good));
  ok('and finds all three tabs', (good.match(/found \(/g) || []).length === 3);

  /* The two keys are separate so that ending every session does not also
     change every password. Reusing one for both quietly couples them. */
  const same = load(fx.build(), { now: NOW, properties: {} });
  same.ctx.AUTH_SECRET = same.ctx.AUTH_SALT;
  ok('reusing one value for both keys is refused',
     /AUTH_SALT and AUTH_SECRET are the same/.test(same.ctx.preflight()));

  const noManager = load(fx.build(), { now: NOW, properties: {} });
  noManager.ctx.USERS = { sakura: noManager.ctx.USERS.sakura };
  ok('a project nobody could approve on is refused',
     /No account has the manager role/.test(noManager.ctx.preflight()));

  const short = load(fx.build(), { now: NOW, properties: {} });
  short.ctx.USERS = { manager: { role: 'manager', pic: '', sha: 'not-a-sha256' } };
  ok('a hash that is not a SHA-256 is caught before anyone finds they cannot sign in',
     /cannot be a SHA-256/.test(short.ctx.preflight()));

  /* No Prices tab is the state the live sheet is in today: a note, not a fault. */
  const noPrices = load(fx.build({ withPrices: false }), { now: NOW, properties: {} }).ctx.preflight();
  ok('having no price list yet does not block the deploy', /READY to deploy/.test(noPrices));
  ok('but is said out loud', /no Prices tab yet/.test(noPrices));
}

group('Installing the pages into Drive');
{
  const fsx = require('fs');
  const real = {};
  for (const n of ['index.html', 'intake.html', 'approve.html', 'dashboard.html'])
    real[n] = fsx.readFileSync(path.join(__dirname, '..', 'pages', n), 'utf8');

  /* Drive holding an OLD copy: the state a deploy actually starts from. */
  {
    const A = load(fx.build(), { now: NOW, properties: {} });
    A.folder._written['index.html'] = '<title>the previous version</title>';
    const out = A.ctx.installPages();
    ok('a stale page is replaced', /replaced index\.html/.test(out), out);
    ok('and the three that already match are left alone', /1 replaced, 3 already correct/.test(out));
    eq('what is now in Drive is byte-for-byte the tested copy',
       A.folder._written['index.html'], real['index.html']);
    ok('and checkPages agrees afterwards',
       /All four pages are exactly the copies that were tested/.test(A.ctx.checkPages()));
  }

  /* The case the fingerprints exist for: the carried bytes are not the ones
     Web.gs was tested against. Two independent places have to agree. */
  {
    const B = load(fx.build(), { now: NOW, properties: {} });
    B.folder._written['index.html'] = '<title>the previous version</title>';
    B.ctx.PAGE_DATA = Object.assign({}, B.ctx.PAGE_DATA,
      { 'index.html': real['index.html'] + '\n<script>steal()</script>' });
    const out = B.ctx.installPages();
    ok('a page that does not match its fingerprint is refused', /REFUSED  index\.html/.test(out), out);
    ok('and says the live page is untouched', /live page is untouched/.test(out));
    eq('and the live page really is untouched',
       B.folder._written['index.html'], '<title>the previous version</title>');
    ok('and the run reports the refusal rather than success',
       /NOT installed/.test(out) && !/checkPages\(\) will read clean/.test(out));
  }

  /* A page missing from the carried data changes nothing. */
  {
    const C = load(fx.build(), { now: NOW, properties: {} });
    C.folder._written['approve.html'] = '<title>the previous version</title>';
    C.ctx.PAGE_DATA = Object.assign({}, C.ctx.PAGE_DATA, { 'approve.html': null });
    const out = C.ctx.installPages();
    ok('a page absent from PagesData is reported', /MISSING  approve\.html is not in PagesData/.test(out), out);
    eq('and nothing is written', C.folder._written['approve.html'], '<title>the previous version</title>');
  }

  /* The generated data is the pages, exactly. */
  {
    const D = load(fx.build(), { now: NOW, properties: {} });
    for (const n of Object.keys(real))
      eq(n + ' is carried byte-for-byte', D.ctx.PAGE_DATA[n], real[n]);
  }
}

/* ================================================= water, ice, and free rows */
/**
 * Free.gs zeroes a Prices row, which is a WRITE to the live price list. Getting
 * it wrong understates every drink that uses the ingredient, silently — so the
 * refusals matter more here than the matches.
 */
group('What counts as free');
{
  const F = load(fx.build({ withPrices: false }), { now: NOW }).ctx;
  const yes = n => F.freeAnnotated_(n.toLowerCase());
  ok('a temperature written after the name is a note, not a product', yes('water 55c'));
  ok('so is one with the unit spelt out', yes('water 55 cc'));
  ok('a quantity split written after the name is a note too', yes('ice (280+ 100)'));
  ok('and the spacing inside it does not matter', yes('ice (280+100)'));
  ok('a bare pack size is still the same free thing', yes('ice 500g'));
  ok('a plain name is left to the list', !yes('water'));
  ok('another WORD makes it a different product', !yes('ice cream'));
  ok('however innocent that word looks', !yes('water chestnut popping boba 900g'));
  ok('a free word in the middle does not free the name', !yes('soda water'));
  ok('nor does one at the end', !yes('coconut water'));
  ok('and a slash is two ingredients, not a note', !yes('soda water/ water'));
}

group('Pricing the free rows');
{
  const A = load(fx.build({ withPrices: false }), { now: NOW });
  const ctxF = A.ctx;
  const sh = A.ss.insertSheet('Prices');
  sh.appendRow(ctxF.AC_HEAD);
  const ROWS = [
    ['Water',            '', '', '', '', ''],
    ['Ice',              '', '', '', '', ''],
    ['Water 55c',        '', '', '', '', ''],
    ['Ice (280+ 100)',   '', '', '', '', ''],
    ['Sparkling Water',  '', '', '', '', ''],
    ['Ice Cream',        '', '', '', '', ''],
    ['Coconut Water',    '', '', '', '', ''],
    ['Kopi Base',      1.8, 100, '', '', 'AUTOCOUNT'],
    ['Cold Water',       0,   1, '', '', ''],
    ['Hot Water',        0,   1, '', '', 'Owner (free)'],
    ['Iced Water',       9,   1, '', '', '']
  ];
  ROWS.forEach(r => sh.appendRow(r));

  const msg = ctxF.priceFreeIngredients();
  const row = name => sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues()
                        .filter(r => String(r[0]) === name)[0];
  /* The report is written in blocks with a blank line between them, and every
     name appears in exactly one block. Matching across the whole message would
     find a name in the wrong block and call it a pass. */
  const section = (msg, head) =>
    (msg.split(/\n\n+/).filter(b => b.indexOf(head) === 0)[0] || '');

  eq('a plain free name is zeroed', row('Water').slice(1, 3), [0, 1]);
  eq('and stamped so the AutoCount refresh will not take it back',
     row('Water')[ctxF.AC_SOURCE_COL - 1], 'Owner (free)');
  eq('a name carrying only a measurement is zeroed too',
     row('Water 55c').slice(1, 3), [0, 1]);
  eq('including the ice split the owner approved',
     row('Ice (280+ 100)').slice(1, 3), [0, 1]);
  ok('and the report says a rule caught it, not the list',
     /Ice \(280\+ 100\)/.test(section(msg, 'SET TO 0 PER 1 UNIT — a free word')));
  ok('while a plain name is reported as a list match',
     /Water\b/.test(section(msg, 'SET TO 0 PER 1 UNIT, BY NAME')));

  ok('a purchased product containing "water" is left blank',
     row('Sparkling Water')[1] === '' && row('Coconut Water')[1] === '');
  ok('so is one containing "ice"', row('Ice Cream')[1] === '');
  ok('and every one of them is reported for a person', (function () {
    const b = section(msg, 'NOT TOUCHED');
    return /Sparkling Water/.test(b) && /Ice Cream/.test(b) && /Coconut Water/.test(b);
  })());

  eq('a real price is never overwritten', row('Kopi Base').slice(1, 3), [1.8, 100]);
  eq('nor is a wrong-looking one on a free name', row('Iced Water').slice(1, 3), [9, 1]);
  ok('which is reported rather than silently kept',
     /Iced Water/.test(section(msg, 'ALREADY PRICED, LEFT ALONE')));

  /* The reason this branch exists: acFill_ re-prices any row nobody owns. */
  eq('an already-free row with no owner keeps its price',
     row('Cold Water').slice(1, 3), [0, 1]);
  eq('but gains the mark that protects it',
     row('Cold Water')[ctxF.AC_SOURCE_COL - 1], 'Owner (free)');
  ok('and the report says so', /Cold Water/.test(section(msg, 'ALREADY 0 PER 1 BUT UNPROTECTED')));
  eq('a free row that already had an owner is untouched',
     row('Hot Water')[ctxF.AC_SOURCE_COL - 1], 'Owner (free)');
  ok('and is not claimed as work done',
     !/Hot Water/.test(section(msg, 'ALREADY 0 PER 1 BUT UNPROTECTED')) &&
     /Hot Water/.test(section(msg, 'ALREADY PRICED, LEFT ALONE')));

  /* Running it twice must do nothing the second time. */
  const again = ctxF.priceFreeIngredients();
  ok('a second run prices nothing', /^0 ingredient\(s\) priced/m.test(again));
  ok('and marks nothing', !/UNPROTECTED/.test(again));
  eq('and the rows are exactly as the first run left them',
     row('Water 55c').slice(1, 3), [0, 1]);
}

/* ============================================ the same name written two ways */
/**
 * The price list joins to the recipes by name, so a second spelling is a second
 * row to price and every recipe using the first spelling stays uncosted with
 * nothing on screen to say why. This finds those; it must never MERGE them,
 * because "Coconut Milk" and "Milk" share a word and are different things.
 */
group('Stripping the packaging off a name');
{
  const N = load(fx.build(), { now: NOW }).ctx;
  const k = n => N.nmKey_(n);
  eq('a pack size written with a decimal comes off',
     k('Flavored Syrup Ice 1.08kg – Ice Syrup'), 'FLAVORED ICE SYRUP');
  eq('and the British spelling lands on the same key',
     k('Flavoured Syrup Ice'), 'FLAVORED ICE SYRUP');
  eq('word order does not matter', k('Ice Syrup'), k('Syrup Ice'));
  eq('nor does a word said twice', k('Ice Syrup Ice'), 'ICE SYRUP');
  eq('nor case or punctuation', k('SODA-WATER'), k('soda water'));
  eq('a bare pack size is only packaging', k('Milk 1L'), 'MILK');
  ok('two different products keep different keys',
     k('Coconut Milk') !== k('Coconut Water'));
  ok('and a word in common is not a key', k('Coconut Milk') !== k('Milk'));

  /* A slash is not enough: the live sheet has one separating a grade code and
     one separating a pack unit, and neither is a choice. */
  const c = n => N.nmChoice_(n);
  ok('an ingredient on each side of the slash is a choice', c('Soda Water/ Water'));
  ok('with or without the space', c('Soda Water/Water'));
  ok('and two real products are too', c('Fructose/ White Sugar'));
  ok('the word "or" reads the same way', c('Fructose or White Sugar'));
  ok('a two-letter grade code is not a choice',
     !c('H/R - Japanese Hojicha Green Tea Powder 500gm/pkt'));
  ok('nor is a pack unit', !c('Zonefor Jasmine Tea Leaves 50g/bag'));
  ok('nor is a name with no slash at all', !c('Soda Water'));
}

group('Finding the pairs, and refusing to merge them');
{
  const f = fx.build();
  const mk = (id, name, ings) => ings.map(n =>
    ['2026-08-01', id, name, n, '10', 'ML', 'GC', 'Approved', '', 'V1.0']);
  f.tabs[0].values = [fx.LOG_HEAD.slice()].concat(
    mk('RCP-9001', 'A', ['Flavored Syrup Ice 1.08kg – Ice Syrup', 'Milk']),
    mk('RCP-9002', 'B', ['Flavored Syrup Ice 1.08kg – Ice Syrup', 'Coconut Milk']),
    mk('RCP-9003', 'C', ['Flavoured Syrup Ice', 'Soda Water/ Water', 'COCONUT WATER']),
    mk('RCP-9004', 'D', ['Coloryeah Coconut Water', 'Sparkling Water']));
  const N = load(f, { now: NOW }).ctx;
  const msg = N.findLikeNames();
  const part = h => (msg.split(/\n\n/).filter(b => b.indexOf(h) === 0)[0] || '');
  const choice = part('1.'), same = part('2.'), inside = part('3.');

  ok('a cell holding two ingredients is called out', /Soda Water\/ Water/.test(choice));
  ok('and only that one is', choice.split('\n').length === 5);
  /* It is two ingredients, so its words must not be compared with anything. */
  ok('and a choice is kept out of the same-words groups',
     !/Soda Water\/ Water/.test(same));

  ok('the headline is at the top, where truncation cannot reach it',
     /^THE SAME INGREDIENT WRITTEN TWO WAYS\n\n {3}\d+ distinct ingredient names/.test(msg));
  ok('and it counts the groups', /1 group\(s\) are one ingredient spelt more than one way/.test(msg));

  ok('the two spellings of one syrup are grouped', /Flavoured Syrup Ice/.test(same) &&
     /Flavored Syrup Ice 1\.08kg/.test(same));
  ok('with the recipes waiting on them counted', /3 recipe-slots/.test(same));
  ok('and how many of those sit on a spelling with no price',
     /3 of them on a spelling with no price/.test(same));
  ok('and each spelling says whether it is priced', /not priced/.test(same));
  ok('coconut milk is not grouped with coconut water', !/Coconut Milk/.test(same));

  ok('a name inside another is offered as a question',
     /COCONUT WATER\s+inside\s+Coloryeah Coconut Water/.test(inside));
  ok('but a common one-word name is not, or it would be inside everything',
     !/^\s*Milk\s+inside/m.test(inside));
  ok('and the questions are kept out of the findings', !/Coloryeah/.test(same));

  ok('nothing at all was written', N.library_().every(r =>
     r.ing.every(i => i.n !== 'Flavored Syrup Ice')));
  ok('the report says so out loud', /nothing[\s\S]*was written/i.test(msg));

  /* Ranking is by what is BLOCKED, not by group size: a group where every
     spelling is already priced is real but buys nothing this week. */
  {
    const g = fx.build();
    g.tabs[0].values = [fx.LOG_HEAD.slice()].concat(
      /* Kopi Base is priced in the fixture; Apple Juice is not. */
      mk('RCP-9101', 'P', ['Kopi Base']), mk('RCP-9102', 'Q', ['Kopi Base']),
      mk('RCP-9103', 'R', ['Kopi Base 1L']),
      mk('RCP-9104', 'S', ['Apple Juice']), mk('RCP-9105', 'T', ['Apple Juice 1L']));
    /* Both spellings of Kopi Base priced, so that group blocks nothing. */
    g.tabs.filter(t => t.name === 'Prices')[0].values.push(['Kopi Base 1L', 18, 1000, '']);
    const r = load(g, { now: NOW }).ctx.findLikeNames();
    const body = r.split(/\n\n/).filter(b => b.indexOf('2.') === 0)[0];
    ok('the group that blocks costing comes first',
       body.indexOf('Apple Juice') < body.indexOf('Kopi Base'), body);
    ok('and a fully priced group says so plainly',
       /all of them priced already/.test(body), body);
    ok('the headline counts only what is stuck',
       /2 of which sit on a spelling that has no price/.test(r), r.split('\n').slice(0, 8).join(' | '));
    ok('and does not claim the spelling is what blocks costing',
       /ONE price to[\s\S]*type instead of several/.test(r));
  }

  /* The fixture on its own must produce no false finding. */
  const clean = load(fx.build(), { now: NOW }).ctx.findLikeNames();
  const cs = clean.split(/\n\n/).filter(b => b.indexOf('2.') === 0)[0];
  ok('a library with no duplicate spellings reports none', /none/.test(cs), cs);
}

/* =================================================== one ingredient, one name */
/**
 * Renaming rewrites the R&D Log, which is the only place a recipe exists. The
 * risk is not the rename: it is the DOSE. "Espresso 18G" is 18 grams, and the
 * quantity has its own column, so a careless rename deletes a measurement. Most
 * of what follows is the refusals.
 */
group('Reading a dose out of a name');
{
  const R = load(fx.build(), { now: NOW }).ctx;
  const d = x => R.rnDose_(x);
  eq('a bare dose', d('18G'), { qty: 18, unit: 'G', text: '18 G' });
  eq('brackets come off', d('(22g)'), { qty: 22, unit: 'G', text: '22 G' });
  eq('and so does slack inside them', d('( 15G )'), { qty: 15, unit: 'G', text: '15 G' });
  eq('a space between number and unit is fine', d('12 g'), { qty: 12, unit: 'G', text: '12 G' });
  eq('cc is millilitres', d('55cc'), { qty: 55, unit: 'ML', text: '55 ML' });
  ok('a ratio is not a dose', d('(1:3)') === null);
  ok('nor is a word', d('(Premium)') === null);
  ok('nor is a unit this does not measure in', d('18 scoops') === null);
  ok('nor is nothing at all', d('') === null);

  const e = (n, t) => R.rnExtra_(n, t);
  eq('what is left after the target comes off', e('Espresso 18G', 'Espresso'), ' 18G');
  eq('case does not matter', e('espresso (18G)', 'Espresso'), ' (18G)');
  eq('an exact match leaves nothing', e('Espresso', 'Espresso'), '');
  ok('a name that does not start with the target is refused outright',
     e('Original Cheese Cap', 'Cheese Cap') === null);
}

group('Planning a rename, and refusing half of it');
{
  const f = fx.build();
  const row = (id, ing, qty, uom) =>
    ['2026-08-01', id, 'R ' + id, ing, qty, uom, 'GC', 'Approved', '', 'V1.0'];
  f.tabs[0].values = [fx.LOG_HEAD.slice(),
    row('RCP-9201', 'Espresso', '30', 'ML'),
    row('RCP-9202', 'Espresso 18G', '18', 'G'),
    row('RCP-9203', 'Espresso (22g)', '', ''),
    row('RCP-9204', 'Espresso 16g', '30', 'ML'),
    row('RCP-9205', 'espresso (18G)', '30', 'ML'),
    row('RCP-9206', 'Espresso 20g', '25', 'G'),
    row('RCP-9207', 'Cheese Cap (1:3)', '40', 'ML'),
    row('RCP-9208', 'Original Cheese Cap', '40', 'ML')];
  /* A trial row is where a dose goes when the quantity column is measuring
     something else. RCP-9204 deliberately has none. */
  const trial = (id, method) => {
    const r = new Array(fx.TRIAL_HEAD.length).fill('');
    r[1] = id; r[3] = 'V1.0'; r[20] = method;
    return r;
  };
  f.tabs[2].values = [fx.TRIAL_HEAD.slice(),
    trial('RCP-9205', 'Pull the shot, top with milk.'),
    trial('RCP-9206', '')];

  const A = load(f, { now: NOW });
  const R = A.ctx;
  const LIST = R.ESPRESSO.concat(['Espresso 20g']);
  const p = R.renamePlan_(LIST, 'Espresso');
  const rows = g => p[g].map(x => x.from);

  eq('every row carrying an old spelling is found', p.rows, 6);
  eq('the one already spelt right is left alone', rows('nothing'), ['Espresso']);
  eq('a dose the quantity column already records is only a rename',
     rows('rename'), ['Espresso 18G']);
  eq('a dose with nowhere recorded is moved into the quantity column',
     rows('move'), ['Espresso (22g)']);
  eq('a dose measuring something else is kept rather than dropped',
     rows('note'), ['Espresso 16g', 'espresso (18G)']);
  eq('and only the real contradiction is refused', rows('refuse'), ['Espresso 20g']);

  ok('grams beside millilitres is not a contradiction, it is two units',
     /different units, so neither is the other and neither is wrong/.test(p.note[1].why),
     p.note[1].why);
  ok('but the same unit twice is, and it is refused',
     /the same unit, two numbers/.test(p.refuse[0].why), p.refuse[0].why);
  ok('a recipe with a trial row gets the dose in the method too',
     /preparation method and the change log/.test(p.note[1].why), p.note[1].why);
  ok('and one without still gets it, in the change log',
     /change log — the trial log has no row for RCP-9204/.test(p.note[0].why), p.note[0].why);
  /* A trial row filed under another version is a different thing from none, and
     saying "no trial row" would hide it. */
  {
    const h = fx.build();
    h.tabs[0].values = [fx.LOG_HEAD.slice(), row('RCP-9301', 'Espresso 18G', '36', 'ML')];
    h.tabs[2].values = [fx.TRIAL_HEAD.slice(), (() => {
      const r = trial('RCP-9301', 'Pull it.'); r[3] = 'V2.0'; return r; })()];
    const w = load(h, { now: NOW }).ctx.renamePlan_(LIST, 'Espresso');
    ok('a trial row under another version says so',
       /files RCP-9301 under V2\.0, not V1\.0/.test(w.note[0].why), w.note[0].why);
  }

  const q = R.renamePlan_(['Cheese Cap (1:3)', 'Original Cheese Cap'], 'Cheese Cap');
  eq('a ratio in the name is refused, not dropped', q.refuse.length, 2);
  ok('because it is not a measurement', /not a measurement/.test(q.refuse[0].why));
  ok('and an extra word is refused for a different reason',
     /something other than a dose differs/.test(q.refuse[1].why));

  ok('planning writes nothing at all', A.ss.getSheetByName('R&D Log')
     .getRange(2, 4, 8, 1).getValues().map(r => r[0]).join('|') ===
     'Espresso|Espresso 18G|Espresso (22g)|Espresso 16g|espresso (18G)|Espresso 20g|' +
     'Cheese Cap (1:3)|Original Cheese Cap');

  group('Applying it');
  const msg = R.renameApply_(LIST, 'Espresso');
  const sh = A.ss.getSheetByName('R&D Log');
  const after = sh.getRange(2, 1, 8, 10).getValues();
  const ing = i => String(after[i][3]), qty = i => String(after[i][4]), uom = i => String(after[i][5]);
  const ts = A.ss.getSheetByName('R&D TRIAL LOG');
  const method = i => String(ts.getRange(2, 1, 2, fx.TRIAL_HEAD.length).getValues()[i][20]);

  eq('the row that already recorded its dose is now plain', ing(1), 'Espresso');
  eq('and its quantity is untouched', qty(1) + ' ' + uom(1), '18 G');
  eq('the empty one is renamed', ing(2), 'Espresso');
  eq('and the dose moved into the quantity column', qty(2) + ' ' + uom(2), '22 G');

  eq('the one measuring two things is renamed', ing(4), 'Espresso');
  eq('and keeps the volume costing reads', qty(4) + ' ' + uom(4), '30 ML');
  eq('while the dose is appended to the method, not replacing it',
     method(0), 'Pull the shot, top with milk. Espresso dose: 18 G.');

  eq('the one with no trial row is renamed too', ing(3), 'Espresso');
  eq('keeping its quantity', qty(3) + ' ' + uom(3), '30 ML');
  eq('the contradicting one is left exactly as it was', ing(5), 'Espresso 20g');
  eq('and its method is left empty rather than given a number', method(1), '');
  eq('and nothing outside the list is touched', ing(6) + '|' + ing(7),
     'Cheese Cap (1:3)|Original Cheese Cap');

  /* The change log is the record that outlives the execution log. */
  const chg = A.ss.getSheetByName('CHANGE LOG');
  const clog = chg.getRange(2, 1, chg.getLastRow() - 1, 10).getValues();
  eq('one change row per cell changed', clog.length, 4);
  eq('each names the field', clog.map(r => r[3]).join('|'),
     'Ingredient name|Ingredient name|Ingredient name|Ingredient name');
  eq('and carries the old spelling and the new',
     clog.map(r => r[4] + '>' + r[5]).join(', '),
     'Espresso 18G>Espresso, Espresso (22g)>Espresso, Espresso 16g>Espresso, ' +
     'espresso (18G)>Espresso');
  eq('a rename is not a new version of the recipe',
     clog.filter(r => r[1] !== r[2]).length, 0);
  ok('the number that could not go anywhere else is written down here',
     clog.some(r => /also carried 16 G/.test(r[9]) && /recorded here/.test(r[9])),
     clog.map(r => r[9]).join(' // '));
  ok('and the record does not guess what that number meant',
     clog.some(r => /may be the dose[\s\S]*or the pack it was bought in/.test(r[9])));
  ok('and the one that moved into the quantity column says so',
     clog.some(r => /22 G moved out of the name into the quantity column/.test(r[9])));
  ok('nothing refused is recorded as a change',
     !clog.some(r => /Espresso 20g/.test(r[4])));

  ok('the report prints the old value of every row it wrote',
     /Espresso \(22g\)/.test(msg) && /espresso \(18G\)/.test(msg));
  ok('and says the refused one still needs a person',
     /REFUSED[\s\S]*Espresso 20g/.test(msg));
  ok('it points at the sheet history for a real undo', /Version history/.test(msg));

  /* Running it twice must find nothing left to do, and must not write the note
     into the method a second time. */
  const again = R.renameApply_(LIST, 'Espresso');
  ok('a second run renames nothing', /0 rename cleanly, 0 also move/.test(again), again.slice(0, 300));
  eq('and the method is not doubled up',
     method(0), 'Pull the shot, top with milk. Espresso dose: 18 G.');
  eq('while the refusal still stands', ing(5), 'Espresso 20g');
  eq('and the change log is not written a second time',
     chg.getLastRow() - 1, 4);
}

group('Settling several groups in one run');
{
  const f = fx.build();
  const row = (id, ing, qty, uom) =>
    ['2026-08-01', id, 'R ' + id, ing, qty, uom, 'GC', 'Approved', '', 'V1.0'];
  f.tabs[0].values = [fx.LOG_HEAD.slice(),
    row('RCP-9401', 'Thai Tea 12G', '12', 'G'),
    row('RCP-9402', 'Thai Tea (12G)', '', ''),
    row('RCP-9403', 'Monin Rose Syrup 1L', '15', 'ML'),
    row('RCP-9404', 'Da Hong Pao', '5', 'G'),
    row('RCP-9405', 'Espresso 18G', '18', 'G'),
    row('RCP-9406', 'Jasmine Tea (12g)', '250', 'ML'),
    row('RCP-9407', 'JASMINE TEA', '12', 'G')];
  f.tabs[2].values = [fx.TRIAL_HEAD.slice()];
  const A = load(f, { now: NOW });
  const R = A.ctx;

  ok('the target is never longer than what it replaces', R.SPELLINGS.every(g =>
     g.from.every(n => n.toLowerCase().indexOf(g.to.toLowerCase()) === 0)),
     R.SPELLINGS.filter(g => g.from.some(n =>
       n.toLowerCase().indexOf(g.to.toLowerCase()) !== 0)).map(g => g.to).join(', '));

  const plan = R.spellingsPlan();
  ok('the plan names every group', R.SPELLINGS.every(g => plan.indexOf(g.to) >= 0));
  ok('and totals the rows', /6 row\(s\) would change, 0 refused/.test(plan),
     plan.split('\n').filter(l => /would change/.test(l)).join(' | '));
  ok('and writes nothing', String(A.ss.getSheetByName('R&D Log')
     .getRange(2, 4).getValue()) === 'Thai Tea 12G');

  const msg = R.spellingsApply();
  const ing = i => String(A.ss.getSheetByName('R&D Log').getRange(i + 2, 4).getValue());
  eq('the tea doses collapse to one name', ing(0) + '|' + ing(1), 'Thai Tea|Thai Tea');
  eq('and the one with an empty quantity gains it',
     String(A.ss.getSheetByName('R&D Log').getRange(3, 5).getValue()) + ' ' +
     String(A.ss.getSheetByName('R&D Log').getRange(3, 6).getValue()), '12 G');
  eq('a bottle size comes off the syrup name', ing(2), 'Monin Rose Syrup');
  eq('and the pour it was measured in is untouched',
     String(A.ss.getSheetByName('R&D Log').getRange(4, 5).getValue()), '15');
  eq('a name already right is left alone', ing(3), 'Da Hong Pao');
  eq('espresso is covered by the table too', ing(4), 'Espresso');
  eq('and so is jasmine', ing(5) + '|' + ing(6), 'Jasmine Tea|Jasmine Tea');

  ok('the summary says what happened, not what is left',
     /6 row\(s\) changed, 0 refused/.test(msg), msg.split('\n\n')[1]);
  ok('and it is one line per group, not ten full reports',
     msg.split('\n').length < 40, String(msg.split('\n').length));

  const chg = A.ss.getSheetByName('CHANGE LOG');
  eq('every change is recorded once', chg.getLastRow() - 1, 6);
  ok('including what the bottle size was, without guessing what it meant',
     chg.getRange(2, 1, 6, 10).getValues().some(r =>
       /also carried 1 L/.test(r[9]) && /may be the dose[\s\S]*or the pack/.test(r[9])),
     chg.getRange(2, 1, 6, 10).getValues().map(r => r[9]).join(' // '));

  const twice = R.spellingsApply();
  ok('a second run changes nothing', /0 row\(s\) changed/.test(twice));
  eq('and does not write the change log again', chg.getLastRow() - 1, 6);
}

/* ============================================== storing the AutoCount token */
/**
 * The Script Properties form lost this row three times without saying so. The
 * point of doing it in code is that it can answer "did it work" — so the tests
 * are mostly about refusing to store a token that has not been proved, and about
 * never letting the token itself into a message.
 */
/* ============================ setting the token from the spreadsheet's own menu */
/**
 * Four attempts to save this token succeeded — in the other Apps Script copy.
 * Both copies look identical from inside the editor, so the fix is not a better
 * instruction, it is a different door: a menu served by the script BOUND to the
 * live sheet. Open the sheet by its id and there is no copy to land in.
 *
 * The tests that matter are the ones about what the token must never touch.
 */
group('Set GC Sync Token, from the sheet menu');
{
  const SECRET = 'tok-live-7c21-must-never-appear';
  const mk = (opts) => load(fx.build({ withPrices: false }), Object.assign({
    now: NOW, scriptId: 'THE-LIVE-PROJECT-ID',
    properties: { GC_SYNC_URL: 'https://sync.test/api/v1/procurement/latest' }
  }, opts));

  const good = { code: 200, body: { items: [{ ItemCode: 'A' }, { ItemCode: 'B' }],
                                    supplierPrices: [{ ItemCode: 'A' }] } };

  /* Every refusal, and never the token in any of them. */
  const refusals = [
    ['no URL to check against', load(fx.build({ withPrices: false }),
       { now: NOW, properties: {} }), SECRET, /GC_SYNC_URL is not set/],
    ['nothing pasted',          mk({ fetch: () => good }), '   ',  /Nothing was pasted/],
    ['the server refuses it',   mk({ fetch: () => ({ code: 401, body: {} }) }), SECRET,
                                /refused that token \(401\)/],
    ['the server errors',       mk({ fetch: () => ({ code: 503, body: {} }) }), SECRET,
                                /answered 503/],
    ['the snapshot is empty',   mk({ fetch: () => ({ code: 200,
                                  body: { items: [], supplierPrices: [] } }) }), SECRET,
                                /would price nothing/]
  ];
  refusals.forEach(([what, A, tok, why]) => {
    const msg = A.ctx.syncTokenStore_(tok);
    ok(what + ': not stored', !A.props.GC_SYNC_TOKEN, 'stored anyway');
    ok(what + ': says why', why.test(msg), msg);
    ok(what + ': the token is not in the message', msg.indexOf(SECRET) < 0);
    ok(what + ': and not in the log', A.logs.join('\n').indexOf(SECRET) < 0);
  });

  /* A thrown fetch must not leak the request either. */
  {
    const A = mk({ fetch: () => { throw new Error('connect failed to ' + '?token=' + SECRET); } });
    const msg = A.ctx.syncTokenStore_(SECRET);
    ok('a thrown request does not leak the token', msg.indexOf(SECRET) < 0, msg);
    ok('and nothing is stored', !A.props.GC_SYNC_TOKEN);
  }

  /* The one that works. */
  {
    let sent = null;
    const A = mk({ fetch: (url, params) => { sent = { url, params }; return good; } });
    const msg = A.ctx.syncTokenStore_('  ' + SECRET + '  ');   /* pasted with whitespace */
    eq('a proved token is stored, trimmed', A.props.GC_SYNC_TOKEN, SECRET);
    ok('sent as a bearer token', sent.params.headers.Authorization === 'Bearer ' + SECRET);
    ok('asking for both datasets with cost',
       /datasets=items,supplierPrices&cost=include/.test(sent.url));
    ok('the dialog says SAVED AND PROVED', /^SAVED AND PROVED/.test(msg), msg);
    ok('with the item count', /\n2 items\n/.test(msg), msg);
    ok('and the supplier-price count', /1 supplier prices/.test(msg), msg);
    ok('and the script id, so the wrong copy would be obvious',
       /Script id: THE-LIVE-PROJECT-ID/.test(msg), msg);
    ok('but never the token', msg.indexOf(SECRET) < 0);
    ok('and the log never carries it either', A.logs.join('\n').indexOf(SECRET) < 0);
    ok('nothing was written to any sheet', A.ss.getSheetByName('Prices') === null ||
       A.ss.getSheetByName('Prices').getLastRow() <= 1);
  }

  /* The menu handler refuses to be run from the editor rather than throwing. */
  {
    const A = mk({ fetch: () => good, noUi: true });
    const msg = A.ctx.setSyncToken();
    ok('run from the editor it explains where the menu is',
       /R&D Tools -> Setup -> Set GC Sync Token/.test(msg), msg);
  }
}

group('Saving the sync token');
{
  const SECRET = 'tok-live-9f3a-do-not-leak';
  const mk = (opts) => load(fx.build({ withPrices: false }), Object.assign({
    now: NOW,
    properties: { GC_SYNC_URL: 'https://sync.test/api/v1/procurement/latest' }
  }, opts));

  /* Nothing pasted yet. */
  {
    const A = mk({ fetch: () => { throw new Error('must not be called'); } });
    const r = A.ctx.saveSyncToken();
    ok('an unpasted placeholder is refused', /^NOT SAVED/.test(r), r);
    ok('and says where to paste', /PASTE_SYNC_TOKEN/.test(r));
    ok('and nothing is stored', !A.props.GC_SYNC_TOKEN);
  }

  /* No URL to test against. */
  {
    const A = load(fx.build({ withPrices: false }), { now: NOW, properties: {} });
    A.ctx.PASTE_SYNC_TOKEN = SECRET;
    const r = A.ctx.saveSyncToken();
    ok('without a URL there is nothing to prove the token against', /^NOT SAVED/.test(r));
    ok('and it names the missing setting', /GC_SYNC_URL/.test(r));
  }

  /* The server refuses it. */
  {
    const A = mk({ fetch: () => ({ code: 401, body: { error: 'Unauthorized' } }) });
    A.ctx.PASTE_SYNC_TOKEN = SECRET;
    const r = A.ctx.saveSyncToken();
    ok('a rejected token is not stored', !A.props.GC_SYNC_TOKEN);
    ok('and the refusal is reported as a refusal', /refused that token \(401\)/.test(r), r);
    ok('and the token is not echoed back', r.indexOf(SECRET) < 0);
  }

  /* The server answers, but with an empty snapshot. */
  {
    const A = mk({ fetch: () => ({ code: 200, body: { items: [], supplierPrices: [] } }) });
    A.ctx.PASTE_SYNC_TOKEN = SECRET;
    const r = A.ctx.saveSyncToken();
    ok('a working token over an empty snapshot is still not stored',
       !A.props.GC_SYNC_TOKEN);
    ok('and it says the refresh would price nothing', /would price nothing/.test(r), r);
  }

  /* The failure that started all this: a function that only RETURNS a string
     shows NOTHING when run from the editor. The log reads "Execution completed"
     whether it saved the token or refused it, which looks exactly like success. */
  {
    const A = mk({ fetch: () => ({ code: 401, body: {} }) });
    A.ctx.PASTE_SYNC_TOKEN = SECRET;
    const said = A.ctx.saveSyncToken();
    ok('a refusal reaches the execution log, not just the return value',
       A.logs.join('\n').indexOf(said) >= 0,
       'logged: ' + JSON.stringify(A.logs));
    const B = mk({ fetch: () => ({ code: 200, body: { items: [{ItemCode:'A'}],
                                                     supplierPrices: [{ItemCode:'A'}] } }) });
    B.ctx.PASTE_SYNC_TOKEN = SECRET;
    const won = B.ctx.saveSyncToken();
    ok('and so does a success', B.logs.join('\n').indexOf(won) >= 0);
    ok('without the log carrying the token', B.logs.join('\n').indexOf(SECRET) < 0);
    const C = mk({ fetch: () => ({ code: 200, body: { items: [], supplierPrices: [] } }) });
    const nope = C.ctx.saveSyncToken();          /* call first, then read the log */
    ok('an unpasted placeholder is logged too', C.logs.join('\n').indexOf(nope) >= 0,
       'logged: ' + JSON.stringify(C.logs));
  }

  /* It works. */
  {
    let sent = null;
    const A = mk({ fetch: (url, params) => {
      sent = { url, params };
      return { code: 200, body: { items: [{ ItemCode: 'A' }, { ItemCode: 'B' }],
                                  supplierPrices: [{ ItemCode: 'A' }] } };
    } });
    A.ctx.PASTE_SYNC_TOKEN = SECRET;
    const r = A.ctx.saveSyncToken();
    eq('a proved token is stored', A.props.GC_SYNC_TOKEN, SECRET);
    ok('it is sent as a bearer token', sent.params.headers.Authorization === 'Bearer ' + SECRET);
    ok('and it asks for both datasets with cost',
       /datasets=items,supplierPrices&cost=include/.test(sent.url), sent.url);
    ok('the report says what came back', /2 items and 1 supplier prices/.test(r), r);
    ok('but never the token itself', r.indexOf(SECRET) < 0);
    ok('and it insists the constant is put back', /PUT PASTE-THE-TOKEN-HERE BACK/.test(r));

    /* And afterwards, the checker notices a token left behind in the file. */
    const left = A.ctx.checkSyncToken();
    ok('a token left in the file is called out', /still holds a token/.test(left), left);
    ok('without printing it', left.indexOf(SECRET) < 0);
    A.ctx.PASTE_SYNC_TOKEN = 'PASTE-THE-TOKEN-HERE';
    const clean = A.ctx.checkSyncToken();
    ok('and once put back, the warning goes', !/still holds a token/.test(clean));
    ok('while still confirming the stored token works', /token works/.test(clean), clean);
  }
}

/* ================================= not overwriting somebody else's newer page */
/**
 * installPages checked its SOURCE thoroughly and never looked at what was
 * already live. On 5 Sep 2026 three of the four live pages turned out to have
 * been changed by another editor while this repository still held the previous
 * ones — running it would have rolled all three back without a word.
 */
group('A page somebody else changed is not overwritten');
{
  const A = load(fx.build(), { now: NOW, properties: {} });
  const name = 'index.html';
  const want = A.ctx.PAGE_FINGERPRINTS[name];
  const setLive = t => { A.folder._written[name] = t; };
  const live = () => A.folder._written[name];

  /* First install: no record exists, so it writes and says what it replaced. */
  setLive('<title>something older</title>');
  const first = A.ctx.installPages();
  eq('with no record it still installs', live(), A.ctx.PAGE_DATA[name]);
  ok('and prints the md5 it replaced, so the change is recoverable',
     /had no record from this project; replacing [0-9a-f]{32}/.test(first), first.slice(0, 400));
  ok('the record is kept for next time', !!A.props['GC_PAGE_MD5_index_html']);

  /* Somebody else edits the live page. */
  setLive('<title>somebody else improved this</title>');
  /* And this project moves on to a different intended version. */
  const older = A.ctx.PAGE_DATA[name];
  A.ctx.PAGE_DATA[name] = '<title>this project\'s older copy</title>';
  A.ctx.PAGE_FINGERPRINTS[name] = { md5: '00000000000000000000000000000000', size: 1 };

  const second = A.ctx.installPages();
  eq('their page is left exactly as they left it',
     live(), '<title>somebody else improved this</title>');
  ok('and the run says so rather than reporting success',
     /KEPT     index\.html/.test(second), second.slice(0, 600));
  ok('naming what this project had left there', /this project last left/.test(second));
  ok('and how to keep it', /regenerate PagesData\.gs from the live file/.test(second));
  ok('the summary counts it', /left alone because somebody else changed them/.test(second));

  /* The override exists, is explicit, and says it was used. */
  A.ctx.PAGE_DATA[name] = older;
  A.ctx.PAGE_FINGERPRINTS[name] = want;
  const forced = A.ctx.installPages(true);
  ok('forcing is marked as forced', /\(FORCED\)/.test(forced));
  eq('and does replace it', live(), older);
}

group('The four pages are the tested copies');
for (const [name, want] of Object.entries(ctx.PAGE_FINGERPRINTS)) {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'pages', name));
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  ok(name + ' matches its fingerprint',
     md5 === want.md5 && buf.length === want.size,
     buf.length + ' bytes, md5 ' + md5);
}

/* ------------------------------------------------------------------ report */
const w = Math.max(...results.map(r => r[1].length)) + 2;
for (const [tag, name, detail] of results) {
  if (tag === '--') console.log('\n\x1b[1m' + name + '\x1b[0m');
  else if (tag === '') continue;
  else console.log('  ' + (tag === 'ok' ? '\x1b[32mok  \x1b[0m' : '\x1b[31mFAIL\x1b[0m') +
                   '  ' + name.padEnd(w) + detail);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
