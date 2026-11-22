// The six checks. Each returns `{ id, title, sizes, pass, lines, data }`: `lines` are printed as they are, `data`
// goes to the JSON record when `--out` is given. A check that throws is reported as ERROR with its message.
import { ANSWER, LIB, LIVE, Q, SNAP, SURFACE_READY, ask, feed, openMenuGroup } from './reads.mjs';
import { PLANTS } from './plants.mjs';
import { sleep } from './browser.mjs';

export const SIZES = { phone: [390, 844], laptop: [1280, 720], desktop: [1440, 900] };
const ALL_SIZES = [SIZES.phone, SIZES.laptop, SIZES.desktop];
const QUESTION = 'How many service requests were recorded in the fixture year?';

const box = (b) => (b ? `top ${b.top} bottom ${b.bottom} left ${b.left} right ${b.right}` : 'absent');
const verdict = (ok) => (ok ? 'PASS' : 'FAIL');
const answerOf = (file) => file.answer.join('\n');

/** A session on `path` at `w`×`h`, the page answering as `cfg` says. Returns the open session. */
async function load(ctx, label, [w, h], path, cfg, ready = SURFACE_READY) {
  const c = await ctx.open(label, cfg);
  await c.size(w, h);
  await c.go(`${ctx.origin}${path}`, ready, `${path} at ${w}x${h}`);
  return c;
}

/** The finished run of `file` on the home page's surface; returns the run route the page called. */
async function finishedRun(c, file, hooks) {
  await ask(c, QUESTION);
  const route = await c.ev('window.__lm.streams[0].path');
  await feed(c, file, hooks);
  return route;
}

async function closeAll(c) { if (c) await c.close(); }

// --- 1. The Publish dialog's button --------------------------------------------------------------------------------

export async function check1(ctx) {
  const lines = []; const data = []; let pass = true;
  for (const [w, h] of ALL_SIZES) {
    let c;
    try {
      c = await load(ctx, `1@${w}`, [w, h], '/', { signedIn: true, mode: 'notebook', answer: answerOf(ctx.events.notebookPlain) });
      const route = await finishedRun(c, ctx.events.notebookPlain);
      const publish = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Publish')`;
      await c.until(`Boolean(${publish})`, 10000, 'the Publish button on the finished run');
      await c.click(publish, 'Publish');
      await c.until(`Boolean(${Q.dialog})`, 10000, 'the Publish dialog');
      await c.ev('document.fonts.ready.then(() => true)');
      await sleep(600);
      await c.settle();
      if (ctx.plant === '1') await c.ev(PLANTS['1']);
      await c.frames();
      const r = await c.ev(`(() => {${LIB} const b = document.querySelector('[role="dialog"] .ui-dialog-footer .ui-action--primary'); return { button: R(b), label: T(b), vw: innerWidth, vh: innerHeight, dialog: R(document.querySelector('[role="dialog"]')) }; })()`);
      const ok = !!r.button && r.button.top >= -0.5 && r.button.bottom <= r.vh + 0.5 && r.button.left >= -0.5 && r.button.right <= r.vw + 0.5;
      pass = pass && ok;
      lines.push(`${w}x${h}  route ${route}  button "${r.label}" ${box(r.button)}  viewport ${r.vw}x${r.vh}  ${verdict(ok)}`);
      data.push({ size: [w, h], route, ...r, pass: ok });
      if (ctx.shots) await c.shot(ctx.shots(`check1-${w}`));
    } finally { await closeAll(c); }
  }
  return { id: '1', title: "The Publish dialog's button is inside the viewport", sizes: '390x844, 1280x720, 1440x900 (the notebook path, a finished run with no pause, the fixture session)', pass, lines, data };
}

// --- 2. The chip row does not wrap at 390 --------------------------------------------------------------------------

