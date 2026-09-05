/**
 * Golden Choice — R&D web app.
 *
 * Add this as a SECOND file in the spreadsheet's own Apps Script project, next
 * to Code.gs and Fixer.gs. It serves the four pages and answers the calls they
 * make. The sheet stays the record, exactly as it is today.
 *
 * It deliberately writes almost nothing itself. Submitting calls submit_() and
 * approving calls approve_() — the functions already in Code.gs that have been
 * writing to this sheet since August. Everything they do in passing keeps
 * happening, unchanged, because it is still them doing it.
 *
 * ONE EDIT IS NEEDED IN Code.gs: rename its "function doGet()" to
 * "function connectorStatus_()". Two functions cannot both be doGet, and this
 * file's doGet is the one that serves the site. Nothing calls the old one.
 *
 * -------------------------------------------------------------------------
 * Deploy → New deployment → Web app, "Execute as: Me", "Who has access:
 * Anyone". One deployment, one URL, for Sales and for R&D alike.
 *
 * The three names and passwords are the ones already in use. Nothing about
 * signing in changes: the Recipe Finder is open, the other three pages ask,
 * and approving stays the manager's.
 * -------------------------------------------------------------------------
 */

/* ---------------------------------------------------------------- secrets
 *
 * NOTHING SECRET IS IN THIS FILE. The salt, the signing key, the Drive folder
 * id and the three password hashes are read from Script Properties, which is
 * what lets this file be pasted whole out of a public repository without a
 * placeholder ever reaching production — the failure that takes the site down
 * silently, because a missing folder id throws on every page load and a changed
 * salt signs everybody out at once.
 *
 * The PASTE-… values below are a FALLBACK, used only where the matching
 * property is unset. A project that has not been migrated yet still has its
 * real values here and goes on working untouched; run moveSecretsToProperties()
 * from Secrets.gs and it reads them out of this file into Script Properties for
 * you, so no secret is ever typed, transcribed or seen.
 *
 *   GC_AUTH_SALT     GC_AUTH_SECRET   GC_APP_FOLDER
 *   GC_SHA_MANAGER   GC_SHA_SAKURA    GC_SHA_ROBIN
 */

/* Fetched once per execution rather than six times. */
var SECRETS_ = (function () {
  try { return PropertiesService.getScriptProperties().getProperties() || {}; }
  catch (e) { return {}; }
})();
function prop_(key, fallback) {
  var v = SECRETS_[key];
  return (v === undefined || v === null || v === '') ? fallback : v;
}

var AUTH_SALT = prop_('GC_AUTH_SALT', 'PASTE-THE-PASSWORD-SALT-HERE');

/* Signs the session token. Changing it ends every session at once, which is the
   point of having it separate from the passwords. */
var AUTH_SECRET = prop_('GC_AUTH_SECRET', 'PASTE-THE-TOKEN-SIGNING-KEY-HERE');

/* The Drive folder holding the four page files and the drink photos. The
   script runs as you, so nothing here needs sharing with anybody. */
var APP_FOLDER = prop_('GC_APP_FOLDER', 'PASTE-THE-DRIVE-FOLDER-ID-HERE');

/* The three accounts: same names, same passwords, same salted hashes the site
   has always checked against. 'pic' is the R&D PIC that name files work under,
   so the intake form opens on it. Only the hash is secret, so only the hash
   moves out; a fourth person is a fourth line here plus a GC_SHA_<NAME>
   property.

   To change a password, hash the new one the same way and put the result in
   that name's property:
     node -e "console.log(require('crypto').createHash('sha256').update('NEWPASS'+'THE-SALT').digest('hex'))" */
var USER_SHAPE = {
  manager: { role: 'manager', pic: '',       sha: 'PASTE-SHA256-OF-SALT-PLUS-MANAGER-PASSWORD' },
  sakura:  { role: 'bi',      pic: 'Sakura', sha: 'PASTE-SHA256-OF-SALT-PLUS-SAKURA-PASSWORD' },
  robin:   { role: 'bi',      pic: 'Robin',  sha: 'PASTE-SHA256-OF-SALT-PLUS-ROBIN-PASSWORD' }
};
function shaProp_(name) { return 'GC_SHA_' + String(name).toUpperCase(); }
var USERS = (function () {
  var out = {};
  for (var n in USER_SHAPE) {
    if (!USER_SHAPE.hasOwnProperty(n)) continue;
    out[n] = { role: USER_SHAPE[n].role, pic: USER_SHAPE[n].pic,
               sha: prop_(shaProp_(n), USER_SHAPE[n].sha) };
  }
  return out;
})();

var GID = { log: 1784376487, ver: 2145004234, trial: 863907825 };
var QUEUE_TAB = 'SUBMISSIONS';

/* The price list. Found by name, so there is no id to copy and nothing to
   redeploy when it is created: name the tab this, fill it in, reload. */
var PRICES_TAB = 'Prices';

/* ------------------------------------------------------------------ people */

function hex_(bytes) {
  var o = '';
  for (var i = 0; i < bytes.length; i++) o += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return o;
}
function sha256_(s) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}
function b64_(x)  { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); }
function hmac_(s) { return b64_(Utilities.computeHmacSha256Signature(s, AUTH_SECRET)); }
function anon_()  { return { u: '', role: '', pic: '' }; }

function nameOf_(user, pass) {
  var name = String(user || '').trim().toLowerCase(), u = USERS[name];
  if (!u || sha256_(String(pass || '') + AUTH_SALT) !== u.sha) return null;
  return { u: name, role: u.role, pic: u.pic || '' };
}

/**
 * A session is a signed note this script wrote to itself. The old site kept it
 * in an HttpOnly cookie; a page served by Apps Script runs in a sandbox that
 * cannot be given one, so the note rides in the address instead. It cannot be
 * edited into a different role — the signature is checked on every call — but
 * it IS in the URL, so treat that link the way you would treat the password.
 */
function tokenFor_(who) {
  var p = b64_(Utilities.newBlob(JSON.stringify(
    { u: who.u, role: who.role, pic: who.pic, exp: Date.now() + 30 * 864e5 })).getBytes());
  return p + '.' + hmac_(p);
}

function readToken_(t) {
  t = String(t || '');
  var dot = t.lastIndexOf('.');
  if (dot < 1) return anon_();
  var p = t.slice(0, dot);
  if (!same_(t.slice(dot + 1), hmac_(p))) return anon_();
  try {
    var d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p)).getDataAsString('UTF-8'));
    if (!(d.exp > Date.now()) || !USERS[d.u]) return anon_();
    return { u: d.u, role: d.role, pic: d.pic || '' };
  } catch (e) { return anon_(); }
}

/* Compared in full every time, so a wrong signature takes as long as a right
   one and tells a guesser nothing about how close it was. */
function same_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function staff_(w) { return w.role === 'manager' || w.role === 'bi'; }

/* Called by the sign-in screen. */
function signIn(user, pass) {
  var who = nameOf_(user, pass);
  if (!who) return { ok: false, error: 'Wrong name or password.' };
  return { ok: true, user: who.u, role: who.role, token: tokenFor_(who) };
}

/* -------------------------------------------------------------------- page */

