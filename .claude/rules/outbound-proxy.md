---
paths:
  - "src/lib/outbound-proxy.ts"
  - "src/lib/signin-proxy.ts"
  - "src/lib/sandbox/vercel-sandbox.ts"
  - "src/lib/sandbox/container.ts"
  - "scripts/outbound-proxy.test.mjs"
  - "package.json"
  - "package-lock.json"
---

# The egress-proxy path, and the one thing a dependency bump costs here

Four modules carry this application's egress-proxy behaviour, and they reach four different
transports: [`src/lib/outbound-proxy.ts`](../../src/lib/outbound-proxy.ts) installs the one
`undici` dispatcher that governs `fetch`;
[`src/lib/signin-proxy.ts`](../../src/lib/signin-proxy.ts) routes the sign-in provider leg, which
leaves through `node:http(s)` and which no `fetch` dispatcher can reach (#483);
[`src/lib/sandbox/vercel-sandbox.ts`](../../src/lib/sandbox/vercel-sandbox.ts) hands
`@vercel/sandbox` a `fetch` that replaces the SDK's own per-request agent, which overrides any
global dispatcher, with one built by `createProxyDispatcher` in `outbound-proxy.ts`, keeping the
SDK's `bodyTimeout: 0` (#492); and
[`src/lib/sandbox/container.ts`](../../src/lib/sandbox/container.ts) hands the values
`resolveProxySettings` resolves to the clients inside the notebook container: each `docker exec`
names the proxy variables in both spellings (`-e NAME`, never a value) and the spawned `docker` CLI
carries their values in its environment (#494).
[`docs/deploy.md`](../../docs/deploy.md) carries the operator-facing table of which outbound kinds
honour the variables and which do not.

## A undici bump is a RE-READ, not a re-run

The rule and the measurement it rests on are stated once, in `CLAUDE.md`'s Rules: the bullet
**"A port of a library's internals is pinned to that library's version, and its agreement test is
RE-READ on a bump, not merely re-run"** and the comment beneath it (`CLAUDE.md:258-277` when this
was written). Read it there. This file loads when `package.json` or `package-lock.json` is opened,
where a bump is written, and adds only what that passage does not carry:

- **The pin is exact.** `undici` is pinned in `package.json` at `6.29.1`, not a range, which is
  what makes `PORTED_FROM_UNDICI` (ported at 6.28.0, re-read at 6.29.1) a statement about the
  installed tree.
- **The table has twelve cases and a two-way control.** The agreement test, *"the sign-in path and
  the fetch path exempt exactly the same destinations"* in `scripts/outbound-proxy.test.mjs`, fails
  if the table stops carrying both outcomes: without a case that proxies and a case that is exempt,
  "the two paths agree" is satisfied by two dead paths.
- **The re-read, in order**, before trusting a green after a bump:
  1. Compare `shouldProxyDestination` line for line against the new version's
     `#getProxyAgentForUrl`, `#shouldProxy` and `#parseNoProxy` in
     `node_modules/undici/lib/dispatcher/env-http-proxy-agent.js`.
  2. Extend the case table for anything the new version decides that the old one did not.
  3. Then run the suite.
- **The `*` property can be lost from this side too.** `CLAUDE.md` says why `*` survives. It is a
  property of how this application composes the list (`DEFAULT_NO_PROXY_HOSTS` prepended), so a
  change to that composition can lose it as surely as a bump can. Re-read the `*` note in
  `shouldProxyDestination`'s own comment on either change.

<!-- #483 landed as PR #500. Its GO recorded what was checked at the source rather than from the
     implementer's report: the port against the installed undici (the three methods above), and
     the agreement table read for its two-way control. The measurement stays beside the rule in
     `CLAUDE.md` because a constraint handed on without the measurement that made it true does not
     survive two sessions; this file once carried a second copy of both (#512). -->

## The other two standing facts

- **One dispatcher.** `src/lib/outbound-proxy.ts` is the only place in this repository that calls
  `setGlobalDispatcher`, and the suite asserts it — two modules installing one means the second
  silently replaces the first's routing. The suite DISCOVERS the installer by scanning tracked
  sources, so a file renamed is fine and a file untracked is invisible. The sandbox driver's
  dispatcher is not global and is not installed: it is passed per request, and built by the same
  factory so its exempt set is the same composition.
- **Defaults off, on every path.** With none of the three variables set, no module touches
  anything: no dispatcher is installed or built, the sign-in library is left exactly as the runtime
  gave it, and `Sandbox.create` receives no `fetch`. A change that installs unconditionally reds the
  "unset" tests rather than shipping.
