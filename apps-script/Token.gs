/**
 * Golden Choice — putting the AutoCount read token where the script can find it.
 *
 * THE HARD PART WAS NEVER THE STORING. It was making sure the token landed in
 * THIS project. There are two Apps Script copies of this system under two Google
 * accounts, and four separate attempts to save the token succeeded — in the other
 * one. Every instruction that begins "open the Apps Script project" can be
 * followed perfectly and still reach the wrong copy, because both copies look
 * identical from the inside.
 *
 * So the way in is the SPREADSHEET, not the script. R&D Tools -> Setup -> Set GC
 * Sync Token is a menu on the live sheet, served by the script bound to it. Open
 * the sheet by its id and the menu you get can only belong to the live project.
 * There is no copy to land in.
 *
 * The token is typed into a modal prompt. It is never written to a cell, never
 * logged, never echoed back into the dialog, and never put in an error message —
 * including the catch, where an exception can carry the request that produced it.
 *
 * It is checked before it is kept: the sync server has to answer 200 and return
 * a snapshot with both items and supplier prices in it. A token that does not
 * work is not stored, and the reason is shown instead.
 *
 * The success dialog names the script id it wrote to. That is the whole point:
 * if it is ever run in the copy again, the id on screen will say so.
 */

/* Says it out loud AND hands it back, so it reads the same from the editor, from
   the menu, and from a test. A function that only RETURNS a string shows nothing
   at all when it is run from the Apps Script editor. */
function tk_(msg) { Logger.log(msg); return msg; }

/* SUPERSEDED by the menu above, and kept only until that has been used once.
   Pasting a credential into a source file is what let it be saved into the wrong
   copy four times: a file can be edited anywhere, a bound menu cannot. */
var PASTE_SYNC_TOKEN = 'PASTE-THE-TOKEN-HERE';

/**
 * Checks a token against the sync server and stores it only if it works.
 * Returns a message that NEVER contains the token, on every path.
 */
function syncTokenStore_(token) {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty(AC_PROP_URL) || '').trim();
  if (!url)
    return 'NOT SAVED\n\n' + AC_PROP_URL + ' is not set in this project, so there is ' +
           'nothing to check the token against.';

  token = String(token == null ? '' : token).trim();
  if (!token) return 'NOT SAVED\n\nNothing was pasted.';

  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  var res, code;
  try {
    res = UrlFetchApp.fetch(url + sep + 'datasets=items,supplierPrices&cost=include', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
      followRedirects: false
    });
    code = res.getResponseCode();
  } catch (e) {
    /* e.message can echo the request, and the request carries the token. */
    return 'NOT SAVED\n\nThe sync server could not be reached. Nothing was stored.';
  }

  if (code === 401 || code === 403)
    return 'NOT SAVED\n\nThe sync server refused that token (' + code + '). Copy ' +
           'DASHBOARD_READ_TOKEN from the sync service again. Nothing was stored.';
  if (code !== 200)
    return 'NOT SAVED\n\nThe sync server answered ' + code + ', so the token could not ' +
           'be proved either way. Nothing was stored.';

  var body;
  try { body = JSON.parse(res.getContentText()); }
  catch (e2) { return 'NOT SAVED\n\nThe sync server answered 200 but not with JSON. ' +
                      'Nothing was stored.'; }

  var items = (body.items || []).length, prices = (body.supplierPrices || []).length;
  if (!items || !prices)
    return 'NOT SAVED\n\nThe token works, but that snapshot carries ' + items + ' items ' +
           'and ' + prices + ' supplier prices — one of them is empty, so the refresh ' +
           'would price nothing. Nothing was stored.';

  props.setProperty(AC_PROP_TOKEN, token);

  /* The script id is the answer to "did it go into the right copy this time".
     It is not a secret, and it is the only thing on screen worth checking. */
  var where = '';
  try { where = ScriptApp.getScriptId(); } catch (e3) { where = '(script id unavailable)'; }

  return 'SAVED AND PROVED\n\n' +
         items + ' items\n' +
         prices + ' supplier prices\n\n' +
         'Stored in this project as ' + AC_PROP_TOKEN + '.\n' +
         'Script id: ' + where;
}

/**
 * R&D Tools -> Setup -> Set GC Sync Token.
 *
 * A modal prompt on the live spreadsheet. The token exists in the dialog and in
 * one local variable, and nowhere else.
 */