function doGet(e) {
  var params = (e && e.parameter) || {};
  var page = params.p || 'finder';
  if (['finder', 'intake', 'approve', 'dashboard'].indexOf(page) < 0) page = 'finder';
  var who = readToken_(params.t);

  /* The Recipe Finder is deliberately open — it is the page the whole company
     uses, and locking it would shut Sales out of the recipes they rely on. */
  if (page !== 'finder' && !staff_(who)) return html_(loginPage_(page));

  var body = readPage_({ finder: 'index.html', intake: 'intake.html',
                         approve: 'approve.html', dashboard: 'dashboard.html' }[page]);

  /* index.html is a fragment with no <head> at all, so aim for the title and
     fall back to the very top rather than assuming tags that are not there. */
  var tag = prelude_(staff_(who) ? who : null, params, staff_(who) ? params.t : '');
  body = body.indexOf('</head>') >= 0 ? body.replace('</head>', tag + '</head>')
       : /<title/i.test(body)         ? body.replace(/<title/i, tag + '<title')
       :                                tag + body;
  return html_(body + strip_(who));
}

function html_(body) {
  return HtmlService.createHtmlOutput(body)
    .setTitle('Golden Choice R&D')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* The sign-in screen is generated here rather than kept as a fifth page, so
   there is one copy of it and nothing to keep in step. */
function loginPage_(next) {
  return '<style>' +
    ':root{--ink:#14201a;--muted:#6b7a72;--line:#dfe5e1;--bg:#f6f8f7;--accent:#1f6f43}' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;' +
    'background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    'form{width:min(360px,92vw);background:#fff;border:1px solid var(--line);border-radius:12px;padding:26px}' +
    '.eyebrow{margin:0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}' +
    'h1{margin:6px 0 2px;font-size:21px}p.sub{margin:0 0 18px;color:var(--muted);font-size:13px}' +
    'label{display:block;font-size:12px;color:var(--muted);margin:12px 0 4px}' +
    'input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px}' +
    'input:focus{outline:none;border-color:var(--accent)}' +
    'button{width:100%;margin-top:18px;font:inherit;font-weight:600;color:#fff;background:var(--accent);' +
    'border:0;border-radius:8px;padding:11px;cursor:pointer}' +
    '.err{margin:12px 0 0;color:#a3241f;font-size:13px;min-height:19px}' +
    '.foot{margin:14px 0 0;color:var(--muted);font-size:12px}' +
    '</style><form id="f">' +
    '<p class="eyebrow">Golden Choice Sdn. Bhd.</p><h1>Sign in</h1>' +
    '<p class="sub">R&amp;D intake, approvals and the daily dashboard.</p>' +
    '<label for="u">Name</label>' +
    '<input id="u" autocomplete="username" autocapitalize="off" autofocus>' +
    '<label for="p">Password</label>' +
    '<input id="p" type="password" autocomplete="current-password">' +
    '<button>Sign in</button><p class="err" id="e"></p>' +
    '<p class="foot">The Recipe Finder needs no sign-in. Approving is the manager\'s alone.</p>' +
    '</form><script>' +
    'document.getElementById("f").addEventListener("submit",function(ev){ev.preventDefault();' +
    'var e=document.getElementById("e");e.textContent="signing in…";' +
    'google.script.run.withSuccessHandler(function(d){' +
    'if(!d.ok){e.textContent=d.error||"Wrong name or password.";return;}' +
    'top.location.href=' + JSON.stringify(base_()) + '+"?p="+' + JSON.stringify(next) +
    '+"&t="+encodeURIComponent(d.token);})' +
    '.withFailureHandler(function(x){e.textContent="Could not sign in: "+x.message;})' +
    '.signIn(document.getElementById("u").value,document.getElementById("p").value);});' +
    '</' + 'script>';
}

/* Who you are, and how to stop being them: signing out is landing back on the
   Finder without the token, which is all the session ever was. */
function strip_(who) {
  if (!who.u) return '';
  return '<div style="position:fixed;right:10px;bottom:10px;z-index:99;background:#fff;' +
    'border:1px solid #dfe5e1;border-radius:999px;padding:5px 12px;box-shadow:0 1px 4px rgba(0,0,0,.06);' +
    'font:12px system-ui,-apple-system,sans-serif;color:#6b7a72">' + esc_(who.u) +
    ' &middot; <a target="_top" style="color:#1f6f43" href="' + base_() + '">Sign out</a></div>';
}

function base_() { return ScriptApp.getService().getUrl(); }

function readPage_(name) {
  var it = DriveApp.getFolderById(APP_FOLDER).getFilesByName(name);
  if (!it.hasNext()) throw new Error('Page not found in the app folder: ' + name);
  return it.next().getBlob().getDataAsString('UTF-8');
}

/**
 * Everything the pages need that a plain web server used to give them: who is
 * signed in, where the photos are, and a fetch() that talks to this script
 * instead of to a URL. Shadowing fetch is what lets the four pages stay the
 * pages they already are.
 */
function prelude_(who, params, token) {
  var js = [
    'window.GC_USER=' + JSON.stringify(who ? { u: who.u, role: who.role, pic: who.pic } : null) + ';',
    /* The session travels with every link and every call, because a sandboxed
       page has no cookie of its own to keep it in. */
    'var GC_TOKEN=' + JSON.stringify(token || '') + ';',
    /* The page runs in a sandboxed frame whose own address is not the one the
       reader typed, so location.search is useless here. The real query string
       is handed over instead. */
    'window.GC_PARAMS=' + JSON.stringify(params || {}) + ';',
    'var GC_BASE=' + JSON.stringify(base_()) + ';',
    'function GC_PHOTO(id){return id?"https://drive.google.com/thumbnail?id="+encodeURIComponent(id)+"&sz=w1200":"";}',
    'function GC_PAGE(h){var m=/([A-Za-z-]+)\\.html(?:\\?(.*))?/.exec(h||"");if(!m)return h;',
    ' var p={index:"finder",intake:"intake",approve:"approve",dashboard:"dashboard"}[m[1]]||"finder";',
    ' return GC_BASE+"?p="+p+(m[2]?"&"+m[2]:"")+(GC_TOKEN?"&t="+encodeURIComponent(GC_TOKEN):"");}',
    'function GC_GO(h){top.location.href=GC_PAGE(h);}',
    /* the four feeds and the three actions, by the URLs the pages already use */
    'function fetch(u,o){var b=null;try{b=o&&o.body?JSON.parse(o.body):null;}catch(e){}',
    ' var f=u.indexOf("all-recipes.json")===0?"all":u.indexOf("recipes.json")===0?"feed"',
    '  :u.indexOf("prices.json")===0?"prices":u.indexOf("dashboard.json")===0?"dashboard"',
    '  :u.indexOf("/api/pending")===0?"pending":u.indexOf("/api/submit")===0?"submit"',
    '  :u.indexOf("/api/approve")===0?"approve":null;',
    ' if(!f)return Promise.reject(new Error("no route for "+u));',
    ' return new Promise(function(ok,no){google.script.run',
    '  .withSuccessHandler(function(d){ok({ok:true,status:200,json:function(){return Promise.resolve(d);}});})',
    '  .withFailureHandler(no).api(f,b,GC_TOKEN);});}',
    /* links are written as intake.html and friends; inside the sandbox the top
       frame has to move, and it has to move to the script URL, not a filename */
    'document.addEventListener("click",function(e){',
    ' var t=e.target,a=t&&t.closest?t.closest("a[href]"):null;if(!a)return;',
    ' var h=a.getAttribute("href");if(!h||h.indexOf(".html")<0)return;',
    ' e.preventDefault();GC_GO(h);},true);'
  ].join('\n');
  return '<base target="_top"><script>' + js + '</' + 'script>';
}

/* --------------------------------------------------------------- the calls */

/**
 * The one door every page calls through. Who may do what is decided here, on
 * the token — never by which buttons a page happened to draw. The deployment
 * is open to anyone with the URL, so this is the lock, not a courtesy.
 */
function api(fn, arg, token) {
  var who = readToken_(token);
  /* Only the approved feed is open. all_() carries rejected and unreviewed
     drinks and the internal notes, and prices_() carries cost — neither
     belongs to the ten people who just want to look a recipe up. */
  if (fn === 'feed')      return feed_(staff_(who));
  if (fn === 'all')       { must_(staff_(who)); return all_(); }
  if (fn === 'prices')    { must_(staff_(who)); return prices_(); }
  if (fn === 'dashboard') { must_(staff_(who)); return dashboard_(); }
  if (fn === 'pending')   { must_(staff_(who));
                            var q = queue_(), have = {};
                            for (var i = 0; i < q.length; i++) have[q[i].id + '|' + q[i].toVersion] = 1;
                            return { items: q.concat(sheetPending_(have)) }; }
  if (fn === 'submit')    { must_(staff_(who)); return doSubmit_(arg, who); }
  if (fn === 'approve')   { must_(who.role === 'manager', 'Only the manager can approve or reject.');
                            return doApprove_(arg, who); }
  throw new Error('unknown call: ' + fn);
}
function must_(ok, msg) { if (!ok) throw new Error(msg || 'Please sign in with an R&D account.'); }

/* ------------------------------------------------------------ reading rows */

function sheetByGid_(gid) {
  var all = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < all.length; i++) if (all[i].getSheetId() === gid) return all[i];
  throw new Error('Tab ' + gid + ' is missing from this spreadsheet.');
}

/* A cell holding a real Date stringifies as "Mon Aug 17 2026", which nothing
   downstream can read. Dates always come back as YYYY-MM-DD. */
function S_(v) {
  if (v instanceof Date && !isNaN(v))
    return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}
function rows_(gid) {
  var sh = sheetByGid_(gid), n = sh.getLastRow(), c = sh.getLastColumn();
  if (n < 2) return [];
  var v = sh.getRange(2, 1, n - 1, c).getValues(), out = [];
  for (var i = 0; i < v.length; i++) {
    var r = [];
    for (var j = 0; j < v[i].length; j++) r.push(S_(v[i][j]));
    out.push(r);
  }
  return out;
}

/**
 * Columns are found by their heading, never by counting.
 *
 * The R&D Log still carries AUTOCOUNT ITEM CODE and LINE COST (RM) jammed into
 * one cell, so VERSION sits one column to the left of where the column letters
 * suggest. Reading by name is right whichever way that cell is eventually
 * split, and survives a column being inserted in front of it.
 */
function cols_(gid) {
  var sh = sheetByGid_(gid), c = sh.getLastColumn();
  var h = sh.getRange(1, 1, 1, c).getValues()[0], map = {};
  for (var i = 0; i < h.length; i++) {
    var k = String(h[i]).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (k && map[k] === undefined) map[k] = i;
  }
  return map;
}
/* First heading that exists wins, so a renamed column can be listed as a
   fallback rather than breaking the page. */
function at_(map, names) {
  for (var i = 0; i < names.length; i++) if (map[names[i]] !== undefined) return map[names[i]];
  return -1;
}
function cell_(row, ix) { return ix >= 0 && row[ix] !== undefined ? S_(row[ix]) : ''; }

var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/* The log writes a date as 2025-07 or as 2026-08-20; both mean one month. */
function month_(d) { var m = /^(\d{4})-(\d{2})/.exec(S_(d)); return m ? MON[+m[2] - 1] + ' ' + m[1] : ''; }
function vnum_(v) { var m = /V?(\d+)\.(\d+)/.exec(v || 'V1.0'); return m ? (+m[1]) * 1000 + (+m[2]) : 1000; }
function num_(s) { return /^[0-9]*\.?[0-9]+$/.test(S_(s)) ? S_(s) : ''; }
function key_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
  return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

var LIVE_STATUS = { 'Approved':'Approved', 'Rejected':'Rejected', '':'Unreviewed',
                    'Pending Review':'Unreviewed', 'Superseded':'Superseded' };

/**
 * One recipe per ID, built from the version that is actually live: the highest
 * version that has been approved, or the newest one if none has. A rejected V2
 * therefore leaves V1 standing, and lends it none of its detail.
 */
function LOGCOLS_() {
  var m = cols_(GID.log);
  return { date: at_(m, ['date']), id: at_(m, ['creationid']), name: at_(m, ['creationname']),
           ing: at_(m, ['ingredientname']), qty: at_(m, ['volumeusage']),
           uom: at_(m, ['uommlg', 'uom']), by: at_(m, ['createdby']),
           status: at_(m, ['status']), ver: at_(m, ['version']) };
}
function TRIALCOLS_() {
  var m = cols_(GID.trial);
  return { date: at_(m, ['date']), id: at_(m, ['drinkid']), name: at_(m, ['drinkname']),
           ver: at_(m, ['version']), pic: at_(m, ['rdpic', 'pic']), cat: at_(m, ['category']),
           project: at_(m, ['project']), stage: at_(m, ['stage']), status: at_(m, ['status']),
           due: at_(m, ['duedate']), done: at_(m, ['completiondate']), notes: at_(m, ['notes']),
           serve: at_(m, ['servingsizeml', 'servingsize']),
           price: at_(m, ['sellingpricerm', 'sellingprice']),
           diff: at_(m, ['difficulty']), equip: at_(m, ['equipment']),
           method: at_(m, ['preparationmethod']), video: at_(m, ['videolink']),
           zh: at_(m, ['chinesename']), photo: at_(m, ['photo']) };
}

/**
 * One version number can carry more than one block of rows: a rejected V2.0
 * whose number gets handed out again, or a job that submits the same update
 * twice. The rows are appended, so the last unbroken run is the one in force
 * and the blocks before it are history — showing them side by side is what
 * made a four-ingredient recipe read as twelve.
 */
function lastBlock_(rows) {
  var s = rows.length - 1;
  while (s > 0 && rows[s - 1].i === rows[s].i - 1) s--;
  return rows.slice(s).map(function (x) { return x.r; });
}

/**
 * And the two blocks can be adjacent, which the run above cannot separate: the
 * same submission arriving twice writes the same rows twice, back to back. When
 * a version's rows are an exact repetition of a shorter block, only the last
 * copy is current. A recipe that genuinely repeats an ingredient is safe — it
 * would have to repeat its whole list, in order, to look like this.
 */
function lastCopy_(rows, key) {
  for (var p = 1; p <= rows.length / 2; p++) {
    if (rows.length % p) continue;
    var same = true;
    for (var j = p; j < rows.length && same; j++) if (key(rows[j]) !== key(rows[j - p])) same = false;
    if (same) return rows.slice(rows.length - p);
  }
  return rows;
}

function library_() {
  var L = LOGCOLS_(), T = TRIALCOLS_(), table = priceTable_();
  var log = rows_(GID.log);
  var trial = {}, tr = rows_(GID.trial);
  for (var i = 0; i < tr.length; i++) {
    var tid = cell_(tr[i], T.id);
    if (tid) trial[tid + '|' + (cell_(tr[i], T.ver) || 'V1.0')] = tr[i];
  }

  var order = [], group = {};
  for (var k = 0; k < log.length; k++) {
    var id = cell_(log[k], L.id);
    if (!id) continue;
    if (!group[id]) { group[id] = {}; order.push(id); }
    var v = cell_(log[k], L.ver) || 'V1.0';
    /* The sheet row number rides along so the blocks can be told apart. */
    (group[id][v] = group[id][v] || []).push({ r: log[k], i: k });
  }

  var out = [];
  for (var o = 0; o < order.length; o++) {
    var rid = order[o], g = group[rid], vs = Object.keys(g);
    vs.sort(function (a, b) { return vnum_(b) - vnum_(a); });
    var now = {};
    for (var p = 0; p < vs.length; p++) now[vs[p]] = lastBlock_(g[vs[p]]);
    var st = function (v) {
      var s = now[v].map(function (r) { return cell_(r, L.status); }).filter(String);
      return s.length ? s[s.length - 1] : '';
    };
    var live = null;
    for (var q = 0; q < vs.length; q++) if (st(vs[q]) === 'Approved') { live = vs[q]; break; }
    if (!live) live = vs[0];

    var rr = lastCopy_(now[live], function (r) {
      return key_(cell_(r, L.ing)) + '~' + cell_(r, L.qty) + '~' + key_(cell_(r, L.uom));
    });
    var last = rr[rr.length - 1], t = trial[rid + '|' + live] || [];
    var dates = rr.map(function (r) { return cell_(r, L.date); }).filter(String);
    var raw = st(live);
    /* Costed against the version that is live, from the price list read once
       above — so a recipe's cost is the cost of the recipe Sales can order. */
    out.push(cost_({
      id: rid, name: cell_(last, L.name), by: cell_(last, L.by),
      status: LIVE_STATUS[raw] === undefined ? raw : LIVE_STATUS[raw],
      version: live, versionCount: vs.length, top: vs[0],
      ing: rr.map(function (r) {
        return { n: cell_(r, L.ing), q: num_(cell_(r, L.qty)), u: cell_(r, L.uom) }; }),
      zh: cell_(t, T.zh), photo: cell_(t, T.photo), serve: cell_(t, T.serve),
      price: cell_(t, T.price), diff: cell_(t, T.diff), equip: cell_(t, T.equip),
      method: cell_(t, T.method), video: cell_(t, T.video),
      project: cell_(t, T.project), stage: cell_(t, T.stage), notes: cell_(t, T.notes),
      month: month_(dates.length ? dates[dates.length - 1] : '')
    }, table));
  }
  out.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  return out;
}

function stamp_() {
  /* Written with its real offset rather than a Z it has not earned. */
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
    "yyyy-MM-dd'T'HH:mm:ssXXX");
}
function today_() {
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

/**
 * Only an approved recipe reaches Sales.
 *
 * Cost and gross margin ride along only for a signed-in name. This is the one
 * open endpoint — the Recipe Finder is deliberately reachable by anyone with
 * the link, which is exactly why what a drink costs to make must not be in the
 * answer it gives a stranger. The Finder draws those two rows when they are
 * there and says where to find them when they are not.
 */
function feed_(withCost) {
  var lib = library_(), out = [];
  for (var i = 0; i < lib.length; i++) {
    var r = lib[i];
    if (r.status !== 'Approved') continue;
    var o = { id: r.id, n: r.name, zh: r.zh, m: r.month, i: r.ing, by: r.by,
              serve: r.serve, price: r.price, method: r.method, p: r.photo };
    if (withCost) {
      o.cost = r.cost;
      o.margin = r.margin;
      o.costPending = r.costPending;
      o.unpriced = r.unpriced;
      o.unmeasured = r.unmeasured;
      o.costCheck = r.costCheck;
    }
    out.push(o);
  }
  return { generated: today_(), at: stamp_(), count: out.length,
           costing: !!withCost, recipes: out };
}

function all_() {
  var lib = library_(), counts = { approved: 0, rejected: 0, unreviewed: 0 };
  var uoms = {}, ings = {}, max = 0;
  for (var i = 0; i < lib.length; i++) {
    var r = lib[i], k = r.status.toLowerCase();
    if (counts[k] !== undefined) counts[k]++;
    var m = /^RCP-(\d+)$/.exec(r.id); if (m) max = Math.max(max, +m[1]);
    for (var j = 0; j < r.ing.length; j++) {
      if (r.ing[j].u) uoms[r.ing[j].u] = 1;
      /* Milk and MILK are one ingredient in the picker; the first spelling the
         log used is the one offered, so the list is not 48 near-duplicates. */
      if (r.ing[j].n && ings[key_(r.ing[j].n)] === undefined) ings[key_(r.ing[j].n)] = r.ing[j].n;
    }
  }
  var names = [];
  for (var n in ings) if (ings.hasOwnProperty(n)) names.push(ings[n]);
  names.sort(function (a, b) { return key_(a) < key_(b) ? -1 : key_(a) > key_(b) ? 1 : 0; });
  return { at: stamp_(), count: lib.length,
    nextId: 'RCP-' + ('0000' + (max + 1)).slice(-4),
    counts: counts,
    uoms: Object.keys(uoms).sort(),
    ingredients: names,
    recipes: lib };
}

/* =====================================================================
 * Costing
 *
 * One arithmetic, in one place, so the intake pricing a line as it is typed,
 * the card the manager approves, the Recipe Finder and the dashboard tile can
 * never disagree about what a drink costs.
 *
 *   cost per unit  =  Pack Cost (RM)  ÷  Units Per Pack
 *   line cost      =  quantity in the recipe  ×  cost per unit
 *   cost per cup   =  every line added up
 *
 * The rule that matters more than the arithmetic: a recipe with ANY line it
 * cannot cost reports no cost at all. A partial total is a wrong number wearing
 * a right one's clothes, and a drink that looks cheap because an ingredient was
 * forgotten is worse than one that admits it does not know yet.
 * =================================================================== */

/**
 * The price list, read once per request. Both numbers have to be usable or the
 * row is treated as unpriced: Number('') is 0 and Number('n/a') is NaN, and
 * either of those reaching the arithmetic would price a drink at nonsense
 * rather than at nothing.
 */
function priceTable_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(PRICES_TAB);
  var t = { exists: !!sh, at: null, items: {}, priced: 0, listed: 0 };
  if (!sh || sh.getLastRow() < 2) return t;
  t.at = stamp_();
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < v.length; i++) {
    var n = S_(v[i][0]); if (!n) continue;
    var cost = v[i][1] === '' ? null : Number(v[i][1]);
    var per  = v[i][2] === '' ? null : Number(v[i][2]);
    /* Units per pack divides, so zero is as unusable as blank. Pack cost may be
       zero — that is how water and ice are told from an ingredient nobody has
       priced yet. */
    var ok = cost !== null && isFinite(cost) && cost >= 0 &&
             per  !== null && isFinite(per)  && per  >  0;
    t.listed++;
    if (ok) t.priced++;
    t.items[key_(n)] = { cost: ok ? cost : null, per: ok ? per : null,
                         perUnit: ok ? cost / per : null, code: S_(v[i][3]) || null };
  }
  return t;
}

