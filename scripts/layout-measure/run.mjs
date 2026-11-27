#!/usr/bin/env node
// Layout measurements in a real browser (FIX-1 FX0; UX-3's P8, shape (b)).
//
//   node scripts/layout-measure/run.mjs --origin <url> [--only <check>[,<check>…]] [--plant <check>] [--out <dir>]
//
// Drives the system Chrome (`/Applications/Google Chrome.app`, macOS) headless over its debugging pipe against a
// running build of this site at `--origin`, reaches six page states, and prints each check's measured values with
// PASS or FAIL:
//   1  the Publish dialog's button inside the viewport, at 390x844, 1280x720 and 1440x900;
//   2  `ui-chip-row` does not wrap at 390 ("wrapped": its height falls under a forced `flex-wrap: nowrap`);
//   3  the `role="tablist"` row does not overflow at 390, and the page's `scrollWidth` is at most 390;
//   4  the docked composer hides no answer line: scrolled to the end, the answer's last line ends at or above the
//      docked bar's top;
//   5  #802, as seat ruling 7042757712 (website #807) amended it, at 390 and 1280 on the notebook path, after a
//      paused run's Allow pressed at the prompt:
//        the pin   the reader does not scroll: the answer arrives in view and `scrollY` does not change;
//        red 1     the reader wheels until the steps' consent card's top is at the header's bottom: the answer's top
//                  is between the header's bottom and the viewport's bottom when it arrives;
//        red 2     the same, after a scroll to the page's end.
//      Recorded only: the same three on the chat path, the no-pause run unscrolled (d) and with the same scrolls
//      (f), the live regions at the arrival (e), and each run's timeline (a);
//   6  #786 item 3: after the picker panel is open, the Settings overlay opens over it, a refresh closes the panel
//      and the overlay closes, the focused element's box is inside the viewport at 390 (reported at 1280 too);
//   7  OF3b (website #810): a "Map" answer's map part (plot, count line, table reached by Tab, save action), its
//      alternative text and a name with markup shown as text, no map part under envelope-order, and every host the
//      "Map" answer made the page contact is one the "Auto" answer did (criteria 8, 9 and 12; needs a build served
//      with SITE_OUTPUT_FORMAT=on);
//   8  OF3b: "Map" in /ask's menu, Compare off with its reason and back with its value on "Auto", "Map" off in
//      Sandbox with its reason and back in Standard (needs LAYOUT_MEASURE_SESSION_COOKIE for a local build).
// `--plant 7` adds an image from another host to the map part, so check 7's host comparison must read FAIL.
// `--plant <1|2|3|4|5>` injects that check's planted defect into the page under test (5: a scroll at the arrival, for
// the pin); `--plant guard` switches off the page's answer for the run routes, so the run must read VOID. `--out
// <dir>` writes the full record (JSON) and a screenshot per measured state.
//
// HOW THE STATES ARE REACHED. The real app, unchanged: no fixture route, no setting, no model call, no dependency.
// An init script (`lib/page-init.mjs`) answers the page's own requests inside the page: the run routes with a stream
// fed from the tracked event files (`events/*.json`, built from the repository's test fixtures), the consent and
// routing reads, every consent write, the rate-limit read, and, where a check needs the signed-in form, the client
// session. A CDP `Fetch` guard (`lib/browser.mjs`) fails and records every request that would still reach a run
// route, a consent or decision write, a non-GET to `/api/auth/*`, a non-GET to `/api/records*`, or `/api/rate-limit`.
// Every run prints those lists; a run with any list not `[]` is VOID and exits non-zero.
//
// A PROTECTED PREVIEW. Its protection cookie is read from the environment variable LAYOUT_MEASURE_PROTECTION_COOKIE
// and set on the origin's host by CDP. This script never prints or writes it.
//
// THE STAND-INS. What is measured in place of what the reader meets:
//   - the notebook path is measured on the home page's `QuerySurface` in Sandbox mode (sessionStorage
//     `civicaitools.notebookMode`, with the client session answered in the page), since `/ask` needs a server session;
//   - a local build is served with `SERVE_MARKETING=1`, since an instance that configures no hosts serves the app
//     role only and the home page would redirect;
//   - the consent, routing and session reads are answered in the page.
//
// BLIND SPOTS. What a green here does not say:
//   - It cannot reach a page that the server renders for a session: `/ask` (which renders a sign-in panel signed
//     out) and `/dashboard`. `/ask` mounts the same `QuerySurface` with `presentation="answer-first"` around it,
//     which this script does not see.
//   - Chrome only, headless, at the emulated sizes; no WebKit, no Safari, no touch, no real scrollbar.
//   - The run is a stub: event files, not a model. A layout a real run reaches only through timing or content these
//     files do not carry is not measured.
//   - A green here is a claim about this Chrome and this build, nothing more.
//
// Exit: 0 every check PASS and the run valid; 1 a check FAIL or ERROR; 3 the run VOID; 2 a usage error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_PATH, emptyGuard, openSession } from './lib/browser.mjs';
import { initScript } from './lib/page-init.mjs';
import { CHECKS } from './lib/checks.mjs';
import { PLANT_NAMES } from './lib/plants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function usage(message) {
  console.error(`${message}\nusage: node scripts/layout-measure/run.mjs --origin <url> [--only <check>[,<check>]] [--plant <1|2|3|4|5|guard>] [--out <dir>]`);
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const origin = opt('--origin');
if (!origin) usage('--origin is required');
let originUrl;
try { originUrl = new URL(origin); } catch { usage(`not a URL: ${origin}`); }
const only = opt('--only') ? opt('--only').split(',') : Object.keys(CHECKS);
for (const id of only) if (!CHECKS[id]) usage(`no check ${id}`);
const plant = opt('--plant') ?? null;
if (plant !== null && !PLANT_NAMES.includes(plant)) usage(`no plant ${plant}`);
const out = opt('--out') ? path.resolve(opt('--out')) : null;
if (out) fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(CHROME_PATH)) usage(`no Chrome at ${CHROME_PATH}`);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const events = {
  notebookPaused: readJson(path.join(HERE, 'events', 'notebook-paused.json')),
  notebookPlain: readJson(path.join(HERE, 'events', 'notebook-plain.json')),
  chatPaused: readJson(path.join(HERE, 'events', 'chat-paused.json')),
  chatPlain: readJson(path.join(HERE, 'events', 'chat-plain.json')),
  // OF3b: the plain map's run, from the real route's stream (`events/chat-map.json`).
  chatMap: readJson(path.join(HERE, 'events', 'chat-map.json')),
};
const FLOWS_FIXTURE = 'src/lib/flows/fixtures/flows-statement-78c516db.json';
const flowsFixture = fs.readFileSync(path.join(REPO, FLOWS_FIXTURE), 'utf8');
const protectionCookie = originUrl.protocol === 'https:' ? process.env.LAYOUT_MEASURE_PROTECTION_COOKIE || null : null;
// OF3b (check 8): a local build's session cookie, minted for that build's own throwaway secret; never printed.
const sessionCookie = originUrl.protocol === 'http:' ? process.env.LAYOUT_MEASURE_SESSION_COOKIE || null : null;

