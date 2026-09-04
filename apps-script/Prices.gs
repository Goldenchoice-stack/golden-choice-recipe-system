/**
 * Golden Choice — building the Prices tab, ready to fill in.
 *
 * Costing is finished and correct, and shows nothing, because no ingredient has
 * a price. The tab that would hold them does not exist, so the work has no
 * shape: "price 441 ingredients" is not a task anybody starts.
 *
 * This gives it a shape. It creates the tab with every ingredient the library
 * actually uses, ONE ROW EACH, ordered by how many recipes are waiting on that
 * ingredient — so the top of the list is where a typed price buys the most.
 * Ice, at the top, unblocks dozens of drinks; something used once is at the
 * bottom where it belongs.
 *
 * IT WRITES NO PRICES. Every Pack Cost and Units Per Pack is left empty,
 * because a seeded price is a guess and this whole system is built not to
 * guess. Nothing changes on any page until a real number is typed: a recipe
 * with no price still reads "Needs costing", exactly as it does today.
 *
 * IT NEVER TOUCHES A ROW SOMEBODY OWNS. A row whose Source column holds
 * anything is carried over untouched, price and all. Run it again after new
 * ingredients appear and it adds them without disturbing the rest.
 *
 * The columns are the ones Autocount.gs writes, so the two agree: A-D are the
 * contract prices_() reads by position, and E onward is the working.
 *
 * Water and ice want 0 and 1 — zero cost, one unit per pack — so they read as
 * free rather than as unpriced. That is the one case where a number is not a
 * guess, and it is still left to a person to type.
 */
function seedPrices() {
  var lib = library_(), ss = SpreadsheetApp.getActive();

  /* How many recipes each ingredient is holding up, and the unit it is measured
     in. A recipe counts once for an ingredient however many times it lists it. */
  var use = {}, order = [];
  for (var i = 0; i < lib.length; i++) {
    var seen = {};
    for (var j = 0; j < lib[i].ing.length; j++) {
      var n = lib[i].ing[j].n;
      if (!n || seen[key_(n)]) continue;
      seen[key_(n)] = 1;
      if (!use[key_(n)]) { use[key_(n)] = { name: n, uom: lib[i].ing[j].u || '', n: 0 }; order.push(key_(n)); }
      use[key_(n)].n++;
      if (!use[key_(n)].uom) use[key_(n)].uom = lib[i].ing[j].u || '';
    }
  }
  order.sort(function (a, b) {
    return use[b].n - use[a].n || (use[a].name < use[b].name ? -1 : 1); });

  /* Whatever is already there, so nothing anybody typed is lost. */
  var sh = ss.getSheetByName(PRICES_TAB), had = {}, kept = 0;
  if (sh && sh.getLastRow() > 1) {
    var wide = Math.max(sh.getLastColumn(), AC_HEAD.length);
    var old = sh.getRange(2, 1, sh.getLastRow() - 1, wide).getValues();
    for (i = 0; i < old.length; i++) {
      var on = S_(old[i][0]);
      if (on) had[key_(on)] = old[i];
    }
  }
  if (!sh) sh = ss.insertSheet(PRICES_TAB);

  var today = today_(), rows = [], added = 0;
  for (i = 0; i < order.length; i++) {
    var u = use[order[i]], prev = had[order[i]];
    if (prev && S_(prev[AC_SOURCE_COL - 1])) {          /* somebody owns it */
      var keep = prev.slice(0, AC_HEAD.length);
      while (keep.length < AC_HEAD.length) keep.push('');
      rows.push(keep); kept++;
      continue;
    }
    rows.push([u.name, '', '', '', u.uom, '', '', '',
               u.n + ' recipe' + (u.n === 1 ? '' : 's') + ' waiting on this price',
               '', today]);
    added++;
  }

  sh.clear();
  sh.getRange(1, 1, 1, AC_HEAD.length).setValues([AC_HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, AC_HEAD.length).setValues(rows);
  sh.setColumnWidth(1, 280);
  sh.setColumnWidth(9, 260);

  var top = [];
  for (i = 0; i < Math.min(order.length, 10); i++)
    top.push('    ' + use[order[i]].name + '  (' + use[order[i]].n + ')');

  var msg = 'THE ' + PRICES_TAB + ' TAB IS READY\n\n' +
    '  ' + rows.length + ' ingredients, one row each, most-blocking first.\n' +
    '  ' + added + ' seeded empty, ' + kept + ' left exactly as somebody had them.\n\n' +
    '  Worth pricing first:\n' + top.join('\n') + '\n\n' +
    'No price was written. Type Pack Cost (RM) in column B and Units Per Pack in\n' +
    'column C, and that ingredient starts costing every recipe that uses it —\n' +
    'nothing to deploy, nothing to run. A 1 L syrup poured in ML is 1000 per pack.\n' +
    'Water and ice want 0 and 1, so they read as free rather than as unpriced.\n\n' +
    'Nothing on any page has changed yet: with no prices filled in, every recipe\n' +
    'still reads "Needs costing", which is what it should say.';
  Logger.log(msg);
  return msg;
}
