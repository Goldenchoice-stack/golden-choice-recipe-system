/**
 * One function, so the editor's picker selects it the moment this file is
 * opened. Reads only; changes nothing.
 *
 * WHAT A REFUSED PIC ACTUALLY LEAVES BEHIND. The first guess was that the trial
 * row is simply missing. It is not. setValues writes the row and Google rejects
 * only the offending cell, so the row exists with its date, drink id, name and
 * version — and then stops. The R&D PIC cell is empty, and so is everything
 * after it: category, project, stage, status, and the eight production columns
 * that carry serving size, selling price, difficulty, equipment, method, video,
 * Chinese name and photo.
 *
 * So the signature is not "no trial row". It is "a trial row with no PIC".
 * That is what this looks for, alongside the versions that have no row at all.
 */
function findHalfWrittenRecipes() {
  var T = TRIALCOLS_(), out = [], i;
  var tr = rows_(FIX_GID.trial);

  var noPic = [], firstTrial = '';
  for (i = 0; i < tr.length; i++) {
    var id = cell_(tr[i], T.id);
    if (!id) continue;
    var d = cell_(tr[i], T.date);
    if (d && (!firstTrial || d < firstTrial)) firstTrial = d;
    if (cell_(tr[i], T.pic)) continue;                    /* the PIC landed */
    noPic.push({
      row: i + 2, id: id, ver: cell_(tr[i], T.ver) || 'V1.0',
      date: d, name: cell_(tr[i], T.name),
      serve: cell_(tr[i], T.serve), price: cell_(tr[i], T.price),
      zh: cell_(tr[i], T.zh), photo: cell_(tr[i], T.photo)
    });
  }

  /* Whether each one is the version the library actually serves. A recipe whose
     live version is a later, complete one has lost nothing anybody can see; one
     whose LIVE version is the half-written row is missing detail on the page
     Sales opens today. That is the difference between history and a job. */
  var lib = library_(), live = {};
  for (i = 0; i < lib.length; i++) live[lib[i].id] = lib[i];

  out.push('TRIAL ROWS WITH NO R&D PIC');
  out.push('  The PIC cell is the one the validation refused, so an empty one on a');
  out.push('  row that otherwise exists is the mark of a submission that stopped there.');
  out.push('');
  if (!noPic.length) out.push('  none — every trial row carries a PIC.');
  else {
    for (i = 0; i < noPic.length; i++) {
      var r = noPic[i], gaps = [];
      if (!r.serve) gaps.push('serving size');
      if (!r.price) gaps.push('selling price');
      if (!r.zh)    gaps.push('Chinese name');
      if (!r.photo) gaps.push('photo');
      var cur = live[r.id];
      var isLive = cur && cur.version === r.ver;
      out.push('  row ' + r.row + '  ' + (r.date || '(no date)') + '  ' + r.id + ' ' + r.ver +
               '  ' + r.name);
      out.push('        missing: ' + (gaps.length ? gaps.join(', ') : 'nothing else'));
      out.push('        ' + (isLive
        ? '>> THIS IS THE LIVE VERSION (' + cur.status + '). The gaps above are what ' +
          'Sales sees on this recipe today.'
        : cur ? 'not live — the library serves ' + cur.version + ' (' + cur.status +
                '), so nothing visible is missing'
              : 'this recipe is not in the library at all'));
    }
  }

  /* And the other shape: a version the trial log never got a row for at all. */
  out.push('');
  out.push('VERSIONS WITH NO TRIAL ROW AT ALL');
  var have = {};
  for (i = 0; i < tr.length; i++) {
    var tid = cell_(tr[i], T.id);
    if (tid) have[tid + '|' + (cell_(tr[i], T.ver) || 'V1.0')] = true;
  }
  var reg = fixTab_(FIX_GID.ver, FIX_NAME.ver), n = reg.getLastRow();
  var R = n > 1 ? reg.getRange(2, 1, n - 1, 11).getValues() : [];
  var none = [], old = 0;
  for (i = 0; i < R.length; i++) {
    var vid = String(R[i][0]).trim(), vv = String(R[i][1]).trim();
    if (!vid || !vv || have[vid + '|' + vv]) continue;
    var made = String(R[i][5] || '').slice(0, 10);
    if (firstTrial && made && made < firstTrial) { old++; continue; }
    none.push('  ' + made + '  ' + vid + ' ' + vv + '  [' + String(R[i][4] || '').trim() +
              ']  ' + String(R[i][2] || ''));
  }
  out.push('  (' + old + ' version(s) predate the trial log, which began ' +
           (firstTrial || '(unknown)') + ', and are not faults)');
  out.push(none.length ? none.join('\n') : '  none since then.');

  var total = noPic.length + none.length;
  out.push('');
  out.push(total
    ? total + ' recipe version(s) are missing production detail. None of it can be ' +
      'recovered automatically — the serving size, selling price, Chinese name and ' +
      'photo were never written anywhere, so each has to be re-entered through the ' +
      'intake as an update.'
    : 'Nothing is in either shape.');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}
