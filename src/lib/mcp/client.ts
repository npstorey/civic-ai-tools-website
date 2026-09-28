import {
  buildMcpRegistry,
  McpConfigurationError,
  readMcpEnvFromProcess,
  resolveServerForTool,
  type McpRegistry,
  type McpServerConfig,
} from './registry.ts';
import { McpErrorEnvelope, throwIfErrorResult } from './tool-call-failure.ts';
import { errorLogFacts } from '../streaming.ts';

const MCP_TIMEOUT_MS = 45_000; // 45-second timeout for MCP server requests

// M9.1: multi-MCP routing.
//
// The website talks to more than one MCP server (Socrata + Google Data
// Commons). Tool calls route to the correct server based on tool name via
// the registry in `./registry.ts`.
//
// Session handling is intentionally flexible because the two servers use
// different dialects of the MCP spec. The spec says the `mcp-session-id`
// header is OPTIONAL: servers MAY issue one on `initialize`, and clients
// MUST echo it back on subsequent requests only when it exists.
//
// - Socrata is stateful: `initialize` returns `mcp-session-id`, every
//   `tools/call` must carry it back, and a server restart invalidates the
//   session (which we detect and re-initialize on).
// - Data Commons' hosted HTTPS endpoint at api.datacommons.org/mcp is
//   stateless: `initialize` succeeds with no session header, and tool calls
//   carry only Content-Type + Accept + the `X-API-Key` registry header.
//
// Each server's state therefore tracks both whether we've initialized and
// whether that initialization produced a session id. Tool-call header
// construction is factored into `buildMcpRequestHeaders` so it can be unit
// tested against a stateless server config without network I/O.
//
// Sprint 238 (website #537, #467; rulings D3 to D7): the client speaks both
// protocol eras. The specification's terms (`basic/versioning`, Terminology):
// a MODERN server (revision 2026-07-28 and later) takes its version, the
// client's identity and capabilities in every request's `_meta`, with no
// handshake and no session; a LEGACY server (2025-11-25 and earlier) expects
// the `initialize` handshake the client has always sent.
//
// - Era detection (D4). The first contact with an origin is `server/discover`.
//   A `DiscoverResult` (an array `supportedVersions` and an object
//   `capabilities`) means modern, and its `instructions` stand in for the ones
//   `initialize` gives. A 400 carrying `UnsupportedProtocolVersionError`
//   (-32022) means modern too: the probe is sent once more with a version from
//   its `supported` list that this client implements. Anything else means
//   legacy — another 4xx, a 5xx, a 200 that is not a `DiscoverResult` (a legacy
//   server may answer an unknown request under legacy semantics, so a 200 alone
//   says nothing), a body that does not parse. The era is cached per origin for
//   the life of the process and probed again, once, when a cached assumption
//   fails.
// - A 401 is never an era signal (D7): nothing is cached and nothing falls
//   back, and the error names authentication. It still classifies as the
//   source being unavailable (`classifyStreamError`), which is the kind a
//   record carries.
// - The legacy branch (D5) is today's exchange, plus one
//   `notifications/initialized` after `initialize` and an
//   `MCP-Protocol-Version` header with the agreed version on every later
//   request. It starts a new session once when a request that carried a
//   session id is answered 400 or 404 (#467), read from the HTTP status and
//   the JSON-RPC code, never from an error's words.
// - Nothing new reaches a record (D6). The era is an operator fact and goes to
//   the log alone.
//
// Callers see none of this: `callMcpTool` and `callMcpPrompt` resolve to a
// string or throw, and `getServerInstructions` returns text or null, whichever
// era answers (D3). Nothing outside this file reads the era.

const registry: McpRegistry = buildMcpRegistry(readMcpEnvFromProcess());

/** The modern protocol versions this client implements, most preferred first. */
const MODERN_PROTOCOL_VERSIONS: readonly string[] = ['2026-07-28'];
/**
 * The latest legacy revision (`basic/versioning`, Terminology: "`2025-11-25`
 * and earlier"). A version at or before it is spoken through `initialize`.
 */
const LAST_LEGACY_PROTOCOL_VERSION = '2025-11-25';
/** The version the legacy `initialize` asks for, unchanged (ruling D5). */
const LEGACY_INITIALIZE_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'civic-ai-tools-website', version: '1.0.0' };
const PROTOCOL_VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The JSON-RPC codes the specification reserves for itself and defines
 * (`basic/index`, Error Codes): `HeaderMismatch`, `MissingRequiredClientCapability`,
 * `UnsupportedProtocolVersion`. A 400 carrying one of them comes from a modern
 * server (`basic/transports/streamable-http`, Backward Compatibility).
 */
