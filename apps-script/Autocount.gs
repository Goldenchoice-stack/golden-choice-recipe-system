/**
 * Golden Choice — filling the Prices tab from AutoCount.
 *
 * The `Prices` tab is what turns costing on, and typing 472 ingredients into it
 * by hand is the reason it is still empty. This fills in what it can prove and
 * proposes the rest, so the job becomes checking a list rather than writing one.
 *
 * -------------------------------------------------------------------------
 * IT DOES NOT TALK TO AUTOCOUNT. There is exactly one path out of that
 * database and this is not a second one: a SELECT-only login on the office
 * Windows PC pushes a snapshot to the central sync server, and every consumer
 * reads that snapshot. This is another consumer, the same as the Procurement
 * System. Nothing here connects to SQL Server, and nothing anywhere in this
 * project writes to AutoCount.
 * -------------------------------------------------------------------------
 *
 * WHAT IT DOES, AND WHY IT IS NOT AN AUTOMATIC MATCHER
 *
 * It was built to match names automatically and then measured against the real
 * catalogue, where the idea failed honestly: "Milk" appears in 56 priced items,
 * "Ice" in 40, and "Matcha Powder" in ten — a RM27 tub of premium powder and a
 * RM71 frappé base among them. Nothing in the text says which one R&D meant.
 * A scorer would have picked one and been wrong roughly as often as right,
 * which is the one outcome this system is built never to produce.
 *
 * So it does the half a machine can do, and asks for the half only a person can:
 *
 *   1. Run it. Every ingredient gets a SHORTLIST of real AutoCount items, each
 *      with its code, its purchase price, its pack size read off its own name,
 *      and the cost per ML or per gram already worked out.
 *   2. Read the shortlist and put the right item code in column D. That is the
 *      only judgement in the whole job, and only somebody who knows the drink
 *      can make it.
 *   3. Run it again. Every row that now carries a code is priced exactly, from
 *      that code, and stays priced on every run after.
 *
 * It fills a row in by itself only when exactly one item in the whole catalogue
 * contains every word of the ingredient's name AND its pack size is on its own
 * name AND that pack's unit is the unit the recipe measures in. That is rare
 * and it is meant to be. Everything else waits for step 2, and the recipe goes
 * on saying "Needs costing" rather than quietly acquiring a number nobody
 * checked.
 *
 * It never overwrites a person. A row whose Source column does not say
 * AUTOCOUNT is left exactly as it is, prices and all.
 *
 * SETUP, ONCE. The sync server's address and read token are kept in Script
 * Properties, never in this file — this repository is public.
 *
 *   Extensions -> Apps Script -> Project Settings -> Script Properties
 *     GC_SYNC_URL     https://…/api/v1/procurement/latest
 *     GC_SYNC_TOKEN   the dashboard read token
 *
 * Then: R&D Tools -> Update prices from AutoCount.
 *
 * Adding this file widens the project's OAuth scopes by one — external
 * requests — so Google will ask you to authorise the script again the first
 * time. That is Google re-checking your own script. Fixer.gs's header says this
 * project uses no UrlFetchApp; from here that is true of Fixer.gs, not of the
 * project. Nothing in the web app calls anything in this file: it is reachable
 * only from the menu, by somebody who can already open the spreadsheet.
 */

var AC_PROP_URL   = 'GC_SYNC_URL';
var AC_PROP_TOKEN = 'GC_SYNC_TOKEN';

/* Columns A-D are the contract prices_() reads, by position. Everything from E
   is ours: the README says nothing reads past D, which is what makes it safe to
   keep the workings beside the answer. */
var AC_HEAD = ['Ingredient', 'Pack Cost (RM)', 'Units Per Pack', 'AutoCount Item Code',
               'Recipe UOM', 'Source', 'Matched item', 'Pack size read as',
               'Why not filled', 'Other candidates', 'Updated'];
var AC_SOURCE_COL = 6;          /* F, 1-based */
var AC_SOURCE = 'AUTOCOUNT';

