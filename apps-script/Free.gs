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
 * The rows it fills are stamped with a Source, so the AutoCount refresh treats
 * them as owned and never overwrites them either.
 */

/* Exact names only, compared case- and space-insensitively. */
var FREE_NAMES = [
  'water', 'hot water', 'warm water', 'cold water', 'iced water', 'ice water',
  'plain water', 'tap water', 'filtered water', 'drinking water', 'boiled water',
  'ice', 'ice cube', 'ice cubes', 'cubed ice', 'crushed ice',

  /* Two the first run refused and reported, added on the owner's decision
     5 Sep 2026. Both are plain water and plain ice with a working note stuck to
     the name — a temperature, and a quantity split — rather than a different
     ingredient. They needed a person because a rule cannot tell a note from a
     product name, which is the same reason "Water Chestnut Popping Boba" is
     still not on this list.

     Both spellings of the ice one are here because the space after the plus is
     the sort of thing that changes when somebody retypes a cell, and being
     wrong about it would silently leave the row unpriced. */
  'water 55c', 'ice (280+ 100)', 'ice (280+100)'
];

var FREE_SOURCE = 'Owner (free)';

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
  var filled = [], noted = [], already = [], skipped = [], unblocked = 0;

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
        already.push('  ' + name + '  already ' + vals[i][1] + ' / ' + vals[i][2]);
        continue;
      }
      sh.getRange(i + 2, 2).setValue(0);
      sh.getRange(i + 2, 3).setValue(1);
      sh.getRange(i + 2, AC_SOURCE_COL).setValue(FREE_SOURCE);
      sh.getRange(i + 2, 9).setValue('Free. 0 over 1 means free; blank would mean unpriced.');
      (byName ? filled : noted).push('  ' + name + '  (' + n + ' recipes)');
      unblocked += n;
      continue;
    }

    if (WORD.test(norm)) skipped.push('  ' + name + '  (' + n + ' recipes)');
  }

  var msg = 'FREE INGREDIENTS PRICED\n\n' +
    (filled.length ? 'SET TO 0 PER 1 UNIT\n' + filled.join('\n') + '\n\n'
                   : 'Nothing matched a free name.\n\n') +
    (noted.length ? 'ALSO SET TO 0 — a free word with nothing but a measurement after it\n' +
                    noted.join('\n') + '\n\n' : '') +
    (already.length ? 'ALREADY PRICED, LEFT ALONE\n' + already.join('\n') + '\n\n' : '') +
    'NOT TOUCHED — has "water" or "ice" in the name but is a purchased product,\n' +
    'so a person has to price it:\n' +
    (skipped.length ? skipped.join('\n') : '  none') + '\n\n' +
    (filled.length + noted.length) + ' ingredient(s) priced, between them used by ' + unblocked +
    ' recipe-slots.\n' +
    'That does not cost a drink on its own — a recipe still needs every one of its\n' +
    'lines priced — but it removes the commonest reason one cannot be.';
  Logger.log(msg);
  return msg;
}
