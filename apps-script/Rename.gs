/**
 * Golden Choice — one ingredient, one spelling.
 *
 * findLikeNames() says which names are the same ingredient. This is what fixes
 * one, by rewriting the INGREDIENT NAME cell in the R&D Log and nothing else.
 *
 * THE DANGER IS THE DOSE. "Espresso 18G" is not a spelling of "Espresso" with
 * noise on the end — the 18G is a real measurement, and the quantity has its own
 * column, so renaming without looking would delete it. So every row is read
 * first and sorted into four cases:
 *
 *   NOTHING TO CARRY   The old name is the target with only case or spacing
 *                      different. Rename, and that is all.
 *   ALREADY RECORDED   The name carries a dose, and the quantity column already
 *                      says the same thing. The name is repeating the cell next
 *                      to it. Rename; nothing is lost.
 *   MOVE IT ACROSS     The name carries a dose and the quantity column is empty
 *                      or holds text. Rename, and write the dose into the
 *                      quantity and UOM columns where it belongs.
 *   WRITE IT DOWN      The name and the quantity column measure DIFFERENT THINGS.
 *                      "Espresso 18G" beside a quantity of 36 ML is not a
 *                      contradiction: 18 grams of ground coffee yields about 36
 *                      millilitres of espresso, and both numbers are true. The
 *                      volume stays in the quantity column where costing reads
 *                      it, and the dose is kept — in the recipe's PREPARATION
 *                      METHOD when it has a trial row, and in the CHANGE LOG
 *                      always. The live trial log holds 32 of 398 recipes, so
 *                      the change log is the one that can be relied on.
 *   REFUSED            The name and the quantity column give the SAME unit and
 *                      different numbers — a real contradiction, and only a
 *                      person knows which is right. Or the part being removed is
 *                      not a dose at all: "Cheese Cap (1:3)" is a ratio and
 *                      "Original Cheese Cap" is a word.
 *
 * A refused row is left exactly as it was and named in the report. Nothing is
 * ever renamed by guessing what the extra text meant.
 *
 * EVERY WRITE IS RECORDED IN THE CHANGE LOG, one row per cell changed, with the
 * old value, the new value and what was carried where. That tab already exists
 * for exactly this and it is part of the spreadsheet, so the record outlives the
 * execution log this prints to. The sheet's own File -> Version history is the
 * blunt undo; the change log is the readable one.
 *
 * It runs as a plan first. renamePlan_() writes nothing at all; renameApply_()
 * writes only the rows the plan called safe, and reports every old value it
 * replaced.
 */

/* Units the log measures in. A dose in the name is only understood in one of
   these; anything else is refused rather than assumed. */
var RN_UNITS = { G: 'G', GM: 'G', GRAM: 'G', GRAMS: 'G', KG: 'KG',
                 ML: 'ML', L: 'L', CC: 'ML', PC: 'PC', PCS: 'PC' };

/**
 * The measurement left over when the target name is taken off the front.
 * "18G", "(22g)", "( 15G )" and "12 g" are doses. "1:3" is a ratio, "Grade A" is
 * a word, and both come back null so the row is refused.
 */
function rnDose_(extra) {
  var s = String(extra == null ? '' : extra)
    .replace(/^[\s\-–—:,(\[]+|[\s\-–—:,)\]]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!s) return null;
  var m = /^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/.exec(s);
  if (!m) return null;
  var u = RN_UNITS[m[2].toUpperCase()];
  if (!u) return null;
  return { qty: parseFloat(m[1]), unit: u, text: m[1] + ' ' + u };
}

/* What is left of `name` once `target` is taken off the front, case-blind. */
function rnExtra_(name, target) {
  var n = String(name == null ? '' : name).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  var t = String(target).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  if (n.toLowerCase().indexOf(t.toLowerCase()) !== 0) return null;   /* not a prefix */
  return n.slice(t.length);
}

/**
 * Reads the R&D Log and decides, row by row, what renaming `froms` to `to` would
 * do. WRITES NOTHING. Every caller runs this first, including the one that
 * writes: the plan is the thing that is checked, and the write only replays it.
 */
