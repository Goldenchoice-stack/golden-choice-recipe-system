/**
 * Golden Choice — pricing the ingredients that genuinely cost nothing.
 *
 * Water and ice are free, so they want a Pack Cost of 0 over 1 unit per pack.
 * That is not the same as leaving them blank: blank means "nobody has priced
 * this yet" and stops the whole recipe costing, while 0 over 1 means "this is
 * free" and lets the rest of the drink add up. The distinction is the whole
 * reason costing can say "needs a price for X" instead of shrugging.
 *
 * MATCHING IS BY EXACT NAME, NEVER BY SUBSTRING, and that is not fussiness.
 * "Ice" is inside "Juice", "Snow Ice" and "Ice Cream"; "Water" is inside "Soda
 * Water", "Sparkling Water" and "Coconut Water". Every one of those is a
 * purchased product with a real cost, and zeroing one would quietly understate
 * every drink that uses it — the exact failure this system is built to avoid.
 * So only the names below are touched, and every other ingredient with "water"
 * or "ice" as a word in it is listed in the report, unpriced, for a person.
 *
 * It never overwrites. A row that already carries a Pack Cost is left alone.
 * The rows it fills are stamped with a Source, because acFill_ re-prices any row
 * nobody owns — an unstamped 0 would quietly become a purchase price at the next
 * AutoCount refresh. For the same reason it completes the stamp on a row that
 * already reads exactly 0 over 1 but carries no Source. That is not a repricing:
 * columns B and C are never touched, and the report says which rows it marked.
 */

/* Exact names only, compared case- and space-insensitively. */
var FREE_NAMES = [
  'water', 'hot water', 'warm water', 'cold water', 'iced water', 'ice water',
  'plain water', 'tap water', 'filtered water', 'drinking water', 'boiled water',
  'ice', 'ice cube', 'ice cubes', 'cubed ice', 'crushed ice'

  /* "Water 55c" and "Ice (280+ 100)" are NOT listed here, though the owner
     approved both on 5 Sep 2026. freeAnnotated_ already accepts them, and
     listing them as well would report them as list matches and hide the fact
     that a rule caught them — which is the thing worth knowing, because the
     rule will catch the next one written that way and the list would not. */
];

var FREE_SOURCE = 'Owner (free)';
var FREE_NOTE = 'Free. 0 over 1 means free; blank would mean unpriced.';

/**
 * A name that is a free word followed by NOTHING BUT A MEASUREMENT is the same
 * free thing with a note written after it: "Water 55c", "Ice (280+ 100)".
 * A name that carries another WORD is a different product, however it starts —
 * "Water Chestnut Popping Boba 900G" and "Ice Cream" both begin with a free
 * word and neither is free.
 *
 * So: strip the numbers and marks, then strip the unit words, and require that
 * nothing alphabetic survives. Numbers go first, because "55c" has no word
 * boundary between the 5 and the c and the unit would not match otherwise.
 */