export async function check2(ctx) {
  const lines = []; const data = []; let pass = true; let measured = 0;
  const mounts = [
    { label: '/ signed out', path: '/', cfg: {} },
    { label: '/ with the fixture session', path: '/', cfg: { signedIn: true } },
  ];
  for (const m of mounts) {
    let c;
    try {
      c = await load(ctx, `2 ${m.label}`, SIZES.phone, m.path, m.cfg, `Boolean(document.querySelector('.ui-chip-row'))`);
      await c.settle();
      if (ctx.plant === '2') await c.ev(PLANTS['2']);
      await c.frames();
      const r = await c.ev(`(() => {${LIB}
        const rows = [...document.querySelectorAll('.ui-chip-row')];
        const before = rows.map((el) => el.getBoundingClientRect().height);
        const st = document.createElement('style'); st.textContent = 'html body .ui-chip-row { flex-wrap: nowrap !important; }'; document.head.append(st);
        const after = rows.map((el) => el.getBoundingClientRect().height);
        st.remove();
        return rows.map((el, i) => ({ chips: el.children.length, height: f1(before[i]), heightNowrap: f1(after[i]), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, flexWrap: getComputedStyle(el).flexWrap }));
      })()`);
      for (const row of r) {
        const wrapped = row.height - row.heightNowrap > 1;
        pass = pass && !wrapped; measured += 1;
        lines.push(`390x844  ${m.label}  chips ${row.chips}  height ${row.height}  under forced nowrap ${row.heightNowrap}  flex-wrap ${row.flexWrap}  scrollWidth ${row.scrollWidth} clientWidth ${row.clientWidth}  ${wrapped ? 'wrapped' : 'one line'}  ${verdict(!wrapped)}`);
      }
      data.push({ mount: m.label, rows: r });
    } finally { await closeAll(c); }
  }
  if (measured === 0) { pass = false; lines.push('no chip row was measured'); }
  lines.push('not reachable signed out: /ask (server-rendered for a session; its composer carries the same chip row)');
  return { id: '2', title: '`ui-chip-row` does not wrap at 390', sizes: '390x844 only', pass, lines, data };
}

// --- 3. The tab row does not overflow at 390 -----------------------------------------------------------------------

export async function check3(ctx) {
  const lines = []; const data = []; let pass = true; let measured = 0;
  const mounts = ['/settings', '/directory', '/explore'];
  for (const path of mounts) {
    let c;
    try {
      c = await load(ctx, `3 ${path}`, SIZES.phone, path, {}, `document.readyState === 'complete'`);
      try { await c.until(`document.querySelectorAll('[role="tablist"]').length > 0`, 15000, 'a tab row'); } catch { /* reported below */ }
      await c.settle();
      if (ctx.plant === '3') await c.ev(PLANTS['3']);
      await c.frames();
      const r = await c.ev(`(() => {${LIB}
        return { page: { scrollWidth: document.documentElement.scrollWidth, innerWidth },
          tablists: [...document.querySelectorAll('[role="tablist"]')].map((el) => ({ label: el.getAttribute('aria-label'), tabs: el.querySelectorAll('[role="tab"]').length, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, rect: R(el) })) };
      })()`);
      if (r.tablists.length === 0) lines.push(`390x844  ${path}  no role="tablist" rendered`);
      for (const t of r.tablists) {
        const shown = t.rect && t.rect.width > 0;
        const ok = !shown || (t.scrollWidth <= t.clientWidth && t.rect.right <= r.page.innerWidth + 0.5 && t.rect.left >= -0.5);
        if (shown) measured += 1;
        pass = pass && ok;
        lines.push(`390x844  ${path}  tablist "${t.label}" (${t.tabs} tabs)  scrollWidth ${t.scrollWidth} clientWidth ${t.clientWidth}  left ${t.rect?.left} right ${t.rect?.right}${shown ? '' : '  (not shown)'}  ${verdict(ok)}`);
      }
      const pageOk = r.page.scrollWidth <= 390;
      pass = pass && pageOk;
      lines.push(`390x844  ${path}  page scrollWidth ${r.page.scrollWidth}  ${verdict(pageOk)}`);
      data.push({ path, ...r });
    } finally { await closeAll(c); }
  }
  if (measured === 0) { pass = false; lines.push('no shown tab row was measured'); }
  lines.push('not reachable signed out: /dashboard (its tab row needs a server session)');
  return { id: '3', title: 'The role="tablist" row does not overflow at 390', sizes: '390x844 only', pass, lines, data };
}

// --- 4. The docked composer hides no answer line -------------------------------------------------------------------

