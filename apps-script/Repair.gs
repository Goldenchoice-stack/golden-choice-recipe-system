/**
 * Golden Choice — repairing a trial row a refused PIC stopped halfway.
 *
 * The row exists with its date, drink id, name and version, and then nothing:
 * the R&D PIC cell was refused and every column after it was never written.
 *
 * SOME OF THAT IS RECOVERABLE AND SOME IS NOT, and the difference is whether the
 * value was written down anywhere else at the time.
 *
 *   RECOVERABLE. submit_ writes the same person into the R&D Log's CREATED BY
 *   for the same recipe and version. That is not a guess about who filed it —
 *   it is the same value, from the same submission, in another tab.
 *
 *   RECOVERABLE WHEN THE SUBMISSION WAS AN UPDATE. changes_() records every
 *   field that moved, with its new value, in the CHANGE LOG. A serving size or
 *   a selling price that changed in that submission is therefore still written
 *   down, keyed by recipe and new version.
 *
 *   NOT RECOVERABLE. Anything that was never a change and never reached the
 *   trial row exists nowhere. A first version's serving size, or a field that
 *   did not move, is simply gone.
 *
 * This writes ONLY values it finds in one of those two places. It never fills a
 * cell from a sibling recipe, an average, or a default. A cell it cannot source
 * is left empty, and the report says which those are — an empty cell is honest
 * and a plausible invented one is not.
 *
 * It touches only rows whose PIC is empty, and only the columns it has a value
 * for. Reads first, writes second, reports last.
 */

/* The CHANGE LOG's field names, as changes_() writes them, mapped to the trial
   log's own columns. */
var REPAIR_FIELDS = [
  ['Chinese name',       'zh'],
  ['Serving size',       'serve'],
  ['Selling price',      'price'],
  ['Difficulty',         'diff'],
  ['Equipment',          'equip'],
  ['Preparation method', 'method'],
  ['Video link',         'video']
];

function repairHalfWrittenTrialRows() {
  var T = TRIALCOLS_(), sh = fixTab_(FIX_GID.trial, FIX_NAME.trial);
  var out = [], i, j, filled = 0, rowsTouched = 0;

  /* Who filed each version, from the R&D Log. */
  var L = LOGCOLS_(), who = {}, log = rows_(GID.log);
  for (i = 0; i < log.length; i++) {
    var lid = cell_(log[i], L.id);
    if (!lid) continue;
    var lk = lid + '|' + (cell_(log[i], L.ver) || 'V1.0');
    if (!who[lk]) who[lk] = cell_(log[i], L.by);
  }

  /* What each submission recorded as having changed. */
  var ch = SpreadsheetApp.getActive().getSheetByName('CHANGE LOG'), changed = {};
  if (ch && ch.getLastRow() > 1) {
    var C = ch.getRange(2, 1, ch.getLastRow() - 1, 10).getValues();
    for (i = 0; i < C.length; i++) {
      var ck = String(C[i][0]).trim() + '|' + String(C[i][2]).trim();
      if (!changed[ck]) changed[ck] = {};
      var field = String(C[i][3]).trim(), val = String(C[i][5]).trim();
      if (field && val) changed[ck][field] = val;
    }
  }

  var tr = rows_(FIX_GID.trial);
  for (i = 0; i < tr.length; i++) {
    var id = cell_(tr[i], T.id);
    if (!id || cell_(tr[i], T.pic)) continue;          /* only the stopped rows */
    var ver = cell_(tr[i], T.ver) || 'V1.0', key = id + '|' + ver, row = i + 2;

    var got = [], missing = [];

    var pic = who[key] || '';
    if (pic) { sh.getRange(row, T.pic + 1).setValue(pic); got.push('R&D PIC = ' + pic); }
    else missing.push('R&D PIC');

    var rec = changed[key] || {};
    for (j = 0; j < REPAIR_FIELDS.length; j++) {
      var label = REPAIR_FIELDS[j][0], slot = REPAIR_FIELDS[j][1];
      var at = T[slot];
      if (at < 0) continue;
      /* Never overwrite. A cell that already holds something was written by
         somebody, and this is a repair, not a rewrite. */
      if (cell_(tr[i], at)) continue;
      if (rec[label]) { sh.getRange(row, at + 1).setValue(rec[label]);
                        got.push(label + ' = ' + rec[label]); }
      else missing.push(label);
    }

    if (got.length) { filled += got.length; rowsTouched++; }
    out.push('  row ' + row + '  ' + id + ' ' + ver + '  ' + cell_(tr[i], T.name));
    out.push('     recovered: ' + (got.length ? got.join('; ') : 'nothing'));
    out.push('     still empty: ' + (missing.length ? missing.join(', ') : 'nothing'));
  }

  var msg = 'REPAIRING TRIAL ROWS STOPPED BY A REFUSED PIC\n\n' +
    (out.length ? out.join('\n') : '  none — every trial row carries a PIC.') + '\n\n' +
    filled + ' value(s) written across ' + rowsTouched + ' row(s), every one of them ' +
    'read from the R&D Log or the CHANGE LOG rather than invented.\n' +
    'Anything listed as still empty was never written down anywhere at the time ' +
    'and has to be re-entered through the intake as an update.';
  Logger.log(msg);
  return msg;
}
