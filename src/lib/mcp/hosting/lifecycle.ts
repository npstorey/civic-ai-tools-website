/**
 * The lifecycle of a hosted source's sandbox (#617 P3, ruling D1): one named,
 * persistent Vercel Sandbox per source and pinned version, created on first
 * use, stopped by its own idle timeout, and resumed by the next call.
 *
 * WHAT A CALL DOES. `wakeHostedSource` asks for the sandbox by its name with
 * `Sandbox.getOrCreate({ resume: true, … })`, under a deadline of its own:
 *   - absent: it is created (1 vCPU, one exposed port, the idle window as its
 *     timeout, the bridge token in its environment), and `onCreate` installs
 *     the pinned package and the bridge with `npm ci` from committed lockfiles
 *     (so every sandbox of one pin runs one tree) while the package registry
 *     is the only host it may reach, applies the manifest's outbound list (`[]`: none, so
 *     `deny-all`), starts the bridge and waits for its ready line;
 *   - stopped: the platform resumes it from its automatic snapshot, and
 *     `onResume` starts the bridge and waits for its ready line;
 *   - running: the bridge is checked once per session with `/health`.
 * Then the exchange runs (`./address.ts`), and the idle window restarts only
 * once the call has met a live bridge — the exchange answered, or it failed
 * and `/health` answered: `extendTimeout` ADDS to the session's timeout
 * (`@vercel/sandbox` 3.x; #617 correction n), so the session is extended only
 * by what it lacks of one window, never past it. A source left idle stops by
 * itself after one window and writes one snapshot
 * (`keepLastSnapshots: { count: 1 }`).
 *
 * A BRIDGE THAT DIES INSIDE A SESSION (R7 WF, G7 F1). A session this process
 * has seen ready is not re-checked before its calls, so a bridge that has
 * died since is found by the exchange failing. Then `checkBridge` asks
 * `/health` once; if the bridge does not answer it is started again, once
 * (the same `startBridge` a resume runs), and the call is retried once. The
 * bridge binds its port before it prints its ready line, and a second process
 * on a bound port exits, so a restart never runs two bridges on one port; a
 * restart that loses that race finds the winner by `/health`. Nothing here
 * deletes a sandbox on this path. When the bridge cannot be brought back the
 * call fails as the source being unavailable and the idle window is NOT
 * restarted, so the session stops by itself and the next call resumes it.
 *
 * THE DEADLINE. The wake is bounded here, before any MCP exchange starts; the
 * client's 45 s exchange deadline is created inside each exchange, after the
 * wake (#617 G0 §3 fact 3). A wake that misses its deadline fails the call as
 * the source being unavailable. Its work is not cancelled: the SDK call and
 * any `onCreate` install keep running in this process while the process
 * lives, and nothing else waits for them. Whether it completes is not
 * measured, locally or on a Vercel Function; on a Function nothing extends
 * the instance's life for it (no `waitUntil`). Meanwhile another
 * process's call finds the sandbox `running` with no bridge ready, polls
 * `/health` until its own deadline and fails unavailable; an install that
 * never finished leaves no marker, and the next resume deletes that sandbox by
 * name and the call after creates it afresh.
 *
 * THE ALLOWLIST. The outbound policy is a property applied when the sandbox
 * is created (and kept across resumes). It filters what STARTS: a process
 * already running keeps a connection it already holds. So revoking a running
 * source's reach means stopping its sandbox, not changing its policy
 * (CLAUDE.md, "A sandbox network policy filters what starts").
 *
 * THE NAME. `civic-src-`, the deployment environment, the alias and the
 * pinned version (`hostedSandboxName`), so a pin move creates a new sandbox
 * and the old one is left to the pin-move's owner step or to expire. The
 * environment is in the name because a project's preview and production
 * deployments share one sandbox scope and hold different secrets: one name
 * for both would leave whichever came second refused by the other's token.
 * The name is an operator fact
 * for the log (ruling D8): no record carries it. The sandbox scope is shared
 * with the notebook executor (`nbexec-`), and this module touches only the one
 * name it derives.
 *
 * The SDK is loaded here and nowhere on the path of an instance whose switch is
 * unset: `client.ts` imports this module only for a hosted call.
 */
