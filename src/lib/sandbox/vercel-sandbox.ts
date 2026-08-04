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

function createSandbox(
  snapshotId: string | undefined,
  base: SandboxCreateBase,
): Promise<Sandbox> {
  if (snapshotId) {
    return Sandbox.create({
      ...base,
      source: { type: 'snapshot', snapshotId },
    });
  }
  // No snapshot configured — boot a fresh python3.13 sandbox; the
  // orchestrator installs the pinned scientific stack inline. Slower
  // (~10-30s cold start) and intended only for the snapshot-build script +
  // local-dev smoke tests.
  return Sandbox.create({
    ...base,
    runtime: 'python3.13',
  });
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
