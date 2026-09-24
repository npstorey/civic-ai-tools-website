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

`shouldProxyDestination` in `src/lib/outbound-proxy.ts` is a **deliberate port of a library
internal**. undici does not export the decision its `EnvHttpProxyAgent` makes, so the sign-in path
had to make the same one, and the two paths agree only for as long as the port still describes what
undici does.

Its drift is bounded today by exactly two things:

- **the exact-version pin.** `undici` is pinned in `package.json` at `6.28.0` — an exact version,
  not a range. That is what makes "ported from 6.28.0" a statement about the installed tree.
- **the agreement test.** `scripts/outbound-proxy.test.mjs`, *"the sign-in path and the fetch path
  exempt exactly the same destinations"*, drives the same destination down both paths under the
  same `NO_PROXY` across twelve cases, and fails if the table ever stops carrying both outcomes.

**So a undici version change is the moment that test must be read again, not merely run again.** A
green re-run says only that the twelve cases still agree. It cannot say the twelve cases still
*cover* what undici now does: a new entry form, a changed default port, a changed wildcard or
suffix rule would be matched on neither path, agree perfectly, and be wrong in the same way on both.
Before trusting a green after a bump:

1. Compare `shouldProxyDestination` line for line against the new version's
   `#getProxyAgentForUrl`, `#shouldProxy` and `#parseNoProxy` in
   `node_modules/undici/lib/dispatcher/env-http-proxy-agent.js`.
2. Extend the case table for anything the new version decides that the old one did not.
3. Then run the suite.

Also re-read the `*` note in `shouldProxyDestination`'s own comment: the wildcard survives **not**
by undici's bare-string short-circuit — this application prepends `DEFAULT_NO_PROXY_HOSTS`, so the
composed list is never exactly `*` and that branch never fires — but by the per-entry suffix branch
treating a leading `*` as a match on the empty string. That is a property of how the list is
composed, so it can be lost by a change on either side.

<!-- The measurement this constraint rests on. #483 (PR #500, merged 2026-09-20 at
     c895ab00d7fd1fb11f96c017c850cb484fc45164) made the sign-in provider leg proxy-aware and
     introduced the port. The seat's GO recorded what it checked AT THE SOURCE rather than from the
     implementer's report: `shouldProxyDestination` compared line for line against the installed
     undici 6.28.0 (`#getProxyAgentForUrl`, `#shouldProxy`, `#parseNoProxy`), and criterion 2's
     agreement table read for its two-way control — that the table contains both a case that
     proxies and a case that is exempt, without which "the two paths agree" is satisfied by two
     dead paths. The constraint is written down here because a constraint handed on without the
     measurement that made it true does not survive two sessions. -->

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
