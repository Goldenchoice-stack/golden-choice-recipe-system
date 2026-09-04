/** Golden Choice R&D — sheet fixer. Menu: R&D Tools.
 *
 *  Deliberately uses ONLY the spreadsheet permission this project already has.
 *  No UrlFetchApp and no ScriptApp: adding either would widen the project's
 *  OAuth scopes, and Code.gs in this same project is the deployed web app the
 *  intake form depends on. Keeping that working matters more than convenience.
 *
 *  That is still true OF THIS FILE. It is no longer true of the project:
 *  Web.gs uses ScriptApp and DriveApp, and Autocount.gs uses UrlFetchApp to
 *  read the price snapshot. The menu item below is the only way into it, so
 *  nothing the web app serves can reach the network.
 */

var FIX_GID = { log: 1784376487, ver: 2145004234, trial: 863907825 };
var FIX_NAME = { log: 'R&D Log', ver: 'RECIPE VERSIONS', trial: 'R&D TRIAL LOG' };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('R&D Tools')
    .addItem('Approve the recipe my cursor is on', 'approveHere')
    .addItem('Reject the recipe my cursor is on', 'rejectHere')
    .addSeparator()
    .addItem('Fix the sheet now', 'START_HERE')
    .addItem('Update prices from AutoCount', 'updatePricesFromAutocount')
    .addToUi();
}

function START_HERE() {
  var msg = fixRun_();
  try { SpreadsheetApp.getUi().alert('R&D Tools', msg, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(msg); }
}

function fixRun_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Another run is in progress.';
  try {
    var c = fixVersionStatuses_(), a = fixStatuses_(), b = fixTrials_();
    var out = [];
    if (a.fixed) out.push('- ' + a.fixed + ' recipe row(s) had the wrong status. Corrected.');
    if (a.sup) out.push('- ' + a.sup + ' row(s) belonged to a replaced version. Marked Superseded.');
    if (b.added) out.push('- ' + b.added + ' trial row(s) added to ' + FIX_NAME.trial + '.');
    if (b.dates) out.push('- ' + b.dates + ' trial date(s) rewritten into YYYY-MM-DD.');
    if (c) out.push('- ' + c + ' version(s) were waiting on a decision that a newer version already replaced. Marked Superseded.');
    var msg = out.length ? out.join('\n') : 'Everything is already correct.';
    Logger.log(msg);
    return msg;
  } catch (e) {
    return 'Stopped: ' + e.message + '\nNothing was half-written; safe to run again.';
  } finally { lock.releaseLock(); }
}

/* Dates must come out as YYYY-MM-DD. A cell holding a real Date stringifies
   as "Mon Aug 17 2026 ...", which nothing downstream can parse. */
function fixDate_(v) {
  if (v instanceof Date && !isNaN(v))
    return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? m[0] : '';
}
/* V2.0 sorts above V1.1 sorts above V1.0. */
function fixVerNum_(s) {
  var m = /^V?(\d+)(?:\.(\d+))?/i.exec(String(s || ''));
  return m ? (+m[1]) * 1000 + (+(m[2] || 0)) : 0;
}

