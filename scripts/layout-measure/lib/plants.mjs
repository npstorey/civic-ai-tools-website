// The planted defects (`--plant <check>`): each injects one stylesheet or DOM change into the page under test, just
// before its check measures, so the check is shown able to read FAIL. `--plant guard` is not here: it switches off
// the in-page answer for the run routes (`page-init.mjs`, `answerRuns: false`), so the run's request reaches the CDP
// guard and the run reads VOID.

const style = (css) => `(() => { const s = document.createElement('style'); s.setAttribute('data-layout-measure-plant', ''); s.textContent = ${JSON.stringify(css)}; document.head.append(s); return true; })()`;

export const PLANTS = {
  // 1: the dialog's footer pushed out of the viewport.
  1: style('.ui-dialog-footer { transform: translateY(100vh) !important; }'),
  // 2: the chip row forced to wrap.
  2: style('.ui-chip-row { flex-wrap: wrap !important; }'),
  // 3: the tab row widened past 390.
  3: style('[role="tablist"] { width: 600px !important; min-width: 600px !important; max-width: none !important; }'),
  // 4: the docked bar raised over the answer's last line: fixed, its top at the middle of that line.
  4: (marker) => `(() => {
    const a = [...document.querySelectorAll('[data-part="answer"]')].find((x) => x.textContent.includes(${JSON.stringify(marker)}));
    const bar = document.querySelector('.composer--docked > .composer-bar');
    if (!a || !bar) return false;
    const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT); let n, last = null;
    while ((n = w.nextNode())) if (n.nodeValue.trim() !== '') last = n;
    const range = document.createRange(); range.selectNodeContents(last);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0); const line = rects[rects.length - 1];
    Object.assign(bar.style, { position: 'fixed', left: '0', right: '0', top: (line.top + line.height / 2) + 'px', bottom: 'auto' });
    return true;
  })()`,
};

export const PLANT_NAMES = ['1', '2', '3', '4', 'guard'];
