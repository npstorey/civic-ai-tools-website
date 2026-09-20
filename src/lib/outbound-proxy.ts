// The one outbound proxy dispatcher (#468).
//
// WHAT THIS IS FOR. On a network where outbound traffic must leave through an
// egress proxy, every call this application makes has to be told about that
// proxy: the model endpoint, the MCP servers, the object store, the signing
// services, and the object-store read verification makes when a package is
// stored by reference. The conventional way an operator says so is
// `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`.
//
// THIS RUNTIME IGNORES THOSE VARIABLES ON ITS OWN. Measured on the image's
// Node (v22, `Dockerfile` ARG NODE_IMAGE=node:22-bookworm-slim): built-in
// `fetch` with `HTTP_PROXY` set and `NO_PROXY` unset goes straight to the
// origin — `origin hits: 1, proxy hits: 0` — and `NODE_USE_ENV_PROXY=1`
// changes nothing, because that flag arrives in a later Node than this image
// carries. There is no configuration-only path: something has to install a
// dispatcher. This module is that something, and it is the only place in this
// repository that calls `setGlobalDispatcher`.
//
// WHY `EnvHttpProxyAgent`, AND WHAT IT COSTS. undici marks it experimental and
// emits `[UNDICI-EHPA] EnvHttpProxyAgent is experimental, expect them to
// change at any time` the first time one is constructed — a real cost, paid
// once per process and only when a proxy is actually configured. It buys the
// per-request routing decision (http vs https proxy, `NO_PROXY` matching,
// CONNECT tunnelling) that would otherwise be reimplemented here, which is the
// part with the interesting edge cases. `undici` is a DIRECT dependency for
// this reason: it was present only transitively, and a dispatcher installed
// from a package nothing declares is one dependency bump away from vanishing.
// `scripts/outbound-proxy.test.mjs` drives the behaviour rather than the API,
// so a change in undici's shape fails the suite instead of the deployment.
//
// DEFAULTS OFF. With none of the variables set, `install()` returns without
// touching the global dispatcher: the process keeps whatever Node gave it, and
// every request path and host is what it was before this module existed.
//
// `NO_PROXY` COVERS LOOPBACK BY DEFAULT. A proxied instance must still reach
// the services running beside it — a local MCP server, a loopback signing stub
// (#445), a sidecar — without the operator having to think of it. So
// `DEFAULT_NO_PROXY_HOSTS` is prepended to whatever `NO_PROXY` says, never
// substituted for it. It covers LOOPBACK only: a compose deployment reaches
// `postgres`, `minio` and `app` by service name, and those names belong in the
// operator's own `NO_PROXY` (docs/deploy.md says so).
//
// WHAT IT DOES NOT REACH. A global fetch dispatcher governs a `fetch` call
// that names no dispatcher of its own. It does not govern a call that does:
// `@vercel/sandbox` passes its own undici `Agent` on every API request, so the
// vercel-sandbox executor's calls to the sandbox API are outside this module
// (docs/deploy.md states it; scripts/outbound-proxy.test.mjs pins it). Nor
// does it govern `node:http(s)`, and TWO outbound kinds take that transport,
// each with its own arrangement rather than a second dispatcher. The sign-in
// library's provider calls (`openid-client`) are routed at that library's own
// per-URL transport seam — see `src/lib/signin-proxy.ts` (#483), which
// tunnels through the proxy with `CONNECT` and asks `shouldProxyDestination`
// below, so the exempt set is this module's and not a second opinion.
// `@aws-sdk/client-s3` is the other, so `BLOB_DRIVER=s3` needs its own — see
// `proxyAwareTransport` in `src/lib/storage/s3.ts`, which routes that
// driver through `fetch` (and therefore through this dispatcher) exactly when
// a proxy is configured. `pg` (DB_DRIVER=node-postgres) opens a raw TCP socket
// and is outside any HTTP proxy by nature; a Postgres reached through a proxy
// is a network-level arrangement, not an application one.

import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

