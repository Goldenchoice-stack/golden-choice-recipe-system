/**
 * A spreadsheet shaped like the real one, small enough to reason about.
 *
 * Every awkward thing the README records about the live sheet is represented
 * here on purpose, because those are the cases a costing change can quietly
 * break: the merged column I, a rejected version whose number was handed out
 * again, the same submission written twice, text sitting in a number column,
 * Chinese names, recipes with no status at all, and a version left PENDING
 * REVIEW with no row in the queue.
 *
 * Quantities and prices are invented. The SHAPE is not.
 */
'use strict';

const GID = { log: 1784376487, ver: 2145004234, trial: 863907825 };

/* Column I really does hold two headings in one cell, separated by a tab. That
   is why VERSION sits in J and why every reader finds columns by name. */
const MERGED_I = 'AUTOCOUNT ITEM CODE\tLINE COST (RM)';

const LOG_HEAD = ['DATE', 'CREATION ID', 'CREATION NAME', 'INGREDIENT NAME',
                  'VOLUME USAGE', 'UOM (ML/G)', 'CREATED BY', 'STATUS',
                  MERGED_I, 'VERSION'];

const VER_HEAD = ['Recipe ID', 'Version', 'Recipe Name', 'Category', 'Version Status',
                  'Created Date', 'Created By', 'Update Reason', 'Update Remarks',
                  'Approved Date', 'Approved By'];

const TRIAL_HEAD = ['DATE', 'DRINK ID', 'DRINK NAME', 'VERSION', 'R&D PIC', 'CATEGORY',
                    'PROJECT', 'STAGE', 'STATUS', 'RESULT', 'DUE DATE', 'COMPLETION DATE',
                    'NEXT ACTION', 'NOTES', 'Latest (auto)', 'Notes (auto)',
                    'SERVING SIZE (ML)', 'SELLING PRICE (RM)', 'DIFFICULTY', 'EQUIPMENT',
                    'PREPARATION METHOD', 'VIDEO LINK', 'CHINESE NAME', 'PHOTO'];

const CHANGE_HEAD = ['Recipe ID', 'Old Version', 'New Version', 'Field Changed',
                     'Old Value', 'New Value', 'Changed By', 'Changed Date',
                     'Update Reason', 'Remarks'];

const PRICE_HEAD = ['Ingredient', 'Pack Cost (RM)', 'Units Per Pack', 'AutoCount Item Code'];

/* --------------------------------------------------------------- the drinks */
/* Each entry is one block of log rows: a recipe at a version, with the status
   that block carries. Order matters -- rows are appended, and the readers lean
   on that. */