/* Money, and only at the very end: every line is added at full precision and
   the total is rounded once, so 100 lines do not accumulate a rounding drift. */
function money_(n) { return Math.round(n * 100) / 100; }

/**
 * What one serving of a recipe costs, and — when it cannot say — exactly which
 * ingredients are in the way. The two reasons are kept apart because they have
 * different fixes: an ingredient nobody has priced is a job for the Prices tab,
 * and a quantity that is not a number (`HALF` a lime, `follow powder x 1`) is a
 * job for the R&D Log.
 */
function costOf_(ing, table) {
  var total = 0, unpriced = [], unmeasured = [], lines = [];
  for (var i = 0; i < (ing || []).length; i++) {
    var name = S_(ing[i].n);
    if (!name) continue;
    var e = table.items[key_(name)], q = parseFloat(ing[i].q);
    var line = { n: name, code: e ? e.code : null, cost: null };
    if (!e || e.perUnit === null) unpriced.push(name);
    else if (!isFinite(q))        unmeasured.push(name);
    else { line.cost = money_(q * e.perUnit); total += q * e.perUnit; }
    lines.push(line);
  }
  var pending = unpriced.length > 0 || unmeasured.length > 0;
  return { cost: pending ? null : money_(total), pending: pending,
           unpriced: unpriced, unmeasured: unmeasured, lines: lines };
}

