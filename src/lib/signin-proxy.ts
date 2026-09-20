// The sign-in provider leg's egress proxy (#483).
//
// WHAT THIS IS FOR. `src/lib/outbound-proxy.ts` installs one `undici`
// dispatcher and every outbound kind that leaves through `fetch` is governed
// by it. The sign-in provider leg is not one of those. next-auth v4 runs its
// OAuth/OIDC calls — discovery, the token exchange, userinfo — through
// `openid-client`, which builds each request with
// `(url.protocol === 'https:' ? https.request : http.request)(url.href, opts)`.
// A global `fetch` dispatcher cannot govern `node:http(s)` at all, so W6 (#468)
// measured that leg (`{fetch: 0, nodeHttp: 1}`) and wrote it down as a
// limitation. This module is what closes it: an instance behind an egress proxy
// now configures HTTP_PROXY / HTTPS_PROXY / NO_PROXY once, and sign-in against
// an external provider goes through the proxy like everything else.
//
// THE SEAM IS THE LIBRARY'S OWN, AND IT IS THE ONE next-auth ITSELF USES.
// `openid-client`'s request helper reads a per-URL options provider off the
// receiver of every call (`this[custom.http_options]`) and merges what it
// returns over the request's options, picking from a fixed list that includes
// `agent`. next-auth reaches the same machinery from the other end: its
// provider option `httpOptions` is passed straight to
// `custom.setHttpOptionsDefaults`. So nothing here patches a library internal;
// it fills in a documented extension point.
//
// WHY THE PER-URL HOOK AND NOT `setHttpOptionsDefaults`. The defaults are one
// static object, so an `agent` set there is handed to BOTH transports. A single
// `http.Agent` is refused outright by `https.request` (`Protocol "https:" not
// supported`), and an agent that answers to neither protocol makes Node read
// its `defaultPort` — which Node resolves BEFORE it knows the protocol, so an
// `https://` URL that names no port would be dialled on 80. Measured, both of
// them. The per-URL hook has the URL in hand, so each request gets an agent
// that matches its own protocol and every Node default lands correctly.
//
// THREE RECEIVERS, BECAUSE THERE ARE THREE. `openid-client` makes requests
// from the `Issuer` class (discovery, webfinger), from an Issuer instance (the
// jwks read) and from a client instance (the token exchange and userinfo). The
// hook is a property lookup on the receiver, so the client legs are reached by
// setting it on the shared base every client class extends — obtained from the
// library's own public surface, `Object.getPrototypeOf(new Issuer({…}).Client)`,
// rather than by a deep import of a file the package does not publish. A fix
// that covered discovery alone would leave the token exchange going direct, so
// `scripts/outbound-proxy.test.mjs` drives BOTH legs at the proxy.
//
// DEFAULTS OFF, AND ACTIVELY SO. With none of the variables set this module
// does not merely decline to add a hook: it REMOVES one it previously
// installed, so a process that was proxied and is no longer leaves the library
// exactly as the runtime gave it. Ownership is tracked on the hook itself, so a
// hook some other code installed is never removed.
//
// THE EXEMPT SET IS NOT A SECOND OPINION. Which destinations stay direct is
// decided by `shouldProxyDestination` in `src/lib/outbound-proxy.ts`, reading
// the same composed `NO_PROXY` string — `DEFAULT_NO_PROXY_HOSTS` prepended to
// the operator's entries — that the dispatcher is built with. The two paths are
// not asserted to agree from this comment: the suite drives the same
// destination down both under the same environment and fails when they part.
//
// NO NEW RUNTIME DEPENDENCY. `undici`'s agent does not apply to `node:http(s)`,
// and no proxy-agent package carries undici's `NO_PROXY` semantics, so the
// routing decision had to be ours whichever package was added. What a package
// would have bought on top of that is the `CONNECT` tunnel and the TLS wrap
// below — about eighty lines against five transitive packages. The tunnel is
// driven through a real loopback proxy on both protocols by the suite.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Issuer, custom } from 'openid-client';
import {
  resolveProxySettings,
  shouldProxyDestination,
  type ProxySettings,
} from './outbound-proxy.ts';

type EnvRecord = Record<string, string | undefined>;

/** Marks the hook as ours, so an uninstall never removes somebody else's. */
const OWNER = 'civic-ai-tools-website/signin-proxy';

/** What the per-URL hook returns; `openid-client` picks `agent` off it. */
interface TransportOptions {
  agent?: http.Agent;
}

interface TransportHook {
  (url: URL): TransportOptions;
  installedBy?: string;
}

/**
 * An issuer identifier used only to reach the client base class. It is a
 * reserved `.invalid` name, so it can never collide with a real issuer and
 * nothing it touches can resolve. Constructing an Issuer makes no request.
 */
const BASE_CLIENT_PROBE_ISSUER = 'https://signin-proxy-probe.invalid';

