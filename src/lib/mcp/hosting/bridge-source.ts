/**
 * The bridge the website writes into a hosted source's sandbox (#617 P3,
 * ruling D2): one fixed stdio MCP server, served over Streamable HTTP.
 *
 * It is held here as text because it never runs in the website: the lifecycle
 * (`./lifecycle.ts`) writes it into the sandbox at creation, beside a
 * `package.json` that pins its two packages exactly (`BRIDGE_PACKAGES`) and a
 * config naming the one package it may run (`bridgeConfig`). A string, not a
 * file read at run time, so no deployment can ship without it (a runtime-read
 * file would be a standalone-tracing asset, `scripts/check-standalone-assets.mjs`).
 * `bridge-source.test.ts` writes it out and parses it, and holds the
 * properties below to the text.
 *
 * What it is, toward each side:
 *   - the child: `@modelcontextprotocol/client`'s stdio transport, in
 *     `legacy` mode. The child speaks the 2025 handshake (every server built on
 *     `@modelcontextprotocol/sdk` 1.x does), and `legacy` sends `initialize`
 *     with no probe, so no second process is spawned to ask (#617 correction c);
 *   - the website: `@modelcontextprotocol/server`'s handler, modern (revision
 *     2026-07-28) and sessionless, with 2025-era requests served statelessly.
 *     The website's client finds it modern by `server/discover`.
 *
 * Its rules: the command is the one `bin` of the package the config names, at
 * the version the config pins, and the bridge refuses to start on any other
 * installed version; nothing in a request reaches the spawn. Every path needs
 * the token, compared in constant time. The child gets the SDK's default
 * environment only, so it never sees the token. A child that exits is
 * restarted.
 */

/** The bridge's own packages, pinned exactly. 2.3.0 is the newest release of
 *  both that was at least two weeks old when this was written (2026-10-16). */
export const BRIDGE_PACKAGES = {
  '@modelcontextprotocol/server': '2.3.0',
  '@modelcontextprotocol/client': '2.3.0',
} as const;

/** The bridge's `package.json` inside the sandbox. */
export const BRIDGE_PACKAGE_JSON = JSON.stringify(
  { name: 'civic-source-bridge', private: true, type: 'module', dependencies: BRIDGE_PACKAGES },
  null,
  2,
);

/** What the bridge reads at start: the package it may run, the pinned
 *  version, where that package is installed, and the port to listen on. */
export interface BridgeConfig {
  package: string;
  version: string;
  pinDir: string;
  port: number;
}

/** The bridge's config file, as text. */
export function bridgeConfig(config: BridgeConfig): string {
  return JSON.stringify(config, null, 2);
}

/** The line the bridge prints once it listens and its child has answered. */
export const BRIDGE_READY_LINE = 'BRIDGE_READY';

/** The bridge program. */
export const BRIDGE_SOURCE: string = String.raw`// The source bridge: one publisher-bundled stdio MCP server, served over
// Streamable HTTP, inside the sandbox the website creates for that source.
//
// - Toward the child: the official client's stdio transport, in 'legacy' mode
//   (the child speaks the 2025 handshake; no probe, so no sibling process).
// - Toward the website: the official server's handler, modern (2026-07-28) and
//   sessionless, with 2025-era requests served statelessly.
// - The command is fixed: the 'bin' of the one package named in
//   bridge-config.json, at the version pinned there. Nothing in a request
//   reaches the spawn.
// - Every path requires the token (SOURCE_BRIDGE_TOKEN, from the sandbox's
//   environment at creation), compared in constant time. The child is not
//   given the token: it receives the SDK's default environment only.
// - The child is restarted when it exits.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(new URL(import.meta.url).pathname);
const config = JSON.parse(readFileSync(path.join(here, 'bridge-config.json'), 'utf8'));
const pkgDir = path.join(config.pinDir, 'node_modules', config.package);
const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
if (pkg.version !== config.version) {
  console.error('BRIDGE_REFUSED installed ' + pkg.version + ' is not the pinned ' + config.version);
  process.exit(2);
}
const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});
if (bins.length !== 1) {
  console.error('BRIDGE_REFUSED the package declares ' + bins.length + ' commands; one is required');
  process.exit(2);
}
const ENTRY = path.resolve(pkgDir, bins[0]);
const TOKEN = process.env.SOURCE_BRIDGE_TOKEN ?? '';
if (TOKEN.length < 32) {
  console.error('BRIDGE_REFUSED no token in the environment');
  process.exit(2);
}
const expected = createHash('sha256').update(TOKEN).digest();
const authorized = (req) => {
  const header = String(req.headers.authorization ?? '');
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(createHash('sha256').update(given).digest(), expected);
};

// What a log line may say about an error: its class, never its message, which
// can carry a request's arguments (the website's #503 rule, and its name for
// the bound).
const errorClassOf = (error) => (error instanceof Error ? error.constructor.name : typeof error);

let child = null;
let starting = null;
let restarts = 0;
async function startChild() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY], env: getDefaultEnvironment(), stderr: 'inherit' });
  const client = new Client({ name: 'civic-source-bridge', version: '1' }, { versionNegotiation: { mode: 'legacy' } });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const started = { client, tools, serverInfo: client.getServerVersion(), protocolVersion: client.getNegotiatedProtocolVersion?.() ?? null, pid: transport.pid };
  client.onclose = () => {
    if (child !== started) return;
    child = null;
    restarts += 1;
    console.log('BRIDGE_CHILD_EXITED pid ' + started.pid + '; restart ' + restarts);
    setTimeout(() => { ensureChild().catch((e) => console.error('BRIDGE_CHILD_RESTART_FAILED ' + errorClassOf(e))); }, Math.min(5000, 250 * restarts));
  };
  child = started;
  return started;
}
function ensureChild() {
  if (child) return Promise.resolve(child);
  starting ??= startChild().finally(() => { starting = null; });
  return starting;
}

const handler = createMcpHandler(async () => {
  const c = await ensureChild();
  const server = new Server(c.serverInfo ?? { name: config.package, version: config.version }, { capabilities: { tools: {} } });
  server.setRequestHandler('tools/list', async () => ({ tools: c.tools }));
  server.setRequestHandler('tools/call', async (request) => c.client.callTool({ name: request.params.name, arguments: request.params.arguments ?? {} }));
  return server;
}, { responseMode: 'json' });

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => { size += chunk.length; if (size > 4194304) { reject(new Error('body too large')); req.destroy(); } else chunks.push(chunk); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://bridge');
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
    if (url.pathname === '/health' && req.method === 'GET') {
      const c = await ensureChild();
      return send(res, 200, { package: config.package, version: config.version, serverInfo: c.serverInfo, protocolVersion: c.protocolVersion, pid: c.pid, restarts });
    }
    if (url.pathname !== '/mcp') return send(res, 404, { error: 'not found' });
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string' && name !== 'authorization') headers.set(name, value);
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const response = await handler.fetch(new Request('http://bridge' + url.pathname + url.search, { method: req.method, headers, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('BRIDGE_REQUEST_FAILED ' + errorClassOf(error));
    if (!res.headersSent) send(res, 500, { error: 'bridge error' });
  }
}).listen(config.port, '0.0.0.0', async () => {
  const c = await ensureChild();
  console.log('BRIDGE_READY ' + JSON.stringify({ port: config.port, package: config.package, version: config.version, serverInfo: c.serverInfo, pid: c.pid }));
});
`;