/**
 * Gross margin on the selling price, which is the sense the trade uses:
 * what is left of a ringgit taken over the counter. Never inferred from one
 * number alone — no cost, no price, or a price of zero all mean no margin.
 */
function margin_(cost, price) {
  var p = parseFloat(price);
  if (cost === null || !isFinite(p) || p <= 0) return null;
  return Math.round((p - cost) / p * 1000) / 10;
}

/**
 * A cost at or above the selling price is almost never a drink that loses
 * money. It is Units Per Pack not matching the UOM the recipe measures in — a
 * 1 L syrup entered as one pack, so every ML is charged at the price of the
 * whole litre. With 472 ingredients to price by hand out of AutoCount, that is
 * the mistake to expect.
 *
 * The arithmetic is right and the input is wrong, so the figure is shown and
 * marked rather than quietly hidden: hiding it would lose the only signal that
 * the price list needs correcting.
 */
function costCheck_(cost, price, lines) {
  var p = parseFloat(price);
  if (cost === null || !isFinite(p) || p <= 0 || cost < p) return null;
  /* Name the dearest line, because that is the one to look at first. */
  var worst = null;
  for (var i = 0; i < lines.length; i++)
    if (lines[i].cost !== null && (!worst || lines[i].cost > worst.cost)) worst = lines[i];
  /* The headline is the page's to write; this is only the explanation, so the
     two do not read as the same sentence twice. */
  return { over: true, worst: worst ? worst.n : '',
           why: 'Units Per Pack in the price list almost certainly does not match ' +
                'the UOM the recipe measures in.' };
}