const MODERN_ERROR_CODES: ReadonlySet<number> = new Set([-32020, -32021, -32022]);
const UNSUPPORTED_PROTOCOL_VERSION = -32022;
const METHOD_NOT_FOUND = -32601;

type Era = { kind: 'modern'; version: string } | { kind: 'legacy' };

const eraByOrigin = new Map<string, Era>();
const probesInFlight = new Map<string, Promise<Era>>();

interface McpToolResult {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  error?: string;
}

interface ServerState {
  initialized: boolean;
  /** Session id issued by the server on `initialize`, or null if stateless. */
  sessionId: string | null;
  /**
   * Per-server `instructions` text captured from the `initialize` response's
   * `result.instructions` field (MCP spec, optional). Data Commons' hosted
   * endpoint returns a "Research Assistant" primer here that seeds the LLM
   * system prompt; Socrata returns nothing useful. Null until initialized or
   * when the server does not advertise any instructions. For a modern server
   * it is the `DiscoverResult`'s `instructions`.
   */
  instructions: string | null;
  /** Legacy: the version the server agreed in `initialize`, sent as `MCP-Protocol-Version`. */
  protocolVersion: string | null;
  /** Modern: whether this server's own `DiscoverResult` has been read. */
  discovered: boolean;
}

const serverState: Record<string, ServerState> = {};

function freshServerState(): ServerState {
  return { initialized: false, sessionId: null, instructions: null, protocolVersion: null, discovered: false };
}

function getServerState(server: McpServerConfig): ServerState {
  let state = serverState[server.sourceId];
  if (!state) {
    state = freshServerState();
    serverState[server.sourceId] = state;
  }
  return state;
}

function resetServerState(server: McpServerConfig): void {
  serverState[server.sourceId] = freshServerState();
}

function originOf(server: McpServerConfig): string {
  return new URL(server.endpointUrl).origin;
}

/** Drop an origin's cached era, and the state of every server that lives there. */
function forgetEra(server: McpServerConfig): void {
  const origin = originOf(server);
  eraByOrigin.delete(origin);
  for (const other of Object.values(registry.servers)) {
    if (originOf(other) === origin) resetServerState(other);
  }
  resetServerState(server);
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Build the merged header set for any request to an MCP server. Combines the
 * standard JSON/SSE headers, any registry-supplied per-server headers (e.g.
 * Data Commons' `X-API-Key`), and a conditional `mcp-session-id` when a
 * session id is present. Exported for unit tests — no network I/O.
 */
export function buildMcpRequestHeaders(
  server: McpServerConfig,
  sessionId: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...(server.headers || {}),
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  return headers;
}

/**
 * A header value as the Streamable HTTP binding requires it (`Value Encoding`):
 * as-is when it is plain visible ASCII with no leading or trailing whitespace,
 * and otherwise — or when it already looks like the sentinel — the Base64 of its
 * UTF-8 bytes inside `=?base64?…?=`.
 */
function headerSafe(value: string): string {
  const plain = /^[\x21-\x7E](?:[\x20-\x7E\t]*[\x21-\x7E])?$/.test(value);
  const looksEncoded = value.startsWith('=?base64?') && value.endsWith('?=');
  if (plain && !looksEncoded) return value;
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * One modern request, headers and body built from ONE version value: `_meta`
 * carries it and `MCP-Protocol-Version` repeats it, `Mcp-Method` repeats the
 * method and `Mcp-Name` the name (`basic/index`, `_meta`; `basic/transports/
 * streamable-http`, Request Metadata). No session header: this revision has no
 * sessions.
 */
function modernRequest(
  server: McpServerConfig,
  version: string,
  method: string,
  params: Record<string, unknown>,
  name?: string,
): { headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = {
    ...buildMcpRequestHeaders(server, null),
    'MCP-Protocol-Version': version,
    'Mcp-Method': method,
  };
  if (name !== undefined) headers['Mcp-Name'] = headerSafe(name);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  });
  return { headers, body };
}

/** A legacy request after `initialize`: today's headers, plus the agreed version. */
function legacyHeaders(server: McpServerConfig, state: ServerState): Record<string, string> {
  return {
    ...buildMcpRequestHeaders(server, state.sessionId),
    'MCP-Protocol-Version': state.protocolVersion ?? LEGACY_INITIALIZE_VERSION,
  };
}

interface InitializeResult {
  sessionId: string | null;
  instructions: string | null;
  protocolVersion: string;
}

/**
 * Extract the first JSON payload from an MCP response body. MCP servers may
 * return either SSE-wrapped format ("event: message\ndata: {...}\n\n") or
 * raw JSON. Returns null when no payload is recognizable.
 */
function extractMcpJsonPayload(text: string): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data:')) {
      return line.slice(5).trim();
    }
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }
  return null;
}