/**
 * The three objects `openid-client` reads a transport hook off, in the order
 * its own `request` helper can be reached from: the Issuer class, an Issuer
 * instance, and every client instance.
 */
function transportReceivers(): Record<symbol, unknown>[] {
  const clientClass = new Issuer({ issuer: BASE_CLIENT_PROBE_ISSUER }).Client;
  const baseClient = Object.getPrototypeOf(clientClass) as { prototype: object };
  return [
    Issuer as unknown as Record<symbol, unknown>,
    Issuer.prototype as unknown as Record<symbol, unknown>,
    baseClient.prototype as unknown as Record<symbol, unknown>,
  ];
}

/**
 * The proxy a destination on this protocol goes through, or `''` for none.
 * Mirrors undici's own fallback exactly: an `http://` destination uses
 * `HTTP_PROXY` or goes direct, and an `https://` destination uses
 * `HTTPS_PROXY`, falling back to `HTTP_PROXY`.
 */
function proxyUrlFor(protocol: string, settings: ProxySettings): string {
  if (protocol === 'https:') return settings.httpsProxy || settings.httpProxy;
  return settings.httpProxy;
}

/** A CONNECT authority: an IPv6 literal is bracketed, everything else is not. */
function authorityOf(host: string, port: number): string {
  const bare = host.replace(/^\[|\]$/g, '');
  return bare.includes(':') ? `[${bare}]:${port}` : `${bare}:${port}`;
}

/**
 * Open a `CONNECT` tunnel to `target` through `proxy` and hand back the socket.
 *
 * CONNECT FOR BOTH PROTOCOLS, which is what undici does on the `fetch` path —
 * it tunnels with `CONNECT host:80` even for an `http://` target and sends no
 * absolute-form request (measured at undici 6.28.0, and why the suite's
 * loopback proxy counts a request observed in either form). One code path here
 * rather than two is the same choice.
 *
 * A proxy address may carry a user and password (`http://user:pass@proxy`).
 * They are read straight off the URL, sent as `Proxy-Authorization`, and never
 * logged — this module prints variable NAMES only, like the dispatcher does.
 */
function openTunnel(
  proxy: URL,
  target: { host: string; port: number },
  timeout: number | undefined,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const proxyIsSecure = proxy.protocol === 'https:';
    const proxyPort = Number(proxy.port) || (proxyIsSecure ? 443 : 80);
    const socket: net.Socket = proxyIsSecure
      ? tls.connect({ host: proxy.hostname, port: proxyPort, servername: proxy.hostname })
      : net.connect({ host: proxy.hostname, port: proxyPort });

    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const onError = (error: Error) => fail(error);
    const onTimeout = () =>
      fail(new Error('the egress proxy did not answer CONNECT before the request timeout'));
    const onClose = () =>
      fail(new Error('the egress proxy closed the connection before answering CONNECT'));

    socket.on('error', onError);
    socket.on('close', onClose);
    if (timeout) {
      socket.setTimeout(timeout);
      socket.on('timeout', onTimeout);
    }

    // `latin1` is a byte-for-byte round trip, so whatever follows the blank
    // line survives being sliced back out and pushed in front of the stream.
    let banner = '';
    const onData = (chunk: Buffer) => {
      banner += chunk.toString('latin1');
      const end = banner.indexOf('\r\n\r\n');
      if (end === -1) {
        if (banner.length > 16384) {
          fail(new Error('the egress proxy sent an oversized response to CONNECT'));
        }
        return;
      }

      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(banner)?.[1]);
      if (status !== 200) {
        fail(
          new Error(
            `the egress proxy refused CONNECT to ${authorityOf(target.host, target.port)} with ` +
              `${status ? `status ${status}` : 'an unreadable status line'}`,
          ),
        );
        return;
      }

      settled = true;
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      socket.removeListener('timeout', onTimeout);
      socket.setTimeout(0);

      const head = Buffer.from(banner.slice(end + 4), 'latin1');
      if (head.length > 0) socket.unshift(head);
      resolve(socket);
    };
    socket.on('data', onData);

    const authority = authorityOf(target.host, target.port);
    const authorization = proxy.username
      ? 'Proxy-Authorization: Basic ' +
        Buffer.from(
          `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
        ).toString('base64') +
        '\r\n'
      : '';

    // ONCE, AND ON THE RIGHT EVENT. A `tls.connect` socket emits `connect`
    // before `secureConnect`, so listening for both would send the request
    // line twice to a proxy reached over TLS.
    socket.once(proxyIsSecure ? 'secureConnect' : 'connect', () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${authorization}\r\n`);
    });
  });
}

/** Where a request is really going, read off the options Node hands the agent. */
function targetOf(options: http.ClientRequestArgs, defaultPort: number) {
  return {
    host: options.host ?? options.hostname ?? '',
    port: Number(options.port) || defaultPort,
  };
}

/**
 * `http://` destinations. Extends `http.Agent` so `protocol` and `defaultPort`
 * are the ones `http.request` expects; only the socket underneath changes.
 */
