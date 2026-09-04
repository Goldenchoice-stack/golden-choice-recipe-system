/**
 * Golden Choice — the R&D PIC mismatch.
 *
 * The intake form's "R&D PIC" dropdown offers Sakura, Robin and GC. The R&D PIC
 * column of R&D TRIAL LOG carries a data validation that accepts only Sakura and
 * Robin. So a recipe filed under GC is written to the R&D Log and to RECIPE
 * VERSIONS, and is then REJECTED by the trial log — leaving a recipe with
 * ingredients and a version but no serving size, selling price, Chinese name or
 * photo, because those live only on the trial row.
 *
 * Code.gs catches that failure and reports it, so nothing crashes. But the
 * half-written recipe is already in the sheet by then.
 *
 * TWO FUNCTIONS. Run the first, read it, then run the second.
 *
 *   picAudit()  reads only. What the column allows, what it already holds, and
 *               what the rest of the sheet uses. This is the evidence for
 *               deciding which side is wrong.
 *
 *   picFix()    widens the validation to accept every name the intake offers.
 *               It only ever ADDS values, never removes one, and refuses
 *               outright if the rule is not a plain list — so it cannot quietly
 *               replace a rule somebody built for another reason.
 *
 * Widening the sheet is the right direction only if GC is genuinely used
 * elsewhere. picAudit() is what settles that; do not run picFix() without
 * reading it.
 */

/* The names the intake form offers. Kept here so the two can be compared
   without anybody having to open the page and read the HTML. */
var PIC_OFFERED = ['Sakura', 'Robin', 'GC'];

function pic_col_() {
  var sh = fixTab_(FIX_GID.trial, FIX_NAME.trial);
  var m = cols_(FIX_GID.trial);
  var at = at_(m, ['rdpic', 'pic']);
  if (at < 0) throw new Error('No R&D PIC heading in ' + FIX_NAME.trial + '.');
  return { sh: sh, col: at + 1 };
}

