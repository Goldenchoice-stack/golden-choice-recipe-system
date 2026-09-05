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
 * AND IT WILL NOT OVERWRITE A PAGE IT DID NOT PUT THERE. All of the above checks
 * the SOURCE. None of it looked at what is already live, so a page somebody else
 * had improved would be silently replaced by this project's older copy — which
 * nearly happened on 5 Sep 2026, when three of the four live pages turned out to
 * have been changed by another editor while this repository still held the
 * previous ones.
 *
 * So every successful write records the md5 it left behind, in Script
 * Properties. If the live page no longer carries that fingerprint, somebody
 * changed it since this project wrote it, and it is left alone and named in the
 * report.
 *
 * WITH NO RECORD IT STILL INSTALLS, and that is deliberate rather than lax. A
 * page this project has never written could equally be a stale copy from an
 * older version of this project or somebody's newer work, and nothing available
 * here tells them apart — so refusing would only be a guess wearing a safety
 * jacket, and it would break the first install of a fresh project. It writes,
 * and prints the md5 it replaced, which is what makes the change recoverable.
 *
 * installPages(true) overrides that, and is the honest way to say "yes, discard
 * what is live". It is never the default.
 *
 * Run installPages() from the editor.
 */

/* What this project last left in Drive for a page, so it can tell its own work
   from somebody else's. */
function pageMark_(name) { return 'GC_PAGE_MD5_' + name.replace(/[^A-Za-z0-9]+/g, '_'); }

function md5_(bytes) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
}

function installPages(force) {
  var folder = DriveApp.getFolderById(APP_FOLDER);
  var props = PropertiesService.getScriptProperties();
  var out = [], wrote = 0, same = 0, refused = 0, guarded = 0;

  for (var name in PAGE_FINGERPRINTS) {
    if (!PAGE_FINGERPRINTS.hasOwnProperty(name)) continue;
    var want = PAGE_FINGERPRINTS[name];

    var it = folder.getFilesByName(name);
    if (!it.hasNext()) { refused++; out.push('  MISSING  ' + name + ' is not in the app folder.'); continue; }
    var file = it.next();
    var have = md5_(file.getBlob().getBytes());
    if (have === want.md5) { same++; out.push('  same     ' + name); continue; }

    /* The live page differs from what this project expects. That is either a
       page this project installed and has since moved on from, or somebody
       else's newer work. Only the first is safe to replace. */
    var mine = props.getProperty(pageMark_(name));
    if (mine && have !== mine && !force) {
      guarded++;
      out.push('  KEPT     ' + name + ' — this project last left ' + mine + ' there, and the ' +
               'live page\n           now reads ' + have + '. Somebody changed it since, so ' +
               'it was LEFT ALONE.\n           To keep theirs, regenerate PagesData.gs from ' +
               'the live file. To discard\n           it, run installPages(true).');
      continue;
    }
    /* No record means this project has never written this page, so there is
       nothing to compare against and no claim worth making. It installs, and
       says what it replaced — the md5 in the report is how you get back. */
    if (!mine) out.push('  note     ' + name + ' had no record from this project; replacing ' +
                        have);

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
    props.setProperty(pageMark_(name), after);   /* so the next run knows this was ours */
    wrote++;
    out.push('  replaced ' + name + '  ' + bytes.length + ' bytes  ' + after);
  }

  var msg = 'PAGES IN THE APP FOLDER' + (force ? '  (FORCED)' : '') + '\n' +
    out.join('\n') + '\n\n' +
    wrote + ' replaced, ' + same + ' already correct, ' + guarded +
    ' left alone because somebody else changed them, ' + refused + ' refused.\n' +
    (guarded ? 'A page somebody else changed is worth more than this project\'s older copy, ' +
               'so\nit was kept. Nothing about it was written.\n' : '') +
    (refused ? 'Something did not match what Web.gs expects, so it was NOT installed. ' +
               'Nothing partial was written.'
             : guarded ? 'Everything else is exactly the copy Web.gs was tested against.'
             : 'All four pages are now exactly the copies Web.gs was tested against. ' +
               'checkPages() will read clean.');
  Logger.log(msg);
  return msg;
}