/** The last line box of the text under `root` (a page expression): the last client rect of its last shown text node. */
const LAST_LINE = (root) => `(() => {${LIB}
  const a = ${root};
  if (!a) return null;
  const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT); let n, last = null, rects = [];
  while ((n = w.nextNode())) {
    if (n.nodeValue.trim() === '') continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rs = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (rs.length) { last = n; rects = rs; }
  }
  if (!last) return null;
  const r = rects[rects.length - 1];
  return { top: f1(r.top), bottom: f1(r.bottom), left: f1(r.left), right: f1(r.right), text: last.nodeValue.trim().slice(-40) };
})()`;

/**
 * "Scrolled to the end": the scroll at which the docked bar rests in its own place below the run's results, its
 * bottom at the viewport's bottom (or the page's end, if that comes first). From there on the bar scrolls with the
 * page, so the room between the answer's last line and the bar's top is as large as any scroll can make it: if the bar
 * covers the line here, no scroll uncovers it. (On the home page the marketing sections follow the results, so the
 * page's own end is far below the bar's rest.)
 */
const TO_REST = `(() => {
  const bar = ${Q.bar};
  if (!bar) return null;
  const prior = bar.style.position;
  bar.style.position = 'static';
  const rest = bar.getBoundingClientRect().bottom + scrollY;
  bar.style.position = prior;
  const top = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, rest - innerHeight));
  window.scrollTo({ top, behavior: 'instant' });
  return Math.round(top);
})()`;

export async function check4(ctx) {
  const lines = []; const data = []; let pass = true;
  for (const [path, file] of [['notebook', ctx.events.notebookPlain], ['chat', ctx.events.chatPlain]]) {
    for (const [w, h] of ALL_SIZES) {
      let c;
      try {
        c = await load(ctx, `4 ${path}@${w}`, [w, h], '/', { signedIn: true, mode: path === 'notebook' ? 'notebook' : 'standard', answer: answerOf(file) });
        const route = await finishedRun(c, file);
        const rest = await c.ev(TO_REST);
        await c.settle();
        if (ctx.plant === '4') await c.ev(PLANTS['4'](file.answerMarker));
        await c.frames();
        const line = await c.ev(LAST_LINE(ANSWER(file.answerMarker)));
        const resultsLine = await c.ev(LAST_LINE(`[...document.querySelectorAll('.query-results')].pop()`));
        const r = await c.ev(`(() => {${LIB} return { scrollY: f1(scrollY), maxScroll: document.documentElement.scrollHeight - innerHeight, vh: innerHeight, bar: R(${Q.bar}) }; })()`);
        const ok = !!line && !!r.bar && line.bottom <= r.bar.top + 0.5;
        pass = pass && ok;
        const inView = !!line && line.bottom > 0 && line.top < r.vh;
        lines.push(`${w}x${h}  ${path} path (route ${route})  scrollY ${r.scrollY} (bar's rest ${rest}, max ${r.maxScroll})  docked bar top ${r.bar ? r.bar.top : 'absent'}  last answer line ${line ? `${line.top}..${line.bottom} ("…${line.text}")` : 'absent'}${inView ? '' : ' (outside the viewport)'}  ${verdict(ok)}`);
        lines.push(`      reported: the results' last line ${resultsLine ? `${resultsLine.top}..${resultsLine.bottom} ("…${resultsLine.text}")` : 'absent'}`);
        data.push({ path, size: [w, h], route, rest, line, resultsLine, ...r, lastLineInViewport: inView, pass: ok });
        if (ctx.shots) await c.shot(ctx.shots(`check4-${path}-${w}`));
      } finally { await closeAll(c); }
    }
  }
  return { id: '4', title: 'The docked composer hides no answer line (scrolled to the end)', sizes: '390x844, 1280x720, 1440x900; the notebook and chat paths, a finished run with no pause, the fixture session', pass, lines, data };
}

// --- 5. #802: the answer's top in view when a paused run's answer arrives ------------------------------------------
//
// Seat ruling 7042757712 (amendment 1): the reader who does not scroll is a pin; the reds are a reader who has
// scrolled. Every scroll here is made just before the arrival event is pushed, after Allow and after the events that
// follow it, so the view at the arrival is the one the variant names:
//   'none'  the pin: no scroll; the answer arrives in view and `scrollY` does not change at the arrival;
//   'card'  red 1 (W9's state): mouse-wheel scrolls until the steps' consent card's top is at the header's bottom;
//   'end'   red 2 (variant (c)): the page scrolled to its end;
//   'y'     variant (f) on a run with no pause (no card): the wheel to the `scrollY` red 1 reached on that path and size.