import { Sandbox } from '@vercel/sandbox';
import type { HostedMcpServer } from '../registry.ts';
import type { SourceHosting } from '@typedstandards/civic-typed-router';
import { proxyAwareSandboxFetch, resolveSandboxAuthParams } from '../../sandbox/vercel-sandbox.ts';
import { errorLogFacts } from '../../streaming.ts';
import { BRIDGE_PACKAGE_JSON, BRIDGE_READY_LINE, BRIDGE_SOURCE, bridgeConfig } from './bridge-source.ts';
import { bridgeToken } from './token.ts';
import { pinLockfileKey, pinPackageJson, type NpmLockfile } from './install-manifests.ts';
import { BRIDGE_LOCKFILE, PIN_LOCKFILES } from './lockfiles.generated.ts';
import { hostingEnvironment } from '../../hosting-environment.ts';

/** The prefix of every hosted source's sandbox name. */
export const HOSTED_SANDBOX_NAME_PREFIX = 'civic-src-';
/** The port the bridge listens on, the one port the sandbox exposes. */
export const HOSTED_SOURCE_PORT = 8080;
/** How long a source stays up after its last call before it stops itself. */
export const DEFAULT_IDLE_WINDOW_MS = 10 * 60_000;
/**
 * The wake's own deadline. A first creation installs the pin and the bridge
 * (measured in #617 P3); a resume took 1.8-2.9 s in #617 P1. The loop bounds a
 * whole tool call at 45 s, wake included, so this leaves the exchange room.
 */
export const DEFAULT_WAKE_DEADLINE_MS = 30_000;
/** The hosts a sandbox may reach while `onCreate` installs: the npm registry. */
export const PACKAGE_REGISTRY_HOSTS: readonly string[] = ['registry.npmjs.org'];
/** Snapshots expire 30 days after last use, the platform default, stated. */
const SNAPSHOT_EXPIRATION_MS = 30 * 24 * 60 * 60_000;
/** Below this, a missing piece of the idle window is not worth an API call. */
const EXTEND_SLACK_MS = 60_000;
/** How long `checkBridge` waits for one `/health` answer. */
export const BRIDGE_PROBE_MS = 5_000;
/** How long a restart of a dead bridge may take to print its ready line. */
export const BRIDGE_RESTART_DEADLINE_MS = 15_000;

const HOME = '/vercel/civic-source';
const PIN_DIR = `${HOME}/pin`;
const BRIDGE_DIR = `${HOME}/bridge`;
const INSTALLED_MARKER = `${HOME}/installed.json`;
/** The variable the bridge reads its token from, set on the sandbox at creation. */
export const BRIDGE_TOKEN_VARIABLE = 'SOURCE_BRIDGE_TOKEN';

/**
 * The fixed failure of a hosted call that could not reach its source. It
 * carries its kind (`classifyStreamError` reads `code` before any message), so
 * the loop records `unavailable`, the model is told the source is unavailable,
 * and the reader is told the source could not be reached. Its message is fixed
 * and names no sandbox, address or token; the operator's facts go to the log.
 */
export class HostedSourceUnavailableError extends Error {
  readonly code = 'mcp_unavailable' as const;

  constructor(sourceId: string) {
    super(`The hosted MCP server "${sourceId}" is unavailable: its sandbox could not be reached.`);
    this.name = 'HostedSourceUnavailableError';
  }
}

/**
 * The deployment environment a sandbox name carries: `VERCEL_ENV` (set by the
 * platform: `production`, `preview` or `development`), or `local` off it. It
 * lives in a leaf module (`src/lib/hosting-environment.ts`, R6 W5) so the usage
 * counter can read it without loading this module and the sandbox SDK.
 */
