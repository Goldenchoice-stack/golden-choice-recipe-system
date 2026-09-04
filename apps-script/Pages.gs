/**
 * Golden Choice — replacing the four page files from the repository.
 *
 * The pages live in the app's Drive folder and are read at request time, so
 * changing one takes effect immediately with no deployment. Getting a new one
 * in there by hand means a file upload, and an upload cannot tell you whether
 * what landed is what you meant — which matters, because `Web.gs` fingerprints
 * these four files and `checkPages()` will call a half-uploaded page tampered
 * with rather than truncated.
 *
 * This does the same job and can prove it:
 *
 *   1. Fetches each page from the repository.
 *   2. REFUSES to write anything whose size and MD5 are not exactly what the
 *      PAGE_FINGERPRINTS in this project's Web.gs expect. A page that does not
 *      match is not written at all — the live one is left alone.
 *   3. Writes in place with setContent, so the Drive file keeps its id and its
 *      "anyone with the link" sharing. Nothing is created and nothing deleted,
 *      which is what stops a drink photo losing its link.
 *   4. Reads each file back afterwards and fingerprints it again, so the report
 *      describes what is now in Drive rather than what was sent.
 *
 * A page already identical is skipped rather than rewritten.
 *
 * The fingerprints are the trust anchor: they live in the deployed Web.gs, not
 * here and not in the repository's answer, so a wrong or tampered file fails
 * loudly instead of being installed.
 *
 * Run updatePagesFromRepository() from the editor.
 */

var PAGE_SOURCE =
  'https://raw.githubusercontent.com/Goldenchoice-stack/golden-choice-recipe-system/costing/pages/';

function md5_(bytes) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
}

function updatePagesFromRepository() {
  var folder = DriveApp.getFolderById(APP_FOLDER);
  var out = [], wrote = 0, same = 0, refused = 0;

  for (var name in PAGE_FINGERPRINTS) {
    if (!PAGE_FINGERPRINTS.hasOwnProperty(name)) continue;
    var want = PAGE_FINGERPRINTS[name];

    var it = folder.getFilesByName(name);
    if (!it.hasNext()) { refused++; out.push('  MISSING  ' + name + ' is not in the app folder.'); continue; }
    var file = it.next();
    var have = md5_(file.getBlob().getBytes());
    if (have === want.md5) { same++; out.push('  same     ' + name); continue; }

    var res = UrlFetchApp.fetch(PAGE_SOURCE + name, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      refused++;
      out.push('  FAILED   ' + name + ' — the repository answered ' + res.getResponseCode() +
               '. The live page is untouched.');
      continue;
    }

    var blob = res.getBlob(), bytes = blob.getBytes(), got = md5_(bytes);
    if (got !== want.md5 || bytes.length !== want.size) {
      refused++;
      out.push('  REFUSED  ' + name + ' — fetched ' + bytes.length + ' bytes, md5 ' + got +
               '; this project expects ' + want.size + ' bytes, md5 ' + want.md5 +
               '. NOT written; the live page is untouched.');
      continue;
    }

    file.setContent(res.getContentText());

    /* Read it back. Anything else is a report about what was sent, not about
       what is now being served. */
    var after = md5_(folder.getFilesByName(name).next().getBlob().getBytes());
    if (after !== want.md5) {
      refused++;
      out.push('  WRONG    ' + name + ' was written but reads back as ' + after +
               '. Replace it by hand from the repository.');
      continue;
    }
    wrote++;
    out.push('  replaced ' + name + '  ' + bytes.length + ' bytes  ' + after);
  }

  var msg = 'PAGES IN THE APP FOLDER\n' + out.join('\n') + '\n\n' +
    wrote + ' replaced, ' + same + ' already correct, ' + refused + ' refused.\n' +
    (refused ? 'Something did not match what this project expects, so it was NOT installed. ' +
               'Nothing partial was written.'
             : 'All four pages are now exactly the copies Web.gs was tested against. ' +
               'checkPages() will read clean.');
  Logger.log(msg);
  return msg;
}
