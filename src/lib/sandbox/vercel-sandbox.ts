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
 */
import { Sandbox } from '@vercel/sandbox';
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
  const auth = resolveSandboxAuthParams();
  return auth ? Sandbox.create({ ...params, ...auth }) : Sandbox.create(params);
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
