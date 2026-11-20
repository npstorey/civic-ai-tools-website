// The init script every page under test runs before its own scripts (`Page.addScriptToEvaluateOnNewDocument`). It
// wraps `window.fetch` and answers, IN THE PAGE, every request that would start a run, write anything, or count
// against the rate limit. The app is loaded unchanged; nothing is added to the server.
//
//   /api/query-notebook, /api/compare-stream, /api/compare
//                 a `text/event-stream` this script holds open; the driver feeds it events from the tracked event
//                 files (`__lm.push`) and closes it (`__lm.end`). With `answerRuns: false` (`--plant guard`) the
//                 request goes to the network instead, where the CDP guard fails it and the run reads VOID.
//   GET /api/flows                  passed through, or the tracked statement fixture (`flows: 'fixture'`), or 503
//                                   from the Nth read on (`flows503From`).
//   GET /api/sources/consent        a consent in force, coherent with the statement in force: the pause source set
//                                   to Ask first, every other source On, updated by the page's own writes below.
//   GET /api/sources/consent/decision   `{ routing: 'in-loop', store: true }`, or 503 from the Nth read on.
//   POST /api/sources/consent/decision  the route's 200 shape, `{ decision, sourceId }`, recorded.
//   PUT|PATCH|DELETE /api/sources/consent   the route's 200 shape, recorded.
//   GET /api/rate-limit             `{ remaining, limit }`, recorded.
//   /api/auth/session               passed through, or a fixture session (`signedIn`).
//   any other non-GET /api/auth/*   503, recorded.
//   any non-GET /api/records*       the summary route answered with a fixture summary, anything else 503; recorded.
// Every other request passes through.
//
// `pageInit` is serialized with `Function.prototype.toString`, so it may use nothing from this module's scope.