const BLOCKS = [
  /* A plain approved recipe, fully priced once the Prices tab exists. */
  { date: '2026-06-02', id: 'RCP-0001', name: 'Kopi Ais', v: 'V1.0', by: 'Sakura', st: 'Approved',
    ing: [['Kopi Base', '120', 'ML'], ['Condensed Milk', '30', 'ML'], ['Ice', '150', 'G']] },

  /* Approved, and every ingredient priced -- the one that has to show a real
     margin against its selling price. */
  { date: '2026-06-11', id: 'RCP-0002', name: 'Melon Matcha Soda', v: 'V1.0', by: 'Robin', st: 'Approved',
    ing: [['Matcha Powder', '4', 'G'], ['Melon Syrup', '25', 'ML'],
          ['Sparkling Water', '180', 'ML'], ['Ice', '120', 'G']] },

  /* Approved but one ingredient is deliberately absent from the price list, so
     this recipe must read as pending rather than as a cheaper drink. */
  { date: '2026-06-18', id: 'RCP-0003', name: 'Gula Melaka Latte', v: 'V1.0', by: 'Sakura', st: 'Approved',
    ing: [['Espresso', '30', 'ML'], ['Milk', '150', 'ML'], ['Gula Melaka Syrup', '20', 'ML']] },

  /* Priced, but with no selling price recorded: cost shows, margin cannot. */
  { date: '2026-06-25', id: 'RCP-0004', name: 'Lime Sparkle', v: 'V1.0', by: 'Robin', st: 'Approved',
    ing: [['Sparkling Water', '200', 'ML'], ['LIME', 'HALF', 'PC'], ['Sugar Syrup', '15', 'ML']] },

  /* Never assessed. Part of the 199-recipe review backlog. */
  { date: '2026-07-01', id: 'RCP-0005', name: 'Teh O Ais Limau', v: 'V1.0', by: 'GC', st: '',
    ing: [['Tea Base', '150', 'ML'], ['Sugar Syrup', '20', 'ML'], ['Ice', '140', 'G']] },

  /* Text in a number column, exactly as four live rows carry it. */
  { date: '2026-07-04', id: 'RCP-0006', name: 'Kopi Peng Special', v: 'V1.0', by: 'GC', st: 'Approved',
    ing: [['Kopi Base', 'follow powder x 1', 'ML'], ['Condensed Milk', 'Gold Coin', 'ML'],
          ['Ice', '150', 'G']] },

  /* A rejected V2.0 whose number was handed out again, then a V3.0 that is
     approved. V1.0 stayed live throughout the rejection. */
  { date: '2026-07-10', id: 'RCP-0018', name: 'Yuzu Green Tea', v: 'V1.0', by: 'Sakura', st: 'Approved',
    ing: [['Tea Base', '160', 'ML'], ['Yuzu Puree', '25', 'ML'],
          ['Sugar Syrup', '15', 'ML'], ['Ice', '130', 'G']] },
  { date: '2026-08-20', id: 'RCP-0018', name: 'Yuzu Green Tea', v: 'V2.0', by: 'Sakura', st: 'Rejected',
    ing: [['Tea Base', '160', 'ML'], ['Yuzu Puree', '40', 'ML'],
          ['Sugar Syrup', '15', 'ML'], ['Ice', '130', 'G']] },
  { date: '2026-08-25', id: 'RCP-0018', name: 'Yuzu Green Tea', v: 'V3.0', by: 'Sakura', st: 'Approved',
    ing: [['Tea Base', '160', 'ML'], ['Yuzu Puree', '30', 'ML'],
          ['Sugar Syrup', '10', 'ML'], ['Ice', '130', 'G']] },

  /* The same submission arriving twice, back to back, under one version. The
     reader has to keep the last copy -- four ingredients, not eight. */
  { date: '2026-08-26', id: 'RCP-0153', name: 'Apple Camellia Coconut Smoothie', v: 'V2.0', by: 'GC', st: 'Pending Review',
    ing: [['Apple Juice', '120', 'ML'], ['Coconut Milk', '80', 'ML'],
          ['Camellia Tea', '60', 'ML'], ['Ice', '100', 'G']] },
  { date: '2026-08-26', id: 'RCP-0153', name: 'Apple Camellia Coconut Smoothie', v: 'V2.0', by: 'GC', st: 'Pending Review',
    ing: [['Apple Juice', '120', 'ML'], ['Coconut Milk', '80', 'ML'],
          ['Camellia Tea', '60', 'ML'], ['Ice', '100', 'G']] },

  /* Approved V3.0 sitting above a V1.0 the register still calls PENDING REVIEW:
     history, not a decision, and never offered to the manager. */
  { date: '2026-07-15', id: 'RCP-0384', name: 'Roasted Oolong Milk', v: 'V1.0', by: 'Robin', st: 'Superseded',
    ing: [['Oolong Tea', '150', 'ML'], ['Milk', '100', 'ML']] },
  { date: '2026-08-02', id: 'RCP-0384', name: 'Roasted Oolong Milk', v: 'V3.0', by: 'Robin', st: 'Approved',
    ing: [['Oolong Tea', '150', 'ML'], ['Milk', '120', 'ML'], ['Sugar Syrup', '10', 'ML']] },

  /* Filed on the old connector: PENDING REVIEW in the register, no queue row. */
  { date: '2026-08-17', id: 'RCP-0380', name: 'Coconut Coffee', v: 'V2.0', by: 'Sakura', st: 'Pending Review',
    ing: [['Espresso', '30', 'ML'], ['Coconut Milk', '150', 'ML'], ['Sugar Syrup', '15', 'ML']] },
  { date: '2026-06-30', id: 'RCP-0380', name: 'Coconut Coffee', v: 'V1.0', by: 'Sakura', st: 'Approved',
    ing: [['Espresso', '30', 'ML'], ['Coconut Milk', '120', 'ML']] },

  /* Every line priced, but Cheese Foam's pack basis is wrong in the price list,
     so this costs far more to make than it sells for. Nothing here is pending:
     the arithmetic is right and the input is not. */
  { date: '2026-07-28', id: 'RCP-0007', name: 'Cheese Foam Oolong', v: 'V1.0', by: 'Robin', st: 'Approved',
    ing: [['Oolong Tea', '160', 'ML'], ['Cheese Foam', '40', 'ML'], ['Sugar Syrup', '10', 'ML']] },

  /* Rejected outright, so it never reaches the Sales feed. */
  { date: '2026-07-22', id: 'RCP-0377', name: 'Salted Cheese Lychee', v: 'V1.0', by: 'GC', st: 'Rejected',
    ing: [['Lychee Juice', '150', 'ML'], ['Cheese Foam', '40', 'ML'], ['LIME', 'HALF', 'PC']] }
];