/** The parsed JSON-RPC message in a body, or null when there is none that parses. */
function parsedMessageOf(text: string): Record<string, unknown> | null {
  const json = extractMcpJsonPayload(text);
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The JSON-RPC `error` member of a body, or null. */
function jsonRpcErrorOf(text: string): { code: number | null; data: unknown } | null {
  const error = parsedMessageOf(text)?.error;
  if (error === null || typeof error !== 'object') return null;
  const { code, data } = error as { code?: unknown; data?: unknown };
  return { code: typeof code === 'number' ? code : null, data };
}

async function bodyTextOf(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

// --- What an HTTP failure was, read by status and code ------------------------
//
// The errors thrown on an HTTP failure keep today's classes and messages (D6).
// What the retry decisions read — the status, the JSON-RPC code, whether the
// request carried a session id — is kept beside the error rather than on it,
// so nothing a caller or a log can see about the error changes.

interface HttpFailure {
  phase: 'initialize' | 'request';
  status: number;
  code: number | null;
  sessionCarried: boolean;
}

const httpFailures = new WeakMap<object, HttpFailure>();

function withHttpFailure<E extends Error>(error: E, failure: HttpFailure): E {
  httpFailures.set(error, failure);
  return error;
}

function httpFailureOf(error: unknown): HttpFailure | undefined {
  return error !== null && typeof error === 'object' ? httpFailures.get(error) : undefined;
}

/** A body a modern server answers with: one of its own error codes on a 400, or "method not found" on a 404. */
function isRecognizedModernError(failure: HttpFailure): boolean {
  if (failure.status === 400) return failure.code !== null && MODERN_ERROR_CODES.has(failure.code);
  if (failure.status === 404) return failure.code === METHOD_NOT_FOUND;
  return false;
}

/** The status codes whose body the client reads before it decides anything. */
function statusWorthReading(status: number): boolean {
  return status === 400 || status === 404 || status === 405;
}

function authenticationError(server: McpServerConfig): Error {
  return new Error(`MCP server "${server.sourceId}" requires authentication (401); no protocol era was assumed for it.`);
}

// --- Era detection -------------------------------------------------------------

function isLegacyVersion(version: unknown): boolean {
  return typeof version === 'string' && PROTOCOL_VERSION_SHAPE.test(version) && version <= LAST_LEGACY_PROTOCOL_VERSION;
}

/**
 * The era a list of versions the server supports leads to: the first modern
 * version this client implements, else legacy when the list names a legacy
 * revision (the client speaks those through `initialize`), else nothing.
 */
function eraFromSupported(supported: unknown): Era | null {
  if (!Array.isArray(supported)) return null;
  const modern = MODERN_PROTOCOL_VERSIONS.find((v) => supported.includes(v));
  if (modern) return { kind: 'modern', version: modern };
  if (supported.some(isLegacyVersion)) return { kind: 'legacy' };
  return null;
}

function isDiscoverResult(result: unknown): result is { supportedVersions: unknown[]; capabilities: object; instructions?: unknown } {
  if (result === null || typeof result !== 'object') return false;
  const { supportedVersions, capabilities } = result as { supportedVersions?: unknown; capabilities?: unknown };
  return Array.isArray(supportedVersions) && capabilities !== null && typeof capabilities === 'object' && !Array.isArray(capabilities);
}

function instructionsOf(result: { instructions?: unknown }): string | null {
  return typeof result.instructions === 'string' && result.instructions.length > 0 ? result.instructions : null;
}

/** POST `server/discover` at one version. A timeout reads as `initialize`'s always has. */
async function postDiscover(server: McpServerConfig, version: string): Promise<{ status: number; ok: boolean; text: string }> {
  const { headers, body } = modernRequest(server, version, 'server/discover', {});
  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(server.endpointUrl, { method: 'POST', headers, signal, body });
  } catch (error) {
    clear();
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`MCP server "${server.sourceId}" did not respond within ${MCP_TIMEOUT_MS / 1000}s — the upstream server may be starting up or unresponsive. Please try again.`);
    }
    throw error;
  } finally {
    clear();
  }
  // A 401 is answered before the body matters, and its body is not read.
  const text = response.status === 401 ? '' : await bodyTextOf(response);
  return { status: response.status, ok: response.ok, text };
}