function fixDateOk_(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/* make the R&D Log agree with RECIPE VERSIONS */
function fixStatuses_() {
  var reg = fixTab_(FIX_GID.ver, FIX_NAME.ver), log = fixTab_(FIX_GID.log, FIX_NAME.log), C = fixCols_(log);
  var out = { fixed: 0, sup: 0 };
  if (reg.getLastRow() < 2 || log.getLastRow() < 2) return out;

  var R = reg.getRange(2, 1, reg.getLastRow() - 1, 5).getValues();
  var w = Math.max(C.id, C.st, C.ver);
  var V = log.getRange(2, 1, log.getLastRow() - 1, w).getValues();

  for (var k = 0; k < R.length; k++) {
    var id = String(R[k][0]).trim(), ver = String(R[k][1]).trim() || 'V1.0';
    var s = String(R[k][4]).trim().toUpperCase();
    if (!id || (s !== 'APPROVED' && s !== 'REJECTED')) continue;
    var want = s === 'APPROVED' ? 'Approved' : 'Rejected';

    for (var i = 0; i < V.length; i++) {
      if (String(V[i][C.id - 1]).trim() !== id) continue;
      var rv = C.ver > 0 ? (String(V[i][C.ver - 1]).trim() || 'V1.0') : 'V1.0';
      var cur = String(V[i][C.st - 1]).trim();
      if (rv === ver && cur !== want) {
        log.getRange(i + 2, C.st).setValue(want); V[i][C.st - 1] = want; out.fixed++;
      } else if (s === 'APPROVED' && rv !== ver && fixVerNum_(rv) < fixVerNum_(ver) &&
                 (cur.toLowerCase() === 'approved' || cur.toLowerCase() === 'pending review')) {
        /* Superseded covers both: a version that WAS live, and one still waiting on a
           decision when a newer version got approved instead - otherwise the older one
           sits in Pending Review for ever. */
        log.getRange(i + 2, C.st).setValue('Superseded'); V[i][C.st - 1] = 'Superseded'; out.sup++;
      }
    }
  }
  return out;
}

/* Build trial rows from RECIPE VERSIONS, which holds one row per submitted
   version. Stage, due date and next action are not recorded there, so they
   stay blank rather than being invented. */
function fixTrials_() {
  var reg = fixTab_(FIX_GID.ver, FIX_NAME.ver), sh = fixTab_(FIX_GID.trial, FIX_NAME.trial);
  var out = { added: 0, dates: 0 };
  if (reg.getLastRow() < 2) return out;

  /* Dates are stored as PLAIN TEXT. Left as real date values, the column's
     display format is what a CSV export emits, so "2026-08-17" comes back out
     as "Mon Aug 17" and nothing downstream can parse it. */
  var span = sh.getMaxRows() - 1;
  if (span > 0) {
    sh.getRange(2, 1, span, 1).setNumberFormat('@');
    sh.getRange(2, 12, span, 1).setNumberFormat('@');
  }

  var at = {};
  if (sh.getLastRow() >= 2) {
    var ex = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
    for (var i = 0; i < ex.length; i++) {
      var eid = String(ex[i][1]).trim();
      if (eid) at[eid + '|' + String(ex[i][3]).trim()] = { row: i + 2, date: ex[i][0], done: ex[i][11] };
    }
  }

  var R = reg.getRange(2, 1, reg.getLastRow() - 1, 11).getValues();
  for (var k = 0; k < R.length; k++) {
    var id = String(R[k][0]).trim(), ver = String(R[k][1]).trim() || 'V1.0';
    if (!id) continue;

    var st = String(R[k][4]).trim().toUpperCase();
    var created = fixDate_(R[k][5]);
    var done = st === 'APPROVED' ? fixDate_(R[k][9]) : '';
    var seen = at[id + '|' + ver];

    if (seen) {
      var touched = false;
      if (!fixDateOk_(seen.date) && created) { sh.getRange(seen.row, 1).setValue(created); touched = true; }
      if (done && !fixDateOk_(seen.done)) { sh.getRange(seen.row, 12).setValue(done); touched = true; }
      if (touched) out.dates++;
      continue;
    }

    var status = st === 'APPROVED' ? 'Completed' : (st === 'REJECTED' ? 'Revision' : 'Waiting');
    var result = st === 'APPROVED' ? 'Pass' : (st === 'REJECTED' ? 'Fail' : '');

    sh.getRange(sh.getLastRow() + 1, 1, 1, 14).setValues([[
      created, id, String(R[k][2]), ver, String(R[k][6]), String(R[k][3]),
      '', '', status, result, '', done, '', String(R[k][8])
    ]]);
    at[id + '|' + ver] = { row: sh.getLastRow(), date: created, done: done };
    out.added++;
  }
  return out;
}

function fixTab_(gid, name) {
  var all = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < all.length; i++) if (all[i].getSheetId() === gid) return all[i];
  var s = SpreadsheetApp.getActive().getSheetByName(name);
  if (s) return s;
  throw new Error('Cannot find the tab "' + name + '".');
}