function freeAnnotated_(norm) {
  var m = /^(water|ice)\b([\s\S]*)$/.exec(norm);
  if (!m || !m[2].replace(/\s+/g, '')) return false;   /* plain name: the list has it */
  var rest = m[2]
    .replace(/[0-9+\-.,;:()\[\]\/°%*x]/g, ' ')
    .replace(/\b(cc|ml|l|g|kg|c|deg|degrees?|pc|pcs)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return rest === '';
}

function priceFreeIngredients() {
  var sh = SpreadsheetApp.getActive().getSheetByName(PRICES_TAB);
  if (!sh) return 'There is no ' + PRICES_TAB + ' tab yet. Run seedPrices() first. ' +
                  'Nothing was changed.';
  var last = sh.getLastRow();
  if (last < 2) return 'The ' + PRICES_TAB + ' tab is empty. Nothing was changed.';

  var free = {}, i;
  for (i = 0; i < FREE_NAMES.length; i++) free[FREE_NAMES[i]] = 1;

  /* How many recipes each ingredient is holding up, so the report can say what
     this actually bought. */
  var lib = library_(), waits = {};
  for (i = 0; i < lib.length; i++) {
    var seen = {};
    for (var j = 0; j < lib[i].ing.length; j++) {
      var k = key_(lib[i].ing[j].n);
      if (!k || seen[k]) continue;
      seen[k] = 1;
      waits[k] = (waits[k] || 0) + 1;
    }
  }

  var wide = Math.max(sh.getLastColumn(), AC_HEAD.length);
  var vals = sh.getRange(2, 1, last - 1, wide).getValues();
  var filled = [], noted = [], already = [], stamped = [], skipped = [], unblocked = 0;

  /* "water" or "ice" as a whole word, for the report only. */
  var WORD = /(^|[^a-z])(water|ice)([^a-z]|$)/;

  for (i = 0; i < vals.length; i++) {
    var name = S_(vals[i][0]);
    if (!name) continue;
    var norm = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
    var n = waits[key_(name)] || 0;

    var byName = !!free[norm], byNote = !byName && freeAnnotated_(norm);
    if (byName || byNote) {
      if (vals[i][1] !== '' && vals[i][1] !== null) {
        /* Already priced, so the number is not ours to change. But a free row
           with a blank Source is not PROTECTED: acFill_ leaves alone only rows
           somebody owns, so the next AutoCount refresh would re-match this one
           and the 0 would quietly become a purchase price. Completing the mark
           is not a repricing — columns B and C are never touched, and it only
           happens on a row that already reads exactly 0 over 1. */
        if (Number(vals[i][1]) === 0 && Number(vals[i][2]) === 1 &&
            !S_(vals[i][AC_SOURCE_COL - 1])) {
          sh.getRange(i + 2, AC_SOURCE_COL).setValue(FREE_SOURCE);
          sh.getRange(i + 2, 9).setValue(FREE_NOTE);
          stamped.push('  ' + name + '  0 / 1, now marked "' + FREE_SOURCE + '"');
          continue;
        }
        already.push('  ' + name + '  already ' + vals[i][1] + ' / ' + vals[i][2] +
                     '  (' + (S_(vals[i][AC_SOURCE_COL - 1]) || 'no source') + ')');
        continue;
      }
      sh.getRange(i + 2, 2).setValue(0);
      sh.getRange(i + 2, 3).setValue(1);
      sh.getRange(i + 2, AC_SOURCE_COL).setValue(FREE_SOURCE);
      sh.getRange(i + 2, 9).setValue(FREE_NOTE);
      (byName ? filled : noted).push('  ' + name + '  (' + n + ' recipes)');
      unblocked += n;
      continue;
    }

    if (WORD.test(norm)) skipped.push('  ' + name + '  (' + n + ' recipes)');
  }

  var msg = 'FREE INGREDIENTS PRICED\n\n' +
    (filled.length ? 'SET TO 0 PER 1 UNIT, BY NAME\n' + filled.join('\n') + '\n\n' : '') +
    (noted.length ? 'SET TO 0 PER 1 UNIT — a free word with nothing but a measurement after it\n' +
                    noted.join('\n') + '\n\n' : '') +
    (filled.length || noted.length ? '' : 'Nothing needed pricing this run.\n\n') +
    (stamped.length ? 'ALREADY 0 PER 1 BUT UNPROTECTED — marked, price untouched\n' +
                     stamped.join('\n') + '\n\n' : '') +
    (already.length ? 'ALREADY PRICED, LEFT ALONE\n' + already.join('\n') + '\n\n' : '') +
    'NOT TOUCHED — has "water" or "ice" in the name but is a purchased product,\n' +
    'so a person has to price it:\n' +
    (skipped.length ? skipped.join('\n') : '  none') + '\n\n' +
    (filled.length + noted.length) + ' ingredient(s) priced, between them used by ' + unblocked +
    ' recipe-slots' + (stamped.length ? '; ' + stamped.length + ' already-free row(s) marked so the ' +
    'AutoCount refresh leaves them alone' : '') + '.\n' +
    'That does not cost a drink on its own — a recipe still needs every one of its\n' +
    'lines priced — but it removes the commonest reason one cannot be.';
  Logger.log(msg);
  return msg;
}