/**
 * Probe one server with `server/discover` and read its era (ruling D4). Throws
 * on a 401 (D7), on a network failure or a timeout (as `initialize` did before
 * the probe existed), and when a modern server supports no version this client
 * implements; in each of those cases nothing is cached.
 */
async function probeEra(server: McpServerConfig): Promise<{ era: Era; instructions: string | null }> {
  const legacy = { era: { kind: 'legacy' } as Era, instructions: null };
  let version = MODERN_PROTOCOL_VERSIONS[0];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await postDiscover(server, version);
    if (answer.status === 401) throw authenticationError(server);
    if (answer.ok) {
      const result = parsedMessageOf(answer.text)?.result;
      if (!isDiscoverResult(result)) return legacy;
      const era = eraFromSupported(result.supportedVersions);
      if (!era) throw new Error(`MCP server "${server.sourceId}" supports no protocol version this client implements.`);
      return { era, instructions: era.kind === 'modern' ? instructionsOf(result) : null };
    }
    const error = answer.status === 400 ? jsonRpcErrorOf(answer.text) : null;
    if (error?.code !== UNSUPPORTED_PROTOCOL_VERSION) return legacy;
    // A modern server, refusing this version: retry once with one it names.
    const era = attempt === 0 ? eraFromSupported((error.data as { supported?: unknown } | null)?.supported) : null;
    if (era?.kind === 'legacy') return legacy;
    if (!era) break;
    version = era.version;
  }
  throw new Error(`MCP server "${server.sourceId}" supports no protocol version this client implements.`);
}

/**
 * The era of a server's origin: cached, or probed once (concurrent first
 * contacts share one probe). A modern probe's `instructions` belong to the
 * server it was sent to.
 */
async function eraFor(server: McpServerConfig): Promise<Era> {
  const origin = originOf(server);
  const cached = eraByOrigin.get(origin);
  if (cached) return cached;
  let probe = probesInFlight.get(origin);
  if (!probe) {
    probe = (async () => {
      const { era, instructions } = await probeEra(server);
      eraByOrigin.set(origin, era);
      if (era.kind === 'modern') {
        const state = getServerState(server);
        state.instructions = instructions;
        state.discovered = true;
      }
      console.log(`[MCP:${server.sourceId}] Protocol era: ${era.kind === 'modern' ? `modern (${era.version})` : 'legacy (initialize)'}`);
      return era;
    })().finally(() => probesInFlight.delete(origin));
    probesInFlight.set(origin, probe);
  }
  return probe;
}

/**
 * Modern: read this server's own `DiscoverResult` for its `instructions`, when
 * the era was learned from another server on the same origin.
 */
async function ensureDiscovered(server: McpServerConfig, version: string): Promise<void> {
  const state = getServerState(server);
  if (state.discovered) return;
  const answer = await postDiscover(server, version);
  if (answer.status === 401) throw authenticationError(server);
  const result = answer.ok ? parsedMessageOf(answer.text)?.result : undefined;
  if (!isDiscoverResult(result)) {
    throw new Error(`MCP server "${server.sourceId}" error: ${answer.status}`);
  }
  state.instructions = instructionsOf(result);
  state.discovered = true;
}

// --- The legacy handshake ------------------------------------------------------

/**
 * POST `initialize` to a server and return both the session id it issued
 * (may be null for stateless servers) and any `result.instructions` text the
 * server advertised (MCP spec, optional). Either outcome is a successful
 * initialization; the caller flips `state.initialized = true` on return.
 */
