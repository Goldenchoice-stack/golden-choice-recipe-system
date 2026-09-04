/**
 * Golden Choice — the four things you ever run by hand, in one place.
 *
 * The editor's "Select function to run" picker lists every function in the file
 * you have open, and Web.gs has a lot of them. Opening this file selects one of
 * these instead, so the thing you want is one click rather than a hunt.
 *
 * Each is a one-line wrapper. The work lives where it belongs.
 *
 *   1_preflight     Is this project safe to deploy? Run it before every deploy.
 *   2_installPages  Put the four page files into the app's Drive folder.
 *   3_checkSecrets  Are the six settings in Script Properties?
 *   4_updatePrices  Fill the Prices tab from the AutoCount snapshot.
 *
 * The numbers are only there to fix the order in the picker.
 */

function a1_preflight()    { return preflight(); }
function a2_installPages() { return installPages(); }
function a3_checkSecrets() { return checkSecrets(); }
function a4_updatePrices() { return acFill_().report; }
