/**
 * Driver #1: Vercel Sandbox (the default; demo-instance behavior unchanged).
 *
 * Boots a python3.13 sandbox from a pre-built snapshot (sub-second cold
 * start per ADR-0005 Context) when `SANDBOX_SNAPSHOT_ID` is configured, or a
 * fresh python3.13 sandbox otherwise (the orchestrator then pip-installs the
 * pinned stack inline). The snapshot embeds the pinned scientific stack
 * (pandas/requests/numpy/matplotlib) AND jupyter so cold start is fast; the
 * build script that produces the snapshot lives at
 * `scripts/build-sandbox-snapshot.ts` (project-plan N5).
 *
 * Auth is OIDC-automatic on Vercel deployments; local dev needs
 * `VERCEL_OIDC_TOKEN` (via `vercel link` + `vercel env pull`) OR the
 * VERCEL_TOKEN+VERCEL_TEAM_ID+VERCEL_PROJECT_ID triple.
 *
 * IMPORTANT — how that triple actually reaches the SDK: `@vercel/sandbox`
 * and `@vercel/oidc` read exactly ONE auth variable from the environment,
 * `VERCEL_OIDC_TOKEN`. The token/teamId/projectId triple is accepted *only*
 * as explicit `Sandbox.create({ token, teamId, projectId })` parameters, so
 * THIS MODULE reads the three variables and passes them through (see
 * `resolveSandboxAuthParams`). Without that pass-through an off-platform run
 * with the triple set still fails with `LocalOidcContextError` — and under a
 * non-TTY wrapper (e.g. `op run`) the SDK's interactive-login fallback is
 * disabled (`shouldPromptForCredentials()` requires a TTY), so it throws
 * rather than prompting.
 *
 * This module is the ONLY runtime importer of `@vercel/sandbox` — the seam
 * (`./execute.ts`) loads it lazily, so the container driver never touches
 * the SDK or its auth requirements.
 *
 * EGRESS PROXY (#492). The SDK passes its own undici `Agent` as the
 * `dispatcher` of every API request, which overrides the global dispatcher
 * `../outbound-proxy.ts` installs, so `HTTP_PROXY` / `HTTPS_PROXY` /
 * `NO_PROXY` never reached these calls on their own. With a proxy configured,
 * this module hands the SDK a `fetch` that swaps that agent for a proxy-aware
 * one — see `proxyAwareSandboxFetch`. With none configured the SDK is called
 * exactly as before and no dispatcher is built.
 */
import { Sandbox } from '@vercel/sandbox';
import type { Dispatcher } from 'undici';
import {
  createProxyDispatcher,
  resolveProxySettings,
  type ProxySettings,
} from '../outbound-proxy.ts';
import type {
  CreateSessionOptions,
  ExecutorCommand,
  ExecutorCommandResult,
  ExecutorSession,
  NotebookExecutorDriver,
} from './driver.ts';

/**
 * The python3.13 sandbox image (Amazon Linux 2023 base) expects its CA
 * bundle at `/etc/ssl/certs/ca-certificates.crt` but ships it only at
 * `/etc/pki/tls/certs/ca-bundle.crt`. Setting the standard openssl-family
 * env vars so pip + `requests` inside the executed notebook resolve PyPI
 * and HTTPS civic-data endpoints. Mirrors scripts/build-sandbox-snapshot.ts.
 *
 * These paths are an artifact of THIS runtime's image, which is why they
 * live in the driver rather than in the orchestrator.
 */
const AL2023_CA_BUNDLE = '/etc/pki/tls/certs/ca-bundle.crt';
const TLS_ENV: Record<string, string> = {
  SSL_CERT_FILE: AL2023_CA_BUNDLE,
  REQUESTS_CA_BUNDLE: AL2023_CA_BUNDLE,
  PIP_CERT: AL2023_CA_BUNDLE,
};

interface SandboxCreateBase {
  timeout: number;
  env: Record<string, string>;
}

