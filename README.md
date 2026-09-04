# Golden Choice Recipe System

**No build step and no server.** The four scripts run inside the recipe spreadsheet
itself and the four pages read it through them, so the site updates itself.

```
apps-script/Web.gs          the whole site: serves the four pages, answers their calls
apps-script/Code.gs         writes to the sheet — submit_() and approve_() live here
apps-script/Fixer.gs        the R&D Tools menu inside the spreadsheet
apps-script/Autocount.gs    fills the Prices tab from the AutoCount snapshot
apps-script/appsscript.json project settings, including the web app access rules

pages/index.html      Recipe Finder  — open to everyone, approved recipes only
pages/intake.html     R&D Intake     — new recipe and update, sign-in required
pages/approve.html    Approvals      — manager only
pages/dashboard.html  Dashboard      — R&D at a glance

tools/                run and test all of the above on a laptop — see below
```

**The four `.gs` files are the deployed source.** They live in the Apps Script
project bound to the recipe spreadsheet; this repository is the readable copy of
them. The four pages are kept as files in a Drive folder and read at request
time, which is why a page can be changed without redeploying anything.

**Every secret in `apps-script/` has been replaced by a `PASTE-…` placeholder,**
because this repository is public. The real values — the deployment URL, the
three passwords, the password salt, the token-signing key, the connector secret
and the Drive folder ID — are in `secrets.local.md`, which is deliberately not
committed. Nothing here will run until those are filled in.

**Reading this for the AutoCount work?** Start at *Costing — built, and waiting on
the price list*, near the end. It is the only place the two systems need to meet,
and the code side of it is finished: every page costs a recipe, flags a price that
cannot be right, and names the ingredient it is waiting on. What is missing is the
prices themselves. The tab, the four column headings and the order to fill them in
are written out there.

---

## Running it on a laptop

Nothing here is a copy of the site. `tools/gas.js` supplies just enough Apps Script —
`SpreadsheetApp`, `Utilities`, `DriveApp`, `LockService` and the rest — for the **real**
`.gs` files to be loaded and run unmodified, against a fixture spreadsheet shaped like the
live one. Whatever is proven here is proven about the files that are deployed.

```bash
node tools/test.js      # 93 checks
node tools/serve.js     # the four pages, at http://localhost:8788
```

`tools/serve.js` runs the real `doGet()` and the real `prelude_()`, and answers the pages
through the real `api()`. Only `google.script.run` is shimmed, because Apps Script provides
it and a browser does not. So the pages you see are the pages as deployed, not a mock-up.
Sign in as `manager` / `manager-pw` — a fixture password that exists only in `tools/gas.js`;
the `PASTE-…` placeholders in `apps-script/` stay untouched, which is why the repository
can be public.

Add `--no-prices` to see the site exactly as it stands today, with no price list at all.

`tools/fixture.js` deliberately reproduces every awkward thing this file records about the
live sheet — the merged column I, a rejected version whose number was handed out again, the
same submission written twice, text sitting in a number column, Chinese names, recipes with
no status, and a version left PENDING REVIEW with no row in the queue. Those are the cases
that break quietly. The shapes are real; the quantities and prices are invented.

**What it cannot prove.** `submit_()` and `approve_()` write to the sheet. The harness runs
them against a fixture, not against your spreadsheet, so an intake → approvals round trip
still wants doing once on the live deployment.

---

## Leaving Zo — the site moves into your own Google account

Zo hosts the pages and nothing else. The recipes have always lived in **your**
spreadsheet, and the writer that puts them there has always been **your** Apps
Script. So the move is not a rebuild: it is taking the four pages and the little
web server, and running them from the same Apps Script that already owns the data.

`connector/Web.gs` is that server. Free, no second account, no machine to keep
alive, and reachable from any phone.

### What changes, and what does not

| | Before | After |
|---|---|---|
| Recipes, versions, trials | Your Google Sheet | **unchanged** |
| Who writes to the sheet | `Code.gs`, called by Zo | `Code.gs`, called directly |
| The four pages | Zo | Apps Script, from a Drive folder |
| `recipes.json` and friends | rebuilt every 60s by a daemon | worked out from the sheet as the page asks |
| Photos of the drinks | a folder on Zo's disk | Drive, beside the pages |
| Submissions awaiting a decision | 13 files on Zo's disk | a hidden `SUBMISSIONS` tab in the sheet |
| Signing in | manager / sakura / robin | **unchanged — same names, same passwords** |

Nobody needs a Google account and nobody re-learns anything. The same three names
and the same three passwords, checked against the same salted hashes; the Recipe
Finder still open to anyone with the link; approving still the manager's alone.

The pages themselves are the pages you already use. Four small edits: photos come
from Drive, links move the outer frame, the intake reads `?update=` from the
script rather than from an address the sandbox hides from it, and *Enter another*
reloads through the same route.

### It is live

**The deployment URL is in `secrets.local.md`, not in this repository.**

Deployed 25 Aug 2026 as Version 9, from the spreadsheet's own Apps Script project
(`Code.gs`, `Fixer.gs`, `Web.gs`), running as the company Google account — the
account that owns the sheet, the script and the Drive folder, so nothing has to
be shared with anybody.

Add `?p=intake`, `?p=approve` or `?p=dashboard` to reach the other three, or just
use the buttons. Sales get the bare link.

An earlier deployment made from the wrong account has been archived.

### How it was put there

The four pages sit in a Drive folder called **Recipe app**, beside the
spreadsheet. They were uploaded directly, so nothing had to be converted at
install time and no password was ever typed into the script. If you rebuild this
somewhere else, the steps are:

1. Open the sheet → **Extensions → Apps Script**.
2. In `Code.gs`, rename `function doGet()` to `function connectorStatus_()`.
   Two files cannot both answer `doGet`, and nothing calls the old one — it only
   ever drew a "Connected" status page.
