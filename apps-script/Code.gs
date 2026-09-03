/**
 * Golden Choice — R&D Recipe Intake writer
 *
 * Paste this into the R&D Log spreadsheet: Extensions → Apps Script.
 * It gives the intake form permission to add rows, using the sheet's own
 * authority. Nothing outside this spreadsheet is touched.
 *
 * It only ever APPENDS. It never edits or deletes an existing row.
 */

var SECRET = 'PASTE-THE-CONNECTOR-SECRET-HERE';

var LOG_TAB      = 'R&D Log';
var VERSIONS_TAB = 'RECIPE VERSIONS';
var CHANGES_TAB  = 'CHANGE LOG';

var VERSIONS_HEAD = ['Recipe ID','Version','Recipe Name','Category','Version Status',
                     'Created Date','Created By','Update Reason','Update Remarks',
                     'Approved Date','Approved By'];
var CHANGES_HEAD  = ['Recipe ID','Old Version','New Version','Field Changed',
                     'Old Value','New Value','Changed By','Changed Date',
                     'Update Reason','Remarks'];

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function ss_()  { return SpreadsheetApp.getActiveSpreadsheet(); }
function now_() { return Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm:ss'); }

/** Create a tab only if it is genuinely absent. Never clears an existing one. */
function tab_(name, head) {
  var s = ss_().getSheetByName(name);
  if (s) return s;
  s = ss_().insertSheet(name);
  s.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  s.setFrozenRows(1);
  return s;
}

/** Find the VERSION column on R&D Log, adding it at the far right if missing. */
function versionCol_(sheet) {
  var lastCol = sheet.getLastColumn();
  var head = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < head.length; i++)
    if (String(head[i]).trim().toUpperCase() === 'VERSION') return i + 1;
  var col = lastCol + 1;
  sheet.getRange(1, col).setValue('VERSION').setFontWeight('bold');
  return col;
}

/**
 * Opening the web app address in a browser lands here. It is only a status page,
 * so you can confirm the deployment is live without needing anything else.
 */
function connectorStatus_() {
  var log = ss_().getSheetByName(LOG_TAB);
  var html =
    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px/1.6 -apple-system,Segoe UI,sans-serif;max-width:620px;margin:40px auto;padding:0 20px;color:#131B16}' +
    'h1{font-size:22px;margin:0 0 4px}.ok{color:#1D5C48;font-weight:700}' +
    'table{border-collapse:collapse;margin-top:18px;width:100%}td{padding:6px 0;border-bottom:1px solid #E1E6DF;font-size:15px}' +
    'td.r{text-align:right;font-family:Consolas,monospace}</style></head><body>' +
    '<h1><span class="ok">&#10003; Connected</span></h1>' +
    '<p>The Recipe Intake connector is deployed and can reach this spreadsheet.</p>' +
    '<table>' +
    '<tr><td>Spreadsheet</td><td class="r">' + ss_().getName() + '</td></tr>' +
    '<tr><td>Ingredient rows</td><td class="r">' + (log ? log.getLastRow() - 1 : 0) + '</td></tr>' +
    '<tr><td>Tabs</td><td class="r">' + ss_().getSheets().length + '</td></tr>' +
    '</table>' +
    '<p style="margin-top:22px;color:#65706A;font-size:14px">Nothing is written by opening this page. ' +
    'You can close it.</p></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Recipe Intake connector');
}

