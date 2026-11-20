// The browser session for the layout measurements: the system Chrome, headless, over its debugging pipe
// (`--remote-debugging-pipe`, so no port is bound), one fresh temporary profile per session, removed at its close.
//
// THE GUARD. Every session enables CDP `Fetch` on `*/api/*` at the request stage. A request the page's own fetch
// wrapper (`page-init.mjs`) answers never reaches the network, so the guard never sees it. Anything that does reach
// it is classified, and these are FAILED (`Fetch.failRequest`) and recorded, never sent:
//   runRoutes      any request to a run route (`/api/query-notebook`, `/api/compare-stream`, `/api/compare`, a
//                  record's `/replay`);
//   consentWrites  any non-GET to `/api/sources/consent` or `/api/sources/consent/decision`;
//   authWrites     any non-GET to `/api/auth/*`;
//   rateLimit      any request to `/api/rate-limit`, whatever its method;
//   recordWrites   any non-GET to `/api/records*` (a publish, or the summary route's model call).
// Every other request continues unchanged. A run whose lists are not all empty is VOID (`run.mjs`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RUN_ROUTES = ['/api/query-notebook', '/api/compare-stream', '/api/compare'];

/** The guard's verdict on one request that reached the network, or null when it may continue. */
export function classify(pathname, method) {
  const m = String(method).toUpperCase();
  if (RUN_ROUTES.includes(pathname) || /^\/api\/(records|evidence)\/[^/]+\/replay$/.test(pathname)) return 'runRoutes';
  if ((pathname === '/api/sources/consent' || pathname.startsWith('/api/sources/consent/')) && m !== 'GET') return 'consentWrites';
  if (pathname.startsWith('/api/auth/') && m !== 'GET') return 'authWrites';
  if (pathname === '/api/rate-limit') return 'rateLimit';
  if ((pathname === '/api/records' || pathname.startsWith('/api/records/')) && m !== 'GET') return 'recordWrites';
  return null;
}

export function emptyGuard() {
  return { runRoutes: [], consentWrites: [], authWrites: [], rateLimit: [], recordWrites: [] };
}

/**
 * One browser session. `guard` is the run's shared guard record; `label` names the session in it. `initScript` runs
 * before the page's own scripts on every document. `protectionCookie`, when given, is set on the origin's host by CDP
 * and is never printed or written.
 */
export async function openSession({ label, origin, guard, initScript, protectionCookie, profileRoot }) {
  const root = profileRoot ?? os.tmpdir();
  const profile = fs.mkdtempSync(path.join(root, 'layout-measure-chrome-'));
  const chrome = spawn(CHROME_PATH, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--disable-features=Translate', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const toChrome = chrome.stdio[3];
  const fromChrome = chrome.stdio[4];
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  let buf = '';
  const notes = { exceptions: [], consoleErrors: [], loads: 0 };
  fromChrome.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) !== -1) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of listeners) l(msg);
      }
    }
  });
  // Every call has a timeout: a call that never answers fails the check instead of hanging the run.
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  };

  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId: s } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const originHost = new URL(origin).host;

  listeners.push((m) => {
    if (m.sessionId !== s) return;
    if (m.method === 'Page.loadEventFired') notes.loads += 1;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      notes.exceptions.push(String(d?.exception?.description ?? d?.text).split('\n')[0].slice(0, 240));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      notes.consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 240));
    }
    if (m.method === 'Fetch.requestPaused') {
      const u = new URL(m.params.request.url);
      const method = m.params.request.method;
      const verdict = classify(u.pathname, method);
      if (verdict === null) {
        send('Fetch.continueRequest', { requestId: m.params.requestId }, s).catch(() => {});
        return;
      }
      guard[verdict].push({ session: label, host: u.host === originHost ? 'origin' : 'other', path: u.pathname, method });
      send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }, s).catch(() => {});
    }
  });
  for (const d of ['Page', 'Runtime', 'Network']) await send(`${d}.enable`, {}, s);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] }, s);
  if (protectionCookie) {
    await send('Network.setCookie', { name: '_vercel_jwt', value: protectionCookie, domain: new URL(origin).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }, s);
  }
  if (initScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, s);

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s);
    if (r.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
    return r.result.value;
  };
  const until = async (expression, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ev(expression)) return true;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, s);
  const go = async (url, ready, what) => {
    const before = notes.loads;
    await send('Page.navigate', { url }, s);
    const end = Date.now() + 60000;
    while (notes.loads <= before && Date.now() < end) await sleep(100);
    if (notes.loads <= before) throw new Error(`no load event for ${url}`);
    await ev('document.fonts.ready.then(() => true)');
    if (ready) await until(ready, 30000, what ?? 'the page to be ready');
    await sleep(600);
  };
  // Two animation frames and a short wait: React has committed and the browser has laid the page out.
  const frames = () => ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  /** Waits until `scrollY` has not moved for `stillMs` (a smooth scroll has ended), up to `maxMs`. */
  const still = async (stillMs = 400, maxMs = 4000) => {
    const end = Date.now() + maxMs;
    let last = await ev('scrollY');
    let since = Date.now();
    while (Date.now() < end) {
      await sleep(50);
      const y = await ev('scrollY');
      if (y !== last) { last = y; since = Date.now(); }
      else if (Date.now() - since >= stillMs) return last;
    }
    return last;
  };
  const settle = async () => { await frames(); await sleep(150); await still(); await frames(); };
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, s);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, s);
  };
  /**
   * A real click on the centre of the element `find` (a page expression) returns. As a reader does, the page is
   * scrolled only when that centre is not the element's own (off screen, or under the sticky header or the docked
   * bar): then the element is brought to the middle of the viewport first. Returns whether it scrolled.
   */
  const click = async (find, what) => {
    const c = await ev(`(() => {
      const b = (${find}); if (!b) return null;
      const hit = () => { const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const e = document.elementFromPoint(x, y); return { x, y, ok: !!e && (e === b || b.contains(e)) }; };
      let h = hit(); let scrolled = false;
      if (!h.ok) { b.scrollIntoView({ block: 'center', behavior: 'instant' }); scrolled = true; h = hit(); }
      return [h.x, h.y, scrolled, h.ok];
    })()`);
    if (!c) throw new Error(`nothing to click: ${what}`);
    if (!c[3]) throw new Error(`cannot reach ${what}: another element covers its centre`);
    await clickAt(c[0], c[1]);
    return c[2];
  };
  const key = async (k) => {
    const map = { Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], End: [35, 'End'] };
    const [vk, code, text] = map[k];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }, s);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, s);
  };
  const insertText = (text) => send('Input.insertText', { text }, s);
  /** A reader's scroll: one mouse-wheel event of `deltaY` px at the viewport's centre. */
  const wheel = async (deltaY) => {
    const [x, y] = await ev('[Math.round(innerWidth / 2), Math.round(innerHeight / 2)]');
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }, s);
  };
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  };
  const close = async () => {
    try { await send('Browser.close'); } catch { /* closing */ }
    chrome.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still writing */ }
  };
  return { send, ev, until, size, go, frames, still, settle, click, clickAt, key, insertText, wheel, shot, close, notes };
}