async function initializeSession(server: McpServerConfig): Promise<InitializeResult> {
  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: buildMcpRequestHeaders(server, null),
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'initialize',
        params: {
          protocolVersion: LEGACY_INITIALIZE_VERSION,
          capabilities: {},
          clientInfo: {
            name: 'civic-ai-tools-website',
            version: '1.0.0',
          },
        },
      }),
    });
  } catch (error) {
    clear();
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`MCP server "${server.sourceId}" did not respond within ${MCP_TIMEOUT_MS / 1000}s — the upstream server may be starting up or unresponsive. Please try again.`);
    }
    throw error;
  } finally {
    clear();
  }

  if (!response.ok) {
    const code = statusWorthReading(response.status) ? jsonRpcErrorOf(await bodyTextOf(response))?.code ?? null : null;
    throw withHttpFailure(
      new Error(`MCP initialization failed for "${server.sourceId}": ${response.status}`),
      { phase: 'initialize', status: response.status, code, sessionCarried: false },
    );
  }

  // Session id header is optional per the MCP spec — stateless servers omit it.
  const sessionId = response.headers.get('mcp-session-id');

  // Parse the body for a `result.instructions` field. MCP servers that ship
  // a pre-canned LLM primer advertise it here; others omit it. Parse failures
  // are tolerated silently — initialization itself is still successful.
  // The same body names the version the server agreed (`result.protocolVersion`);
  // when it cannot be read, the version asked for stands in for it.
  let instructions: string | null = null;
  let protocolVersion = LEGACY_INITIALIZE_VERSION;
  try {
    const text = await response.text();
    const jsonData = extractMcpJsonPayload(text);
    if (jsonData) {
      const parsed = JSON.parse(jsonData);
      const agreed = parsed?.result?.protocolVersion;
      if (typeof agreed === 'string' && PROTOCOL_VERSION_SHAPE.test(agreed)) {
        protocolVersion = agreed;
      }
      const rawInstructions = parsed?.result?.instructions;
      if (typeof rawInstructions === 'string' && rawInstructions.length > 0) {
        instructions = rawInstructions;
        console.log(
          `[MCP:${server.sourceId}] Captured server instructions (${rawInstructions.length} chars) from initialize response`,
        );
      }
    }
  } catch (error) {
    console.warn(
      `[MCP:${server.sourceId}] Could not parse initialize response body for instructions:`,
      errorLogFacts(error),
    );
  }

  await sendInitializedNotification(server, sessionId, protocolVersion);
  return { sessionId, instructions, protocolVersion };
}

/**
 * The legacy lifecycle's `notifications/initialized` (2025-11-25
 * `basic/lifecycle`, Initialization: "the client MUST send an `initialized`
 * notification"). A notification has no `id`, and a server that accepts it
 * answers 202 with no body. One the server does not accept is logged by its
 * status and does not fail the handshake: the next request says whether the
 * session works.
 */
async function sendInitializedNotification(
  server: McpServerConfig,
  sessionId: string | null,
  protocolVersion: string,
): Promise<void> {
  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  try {
    const response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: { ...buildMcpRequestHeaders(server, sessionId), 'MCP-Protocol-Version': protocolVersion },
      signal,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) {
      console.warn(`[MCP:${server.sourceId}] The initialized notification was not accepted:`, response.status);
    }
  } catch (error) {
    console.warn(`[MCP:${server.sourceId}] Could not send the initialized notification:`, errorLogFacts(error));
  } finally {
    clear();
  }
}

/**
 * Ensure a server has been initialized. Returns the session id issued during
 * initialization, which may be `null` for stateless servers. Only triggers a
 * real `initialize` call the first time (or after `resetServerState` on a
 * session-expired retry). Also caches any `instructions` text the server
 * advertised so the skill-composition layer can read it without a second call.
 */
async function ensureInitialized(server: McpServerConfig): Promise<string | null> {
  const state = getServerState(server);
  if (!state.initialized) {
    const { sessionId, instructions, protocolVersion } = await initializeSession(server);
    state.sessionId = sessionId;
    state.instructions = instructions;
    state.protocolVersion = protocolVersion;
    state.initialized = true;
  }
  return state.sessionId;
}

/**
 * Fetch the per-server `instructions` text captured during initialize, if
 * the server advertised any. Initializes the server lazily if it hasn't been
 * touched yet. Returns null when the server did not advertise instructions
 * or initialization failed — callers should treat an empty result as a
 * soft failure and compose the skill prompt without the server's text. For a
 * modern server the text is its `DiscoverResult`'s `instructions`.
 */
