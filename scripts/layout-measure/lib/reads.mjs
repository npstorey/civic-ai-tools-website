// Page expressions the checks evaluate, and the driver's steps on the question surface. Every expression is a string
// evaluated in the page (`Runtime.evaluate`); nothing here runs in Node's scope.

export const Q = {
  composer: `document.querySelector('[data-part="composer"]')`,
  box: `document.querySelector('[data-part="composer"] textarea')`,
  send: `document.querySelector('[data-part="composer"] button[type="submit"]')`,
  trigger: `document.querySelector('[data-part="composer"] [data-part="harness-menu"] .ui-menu-trigger')`,
  menu: `document.querySelector('[data-part="composer"] [data-part="harness-menu"] [role="menu"]')`,
  item: (label) => `[...document.querySelectorAll('[data-part="harness-menu"] [role="menu"] .ui-menu-item')].find((e) => { const l = e.querySelector('.ui-menu-item-label'); return (l ? l.textContent.trim() : e.textContent.trim()) === ${JSON.stringify(label)}; })`,
  pickPanel: `document.querySelector('[data-part="pick-panel"]')`,
  pickBoxes: `[...document.querySelectorAll('[data-part="pick-panel"] [data-part="pick-control"] input[type="checkbox"]')]`,
  whereLink: `document.querySelector('[data-part="where-this-question-goes"] a')`,
  dialog: `document.querySelector('[role="dialog"]')`,
  prompt: `document.querySelector('[data-part="consent-pause-prompt"]')`,
  promptButton: (label) => `[...document.querySelectorAll('[data-part="consent-pause-prompt"] button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`,
  bar: `document.querySelector('.composer--docked > .composer-bar')`,
};

/** Shared page-side helpers, prefixed to the reads below. */
export const LIB = `
  const f1 = (x) => Math.round(x * 10) / 10;
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: f1(b.top), bottom: f1(b.bottom), left: f1(b.left), right: f1(b.right), width: f1(b.width), height: f1(b.height) }; };
  const T = (el) => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const describe = (el) => {
    if (!el || el === document.body || el === document.documentElement) return { tag: el ? el.tagName.toLowerCase() : null, body: true, rect: null };
    const part = el.closest('[data-part]');
    return { tag: el.tagName.toLowerCase(), text: T(el).slice(0, 60), ariaLabel: el.getAttribute('aria-label'), part: part ? part.getAttribute('data-part') : null, className: typeof el.className === 'string' ? el.className.slice(0, 60) : null, rect: R(el) };
  };
`;

/** The answer element whose text carries `marker` (the event file's `answerMarker`). */
export const ANSWER = (marker) => `[...document.querySelectorAll('[data-part="answer"]')].find((a) => a.textContent.includes(${JSON.stringify(marker)})) || null`;

/**
 * One timeline row: scroll, the prompt's, the card's and the answer's boxes, the header and the bar, and focus. FIX-1
 * FX2b: also the topmost author line directly before the answer part (`<p data-author>`; zero, one or two of them), as
 * `author`, null when there is none. Recorded only.
 */
export const SNAP = (marker) => `(() => {${LIB}
  const header = document.querySelector('header');
  const answerEl = ${ANSWER(marker)};
  let authorEl = null;
  for (let prev = answerEl ? answerEl.previousElementSibling : null; prev && prev.hasAttribute('data-author'); prev = prev.previousElementSibling) authorEl = prev;
  return {
    t: Math.round(performance.now()), scrollY: f1(scrollY), vh: innerHeight, docHeight: document.documentElement.scrollHeight,
    header: R(header), prompt: R(${Q.prompt}),
    card: R(document.querySelector('[data-part="consent-step"][data-consent-place="steps"]')),
    answer: R(answerEl), author: R(authorEl), authorLines: authorEl ? authorEl.getAttribute('data-author') : null, bar: R(${Q.bar}),
    active: describe(document.activeElement),
  };
})()`;

/** Every live region's text: `aria-live`, `role="status"` and `role="alert"`. */
export const LIVE = `(() => {${LIB}
  return [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map((el) => ({
    tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), ariaLive: el.getAttribute('aria-live'),
    part: el.closest('[data-part]') ? el.closest('[data-part]').getAttribute('data-part') : null, text: T(el).slice(0, 200),
  }));
})()`;

/** The page has hydrated and its first consent reads are in: the composer can take a question. */
export const SURFACE_READY = `(() => { const S = window.__lm; return !!S && !!${Q.box} && S.reads.consent >= 1 && S.reads.flows >= 1 && S.reads.decision >= 1; })()`;

/** Types `question` into the box and sends it; resolves once the run route has been answered in the page. */
export async function ask(c, question, { expectStream = true } = {}) {
  await c.until(SURFACE_READY, 30000, 'the question surface and its consent reads');
  await c.click(Q.box, 'the question box');
  await c.insertText(question);
  await c.until(`(() => { const b = ${Q.send}; return !!b && !b.disabled; })()`, 20000, 'the send arrow enabled (the model list read)');
  await c.click(Q.send, 'the send arrow');
  if (expectStream) await c.until('window.__lm.streams.length > 0 && !!window.__lm.controller', 15000, 'the run route answered in the page');
}

/**
 * Feeds an event file's events, one at a time, each followed by a settled layout. `onEvent(event, { arrival })` runs
 * after each pushed event; `onReader(action)` runs at a `$reader` step; `beforeArrival()` runs just before the event
 * marked `$arrival` is pushed.
 */
export async function feed(c, file, { onEvent = async () => {}, onReader = async () => {}, beforeArrival = async () => {} } = {}) {
  for (const raw of file.events) {
    if (raw.$reader) {
      await onReader(raw.$reader);
      continue;
    }
    if (raw.$end) {
      await c.ev('window.__lm.end()');
      await c.settle();
      await onEvent({ type: '(stream end)' }, { arrival: false, end: true });
      continue;
    }
    const { $arrival, ...event } = raw;
    if ($arrival === true) await beforeArrival();
    const pushed = await c.ev(`window.__lm.push(${JSON.stringify(event)})`);
    if (!pushed) throw new Error(`the run's stream was not open for ${event.type}`);
    await onEvent(event, { arrival: $arrival === true });
  }
}

/** Opens the harness menu and expands its group `label`. */
export async function openMenuGroup(c, label) {
  if (!(await c.ev(`Boolean(${Q.menu})`))) await c.click(Q.trigger, 'the harness menu trigger');
  await c.until(`Boolean(${Q.menu})`, 5000, 'the harness menu');
  const item = Q.item(label);
  if (!(await c.ev(`(() => { const e = ${item}; return !!e && e.getAttribute('aria-expanded') === 'true'; })()`))) {
    await c.click(item, `${label} (group)`);
    await c.until(`(() => { const e = ${item}; return !!e && e.getAttribute('aria-expanded') === 'true'; })()`, 5000, `${label} expanded`);
  }
  await c.settle();
}