3. **+ → Script**, name it `Web`, and paste `connector/Web.gs` over it. Nothing
   in it needs editing: the three accounts and the folder are already filled in.
4. **Deploy → New deployment → Web app**, *Execute as* **Me**, *Who has access*
   **Anyone**. Google will ask you to authorise the script the first time. That
   URL is the site — give it to Sales and keep it yourself.

One deployment, one link. It runs as you, so nothing in the spreadsheet or in
Drive has to be shared with anybody to make it work.

Optional, any time: run **checkPages** from the editor. It fingerprints the four
files in Drive and tells you whether they are still exactly the copies that were
tested — worth one click if a page ever starts behaving oddly.

### How the sign-in survived the move

The check is still on the server side of the call, not in the page. `api()`
refuses anything but the approved feed without a valid session, and refuses to
approve for anyone but the manager — so the Approve and Reject buttons being
hidden from BI is a courtesy, not the lock. Buttons are what a page draws;
`api()` is what decides.

**One thing genuinely changed, and it is a step down.** The old site kept the
session in an HttpOnly cookie, which no script on the page could read. A page
served by Apps Script runs in a sandbox that cannot be given a cookie, so the
session is a signed token that rides in the address bar instead. It still cannot
be edited into a different role — the signature is checked on every call, and a
token rewritten to say `manager` is refused. But it is visible, so **treat that
link the way you would treat the password**: bookmark it, do not paste it into a
group chat. Signing out is landing back on the plain URL without it.

Changing `AUTH_SECRET` ends every session at once, which is what it is there for.

### Two things that are now tighter than they were

`all-recipes.json` and `prices.json` used to be readable by anyone who knew the
URL — they carry rejected drinks, internal notes and cost. They now need a
signed-in name. Only the approved feed is open, which is all Sales ever used.

Drink photos are shared **anyone with the link**, which is what lets a card show
one. That matches what Zo did; it is worth knowing rather than assuming.

### A version number handed out twice — fixed 26 Aug 2026

The Finder showed RCP-0018 with twelve ingredients when it has four: the same
four, three times over, one set per submission. The rows were right; the reading
of them was not.

A recipe is grouped by version and the live version is shown. If two different
submissions both land under **V2.0**, every row from both ends up in one bucket
and the stale ones are shown beside the current ones. Two ways that happened:

**A rejected version hands its number back out.** V2.0 was rejected on 20 Aug,
which left V1.0 live, so the next update was minted as V2.0 again — on top of the
rejected one's rows. `doSubmit_` now mints from the highest version a recipe has
ever carried, not the live one, so a rejected V2.0 is followed by V3.0. Version
numbers may skip after a rejection. That is the point: they stay unambiguous.

**The same submission arrives twice.** The reader now drops the earlier blocks
two ways, because either alone can be fooled. Rows are only appended, so the last
unbroken run of rows for a version is the current one — unless the two blocks are
adjacent, which happens when nothing else was written in between. So when a
version's rows are an exact repetition of a shorter block, only the last copy is
kept. A recipe that genuinely repeats an ingredient is safe: it would have to
repeat its whole list, in order, to look like this. Across all 400 versions in
the log, exactly one is such a repetition.

Run against the live sheet, one recipe changes — RCP-0018, from twelve ingredient
rows to its real four, Milk at the current 150 ML. RCP-0153 carries the same
doubling on a version still pending; it resolves to five the moment it is
approved. All 388 recipes, the 240-recipe feed, the counts, the next ID, the unit
list and the 435 ingredient names come out unchanged. Deployed as Version 12 on
the same URL.

**The Finder caches.** Sales keep seeing the old card until the page is
refreshed — the **Refresh** button, or the next time the cache lapses.

### The Zo connector was still writing — stopped 26 Aug 2026

The same morning, RCP-0379 "Alaska Coffee" was being resubmitted **every two
minutes**, and had been since 25 Aug 11:31. Not from this site: its queue held
one submission in total. The Apps Script execution log named the culprit —
`doPost` on **Version 7**, the old Zo connector deployment, failing and being
retried by something on the Zo box on a two-minute timer.

That deployment is now archived, and the last write was 09:39. What it had piled
up:

| | that one recipe | tab was |
|---|---|---|
| R&D Log | 920 rows | 2,797 |
| RECIPE VERSIONS | 230 rows | 242 |
| R&D TRIAL LOG | 230 rows | 516 |
| CHANGE LOG | 1,840 rows | 1,882 |

All 3,220 were deleted, keeping the newest submission of each so the pending
V2.0 can still be approved or rejected properly. The R&D Log is back to 1,921
rows. Every repeat was identical bar its timestamp, so nothing was lost.

The one submission this site has put through end to end — RCP-0018, filed by
`manager`, approved by Owner at 16:04 on 25 Aug — is what proved the write path.

**Every Zo-era endpoint is now archived.** Four other deployments were still
live on this script project — Versions 1, 2, 4 and 7, left over from the Zo
build. Nothing but the Version 7 one was being called, but each ran the same
code and would have accepted the same writes. The project now has exactly one
active deployment: this site, Version 12, on the URL above.

Two things that are not closed by this. The Zo box itself was not touched: its
timer is very likely still firing every two minutes and simply getting nothing,
so switch it off at that end. And the spreadsheet is still shared **anyone with
the link**, so Zo — or anything else — can still read it.

### The intake could not search Chinese — fixed 26 Aug 2026

The intake's "search existing recipe" matched the recipe ID, the English name and
the ingredients. It did not match the **Chinese name**, though the Recipe Finder
always has. Typing 抹茶 returned nothing at all — and "nothing" was drawn as the
dropdown simply vanishing, which reads exactly like a recipe that is not there.

Three changes to `intake.html`:

