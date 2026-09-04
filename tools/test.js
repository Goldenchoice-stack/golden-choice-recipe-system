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
