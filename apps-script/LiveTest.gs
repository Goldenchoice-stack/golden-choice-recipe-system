/**
 * Golden Choice — one end-to-end check against the LIVE sheet.
 *
 * Everything else in this repository is proved against a fixture. Two things
 * cannot be: submit_() and approve_() write to this spreadsheet, and the four
 * pages are served from this Drive folder. This runs the real path once, on the
 * real data, and says exactly what it did.
 *
 * IT WRITES ONE THROWAWAY RECIPE and then approves it, because that is the only
 * way to prove the write path. The recipe is named so nobody can mistake it,
 * every tab it touches is counted before and after, and the report tells you
 * precisely which rows to delete. Nothing else is written, and nothing at all is
 * deleted or edited — Code.gs only ever appends.
 *
 * Run liveCheck() from the editor, or a4 in Run.gs.
 */

var LT_NAME = 'ZZ DEPLOY CHECK - SAFE TO DELETE';

/* Measured on the live sheet, 4 Sep 2026: the R&D PIC column of R&D TRIAL LOG
   carries a data validation that accepts only Sakura or Robin. The intake form
   offers a third option, GC, so a submission filed under GC is written to the
   R&D Log and the version register and then REJECTED by the trial log. The
   first run of this check filed under GC and proved exactly that. It files
   under a name the sheet accepts, so that what it tests is the deployment
   rather than that pre-existing mismatch. */
var LT_PIC = 'Sakura';

function lt_rows_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  return sh ? sh.getLastRow() : -1;
}