* the search matches the Chinese name, and says so when that is what matched;
* each result shows its Chinese name beside the English one;
* the list is headed by a count — **3 matches** — and a search that finds
  nothing says so in words rather than disappearing. A short list and a list cut
  off at forty used to look identical, which matters when a recipe seems missing.

Checked against the live sheet by running the page's own handler over the real
`all_()`: melon → 3, 抹茶 → 3 (all by Chinese name), RCP-0386 → 1, espresso → 27,
zzzz → the new message. The page in the app folder is byte-identical to the one
tested: **38,921 bytes, md5 5f34b85b984dcda91a799e7274bf741c**, and `checkPages`
now carries that fingerprint. Deployed as Version 13.

**The Drive permission had to be widened to do it.** The project could read the
app folder but not write to it, so nothing could rewrite `intake.html`. The same
gap meant `savePhoto_` — the photo on an intake submission — would have failed
the moment anyone attached one, with *"You do not have permission to call
DriveApp.Folder.createFile"*. No submission had carried a photo yet, so it had
never shown. Granting the write scope fixed the page and that at once.

### Three approvals that could not be reached — fixed 26 Aug 2026

The Approvals page read the **SUBMISSIONS** queue and nothing else. Everything
filed on the old Zo connector wrote straight into RECIPE VERSIONS and left no
queue row, so those submissions were invisible to the manager: the sheet said
PENDING REVIEW and there was no button anywhere that could answer it. Three were
stuck this way:

| Recipe | | Filed by | When |
|---|---|---|---|
| RCP-0380 Coconut Coffee | V1.0 → V2.0 | Sakura | 17 Aug |
| RCP-0153 Apple Camellia Coconut Smooothie | V1.0 → V2.0 | GC | 25 Aug |
| RCP-0379 Alaska Coffee | V1.0 → V2.0 | GC | 26 Aug |

`sheetPending_()` now gathers them, in the shape the page already draws, so
`approve.html` did not have to change at all. Approving one works the same way:
`doApprove_` already skipped the queue write when there is no row to write to.

Two rules keep it honest. The **last** row written for a version is where that
version stands, so a PENDING REVIEW that was later approved does not come back —
RCP-0018 V2.0 is approved and stays gone. And a version the library has already
moved past is history, not a decision — RCP-0384 V1.0 still reads PENDING REVIEW
underneath an approved V3.0, and is skipped. Both were checked: exactly the three
above are offered, and an item already in the queue is not offered twice.

RCP-0153 shows **no changes** against V1.0, because the Zo double-submit changed
nothing. That is worth seeing before deciding, so it is shown rather than hidden.

Deployed as Version 14.

### The recipe photo was being cropped — fixed 1 Sep 2026

The photo in the recipe card was drawn at `object-fit: cover` inside a fixed
280px band, which fills the box by cutting whatever does not fit. A photo taken
in portrait lost its top and bottom. Since the photo comes from whichever phone
R&D had that day, its shape is never known in advance.

It is now fitted rather than cropped: `object-fit: contain`, `max-width:100%`,
`max-height:340px`, `width/height:auto`, centred. The frame takes the shape of
the picture instead of the picture being cut to the frame — a wide photo fills
the width, a tall one stands at its full height with space either side, and a
small photo is shown at its own size rather than blown up. Nothing else on the
card moved.

That is one attribute in `index.html`, changed in place: same Drive file, 21,612
to 21,658 bytes, md5 `9a6ddd57ac81fecaa3341c4e6b7cfdcc`, and `PAGE_FINGERPRINTS`
updated to match so `checkPages()` still reads clean. The page is read from Drive
on every request, so no deployment was needed.

### What was checked before any of this was written

The version rules are the part worth getting wrong quietly, so they were not
guessed. `Web.gs` was run against the real spreadsheet export and its output
compared with what the live site is serving right now:

```
recipes            388 / 388        every field, every ingredient identical
approved feed      240 / 240        no recipe gained or lost
counts             approved 240, rejected 9, unreviewed 139   identical
next recipe ID     RCP-0391         identical
ingredient list    435 / 435        identical
```

Signing in was exercised the same way, against the real hashes: all three names
in with the passwords already in use, wrong passwords and unknown names refused,
a token edited to say `manager` refused, and each name checked against every call
it can and cannot make — Sales reach the approved feed and nothing else, BI read
the queue but cannot approve, only the manager can. 33 checks, all passing.

Which matters because the rule is subtle: a recipe shows the highest version that
has been **approved**, not the newest one. RCP-0018's V2.0 was rejected, so V1.0
is still the live recipe and lends V2.0 none of its serving size or price. All
388 agree.

The dashboard is recomputed from the same two tabs. Its headline numbers agree;
a couple of the roll-ups (`multiVersion`, trials-per-day) count slightly
differently from the old daemon, because the daemon's exact definitions were not
recoverable. Nothing on that page is used to make a decision.

**Not yet exercised against a live deployment:** submitting and approving run
through `Code.gs`'s own `submit_()` and `approve_()`, so they do what they have
always done — but that path cannot be proven from here. Put one throwaway recipe
through intake → approvals before switching Zo off.

---

## Putting it on Zo

Upload everything in `public/` to wherever the site is served from, then delete the
old ones:

```
delete:  dashboard.html  intake.html  approve.html
delete:  recipes.json  all-recipes.json  prices.json  dashboard.json
```

`index.html` replaces the current one. `console.html` replaces the other three pages.
`/api/submit`, `/api/pending` and `/api/approve` are untouched — the console calls the
same endpoints with the same payloads.

`engine.html`, `log.html` and `research.html` are the three marketing pages. They are
plain files in the same folder — no route, no build, no data file. Reach them at
`/engine.html`, `/log.html` and `/research.html`.