/* Chinese name, serving size, selling price and the rest, keyed by recipe and
   version the way the trial log keys them. */
const TRIALS = {
  'RCP-0001|V1.0': { pic: 'Sakura', cat: 'Coffee',  serve: '250', price: '6.50',  zh: '冰咖啡',    method: 'Shake with ice, pour over.', diff: 'Easy' },
  'RCP-0002|V1.0': { pic: 'Robin',  cat: 'Tea',     serve: '330', price: '12.90', zh: '蜜瓜抹茶气泡水', method: 'Whisk matcha, build over ice, top with soda.', diff: 'Medium' },
  'RCP-0003|V1.0': { pic: 'Sakura', cat: 'Coffee',  serve: '300', price: '11.00', zh: '椰糖拿铁',   method: 'Pull espresso, steam milk, stir in syrup.', diff: 'Medium' },
  'RCP-0004|V1.0': { pic: 'Robin',  cat: 'Soda',    serve: '300', price: '',      zh: '青柠气泡',   method: 'Build over ice.', diff: 'Easy' },
  'RCP-0005|V1.0': { pic: 'GC',     cat: 'Tea',     serve: '',    price: '',      zh: '',        method: '', diff: '' },
  'RCP-0006|V1.0': { pic: 'GC',     cat: 'Coffee',  serve: '250', price: '5.90',  zh: '冰咖啡特调', method: 'Follow the powder ratio on the pack.', diff: 'Easy' },
  'RCP-0007|V1.0': { pic: 'Robin',  cat: 'Tea',     serve: '350', price: '13.90', zh: '芝士乌龙',   method: 'Brew, chill, top with cheese foam.', diff: 'Medium' },
  'RCP-0018|V1.0': { pic: 'Sakura', cat: 'Tea',     serve: '350', price: '13.50', zh: '柚子绿茶',   method: 'Shake, strain over ice.', diff: 'Medium' },
  'RCP-0018|V3.0': { pic: 'Sakura', cat: 'Tea',     serve: '350', price: '13.90', zh: '柚子绿茶',   method: 'Shake, strain over ice, less syrup.', diff: 'Medium', photo: 'photo-rcp0018' },
  'RCP-0153|V2.0': { pic: 'GC',     cat: 'Smoothie', serve: '400', price: '15.90', zh: '苹果山茶椰子冰沙', method: 'Blend to a smooth pour.', diff: 'Hard' },
  'RCP-0384|V3.0': { pic: 'Robin',  cat: 'Tea',     serve: '320', price: '10.90', zh: '烘焙乌龙鲜奶', method: 'Brew, chill, pour over milk.', diff: 'Easy' },
  'RCP-0380|V1.0': { pic: 'Sakura', cat: 'Coffee',  serve: '280', price: '11.50', zh: '椰子咖啡',   method: 'Build over ice.', diff: 'Easy' },
  'RCP-0380|V2.0': { pic: 'Sakura', cat: 'Coffee',  serve: '300', price: '12.50', zh: '椰子咖啡',   method: 'Build over ice, more coconut.', diff: 'Easy' },
  'RCP-0377|V1.0': { pic: 'GC',     cat: 'Tea',     serve: '350', price: '14.50', zh: '芝士荔枝',   method: 'Shake, top with cheese foam.', diff: 'Hard' }
};