/* The allowed list on a cell, or null when it is not a plain list rule. */
function pic_allowed_(rule) {
  if (!rule) return null;
  if (rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return null;
  var vals = rule.getCriteriaValues()[0];
  return vals && vals.map ? vals.map(function (v) { return String(v); }) : null;
}

function picAudit() {
  var t = pic_col_(), sh = t.sh, col = t.col, out = [];
  var last = sh.getLastRow();

  out.push('THE COLUMN');
  out.push('  ' + FIX_NAME.trial + ', column ' +
           String.fromCharCode(64 + col) + ' (R&D PIC), rows 2-' + last);

  /* What the rule allows, and how far down the sheet it reaches. */
  var rules = sh.getRange(2, col, Math.max(last - 1, 1), 1).getDataValidations();
  var allowed = null, withRule = 0, other = 0;
  for (var i = 0; i < rules.length; i++) {
    var a = pic_allowed_(rules[i][0]);
    if (rules[i][0]) withRule++;
    if (a) { if (!allowed) allowed = a; }
    else if (rules[i][0]) other++;
  }
  out.push('  ' + withRule + ' of ' + (last - 1) + ' rows carry a validation rule');
  out.push('  it allows: ' + (allowed ? allowed.join(', ') : '(not a plain list)'));
  if (other) out.push('  ' + other + ' rows carry a rule of a DIFFERENT kind — picFix will not touch those');

  /* What the column actually holds. A value already present that the rule
     forbids is the strongest evidence the rule was added after the fact. */
  out.push('');
  out.push('WHAT THIS COLUMN ALREADY HOLDS');
  var vals = sh.getRange(2, col, Math.max(last - 1, 1), 1).getValues();
  var seen = {}, order = [];
  for (i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] == null ? '' : vals[i][0]).trim();
    if (!v) continue;
    if (seen[v] === undefined) { seen[v] = 0; order.push(v); }
    seen[v]++;
  }
  order.sort(function (a, b) { return seen[b] - seen[a]; });
  for (i = 0; i < order.length; i++) {
    var ok = allowed ? (allowed.indexOf(order[i]) >= 0) : true;
    out.push('  ' + (ok ? '     ' : 'FORBIDDEN ') + order[i] + '  x' + seen[order[i]]);
  }
  if (!order.length) out.push('  (empty)');

  /* And what the rest of the system uses, which is the real question. */
  out.push('');
  out.push('WHO THE R&D LOG SAYS CREATED THINGS');
  var L = LOGCOLS_(), rows = rows_(GID.log), by = {}, ord2 = [];
  for (i = 0; i < rows.length; i++) {
    var b = cell_(rows[i], L.by);
    if (!b) continue;
    if (by[b] === undefined) { by[b] = 0; ord2.push(b); }
    by[b]++;
  }
  ord2.sort(function (a, b) { return by[b] - by[a]; });
  for (i = 0; i < Math.min(ord2.length, 8); i++)
    out.push('  ' + ord2[i] + '  x' + by[ord2[i]]);

  out.push('');
  out.push('WHAT THE INTAKE FORM OFFERS');
  out.push('  ' + PIC_OFFERED.join(', '));
  var missing = [];
  for (i = 0; i < PIC_OFFERED.length; i++)
    if (allowed && allowed.indexOf(PIC_OFFERED[i]) < 0) missing.push(PIC_OFFERED[i]);
  out.push('');
  out.push(missing.length
    ? 'MISMATCH: the form offers ' + missing.join(', ') +
      ', which this column refuses. A recipe filed that way half-writes.'
    : 'No mismatch: every name the form offers is accepted here.');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * Widens the rule so it accepts every name the intake offers.
 *
 * Only adds. A name already allowed stays allowed, a rule that is not a plain
 * list is left alone and reported, and the rule's own "reject input" and
 * dropdown settings are carried over rather than reinvented — the point is to
 * change one thing, not to rebuild somebody else's rule.
 */
function picFix() {
  var t = pic_col_(), sh = t.sh, col = t.col;
  var last = sh.getLastRow(), n = Math.max(last - 1, 1);
  var range = sh.getRange(2, col, n, 1);
  var rules = range.getDataValidations();

  var sample = null;
  for (var i = 0; i < rules.length && !sample; i++)
    if (pic_allowed_(rules[i][0])) sample = rules[i][0];
  if (!sample) return 'No plain-list validation found on the R&D PIC column, so ' +
                      'there is nothing to widen. Nothing was changed.';

  var allowed = pic_allowed_(sample), add = [];
  for (i = 0; i < PIC_OFFERED.length; i++)
    if (allowed.indexOf(PIC_OFFERED[i]) < 0) add.push(PIC_OFFERED[i]);
  if (!add.length) return 'The R&D PIC column already accepts ' + PIC_OFFERED.join(', ') +
                          '. Nothing was changed.';

  var want = allowed.concat(add);
  var built = sample.copy().requireValueInList(want, true).build();

  /* Applied only where a list rule already is. A blank cell or a rule of
     another kind keeps whatever it has. */
  var changed = 0;
  for (i = 0; i < rules.length; i++) {
    if (!pic_allowed_(rules[i][0])) continue;
    rules[i][0] = built;
    changed++;
  }
  range.setDataValidations(rules);

  var msg = 'R&D PIC validation widened.\n\n' +
    '  was: ' + allowed.join(', ') + '\n' +
    '  now: ' + want.join(', ') + '\n' +
    '  added: ' + add.join(', ') + '\n' +
    '  applied to ' + changed + ' rows of ' + FIX_NAME.trial + '\n\n' +
    'Nothing was removed, and no cell that had a different kind of rule was ' +
    'touched. Run picAudit() again to see it, then file a recipe under ' +
    add.join('/') + ' to prove it.';
  Logger.log(msg);
  return msg;
}