/** Variable naming the proxy for `http://` destinations. */
export const HTTP_PROXY_ENV_NAME = 'HTTP_PROXY';

/** Variable naming the proxy for `https://` destinations. */
export const HTTPS_PROXY_ENV_NAME = 'HTTPS_PROXY';

/** Variable naming the destinations that must NOT go through the proxy. */
export const NO_PROXY_ENV_NAME = 'NO_PROXY';

/** All three, in the order the documentation lists them. */
export const PROXY_ENV_NAMES = [
  HTTP_PROXY_ENV_NAME,
  HTTPS_PROXY_ENV_NAME,
  NO_PROXY_ENV_NAME,
] as const;

/**
 * Destinations that stay direct whatever the operator sets. Loopback only, and
 * spelled the way a URL's `host` carries it — an IPv6 literal keeps its
 * brackets (`new URL('http://[::1]:9000').host === '[::1]:9000'`), and undici
 * matches the host with its port stripped, so `[::1]` is the form that matches
 * and a bare `::1` is not (it would parse as host `::` on port 1).
 */
export const DEFAULT_NO_PROXY_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

type EnvRecord = Record<string, string | undefined>;

/** What the environment asks for, resolved; no value is ever logged. */
export interface ProxySettings {
  /** True when at least one proxy address is configured. */
  enabled: boolean;
  /** Proxy for `http://` destinations; `''` when unset. */
  httpProxy: string;
  /** Proxy for `https://` destinations; `''` when unset — undici then falls
   *  back to the http proxy, which is the conventional behaviour. */
  httpsProxy: string;
  /** The exemption list actually applied: the loopback defaults, then the
   *  operator's `NO_PROXY` entries. */
  noProxy: string;
  /** Names (never values) of the variables that carried something. */
  honoured: string[];
}

/**
 * Resolve the three variables. Lower-case spelling wins over upper-case, which
 * is what undici itself does (`process.env.http_proxy ?? process.env.HTTP_PROXY`)
 * and what curl and the rest of the convention do; the upper-case names are the
 * ones declared in `ENV_SPEC` and documented, because they are the ones an
 * operator writes.
 */
export function resolveProxySettings(env: EnvRecord = process.env): ProxySettings {
  const httpProxy = (env.http_proxy ?? env.HTTP_PROXY ?? '').trim();
  const httpsProxy = (env.https_proxy ?? env.HTTPS_PROXY ?? '').trim();
  const noProxyConfigured = (env.no_proxy ?? env.NO_PROXY ?? '').trim();

  const honoured: string[] = [];
  if (httpProxy) honoured.push(HTTP_PROXY_ENV_NAME);
  if (httpsProxy) honoured.push(HTTPS_PROXY_ENV_NAME);
  if (noProxyConfigured) honoured.push(NO_PROXY_ENV_NAME);

  const noProxy = [...DEFAULT_NO_PROXY_HOSTS, noProxyConfigured]
    .filter((entry) => entry.length > 0)
    .join(',');

  return {
    enabled: Boolean(httpProxy || httpsProxy),
    httpProxy,
    httpsProxy,
    noProxy,
    honoured,
  };
}

/**
 * True when this process has an egress proxy configured. The object-store S3
 * driver asks, because its SDK does not use `fetch` and therefore cannot be
 * reached by the dispatcher installed here.
 */
export function isOutboundProxyConfigured(env: EnvRecord = process.env): boolean {
  return resolveProxySettings(env).enabled;
}

/** Ports a destination is understood to be on when its URL names none. */
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