/* Attaches cost, margin and the reasons to one recipe-shaped object. */
function cost_(r, table) {
  var c = costOf_(r.ing, table);
  r.cost = c.cost;
  r.costPending = c.pending;
  r.unpriced = c.unpriced;
  r.unmeasured = c.unmeasured;
  r.margin = margin_(c.cost, r.price);
  r.costCheck = costCheck_(c.cost, r.price, c.lines);
  return r;
}

/**
 * The ingredient-by-ingredient view the intake prices lines from as they are
 * typed. Every ingredient the library uses appears, so one that has never been
 * priced is visible as a gap rather than absent — that list is the work.
 */
function prices_() {
  var table = priceTable_(), lib = library_(), items = {}, used = 0, covered = 0;
  for (var r = 0; r < lib.length; r++)
    for (var j = 0; j < lib[r].ing.length; j++) {
      var name = lib[r].ing[j].n;
      if (!name || items[key_(name)]) continue;
      var e = table.items[key_(name)];
      items[key_(name)] = e || { cost: null, per: null, perUnit: null, code: null };
      used++;
      if (e && e.perUnit !== null) covered++;
    }
  return { note: 'cost + code are filled from a ' + PRICES_TAB + ' tab in this spreadsheet. ' +
                 'per = units per purchased pack; perUnit = cost of one UOM.',
           updated: table.at,
           basis: 'line cost = quantity x (Pack Cost (RM) / Units Per Pack)',
           tab: table.exists ? PRICES_TAB : null,
           coverage: { used: used, priced: covered, missing: used - covered },
           items: items };
}

/* ----------------------------------------------------------- the approvals */

/**
 * The queue is a tab rather than a folder of files, so a submission waiting for
 * a decision is visible in the spreadsheet like everything else. Created on
 * first use; nothing to set up by hand.
 */
function queueTab_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(QUEUE_TAB);
  if (sh) return sh;
  sh = ss.insertSheet(QUEUE_TAB);
  sh.getRange(1, 1, 1, 9).setValues([['Submitted', 'Submitted by', 'Recipe ID', 'Version',
    'Decision', 'Decided at', 'Decided by', 'Remarks', 'Submission (do not edit)']])
    .setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.hideSheet();
  return sh;
}

function queue_() {
  var sh = queueTab_(), n = sh.getLastRow();
  if (n < 2) return [];
  var v = sh.getRange(2, 1, n - 1, 9).getValues(), out = [];
  for (var i = 0; i < v.length; i++) {
    if (S_(v[i][4])) continue;                    /* already approved or rejected */
    var item;
    try { item = JSON.parse(v[i][8] || '{}'); } catch (e) { continue; }
    item.file = String(i + 2);                    /* the row is the handle */
    item.decision = '';
    out.push(item);
  }
  return out;
}

/* ---------------------------------------------------------------- writing */

/* Amending a recipe raises its major version: V1.0 → V2.0 → V3.0. */
function nextVersion_(cur) {
  var m = /V?(\d+)\./.exec(cur || 'V1.0');
  return 'V' + ((m ? +m[1] : 1) + 1) + '.0';
}

/**
 * What actually changed, against the version that is live now. The page shows
 * this list before submitting and the manager sees the same list before
 * deciding, so it is worked out once, here, where both of them read it from.
 */
function changes_(before, b, photo) {
  var out = [];
  if (key_(before.name) !== key_(b.name))
    out.push({ field: 'Recipe name', old: before.name, now: b.name, kind: 'changed' });

  var fields = [['Chinese name', 'zh', 'zh'], ['Serving size', 'serving', 'serve'],
                ['Selling price', 'price', 'price'], ['Difficulty', 'difficulty', 'diff'],
                ['Equipment', 'equipment', 'equip'], ['Preparation method', 'method', 'method'],
                ['Video link', 'video', 'video']];
  for (var f = 0; f < fields.length; f++) {
    var was = S_(before[fields[f][2]]), now = S_(b[fields[f][1]]);
    if (key_(was) === key_(now)) continue;
    out.push({ field: fields[f][0], old: was, now: now,
               kind: was ? (now ? 'changed' : 'removed') : 'added' });
  }

  var had = {}, has = {}, i;
  for (i = 0; i < before.ing.length; i++) had[key_(before.ing[i].n)] = before.ing[i];
  var now2 = b.ingredients || [];
  for (i = 0; i < now2.length; i++) has[key_(now2[i].n)] = now2[i];
  for (i = 0; i < now2.length; i++) {
    var k = key_(now2[i].n), was2 = had[k];
    if (!was2) out.push({ field: now2[i].n, old: '', now: S_(now2[i].q) + ' ' + S_(now2[i].u), kind: 'added' });
    else if (S_(was2.q) !== S_(now2[i].q) || key_(was2.u) !== key_(now2[i].u))
      out.push({ field: now2[i].n, old: S_(was2.q) + ' ' + S_(was2.u),
                 now: S_(now2[i].q) + ' ' + S_(now2[i].u), kind: 'changed' });
  }
  for (i = 0; i < before.ing.length; i++)
    if (!has[key_(before.ing[i].n)])
      out.push({ field: before.ing[i].n, old: S_(before.ing[i].q) + ' ' + S_(before.ing[i].u),
                 now: '', kind: 'removed' });

  if (photo) out.push({ field: 'Photo', old: '', now: 'new photo attached', kind: 'added' });
  return out;
}

/* A data: URL from the file input becomes a file in the app folder, and the
   sheet keeps its id. The photo then belongs to the recipe rather than to a
   disk somewhere, and survives every later version. */
function savePhoto_(dataUrl, id, version) {
  if (!dataUrl) return '';
  var m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl));
  if (!m) return '';
  var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[m[1]] || 'jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1],
    id + '-' + version + '-' + today_() + '.' + ext);
  var file = DriveApp.getFolderById(APP_FOLDER).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