export async function getServerInstructions(sourceId: string): Promise<string | null> {
  const server = registry.servers[sourceId];
  if (!server) return null;
  try {
    const era = await eraFor(server);
    if (era.kind === 'legacy') {
      await ensureInitialized(server);
    } else {
      await ensureDiscovered(server, era.version);
    }
  } catch (error) {
    console.warn(
      `[MCP:${sourceId}] Could not initialize for instructions fetch:`,
      errorLogFacts(error),
    );
    return null;
  }
  return getServerState(server).instructions;
}

/**
 * Look up the server hosting this tool and return it, throwing a clear error
 * if no server claims the tool. A tool whose server is known but
 * unconfigured (#258 C4: `SOCRATA_MCP_URL` unset — no coded fallback host)
 * throws a typed `McpConfigurationError` naming the variable, as a backstop
 * behind the routes' own up-front guards. Exported for tests.
 */
export function routeTool(toolName: string): McpServerConfig {
  const server = resolveServerForTool(registry, toolName);
  if (!server) {
    const missingVar = registry.unconfiguredTools[toolName];
    if (missingVar) {
      throw new McpConfigurationError(
        `The MCP server for tool "${toolName}" is not configured: ${missingVar} is missing or empty in the server environment. Set it and restart the server.`,
      );
    }
    throw new Error(`No MCP server registered for tool "${toolName}"`);
  }
  return server;
}

/**
 * Run one exchange in the server's era, with the two recoveries the rulings
 * allow and nothing else:
 *
 * - Legacy (#467): a request that carried a session id and was answered 404,
 *   or 400 with no modern error code in its body, means the session is gone
 *   (2025-11-25 `basic/transports`, Session Management: a client that gets a
 *   404 for a request carrying a session id MUST start a new session). The
 *   client starts a new one and sends the request once more. A JSON-RPC error
 *   in a 200 body is the source answering, and is never retried.
 * - Either era: when the cached era stops holding — a modern request answered
 *   400, 404 or 405 without a modern error body, or with
 *   `UnsupportedProtocolVersionError`; a legacy `initialize` or request
 *   answered 400 with a code only a modern server emits — the origin is probed
 *   again, once, and the request sent in whatever era that finds.
 */
async function inEra<T>(server: McpServerConfig, send: (era: Era) => Promise<T>): Promise<T> {
  let sessionRestarted = false;
  let reprobed = false;
  for (;;) {
    const era = await eraFor(server);
    try {
      if (era.kind === 'legacy') await ensureInitialized(server);
      return await send(era);
    } catch (error) {
      const failure = httpFailureOf(error);
      if (!failure) throw error;
      if (
        era.kind === 'legacy' &&
        !sessionRestarted &&
        failure.phase === 'request' &&
        failure.sessionCarried &&
        (failure.status === 404 || (failure.status === 400 && !isRecognizedModernError(failure)))
      ) {
        sessionRestarted = true;
        console.log(`[MCP:${server.sourceId}] Session rejected, reinitializing...`);
        resetServerState(server);
        continue;
      }
      const assumptionFailed = era.kind === 'modern'
        ? failure.phase === 'request' &&
          statusWorthReading(failure.status) &&
          (!isRecognizedModernError(failure) || failure.code === UNSUPPORTED_PROTOCOL_VERSION)
        : failure.status === 400 && isRecognizedModernError(failure);
      if (assumptionFailed && !reprobed) {
        reprobed = true;
        console.log(`[MCP:${server.sourceId}] The cached protocol era did not hold; probing again`);
        forgetEra(server);
        continue;
      }
      throw error;
    }
  }
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const server = routeTool(name);
  return inEra(server, (era) => makeToolCall(server, name, args, era));
}