function fixCols_(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], c = { id: -1, st: -1, ver: -1, name: -1 };
  for (var i = 0; i < h.length; i++) {
    var t = String(h[i]).toUpperCase().replace(/\s+/g, ' ');
    if (t.indexOf('CREATION ID') >= 0) c.id = i + 1;
    else if (t.indexOf('CREATION NAME') >= 0) c.name = i + 1;
    else if (t === 'STATUS') c.st = i + 1;
    else if (t.indexOf('VERSION') >= 0) c.ver = i + 1;
  }
  if (c.id < 0 || c.st < 0) throw new Error('No CREATION ID or STATUS heading in ' + FIX_NAME.log);
  return c;
}


/* ---------------------------------------------------------------------------
   Deciding a recipe that never came through the intake form.

   The 199 "Unreviewed" recipes are old rows in the log. There is no submission
   behind them, so the Approvals page has nothing to act on — the decision has
   to be made here, against the row itself.

   Put the cursor on any row of the recipe and pick from the R&D Tools menu.
   It sets every row of THAT recipe and THAT version, so a multi-version recipe
   is never changed wholesale by accident.
   --------------------------------------------------------------------------- */

function approveHere() { decideHere_('Approved'); }
function rejectHere()  { decideHere_('Rejected'); }

function decideHere_(want) {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActiveSheet();

  if (sh.getSheetId() !== FIX_GID.log) {
    ui.alert('R&D Tools', 'Open the ' + FIX_NAME.log + ' tab and put the cursor on the ' +
             'recipe you want to decide, then try again.', ui.ButtonSet.OK);
    return;
  }

  var C = fixCols_(sh);
  var row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('R&D Tools', 'That is the heading row.', ui.ButtonSet.OK); return; }

  var id = String(sh.getRange(row, C.id).getValue()).trim();
  if (!id) { ui.alert('R&D Tools', 'There is no Creation ID on that row.', ui.ButtonSet.OK); return; }

  var name = C.name > 0 ? String(sh.getRange(row, C.name).getValue()).trim() : '';
  var ver = C.ver > 0 ? (String(sh.getRange(row, C.ver).getValue()).trim() || 'V1.0') : 'V1.0';

  var last = sh.getLastRow();
  var w = Math.max(C.id, C.st, C.ver);
  var V = sh.getRange(2, 1, last - 1, w).getValues();

  var hits = [], already = 0;
  for (var i = 0; i < V.length; i++) {
    if (String(V[i][C.id - 1]).trim() !== id) continue;
    var rv = C.ver > 0 ? (String(V[i][C.ver - 1]).trim() || 'V1.0') : 'V1.0';
    if (rv !== ver) continue;
    if (String(V[i][C.st - 1]).trim() === want) { already++; continue; }
    hits.push(i + 2);
  }

  if (!hits.length) {
    ui.alert('R&D Tools', id + ' ' + ver + ' is already ' + want + '.', ui.ButtonSet.OK);
    return;
  }

  var ok = ui.alert('R&D Tools',
    'Mark ' + id + (name ? ' — ' + name : '') + ' (' + ver + ') as ' + want + '?\n\n' +
    hits.length + ' ingredient row(s) will change.' +
    (already ? '\n' + already + ' row(s) already say ' + want + '.' : ''),
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  for (var h = 0; h < hits.length; h++) sh.getRange(hits[h], C.st).setValue(want);

  ui.alert('R&D Tools', id + ' ' + ver + ' is now ' + want + '. ' +
    hits.length + ' row(s) updated.\n\nThe website picks this up on its next refresh.',
    ui.ButtonSet.OK);
}


