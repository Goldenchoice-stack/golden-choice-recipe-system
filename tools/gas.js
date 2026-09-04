/**
 * Just enough Apps Script to run the real .gs files on this machine.
 *
 * The point is to test the DEPLOYED SOURCE rather than a second copy of it that
 * drifts. apps-script/*.gs are loaded verbatim into a VM context holding these
 * shims, so anything proven here is proven about the file that is deployed.
 *
 * Only what the four files actually call is implemented. A method that is not
 * here was not reached by any test, and adding it is how the next test starts.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TZ = 'Asia/Kuala_Lumpur';   /* the sheet's own timezone */

/* ------------------------------------------------------------------- dates */
/* Apps Script formats in the sheet's timezone. Kuala Lumpur is UTC+8 all year
   and has never had daylight saving, so a fixed offset is exact here rather
   than an approximation that drifts twice a year. */
const OFFSET_MIN = 8 * 60;
function parts(d) {
  const t = new Date(d.getTime() + OFFSET_MIN * 60000);
  return { y: t.getUTCFullYear(), M: t.getUTCMonth() + 1, d: t.getUTCDate(),
           H: t.getUTCHours(), m: t.getUTCMinutes(), s: t.getUTCSeconds() };
}
const pad = n => String(n).padStart(2, '0');

/* Stands in for a quoted literal while the format letters are substituted.
   It has to be a character no format pattern uses and no literal contains,
   which a space is not. */
const SENTINEL = '\u0000';
const RE_SENTINEL = /\u0000/g;

/* Only the four patterns the .gs files actually ask for. Quoted literals are
   held aside so the letters inside them are not substituted. */
function formatDate(date, tz, fmt) {
  const p = parts(date);
  const held = [];
  return String(fmt)
    .replace(/'([^']*)'/g, (_, lit) => { held.push(lit); return SENTINEL; })
    .replace(/yyyy/g, p.y).replace(/MM/g, pad(p.M)).replace(/dd/g, pad(p.d))
    .replace(/HH/g, pad(p.H)).replace(/mm/g, pad(p.m)).replace(/ss/g, pad(p.s))
    .replace(/XXX/g, '+08:00')
    .replace(RE_SENTINEL, () => held.shift());
}

/* Apps Script hands back signed bytes and the .gs code re-wraps them, so the
   shim has to be signed too or hex_() would read differently here. */
const signed = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
const unsign = arr => Buffer.from(arr.map(b => b & 255));