function renamePlan_(froms, to) {
  var L = LOGCOLS_(), sh = sheetByGid_(GID.log);
  if (L.ing < 0) throw new Error('The R&D Log has no INGREDIENT NAME column.');
  /* Without the quantity column every dose would look unrecorded and be written
     into column zero. Refuse rather than find that out mid-write. */
  if (L.qty < 0) throw new Error('The R&D Log has no VOLUME USAGE column, so a dose ' +
                                 'in a name could not be checked. Nothing was changed.');
  var want = {}, i;
  for (i = 0; i < froms.length; i++) want[key_(froms[i])] = froms[i];

  var n = sh.getLastRow();
  var vals = n < 2 ? [] : sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
  /* Where a dose goes when the quantity column is measuring something else.
     Versions are kept alongside so a miss can say WHICH miss it is: a recipe
     with no trial row at all is a different problem from one whose trial row is
     filed under another version, and "no trial row" would hide the second. */
  var T = TRIALCOLS_(), trial = {}, seenVers = {}, tr = rows_(GID.trial);
  for (i = 0; i < tr.length; i++) {
    var tid = cell_(tr[i], T.id);
    if (!tid) continue;
    var tv = cell_(tr[i], T.ver) || 'V1.0';
    trial[tid + '|' + tv] = i + 2;                       /* its sheet row */
    (seenVers[tid] = seenVers[tid] || []).push(tv);
  }
  var plan = { to: to, rename: [], move: [], note: [], nothing: [], refuse: [], rows: 0,
               trialRows: 0 };
  for (var kk in trial) if (trial.hasOwnProperty(kk)) plan.trialRows++;

  for (i = 0; i < vals.length; i++) {
    var name = S_(vals[i][L.ing]);
    if (!want[key_(name)]) continue;
    plan.rows++;
    var row = i + 2;
    var at = { row: row, id: S_(vals[i][L.id]), ver: S_(vals[i][L.ver]) || 'V1.0',
               recipe: S_(vals[i][L.name]), from: name,
               qty: S_(vals[i][L.qty]), uom: S_(vals[i][L.uom]) };

    if (key_(name) === key_(to)) { at.why = 'already the target spelling'; plan.nothing.push(at); continue; }

    var extra = rnExtra_(name, to);
    if (extra === null) {
      at.why = 'does not start with "' + to + '", so something other than a dose differs';
      plan.refuse.push(at); continue;
    }
    if (!extra.replace(/\s+/g, '')) { at.why = 'only case or spacing differs'; plan.rename.push(at); continue; }

    var dose = rnDose_(extra);
    if (!dose) {
      at.why = '"' + extra.replace(/^\s+|\s+$/g, '') + '" is not a measurement this understands';
      plan.refuse.push(at); continue;
    }
    at.dose = dose.text;

    var q = parseFloat(at.qty);
    var sameNumber = isFinite(q) && q === dose.qty;
    var sameUnit = key_(at.uom) === key_(dose.unit);
    if (sameNumber && sameUnit) {
      at.why = 'the quantity column already says ' + dose.text;
      plan.rename.push(at); continue;
    }
    if (!num_(at.qty)) {
      at.why = 'the quantity column holds ' + (at.qty ? '"' + at.qty + '"' : 'nothing') +
               ', so ' + dose.text + ' moves into it';
      plan.move.push(at); continue;
    }
    if (sameUnit) {
      at.why = 'the name says ' + dose.text + ' and the quantity column says ' +
               at.qty + ' ' + at.uom + ' — the same unit, two numbers, and only a ' +
               'person knows which is right';
      plan.refuse.push(at); continue;
    }
    /* Different units measure different things, and grams never become
       millilitres, so neither number is wrong. Keep the volume where costing
       reads it and write the dose where somebody will see it. */
    at.trial = (T.method < 0) ? 0 : (trial[at.id + '|' + at.ver] || 0);
    at.note = to + ' dose: ' + dose.text + '.';
    var have = seenVers[at.id];
    at.where = at.trial ? 'the preparation method and the change log'
             : have ? 'the change log — the trial log files ' + at.id + ' under ' +
                      have.join(', ') + ', not ' + at.ver
             : 'the change log — the trial log has no row for ' + at.id;
    at.why = at.qty + ' ' + at.uom + ' is what goes in the cup, ' + dose.text +
             ' is what it was made from; the quantity stays and the dose goes to ' + at.where;
    plan.note.push(at);
  }
  return plan;
}

/* One block of the report. */
function rnList_(head, rows, note) {
  if (!rows.length) return '';
  var out = ['   ' + head + '  (' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ')'];
  if (note) out.push('   ' + note);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push('     row ' + r.row + '  ' + r.id + ' ' + r.ver + '  ' + r.recipe);
    out.push('        "' + r.from + '"  qty ' + (r.qty || '(empty)') + ' ' + r.uom +
             '  —  ' + r.why);
  }
  return out.join('\n') + '\n';
}