/* --------------------------------------------------------------- the words */

/* Pack sizes, brand noise and the unit words themselves carry no information
   about WHICH ingredient this is, and leaving them in makes "MILK 1KG" look
   more like "SUGAR 1KG" than like "MILK". */
var AC_NOISE = {
  PKT: 1, PKTS: 1, BTL: 1, BTLS: 1, CTN: 1, CTNS: 1, TIN: 1, TINS: 1, PC: 1, PCS: 1,
  BOX: 1, BOXES: 1, TUB: 1, TUBS: 1, CAN: 1, CANS: 1, PACK: 1, PACKET: 1, BAG: 1,
  SET: 1, ROLL: 1, UNIT: 1, SACHET: 1, SACHETS: 1, JAR: 1, BUNDLE: 1,
  NEW: 1, OLD: 1, PROMO: 1, FOC: 1, FREE: 1, HALAL: 1, IMPORTED: 1, ORIGINAL: 1
};

function acNorm_(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/* A number with a unit stuck to it — 500G, 1.5 L, 6X250ML — is a pack size
   rather than a word, and is taken out before the names are compared. */
var AC_SIZE_ANY = /(?:\d+\s*[X*]\s*)?\d+(?:\.\d+)?\s*(?:KG|KGS|G|GM|GRAM|GRAMS|L|LTR|LITRE|LITER|ML|CL)(?![A-Z])/g;

function acWords_(s) {
  var t = String(s == null ? '' : s).toUpperCase().replace(AC_SIZE_ANY, ' ');
  t = t.replace(/[^A-Z0-9]+/g, ' ').trim();
  if (!t) return [];
  var raw = t.split(' '), out = [], seen = {};
  for (var i = 0; i < raw.length; i++) {
    var w = raw[i];
    /* A bare number left after the sizes have gone is a model or a year, not a
       name. A single letter is never enough to match on. */
    if (!w || w.length < 2 || AC_NOISE[w] || /^\d+$/.test(w)) continue;
    if (seen[w]) continue;
    seen[w] = 1;
    out.push(w);
  }
  return out;
}

/* ---------------------------------------------------------- the pack size */

/* How many of one unit are in another. Only the conversions that are exact:
   there is no gram-to-millilitre here, because that is a density and depends on
   what the ingredient is. */
var AC_UNIT = {
  KG: { base: 'G',  per: 1000 }, KGS:  { base: 'G',  per: 1000 },
  G:  { base: 'G',  per: 1 },    GM:   { base: 'G',  per: 1 },
  GRAM: { base: 'G', per: 1 },   GRAMS:{ base: 'G',  per: 1 },
  L:  { base: 'ML', per: 1000 }, LTR:  { base: 'ML', per: 1000 },
  LITRE: { base: 'ML', per: 1000 }, LITER: { base: 'ML', per: 1000 },
  ML: { base: 'ML', per: 1 },    CL:   { base: 'ML', per: 10 }
};

var AC_MULT = /(\d+)\s*[X*]\s*(\d+(?:\.\d+)?)\s*(KG|KGS|G|GM|GRAM|GRAMS|L|LTR|LITRE|LITER|ML|CL)(?![A-Z])/i;
var AC_ONE  = /(?:^|[^A-Z0-9.])(\d+(?:\.\d+)?)\s*(KG|KGS|G|GM|GRAM|GRAMS|L|LTR|LITRE|LITER|ML|CL)(?![A-Z])/i;

/**
 * The pack size, read out of the item's own name. AutoCount buys in PKT, BTL
 * and TIN and records no contents, so "LAVAZZA GRAN ESPRESSO COFFEE BEAN 1KG"
 * is the only place the sheet can learn that one packet is 1000 grams.
 *
 * Returns { qty, unit, text } in G or ML, or null when the name does not say.
 */
function acPackSize_(desc) {
  var s = String(desc == null ? '' : desc).toUpperCase(), m;
  if ((m = AC_MULT.exec(s))) {
    var u = AC_UNIT[m[3].toUpperCase()];
    return { qty: Number(m[1]) * Number(m[2]) * u.per, unit: u.base,
             text: m[1] + ' x ' + m[2] + ' ' + m[3].toUpperCase() };
  }
  if ((m = AC_ONE.exec(s))) {
    var v = AC_UNIT[m[2].toUpperCase()];
    return { qty: Number(m[1]) * v.per, unit: v.base, text: m[1] + ' ' + m[2].toUpperCase() };
  }
  return null;
}

/* The recipe's own unit for an ingredient, and whether a pack read in G can
   price a line measured in ML. It cannot: that conversion is a density. */
function acSameUnit_(recipeUom, packUnit) {
  var r = acNorm_(recipeUom);
  var known = AC_UNIT[r];
  return !!(known && known.base === packUnit);
}

/* --------------------------------------------------------------- matching */

/**
 * One ingredient against the whole catalogue.
 *
 * The rule for filling a price in is deliberately strict: every word of the
 * ingredient name has to appear in the item description, and exactly one item
 * may satisfy that. "Condensed Milk" inside "GOLD COIN CONDENSED MILK 500G" is
 * a match; "Milk" on its own is not, because forty items contain the word, and
 * picking the highest-scoring one would be a guess wearing a decimal point.
 *
 * Everything that does not clear the bar still comes back, as candidates, so
 * the person deciding sees the same shortlist the matcher saw.
 */
function acMatch_(name, catalogue) {
  var want = acWords_(name);
  if (!want.length) return { full: [], near: [] };

  var full = [], near = [];
  for (var i = 0; i < catalogue.length; i++) {
    var item = catalogue[i], have = item.words, hit = 0;
    for (var w = 0; w < want.length; w++) if (have[want[w]]) hit++;
    if (!hit) continue;
    var entry = { item: item, hit: hit, score: hit / want.length, extra: item.count - hit };
    if (hit === want.length) full.push(entry);
    /* A near miss has to share MORE than half the words. One word in common is
       not a resemblance when the word is "BASE" or "TEA": offering "SUPIN DARK
       OOLONG TEA BASE 1L" for "Kopi Base" wastes the reader's attention and
       makes the honest answer — AutoCount does not stock this — harder to see. */
    else if (entry.score > 0.5) near.push(entry);
  }
  /* Of the items that match equally well, the most useful to a person choosing
     is the one that can actually be priced — a pack size on its own name — and
     then the one padded with the fewest extra words: "MATCHA POWDER 200G" over
     "MONIN FRAPPE MATCHA GREEN TEA BASE 1.0KG". */
  var rank = function (a, b) {
    return b.hit - a.hit ||
           ((b.item.pack ? 1 : 0) - (a.item.pack ? 1 : 0)) ||
           a.extra - b.extra ||
           (a.item.code < b.item.code ? -1 : a.item.code > b.item.code ? 1 : 0);
  };
  full.sort(rank);
  near.sort(rank);
  return { full: full, near: near };
}

/**
 * The shortlist, as a person reads it. Each line is the code to paste, what it
 * costs, and what that works out to per unit — the arithmetic done, so the
 * choice is about which ingredient this is and nothing else.
 *
 * The catalogue carries near-duplicates that differ only by a suffix on the
 * code, so an entry whose description and price have both been seen already is
 * dropped: three spellings of one tub are noise, not choice.
 */
function acShortlist_(entries, howMany) {
  var seen = {}, out = [];
  for (var i = 0; i < entries.length && out.length < howMany; i++) {
    var it = entries[i].item, k = key_(it.desc) + '~' + it.price;
    if (seen[k]) continue;
    seen[k] = 1;
    out.push(it.code + '  =  RM' + it.price +
      (it.pack ? ' / ' + it.pack.qty + ' ' + it.pack.unit +
                 '  (RM' + (it.price / it.pack.qty).toFixed(5) + ' per ' + it.pack.unit + ')'
                : '  (pack size not on the name)') +
      '  —  ' + it.desc);
  }
  return out.join('\n');
}

/* Prepared once for the whole run, because it is walked for every ingredient. */
function acCatalogue_(items, prices) {
  var priceOf = {};
  for (var p = 0; p < prices.length; p++) priceOf[prices[p].ItemCode] = prices[p];

  var out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i], pr = priceOf[it.ItemCode];
    /* An item nobody has a purchase price for cannot price a recipe line, and
       an inactive one should not start doing so now. */
    if (!pr || !(Number(pr.UnitPrice) > 0)) continue;
    if (String(it.IsActive || 'T').toUpperCase() === 'F') continue;
    var words = acWords_(it.ItemDescription), map = {};
    for (var w = 0; w < words.length; w++) map[words[w]] = 1;
    out.push({ code: it.ItemCode, desc: it.ItemDescription, uom: pr.UOM || it.BaseUOM,
               price: Number(pr.UnitPrice), pack: acPackSize_(it.ItemDescription),
               words: map, count: words.length });
  }
  return out;
}

