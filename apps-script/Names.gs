/**
 * Golden Choice — the same ingredient written two ways.
 *
 * 441 ingredients have to be priced by hand, and the price list is joined to
 * the recipes by the NAME, lower-cased and trimmed and nothing else. So
 * "Flavored Syrup Ice" and "Flavoured Syrup Ice" are two ingredients, two rows
 * to price, and — this is the expensive part — pricing one of them leaves every
 * recipe that used the other spelling still uncosted, with nothing on screen to
 * say why. That failure is silent, and it is the one worth hunting.
 *
 * IT MERGES NOTHING AND WRITES NOTHING. Deciding that two names are the same
 * product is a judgement about what the kitchen buys, and this file has no way
 * to make it: "Coconut Milk" and "Milk" share a word and are different things,
 * while "Coloryeah Coconut Water" and "COCONUT WATER" share two and probably
 * are not. So it reports, ranked by how many recipes are waiting, and a person
 * decides. Renaming, if they want it, is done in the R&D Log where the history
 * lives.
 *
 * Three findings, in falling order of certainty:
 *
 *   1  A CELL HOLDING A CHOICE  "Soda Water/ Water" is not an ingredient, it is
 *      two, and no single price can ever be right for it. Certain, and the fix
 *      is in the recipe rather than the price list.
 *   2  THE SAME WORDS           Identical once case, punctuation, pack sizes and
 *      the handful of spellings below are taken off. Near certain.
 *   3  ONE NAME INSIDE ANOTHER  "COCONUT WATER" within "Coloryeah Coconut
 *      Water" — usually a brand added or dropped, sometimes two real products.
 *      Offered as questions, never as findings.
 *
 * Run findLikeNames() from the editor.
 */

/* Only spellings actually seen in this library. A general rule for British and
   American endings would fold "flour" into "flor" and is not worth the risk. */
var NM_SPELLING = {
  FLAVOURED: 'FLAVORED', FLAVOUR: 'FLAVOR', FLAVOURS: 'FLAVOR', FLAVORS: 'FLAVOR',
  COLOUR: 'COLOR', COLOURED: 'COLORED', YOGHURT: 'YOGURT', YOGURT: 'YOGURT',
  DOUGHNUT: 'DONUT', CARAMELISED: 'CARAMELIZED', CARAMELISE: 'CARAMELIZE'
};

/* A token that says how much was bought, not what it is: 1.08KG, 900G, 500ML,
   5PCS, and the bare unit words left behind when a size was written apart. */
var NM_SIZE = /^\d+(?:\.\d+)?(?:KG|G|L|ML|CC|OZ|LB|PCS|PC|X)?$/;
var NM_UNIT = { KG: 1, G: 1, L: 1, ML: 1, CC: 1, OZ: 1, LB: 1, PC: 1, PCS: 1, X: 1 };

/* Words so common that everything contains them; a one-word name made of one
   of these sits inside forty others and asking about all forty is noise. */
var NM_COMMON = { MILK: 1, ICE: 1, WATER: 1, SUGAR: 1, TEA: 1, COFFEE: 1, SYRUP: 1,
                  JUICE: 1, POWDER: 1, CREAM: 1, SAUCE: 1, BASE: 1, JAM: 1, OIL: 1 };

/* The words of a name, with the packaging taken off. */
function nmWords_(name) {
  var raw = acNorm_(name).split(' '), out = [];
  for (var i = 0; i < raw.length; i++) {
    var w = raw[i];
    if (!w || NM_SIZE.test(w) || NM_UNIT[w] || AC_NOISE[w]) continue;
    out.push(NM_SPELLING[w] || w);
  }
  return out;
}

/* Sorted and de-duplicated, so word order and a word said twice stop mattering:
   "Flavored Syrup Ice 1.08kg - Ice Syrup" and "Flavoured Syrup Ice" both come
   out FLAVORED ICE SYRUP. */
function nmKey_(name) {
  var w = nmWords_(name), seen = {}, out = [];
  for (var i = 0; i < w.length; i++) if (!seen[w[i]]) { seen[w[i]] = 1; out.push(w[i]); }
  return out.sort().join(' ');
}