const guard = emptyGuard();
const inPage = [];
const sessionNotes = [];
let chromeVersion = null;

/** Opens a session whose page answers as `cfg` says; its close records what the page answered. */
async function open(label, cfg) {
  const full = { flows: 'pass', answerRuns: plant !== 'guard', flowsFixture, ...cfg };
  const c = await openSession({ label, origin, guard, initScript: initScript(full), protectionCookie, sessionCookie });
  if (chromeVersion === null) chromeVersion = (await c.send('Browser.getVersion')).product;
  const close = c.close;
  c.close = async () => {
    try {
      inPage.push({ session: label, ...(await c.ev(`(() => { const S = window.__lm; return S ? { streams: S.streams, consentWrites: S.consentWrites, authWrites: S.authWrites, recordWrites: S.recordWrites, rateLimitAnswered: S.answered.rateLimit, statement: S.statementSource, reads: S.reads } : null; })()`)) });
    } catch { /* the page is gone */ }
    sessionNotes.push({ session: label, exceptions: c.notes.exceptions, consoleErrors: c.notes.consoleErrors });
    await close();
  };
  return c;
}

const ctx = {
  origin: originUrl.origin, plant, events, open, sessionCookie,
  shots: out ? (name) => path.join(out, `${name}${plant ? `-plant-${plant}` : ''}.png`) : null,
};

console.log(`layout-measure  origin ${originUrl.origin}  plant ${plant ?? 'none'}  checks ${only.join(',')}  started ${new Date().toISOString()}`);
const results = [];
for (const id of only) {
  let r;
  try {
    r = await CHECKS[id](ctx);
  } catch (e) {
    r = { id, title: `check ${id}`, sizes: '', pass: null, lines: [`ERROR: ${String(e?.message ?? e).split('\n')[0]}`], data: { error: String(e?.stack ?? e) } };
  }
  results.push(r);
  console.log(`\nCHECK ${r.id}  ${r.title}`);
  if (r.sizes) console.log(`  sizes: ${r.sizes}`);
  for (const line of r.lines) console.log(`  ${line}`);
  console.log(`  RESULT: ${r.pass === null ? 'ERROR' : r.pass ? 'PASS' : 'FAIL'}`);
}

const voidRun = Object.values(guard).some((list) => list.length > 0);
console.log(`\nchrome ${chromeVersion}`);
console.log('GUARD (requests that reached the network and were failed; each list must read []):');
for (const [k, list] of Object.entries(guard)) console.log(`  ${k}: ${JSON.stringify(list)}`);
const answered = inPage.filter((x) => x.streams?.length || x.consentWrites?.length || x.authWrites?.length || x.recordWrites?.length || x.rateLimitAnswered);
console.log('ANSWERED IN THE PAGE (never sent):');
for (const x of answered) console.log(`  ${x.session}: runs ${JSON.stringify(x.streams.map((s) => s.path))}  consent writes ${JSON.stringify(x.consentWrites.map((w) => `${w.method} ${w.path}${w.decision ? ` ${w.decision}` : ''}`))}  auth writes ${x.authWrites.length}  record writes ${x.recordWrites.length}  rate-limit reads ${x.rateLimitAnswered}  statement ${x.statement}`);
const summary = results.map((r) => `${r.id} ${r.pass === null ? 'ERROR' : r.pass ? 'PASS' : 'FAIL'}`).join(', ');
console.log(`\nRUN: ${voidRun ? 'VOID' : 'VALID'}  checks: ${summary}`);
if (out) {
  fs.writeFileSync(path.join(out, `record${plant ? `-plant-${plant}` : ''}-${only.join('_')}.json`), JSON.stringify({ origin: originUrl.origin, plant, only, chrome: chromeVersion, results, guard, inPage, sessionNotes, voidRun }, null, 2));
}
process.exit(voidRun ? 3 : results.every((r) => r.pass === true) ? 0 : 1);
