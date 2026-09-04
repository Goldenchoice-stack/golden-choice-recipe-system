/**
 * Golden Choice — removing the deploy-check recipes.
 *
 * liveCheck() writes a throwaway recipe to prove the write path. This takes it
 * back out. One function, so the editor's picker selects it on opening.
 *
 * IT MATCHES ON THE NAME, NEVER ON A ROW NUMBER. Row numbers were correct when
 * they were printed and stop being correct the moment anything else is deleted,
 * so deleting by index is how the wrong row goes. Every row it removes has to
 * carry the marker below, which no real recipe does.
 *
 * It deletes bottom-up within each tab, because deleting top-down shifts every
 * row beneath it and the second delete then lands one row high.
 *
 * It reports what it removed and what it left. If a tab holds nothing matching,
 * it says so rather than guessing.
 */

var CLEAN_MARK = 'ZZ DEPLOY CHECK';

function deleteDeployCheckRecipes() {
  var ss = SpreadsheetApp.getActive(), out = [], total = 0;

  /* Which column carries the name in each tab. SUBMISSIONS keeps the whole
     submission as JSON, so the marker is somewhere in the row rather than in a
     column of its own — scanning the row is right there and wrong everywhere
     else, where a column is the honest test. */
  var TABS = [
    { name: 'R&D Log',         col: 3,  what: 'ingredient rows' },
    { name: 'RECIPE VERSIONS', col: 3,  what: 'version rows' },
    { name: 'CHANGE LOG',      col: 0,  what: 'change rows' },
    { name: 'R&D TRIAL LOG',   col: 3,  what: 'trial rows' },
    { name: 'SUBMISSIONS',     col: 0,  what: 'queue rows' }
  ];

  for (var t = 0; t < TABS.length; t++) {
    var spec = TABS[t], sh = ss.getSheetByName(spec.name);
    if (!sh) { out.push('  ' + spec.name + ' — no such tab'); continue; }
    var last = sh.getLastRow();
    if (last < 2) { out.push('  ' + spec.name + ' — empty'); continue; }

    var width = Math.max(sh.getLastColumn(), spec.col);
    var vals = sh.getRange(2, 1, last - 1, width).getValues();
    var hit = [];
    for (var i = 0; i < vals.length; i++) {
      var found = false;
      if (spec.col > 0) {
        found = String(vals[i][spec.col - 1] || '').indexOf(CLEAN_MARK) >= 0;
      } else {
        /* whole row, for the tabs where the name is not in a column of its own */
        for (var c = 0; c < vals[i].length && !found; c++)
          if (String(vals[i][c] || '').indexOf(CLEAN_MARK) >= 0) found = true;
      }
      if (found) hit.push(i + 2);
    }

    if (!hit.length) { out.push('  ' + spec.name + ' — nothing matching, left alone'); continue; }

    /* Bottom-up. */
    for (i = hit.length - 1; i >= 0; i--) sh.deleteRow(hit[i]);
    total += hit.length;
    out.push('  ' + spec.name + ' — removed ' + hit.length + ' ' + spec.what +
             ' (was rows ' + hit[0] + '-' + hit[hit.length - 1] + ')');
  }

  var msg = 'DEPLOY-CHECK RECIPES REMOVED\n\n' + out.join('\n') + '\n\n' +
    total + ' row(s) deleted, matched on the name "' + CLEAN_MARK + '". No row ' +
    'was removed by position, and nothing without that name was touched.\n\n' +
    'Run findHalfWrittenRecipes() to confirm the deploy check no longer appears.';
  Logger.log(msg);
  return msg;
}