/** Environment-variable names for the off-platform auth triple. */
const ENV_VERCEL_TOKEN = 'VERCEL_TOKEN';
const ENV_VERCEL_TEAM_ID = 'VERCEL_TEAM_ID';
const ENV_VERCEL_PROJECT_ID = 'VERCEL_PROJECT_ID';

/** The SDK's `Credentials` shape — all three fields required, never partial. */
export interface SandboxAuthParams {
  token: string;
  teamId: string;
  projectId: string;
}

/**
 * Resolve the off-platform auth triple from the environment.
 *
 * ALL THREE OR NONE, deliberately: the SDK's credential resolver treats a
 * partial triple as a hard error (it throws "Missing credentials parameters
 * to access the Vercel API") and falls through to the OIDC path only when
 * all three are absent. Returning `null` unless the set is complete is what
 * keeps the on-platform OIDC-automatic path untouched — production sets none
 * of the three, so this returns null there and no auth keys are passed.
 *
 * SECRET HYGIENE: the returned token is passed straight to the SDK and is
 * never logged, echoed, hashed, or included in an error message — not here
 * and not in any caller. Pure function; exported for unit tests.
 */
export function resolveSandboxAuthParams(
  env: Record<string, string | undefined> = process.env,
): SandboxAuthParams | null {
  const token = env[ENV_VERCEL_TOKEN]?.trim();
  const teamId = env[ENV_VERCEL_TEAM_ID]?.trim();
  const projectId = env[ENV_VERCEL_PROJECT_ID]?.trim();
  if (token && teamId && projectId) return { token, teamId, projectId };
  return null;
}

/**
 * The agent options the SDK's own API agent carries, kept on the proxied path.
 * `@vercel/sandbox` 1.10.2 builds `new Agent({ bodyTimeout: 0 })`
 * (`dist/api-client/base-client.js`): a command's output arrives as one
 * long-lived NDJSON response, and undici's default body timeout (300 s of
 * silence) would cut a quiet long-running command off mid-stream. A
 * replacement that dropped it would work in every short test and fail on the
 * first slow notebook.
 */
export const SANDBOX_API_AGENT_OPTIONS = { bodyTimeout: 0 } as const;

/** Built on the first proxied session, then reused while the settings hold —
 *  one connection pool per process, as the SDK's own module-level agent is. */
let sandboxDispatcher: { key: string; dispatcher: Dispatcher } | null = null;

/**
 * The proxy-aware dispatcher this module has built for the sandbox API, or
 * `null` when it has built none — which is always the case with no proxy
 * configured. Exported so the suite can compare each request's dispatcher
 * against the one this module actually built.
 */
export function sandboxApiDispatcher(): Dispatcher | null {
  return sandboxDispatcher?.dispatcher ?? null;
}

function dispatcherFor(settings: ProxySettings): Dispatcher {
  // Proxy addresses can carry a credential; the key is held, never printed.
  const key = JSON.stringify([settings.httpProxy, settings.httpsProxy, settings.noProxy]);
  if (sandboxDispatcher?.key !== key) {
    sandboxDispatcher = {
      key,
      dispatcher: createProxyDispatcher(settings, SANDBOX_API_AGENT_OPTIONS),
    };
  }
  return sandboxDispatcher.dispatcher;
}

/**
 * The `fetch` to hand `Sandbox.create`, as a spreadable fragment: `{}` with no
 * proxy configured, so the SDK call is exactly the pre-#492 call and the SDK
 * keeps `globalThis.fetch` with its own agent; `{ fetch }` otherwise.
 *
 * WHY THE FETCH REPLACES `init.dispatcher` RATHER THAN MERELY EXISTING. The
 * SDK sets `dispatcher: <its own Agent>` in the init of every request it makes,
 * including through a caller's `fetch`, so a `fetch` that passed its init on
 * unchanged would still send every request through the SDK's agent. This one
 * overwrites that key with a dispatcher from `createProxyDispatcher` — the
 * same three variables and the same exempt set as the global dispatcher —
 * built with `SANDBOX_API_AGENT_OPTIONS`.
 *
 * `globalThis.fetch` is read at call time, as the SDK itself would have used
 * it: the request is issued by the runtime's own `fetch`, and only its
 * dispatcher changes. `scripts/outbound-proxy.test.mjs` drives that pairing
 * (the runtime's `fetch`, this repository's pinned `undici` dispatcher) to a
 * loopback proxy rather than assuming it.
 */