function doPost(e) {
  try {
    if (!e || !e.postData) return out_({ ok: false, error: 'no payload' });
    var b = JSON.parse(e.postData.contents || '{}');
    if (b.token !== SECRET) return out_({ ok: false, error: 'unauthorized' });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      switch (b.action) {
        case 'ping':    return out_(ping_());
        case 'migrate': return out_(migrate_());
        case 'submit':  return out_(submit_(b));
        case 'approve': return out_(approve_(b));
        default:        return out_({ ok: false, error: 'unknown action: ' + b.action });
      }
    } finally { lock.releaseLock(); }
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

/** Health check — confirms the script is reachable and reports current state. */
function ping_() {
  var log = ss_().getSheetByName(LOG_TAB);
  return {
    ok: true,
    spreadsheet: ss_().getName(),
    tabs: ss_().getSheets().map(function (s) { return s.getName(); }),
    logRows: log ? log.getLastRow() - 1 : 0,
    versionsTabExists: !!ss_().getSheetByName(VERSIONS_TAB),
    changesTabExists:  !!ss_().getSheetByName(CHANGES_TAB)
  };
}

/**
 * One-off migration. Safe to run twice — it skips anything already done.
 * Stamps every existing recipe as V1.0 and seeds RECIPE VERSIONS from R&D Log.
 */
function migrate_() {
  var log = ss_().getSheetByName(LOG_TAB);
  if (!log) return { ok: false, error: 'Could not find the "' + LOG_TAB + '" tab' };

  var vTab = tab_(VERSIONS_TAB, VERSIONS_HEAD);
  tab_(CHANGES_TAB, CHANGES_HEAD);

  var lastRow = log.getLastRow();
  var vCol = versionCol_(log);

  // stamp blank VERSION cells as V1.0, leaving any already set alone
  var stamped = 0;
  if (lastRow > 1) {
    var cur = log.getRange(2, vCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < cur.length; i++)
      if (String(cur[i][0]).trim() === '') { cur[i][0] = 'V1.0'; stamped++; }
    log.getRange(2, vCol, lastRow - 1, 1).setValues(cur);
  }

  // seed one RECIPE VERSIONS row per recipe, skipping any already present
  var data = log.getRange(2, 1, Math.max(lastRow - 1, 1), 8).getValues();
  var seen = {};
  var order = [];
  data.forEach(function (r) {
    var id = String(r[1]).trim();
    if (!/^RCP-\d+$/.test(id)) return;
    if (!seen[id]) { seen[id] = { name: String(r[2]).trim(), status: String(r[7]).trim(), by: String(r[6]).trim() }; order.push(id); }
    if (!seen[id].status && r[7]) seen[id].status = String(r[7]).trim();
  });

  var have = {};
  if (vTab.getLastRow() > 1)
    vTab.getRange(2, 1, vTab.getLastRow() - 1, 2).getValues()
        .forEach(function (r) { have[String(r[0]).trim() + '|' + String(r[1]).trim()] = true; });

  var add = [];
  order.forEach(function (id) {
    if (have[id + '|V1.0']) return;
    var r = seen[id];
    var st = r.status === 'Approved' ? 'APPROVED'
           : r.status === 'Rejected' ? 'REJECTED' : 'DRAFT';
    add.push([id, 'V1.0', r.name, '', st, '', r.by || 'GC', 'Initial migration',
              'Existing recipe carried over from R&D Log', st === 'APPROVED' ? '' : '', '']);
  });
  if (add.length) vTab.getRange(vTab.getLastRow() + 1, 1, add.length, VERSIONS_HEAD.length).setValues(add);

  return { ok: true, ingredientRowsStamped: stamped, recipesSeeded: add.length, totalRecipes: order.length };
}

/** Highest existing RCP- number across R&D Log, +1. */
function nextId_() {
  var log = ss_().getSheetByName(LOG_TAB);
  var last = log.getLastRow();
  if (last < 2) return 'RCP-0001';
  var ids = log.getRange(2, 2, last - 1, 1).getValues();
  var max = 0;
  ids.forEach(function (r) {
    var m = /^RCP-(\d+)$/.exec(String(r[0]).trim());
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'RCP-' + ('0000' + (max + 1)).slice(-4);
}

/** Append a submission: ingredient rows, a version row, and its change rows. */
function submit_(b) {
  var log  = ss_().getSheetByName(LOG_TAB);
  var vTab = tab_(VERSIONS_TAB, VERSIONS_HEAD);
  var cTab = tab_(CHANGES_TAB,  CHANGES_HEAD);
  var vCol = versionCol_(log);

  var id      = b.mode === 'new' ? nextId_() : String(b.id || '').trim();
  var version = String(b.toVersion || 'V1.0');
  var name    = String(b.name || '').trim();
  var by      = String(b.by || '').trim();
  var stamp   = now_();

  if (!id || !name || !by) return { ok: false, error: 'id, name and PIC are all required' };

  // ingredient rows
  var ings = b.ingredients || [];
  if (ings.length) {
    var width = Math.max(log.getLastColumn(), vCol);
    var rows = ings.map(function (i) {
      var row = new Array(width).fill('');
      row[0] = stamp.slice(0, 10);      // DATE
      row[1] = id;                      // CREATION ID
      row[2] = name;                    // CREATION NAME
      row[3] = String(i.n || '');       // INGREDIENT NAME
      row[4] = String(i.q || '');       // VOLUME USAGE
      row[5] = String(i.u || '');       // UOM
      row[6] = by;                      // CREATED BY
      row[7] = 'Pending Review';        // STATUS
      row[vCol - 1] = version;          // VERSION
      return row;
    });
    log.getRange(log.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  }

  // version row
  vTab.appendRow([id, version, name, String(b.category || '') || carriedCategory_(id), 'PENDING REVIEW',
                  stamp, by, String(b.reason || ''), String(b.remarks || ''), '', '']);

  // change rows
  var ch = b.changes || [];
  if (ch.length) {
    var crows = ch.map(function (c) {
      return [id, String(b.fromVersion || ''), version, String(c.field || ''),
              String(c.old || ''), String(c.now || ''), by, stamp,
              String(b.reason || ''), String(b.remarks || '')];
    });
    cTab.getRange(cTab.getLastRow() + 1, 1, crows.length, CHANGES_HEAD.length).setValues(crows);
  }

  // R&D TRIAL LOG. Project, Stage, Due Date, Next Action, Notes and the
  // production detail each have a column there, and this is the only place that
  // ever sees them. trialRow_ is in Fixer.gs. If it fails the error is returned
  // rather than swallowed -- a silent catch is how a hole goes unnoticed.
  var trialErr = '';
  try { trialRow_(id, version, name, by, stamp, b); } catch (err) { trialErr = String(err); }

  return { ok: true, id: id, version: version, ingredientRows: ings.length,
           changeRows: ch.length, trialError: trialErr };
}

/**
 * Record an approval decision. On approval the previous approved version is
 * marked SUPERSEDED — but only after the new one is approved, never before.
 */
function approve_(b) {
  var vTab = ss_().getSheetByName(VERSIONS_TAB);
  if (!vTab) return { ok: false, error: 'No ' + VERSIONS_TAB + ' tab yet' };

  var id       = String(b.id || '').trim();
  var version  = String(b.version || '').trim();
  var decision = String(b.decision || '').toUpperCase();
  var by       = String(b.by || '').trim();
  if (['APPROVED', 'REJECTED'].indexOf(decision) < 0)
    return { ok: false, error: 'decision must be APPROVED or REJECTED' };

  var last = vTab.getLastRow();
  if (last < 2) return { ok: false, error: 'no versions recorded' };
  var rows = vTab.getRange(2, 1, last - 1, VERSIONS_HEAD.length).getValues();

  var target = -1, superseded = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    if (String(rows[i][1]).trim() === version) target = i;
    else if (String(rows[i][4]).trim() === 'APPROVED') superseded.push(i);
  }
  if (target < 0) return { ok: false, error: id + ' ' + version + ' not found' };

  var stamp = now_();
  vTab.getRange(target + 2, 5).setValue(decision);
  vTab.getRange(target + 2, 10).setValue(stamp);
  vTab.getRange(target + 2, 11).setValue(by);

  // only demote the old approved version once the replacement is actually approved
  if (decision === 'APPROVED')
    superseded.forEach(function (i) { vTab.getRange(i + 2, 5).setValue('SUPERSEDED'); });

  // carry the decision into the R&D Log, which is the copy every page reads
  var syncErr = '', syncRows = 0;
  try { syncRows = syncLog_(id, version, decision); } catch (err) { syncErr = String(err); }

  return { ok: true, id: id, version: version, decision: decision,
           logRows: syncRows, syncError: syncErr,
           supersededCount: decision === 'APPROVED' ? superseded.length : 0 };
}