async function makeToolCall(
  server: McpServerConfig,
  name: string,
  args: Record<string, unknown>,
  era: Era,
): Promise<string> {
  // #503: the source and the tool name are operator facts; the ARGUMENTS are
  // the reader's question in other words — for a search tool they ARE the
  // question — so they are not written to the log. This line pairs with the
  // response line below, which reports the status, the byte count and how
  // long the call took. Between them an operator has which source, which
  // tool, whether it answered, how much it returned and how slow it was, and
  // none of what was asked or what came back.
  console.log(`[MCP:${server.sourceId}] Calling tool: ${name}`);
  const startedAt = Date.now();

  const state = getServerState(server);
  const request = era.kind === 'modern'
    ? modernRequest(server, era.version, 'tools/call', { name, arguments: args }, name)
    : {
        headers: legacyHeaders(server, state),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      };
  const sessionCarried = era.kind === 'legacy' && state.sessionId !== null;

  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: request.headers,
      signal,
      body: request.body,
    });
  } catch (error) {
    clear();
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`MCP tool call "${name}" timed out after ${MCP_TIMEOUT_MS / 1000}s — the data source may be slow or unresponsive. Try a simpler query.`);
    }
    throw error;
  } finally {
    clear();
  }

  if (!response.ok) {
    // The status, not the reason phrase: `statusText` is text the source
    // chose (#503 WF).
    console.error(`[MCP:${server.sourceId}] Server error:`, response.status);
    if (era.kind === 'modern' && response.status === 401) throw authenticationError(server);
    const code = statusWorthReading(response.status) ? jsonRpcErrorOf(await bodyTextOf(response))?.code ?? null : null;
    throw withHttpFailure(
      new Error(`MCP server "${server.sourceId}" error: ${response.status} ${response.statusText}`),
      { phase: 'request', status: response.status, code, sessionCarried },
    );
  }

  const text = await response.text();
  console.log(
    `[MCP:${server.sourceId}] Tool ${name}: ${response.status}, ${text.length} bytes in ${Date.now() - startedAt}ms`,
  );

  // Parse SSE response format: "event: message\ndata: {...}\n\n"
  const lines = text.split('\n');
  let jsonData = '';

  for (const line of lines) {
    if (line.startsWith('data:')) {
      jsonData = line.slice(5).trim();
      break;
    }
  }

  if (!jsonData) {
    // Try parsing the whole response as JSON (in case it's not SSE format)
    try {
      const parsed = JSON.parse(text);
      if (parsed.result) {
        if (era.kind === 'modern') throwIfNotComplete(parsed.result);
        // #429: a result carrying `isError: true` is the source refusing the
        // call, not an answer. Thrown here and recorded by the loop's catch
        // site as a rejected call, by its structure (`tool-call-failure.ts`).
        throwIfErrorResult(parsed.result);
        return formatMcpResult(parsed.result);
      }
      if (parsed.error) {
        throw new McpErrorEnvelope(parsed.error.message || 'MCP tool error');
      }
      throw new Error('Unexpected MCP response format');
    } catch (e) {
      if (e instanceof Error && e.message !== 'Unexpected MCP response format') {
        throw e;
      }
      throw new Error('Failed to parse MCP response');
    }
  }

  const parsed = parseSsePayload(jsonData);
  if (parsed.result) {
    if (era.kind === 'modern') throwIfNotComplete(parsed.result);
    throwIfErrorResult(parsed.result);
    return formatMcpResult(parsed.result);
  }
  if (parsed.error) {
    throw new McpErrorEnvelope(parsed.error.message || 'MCP tool error');
  }
  return JSON.stringify(parsed);
}

/**
 * A modern result is final only when its `resultType` is absent or
 * `"complete"` (`basic/index`, ResultType: an absent `resultType` is
 * `"complete"`, and any value the client does not recognize is invalid). This
 * client implements no multi-round-trip request, so `"input_required"` is one
 * it cannot finish. The message names no value the source chose.
 */
function throwIfNotComplete(result: unknown): void {
  if (result === null || typeof result !== 'object' || !('resultType' in result)) return;
  if ((result as { resultType?: unknown }).resultType === 'complete') return;
  throw new Error('Unexpected MCP result type');
}

/**
 * The payload of an SSE `data:` line — or the parse failure, and only for a
 * body that does not parse (Wave N11 ruling R2).
 *
 * The SSE branch used to hold the parse AND the reading of the payload in one
 * `try`, with a `catch` that replaced every error whose message contained
 * "parse" by the parse failure. So a source that refused a call in words
 * containing "parse" was recorded as a response this client could not read,
 * and the refusal it had thrown one line earlier was lost. It never did the one
 * thing it was for, either: V8's `JSON.parse` messages ("Unexpected token …",
 * "Unexpected end of JSON input") do not contain the word, so a body that
 * really did not parse came through as the raw `SyntaxError`. The errors the
 * branch throws — the source's refusal, in either shape — are now outside the
 * `try`, and pass through as they were thrown.
 */
function parseSsePayload(jsonData: string) {
  try {
    return JSON.parse(jsonData);
  } catch {
    throw new Error('Failed to parse MCP response JSON');
  }
}