function doSubmit_(b, who) {
  b = b || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var name = S_(b.name), pic = S_(b.by);
    if (!name) return { ok: false, error: 'The recipe needs a name.' };
    if (!pic)  return { ok: false, error: 'Choose the R&D PIC.' };

    var id, version, list = null, before = null;
    if (b.mode === 'new') {
      id = nextId_();
      version = 'V1.0';
    } else {
      id = S_(b.id);
      list = library_();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) { before = list[i]; break; }
      if (!before) return { ok: false, error: id + ' is not in the log.' };
      /* From the highest version ever used, not the live one. A rejected V2.0
         used to hand its number back out, and the two submissions' rows then
         sat in the log under one version, indistinguishable. */
      version = nextVersion_(before.top || before.version);
    }

    var photo = savePhoto_(b.photo, id, version);
    var list2 = before ? changes_(before, b, photo) : [];
    if (before && !list2.length)
      return { ok: false, error: 'Nothing has changed, so there is no new version to record.' };

    /* Code.gs does the whole write: the ingredient rows, the version row, the
       change rows, and — through trialRow_ in Fixer.gs — the trial row with its
       eight production-detail columns. Nothing is repeated here. The photo goes
       in as photoFile, which is the key trialRow_ reads for the PHOTO column;
       it now holds a Drive file id rather than a filename on a disk. */
    var res = submit_({
      mode: b.mode, id: id, toVersion: version, name: name, by: pic,
      fromVersion: before ? before.version : '',
      trialDate: S_(b.trialDate) || today_(), category: b.category, project: b.project,
      stage: b.stage, status: b.status, result: b.result, due: b.due, next: b.next,
      notes: b.notes, reason: b.reason, remarks: b.remarks, zh: b.zh,
      beverage: b.beverage, target: b.target, serving: b.serving, price: b.price,
      difficulty: b.difficulty, equipment: b.equipment, video: b.video, method: b.method,
      costPerServing: b.costPerServing, costingPending: b.costingPending,
      photoFile: photo,
      changes: list2, ingredients: b.ingredients || []
    });
    if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'The sheet refused the write.' };
    id = res.id || id;          /* Code.gs mints the ID for a new recipe */

    /* trialRow_ is wrapped in a catch over there, so a failure comes back as a
       message rather than an exception. Say so instead of reporting success. */
    if (res.trialError)
      return { ok: false, error: 'The recipe rows were written, but the trial row failed: ' +
                                 res.trialError + ' — run R&D Tools > Fix the sheet now.' };

    var q = queueTab_();
    q.getRange(q.getLastRow() + 1, 1, 1, 9).setValues([[
      stamp_(), who.u, id, version, '', '', '', '',
      JSON.stringify({ mode: b.mode, id: id, name: name, by: pic, zh: S_(b.zh),
        category: S_(b.category), reason: S_(b.reason), remarks: S_(b.remarks),
        serving: S_(b.serving), price: S_(b.price), difficulty: S_(b.difficulty),
        equipment: S_(b.equipment), method: S_(b.method), video: S_(b.video),
        costPerServing: b.costPerServing, costingPending: b.costingPending,
        submittedAt: stamp_(), updateType: 'major',
        fromVersion: before ? before.version : '', toVersion: version,
        photoFile: photo, changes: list2, ingredients: b.ingredients || [] }) ]]);

    return { ok: true, id: id, toVersion: version, status: 'Pending Review',
             changes: list2, sheet: true };
  } finally { lock.releaseLock(); }
}

/**
 * A version can be waiting in the sheet without ever having passed through this
 * site: everything filed on the old connector wrote straight to RECIPE VERSIONS
 * and left no queue row. The Approvals page was reading the queue alone, so
 * those submissions were unreachable - the sheet said PENDING REVIEW and there
 * was no button anywhere that could answer it. They are gathered here instead,
 * in the shape the page already draws, and approving one works exactly the same
 * way: doApprove_ skips the queue write when there is no row to write to.
 */
function sheetPending_(have) {
  var sh = SpreadsheetApp.getActive().getSheetByName('RECIPE VERSIONS');
  if (!sh) return [];
  var n = sh.getLastRow();
  if (n < 2) return [];
  var v = sh.getRange(2, 1, n - 1, 11).getValues();

  /* The last row written for a version is where that version stands now, so a
     PENDING REVIEW that was later approved does not come back. */
  var state = {}, meta = {};
  for (var i = 0; i < v.length; i++) {
    var id = S_(v[i][0]), ver = S_(v[i][1]);
    if (!id || !ver) continue;
    state[id + '|' + ver] = String(v[i][4]).trim().toUpperCase();
    meta[id + '|' + ver] = v[i];
  }

  var L = LOGCOLS_(), T = TRIALCOLS_(), lib = library_(), table = priceTable_(), live = {};
  for (var j = 0; j < lib.length; j++) live[lib[j].id] = lib[j];

  var ing = {}, log = rows_(GID.log);
  for (var k = 0; k < log.length; k++) {
    var lid = cell_(log[k], L.id);
    if (!lid) continue;
    var lk = lid + '|' + (cell_(log[k], L.ver) || 'V1.0');
    (ing[lk] = ing[lk] || []).push(log[k]);
  }
  var trial = {}, tr = rows_(GID.trial);
  for (var m = 0; m < tr.length; m++) {
    var tid = cell_(tr[m], T.id);
    if (tid) trial[tid + '|' + (cell_(tr[m], T.ver) || 'V1.0')] = tr[m];
  }

  var out = [];
  for (var key in state) {
    if (!state.hasOwnProperty(key)) continue;
    if (state[key] !== 'PENDING REVIEW') continue;
    if (have[key]) continue;                       /* the queue already has it */
    var parts = key.split('|'), rid = parts[0], ver2 = parts[1];
    var cur = live[rid], row = meta[key];
    /* A version the library has already moved past is history, not a decision:
       RCP-0384 V1.0 still reads PENDING REVIEW under an approved V3.0. */
    if (cur && cur.version !== ver2 && vnum_(cur.version) >= vnum_(ver2)) continue;

    var rows2 = lastCopy_(ing[key] || [], function (r) {
      return key_(cell_(r, L.ing)) + '~' + cell_(r, L.qty) + '~' + key_(cell_(r, L.uom));
    });
    var t2 = trial[key] || [];
    var item = {
      file: '', decision: '', fromSheet: true,
      mode: vnum_(ver2) <= 1000 ? 'new' : 'update',
      id: rid, toVersion: ver2, fromVersion: cur ? cur.version : '',
      name: S_(row[2]) || (cur ? cur.name : ""),
      by: S_(row[6]), submittedAt: S_(row[5]),
      category: S_(row[3]), reason: S_(row[7]), remarks: S_(row[8]),
      zh: cell_(t2, T.zh), serving: cell_(t2, T.serve), price: cell_(t2, T.price),
      difficulty: cell_(t2, T.diff), equipment: cell_(t2, T.equip),
      method: cell_(t2, T.method), video: cell_(t2, T.video),
      photoFile: cell_(t2, T.photo),
      updateType: 'major',
      ingredients: rows2.map(function (r) {
        return { n: cell_(r, L.ing), q: num_(cell_(r, L.qty)), u: cell_(r, L.uom) };
      }),
      changes: []
    };
    /* These never passed through the intake, so no cost was ever stamped on
       them. Costing the rows themselves is what puts a real figure on the card
       instead of the word "pending" every time. */
    var c2 = costOf_(item.ingredients, table);
    item.costPerServing = c2.cost;
    item.costingPending = c2.pending;
    item.unpriced = c2.unpriced;
    item.unmeasured = c2.unmeasured;
    if (cur && item.mode === 'update') item.changes = changes_(cur, item, '');
    out.push(item);
  }
  out.sort(function (a, b) { return a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0; });
  return out;
}