const CARD = `document.querySelector('[data-part="consent-step"][data-consent-place="steps"]')`;

/** The reader's scroll for `variant`; returns what it aimed at and where it landed. */
async function readerScroll(c, variant, targetY) {
  const before = await c.ev('scrollY');
  if (variant === 'end') {
    await c.ev(`window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`);
    await c.settle();
    return { variant, before, target: await c.ev('document.documentElement.scrollHeight - innerHeight'), after: await c.ev('scrollY') };
  }
  let card = null;
  let target;
  if (variant === 'card') {
    const r = await c.ev(`(() => {${LIB} const card = ${CARD}; const header = document.querySelector('header'); return { card: R(card), headerBottom: header ? f1(header.getBoundingClientRect().bottom) : 0 }; })()`);
    if (!r.card) throw new Error("no consent card in the run's steps to scroll to");
    card = r.card;
    target = before + r.card.top - r.headerBottom;
  } else {
    target = targetY;
  }
  for (let i = 0; i < 3; i += 1) {
    const now = await c.ev('scrollY');
    if (Math.abs(now - target) <= 2) break;
    await c.wheel(target - now);
    await c.settle();
  }
  return { variant, before, cardBefore: card, target: Math.round(target * 10) / 10, after: await c.ev('scrollY') };
}

/** Plant 5: a scroll injected at the arrival (the answer's first render moves the page), so the pin must read FAIL. */
const PLANT_5 = `(() => {
  const o = new MutationObserver(() => {
    if (document.querySelector('[data-part="answer"]')) { o.disconnect(); window.scrollBy({ top: 240, behavior: 'instant' }); }
  });
  o.observe(document.body, { childList: true, subtree: true });
  return true;
})()`;

/**
 * One run of `file` at `size` (a paused file is answered Allow at the prompt), with its timeline and the reader's
 * scroll `variant` made just before the arrival.
 */
async function run5(ctx, label, size, file, variant, targetY) {
  let c;
  const timeline = [];
  try {
    c = await load(ctx, label, size, '/', { signedIn: true, mode: file.route === '/api/query-notebook' ? 'notebook' : 'standard', answer: answerOf(file) });
    const snap = async (at, extra = {}) => { const row = { at, ...(await c.ev(SNAP(file.answerMarker))), ...extra }; timeline.push(row); return row; };
    await snap('loaded');
    await ask(c, QUESTION);
    await c.settle();
    await snap('sent');
    const route = await c.ev('window.__lm.streams[0].path');
    let arrival = null; let first = null; let live = null; let scroll = null; let beforeArrival = null;
    await feed(c, file, {
      onReader: async (action) => {
        if (action !== 'allow') throw new Error(`unknown reader action ${action}`);
        await c.until(`Boolean(${Q.promptButton('Allow')})`, 5000, 'the prompt\'s Allow');
        const scrolled = await c.click(Q.promptButton('Allow'), 'Allow at the prompt');
        await c.frames();
        await snap('click', { scrolledToReachAllow: scrolled });
        await c.until(`!${Q.prompt}`, 10000, 'the prompt to unmount after Allow');
        await c.settle();
        await snap('prompt unmounted');
      },
      beforeArrival: async () => {
        if (variant !== 'none') {
          scroll = await readerScroll(c, variant, targetY);
          await snap(`reader scrolled (${variant})`);
        }
        if (ctx.plant === '5') await c.ev(PLANT_5);
        beforeArrival = await c.ev('scrollY');
      },
      onEvent: async (event, { arrival: isArrival }) => {
        const name = event.type === 'phase' ? `phase ${event.name}` : event.phase ? `${event.type} ${event.phase}` : event.panel ? `${event.type} ${event.panel}` : event.type;
        if (isArrival) {
          await c.frames();
          first = await snap(`arrival (${name}), first frame`);
          await c.settle();
          arrival = await snap(`arrival (${name}), settled`);
          live = await c.ev(LIVE);
        } else {
          await c.settle();
          await snap(event.phase === 'consent_pause' ? `pause (${name})` : name);
        }
      },
    });
    if (ctx.shots) await c.shot(ctx.shots(`check5-${label.replace(/[^a-z0-9]+/gi, '-')}`));
    return { route, variant, scroll, beforeArrival, first, arrival, timeline, live, consentWrites: await c.ev('window.__lm.consentWrites') };
  } finally { await closeAll(c); }
}