/* ------------------------------------------------------------- the ingredients */

/* Every ingredient the log uses, with the unit it is measured in and how many
   recipes want it. The first spelling wins, the same way the intake's picker
   does it, so Milk and MILK stay one ingredient. */
function acIngredients_() {
  var L = LOGCOLS_(), rows = rows_(GID.log), seen = {}, out = [];
  for (var i = 0; i < rows.length; i++) {
    var n = cell_(rows[i], L.ing);
    if (!n) continue;
    var k = key_(n);
    if (!seen[k]) { seen[k] = { name: n, uom: '', uses: 0 }; out.push(seen[k]); }
    seen[k].uses++;
    if (!seen[k].uom) seen[k].uom = cell_(rows[i], L.uom);
  }
  out.sort(function (a, b) { return b.uses - a.uses || (key_(a.name) < key_(b.name) ? -1 : 1); });
  return out;
}

/* ------------------------------------------------------------------ the run */

function acSnapshot_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty(AC_PROP_URL) || '').trim();
  var token = String(props.getProperty(AC_PROP_TOKEN) || '').trim();
  if (!url || !token)
    throw new Error('Set ' + AC_PROP_URL + ' and ' + AC_PROP_TOKEN + ' in Project Settings ' +
                    '-> Script Properties first. Nothing was changed.');

  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  var res = UrlFetchApp.fetch(url + sep + 'datasets=items,supplierPrices&cost=include', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
    followRedirects: false
  });
  var code = res.getResponseCode();
  if (code !== 200)
    throw new Error('The sync server answered ' + code + '. Nothing was changed.');

  var body = JSON.parse(res.getContentText());
  if (!body.items || !body.supplierPrices)
    throw new Error('That snapshot carries no items or no prices — ask for them with ' +
                    'datasets=items,supplierPrices&cost=include. Nothing was changed.');
  return body;
}