/* ------------------------------------------------------------------- sheet */
class Range {
  constructor(sheet, row, col, rows, cols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.rows = rows === undefined ? 1 : rows;
    this.cols = cols === undefined ? 1 : cols;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) line.push(this.sheet._get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(v) {
    for (let r = 0; r < v.length; r++)
      for (let c = 0; c < v[r].length; c++) this.sheet._set(this.row + r, this.col + c, v[r][c]);
    return this;
  }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
  setWrap() { return this; }
}

class Sheet {
  constructor(name, gid, values) {
    this.name = name; this.gid = gid;
    this.values = values.map(r => r.slice());
    this.hidden = false;
  }
  getName() { return this.name; }
  getSheetId() { return this.gid; }
  _get(row, col) {
    const r = this.values[row - 1];
    const v = r ? r[col - 1] : '';
    return v === undefined ? '' : v;
  }
  _set(row, col, v) {
    while (this.values.length < row) this.values.push([]);
    const r = this.values[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = v;
  }
  /* Apps Script's last row and column ignore trailing empties, which is exactly
     the behaviour the readers lean on. */
  getLastRow() {
    let last = 0;
    this.values.forEach((r, i) => { if (r.some(c => c !== '' && c != null)) last = i + 1; });
    return last;
  }
  getLastColumn() {
    let last = 0;
    this.values.forEach(r => {
      for (let c = r.length; c > 0; c--)
        if (r[c - 1] !== '' && r[c - 1] != null) { last = Math.max(last, c); break; }
    });
    return last;
  }
  getRange(row, col, rows, cols) { return new Range(this, row, col, rows, cols); }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  clear() { this.values = []; return this; }
  hideSheet() { this.hidden = true; return this; }
  appendRow(v) {
    const at = this.getLastRow() + 1;
    for (let c = 0; c < v.length; c++) this._set(at, c + 1, v[c]);
    return this;
  }
}

class Spreadsheet {
  constructor(name, sheets) { this.name = name; this.sheets = sheets; }
  getName() { return this.name; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSpreadsheetTimeZone() { return TZ; }
  insertSheet(n) {
    const s = new Sheet(n, 900000000 + this.sheets.length, []);
    this.sheets.push(s);
    return s;
  }
}

/* ------------------------------------------------------------------- build */
/**
 * fixture: { name, tabs: [{ name, gid, values }] }
 * Returns { ctx, ss, drive } -- ctx holds every global from the .gs files, so a
 * test calls them exactly as the deployed script does.
 */
function load(fixture, opts) {
  opts = opts || {};
  const ss = new Spreadsheet(fixture.name || 'R&D Log',
    fixture.tabs.map(t => new Sheet(t.name, t.gid, t.values)));

  /* Drive is a directory on this disk: the same four page files the deployment
     reads, so a fingerprint check here means what it means there. */
  const pagesDir = opts.pagesDir || path.join(__dirname, '..', 'pages');
  const drive = { created: [] };
  const folder = {
    getFilesByName(name) {
      const p = path.join(pagesDir, name);
      let done = !fs.existsSync(p);
      return {
        hasNext: () => !done,
        next: () => {
          done = true;
          /* A page the updater has rewritten is served from memory, so a test
             can prove the read-back without touching the repository's files. */
          const buf = folder._written[name] !== undefined
            ? Buffer.from(folder._written[name], 'utf8') : fs.readFileSync(p);
          return {
            getBlob: () => ({
              getDataAsString: () => buf.toString('utf8'),
              getBytes: () => signed(buf)
            }),
            setContent: t => { folder._written[name] = t; }
          };
        }
      };
    },
    createFile(blob) {
      const id = 'drive-file-' + (drive.created.length + 1);
      drive.created.push({ id, name: blob.getName(), type: blob.getContentType() });
      return { getId: () => id, setSharing: () => {} };
    },
    _written: {}
  };

  const fixedNow = opts.now ? new Date(opts.now) : null;
  class FrozenDate extends Date {
    constructor(...a) { if (!a.length) super(fixedNow.getTime()); else super(...a); }
    static now() { return fixedNow.getTime(); }
  }

  const ctx = {
    console, Math, JSON, String, Number, Object, Array, RegExp, Error,
    isNaN, isFinite, parseInt, parseFloat,
    Date: fixedNow ? FrozenDate : Date,

    SpreadsheetApp: {
      getActive: () => ss,
      getActiveSpreadsheet: () => ss,
      getUi: () => { throw new Error('there is no spreadsheet UI in a test run'); },
      getActiveSheet: () => ss.sheets[0]
    },

    DriveApp: {
      getFolderById: () => folder,
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' }
    },

    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
      Charset: { UTF_8: 'UTF_8' },
      formatDate,
      computeDigest(alg, s) {
        const h = crypto.createHash(alg === 'MD5' ? 'md5' : 'sha256');
        h.update(Array.isArray(s) ? unsign(s) : Buffer.from(String(s), 'utf8'));
        return signed(h.digest());
      },
      computeHmacSha256Signature(s, key) {
        return signed(crypto.createHmac('sha256', key).update(String(s), 'utf8').digest());
      },
      base64EncodeWebSafe(x) {
        const buf = Array.isArray(x) ? unsign(x) : Buffer.from(String(x), 'utf8');
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      },
      base64DecodeWebSafe(s) {
        return signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      },
      base64Decode(s) { return signed(Buffer.from(String(s), 'base64')); },
      newBlob(data, type, name) {
        const buf = Array.isArray(data) ? unsign(data) : Buffer.from(String(data), 'utf8');
        return {
          getBytes: () => signed(buf),
          getDataAsString: () => buf.toString('utf8'),
          getName: () => name || '',
          getContentType: () => type || ''
        };
      }
    },

    /* Autocount.gs reads the price snapshot over HTTPS. The harness hands it a
       response from a local fixture instead, so a test never reaches the real
       sync server -- and never has a token to reach it with. */
    UrlFetchApp: {
      fetch(url, params) {
        const r = (opts.fetch || (() => { throw new Error('no fetch supplied to the harness'); }))(url, params);
        const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        const buf = Buffer.from(text, 'utf8');
        return {
          getResponseCode: () => r.code === undefined ? 200 : r.code,
          getContentText: () => text,
          getBlob: () => ({
            getBytes: () => signed(buf),
            getDataAsString: () => text
          })
        };
      }
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (opts.properties && opts.properties[k] !== undefined) ? opts.properties[k] : null,
        getProperties: () => Object.assign({}, opts.properties || {}),
        setProperty(k, v) { (opts.properties = opts.properties || {})[k] = v; return this; },
        deleteProperty(k) { if (opts.properties) delete opts.properties[k]; return this; }
      })
    },

    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    ScriptApp:   { getService: () => ({ getUrl: () => opts.baseUrl || 'https://script.local/exec' }) },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutput(body) {
        const o = { setTitle: () => o, addMetaTag: () => o, setXFrameOptionsMode: () => o,
                    getContent: () => body };
        return o;
      }
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(t) { const o = { setMimeType: () => o, getContent: () => t }; return o; }
    },
    Logger: { log: () => {} }
  };
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  for (const f of ['Code.gs', 'Fixer.gs', 'Web.gs', 'Autocount.gs', 'Secrets.gs', 'PagesData.gs', 'Pages.gs', 'Run.gs', 'LiveTest.gs', 'PicFix.gs', 'Find.gs', 'Cleanup.gs', 'Repair.gs', 'Prices.gs']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    /* Two files cannot both answer doGet. The deployment renames Code.gs's to
       connectorStatus_(), and the repository copy already carries that rename
       -- but assert it, because the regression is silent and takes the site
       down rather than failing loudly. */
    if (f === 'Code.gs' && /^\s*function\s+doGet\s*\(/m.test(src))
      throw new Error('Code.gs declares doGet(); it has to be connectorStatus_().');
    vm.runInContext(src, ctx, { filename: f });
  }

  /* PASTE- placeholders are what is committed, on purpose. Tests need values.
     Setting the CONSTANTS after load is a project that has not been migrated:
     real values in the file, nothing in Script Properties. Passing the same
     values through opts.properties instead is a project that has. Both have to
     behave identically, which is the whole point of the migration. */
  if (opts.secrets !== false) {
    ctx.AUTH_SALT = 'test-salt';
    ctx.AUTH_SECRET = 'test-signing-key';
    ctx.APP_FOLDER = 'test-folder';
    ctx.SECRET = 'test-connector-secret';
    const sha = p => crypto.createHash('sha256').update(p + 'test-salt').digest('hex');
    ctx.USER_SHAPE = {
      manager: { role: 'manager', pic: '',       sha: sha('manager-pw') },
      sakura:  { role: 'bi',      pic: 'Sakura', sha: sha('sakura-pw') },
      robin:   { role: 'bi',      pic: 'Robin',  sha: sha('robin-pw') }
    };
    ctx.USERS = JSON.parse(JSON.stringify(ctx.USER_SHAPE));
  }

  return { ctx, ss, drive, folder };
}

module.exports = { load, Sheet, Spreadsheet, formatDate };