const inView = (row) => !!row && !!row.answer && row.answer.top >= (row.header ? row.header.bottom : 0) - 0.5 && row.answer.top < row.vh;
const rowLine = (r) => `${r.at}: scrollY ${r.scrollY}  prompt ${r.prompt ? `${r.prompt.top}..${r.prompt.bottom}` : '-'}  card ${r.card ? `${r.card.top}..${r.card.bottom}` : '-'}  answer ${r.answer ? `${r.answer.top}..${r.answer.bottom}` : '-'}  focus ${r.active.body ? 'body' : `${r.active.tag}${r.active.text ? ` "${r.active.text}"` : ''}${r.active.rect ? ` @${r.active.rect.top}` : ''}`}`;
const scrollLine = (s) => (s ? `scroll target ${s.target}${s.cardBefore ? ` (card before the scroll ${s.cardBefore.top}..${s.cardBefore.bottom})` : ''}  scrollY before ${s.before} after ${s.after}` : 'no scroll');
// FIX-1 FX2b: the topmost author line's top against the header's bottom, recorded only (no verdict reads it).
const authorLine = (row) => (row?.author
  ? `author line (${row.authorLines}) top ${row.author.top} ${row.author.top >= (row.header ? row.header.bottom : 0) - 0.5 ? 'at or below' : 'ABOVE'} the header's bottom`
  : 'no author line');
const arrivalLine = (r) => `at the arrival: scrollY ${r.arrival?.scrollY} (just before ${r.beforeArrival})  answer ${r.arrival?.answer ? `${r.arrival.answer.top}..${r.arrival.answer.bottom}` : 'absent'}  ${authorLine(r.arrival)}  header bottom ${r.arrival?.header?.bottom}  viewport bottom ${r.arrival?.vh}`;

