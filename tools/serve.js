/**
 * The site, on this machine.
 *
 *   node tools/serve.js [port]
 *
 * It runs the REAL doGet() and the REAL prelude_() out of Web.gs against the
 * fixture spreadsheet, and answers what the pages ask for through the REAL
 * api(). Only two things are shimmed, because Apps Script provides them and a
 * browser does not: google.script.run, which becomes one POST, and the queue
 * writes, which stay in memory.
 *
 * So what you see here is the four pages as deployed, not a mock-up of them.
 *
 * Sign in with manager / manager-pw, sakura / sakura-pw, robin / robin-pw.
 * Those are fixture passwords and exist only in gas.js.
 */
'use strict';
const http = require('http');
const { load } = require('./gas.js');
const fx = require('./fixture.js');

const PORT = Number(process.argv[2] || 8788);
const BASE = 'http://localhost:' + PORT + '/';
const noPrices = process.argv.includes('--no-prices');

const { ctx } = load(fx.build({ withPrices: !noPrices }), { baseUrl: BASE });

/* Everything google.script.run reaches, in one POST. The page never learns it
   is not talking to Apps Script. */
const SHIM = `<script>
(function(){
  var native = window.fetch.bind(window);
  function call(fn, args){
    return native(${JSON.stringify('/__run')}, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({fn:fn, args:args})
    }).then(function(r){ return r.json(); }).then(function(d){
      if(d.error) throw new Error(d.error);
      return d.value;
    });
  }
  function runner(){
    var ok=null, no=null;
    var o = {
      withSuccessHandler:function(f){ ok=f; return o; },
      withFailureHandler:function(f){ no=f; return o; }
    };
    ['api','signIn'].forEach(function(name){
      o[name]=function(){
        call(name, Array.prototype.slice.call(arguments))
          .then(function(v){ if(ok) ok(v); },
                function(e){ if(no) no(e); else console.error(e); });
      };
    });
    return o;
  }
  window.google = window.google || {};
  Object.defineProperty(window.google, 'script', { get:function(){ return { run: runner() }; } });
})();
</script>`;

function page(query) {
  const out = ctx.doGet({ parameter: query }).getContent();
  /* Ahead of the prelude, which shadows fetch and expects google.script.run to
     be there already. The lookahead is load-bearing: <head[^>]*> also matches
     <header class="masthead">, which put the shim after the prelude and left
     it calling the shadowed fetch instead of the browser's. */
  const HEAD = /<head(?=[\s>])[^>]*>/i;
  const withShim = HEAD.test(out) ? out.replace(HEAD, m => m + SHIM) : SHIM + out;

  /* html_() sets the viewport through addMetaTag rather than in the markup, and
     index.html is a fragment with no <head> of its own — so without this the
     local copy would lay out differently from the deployed one on a phone,
     which is exactly the thing a local check is for. */
  return withShim.indexOf('name="viewport"') >= 0 ? withShim
    : '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + withShim;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);

  if (req.method === 'POST' && url.pathname === '/__run') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try {
        const { fn, args } = JSON.parse(body || '{}');
        if (fn !== 'api' && fn !== 'signIn') throw new Error('unknown call: ' + fn);
        out = { value: ctx[fn].apply(null, args) };
      } catch (e) { out = { error: e.message }; }
      res.writeHead(out.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }

  if (url.pathname !== '/') { res.writeHead(404); res.end('not here'); return; }

  const query = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(query));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(e.stack);
  }
});

server.listen(PORT, () => {
  const t = ctx.signIn('manager', 'manager-pw').token;
  console.log('the site is at   ' + BASE);
  console.log('signed in as the manager:');
  console.log('  finder     ' + BASE + '?t=' + encodeURIComponent(t));
  console.log('  intake     ' + BASE + '?p=intake&t=' + encodeURIComponent(t));
  console.log('  approvals  ' + BASE + '?p=approve&t=' + encodeURIComponent(t));
  console.log('  dashboard  ' + BASE + '?p=dashboard&t=' + encodeURIComponent(t));
  if (noPrices) console.log('\nrunning WITHOUT a Prices tab, as the live sheet is today');
});