/**
 * Fills the Prices tab. Returns the sentence the menu shows.
 *
 * Rows already in the tab are read first, and any row a person owns is put back
 * untouched. Only rows this ever wrote are refreshed, so a price corrected by
 * hand survives every future run — which is the property that makes running it
 * again safe enough to be worth doing.
 */
function acFill_(dryRun) {
  var snap = acSnapshot_();
  var catalogue = acCatalogue_(snap.items, snap.supplierPrices);
  var ings = acIngredients_();
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(PRICES_TAB);
  /* A dry run creates nothing either. An empty tab left behind by a preview
     would be a change, and a preview that changes something is not a preview. */
  if (!sh) {
    if (dryRun) return { report: 'There is no ' + PRICES_TAB + ' tab yet, so there is ' +
                                 'nothing to compare against. Run seedPrices() first.',
                         counts: {}, ingredients: ings.length };
    sh = ss.insertSheet(PRICES_TAB);
  }

  /* What is there now, by ingredient. */
  var had = {};
  if (sh.getLastRow() > 1 && sh.getLastColumn() > 0) {
    var old = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), AC_HEAD.length)).getValues();
    for (var o = 0; o < old.length; o++) {
      var on = S_(old[o][0]);
      if (on) had[key_(on)] = old[o];
    }
  }

  var byCode = {};
  for (var c = 0; c < catalogue.length; c++) byCode[key_(catalogue[c].code)] = catalogue[c];

  var today = today_(), rows = [];
  var n = { chosen: 0, matched: 0, waiting: 0, blocked: 0, none: 0, kept: 0 };

  for (var i = 0; i < ings.length; i++) {
    var ing = ings[i], prev = had[key_(ing.name)];
    var was = prev ? S_(prev[AC_SOURCE_COL - 1]) : '';

    /* A row somebody owns is theirs. Not re-matched, not re-priced, not moved. */
    if (was && was !== AC_SOURCE) {
      var keep = prev.slice(0, AC_HEAD.length);
      while (keep.length < AC_HEAD.length) keep.push('');
      rows.push(keep);
      n.kept++;
      continue;
    }

    var row = [ing.name, '', '', '', ing.uom, '', '', '', '', '', today];
    /* A code already in column D is a decision somebody made on a previous run,
       and it is the whole point of the exercise. It is honoured before any
       matching is attempted -- their choice beats the machine's shortlist. */
    var picked = prev ? S_(prev[3]) : '';
    var item = picked ? byCode[key_(picked)] : null;

    if (picked && !item) {
      row[3] = picked;
      row[8] = 'No active, priced item in AutoCount has the code ' + picked + '. ' +
               'Check it, or clear column D to see the shortlist again.';
      n.blocked++;
      rows.push(row);
      continue;
    }

    var how = '';
    if (!item) {
      var m = acMatch_(ing.name, catalogue);
      if (m.full.length === 1) { item = m.full[0].item; how = 'matched'; }
      else {
        /* No unique answer, so no answer. The shortlist goes in instead. */
        row[9] = acShortlist_(m.full.length ? m.full : m.near, 6);
        row[8] = m.full.length > 1
          ? m.full.length + ' items contain every word of this name — too many to choose ' +
            'between. Put the right code in column D and run this again.'
          : m.near.length
            ? 'No item contains every word of this name. Nearest are below — put the ' +
              'right code in column D and run this again.'
            : '';
        if (!row[9]) {
          row[8] = 'Nothing in AutoCount resembles this. It is either made in-house or ' +
                   'bought under a name that reads differently there — find it yourself ' +
                   'and put the code in D, or price it by hand and put your name in Source.';
          n.none++;
        } else n.waiting++;
        rows.push(row);
        continue;
      }
    } else how = 'chosen';

    row[3] = item.code;
    row[6] = item.desc;
    if (!item.pack) {
      row[8] = 'The item name does not say how much is in one ' + (item.uom || 'pack') +
               ', so cost per unit cannot be worked out. Put the pack size in column C ' +
               'by hand and your name in Source.';
      n.blocked++;
    } else if (!acSameUnit_(ing.uom, item.pack.unit)) {
      row[7] = item.pack.text;
      row[8] = 'The pack is measured in ' + item.pack.unit + ' and the recipe in ' +
               (ing.uom || 'nothing recorded') + '. Converting between them is a density, ' +
               'not arithmetic, so it is left for a person.';
      n.blocked++;
    } else {
      row[1] = item.price;
      row[2] = item.pack.qty;
      row[5] = AC_SOURCE;
      row[7] = item.pack.text;
      if (how === 'chosen') n.chosen++; else n.matched++;
    }
    rows.push(row);
  }

  /* An ingredient can leave the log — renamed, or its last recipe rejected —
     and the row would then simply not be rebuilt. Somebody's typed price would
     go with it, silently, which is the worst way to lose work. Anything a
     person owns is carried to the end instead, and says why it is there. */
  var live = {};
  for (var s = 0; s < ings.length; s++) live[key_(ings[s].name)] = 1;
  for (var k in had) {
    if (!had.hasOwnProperty(k) || live[k]) continue;
    var orphan = had[k], owner = S_(orphan[AC_SOURCE_COL - 1]);
    if (!owner || owner === AC_SOURCE) continue;      /* ours to rebuild; theirs to keep */
    var row2 = orphan.slice(0, AC_HEAD.length);
    while (row2.length < AC_HEAD.length) row2.push('');
    row2[8] = 'No recipe in the log uses this any more. Kept because you priced it.';
    rows.push(row2);
    n.orphan = (n.orphan || 0) + 1;
  }

  /* Everything above only read and worked out. This is the only part that
     changes the sheet, and it is the whole tab at once — so a preview that
     skips exactly this block predicts the real run exactly, by construction. */
  if (!dryRun) {
    sh.clear();
    sh.getRange(1, 1, 1, AC_HEAD.length).setValues([AC_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (rows.length) {
      sh.getRange(2, 1, rows.length, AC_HEAD.length).setValues(rows);
      /* The shortlist is several lines in one cell and is the column people
         actually read, so it is given room rather than clipped to a sliver. */
      sh.getRange(2, 10, rows.length, 1).setWrap(true);
      sh.setColumnWidth(10, 420);
    }
  }

  /* The report says only what it can tell. Once a code sits in column D there
     is no way to know whether a person put it there or a previous run did, so
     it does not claim to know. */
  var priced = n.chosen + n.matched;
  var is = function (k, one, many) { return k + (k === 1 ? ' ' + one : ' ' + many); };
  return { report: 'Prices from AutoCount, ' + today +
      (dryRun ? ' — DRY RUN, THE PRICES TAB HAS NOT BEEN TOUCHED' : '') + '.\n\n' +
      is(ings.length, 'ingredient', 'ingredients') + ' in the R&D Log.\n\n' +
      is(priced, 'is', 'are') + ' priced from an item code' +
        (n.matched ? ', ' + n.matched + ' of which ' + (n.matched === 1 ? 'was' : 'were') +
                     ' matched just now because only one item in the catalogue could have ' +
                     'been meant.' : '.') + '\n' +
      is(n.waiting, 'is', 'are') + ' waiting on you: column J lists real items with their ' +
      'price and cost per unit. Put the right code in column D and run this again.\n' +
      is(n.blocked, 'has', 'have') + ' a code but still cannot be priced; column I says why.\n' +
      is(n.none, 'looks', 'look') + ' like nothing in AutoCount — probably made in-house.\n' +
      is(n.kept, 'was', 'were') + ' left exactly as ' + (n.kept === 1 ? 'it was' : 'they were') +
      ', because somebody owns ' + (n.kept === 1 ? 'it' : 'them') + '.\n' +
      (n.orphan ? is(n.orphan, 'row is', 'rows are') + ' no longer used by any recipe, and ' +
                  (n.orphan === 1 ? 'was' : 'were') + ' kept at the bottom rather than ' +
                  'thrown away.\n' : '') + '\n' +
      'Nothing here was priced on a guess. Price a row by hand and put your name in ' +
      'Source, and no future run will touch it.' +
      (dryRun ? '\n\nNothing was written. The real run rebuilds the whole tab from these ' +
                'same numbers, keeping every row somebody owns.' : ''),
    counts: n, ingredients: ings.length, dryRun: !!dryRun };
}

/* The menu item. Everything it can go wrong with, it says out loud. */
function updatePricesFromAutocount() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  var msg;
  try { msg = acFill_().report; }
  catch (e) { msg = 'Nothing was changed.\n\n' + e.message; }
  finally { lock.releaseLock(); }
  try { SpreadsheetApp.getUi().alert('Prices from AutoCount', msg, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e2) { Logger.log(msg); }
}