export async function check5(ctx) {
  const lines = []; const data = { runs: {} }; let pass = true;
  const P = ctx.events.notebookPaused; const C = ctx.events.chatPaused;
  const NP = ctx.events.notebookPlain; const CP = ctx.events.chatPlain;
  const judged = [];
  for (const size of [SIZES.phone, SIZES.laptop]) {
    const [w, h] = size;
    const runs = data.runs[w] = {};
    runs.pinNotebook = await run5(ctx, `5 pin notebook@${w}`, size, P, 'none');
    runs.pinChat = await run5(ctx, `5 pin chat@${w}`, size, C, 'none');
    runs.red1Notebook = await run5(ctx, `5 red1 notebook@${w}`, size, P, 'card');
    runs.red1Chat = await run5(ctx, `5 red1 chat@${w}`, size, C, 'card');
    runs.red2Notebook = await run5(ctx, `5 red2 notebook@${w}`, size, P, 'end');
    runs.red2Chat = await run5(ctx, `5 red2 chat@${w}`, size, C, 'end');
    runs.dNotebook = await run5(ctx, `5 d notebook@${w}`, size, NP, 'none');
    runs.dChat = await run5(ctx, `5 d chat@${w}`, size, CP, 'none');
    runs.fCardNotebook = await run5(ctx, `5 f-card notebook@${w}`, size, NP, 'y', runs.red1Notebook.scroll.after);
    runs.fCardChat = await run5(ctx, `5 f-card chat@${w}`, size, CP, 'y', runs.red1Chat.scroll.after);
    runs.fEndNotebook = await run5(ctx, `5 f-end notebook@${w}`, size, NP, 'end');
    runs.fEndChat = await run5(ctx, `5 f-end chat@${w}`, size, CP, 'end');

    const pin = runs.pinNotebook;
    const pinOk = inView(pin.arrival) && Math.abs(pin.arrival.scrollY - pin.beforeArrival) <= 0.5;
    const r1 = runs.red1Notebook; const r1Ok = inView(r1.arrival);
    const r2 = runs.red2Notebook; const r2Ok = inView(r2.arrival);
    judged.push(pinOk, r1Ok, r2Ok);
    lines.push(`${w}x${h}  PIN (no scroll), notebook path (route ${pin.route})  ${arrivalLine(pin)}  in view ${inView(pin.arrival)}, scrollY change ${Math.round((pin.arrival.scrollY - pin.beforeArrival) * 10) / 10}  ${verdict(pinOk)}`);
    lines.push(`${w}x${h}  RED 1 (card's top to the header), notebook path  ${scrollLine(r1.scroll)}  ${arrivalLine(r1)}  ${verdict(r1Ok)}`);
    lines.push(`${w}x${h}  RED 2 (the page's end), notebook path  ${scrollLine(r2.scroll)}  ${arrivalLine(r2)}  ${verdict(r2Ok)}`);
  }
  pass = judged.every(Boolean);

  lines.push('Recorded, not PASS or FAIL:');
  for (const size of [SIZES.phone, SIZES.laptop]) {
    const [w] = size;
    const runs = data.runs[w];
    const rec = (tag, r) => `  ${tag} at ${w} (route ${r.route})  ${scrollLine(r.scroll)}  ${arrivalLine(r)}  in view ${inView(r.arrival)}  scrollY change at the arrival ${Math.round((r.arrival.scrollY - r.beforeArrival) * 10) / 10}`;
    lines.push(rec('the pin on the chat path', runs.pinChat));
    lines.push(rec('red 1 on the chat path', runs.red1Chat));
    lines.push(rec('red 2 on the chat path', runs.red2Chat));
    lines.push(rec('(d) no pause, no scroll, notebook path', runs.dNotebook));
    lines.push(rec('(d) no pause, no scroll, chat path', runs.dChat));
    lines.push(rec("(f) no pause, red 1's scroll (to its scrollY), notebook path", runs.fCardNotebook));
    lines.push(rec("(f) no pause, red 1's scroll (to its scrollY), chat path", runs.fCardChat));
    lines.push(rec('(f) no pause, the page\'s end, notebook path', runs.fEndNotebook));
    lines.push(rec('(f) no pause, the page\'s end, chat path', runs.fEndChat));
    lines.push(`  (e) live regions at the arrival, notebook pin at ${w}: ${JSON.stringify(runs.pinNotebook.live)}`);
    lines.push(`  (e) live regions at the arrival, chat pin at ${w}: ${JSON.stringify(runs.pinChat.live)}`);
    for (const [tag, r] of [['pin, notebook', runs.pinNotebook], ['red 1, notebook', runs.red1Notebook], ['red 1, chat', runs.red1Chat]]) {
      lines.push(`  (a) timeline, ${tag} at ${w}:`);
      for (const row of r.timeline) lines.push(`      ${rowLine(row)}`);
    }
  }
  return { id: '5', title: "#802 (amended by ruling 7042757712): the pin, and the answer's top in view at the arrival after the reader has scrolled", sizes: '390x844 and 1280x720; judged on the notebook path, the chat path recorded; the fixture session', pass, lines, data };
}

// --- 6. #786 item 3: focus in view after the Settings overlay closes ------------------------------------------------