**Their live numbers come from the sheet, not from the page.** Each one loads `sheet.js`,
reads the four tabs on open and again every two minutes, and rewrites the recipe counts,
the date and the Mid-Autumn countdown. Leave one open on a screen and it stays current on
its own. The generated content itself — the 12 items, the 4 research records, the posters
and the video — is a record of what was produced on 15 and 16 August and does not change,
which is what a log is for.

If you would rather have your Zo agent do it, paste this:

> Put these files in the folder the site is served from, replacing what is there:
> `index.html`, `console.html`, `engine.html`, `log.html`, `research.html`,
> `sheet.js`, `app.css`. Then delete `dashboard.html`, `intake.html`,
> `approve.html`, `recipes.json`, `all-recipes.json`, `prices.json` and
> `dashboard.json`.
> Do not change anything under `/api/` — the console uses the same endpoints.
> There is no build step, no data file to generate and nothing to schedule: every page
> reads the Google Sheet itself.
> Keep the site always-on so `/engine.html`, `/log.html` and `/research.html` answer
> without a wake-up.

**The host sleeps.** It has returned *"The Zo Computer hosting this site is asleep"* for
every request more than once. While it sleeps, nothing is reachable from any phone. If
this dashboard is meant to be checked without warning, always-on hosting is the thing to
fix — no amount of work on these pages gets around it.

---

## How updating works

Every page load, and every 2 minutes while a page is open, it fetches four tabs of the
sheet as CSV and rebuilds everything: recipes, versions, costing, dashboard figures,
trials.

**Change the sheet and the pages follow.** Nothing to run, nothing to schedule, nothing to
forget.

This works because the sheet is readable by link and Google serves those CSV exports with
permissive CORS — checked from a browser, cross-origin, before anything was built on it.
If the sheet is ever set to "restricted" the pages say so plainly instead of quietly
showing stale numbers.

*What this removed:* a Node exporter, a 165 KB generated `data.json`, four separate JSON
files and the scheduled job that produced them. All of it existed only to move data the
browser can read for itself.

---

## Monitoring and approving

Every figure on the dashboard opens. Tiles, pipeline bars, PIC rows, status rows, period
rows. Clicking one lists exactly the records it was counted from; clicking a record opens
the recipe with ingredients, status, cost and version history.

**Anything waiting on you goes straight to the decision.** The *Pending review* tile, the
*Waiting for approval* card and the *Pending review* status row all jump to the Approvals
tab, scroll to that exact submission and highlight it, with Approve and Reject ready. One
click from noticing it to deciding it.

Three rules hold it together, each verified by clicking every figure in a browser:

- **A figure and its list always agree.** All 18 clickable figures were checked against
  their own drill-down. The approvals queue lists *versions*, not recipes, because that is
  what it counts — one recipe can have two versions waiting.
- **No dead ends.** A tile only becomes a button when there is something behind it, so a
  zero never invites a click that leads to an empty list.
- **A missing submission explains itself.** If the sheet marks a version pending but the
  host's queue has no submission for it — an old record, usually — the page says so
  instead of looking broken.

---

## Accounts — one manager, two BI

Since 24 Aug the three working pages need a name. **The Recipe Finder does not** — it is
the read-only page the whole company uses, and locking it would have shut Sales out of the
recipes they already rely on. Say the word and it takes one line to gate that too.

| | Recipe Finder | Intake | Approvals | Dashboard | Approve / Reject | R&D PIC starts on |
|---|---|---|---|---|---|---|
| **manager** | ✓ | ✓ | ✓ | ✓ | **✓** | — |
| **sakura** | ✓ | ✓ | ✓ (read-only) | ✓ | — | Sakura |
| **robin** | ✓ | ✓ | ✓ (read-only) | ✓ | — | Robin |
| nobody signed in | ✓ | — | — | — | — | — |

```
manager   the three passwords are in secrets.local.md
sakura    the three passwords are in secrets.local.md
robin     the three passwords are in secrets.local.md
```

**Each BI signs in as themselves, and the intake starts on their name.** `USERS` carries a
`pic` alongside the role — the R&D PIC that name files work under — and the intake pre-selects
it on every form, new creation or update. It is a starting point, not a lock: the dropdown
still offers Sakura, Robin and GC, so filing on someone else's behalf takes one click.

The shared `bi` login was retired when these two replaced it. The session secret was rotated
at the same time, so its cookie is dead rather than merely unlisted — everyone signs in once
more, and that is the point.

A third person is a third line in `USERS`: a name, a role, a `pic` that matches one of the
dropdown options, and the hash below.