function rnReport_(plan, applied) {
  var head = applied ? 'INGREDIENT RENAMED' : 'RENAME PLAN — NOTHING HAS BEEN WRITTEN';
  var out = [head, ''];
  out.push('   Target spelling: "' + plan.to + '"');
  out.push('   ' + plan.rows + ' row(s) carry one of the old spellings.');
  out.push('   ' + plan.trialRows + ' trial row(s) indexed, which is where a dose goes when ' +
           'the quantity column is measuring something else.');
  out.push('   ' + plan.rename.length + ' rename cleanly, ' + plan.move.length +
           ' also move a dose into the quantity column, ' + plan.note.length +
           ' also write a dose into the method, ' + plan.refuse.length + ' refused.');
  out.push('');
  out.push(rnList_(applied ? 'RENAMED' : 'WOULD RENAME', plan.rename));
  out.push(rnList_(applied ? 'RENAMED, AND THE DOSE MOVED ACROSS' : 'WOULD RENAME AND MOVE THE DOSE',
                   plan.move,
                   'The quantity column is where a measurement belongs; the name was repeating it.'));
  out.push(rnList_(applied ? 'RENAMED, AND THE DOSE WRITTEN INTO THE METHOD'
                          : 'WOULD RENAME AND WRITE THE DOSE INTO THE METHOD', plan.note,
                   'The two numbers measure different things, so both are kept.'));
  out.push(rnList_('LEFT ALONE', plan.nothing));
  out.push(rnList_('REFUSED — not touched, and still needs a person', plan.refuse));
  if (!applied) {
    out.push('   Nothing above has been written. Run the apply function to do it.');
  } else {
    out.push('   Written, and every change is a row in the CHANGE LOG with its old value,');
    out.push('   so the record is in the spreadsheet rather than only in this log. File ->');
    out.push('   Version history undoes the lot if it ever needs to.');
    out.push('   Run seedPrices() afterwards so the Prices tab drops the rows for the');
    out.push('   spellings that no longer exist.');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Replays a plan onto the sheet. Only the rows the plan called safe, only the
 * ingredient, quantity and UOM columns, one cell at a time so a failure part way
 * leaves the rest readable rather than half a block rewritten.
 */
/* The CHANGE LOG row for one rename. Old Version and New Version are the same:
   this corrects a spelling, it does not make a new version of the recipe. */
var RN_BY     = 'Spelling fix';
var RN_REASON = 'One ingredient, one spelling, so the price list can reach it';

function rnChange_(a, to, remark) {
  return [a.id, a.ver, a.ver, 'Ingredient name', a.from, to,
          RN_BY, stamp_(), RN_REASON, remark];
}

/**
 * Replays a plan onto the sheet. Only the rows the plan called safe, only the
 * ingredient, quantity and UOM columns, one cell at a time so a failure part way
 * leaves the rest readable rather than half a block rewritten. Every write puts
 * a row in the CHANGE LOG, so what happened is in the spreadsheet and not only
 * in this report.
 */
function renameApply_(froms, to) {
  var plan = renamePlan_(froms, to), L = LOGCOLS_(), sh = sheetByGid_(GID.log);
  var T = TRIALCOLS_(), ts = sheetByGid_(GID.trial), changes = [], done = {}, i, a;

  for (i = 0; i < plan.rename.length; i++) {
    a = plan.rename[i];
    sh.getRange(a.row, L.ing + 1).setValue(to);
    changes.push(rnChange_(a, to, a.dose
      ? 'The name repeated the quantity column, which already said ' + a.dose + '.'
      : 'Only the spelling changed.'));
  }

  for (i = 0; i < plan.move.length; i++) {
    a = plan.move[i];
    var d = rnDose_(rnExtra_(a.from, to));
    sh.getRange(a.row, L.ing + 1).setValue(to);
    sh.getRange(a.row, L.qty + 1).setValue(d.qty);
    if (L.uom >= 0) sh.getRange(a.row, L.uom + 1).setValue(d.unit);
    changes.push(rnChange_(a, to, 'The dose ' + d.text + ' moved out of the name into the ' +
      'quantity column, which held ' + (a.qty ? '"' + a.qty + '"' : 'nothing') + '.'));
  }

  for (i = 0; i < plan.note.length; i++) {
    a = plan.note[i];
    sh.getRange(a.row, L.ing + 1).setValue(to);
    /* The method cell is appended to, never replaced, and only once however many
       log rows one recipe has. */
    if (a.trial && !done[a.trial + '|' + a.note]) {
      done[a.trial + '|' + a.note] = 1;
      var cell = ts.getRange(a.trial, T.method + 1), was = S_(cell.getValue());
      if (was.indexOf(a.note) < 0)
        cell.setValue(was ? was.replace(/\s+$/, '') + ' ' + a.note : a.note);
    }
    changes.push(rnChange_(a, to, 'The name also carried ' + a.dose + '. The quantity ' +
      'column keeps ' + a.qty + ' ' + a.uom + ', which is what goes in the cup; ' + a.dose +
      ' is what it was made from. Kept in ' + a.where + '.'));
  }

  if (changes.length) {
    var ch = tab_(CHANGES_TAB, CHANGES_HEAD);
    ch.getRange(ch.getLastRow() + 1, 1, changes.length, CHANGES_HEAD.length).setValues(changes);
  }

  var msg = rnReport_(plan, true);
  Logger.log(msg);
  return msg;
}

/* ------------------------------------------------------------------ Espresso */

/* The six spellings findLikeNames() found on 5 Sep 2026, and the one they mean.
   Listed rather than matched by a rule: renaming is the one thing here that
   changes the recipes, so what it touches is written down and reviewable. */
var ESPRESSO = ['Espresso', 'Espresso 18G', 'Espresso (22g)', 'Espresso 22g',
                'Espresso 16g', 'espresso (18G)'];

function espressoPlan()  { var m = rnReport_(renamePlan_(ESPRESSO, 'Espresso'), false);
                           Logger.log(m); return m; }
function espressoApply() { return renameApply_(ESPRESSO, 'Espresso'); }
