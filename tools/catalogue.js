/**
 * A stand-in for the AutoCount item snapshot.
 *
 * INVENTED. Every code, description and price here was made up. This repository
 * is public and the real catalogue is 2,701 items of supplier pricing, which is
 * not ours to publish — so the tests run against this, and the matcher was
 * measured separately against the real snapshot on a machine that may hold it.
 *
 * The SHAPE is exact: the field names are the ones
 * `/api/v1/procurement/latest?datasets=items,supplierPrices&cost=include`
 * returns, and the awkward parts of the real catalogue are all reproduced —
 *
 *   - pack sizes live in the DESCRIPTION, never in a field (AutoCount buys in
 *     PKT / BTL / TIN and records no contents)
 *   - the same product under near-duplicate codes, one suffixed
 *   - a generic word ("MILK", "ICE") shared by many unrelated items
 *   - items with no pack size on the name at all
 *   - items priced in a unit no recipe measures in
 *   - inactive items, and items with no purchase price
 */
'use strict';

const ITEMS = [
  /* every word of "Matcha Powder" is in several of these: the case that must
     never resolve itself, because the per-gram cost differs sixfold */
  ['C010AN02',   'MATCHA POWDER 200G (PREMIUM)',                 'C', 'PKT', 27,    'T'],
  ['C010AN02SL', 'MATCHA POWDER 200G (PREMIUM) (S&L)',           'C', 'PKT', 27,    'T'],
  ['C010AN05',   'MATCHA POWDER 500G (PREMIUM)',                 'C', 'PKT', 55,    'T'],
  ['C010AN03',   'MATCHA POWDER 200G (HIGH CEREMONY)',           'C', 'PKT', 61,    'T'],
  ['C010VB16',   'BREVA GREEN TEA PREMIX POWDER 1.0KG (MATCHA)', 'C', 'PKT', 37.84, 'T'],

  /* exactly one item contains every word of "Gran Espresso Coffee Bean" */
  ['110052',     'LAVAZZA GRAN ESPRESSO COFFEE BEAN 1KG',        'A', 'PKT', 137,   'T'],
  ['110074',     'LAVAZZA QUALITA ORO COFFEE BEANS 250G',        'A', 'PKT', 26.65, 'T'],
  ['110005',     'COFFEE BEAN EXCLUSIVE 500G',                   'A', 'PKT', 39,    'T'],

  /* "Milk" alone is hopeless, and deliberately so */
  ['J020WM01',   'WHOLE MILK 25KG/PKT',                          'J', 'PKT', 210,   'T'],
  ['J020SF02',   'SOYFRESH SOYA MILK 1L',                        'J', 'BTL', 6.4,   'T'],
  ['J020CM03',   'COCONUT MILK 1L',                              'J', 'BTL', 8.8,   'T'],
  ['J020FM04',   'FRESH MILK 1L',                                'J', 'BTL', 7.2,   'T'],

  /* the same product under two codes AND under one duplicated code: the real
     catalogue has both, and a shortlist that prints one product three times is
     a shortlist nobody reads */
  ['C010AN02X',  'MATCHA POWDER 200G (PREMIUM)',                 'C', 'PKT', 27,    'T'],

  /* a pack sold by weight where the recipe pours by volume — grams cannot
     price millilitres, and this is the case that proves it is not tried */
  ['N005RI04',   'ICE HOT BEVERAGE FOAM - CHEESE FOAM 700G',     'N', 'PKT', 15,    'T'],

  /* the three that let one whole recipe be costed end to end, all in litres so
     the units line up with a drink that is poured */
  ['J010SP11',   'SUPIN DARK OOLONG TEA BASE 1L',                'J', 'BTL', 14.24, 'T'],
  ['N005RI09',   'CHEESE FOAM LIQUID BASE 1L',                   'N', 'BTL', 22,    'T'],
  ['S001SG09',   'GOLDEN SUGAR SYRUP 1L',                        'S', 'BTL', 9,     'T'],

  /* unique match, but the name never says how much is in the tin */
  ['S001GM09',   'GULA MELAKA SYRUP',                            'S', 'TIN', 18.5,  'T'],

  /* unique match, but the pack is grams and the recipe pours millilitres */
  ['S001YZ01',   'YUZU PUREE 1KG',                               'S', 'TUB', 48,    'T'],

  /* priced per piece, which is what a lime is */
  ['F001LM02',   'LIME FRESH',                                   'F', 'PC',  0.6,   'T'],

  /* in the catalogue but not for sale, and must never be offered */
  ['C010AN99',   'MATCHA POWDER 200G (DISCONTINUED)',            'C', 'PKT', 19,    'F'],

  /* active, but nobody has a purchase price: omitted rather than sent as zero */
  ['S001SG05',   'SUGAR SYRUP 1L',                               'S', 'BTL', 0,     'T']
];

/* Recipe ingredients that resemble nothing in the catalogue exist too — "Kopi
   Base" is made in-house — and are represented by simply not being here. */

function build() {
  const items = ITEMS.map(([code, desc, group, uom, , active]) => ({
    ItemCode: code, ItemDescription: desc, ItemGroup: group, BaseUOM: uom,
    SupplierCode: '', OnHandQty: 0, CommittedQty: 0, ReorderLevel: 0,
    MinQty: 0, MaxQty: 0, IsActive: active, CartonQty: 0,
    OrderMultiple: 0, MOQ: 0, LeadTimeDays: 0
  }));
  /* The real feed omits an item with no cost rather than sending a zero, so
     this one does too. */
  const supplierPrices = ITEMS.filter(r => r[4] > 0).map(([code, , , uom, price]) => ({
    ItemCode: code, SupplierCode: '', UnitPrice: price,
    Currency: '', UOM: uom, EffectiveDate: '2026-09-04'
  }));
  return { items, supplierPrices };
}

module.exports = { build, ITEMS };