export function pageInit(cfg) {
  if (window.__lm) return;
  const real = window.fetch.bind(window);
  const enc = new TextEncoder();
  const S = (window.__lm = {
    cfg,
    reads: { flows: 0, consent: 0, decision: 0, session: 0, models: 0 },
    answered: { flows503: 0, decision503: 0, rateLimit: 0 },
    streams: [],
    consentWrites: [],
    authWrites: [],
    recordWrites: [],
    states: null,
    statement: null,
    statementText: null,
    statementSource: null,
    pauseKeys: [],
    controller: null,
    log: [],
  });
  try {
    if (cfg.mode) window.sessionStorage.setItem('civicaitools.notebookMode', cfg.mode);
  } catch {
    /* storage refused: the mount's default applies, and the check reads it */
  }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async (text) => {
    try {
      const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
      return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  };
  // The statement in force, read once: the fixture's text, or the server's own answer (one GET this script makes).
  let statementPromise = null;
  const statementInForce = () => {
    if (!statementPromise) {
      statementPromise = (async () => {
        let text = cfg.flowsFixture;
        S.statementSource = 'fixture';
        if (cfg.flows !== 'fixture') {
          const r = await real('/api/flows', { headers: { Accept: 'application/json' } });
          text = await r.text();
          S.statementSource = `server (${r.status})`;
        }
        S.statementText = text;
        S.statement = JSON.parse(text);
        S.hash = (await sha256(text)) ?? S.statement.version;
        const ids = S.statement.sources.map((x) => x.sourceId);
        const pauseId = cfg.pauseSource && ids.includes(cfg.pauseSource) ? cfg.pauseSource : ids[0];
        S.pauseId = pauseId;
        S.states = Object.fromEntries(ids.map((id) => [id, id === pauseId ? 'ask-first' : 'on']));
        return S.statement;
      })();
    }
    return statementPromise;
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const consentBody = () => ({
    inForce: true,
    store: 'cookie',
    flowsVersion: S.hash,
    defaults: Object.fromEntries(Object.keys(S.states).map((id) => [id, 'ask-first'])),
    accounts: false,
    states: Object.fromEntries(Object.entries(S.states).map(([id, state]) => [id, { state, since: today() }])),
    consentedFlowsVersion: S.hash,
    consentedBaseVersion: S.statement.version,
    consentedFlowsDate: S.statement.date,
    notices: [],
  });
  const readerName = (source) => {
    const name = source.displayName ?? source.label ?? source.sourceId;
    return name.endsWith(' MCP Server') ? name.slice(0, -' MCP Server'.length) : name;
  };
  // The placeholders the event files carry, resolved against the statement in force.
  const resolve = (node) => {
    if (Array.isArray(node)) return node.map(resolve);
    if (node && typeof node === 'object') {
      if (node.$pause === true) {
        const source = S.statement.sources.find((x) => x.sourceId === S.pauseId);
        const key = hex(16);
        S.pauseKeys.push(key);
        return { key, source, outbound: [], links: S.statement.links, expiresAt: new Date(Date.now() + 60000).toISOString(), holds: true };
      }
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(v)]));
    }
    if (typeof node === 'string') {
      const source = S.statement.sources.find((x) => x.sourceId === S.pauseId);
      return node
        .replaceAll('{source}', source ? readerName(source) : 'the source')
        .replaceAll('{alias}', String(S.pauseId).replace(/-/g, '_'))
        .replaceAll('{answer}', cfg.answer ?? '');
    }
    return node;
  };
  S.push = (event) => {
    if (!S.controller) return false;
    S.controller.enqueue(enc.encode(`data: ${JSON.stringify(resolve(event))}\n\n`));
    return true;
  };
  S.end = () => {
    if (!S.controller) return false;
    S.controller.close();
    S.controller = null;
    return true;
  };
  const RUN_ROUTES = ['/api/query-notebook', '/api/compare-stream', '/api/compare'];

  // NextAuth's client logger posts to `/api/auth/_log` by `sendBeacon` when a session read fails: answered here as
  // every other auth write is, recorded, and never sent.
  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (target, data) => {
      const p = new URL(String(target), location.href).pathname;
      if (p.startsWith('/api/')) {
        if (p.startsWith('/api/auth/')) S.authWrites.push({ path: p, method: 'POST', beacon: true });
        else S.recordWrites.push({ path: p, method: 'POST', beacon: true });
        return true;
      }
      return realBeacon(target, data);
    };
  }

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const method = String(init.method || (typeof input === 'object' && !(input instanceof URL) && input.method) || 'GET').toUpperCase();
    const p = url.pathname;
    const bodyOf = () => { try { return JSON.parse(init.body); } catch { return null; } };
    S.log.push({ path: p, method, at: Math.round(performance.now()) });

    if (RUN_ROUTES.includes(p)) {
      if (cfg.answerRuns === false) return real(input, init);
      const body = bodyOf();
      S.streams.push({ path: p, method, picks: body && body.picks ? body.picks : null, mcpOnly: body ? body.mcpOnly === true : null });
      await statementInForce();
      const stream = new ReadableStream({ start(c) { S.controller = c; } });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (p === '/api/sources/consent/decision') {
      if (method === 'GET') {
        S.reads.decision += 1;
        if (cfg.decision503From && S.reads.decision >= cfg.decision503From) { S.answered.decision503 += 1; return json({ error: 'answered in the page' }, 503); }
        return json({ routing: 'in-loop', store: true });
      }
      const body = bodyOf() || {};
      S.consentWrites.push({ path: p, method, decision: body.decision ?? null });
      await statementInForce();
      if (body.decision === 'allow') S.states[S.pauseId] = 'on';
      if (body.decision === 'off') S.states[S.pauseId] = 'off';
      if (body.decision === 'allow-all') for (const id of Object.keys(S.states)) S.states[id] = 'on';
      return json({ decision: body.decision, sourceId: S.pauseId });
    }
    if (p === '/api/sources/consent') {
      await statementInForce();
      if (method === 'GET') { S.reads.consent += 1; return json(consentBody()); }
      const body = bodyOf() || {};
      S.consentWrites.push({ path: p, method, states: body.states ? Object.keys(body.states).length : null });
      if (method === 'PUT' && body.states) for (const [id, st] of Object.entries(body.states)) if (id in S.states) S.states[id] = st;
      if (method === 'DELETE') return json({ inForce: false, store: 'cookie' });
      const b = consentBody();
      return json({ inForce: true, store: 'cookie', flowsVersion: b.flowsVersion, states: b.states });
    }
    if (p === '/api/flows' && method === 'GET') {
      S.reads.flows += 1;
      await statementInForce();
      if (cfg.flows503From && S.reads.flows >= cfg.flows503From) { S.answered.flows503 += 1; return json({ error: 'answered in the page' }, 503); }
      if (cfg.flows === 'fixture') return new Response(S.statementText, { status: 200, headers: { 'Content-Type': 'application/json' } });
      return real(input, init);
    }
    if (p === '/api/rate-limit') {
      S.answered.rateLimit += 1;
      return json({ remaining: 9, limit: 10 });
    }
    if (p === '/api/auth/session') {
      S.reads.session += 1;
      if (cfg.signedIn) return json({ user: { name: 'Fixture Reader' }, expires: '2099-01-01T00:00:00.000Z' });
      return real(input, init);
    }
    if (p.startsWith('/api/auth/') && method !== 'GET') {
      S.authWrites.push({ path: p, method });
      return json({ error: 'answered in the page' }, 503);
    }
    if ((p === '/api/records' || p.startsWith('/api/records/')) && method !== 'GET') {
      S.recordWrites.push({ path: p, method });
      if (p === '/api/records/generate-summary') return json({ summary: 'A fixture summary of the answer.' });
      return json({ error: 'answered in the page' }, 503);
    }
    if (p === '/api/models') S.reads.models += 1;
    return real(input, init);
  };
}

/** The init script's source for `cfg`. */
export function initScript(cfg) {
  return `(${pageInit.toString()})(${JSON.stringify(cfg)});`;
}