**Change both.** They were set at handover so the thing worked the day it shipped. Passwords
are stored as a salted SHA-256 in `USERS` near the top of `server.js`, never in the clear:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('NEWPASS'+'THE-SALT-FROM-secrets.local.md').digest('hex'))"
```

Paste the result over the old `sha` and restart the site. Adding a third person is a third
line in the same object.

### What it does, and what it does not

**The check is on the server**, not in the page. `/api/approve` refuses anyone who is not
the manager, and `/api/submit` and `/api/pending` refuse anyone not signed in — so the
Approve and Reject buttons being hidden from BI is a courtesy, not the lock. BI sees the
queue and the full submission; where the buttons would be it says *Read-only for you.*

The session is a cookie the server signs with an HMAC, marked HttpOnly, good for 30 days.
It cannot be edited into a different role, and no script on the page can read it.

Honest limits:

- **The recipe data itself is still open.** `recipes.json`, `all-recipes.json` and the
  photos are served to anyone with the URL, because the Recipe Finder needs them. The sheet
  is readable by link anyway.
- **Two shared logins, not one per person.** Approvals still record who decided from the
  *Your name* dropdown, which is a claim rather than a fact. If you want that to be real,
  the next step is a name per person.
- **No lockout on repeated guesses.** Fine behind a company URL; not fine facing the public
  internet.

The sign-in screen is generated by `server.js` — there is no `login.html` to keep in
step, and the signed-in strip in the corner is injected as each page is served for the same
reason.

---


## On phones

Both pages were loaded at a real 375 px phone viewport: no sideways scrolling, two tiles
per row, one recipe card per row, the drill-down fills the screen, and the intake
ingredient name field takes the full width instead of being squeezed to 110 px.

The **old** `index.html` had no `<!doctype>`, `<html>`, `<head>` or viewport tag — it began
at `<title>`. Phones fell back to a 980 px virtual viewport and shrank the page to about
38%, rendering 15 px text at roughly 5.7 physical pixels. That is fixed.

---

## The sheet writer — automatic since 20 Aug 2026

**Nothing to run.** The sheet fills itself in at the two moments that matter: when a
recipe is submitted, and when it is decided.

In the sheet, **Extensions → Apps Script** shows `Code.gs` (your intake writer) and
`Fixer.gs`. `Code.gs` was append-only by design — it stamped `RECIPE VERSIONS` and left the
R&D Log saying *Pending Review* for ever, which is why an approved revision never reached
the site. Three lines were added to it, and the work they call lives in `Fixer.gs`:

| When | What happens |
|---|---|
| **On submit** | `trialRow_` writes one row to `R&D TRIAL LOG` with everything the intake captured — Project, Stage, Due Date, Next Action, Notes, and the production detail. |
| **On approve / reject** | `syncLog_` writes the decision into the R&D Log's STATUS column, marks the replaced versions `Superseded`, and closes the trial row with its result and completion date. |

Eight columns were added to the right of `R&D TRIAL LOG`, because the intake captured them
and the sheet had nowhere to put them:

```
SERVING SIZE (ML)   SELLING PRICE (RM)   DIFFICULTY
EQUIPMENT           PREPARATION METHOD   VIDEO LINK
CHINESE NAME        PHOTO
```

The last two were added on 21 Aug. The intake had asked for a Chinese name from the start
and the sheet had no column for it, so every one ever typed was thrown away on submit. The
photo was uploaded and stored in the queue folder and never recorded anywhere the sheet
could see. `trialRow_` now writes both.

Columns O and P are written around, never through, so `Latest (auto)` is untouched.

**Category is carried forward.** Updating an existing recipe left Category blank, because
the intake page has no way to know what it was — that is why `RCP-0384 V2.0` has an empty
Category. `carriedCategory_` now copies the last one the recipe had.

**The menu is only for catching up.** **R&D Tools → Fix the sheet now** repairs rows that
predate this — approvals made before it existed, versions still sitting in Pending Review
behind a newer approved one. Running it twice does nothing the second time. It may ask for
authorisation the first time after a redeploy; that is Google re-checking your own script,
and you have to click it yourself.

It deliberately uses only the spreadsheet permission the project already had — no
`UrlFetchApp`, no `ScriptApp`, so no OAuth scope was widened and nothing about the intake's
authorisation changed.

**Deployment.** The host calls the web app deployment named *20260817 RECIPE INTAKE*
(its ID is in `secrets.local.md`). Apps Script deployments are pinned to a version, so **editing
the code changes nothing until you redeploy**: Deploy → Manage deployments → pencil →
Version *New version* → Deploy. That keeps the same URL. It is on **Version 7**.

> Note: the description field shows the old value as grey placeholder text, not as a value.
> Leaving it alone renames the deployment to *Untitled*. Type it back in.

**To undo:** *File → Version history* restores the sheet; *Deploy → Manage deployments*
rolls the web app back to an earlier version.

---

## Editing an existing recipe

An update has to be *seen* as a change before it can be submitted. Until 20 Aug the page
compared only the **recipe name and the ingredient rows** — so changing the serving size,
the selling price or attaching a photo left it saying *"Nothing has changed yet"*, with the
Submit button disabled. There was no way to send those edits for approval at all.

Three pieces now close that loop:

1. **The exporter publishes the production detail.** `all-recipes.json` carries `zh`,
   `photo`, `serve`, `price`, `diff`, `equip`, `method`, `video`, `project`, `stage` and
   `notes`, read from `R&D TRIAL LOG` and keyed by recipe *and version*, so each recipe
   reports its live one.
2. **The intake pre-fills them** when you load a recipe, and compares them. Chinese name,
   serving size, selling price, difficulty, equipment, preparation method, video link and
   an attached photo each count as a change and appear in **What changed**.
3. **The approver can see them.** Chinese name, serving size, selling price, difficulty and
   equipment show on the approval card, and the photo is displayed — served from `/photo/<file>`,
   images only, basename only, out of the queue folder. Before this the photo was uploaded
   and stored and then never shown to anyone.
4. **The Recipe Finder shows them too.** `recipes.json` carries `zh`, `by`, `serve`,
   `price`, `method` and `p` (the photo file), and the recipe card renders the photo at the
   top with the Chinese name, selling price, method, serving size and who made it. Those
   rows used to be
   **hardcoded placeholders** — the page never read any data for them, so they said *Not
   available* no matter what the sheet held.

**Update a recipe from the card you are already looking at.** Signed in, every recipe on
the Recipe Finder carries an **Update this recipe** button that opens the intake with that
recipe already loaded — no going to intake, searching for the drink, and loading it again.
It is `intake.html?update=RCP-0073`, so the link can be pasted or bookmarked. Signed out,
the button is not drawn at all, and the link itself lands on the sign-in screen.

That is also why the Finder now shows the **Sign out** strip in the corner when somebody is
signed in: the server hands it the name for the button, and the name comes with a way to
drop it. Signed out, the page is byte-for-byte what Sales has always seen.

**The finder searches Chinese names.** The search index was built from the recipe ID, the
English name, the month and the ingredient names — the Chinese name was the one field left
out, so typing 气泡水 returned nothing even for a drink called 蜜瓜抹茶气泡水. It is in the
index now, and each card prints the Chinese name under the English one so a Chinese search
explains its own results. Partial words match, the way they do in English.

**The page and the server now agree on what counts as a change.** The intake was fixed on
20 Aug to treat serving size, price, Chinese name and the rest as real changes, but
`server.js` was never told: it still compared only the recipe name and the ingredient rows.
So a Chinese-name or serving-size edit listed itself under **What changed**, let you press
Submit, and came back *"Nothing has changed — amend something before submitting."* The
server runs the same seven comparisons now, plus the photo, and records them in the change
log. A rename on its own is still a minor bump; anything else is major, on both sides.

**A drink keeps its photo across version bumps.** Every other field is pre-filled when you
load a recipe, so it survives a revision by being re-submitted. A file input cannot be
pre-filled — the browser forbids it — so nobody re-attaches the picture, and approving
`V2.0` was quietly throwing away the photo taken for `V1.0`. That is why *Melon Matcha
Soda* had a photo on file since 20 Aug and showed none. The exporter now falls back to the
newest photo the recipe has, whichever version it arrived with. Attaching a new one still
replaces it.

Reason and Remarks are still required for an update. That is deliberate: a version bump
with no stated reason is worse than no version at all.

**Recipes that predate 20 Aug have no production detail recorded**, so their fields load
empty and your first entry reads as *added* rather than *changed*. That is accurate — the
sheet genuinely never held those numbers before. On the finder they degrade honestly: no
photo element at all, fields marked *Not available*, and the notice names exactly what is
missing rather than implying the whole page is provisional.

**Gross margin needs a cost.** It is never estimated from the selling price — see below.

## Costing — built, and waiting on the price list

**The code is done. 472 ingredients are still unpriced**, so every recipe honestly reads
*Needs costing* rather than showing a guessed number. Once this change is on the live site
(*Putting this change on the live site*, below), filling in the `Prices` tab is the whole
remaining job: a row typed there shows up on the next page load, with nothing to deploy
and nothing to switch on.

What was built, 4 Sep 2026:

* **One arithmetic, in one place.** `costOf_` in `Web.gs` is the only thing that costs a
  recipe, so the intake pricing a line as it is typed, the card the manager approves, the
  Recipe Finder and the dashboard tile cannot disagree about what a drink costs.
  `cost per unit = Pack Cost ÷ Units Per Pack`; a line is that times the quantity; a cup is
  the lines added up, rounded once at the end rather than line by line.
* **A recipe with any line it cannot cost reports no cost at all.** A partial total is a
  wrong number wearing a right one's clothes. A drink that looks cheap because an
  ingredient was forgotten is worse than one that admits it does not know yet.
* **The two reasons are kept apart,** because they have different fixes. *No price yet for
  Gula Melaka Syrup* is a job for the `Prices` tab. *The quantity recorded for LIME is not
  a number* is a job for the R&D Log — those are the four `VOLUME USAGE` rows listed under
  *Other things worth cleaning*. Every page names the ingredient rather than saying
  "pending".
* **A cost at or above the selling price is flagged, not hidden.** It is almost never a
  drink that loses money; it is `Units Per Pack` not matching the UOM the recipe measures
  in — a 1 L syrup entered as one pack, so every ML is charged at the price of the litre.
  With 472 ingredients to price by hand out of AutoCount that is the mistake to expect, so
  the figure is shown, marked **check units**, and the dearest line is named. Hiding it
  would throw away the only signal that the price list needs correcting.

Where it shows up:

| | Before | Now |
|---|---|---|
| **Recipe Finder** | *Cost / cup* and *Gross margin* were fixed text | both real — **for a signed-in name only** |
| **Dashboard** | *Costing done* was hard-coded to `0` | a real count, and it opens |
| **Dashboard** | — | **Holding costing up**: which ingredients block the most recipes |
| **Approvals** | old-connector submissions always read *pending* | costed from their own rows, with the margin |
| **R&D Intake** | already built for this | unchanged, and it now has numbers to show |

**Cost does not go to Sales.** The Finder is deliberately open to anyone with the link,
which is exactly why what a drink costs to make is not in the answer it gives a stranger:
the open feed carries no cost field at all — not hidden in the page, absent from the
payload — and the two rows read *Staff only*. That is one condition in `feed_()` if you
ever want it public.

### Fill in the price list, in the order the dashboard gives you

**Holding costing up** on the dashboard lists every unpriced ingredient with the number of
recipes waiting on it, worst first. That is the order to work in — the top of that list
buys the most recipes per row.

**Most of the typing is done for you.** *AutoCount — where the prices come from*, below,
covers **R&D Tools → Update prices from AutoCount**: it builds the tab, shortlists real
items with their cost per gram or per ML worked out, and prices every row you give a code
to. Read that first; the three steps below are what it assumes is already true.

Three steps, unchanged:

### 1. Split the merged column in the R&D Log

Column I holds **two column names in one cell**, separated by a tab:

```
AUTOCOUNT ITEM CODE⇥LINE COST (RM)
```

While that is one cell no cost can ever be read from it.

1. Insert a blank column after I.
2. Set `I1` to `AUTOCOUNT ITEM CODE` and `J1` to `LINE COST (RM)`.

`VERSION` shifts along; nothing breaks, because the pages find columns by heading rather
than by position.

### 2. Create a tab named `Prices`

Headers in row 1, in this order:

| A | B | C | D |
|---|---|---|---|
| Ingredient | Pack Cost (RM) | Units Per Pack | AutoCount Item Code |

**This order is not cosmetic.** `prices_()` in `Web.gs` reads columns A to D by
position, so the four headings have to sit in exactly these four columns.

- **Ingredient** — must match the spelling in the R&D Log (case does not matter).
  That match is the whole integration: the R&D Log holds free text a person typed,
  and AutoCount holds item codes, so anything spelled differently simply will not
  price. See *Other things worth cleaning in the sheet* for how bad that is today.
- **Pack Cost (RM)** — what you pay for one purchased pack.
- **Units Per Pack** — how many UOM in that pack. A 1 L syrup used in ML is `1000`.
- **AutoCount Item Code** — carried through to the pages, not used in the arithmetic.
  This is the column that lets AutoCount keep the prices up to date later.

Cost per unit is `Pack Cost ÷ Units Per Pack`, and a line costs that times the
quantity in the recipe. Water and ice want `0` and `1` so they read as free
rather than as pending. Anything left blank stays *pending* — the system never
guesses.

Keep UOM or any other column you like in E onward; nothing reads past D.

Seed column A with every ingredient in use:

```
=SORT(UNIQUE(FILTER('R&D Log'!D2:D, 'R&D Log'!D2:D<>"")))
```

Then **Copy → Paste special → Values only** over itself so you can type prices beside
fixed rows.

### 3. Nothing to point at

`prices_()` finds the tab by its name, so there is no ID to copy and nothing to
redeploy. Name it `Prices`, fill it in, reload.

What changes the moment it exists — all four pages, with nothing to deploy:

- **R&D Intake** prices every line as it is typed and stamps a cost per serving
  onto the submission.
- **Approvals** shows that cost per serving on the card being approved, with the
  gross margin beside it.
- **Recipe Finder** fills in *Cost / cup* and *Gross margin*, for a signed-in
  name.
- **Dashboard** counts what is costed and what is not, opens both, and lists the
  ingredients holding the most recipes up.

A row typed into `Prices` shows up on the next page load. A row typed wrong shows
up as **check units** rather than as a plausible-looking wrong number.

### Putting this change on the live site

`Web.gs` changed, so it needs a redeploy. Three of the four pages changed, so they need
replacing in the **Recipe app** Drive folder — but pages are read from Drive at request
time, so those take effect immediately with no deployment.

1. **`Web.gs` — do not paste the whole file.** Every secret in this project sits above the
   line `var GID = { log: …`, and nothing below it is sensitive. So in the editor:

   > Keep your existing `Web.gs` down to and including the `var APP_FOLDER = …` line.
   > Select from `var GID = { log: …` to the end of the file, delete it, and paste
   > everything from that same line to the end of this repository's `apps-script/Web.gs`.

   Done that way the salt, the signing key, the folder id and the three password hashes are
   never touched, never retyped and never seen — which is the only way to be sure they are
   still right. `secrets.local.md` stays shut.

2. `apps-script/Autocount.gs` is a **new** script file — **+ → Script**, name it `Autocount`,
   paste it whole. It has no placeholders. Its two settings go in Project Settings →
   Script Properties (see *AutoCount — where the prices come from*). Google will ask you to
   re-authorise, because reading the snapshot needs the external-request scope.

3. `apps-script/Fixer.gs` over the existing one — that is where the new menu item lives.
   It has no secrets, so paste it whole.
4. Upload `pages/index.html`, `pages/approve.html` and `pages/dashboard.html` to the
   **Recipe app** folder, replacing what is there. `intake.html` is unchanged.
5. **Run `preflight`** in the editor. It must say **READY to deploy** — see below.
6. **Deploy → Manage deployments → pencil → Version *New version* → Deploy.** Same URL.
   Type the description back in; it shows the old value as grey placeholder text, not as
   a value, and leaving it alone renames the deployment to *Untitled*.
7. Open the site and put one throwaway recipe through **intake → approvals**. That is the
   one path this repository has never been able to prove, because `submit_()` and
   `approve_()` write to the sheet.

### Run `preflight` before you deploy, not after

The risky part of this is not the code, it is the paste. `Web.gs` ships with seven
`PASTE-…` placeholders where the salt, the signing key, the Drive folder id and the three
password hashes belong, because this repository is public. **Deploying with any of them
still in place does not fail politely:** a missing folder id throws on every page load, and
a changed salt or signing key signs everybody out at once.

So after the files are in place and before you deploy, in the Apps Script editor choose
**preflight** and press **Run**. It writes nothing and deploys nothing. It reads:

```
SECRETS
  ok    AUTH_SALT is set.
  ok    AUTH_SECRET is set.
  ok    APP_FOLDER is set.
ACCOUNTS
  ok    manager (manager) has a real hash.
  ok    sakura (bi) has a real hash.
  ok    robin (bi) has a real hash.
THE SPREADSHEET
  ok    R&D Log found.  RECIPE VERSIONS found.  R&D TRIAL LOG found.
THE PAGES
  ok    index.html      24635 bytes  f53075f00416da94071564962a6d61dd
  ok    intake.html     38921 bytes  5f34b85b984dcda91a799e7274bf741c
  ok    approve.html    14426 bytes  dc9983fccd7b7a5a4d45e1d51aa3376b
  ok    dashboard.html  27853 bytes  e58dca36074ed1df0e94d52e0e98f3fa
COSTING
  note  There is no Prices tab yet …

READY to deploy
```

Anything it prints as `WRONG` is a thing that will break the live site. It ends with
**READY to deploy** or **NOT READY**, and it also catches a hash that is not a SHA-256, a
project with no manager, and the salt and the signing key having been set to the same
value. `checkPages` still exists and is included in the run.

**Having no `Prices` tab is a note, not a fault** — that is the state the sheet is in today,
and every recipe correctly reads *Needs costing* until the tab exists.

Costing itself needs no new permission — `prices_()` reads a tab in the spreadsheet the
project already has. Only `Autocount.gs` widens anything, by one scope, and only because it
reads the snapshot over HTTPS.

**To undo:** *Deploy → Manage deployments* rolls back to the previous version, and the four
page files are in git. The sheet itself is untouched by this change: nothing here writes a
recipe row.

---

## AutoCount — where the prices come from

`Autocount.gs` fills the `Prices` tab, so the job stops being "type 472 rows" and
becomes "choose from a shortlist". **R&D Tools → Update prices from AutoCount.**

### It is not a second connector

There is exactly one path out of AutoCount and this is not another one. A
SELECT-only login on the office Windows PC pushes a snapshot to the central sync
server; every consumer reads that snapshot. This is one more consumer, the same
as the Procurement System. Nothing here touches SQL Server and nothing in this
project writes to AutoCount.

It asks for `datasets=items,supplierPrices&cost=include`. That server withholds
cost unless it is asked for, deliberately — so forgetting the parameter
under-shares rather than over-shares.

Two settings, once, in **Extensions → Apps Script → Project Settings → Script
Properties**. They are not in this file because this repository is public:

```
GC_SYNC_URL     https://…/api/v1/procurement/latest
GC_SYNC_TOKEN   the dashboard read token
```

Adding this file widens the project's OAuth scopes by one — external requests —
so Google asks you to authorise the script again the first time. Nothing the web
app serves can reach it: the menu is the only way in, and only somebody who can
already open the spreadsheet sees the menu.

### Why it does not match names automatically

It was built to, and then measured against the real catalogue, where the idea
failed honestly. Of 2,701 items, 1,464 are active and priced. Against those:

| Ingredient as R&D types it | Items containing every word |
|---|---|
| `Milk` | 56 |
| `Ice` | 40 |
| `Brown Sugar` | 20 |
| `Sugar Syrup` | 18 |
| `Oolong Tea` | 15 |
| `Matcha Powder` | 10 |

Those ten matcha items run from **RM0.038 to RM0.305 per gram** — a RM27 tub of
premium powder and a RM71 frappé base among them. Nothing in the text says which
one R&D meant. A scorer would have picked one and been wrong about as often as
right, which is the single outcome this system exists not to produce.

So it does the half a machine can do:

1. **Run it.** Every ingredient gets a shortlist of real items — code, purchase
   price, pack size read off the item's own name, and the cost per ML or per
   gram already worked out.
2. **Put the right code in column D.** That is the only judgement in the whole
   job, and only somebody who knows the drink can make it.
3. **Run it again.** Every row carrying a code is priced exactly from that code,
   and stays priced on every run after — so a supplier price rise reaches the
   Recipe Finder by itself.

It fills a row in unasked only when exactly one item in the catalogue contains
every word of the name, its pack size is on that name, and the pack's unit is the
unit the recipe measures in. That is rare, and meant to be.

### The pack size is in the item's name, nowhere else

AutoCount buys in PKT, BTL and TIN and records no contents, so
`LAVAZZA GRAN ESPRESSO COFFEE BEAN 1KG` is the only place the sheet can learn
that one packet is 1,000 grams. It is read from there: `1KG` → 1000 G, `0.7L` →
700 ML, `375G (7.5G*50PCS)` → 375 G. Around 56% of priced items say their size
this way; the rest need a person to type it.

**Grams never price millilitres.** That conversion is a density and depends on
what the ingredient is, so a 700 G tub of cheese foam will not price a line
poured in ML. The row says so rather than converting.

### What it will not do

- **It never overwrites you.** Put anything but `AUTOCOUNT` in the Source column
  and that row is never touched again — price, pack size and all.
- **It never drops your work.** An ingredient no recipe uses any more keeps its
  row at the bottom, with a note saying why, rather than vanishing on a rerun.
- **It writes nothing when it cannot read.** Missing settings, a refused token
  or a snapshot without prices all stop before the tab is touched, and say
  *Nothing was changed.*
- **It fills no price on a guess.** Every column I entry is a real reason: too
  many candidates, no pack size on the name, a unit that cannot be converted, or
  nothing in AutoCount resembling it at all.

Columns A–D are the contract `prices_()` reads by position. Everything from E is
the working: recipe UOM, source, matched item, pack size read as, why not filled,
the candidates, and when it last ran.

---

## Other things worth cleaning in the sheet

**The `FEED` tab — do not delete it.** An earlier version of this file said `FEED` was a
stale duplicate and safe to delete. **That was wrong.** The live site's exporter read it as
`FEED_APPROVED` (`gid=2094180899`) to build the Recipe Finder, so deleting it would have
taken the finder down. The exporter has since been repointed at the R&D Log — the only tab
carrying both version and status — but leave `FEED` alone unless you have checked nothing
reads it.

**Test data is live.** `RCP-0380` — remarks *"CONNECTOR TEST - safe to delete."* — sits in
`RECIPE VERSIONS`, the change log and the trial log. It has no submission in the queue, so
it can never be approved. Delete those rows and the pending count drops to zero.

`RCP-0384 V1.0` still reads **PENDING REVIEW** in `RECIPE VERSIONS`, behind `V3.0` which is
approved. The R&D Log already calls it *Superseded*; only the register disagrees. **R&D
Tools → Fix the sheet now** clears it — that run is what the menu exists for.

**Four rows have text in VOLUME USAGE**, a number column:

| Recipe | Ingredient | Value in the quantity column |
|---|---|---|
| RCP-0025 | Kopi Base | `follow powder x 1` |
| RCP-0026 / RCP-0176 | Condensed Milk | `Gold Coin` (a brand — belongs in the name) |
| RCP-0377 | LIME | `HALF` |

The old exporter silently dropped these so the site showed a blank quantity. The pages now
keep the text so you can see and fix them. `HALF` a lime probably wants to be `0.5` with
UOM `PC`.

**199 recipes have no status at all** — never assessed. That is a review backlog rather
than a bug, but it is the largest number on the dashboard.
