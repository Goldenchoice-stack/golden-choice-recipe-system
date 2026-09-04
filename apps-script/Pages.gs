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
 *   1. Takes each page from PagesData.gs, which is generated from the tested
 *      files and carried inside this project. Nothing is fetched, so this needs
 *      no permission the project did not already have, and the live pages never
 *      depend on a server outside the company.
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
 * The fingerprints are the trust anchor: they live in Web.gs and the bytes live
 * in PagesData.gs, so the two have to agree independently before anything is
 * written. A page that is wrong in either place fails loudly rather than being
 * installed.
 *
 * Run installPages() from the editor.
 */

function md5_(bytes) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
}

function installPages() {
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

    var text = (typeof PAGE_DATA !== 'undefined') ? PAGE_DATA[name] : null;
    if (text == null) {
      refused++;
      out.push('  MISSING  ' + name + ' is not in PagesData.gs. The live page is untouched.');
      continue;
    }

    var bytes = Utilities.newBlob(text).getBytes(), got = md5_(bytes);
    if (got !== want.md5 || bytes.length !== want.size) {
      refused++;
      out.push('  REFUSED  ' + name + ' — PagesData.gs holds ' + bytes.length + ' bytes, md5 ' + got +
               '; Web.gs expects ' + want.size + ' bytes, md5 ' + want.md5 +
               '. NOT written; the live page is untouched.');
      continue;
    }

    file.setContent(text);

    /* Read it back. Anything else is a report about what was sent, not about
       what is now being served. */
    var after = md5_(folder.getFilesByName(name).next().getBlob().getBytes());
    if (after !== want.md5) {
      refused++;
      out.push('  WRONG    ' + name + ' was written but reads back as ' + after +
               '. Replace it by hand.');
      continue;
    }
    wrote++;
    out.push('  replaced ' + name + '  ' + bytes.length + ' bytes  ' + after);
  }

  var msg = 'PAGES IN THE APP FOLDER\n' + out.join('\n') + '\n\n' +
    wrote + ' replaced, ' + same + ' already correct, ' + refused + ' refused.\n' +
    (refused ? 'Something did not match what Web.gs expects, so it was NOT installed. ' +
               'Nothing partial was written.'
             : 'All four pages are now exactly the copies Web.gs was tested against. ' +
               'checkPages() will read clean.');
  Logger.log(msg);
  return msg;
}