/* ---------------------------------------------------------------------------
   AUTOMATIC. Code.gs calls these at the moment a recipe is submitted and at the
   moment it is decided, so the sheet is complete without anyone remembering to
   run a menu item. They live here rather than in Code.gs to keep that file --
   the deployed web app the intake form depends on -- as close to untouched as
   possible. Still only SpreadsheetApp: no new permission is asked for.
   --------------------------------------------------------------------------- */

var TRIAL_EXTRA = ['SERVING SIZE (ML)', 'SELLING PRICE (RM)', 'DIFFICULTY',
                   'EQUIPMENT', 'PREPARATION METHOD', 'VIDEO LINK',
                   'CHINESE NAME', 'PHOTO'];

/* The intake captures the production detail but the trial log had nowhere to
   put it. Added once, to the right of the existing columns, so nothing shifts. */
function trialExtraCols_(sh) {
  var last = Math.max(sh.getLastColumn(), 16);
  var head = sh.getRange(1, 1, 1, last).getValues()[0]
               .map(function (h) { return String(h).trim().toUpperCase(); });
  var at = head.indexOf(TRIAL_EXTRA[0]) + 1;
  if (at < 1) at = last + 1;
  /* rewritten every time, so a column added later gets its heading too */
  sh.getRange(1, at, 1, TRIAL_EXTRA.length).setValues([TRIAL_EXTRA]);
  return at;
}

/* Updating an existing recipe leaves Category blank, because the intake page has
   no way to know what it was. Carry the last one forward instead of the hole
   that put an empty Category on RCP-0384 V2.0. */
function carriedCategory_(id) {
  var reg = fixTab_(FIX_GID.ver, FIX_NAME.ver);
  if (reg.getLastRow() < 2) return '';
  var R = reg.getRange(2, 1, reg.getLastRow() - 1, 4).getValues();
  for (var i = R.length - 1; i >= 0; i--)
    if (String(R[i][0]).trim() === id && String(R[i][3]).trim())
      return String(R[i][3]).trim();
  return '';
}

/* One trial row per submitted version, written at submission time because that
   is the only moment Project, Stage, Due Date, Next Action, Notes and the
   production detail are visible to the sheet at all. */