/* Version register rows: recipe, version, status, and who decided. */
const VERSIONS = [
  ['RCP-0001', 'V1.0', 'Kopi Ais', 'Coffee', 'APPROVED', '2026-06-02 09:10:00', 'Sakura', 'Initial migration', '', '2026-06-03 10:00:00', 'Owner'],
  ['RCP-0002', 'V1.0', 'Melon Matcha Soda', 'Tea', 'APPROVED', '2026-06-11 11:20:00', 'Robin', 'Initial migration', '', '2026-06-12 09:00:00', 'Owner'],
  ['RCP-0003', 'V1.0', 'Gula Melaka Latte', 'Coffee', 'APPROVED', '2026-06-18 14:05:00', 'Sakura', 'Initial migration', '', '2026-06-19 09:00:00', 'Owner'],
  ['RCP-0004', 'V1.0', 'Lime Sparkle', 'Soda', 'APPROVED', '2026-06-25 08:40:00', 'Robin', 'Initial migration', '', '2026-06-26 09:00:00', 'Owner'],
  ['RCP-0005', 'V1.0', 'Teh O Ais Limau', 'Tea', 'DRAFT', '2026-07-01 10:00:00', 'GC', 'Initial migration', '', '', ''],
  ['RCP-0006', 'V1.0', 'Kopi Peng Special', 'Coffee', 'APPROVED', '2026-07-04 10:00:00', 'GC', 'Initial migration', '', '2026-07-05 09:00:00', 'Owner'],
  ['RCP-0007', 'V1.0', 'Cheese Foam Oolong', 'Tea', 'APPROVED', '2026-07-28 09:00:00', 'Robin', 'Initial migration', '', '2026-07-29 09:00:00', 'Owner'],
  ['RCP-0018', 'V1.0', 'Yuzu Green Tea', 'Tea', 'SUPERSEDED', '2026-07-10 09:00:00', 'Sakura', 'Initial migration', '', '2026-07-11 09:00:00', 'Owner'],
  ['RCP-0018', 'V2.0', 'Yuzu Green Tea', 'Tea', 'REJECTED', '2026-08-20 09:00:00', 'Sakura', 'Sweeter build', 'Too sweet on tasting', '2026-08-20 16:00:00', 'Owner'],
  ['RCP-0018', 'V3.0', 'Yuzu Green Tea', 'Tea', 'APPROVED', '2026-08-25 09:00:00', 'Sakura', 'Balance the syrup', 'Approved at 30 ML yuzu', '2026-08-25 16:04:00', 'Owner'],
  /* no queue row for these three: the old connector wrote straight in here */
  ['RCP-0153', 'V2.0', 'Apple Camellia Coconut Smoothie', 'Smoothie', 'PENDING REVIEW', '2026-08-26 09:39:00', 'GC', 'Connector resubmit', 'No change against V1.0', '', ''],
  ['RCP-0380', 'V1.0', 'Coconut Coffee', 'Coffee', 'APPROVED', '2026-06-30 09:00:00', 'Sakura', 'Initial migration', '', '2026-07-01 09:00:00', 'Owner'],
  ['RCP-0380', 'V2.0', 'Coconut Coffee', 'Coffee', 'PENDING REVIEW', '2026-08-17 11:31:00', 'Sakura', 'More coconut', 'Filed on the old connector', '', ''],
  /* still PENDING REVIEW underneath an approved V3.0: history, not a decision */
  ['RCP-0384', 'V1.0', 'Roasted Oolong Milk', 'Tea', 'PENDING REVIEW', '2026-07-15 09:00:00', 'Robin', 'Initial migration', '', '', ''],
  ['RCP-0384', 'V3.0', 'Roasted Oolong Milk', 'Tea', 'APPROVED', '2026-08-02 09:00:00', 'Robin', 'Add syrup', '', '2026-08-02 17:00:00', 'Owner'],
  ['RCP-0377', 'V1.0', 'Salted Cheese Lychee', 'Tea', 'REJECTED', '2026-07-22 09:00:00', 'GC', 'Initial migration', 'Foam split on standing', '2026-07-23 09:00:00', 'Owner']
];

/**
 * The price list. Water and ice are 0 over 1 so they read as free rather than
 * as pending -- the distinction the whole feature turns on.
 *
 * Left deliberately unpriced: Gula Melaka Syrup (blank row, so it is named in
 * the sheet but has no number) and Cheese Foam / Camellia Tea / Apple Juice /
 * Lychee Juice (absent entirely). Both kinds have to read as pending.
 */