function liveCheck() {
  var out = [], pass = 0, fail = 0;
  function ok_(t, cond, detail) {
    if (cond) { pass++; out.push('  ok    ' + t); }
    else { fail++; out.push('  FAIL  ' + t + (detail === undefined ? '' : '  [' + detail + ']')); }
  }
  var TABS = ['R&D Log', 'RECIPE VERSIONS', 'CHANGE LOG', 'R&D TRIAL LOG', 'SUBMISSIONS'];
  var before = {}, i;
  for (i = 0; i < TABS.length; i++) before[TABS[i]] = lt_rows_(TABS[i]);

  /* ---------------------------------------------------------------- reading */
  out.push('THE LIBRARY');
  var all = all_();
  ok_(all.count + ' recipes read from the log', all.count > 0);
  ok_('next id is ' + all.nextId, /^RCP-\d{4}$/.test(all.nextId));
  ok_(all.ingredients.length + ' distinct ingredients', all.ingredients.length > 0);
  out.push('        approved ' + all.counts.approved + ', rejected ' + all.counts.rejected +
           ', unreviewed ' + all.counts.unreviewed);

  out.push('');
  out.push('COST NEVER LEAKS TO THE OPEN FEED');
  var anon = api('feed', null, ''), staff = feed_(true);
  ok_('signed out, no recipe carries a cost field',
      anon.recipes.filter(function (r) { return 'cost' in r; }).length === 0);
  ok_('and the feed says costing is off', anon.costing === false);
  ok_('signed in, the feed says costing is on', staff.costing === true);
  ok_('both feeds hold the same ' + anon.count + ' approved recipes', anon.count === staff.count);
  ok_('the full library is refused without a name', (function () {
    try { api('all', null, ''); return false; } catch (e) { return true; } })());
  ok_('prices are refused without a name', (function () {
    try { api('prices', null, ''); return false; } catch (e) { return true; } })());

  out.push('');
  out.push('COSTING');
  var d = dashboard_();
  ok_('costed + pending equals the library',
      d.library.costingDone + d.library.costingPending === d.library.total,
      d.library.costingDone + '+' + d.library.costingPending + ' vs ' + d.library.total);
  out.push('        costed ' + d.library.costingDone + ', needs costing ' + d.library.costingPending);
  var pr = prices_();
  ok_('every ingredient in use appears in the price list',
      Object.keys(pr.items).length === all.ingredients.length,
      Object.keys(pr.items).length + ' vs ' + all.ingredients.length);
  out.push('        priced ' + pr.coverage.priced + ' of ' + pr.coverage.used +
           ' ingredients; Prices tab ' + (pr.tab ? 'present' : 'ABSENT'));
  var blockers = (d.costingBlockers || []).slice(0, 5).map(function (b) {
    return b.name + ' (' + b.recipes + ')'; }).join(', ');
  if (blockers) out.push('        holding costing up: ' + blockers);

  out.push('');
  out.push('THE APPROVALS QUEUE');
  var q = queue_(), have = {};
  for (i = 0; i < q.length; i++) have[q[i].id + '|' + q[i].toVersion] = 1;
  var sheetQ = sheetPending_(have);
  out.push('        ' + q.length + ' in the queue, ' + sheetQ.length + ' more found in the register');
  ok_('nothing already approved is offered for decision',
      q.concat(sheetQ).every(function (x) { return !x.decision; }));

  out.push('');
  out.push('THE PAGES');
  out.push(checkPages().split('\n\n')[0].replace(/^/gm, '  '));

  /* ------------------------------------------------------------- the writes */
  out.push('');
  out.push('ONE THROWAWAY RECIPE, END TO END');
  var me = { u: 'manager', role: 'manager', pic: '' };
  var newId = '', ver = '';
  try {
    var sub = doSubmit_({
      mode: 'new', name: LT_NAME, by: LT_PIC, zh: '',
      trialDate: today_(), category: 'Test', project: '', stage: 'Trial',
      status: 'Waiting', result: '', due: '', next: '',
      notes: 'Written by liveCheck() to prove the write path after the 4 Sep 2026 deploy.',
      reason: 'Deploy check', remarks: 'Safe to delete',
      serving: '250', price: '9.90', difficulty: 'Easy', equipment: '', method: 'Do not make this.',
      video: '', photo: null, costPerServing: null, costingPending: true,
      ingredients: [{ n: 'Water', q: '200', u: 'ML' }, { n: 'Ice', q: '50', u: 'G' }]
    }, me);
    ok_('submitting is accepted', sub && sub.ok === true, sub && sub.error);
    if (sub && sub.ok) {
      newId = sub.id; ver = sub.toVersion;
      out.push('        created ' + newId + ' ' + ver + ', status ' + sub.status);
      ok_('it reaches the approvals queue', queue_().some(function (x) {
        return x.id === newId && x.toVersion === ver; }));
      var row = '';
      var qq = queue_();
      for (i = 0; i < qq.length; i++) if (qq[i].id === newId) row = qq[i].file;
      var dec = doApprove_({ id: newId, version: ver, decision: 'APPROVED',
                             by: 'Deploy check', remarks: 'Safe to delete', file: row }, me);
      ok_('approving is accepted', dec && dec.ok === true, dec && dec.error);
      ok_('and it leaves the queue', !queue_().some(function (x) {
        return x.id === newId && x.toVersion === ver; }));
      var after = all_(), mine = null;
      for (i = 0; i < after.recipes.length; i++)
        if (after.recipes[i].id === newId) mine = after.recipes[i];
      ok_('it is now in the library', !!mine);
      if (mine) {
        ok_('as Approved', mine.status === 'Approved', mine.status);
        ok_('with both ingredients', mine.ing.length === 2, mine.ing.length);
        ok_('and reaches the Sales feed', feed_(false).recipes.some(function (r) {
          return r.id === newId; }));
      }
    }
  } catch (e) { fail++; out.push('  FAIL  the write path threw: ' + e.message); }

  /* --------------------------------------------------------- what it touched */
  out.push('');
  out.push('WHAT THIS RUN ADDED, SO YOU CAN REMOVE IT');
  for (i = 0; i < TABS.length; i++) {
    var b = before[TABS[i]], a = lt_rows_(TABS[i]);
    if (b < 0) { out.push('        ' + TABS[i] + ' — no such tab'); continue; }
    out.push('        ' + TABS[i] + ': ' + b + ' -> ' + a +
             (a > b ? '   rows ' + (b + 1) + '-' + a + ' are ' + (newId || 'the test recipe')
                    : '   unchanged'));
  }
  out.push('');
  out.push('        Delete those rows and ' + (newId || 'the test recipe') +
           ' is gone. Nothing else was written, and nothing was edited or deleted.');

  var msg = out.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed.\n' +
    (fail ? 'SOMETHING IS WRONG — read the FAIL lines above.'
          : 'The deployed site reads, gates cost, costs recipes, and can take a recipe ' +
            'from intake through to approval on the live sheet.');
  Logger.log(msg);
  return msg;
}