function setSyncToken() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); }
  catch (e) {
    return 'This is a menu item on the R&D Log spreadsheet, not something to run from ' +
           'the editor. Open the sheet and use R&D Tools -> Setup -> Set GC Sync Token.';
  }
  var res = ui.prompt('Set GC Sync Token',
    'Paste DASHBOARD_READ_TOKEN from the gc-ai-coo-central-sync service.\n\n' +
    'It is checked against the sync server before it is kept, and it is never written ' +
    'to a cell, a log, or shown again.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return 'Cancelled. Nothing was stored.';
  var msg = syncTokenStore_(res.getResponseText());
  ui.alert('Set GC Sync Token', msg, ui.ButtonSet.OK);
  return msg;
}

function saveSyncToken() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty(AC_PROP_URL) || '').trim();
  if (!url)
    return tk_('NOT SAVED. ' + AC_PROP_URL + ' is missing, so there is nothing to test the ' +
           'token against. Set it first.');

  var token = String(PASTE_SYNC_TOKEN == null ? '' : PASTE_SYNC_TOKEN).trim();
  if (!token || token === 'PASTE-THE-TOKEN-HERE')
    return tk_('NOT SAVED. Paste the token between the quotes on the PASTE_SYNC_TOKEN line ' +
           'near the top of this file, save, then run this again.');

  /* Proved before it is stored. A token that does not work is not worth keeping,
     and finding that out now is the whole point of this file. */
  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  var res, code;
  try {
    res = UrlFetchApp.fetch(url + sep + 'datasets=items,supplierPrices&cost=include', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
      followRedirects: false
    });
    code = res.getResponseCode();
  } catch (e) {
    /* e.message can echo the request. Only the class of failure is reported. */
    return tk_('NOT SAVED. The sync server could not be reached at all. Check ' +
           AC_PROP_URL + '. Nothing was stored.');
  }

  if (code === 401 || code === 403)
    return tk_('NOT SAVED. The sync server refused that token (' + code + '). It is the ' +
           'wrong value, or it has been rotated. Copy DASHBOARD_READ_TOKEN from the ' +
           'sync service again. Nothing was stored.');
  if (code !== 200)
    return tk_('NOT SAVED. The sync server answered ' + code + ', so the token could not be ' +
           'proved either way. Nothing was stored.');

  var body;
  try { body = JSON.parse(res.getContentText()); }
  catch (e2) { return tk_('NOT SAVED. The sync server answered 200 but not with JSON. ' +
                          'Nothing was stored.'); }

  var items = (body.items || []).length, prices = (body.supplierPrices || []).length;
  if (!items || !prices)
    return tk_('NOT SAVED. The token works, but that snapshot carries ' + items + ' items ' +
           'and ' + prices + ' supplier prices — one of them is empty, so the refresh ' +
           'would price nothing. Ask for the snapshot to be uploaded again.');

  props.setProperty(AC_PROP_TOKEN, token);

  return tk_('SAVED, AND PROVED.\n\n' +
    '  The sync server accepted the token and returned ' + items + ' items and ' +
    prices + ' supplier prices.\n' +
    '  ' + AC_PROP_TOKEN + ' is now in Script Properties.\n\n' +
    'NOW PUT PASTE-THE-TOKEN-HERE BACK between the quotes above and save. Until you\n' +
    'do, this file holds a working token in a place nobody thinks to look.\n\n' +
    'Then run a4_previewPrices to see what the refresh would do. It writes nothing.');
}

/* Does the stored token still work? Reads nothing out of this file, so it is
   safe to run after the constant has been put back. */
function checkSyncToken() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty(AC_PROP_URL) || '').trim();
  var token = String(props.getProperty(AC_PROP_TOKEN) || '').trim();
  if (!url || !token)
    return tk_('Not set yet: ' + (!url ? AC_PROP_URL : '') + (!url && !token ? ' and ' : '') +
           (!token ? AC_PROP_TOKEN : '') + ' is missing from Script Properties.');
  var stale = String(PASTE_SYNC_TOKEN || '').trim();
  var warn = (stale && stale !== 'PASTE-THE-TOKEN-HERE')
    ? '\n\nWARNING: Token.gs still holds a token in PASTE_SYNC_TOKEN. Put ' +
      'PASTE-THE-TOKEN-HERE back and save.' : '';
  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  var res = UrlFetchApp.fetch(url + sep + 'datasets=items,supplierPrices&cost=include', {
    method: 'get', headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true, followRedirects: false });
  if (res.getResponseCode() !== 200)
    return tk_('The stored token is NOT working: the server answered ' +
           res.getResponseCode() + '.' + warn);
  var body = JSON.parse(res.getContentText());
  return tk_('The stored token works. The snapshot carries ' + (body.items || []).length +
         ' items and ' + (body.supplierPrices || []).length + ' supplier prices.' + warn);
}