function findLikeNames() {
  var lib = library_(), table = priceTable_();
  var uses = {}, spelling = {};

  for (var i = 0; i < lib.length; i++) {
    var seen = {};
    for (var j = 0; j < lib[i].ing.length; j++) {
      var name = S_(lib[i].ing[j].n);
      if (!name) continue;
      var k = key_(name);
      if (!spelling[k]) spelling[k] = name;
      if (seen[k]) continue;                       /* one recipe counts once */
      seen[k] = 1;
      uses[k] = (uses[k] || 0) + 1;
    }
  }

  var keys = Object.keys(uses);
  function priced_(k) {
    var e = table.items[k];
    return !!(e && e.perUnit !== null);
  }
  function label_(k) {
    return spelling[k] + '  (' + uses[k] + ' recipe' + (uses[k] === 1 ? '' : 's') + ', ' +
           (priced_(k) ? 'PRICED' : 'not priced') + ')';
  }
  /* The most blocking group first, because that is the order to work in. */
  function weight_(ks) {
    var n = 0;
    for (var a = 0; a < ks.length; a++) n += uses[ks[a]];
    return n;
  }
  function byWeight_(x, y) { return weight_(y.keys) - weight_(x.keys); }

  /* --------------------------------------------- 1. a cell holding a choice */
  var choices = [];
  for (i = 0; i < keys.length; i++)
    if (/[\/]|\bor\b/i.test(spelling[keys[i]])) choices.push(keys[i]);
  choices.sort(function (a, b) { return uses[b] - uses[a]; });

  /* ------------------------------------------------------ 2. the same words */
  var groups = {}, k2;
  for (i = 0; i < keys.length; i++) {
    k2 = nmKey_(spelling[keys[i]]);
    if (!k2) continue;
    (groups[k2] = groups[k2] || []).push(keys[i]);
  }
  var same = [];
  for (var g in groups) if (groups.hasOwnProperty(g) && groups[g].length > 1)
    same.push({ keys: groups[g] });
  same.sort(byWeight_);

  /* ------------------------------------------------ 3. one name inside another */
  var words = {}, single = [];
  for (i = 0; i < keys.length; i++) {
    var w = nmWords_(spelling[keys[i]]), set = {};
    for (var q = 0; q < w.length; q++) set[w[q]] = 1;
    words[keys[i]] = { list: Object.keys(set), set: set };
  }
  for (i = 0; i < keys.length; i++) {
    var A = words[keys[i]];
    /* One word, and a common one: it is inside everything and means nothing.
       A single UNCOMMON word is kept — "Fructose" inside "Fructose Syrup 25kg"
       is exactly the pair worth asking about. */
    if (!A.list.length) continue;
    if (A.list.length === 1 && NM_COMMON[A.list[0]]) continue;
    for (var j2 = 0; j2 < keys.length; j2++) {
      if (j2 === i) continue;
      var B = words[keys[j2]];
      if (B.list.length <= A.list.length) continue;
      /* More than two words added is a different product, not a brand. */
      if (B.list.length - A.list.length > 2) continue;
      var inside = true;
      for (var m = 0; m < A.list.length; m++) if (!B.set[A.list[m]]) { inside = false; break; }
      if (!inside) continue;
      if (nmKey_(spelling[keys[i]]) === nmKey_(spelling[keys[j2]])) continue;   /* group 2 has it */
      single.push({ keys: [keys[i], keys[j2]] });
    }
  }
  single.sort(byWeight_);

  /* ------------------------------------------------------------- the report */
  var out = [], n;
  out.push('THE SAME INGREDIENT WRITTEN TWO WAYS');
  out.push('');
  out.push('Nothing here has been changed. The price list is joined to the recipes by');
  out.push('the name, so two spellings are two rows to price, and pricing one leaves');
  out.push('every recipe on the other spelling uncosted, with nothing to say why.');
  out.push('');

  out.push('1. A CELL HOLDING A CHOICE, NOT AN INGREDIENT');
  out.push('   No single price can be right for these. The fix is in the R&D Log:');
  out.push('   pick one, or split the line in two.');
  if (!choices.length) out.push('   none');
  for (i = 0; i < choices.length; i++) out.push('   ' + label_(choices[i]));
  out.push('');

  out.push('2. THE SAME WORDS ONCE CASE, PUNCTUATION AND PACK SIZE COME OFF');
  out.push('   Near certainly one ingredient. Keep the spelling that is priced.');
  if (!same.length) out.push('   none');
  for (i = 0; i < same.length; i++) {
    var ks = same[i].keys;
    out.push('   — ' + weight_(ks) + ' recipe-slots between them');
    for (n = 0; n < ks.length; n++) out.push('       ' + label_(ks[n]));
  }
  out.push('');

  out.push('3. ONE NAME MADE ENTIRELY OF WORDS FROM ANOTHER');
  out.push('   Usually a brand added or dropped. Sometimes two real products.');
  out.push('   These are questions for a person, not findings.');
  if (!single.length) out.push('   none');
  for (i = 0; i < single.length; i++)
    out.push('   ' + spelling[single[i].keys[0]] + '   inside   ' +
             spelling[single[i].keys[1]] + '   (' + uses[single[i].keys[0]] + ' and ' +
             uses[single[i].keys[1]] + ' recipes; ' +
             (priced_(single[i].keys[0]) ? 'first priced' : 'first not priced') + ', ' +
             (priced_(single[i].keys[1]) ? 'second priced' : 'second not priced') + ')');
  out.push('');

  var blocked = 0;
  for (i = 0; i < same.length; i++) blocked += weight_(same[i].keys);
  out.push(keys.length + ' distinct ingredient names across ' + lib.length + ' recipes.');
  out.push(choices.length + ' cell(s) hold a choice; ' + same.length +
           ' group(s) are the same words, covering ' + blocked + ' recipe-slots; ' +
           single.length + ' pair(s) to look at.');
  out.push('Merging any of them is a decision about what the kitchen buys, so nothing');
  out.push('was written. Rename in the R&D Log and the price list follows.');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}