/**
 * Does this destination go through the proxy, given the exemption list
 * `resolveProxySettings` composed?
 *
 * WHY THIS EXISTS AT ALL, GIVEN UNDICI ALREADY DECIDES. The dispatcher above
 * governs `fetch`. It cannot govern `node:http(s)`, which is the transport of
 * the sign-in library's provider calls, so that path is routed at the
 * library's own seam (`src/lib/signin-proxy.ts`) and something has to make the
 * same decision there. undici does not export the one it makes, so this is a
 * deliberate port of it — `EnvHttpProxyAgent#shouldProxy` and `#parseNoProxy`
 * at undici 6.28.0, the version this repository pins — and every property it
 * carries is one of undici's, not one chosen here:
 *
 *   - the host is taken with its port stripped and lower-cased, and an IPv6
 *     literal keeps its brackets, which is why `DEFAULT_NO_PROXY_HOSTS` spells
 *     `[::1]` that way;
 *   - an empty list proxies everything;
 *   - an entry beginning `.` or `*` is a SUFFIX match, anything else is exact;
 *   - an entry carrying `:port` applies only on that port;
 *   - `*` alone exempts everything — and it survives here for the same reason
 *     it survives in undici: not by the bare-string short-circuit, which
 *     prepending the loopback defaults means this list never hits, but by the
 *     per-entry suffix branch treating a leading `*` as a match on the empty
 *     string.
 *
 * A PORT IS NOT A PROOF. Agreement between the two paths is not asserted from
 * this comment: `scripts/outbound-proxy.test.mjs` drives the same destination
 * down BOTH paths under the same `NO_PROXY` and fails when they part, which is
 * what #483 criterion 2 asks for. Two implementations that each look right on
 * their own terms is how they drift.
 */
export function shouldProxyDestination(url: URL, noProxy: string): boolean {
  const hostname = url.host.replace(/:\d*$/, '').toLowerCase();
  const port = Number.parseInt(url.port, 10) || DEFAULT_PORTS[url.protocol] || 0;

  const entries = noProxy
    .split(/[,\s]/)
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const parsed = /^(.+):(\d+)$/.exec(entry);
      return {
        hostname: (parsed ? parsed[1] : entry).toLowerCase(),
        port: parsed ? Number.parseInt(parsed[2], 10) : 0,
      };
    });

  if (entries.length === 0) return true;
  if (noProxy === '*') return false;

  for (const entry of entries) {
    if (entry.port && entry.port !== port) continue;
    if (!/^[.*]/.test(entry.hostname)) {
      if (hostname === entry.hostname) return false;
    } else if (hostname.endsWith(entry.hostname.replace(/^\*/, ''))) {
      return false;
    }
  }

  return true;
}

export interface InstallResult {
  /** Whether a dispatcher was installed on this call. */
  installed: boolean;
  /** Names of the variables honoured — empty when nothing was installed. */
  honoured: string[];
}

let installedSettings: string | null = null;

/**
 * Install the one dispatcher, once. Idempotent: a second call with the same
 * resolved settings leaves the global dispatcher exactly as it is, so importing
 * this module from more than one place cannot produce two agents.
 *
 * Nothing is printed unless a proxy is configured, and what is printed is
 * variable NAMES only — a proxy URL can carry credentials.
 */
export function installOutboundProxyDispatcher(env: EnvRecord = process.env): InstallResult {
  const settings = resolveProxySettings(env);
  if (!settings.enabled) return { installed: false, honoured: [] };

  const fingerprint = JSON.stringify([settings.httpProxy, settings.httpsProxy, settings.noProxy]);
  if (installedSettings === fingerprint) return { installed: false, honoured: settings.honoured };

  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      // Passed explicitly so the agent is fully determined by the record
      // resolved above and never re-reads `process.env` behind our back. An
      // empty string is falsy to undici, which is the same as unset.
      httpProxy: settings.httpProxy,
      httpsProxy: settings.httpsProxy,
      noProxy: settings.noProxy,
    }),
  );
  installedSettings = fingerprint;

  console.info(
    `[outbound-proxy] honouring ${settings.honoured.join(', ')}; ` +
      `${DEFAULT_NO_PROXY_HOSTS.join(', ')} stay direct`,
  );
  return { installed: true, honoured: settings.honoured };
}

// Installed as a side effect of importing this module: the instrumentation
// hook (`src/instrumentation.ts`) imports it once for the server runtime, and
// any module that needs the dispatcher in place before its own first request
// can import it too without ordering hazards.
installOutboundProxyDispatcher();