interface McpPromptResult {
  messages?: Array<{
    role: string;
    content: { type: string; text?: string } | Array<{ type: string; text?: string }>;
  }>;
}

/**
 * Prompt fetches are still Socrata-only today: skill guidance is served from
 * the Socrata MCP server's `prompts/get` endpoint. Route explicitly so the
 * intent is obvious when a second prompt source shows up later.
 */
export async function callMcpPrompt(name: string, args: Record<string, string>): Promise<string> {
  const server = registry.servers['socrata'];
  if (!server) {
    // #258 C4: no coded fallback host. The skill layer treats this as a soft
    // failure (composes from the local fallback text); the message still
    // names the variable for the operator's logs.
    throw new McpConfigurationError(
      'The Socrata MCP server is not configured: SOCRATA_MCP_URL is missing or empty in the server environment; cannot fetch skill prompt.',
    );
  }
  return inEra(server, (era) => makePromptCall(server, name, args, era));
}

async function makePromptCall(
  server: McpServerConfig,
  name: string,
  args: Record<string, string>,
  era: Era,
): Promise<string> {
  // #503, as for a tool call above: the prompt name is an operator fact, its
  // arguments are not logged.
  console.log(`[MCP:${server.sourceId}] Getting prompt: ${name}`);
  const startedAt = Date.now();

  const state = getServerState(server);
  const request = era.kind === 'modern'
    ? modernRequest(server, era.version, 'prompts/get', { name, arguments: args }, name)
    : {
        headers: legacyHeaders(server, state),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'prompts/get',
          params: { name, arguments: args },
        }),
      };
  const sessionCarried = era.kind === 'legacy' && state.sessionId !== null;

  const response = await fetch(server.endpointUrl, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(10_000), // 10s timeout for cold starts
  });

  if (!response.ok) {
    if (era.kind === 'modern' && response.status === 401) throw authenticationError(server);
    const code = statusWorthReading(response.status) ? jsonRpcErrorOf(await bodyTextOf(response))?.code ?? null : null;
    throw withHttpFailure(
      new Error(`MCP prompt error: ${response.status} ${response.statusText}`),
      { phase: 'request', status: response.status, code, sessionCarried },
    );
  }

  const text = await response.text();
  console.log(
    `[MCP:${server.sourceId}] Prompt ${name}: ${response.status}, ${text.length} bytes in ${Date.now() - startedAt}ms`,
  );

  // Parse SSE response format
  const lines = text.split('\n');
  let jsonData = '';

  for (const line of lines) {
    if (line.startsWith('data:')) {
      jsonData = line.slice(5).trim();
      break;
    }
  }

  if (!jsonData) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.result) {
        if (era.kind === 'modern') throwIfNotComplete(parsed.result);
        return formatPromptResult(parsed.result);
      }
      if (parsed.error) {
        throw new Error(parsed.error.message || 'MCP prompt error');
      }
    } catch (e) {
      if (e instanceof Error && !e.message.includes('parse') && !e.message.includes('Unexpected')) {
        throw e;
      }
    }
    throw new Error('Failed to parse MCP prompt response');
  }

  const parsed = JSON.parse(jsonData);
  if (parsed.result) {
    if (era.kind === 'modern') throwIfNotComplete(parsed.result);
    return formatPromptResult(parsed.result);
  }
  if (parsed.error) {
    throw new Error(parsed.error.message || 'MCP prompt error');
  }
  throw new Error('Unexpected MCP prompt response format');
}

function formatPromptResult(result: McpPromptResult): string {
  if (!result.messages || !Array.isArray(result.messages)) {
    throw new Error('MCP prompt returned no messages');
  }

  return result.messages
    .map(msg => {
      const content = msg.content;
      if (Array.isArray(content)) {
        return content
          .filter(item => item.type === 'text' && item.text)
          .map(item => item.text)
          .join('\n');
      }
      if (typeof content === 'object' && content.type === 'text' && content.text) {
        return content.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function formatMcpResult(result: McpToolResult): string {
  // #503: the result IS the reader's data. Its size is the operator fact.
  console.log(`[MCP] Formatting result: ${JSON.stringify(result).length} bytes`);
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content
      .filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join('\n');
    const formatted = textContent || JSON.stringify(result);
    console.log(`[MCP] Formatted output: ${formatted.length} bytes`);
    return formatted;
  }
  return JSON.stringify(result);
}