class ProxyTunnelAgent extends http.Agent {
  private readonly proxy: URL;

  constructor(proxy: URL) {
    super();
    this.proxy = proxy;
  }

  createConnection(
    options: http.ClientRequestArgs,
    callback?: (err: Error | null, stream: net.Socket) => void,
  ): net.Socket | null | undefined {
    openTunnel(this.proxy, targetOf(options, 80), options.timeout).then(
      (socket) => callback?.(null, socket),
      (error: Error) => callback?.(error, null as unknown as net.Socket),
    );
    return undefined;
  }
}

/**
 * `https://` destinations: the same tunnel, then TLS over it. Extends
 * `https.Agent` for the same reason — `defaultPort` 443 and `protocol`
 * `https:` are what `https.request` reads before the agent is ever consulted.
 *
 * The TLS settings forwarded are exactly the ones `openid-client` accepts on
 * its own options (`ca`, `cert`, `crl`, `key`, `passphrase`, `pfx`), so an
 * instance that configures a private certificate authority for its provider
 * keeps it through the tunnel. Nothing else from the request options is passed:
 * verification stays on Node's defaults.
 */
class SecureProxyTunnelAgent extends https.Agent {
  private readonly proxy: URL;

  constructor(proxy: URL) {
    super();
    this.proxy = proxy;
  }

  createConnection(
    options: https.RequestOptions,
    callback?: (err: Error | null, stream: net.Socket) => void,
  ): net.Socket | null | undefined {
    const target = targetOf(options, 443);
    openTunnel(this.proxy, target, options.timeout).then(
      (socket) => {
        const secured = tls.connect({
          socket,
          servername: options.servername || target.host.replace(/^\[|\]$/g, ''),
          ca: options.ca,
          cert: options.cert,
          crl: options.crl,
          key: options.key,
          passphrase: options.passphrase,
          pfx: options.pfx,
        });
        secured.once('error', () => socket.destroy());
        callback?.(null, secured as unknown as net.Socket);
      },
      (error: Error) => callback?.(error, null as unknown as net.Socket),
    );
    return undefined;
  }
}

/**
 * One agent per (proxy, protocol), so a run of provider calls reuses its
 * tunnel rather than opening one per request. Keyed on the proxy address,
 * which may carry a secret; this map is in-memory and never printed.
 */
const agents = new Map<string, http.Agent>();

function agentFor(proxyUrl: string, secure: boolean): http.Agent {
  const key = `${secure ? 'https' : 'http'}|${proxyUrl}`;
  const existing = agents.get(key);
  if (existing) return existing;
  const agent = secure
    ? new SecureProxyTunnelAgent(new URL(proxyUrl))
    : new ProxyTunnelAgent(new URL(proxyUrl));
  agents.set(key, agent);
  return agent;
}

export interface SignInProxyInstallResult {
  /** Whether a transport hook was installed on this call. */
  installed: boolean;
  /** Names of the variables honoured — empty when nothing was installed. */
  honoured: string[];
}

let installedSettings: string | null = null;

/**
 * Install the transport hook, once. Idempotent on the same resolved settings,
 * for the same reason the dispatcher is: importing this module from more than
 * one place must not produce two hooks or two log lines.
 *
 * With no proxy configured it removes the hook instead, and reports nothing.
 */
export function installSignInProxyTransport(
  env: EnvRecord = process.env,
): SignInProxyInstallResult {
  const settings = resolveProxySettings(env);

  if (!settings.enabled) {
    for (const receiver of transportReceivers()) {
      const existing = receiver[custom.http_options] as TransportHook | undefined;
      if (existing?.installedBy === OWNER) delete receiver[custom.http_options];
    }
    installedSettings = null;
    return { installed: false, honoured: [] };
  }

  const fingerprint = JSON.stringify([settings.httpProxy, settings.httpsProxy, settings.noProxy]);
  if (installedSettings === fingerprint) return { installed: false, honoured: settings.honoured };

  const hook: TransportHook = (url: URL) => {
    if (!shouldProxyDestination(url, settings.noProxy)) return {};
    const secure = url.protocol === 'https:';
    const proxyUrl = proxyUrlFor(url.protocol, settings);
    if (!proxyUrl) return {};
    return { agent: agentFor(proxyUrl, secure) };
  };
  hook.installedBy = OWNER;

  for (const receiver of transportReceivers()) {
    receiver[custom.http_options] = hook;
  }
  installedSettings = fingerprint;

  console.info(
    `[signin-proxy] the sign-in provider leg honours ${settings.honoured.join(', ')}`,
  );
  return { installed: true, honoured: settings.honoured };
}

// Installed as a side effect of importing this module, on the same terms as the
// dispatcher: the instrumentation hook imports it once for the server runtime,
// and the module that owns sign-in imports it too, so the hook is in place
// before the first provider call whichever of them evaluates first.
installSignInProxyTransport();