async function focusAfterOverlay(ctx, size) {
  const [w, h] = size;
  let c;
  const steps = [];
  try {
    c = await load(ctx, `6@${w}`, size, '/', { flows: 'fixture' });
    const at = async (name) => { steps.push({ at: name, ...(await c.ev(`(() => {${LIB} return { scrollY: f1(scrollY), docHeight: document.documentElement.scrollHeight, panelOpen: Boolean(${Q.pickPanel}), dialog: Boolean(${Q.dialog}), flowsReads: window.__lm.reads.flows, flows503: window.__lm.answered.flows503, active: describe(document.activeElement) }; })()`)) }); };
    await openMenuGroup(c, 'Data sources');
    await c.click(Q.item('Only the ones I pick'), 'Only the ones I pick');
    await c.until(`Boolean(${Q.pickPanel})`, 20000, 'the picker panel');
    await c.settle();
    await c.until(`${Q.pickBoxes}.some((b) => !b.disabled)`, 10000, 'a pick control');
    await c.click(`${Q.pickBoxes}.find((b) => !b.disabled)`, 'the first pick control');
    await c.until(`${Q.pickBoxes}.some((b) => b.checked)`, 5000, 'a source picked');
    await c.settle();
    await at('panel open, a source picked');
    const openOverlay = async (what) => {
      const via = (await c.ev(`Boolean(${Q.whereLink})`)) ? 'the where-line link' : 'the menu footer link';
      if (via === 'the where-line link') await c.click(Q.whereLink, `${via} (${what})`);
      else { await openMenuGroup(c, 'Data sources'); await c.click(Q.item('All data sources and your consent'), `${via} (${what})`); }
      await c.until(`Boolean(${Q.dialog})`, 15000, `the Settings overlay (${what})`);
      return via;
    };
    const closeOverlay = async () => {
      await c.key('Escape');
      await c.until(`!${Q.dialog}`, 6000, 'the overlay closed by Escape');
      await c.settle();
    };
    // Control: the statement read as served, so the refresh keeps the panel.
    let n = await c.ev('window.__lm.reads.flows');
    const viaControl = await openOverlay('control');
    await c.until(`window.__lm.reads.flows > ${n}`, 15000, 'the overlay\'s consent refresh (control)');
    await sleep(800);
    await at('control: overlay open');
    await closeOverlay();
    await at('control: overlay closed');
    // The sequence: a refresh whose /api/flows read is answered 503, which closes the panel under the overlay.
    n = await c.ev('window.__lm.reads.flows');
    await c.ev(`window.__lm.cfg.flows503From = ${n + 1}`);
    const viaTest = await openOverlay('test');
    await c.until(`window.__lm.answered.flows503 > 0`, 15000, 'the overlay\'s consent refresh answered 503');
    await c.until(`!${Q.pickPanel}`, 10000, 'the panel to close under the overlay');
    await sleep(800);
    await at('overlay open, panel closed by the refresh');
    await closeOverlay();
    await sleep(300);
    await c.settle();
    await at('overlay closed');
    const r = await c.ev(`(() => {${LIB} const header = document.querySelector('header'); return { vw: innerWidth, vh: innerHeight, scrollY: f1(scrollY), header: R(header), active: describe(document.activeElement) }; })()`);
    if (ctx.shots) await c.shot(ctx.shots(`check6-${w}`));
    return { size: [w, h], via: [viaControl, viaTest], steps, ...r };
  } finally { await closeAll(c); }
}

export async function check6(ctx) {
  const lines = []; const data = []; let pass = true;
  for (const size of [SIZES.phone, SIZES.laptop]) {
    const r = await focusAfterOverlay(ctx, size);
    const b = r.active.rect;
    const ok = !!b && b.top >= -0.5 && b.bottom <= r.vh + 0.5 && b.left >= -0.5 && b.right <= r.vw + 0.5;
    const judged = size === SIZES.phone;
    if (judged) pass = pass && ok;
    lines.push(`${size[0]}x${size[1]}  opened by ${r.via[1]}  focus ${r.active.body ? 'body (no element)' : `${r.active.tag} "${r.active.text || r.active.ariaLabel || ''}" (in ${r.active.part})`}  ${box(b)}  scrollY ${r.scrollY}  viewport ${r.vw}x${r.vh}  ${judged ? verdict(ok) : `${verdict(ok)} (reported, not judged)`}`);
    for (const s of r.steps) lines.push(`      ${s.at}: scrollY ${s.scrollY}  page height ${s.docHeight}  panel ${s.panelOpen ? 'open' : 'closed'}  overlay ${s.dialog ? 'open' : 'closed'}  flows reads ${s.flowsReads} (503: ${s.flows503})  focus ${s.active.body ? 'body' : `${s.active.tag} "${s.active.text || s.active.ariaLabel || ''}"`}${s.active.rect ? ` @${s.active.rect.top}` : ''}`);
    data.push({ ...r, pass: ok, judged });
  }
  return { id: '6', title: "#786 item 3: after the sequence, the focused element's box is inside the viewport", sizes: '390x844 (judged), 1280x720 (reported); the home page signed out, the statement from the tracked fixture', pass, lines, data };
}

export const CHECKS = { 1: check1, 2: check2, 3: check3, 4: check4, 5: check5, 6: check6 };