const PRICES = [
  ['Kopi Base',        '18.00', '1000', 'AC-KOPI-001'],
  ['Condensed Milk',   '6.40',  '1000', 'AC-MILK-014'],
  ['Ice',              '0',     '1',    ''],
  ['Water',            '0',     '1',    ''],
  ['Matcha Powder',    '96.00', '500',  'AC-MTCH-002'],
  ['Melon Syrup',      '24.00', '1000', 'AC-SYRP-011'],
  ['Sparkling Water',  '3.20',  '1500', 'AC-SODA-003'],
  ['Espresso',         '42.00', '1000', 'AC-COFF-009'],
  ['Milk',             '7.20',  '1000', 'AC-MILK-001'],
  ['Gula Melaka Syrup', '',     '',     'AC-SYRP-020'],
  ['Sugar Syrup',      '9.00',  '1000', 'AC-SYRP-001'],
  ['LIME',             '0.60',  '1',    'AC-FRSH-006'],
  ['Tea Base',         '11.00', '1000', 'AC-TEA-001'],
  ['Yuzu Puree',       '48.00', '1000', 'AC-FRSH-021'],
  ['Coconut Milk',     '8.80',  '1000', 'AC-MILK-030'],
  ['Oolong Tea',       '13.50', '1000', 'AC-TEA-008'],
  /* deliberately wrong: a 1 L tub entered as one pack, so a 40 ML pour is
     charged at the price of the litre. The over-price check catches it. */
  ['Cheese Foam',      '12.00', '1',    'AC-DAIR-004']
];

/* ------------------------------------------------------------------- build */
function logRows() {
  const out = [LOG_HEAD.slice()];
  for (const b of BLOCKS)
    for (const [n, q, u] of b.ing)
      out.push([b.date, b.id, b.name, n, q, u, b.by, b.st, '', b.v]);
  return out;
}

function trialRows() {
  const out = [TRIAL_HEAD.slice()];
  for (const key of Object.keys(TRIALS)) {
    const [id, v] = key.split('|');
    const t = TRIALS[key];
    const block = BLOCKS.find(b => b.id === id && b.v === v) || {};
    const st = block.st === 'Approved' ? 'Completed'
             : block.st === 'Rejected' ? 'Rejected'
             : block.st === 'Pending Review' ? 'Pending Review' : 'Waiting';
    const row = new Array(TRIAL_HEAD.length).fill('');
    row[0] = block.date || '';
    row[1] = id; row[2] = block.name || ''; row[3] = v;
    row[4] = t.pic || ''; row[5] = t.cat || '';
    row[6] = 'Seasonal'; row[7] = block.st === 'Approved' ? 'Approved' : 'Trial';
    row[8] = st; row[9] = '';
    row[10] = ''; row[11] = block.st === 'Approved' ? (block.date || '') : '';
    row[12] = ''; row[13] = '';
    row[16] = t.serve || ''; row[17] = t.price || ''; row[18] = t.diff || '';
    row[19] = ''; row[20] = t.method || ''; row[21] = '';
    row[22] = t.zh || ''; row[23] = t.photo || '';
    out.push(row);
  }
  return out;
}

/**
 * @param {{withPrices?: boolean}} opt  withPrices false leaves the tab out
 *   entirely, which is the state the live sheet is in today.
 */
function build(opt) {
  opt = opt || {};
  const tabs = [
    { name: 'R&D Log',          gid: GID.log,   values: logRows() },
    { name: 'RECIPE VERSIONS',  gid: GID.ver,   values: [VER_HEAD.slice()].concat(VERSIONS.map(r => r.slice())) },
    { name: 'R&D TRIAL LOG',    gid: GID.trial, values: trialRows() },
    { name: 'CHANGE LOG',       gid: 1010101,   values: [CHANGE_HEAD.slice()] },
    { name: 'FEED',             gid: 2094180899, values: [['Recipe ID', 'Name']] }
  ];
  if (opt.withPrices !== false)
    tabs.push({ name: 'Prices', gid: 3030303,
                values: [PRICE_HEAD.slice()].concat(PRICES.map(r => r.slice())) });
  return { name: 'GOLDEN CHOICE R&D LOG (fixture)', tabs };
}

module.exports = { build, GID, PRICES, BLOCKS, TRIALS, VERSIONS,
                   LOG_HEAD, TRIAL_HEAD, VER_HEAD, PRICE_HEAD, MERGED_I };