function doApprove_(b, who) {
  b = b || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    /* Code.gs owns the decision: statuses, superseding, the version ledger. */
    var res = approve_({ id: b.id, version: b.version, decision: b.decision,
                         by: S_(b.by) || who.u, remarks: b.remarks });
    if (!res || !res.ok) return res || { ok: false, error: 'The sheet refused the decision.' };

    var row = parseInt(b.file, 10);
    if (row > 1) {
      var q = queueTab_();
      if (row <= q.getLastRow())
        q.getRange(row, 5, 1, 4).setValues([[String(b.decision).toUpperCase(),
          stamp_(), S_(b.by) || who.u, S_(b.remarks)]]);
    }
    return res;
  } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------- the numbers */

function dashboard_() {
  var lib = library_(), T = TRIALCOLS_();
  var tr = rows_(GID.trial).filter(function (r) { return cell_(r, T.id); });
  var t = today_(), ym = t.slice(0, 7), yr = t.slice(0, 4);
  var week = Utilities.formatDate(new Date(new Date().getTime() - 6 * 864e5),
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');

  var lc = { total: lib.length, approved: 0, rejected: 0, unreviewed: 0, pendingReview: 0,
             costingDone: 0, multiVersion: 0, costingPending: 0 };
  /* Which ingredients are holding costing up, and how many recipes each one is
     holding up — the order to work the Prices tab in, rather than a count that
     says only that there is work. */
  var blockers = {};
  for (var i = 0; i < lib.length; i++) {
    var k = lib[i].status.toLowerCase();
    if (lc[k] !== undefined) lc[k]++;
    if (lib[i].versionCount > 1) lc.multiVersion++;
    if (lib[i].costPending) lc.costingPending++; else lc.costingDone++;
    var why = lib[i].unpriced.concat(lib[i].unmeasured), seen = {};
    for (var w = 0; w < why.length; w++) {
      var nm = why[w];
      if (seen[key_(nm)]) continue;              /* one recipe counts once */
      seen[key_(nm)] = 1;
      var b = blockers[key_(nm)] ||
              (blockers[key_(nm)] = { name: nm, recipes: 0,
                                      reason: lib[i].unpriced.indexOf(nm) >= 0 ? 'no price' : 'quantity is not a number' });
      b.recipes++;
    }
  }
  var costing = [];
  for (var bn in blockers) if (blockers.hasOwnProperty(bn)) costing.push(blockers[bn]);
  costing.sort(function (a, b) { return b.recipes - a.recipes ||
                                        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });

  var todayC = { created: 0, trials: 0, approved: 0, failed: 0, revision: 0 };
  var acc = { today: { drinks: 0, trials: 0 }, week: { drinks: 0, trials: 0 },
              month: { drinks: 0, trials: 0 }, year: { drinks: 0, trials: 0 } };
  var pics = {}, stat = { inRnD: 0, waiting: 0, revision: 0, pending: 0, completed: 0, overdue: 0 };
  var stages = { Request: 0, 'R&D': 0, Trial: 0, Revision: 0, Testing: 0, Approved: 0 };
  var ver = { multiVersion: lc.multiVersion, majorThisMonth: 0, minorThisMonth: 0 };
  var overdue = [], waiting = [], latest = [];

  for (var r = 0; r < tr.length; r++) {
    var row = tr[r], d = cell_(row, T.date), v = cell_(row, T.ver) || 'V1.0',
        pic = cell_(row, T.pic), stage = cell_(row, T.stage), status = cell_(row, T.status),
        due = cell_(row, T.due), done = cell_(row, T.done);
    var isNew = vnum_(v) <= 1000;

    if (d === t)             { acc.today.trials++;  if (isNew) acc.today.drinks++; }
    if (d >= week)           { acc.week.trials++;   if (isNew) acc.week.drinks++; }
    if (d.slice(0, 7) === ym) {
      acc.month.trials++; if (isNew) acc.month.drinks++;
      if (!isNew) (/\.0$/.test(v) ? ver.majorThisMonth++ : ver.minorThisMonth++);
    }
    if (d.slice(0, 4) === yr) { acc.year.trials++;  if (isNew) acc.year.drinks++; }

    if (d === t) {
      todayC.trials++;
      if (isNew) todayC.created++;
      if (key_(status) === 'approved') todayC.approved++;
      if (key_(status) === 'rejected') todayC.failed++;
      if (key_(stage)  === 'revision') todayC.revision++;
    }

    if (pic) {
      var p = pics[pic] || (pics[pic] = { drinks: 0, trials: 0, monthTrials: 0 });
      if (d === t) { p.trials++; if (isNew) p.drinks++; }
      if (d.slice(0, 7) === ym) p.monthTrials++;
    }

    var s = key_(status);
    if (s === 'in r&d' || s === 'in rnd')  stat.inRnD++;
    else if (s === 'waiting')              stat.waiting++;
    else if (s === 'revision')             stat.revision++;
    else if (s === 'pending review')       { stat.pending++; lc.pendingReview++; }
    else if (s === 'completed' || s === 'approved') stat.completed++;

    if (stages[stage] !== undefined) stages[stage]++;

    if (due && !done && due < t && s !== 'completed' && s !== 'approved') {
      stat.overdue++;
      overdue.push({ id: cell_(row, T.id), name: cell_(row, T.name), ver: v, pic: pic,
                     due: due, status: status });
    }
    if (s === 'pending review')
      waiting.push({ id: cell_(row, T.id), name: cell_(row, T.name), ver: v, pic: pic,
                     date: d, status: status });

    latest.push({ id: cell_(row, T.id), name: cell_(row, T.name), ver: v, pic: pic,
                  date: d, status: status });
  }

  return { at: stamp_(), today: t, library: lc, todayCounts: todayC, pics: pics,
           costingBlockers: costing, accumulated: acc, status: stat,
           pipeline: Object.keys(stages).map(function (k) { return { stage: k, n: stages[k] }; }),
           versions: ver, overdue: overdue, pendingApproval: waiting,
           latest: latest.slice(-8).reverse(), trialRows: tr.length };
}

/* ======================================================================
 * The pages, and checking they are intact
 *
 * The four .html files already sit in the app folder. They are the pages this
 * site has always used, with four small edits for the Google sandbox: photos
 * come from Drive, links move the outer frame, the intake reads ?update= from
 * the script rather than from an address the sandbox hides from it, and
 * "Enter another" reloads through the same route.
 *
 * Run checkPages() any time to confirm the copies in Drive are exactly the
 * ones that were tested. It reads them, fingerprints them, and says so.
 * ==================================================================== */
var PAGE_FINGERPRINTS = {
  'index.html':     { size: 24635, md5: 'f53075f00416da94071564962a6d61dd' },
  'intake.html':    { size: 38921, md5: '5f34b85b984dcda91a799e7274bf741c' },
  'approve.html':   { size: 14426, md5: 'dc9983fccd7b7a5a4d45e1d51aa3376b' },
  'dashboard.html': { size: 27853, md5: 'e58dca36074ed1df0e94d52e0e98f3fa' }
};

function checkPages() {
  var out = [], bad = 0;
  for (var name in PAGE_FINGERPRINTS) {
    if (!PAGE_FINGERPRINTS.hasOwnProperty(name)) continue;
    var want = PAGE_FINGERPRINTS[name], line;
    try {
      var bytes = DriveApp.getFolderById(APP_FOLDER).getFilesByName(name).next().getBlob().getBytes();
      var got = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
      var ok = (got === want.md5 && bytes.length === want.size);
      if (!ok) bad++;
      line = (ok ? 'ok    ' : 'WRONG ') + name + '  ' + bytes.length + ' bytes  ' + got;
    } catch (e) { bad++; line = 'MISSING ' + name + '  (' + e.message + ')'; }
    out.push(line);
  }
  var msg = out.join('\n') + '\n\n' +
    (bad ? bad + ' page(s) are not the tested copy. Replace them from the app folder backup.'
         : 'All four pages are exactly the copies that were tested.');
  Logger.log(msg);
  return msg;
}

/* ======================================================================
 * preflight — run this after pasting, BEFORE you deploy
 *
 * The risky part of this deployment is not the code, it is the paste. Web.gs
 * ships with PASTE-… placeholders where the salt, the signing key, the Drive
 * folder id and three password hashes belong, because this repository is
 * public. Deploying with any of them still in place does not fail politely: a
 * missing folder id throws on every page load, and a changed salt or signing
 * key signs everybody out at once.
 *
 * So this checks the things that are true or false rather than a matter of
 * taste, and says READY or NOT READY. It writes nothing and deploys nothing.
 *
 *   Apps Script editor -> choose "preflight" -> Run -> read the log.
 * ==================================================================== */
function preflight() {
  var out = [], bad = 0, warn = 0;
  function ok_(m)   { out.push('  ok    ' + m); }
  function no_(m)   { out.push('  WRONG ' + m); bad++; }
  function note_(m) { out.push('  note  ' + m); warn++; }

  /* WHICH COPY AM I. There are two Apps Script projects of this system under two
     Google accounts, and they are indistinguishable from inside the editor. Five
     rounds of "it is saved" / "it is not there" came of that, because no report
     said where it had been run. Every preflight now says so first, so any
     screenshot of one identifies its own environment. */
  out.push('WHERE THIS RAN');
  try { out.push('  script      ' + ScriptApp.getScriptId()); }
  catch (e) { out.push('  script      (unavailable)'); }
  try {
    var ss_here = SpreadsheetApp.getActive();
    out.push('  spreadsheet ' + ss_here.getId());
    out.push('  named       ' + ss_here.getName());
  } catch (e2) { out.push('  spreadsheet (unavailable)'); }
  out.push('');

  out.push('SECRETS');
  /* A placeholder is any value still carrying the shape this repository ships. */
  var isPlaceholder = function (v) { return /^PASTE-/.test(String(v || '')); };
  var pairs = [['AUTH_SALT', AUTH_SALT], ['AUTH_SECRET', AUTH_SECRET], ['APP_FOLDER', APP_FOLDER]];
  for (var p = 0; p < pairs.length; p++) {
    if (isPlaceholder(pairs[p][1])) no_(pairs[p][0] + ' is still the placeholder.');
    else if (!String(pairs[p][1] || '').length) no_(pairs[p][0] + ' is empty.');
    else ok_(pairs[p][0] + ' is set.');
  }
  if (!isPlaceholder(AUTH_SALT) && !isPlaceholder(AUTH_SECRET) && AUTH_SALT === AUTH_SECRET)
    no_('AUTH_SALT and AUTH_SECRET are the same value. They are separate so that ' +
        'ending every session does not also change every password.');

  /* Code.gs's connector secret is only used by the archived Zo endpoint, so a
     placeholder there is worth saying but is not a reason to stop. */
  try { if (isPlaceholder(SECRET)) note_('Code.gs SECRET is still the placeholder. Nothing ' +
        'calls doPost any more, so this only matters if you revive that endpoint.'); }
  catch (e) { note_('Code.gs SECRET is not defined in this project.'); }

  out.push('');
  out.push('ACCOUNTS');
  var names = [], n;
  for (n in USERS) if (USERS.hasOwnProperty(n)) names.push(n);
  if (!names.length) no_('USERS is empty — nobody can sign in.');
  for (var u = 0; u < names.length; u++) {
    var sha = String(USERS[names[u]].sha || '');
    if (isPlaceholder(sha)) no_(names[u] + ' still has the placeholder hash.');
    else if (!/^[0-9a-f]{64}$/i.test(sha)) no_(names[u] + ' has a hash that is not 64 hex ' +
      'characters, so it cannot be a SHA-256 and that name can never sign in.');
    else ok_(names[u] + ' (' + USERS[names[u]].role + ') has a real hash.');
  }
  var managers = 0;
  for (var m = 0; m < names.length; m++) if (USERS[names[m]].role === 'manager') managers++;
  if (!managers) no_('No account has the manager role, so nothing could ever be approved.');

  out.push('');
  out.push('THE SPREADSHEET');
  var tabs = { log: 'R&D Log', ver: 'RECIPE VERSIONS', trial: 'R&D TRIAL LOG' };
  for (var g in GID) {
    if (!GID.hasOwnProperty(g)) continue;
    try { ok_(tabs[g] + ' found (' + sheetByGid_(GID[g]).getName() + ').'); }
    catch (e2) { no_(tabs[g] + ' is missing: ' + e2.message); }
  }
  try {
    var cols = LOGCOLS_();
    if (cols.ver < 0) no_('The R&D Log has no VERSION heading.');
    else ok_('The R&D Log headings read cleanly.');
  } catch (e3) { no_('Could not read the R&D Log headings: ' + e3.message); }

  out.push('');
  out.push('THE PAGES');
  if (isPlaceholder(APP_FOLDER)) no_('Cannot check the pages until APP_FOLDER is set.');
  else out.push(checkPages().split('\n\n')[0].replace(/^/gm, '  '));
  if (!isPlaceholder(APP_FOLDER)) {
    for (var f in PAGE_FINGERPRINTS) {
      if (!PAGE_FINGERPRINTS.hasOwnProperty(f)) continue;
      try {
        var b = DriveApp.getFolderById(APP_FOLDER).getFilesByName(f).next().getBlob().getBytes();
        if (hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, b)) !== PAGE_FINGERPRINTS[f].md5) bad++;
      } catch (e4) { bad++; }
    }
  }

  out.push('');
  out.push('COSTING');
  var pr = SpreadsheetApp.getActive().getSheetByName(PRICES_TAB);
  if (!pr) note_('There is no ' + PRICES_TAB + ' tab yet, so every recipe will read ' +
                 '"Needs costing". That is correct, not broken — run R&D Tools -> ' +
                 'Update prices from AutoCount to build it.');
  else {
    var t = priceTable_();
    ok_(PRICES_TAB + ' has ' + t.listed + ' rows, ' + t.priced + ' of them usable.');
    if (!t.priced) note_('None of them carries both a pack cost and a units-per-pack, ' +
                         'so nothing can be costed yet.');
  }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GC_SYNC_URL') || !props.getProperty('GC_SYNC_TOKEN'))
    note_('GC_SYNC_URL and GC_SYNC_TOKEN are not both set in Project Settings -> ' +
          'Script Properties, so "Update prices from AutoCount" will refuse to run. ' +
          'Everything else works without them.');
  else ok_('The AutoCount snapshot settings are in place.');

  var verdict = bad
    ? 'NOT READY — ' + bad + ' thing(s) above must be fixed before you deploy. ' +
      'Deploying now would break the live site.'
    : 'READY to deploy' + (warn ? ', with ' + warn + ' note(s) above worth reading.' : '.');
  var msg = out.join('\n') + '\n\n' + verdict;
  Logger.log(msg);
  return msg;
}