export function proxyAwareSandboxFetch(
  env: Record<string, string | undefined> = process.env,
): { fetch?: typeof globalThis.fetch } {
  const settings = resolveProxySettings(env);
  if (!settings.enabled) return {};
  const dispatcher = dispatcherFor(settings);
  const proxiedFetch: typeof globalThis.fetch = (input, init) =>
    globalThis.fetch(input, { ...init, dispatcher } as RequestInit);
  return { fetch: proxiedFetch };
}

function createSandbox(
  snapshotId: string | undefined,
  base: SandboxCreateBase,
): Promise<Sandbox> {
  const params = snapshotId
    ? { ...base, source: { type: 'snapshot' as const, snapshotId } }
    // No snapshot configured — boot a fresh python3.13 sandbox; the
    // orchestrator installs the pinned scientific stack inline. Slower
    // (~10-30s cold start) and intended only for the snapshot-build script +
    // local-dev smoke tests.
    : { ...base, runtime: 'python3.13' as const };

  // Attach the auth triple ONLY when complete. Two distinct call shapes
  // rather than a spread of possibly-undefined keys: an undefined-valued
  // `token`/`teamId`/`projectId` would read to the SDK as a partial triple
  // and throw. With the triple unset (the demo/production case) the call is
  // byte-for-byte the pre-fix call and OIDC resolution is untouched.
  //
  // The transport fragment follows the same rule: `{}` unless a proxy is
  // configured, so with the proxy variables unset neither shape gains a key.
  // Every later call — commands, files, stop — reuses the client `create`
  // builds from this `fetch` (`@vercel/sandbox` 1.10.2 `dist/sandbox.js`
  // `create` → `new APIClient({ fetch })`, handed to the sandbox and to each
  // command), so one fragment here governs the whole session.
  const auth = resolveSandboxAuthParams();
  const transport = proxyAwareSandboxFetch();
  return auth
    ? Sandbox.create({ ...params, ...auth, ...transport })
    : Sandbox.create({ ...params, ...transport });
}

export function createVercelSandboxDriver(): NotebookExecutorDriver {
  return {
    name: 'vercel-sandbox',

    async createSession(opts: CreateSessionOptions): Promise<ExecutorSession> {
      const sandbox = await createSandbox(opts.snapshotId, {
        timeout: opts.timeoutMs,
        env: { ...TLS_ENV, ...opts.env },
      });

      return {
        id: sandbox.sandboxId,
        stackPreinstalled: Boolean(opts.snapshotId),

        async runCommand(command: ExecutorCommand): Promise<ExecutorCommandResult> {
          const result = await sandbox.runCommand({
            cmd: command.cmd,
            args: command.args,
            // Merge the image's TLS paths under the caller's env, exactly as
            // the pre-seam module did for pip + nbconvert; a command with no
            // env (the version probe) runs bare.
            ...(command.env ? { env: { ...TLS_ENV, ...command.env } } : {}),
            ...(command.signal ? { signal: command.signal } : {}),
          });
          return {
            exitCode: result.exitCode,
            stdout: () => result.stdout(),
            stderr: () => result.stderr(),
          };
        },

        async writeFiles(files, writeOpts) {
          await sandbox.writeFiles(
            files.map((f) => ({ path: f.path, content: f.content })),
            writeOpts?.signal ? { signal: writeOpts.signal } : undefined,
          );
        },

        async readFileToBuffer(path: string): Promise<Buffer | null> {
          return sandbox.readFileToBuffer({ path });
        },

        async stop(): Promise<void> {
          await sandbox.stop();
        },
      };
    },
  };
}