function trialRow_(id, version, name, by, stamp, b) {
  var sh = fixTab_(FIX_GID.trial, FIX_NAME.trial);
  var extra = trialExtraCols_(sh);
  var at = sh.getLastRow() + 1;

  /* Dates stay PLAIN TEXT. As real dates the column format is what a CSV export
     emits, and that turned 2026-08-17 back into "Mon Aug 17". */
  var main = ['', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  main[0]  = fixDate_(stamp) || String(stamp).slice(0, 10);
  main[1]  = id;
  main[2]  = name;
  main[3]  = version;
  main[4]  = by;
  main[5]  = String(b.category || '') || carriedCategory_(id);
  main[6]  = String(b.project || '');
  main[7]  = String(b.stage || '');
  main[8]  = 'Waiting';
  main[9]  = String(b.result || '');
  main[10] = fixDate_(b.due);
  main[11] = fixDate_(b.done);
  main[12] = String(b.next || '');
  main[13] = String(b.notes || '');

  sh.getRange(at, 1, 1, 14).setNumberFormat('@');
  sh.getRange(at, 1, 1, 14).setValues([main]);

  /* written as its own range so columns O and P are never touched */
  sh.getRange(at, extra, 1, TRIAL_EXTRA.length).setNumberFormat('@');
  sh.getRange(at, extra, 1, TRIAL_EXTRA.length).setValues([[
    String(b.serving || ''), String(b.price || ''), String(b.difficulty || ''),
    String(b.equipment || ''), String(b.method || ''), String(b.video || ''),
    String(b.zh || ''), String(b.photoFile || '')
  ]]);
}

/* Code.gs is append-only by design: approve_ stamps RECIPE VERSIONS and leaves
   the R&D Log saying "Pending Review" -- and the R&D Log is the copy the site,
   the dashboard and the Recipe Finder all read. This carries the decision
   across at the moment it is made, which is what "Fix the sheet now" used to be
   needed for. Returns how many rows it changed. */
function syncLog_(id, version, decision) {
  var log = fixTab_(FIX_GID.log, FIX_NAME.log), C = fixCols_(log);
  if (log.getLastRow() < 2) return 0;

  var want = decision === 'APPROVED' ? 'Approved' : 'Rejected';
  var w = Math.max(C.id, C.st, C.ver);
  var V = log.getRange(2, 1, log.getLastRow() - 1, w).getValues();
  var n = 0;

  for (var i = 0; i < V.length; i++) {
    if (String(V[i][C.id - 1]).trim() !== id) continue;
    var rv  = C.ver > 0 ? (String(V[i][C.ver - 1]).trim() || 'V1.0') : 'V1.0';
    var cur = String(V[i][C.st - 1]).trim();

    if (rv === version) {
      if (cur !== want) { log.getRange(i + 2, C.st).setValue(want); n++; }
    } else if (decision === 'APPROVED' && fixVerNum_(rv) < fixVerNum_(version) &&
               (cur.toLowerCase() === 'approved' || cur.toLowerCase() === 'pending review')) {
      /* Superseded covers a version that WAS live and one still waiting when a
         newer one was approved instead -- otherwise the older one sits in
         Pending Review for ever. */
      log.getRange(i + 2, C.st).setValue('Superseded'); n++;
    }
  }

  if (decision === 'APPROVED') supersedeVersions_(id, version);
  trialDecision_(id, version, decision);
  return n;
}

/* and close the trial row, so R&D TRIAL LOG stops saying "Waiting" for
   something that has already been decided. */
function trialDecision_(id, version, decision) {
  var sh = fixTab_(FIX_GID.trial, FIX_NAME.trial);
  if (sh.getLastRow() < 2) return;
  var R = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
  var done = Utilities.formatDate(new Date(),
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');

  for (var i = R.length - 1; i >= 0; i--) {
    if (String(R[i][1]).trim() !== id || String(R[i][3]).trim() !== version) continue;
    sh.getRange(i + 2,  9).setValue(decision === 'APPROVED' ? 'Completed' : 'Revision');
    sh.getRange(i + 2, 10).setValue(decision === 'APPROVED' ? 'Pass' : 'Fail');
    sh.getRange(i + 2, 12).setNumberFormat('@');
    sh.getRange(i + 2, 12).setValue(decision === 'APPROVED' ? done : '');
    return;
  }
}

/* RECIPE VERSIONS keeps its own status column, and approve_ only demotes a
   version that was already APPROVED. One still sitting in PENDING REVIEW when a
   newer version is approved would stay there for ever -- and show on the
   dashboard as something waiting for you, with nothing behind it to approve. */
function supersedeVersions_(id, version) {
  var reg = fixTab_(FIX_GID.ver, FIX_NAME.ver);
  if (reg.getLastRow() < 2) return 0;
  var R = reg.getRange(2, 1, reg.getLastRow() - 1, 5).getValues(), n = 0;
  for (var i = 0; i < R.length; i++) {
    if (String(R[i][0]).trim() !== id) continue;
    var rv = String(R[i][1]).trim() || 'V1.0';
    if (fixVerNum_(rv) >= fixVerNum_(version)) continue;
    if (String(R[i][4]).trim().toUpperCase() !== 'PENDING REVIEW') continue;
    reg.getRange(i + 2, 5).setValue('SUPERSEDED'); n++;
  }
  return n;
}

/* the same, for approvals that happened before any of this existed */
function fixVersionStatuses_() {
  var reg = fixTab_(FIX_GID.ver, FIX_NAME.ver);
  if (reg.getLastRow() < 2) return 0;
  var R = reg.getRange(2, 1, reg.getLastRow() - 1, 5).getValues(), n = 0;
  for (var i = 0; i < R.length; i++)
    if (String(R[i][4]).trim().toUpperCase() === 'APPROVED')
      n += supersedeVersions_(String(R[i][0]).trim(), String(R[i][1]).trim() || 'V1.0');
  return n;
}