export { hostingEnvironment };

/**
 * The sandbox name for a source at a pinned version: the prefix, the
 * environment and `-`, the alias, `__`, then the version with each `.`
 * written as `_`. The name rules are
 * `^[a-zA-Z0-9_-]+$`, 1-128 characters (measured on 3.5.1, #617 P1). An alias
 * never holds `__` (ADR-0032) and a semver version never holds `_`, so the
 * encoding is one-to-one; a version holding any other character outside the
 * rules (build metadata's `+`) is refused rather than folded into a name
 * another pin could share.
 */
export function hostedSandboxName(alias: string, version: string, environment: string = hostingEnvironment()): string {
  const encoded = version.replace(/\./g, '_');
  const name = `${HOSTED_SANDBOX_NAME_PREFIX}${environment}-${alias}__${encoded}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || name.length > 128) {
    throw new Error(`hostedSandboxName: "${alias}" at "${version}" does not encode to a sandbox name`);
  }
  return name;
}

export interface WakeOptions {
  /** The instance secret the token derives from. */
  secret: string;
  idleWindowMs?: number;
  deadlineMs?: number;
}

export interface WokenSource {
  /** The bridge's MCP endpoint for this call: the handle's `domain(port)` plus `/mcp`. */
  endpointUrl: string;
  /** The bridge token, for the `Authorization` header. Never logged. */
  token: string;
  sandboxName: string;
  /** What this call found: created, resumed, or already running. */
  wake: 'created' | 'resumed' | 'running';
  /** Restart the idle window. Called once the call has met a live bridge. */
  keepAlive(): Promise<void>;
  /**
   * After a failed exchange: is the bridge alive? `alive` (it answered
   * `/health`, so the failure is the source's own and nothing is restarted),
   * `recovered` (it did not, and one restart brought a bridge up: retry once),
   * or `dead`. At most one restart per call of this function.
   */
  checkBridge(): Promise<BridgeState>;
}

/** What `checkBridge` found. */
export type BridgeState = 'alive' | 'recovered' | 'dead';

type Handle = Awaited<ReturnType<typeof Sandbox.getOrCreate>>;

/** Sessions whose bridge this process has seen ready, by session id. */
const readySessions = new Set<string>();
/** One wake per sandbox name at a time in this process: concurrent first calls share it. */
const wakesInFlight = new Map<string, Promise<{ handle: Handle; wake: WokenSource['wake'] }>>();

function log(sourceId: string, message: string): void {
  console.log(`[hosting:${sourceId}] ${message}`);
}

/** A step of the wake that failed, in words this module chose: safe for the log. */
class WakeStepError extends Error {}

/** What the log may say about a wake failure: this module's own words, or the
 *  error's class, HTTP status and the platform's error code — never a message
 *  the platform wrote, which could carry anything. */
function wakeFacts(error: unknown): string {
  if (error instanceof WakeStepError) return error.message;
  const code = (error as { json?: { error?: { code?: unknown } } } | null)?.json?.error?.code;
  return JSON.stringify({ ...errorLogFacts(error), ...(typeof code === 'string' ? { code } : {}) });
}

async function run(sandbox: Handle, cmd: string, args: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
  const result = await sandbox.runCommand({ cmd, args, cwd });
  return { exitCode: result.exitCode, output: `${await result.stdout()}${await result.stderr()}` };
}

/** A sandbox whose `onCreate` never finished: no marker, so nothing to start. */
class IncompleteInstallError extends WakeStepError {
  constructor() {
    super('the sandbox holds no completed install');
  }
}

/** Start the bridge detached and wait for its ready line, under `ms`. */
async function startBridge(sandbox: Handle, source: HostedMcpServer, ms: number): Promise<void> {
  const marker = await run(sandbox, 'test', ['-f', INSTALLED_MARKER], '/');
  if (marker.exitCode !== 0) throw new IncompleteInstallError();
  const command = await sandbox.runCommand({ cmd: 'node', args: [`${BRIDGE_DIR}/bridge.mjs`], cwd: BRIDGE_DIR, detached: true });
  const signal = AbortSignal.timeout(ms);
  for await (const line of command.logs({ signal })) {
    if (line.stream === 'stdout' && line.data.includes(BRIDGE_READY_LINE)) {
      log(source.sourceId, `bridge ready (${line.data.slice(BRIDGE_READY_LINE.length).trim().slice(0, 300)})`);
      return;
    }
    if (line.data.includes('BRIDGE_REFUSED')) throw new WakeStepError(`the bridge refused to start: ${line.data.trim().slice(0, 200)}`);
  }
  throw new WakeStepError('the bridge exited before it was ready');
}

/** One directory the install step fills: the files written into it, then
 *  the npm command run in it (`npm <npmArgs>`). */
export interface HostedInstallDir {
  dir: string;
  files: Array<{ path: string; content: string }>;
  npmArgs: string[];
}

/**
 * The install command, in both directories: `npm ci` installs exactly the
 * lockfile written beside the `package.json`, or fails when the two disagree,
 * so every sandbox of one pin runs the same tree (#617 P4, criterion L).
 * `--ignore-scripts`: no package's install script runs.
 */
export const HOSTED_NPM_ARGS: readonly string[] = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];

/** A lockfile as `npm ci` reads it. */
function lockfileText(lock: NpmLockfile): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/**
 * What `onCreate` writes and runs to install a source's pin and the bridge,
 * one entry per directory, in the order they are installed: each gets its
 * `package.json` and the committed lockfile for it (`lockfiles.generated.ts`,
 * from `scripts/generate-hosted-lockfiles.ts`). A pin with no committed
 * lockfile throws: the instance never falls back to resolving a tree.
 */
export function hostedInstallPlan(hosting: SourceHosting): HostedInstallDir[] {
  const pinLock = PIN_LOCKFILES[pinLockfileKey(hosting)];
  if (!pinLock) {
    throw new Error(`no committed lockfile for ${pinLockfileKey(hosting)}: run scripts/generate-hosted-lockfiles.ts`);
  }
  const npmArgs = [...HOSTED_NPM_ARGS];
  return [
    {
      dir: PIN_DIR,
      files: [
        { path: `${PIN_DIR}/package.json`, content: pinPackageJson(hosting) },
        { path: `${PIN_DIR}/package-lock.json`, content: lockfileText(pinLock) },
      ],
      npmArgs,
    },
    {
      dir: BRIDGE_DIR,
      files: [
        { path: `${BRIDGE_DIR}/package.json`, content: BRIDGE_PACKAGE_JSON },
        { path: `${BRIDGE_DIR}/package-lock.json`, content: lockfileText(BRIDGE_LOCKFILE) },
      ],
      npmArgs,
    },
  ];
}

/** `onCreate`: install the pin and the bridge, close the network, start the bridge. */
async function installAndStart(sandbox: Handle, source: HostedMcpServer, ms: number): Promise<void> {
  const { hosting } = source;
  let plan: HostedInstallDir[];
  try {
    plan = hostedInstallPlan(hosting);
  } catch {
    throw new WakeStepError(`no committed lockfile for ${pinLockfileKey(hosting)}`);
  }
  await run(sandbox, 'mkdir', ['-p', PIN_DIR, BRIDGE_DIR], '/');
  await sandbox.writeFiles([
    ...plan.flatMap((step) => step.files),
    { path: `${BRIDGE_DIR}/bridge.mjs`, content: BRIDGE_SOURCE },
    {
      path: `${BRIDGE_DIR}/bridge-config.json`,
      content: bridgeConfig({ package: hosting.package, version: hosting.version, pinDir: PIN_DIR, port: HOSTED_SOURCE_PORT }),
    },
  ]);
  for (const step of plan) {
    const installed = await run(sandbox, 'npm', step.npmArgs, step.dir);
    if (installed.exitCode !== 0) throw new WakeStepError(`npm ${step.npmArgs[0]} in ${step.dir} exited ${installed.exitCode}`);
  }
  // The manifest's outbound list, applied before the bridge (and so the
  // child) starts: `[]` is deny-all. It holds for every later session too.
  await sandbox.update({ networkPolicy: hosting.outbound.length > 0 ? { allow: [...hosting.outbound] } : 'deny-all' });
  await sandbox.writeFiles([{ path: INSTALLED_MARKER, content: JSON.stringify({ package: hosting.package, version: hosting.version, commit: hosting.commit }) }]);
  await startBridge(sandbox, source, ms);
}

async function getOrCreate(source: HostedMcpServer, name: string, token: string, idleWindowMs: number, readyMs: number) {
  let wake: WokenSource['wake'] = 'running';
  const auth = resolveSandboxAuthParams();
  const params = {
    name,
    persistent: true,
    resources: { vcpus: 1 },
    ports: [HOSTED_SOURCE_PORT],
    timeout: idleWindowMs,
    networkPolicy: { allow: [...PACKAGE_REGISTRY_HOSTS] },
    env: { [BRIDGE_TOKEN_VARIABLE]: token },
    snapshotExpiration: SNAPSHOT_EXPIRATION_MS,
    keepLastSnapshots: { count: 1 },
    resume: true,
    onCreate: async (sandbox: Handle) => { wake = 'created'; await installAndStart(sandbox, source, readyMs); },
    onResume: async (sandbox: Handle) => {
      wake = 'resumed';
      try {
        await startBridge(sandbox, source, readyMs);
      } catch (error) {
        // A creation whose install never finished (its process ended
        // mid-install) resumes with nothing to start, and would fail every
        // call for as long as it is kept. It is this module's own sandbox, by
        // the one name it derives, so it is deleted; the next call creates it
        // afresh.
        if (error instanceof IncompleteInstallError) {
          log(source.sourceId, `sandbox ${name}: resumed with no completed install; deleting it by name`);
          await sandbox.delete();
        }
        throw error;
      }
    },
    ...proxyAwareSandboxFetch(),
  };
  const handle = auth ? await Sandbox.getOrCreate({ ...params, ...auth }) : await Sandbox.getOrCreate(params);
  return { handle, wake };
}

/** Poll the bridge's `/health` until it answers 200; a 401 fails at once (a rotated secret). */
async function waitForHealth(endpoint: string, token: string, until: number): Promise<void> {
  for (;;) {
    const remaining = until - Date.now();
    if (remaining <= 0) throw new WakeStepError('the bridge did not become ready in time');
    try {
      const response = await fetch(`${endpoint}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Math.min(remaining, 5_000)) });
      await response.body?.cancel().catch(() => {});
      if (response.ok) return;
      if (response.status === 401) throw new WakeStepError('the bridge refused the token (401)');
    } catch (error) {
      if (error instanceof WakeStepError) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** One `/health` request: whether the bridge answered it at all (200, or 401 from a live bridge refusing the token). */
async function bridgeAnswers(endpoint: string, token: string): Promise<'ok' | 'refused' | 'none'> {
  try {
    const response = await fetch(`${endpoint}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(BRIDGE_PROBE_MS) });
    await response.body?.cancel().catch(() => {});
    if (response.ok) return 'ok';
    return response.status === 401 ? 'refused' : 'none';
  } catch {
    return 'none';
  }
}

/**
 * `WokenSource.checkBridge` for one handle: one probe, at most one restart,
 * one probe after a lost race. The session stays in `readySessions` whatever
 * this finds: the next call then goes straight to its exchange and, if that
 * fails too, to one restart of its own, rather than polling `/health` to the
 * wake's deadline for a bridge nobody is starting.
 */
async function checkBridge(source: HostedMcpServer, handle: Handle, endpoint: string, token: string, sessionId: string): Promise<BridgeState> {
  if ((await bridgeAnswers(endpoint, token)) !== 'none') return 'alive';
  log(source.sourceId, `session ${sessionId}: the bridge did not answer /health after a failed call; starting it again`);
  try {
    await startBridge(handle, source, BRIDGE_RESTART_DEADLINE_MS);
    return 'recovered';
  } catch (error) {
    // A start that exits before its ready line may have lost the port to a
    // bridge another process started: that one is found by `/health`.
    if ((await bridgeAnswers(endpoint, token)) === 'ok') return 'recovered';
    log(source.sourceId, `session ${sessionId}: the bridge could not be started again: ${wakeFacts(error)}`);
    return 'dead';
  }
}

/** Restart the idle window without growing it: extend by what the session lacks of one window. */
async function restartIdleWindow(source: HostedMcpServer, handle: Handle, idleWindowMs: number): Promise<void> {
  const expiresAt = handle.expiresAt?.getTime();
  if (expiresAt === undefined) return;
  const lacking = idleWindowMs - (expiresAt - Date.now());
  if (lacking < EXTEND_SLACK_MS) return;
  try {
    await handle.extendTimeout(lacking);
  } catch (error) {
    log(source.sourceId, `could not restart the idle window: ${wakeFacts(error)}`);
  }
}

/**
 * Wake a hosted source and resolve its bridge's address for one call. Throws
 * `HostedSourceUnavailableError` when the sandbox cannot be made ready within
 * the deadline, whatever the reason; the reason goes to the log.
 */
export async function wakeHostedSource(source: HostedMcpServer, options: WakeOptions): Promise<WokenSource> {
  const idleWindowMs = options.idleWindowMs ?? DEFAULT_IDLE_WINDOW_MS;
  const deadlineMs = options.deadlineMs ?? DEFAULT_WAKE_DEADLINE_MS;
  const startedAt = Date.now();
  const until = startedAt + deadlineMs;
  const name = hostedSandboxName(source.alias, source.hosting.version);
  const token = bridgeToken(options.secret, name);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WakeStepError(`the wake missed its ${deadlineMs} ms deadline`)), deadlineMs);
  });
  try {
    const shared = async () => {
      let pending = wakesInFlight.get(name);
      if (!pending) {
        // A second process may create the same name between our `get` and
        // our `create`; the platform refuses the second create (a name is
        // unique per project), and one retry finds the sandbox the other
        // process made, then waits for its bridge below.
        pending = getOrCreate(source, name, token, idleWindowMs, deadlineMs)
          .catch((error) => {
            log(source.sourceId, `first wake attempt failed, retrying once: ${wakeFacts(error)}`);
            return getOrCreate(source, name, token, idleWindowMs, deadlineMs);
          })
          .finally(() => wakesInFlight.delete(name));
        wakesInFlight.set(name, pending);
      }
      return pending;
    };
    const { handle, wake } = await Promise.race([shared(), deadline]);
    const endpointUrl = `${handle.domain(HOSTED_SOURCE_PORT)}/mcp`;
    const sessionId = handle.currentSession().sessionId;
    if (wake === 'running' && !readySessions.has(sessionId)) {
      await Promise.race([waitForHealth(endpointUrl.slice(0, -'/mcp'.length), token, until), deadline]);
    }
    readySessions.add(sessionId);
    log(source.sourceId, `sandbox ${name}: ${wake} in ${Date.now() - startedAt} ms`);
    const origin = endpointUrl.slice(0, -'/mcp'.length);
    return {
      endpointUrl,
      token,
      sandboxName: name,
      wake,
      keepAlive: () => restartIdleWindow(source, handle, idleWindowMs),
      checkBridge: () => checkBridge(source, handle, origin, token, sessionId),
    };
  } catch (error) {
    log(source.sourceId, `sandbox ${name}: wake failed after ${Date.now() - startedAt} ms: ${wakeFacts(error)}`);
    throw new HostedSourceUnavailableError(source.sourceId);
  } finally {
    clearTimeout(timer);
  }
}
