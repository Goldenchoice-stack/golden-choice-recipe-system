/**
 * Golden Choice — putting the AutoCount read token where the script can find it.
 *
 * The Script Properties form is the obvious place for this and it kept losing the
 * row: typed, pasted, and then simply absent from the list afterwards. Three
 * separate checks agreed it had not saved, which is a bad way to spend an
 * afternoon and a worse way to find out later.
 *
 * So this does the same job with a Run button, and answers the question the form
 * never did: DID IT WORK. It proves the token against the real server BEFORE
 * writing it, so a saved token is a working token, and a bad one is refused with
 * the reason rather than stored and discovered days later.
 *
 * HOW TO USE IT
 *   1. Paste the token between the quotes below, replacing PASTE-THE-TOKEN-HERE.
 *   2. Save (Ctrl+S / Cmd+S), then Run -> saveSyncToken.
 *   3. Read what it says. On success it prints how big the snapshot was.
 *   4. Put PASTE-THE-TOKEN-HERE back, and save again.
 *
 * The token is never logged, never returned, and never put in an error message,
 * so nothing here writes it anywhere except Script Properties. Step 4 still
 * matters: until you do it the token sits in this file, and this file is a copy
 * of the token in a place nobody thinks to look.
 */

var PASTE_SYNC_TOKEN = 'PASTE-THE-TOKEN-HERE';

function saveSyncToken() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty(AC_PROP_URL) || '').trim();
  if (!url)
    return 'NOT SAVED. ' + AC_PROP_URL + ' is missing, so there is nothing to test the ' +
           'token against. Set it first.';

  var token = String(PASTE_SYNC_TOKEN == null ? '' : PASTE_SYNC_TOKEN).trim();
  if (!token || token === 'PASTE-THE-TOKEN-HERE')
    return 'NOT SAVED. Paste the token between the quotes on the PASTE_SYNC_TOKEN line ' +
           'near the top of this file, save, then run this again.';

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
    return 'NOT SAVED. The sync server could not be reached at all. Check ' +
           AC_PROP_URL + '. Nothing was stored.';
  }

  if (code === 401 || code === 403)
    return 'NOT SAVED. The sync server refused that token (' + code + '). It is the ' +
           'wrong value, or it has been rotated. Copy DASHBOARD_READ_TOKEN from the ' +
           'sync service again. Nothing was stored.';
  if (code !== 200)
    return 'NOT SAVED. The sync server answered ' + code + ', so the token could not be ' +
           'proved either way. Nothing was stored.';

  var body;
  try { body = JSON.parse(res.getContentText()); }
  catch (e2) { return 'NOT SAVED. The sync server answered 200 but not with JSON. ' +
                      'Nothing was stored.'; }

  var items = (body.items || []).length, prices = (body.supplierPrices || []).length;
  if (!items || !prices)
    return 'NOT SAVED. The token works, but that snapshot carries ' + items + ' items ' +
           'and ' + prices + ' supplier prices — one of them is empty, so the refresh ' +
           'would price nothing. Ask for the snapshot to be uploaded again.';

  props.setProperty(AC_PROP_TOKEN, token);

  return 'SAVED, AND PROVED.\n\n' +
    '  The sync server accepted the token and returned ' + items + ' items and ' +
    prices + ' supplier prices.\n' +
    '  ' + AC_PROP_TOKEN + ' is now in Script Properties.\n\n' +
    'NOW PUT PASTE-THE-TOKEN-HERE BACK between the quotes above and save. Until you\n' +
    'do, this file holds a working token in a place nobody thinks to look.\n\n' +
    'Then run a4_previewPrices to see what the refresh would do. It writes nothing.';
}

/* Does the stored token still work? Reads nothing out of this file, so it is
   safe to run after the constant has been put back. */
function checkSyncToken() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty(AC_PROP_URL) || '').trim();
  var token = String(props.getProperty(AC_PROP_TOKEN) || '').trim();
  if (!url || !token)
    return 'Not set yet: ' + (!url ? AC_PROP_URL : '') + (!url && !token ? ' and ' : '') +
           (!token ? AC_PROP_TOKEN : '') + ' is missing from Script Properties.';
  var stale = String(PASTE_SYNC_TOKEN || '').trim();
  var warn = (stale && stale !== 'PASTE-THE-TOKEN-HERE')
    ? '\n\nWARNING: Token.gs still holds a token in PASTE_SYNC_TOKEN. Put ' +
      'PASTE-THE-TOKEN-HERE back and save.' : '';
  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  var res = UrlFetchApp.fetch(url + sep + 'datasets=items,supplierPrices&cost=include', {
    method: 'get', headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true, followRedirects: false });
  if (res.getResponseCode() !== 200)
    return 'The stored token is NOT working: the server answered ' +
           res.getResponseCode() + '.' + warn;
  var body = JSON.parse(res.getContentText());
  return 'The stored token works. The snapshot carries ' + (body.items || []).length +
         ' items and ' + (body.supplierPrices || []).length + ' supplier prices.' + warn;
}
