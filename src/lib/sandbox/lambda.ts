/**
 * Driver #3: AWS Lambda (#530 P2; ADR-0023 §D, "a hosted runner-service ...
 * over a remote API").
 *
 * A one-shot driver (ruling D1): one synchronous invoke per notebook. The
 * payload carries the staged file, the nbconvert command and the version probe
 * exactly as `executeNotebook` builds them, and the function's handler
 * (docker/executor/lambda/handler.py) runs them as given, so the argv an
 * executed notebook comes out of is the one the other drivers run. The
 * function's image is the `lambda` target of docker/executor/Dockerfile, on
 * the same pinned stack as the container image (ruling D4).
 *
 * SETTINGS. EXECUTOR_LAMBDA_FUNCTION names the function (a name, an ARN, or
 * either with a `:qualifier`), required under this driver. The region is
 * EXECUTOR_LAMBDA_REGION, else the SDK's own chain (AWS_REGION, which ECS
 * sets); with neither, the first run refuses and names both (ruling D6).
 * Credentials come from the SDK's default chain (on ECS, the task role, fetched
 * through the SDK's own node:http handler, never through the egress proxy).
 * The SDK's own AWS_ENDPOINT_URL_LAMBDA points it at another endpoint.
 *
 * SECRETS (ruling D5). The two data-portal tokens are set on the function, not
 * sent: `FUNCTION_HELD_VARIABLES` are removed from the payload, whatever the
 * app's environment carries, and the handler adds them from its own.
 *
 * TRANSPORT (ruling D6). With a proxy configured, the client takes the SDK's
 * fetch transport, as the S3 driver does, so NO_PROXY decides per destination
 * and a VPC endpoint listed there goes direct. A synchronous invoke sends its
 * headers only when the function ends, and undici's default headersTimeout is
 * 300 s, so that transport carries its own dispatcher, built by the one factory
 * (`createProxyDispatcher`), with its header and body timeouts raised to the
 * session cap plus the grace below. With no proxy configured, the client keeps
 * the SDK's default node:http transport, which sets no timeout of its own, and
 * no dispatcher is built.
 *
 * SIZE (ruling D2). A synchronous invoke carries at most 6 MB each way. The
 * driver refuses a payload over that before sending it; the handler refuses a
 * response over it and says how large it was.
 *
 * THE INVOCATION ID. `sandboxId` is the invoke response's request id
 * (`$metadata.requestId`, the `x-amzn-requestid` header), which the function's
 * code cannot write. Only where the API returns none, as the runtime interface
 * emulator does, is the id the handler reports used instead.
 *
 * ONE ATTEMPT. The SDK retries a throttled or failed call by default, and a
 * retry here would run the notebook a second time against live data, so the
 * client makes one attempt and a failure reaches the reader as one.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { InvokeCommandOutput, LambdaClientConfig } from '@aws-sdk/client-lambda';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { createProxyDispatcher, resolveProxySettings } from '../outbound-proxy.ts';
import { ExecutorSettingError, NotebookExecutionError } from './driver.ts';
import type { NotebookRun, NotebookRunResult, OneShotExecutorDriver } from './driver.ts';

type EnvRecord = Record<string, string | undefined>;

/** The payload protocol; handler.py's PROTOCOL. */
export const LAMBDA_PROTOCOL = 1;

/** A synchronous invoke carries at most 6 MB each way (AWS, Lambda quotas); counted as 6 MiB. */
export const INVOKE_PAYLOAD_LIMIT_BYTES = 6 * 1024 * 1024;

/**
 * Set on the function, never sent (ruling D5). Must equal the names
 * `buildNotebookEnv` supplies and handler.py's FUNCTION_HELD_VARIABLES;
 * `./lambda.test.ts` holds all three equal.
 */
export const FUNCTION_HELD_VARIABLES = ['SOCRATA_APP_TOKEN', 'DC_API_KEY'] as const;

/**
 * How long past the session cap the driver waits for the function before it
 * gives up. The handler stops nbconvert at the cap and answers, so this only
 * ends a call whose answer never arrives.
 */
export const INVOKE_GRACE_MS = 15_000;

const ENV_LAMBDA_FUNCTION = 'EXECUTOR_LAMBDA_FUNCTION';
const ENV_LAMBDA_REGION = 'EXECUTOR_LAMBDA_REGION';

/** A function name, an ARN or a partial ARN, optionally with `:qualifier`. */
const FUNCTION_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_:.$-]*$/;
/** A region name, such as us-east-1. */
const REGION_SHAPE = /^[a-z]{2}(-[a-z0-9]+)+-\d+$/;

/** The one call the driver makes of its client; a test passes a recorder. */
export interface LambdaInvoker {
  send(command: InvokeCommand, options?: { abortSignal?: AbortSignal }): Promise<InvokeCommandOutput>;
}

export interface LambdaDriverDeps {
  /** The client to invoke through. Defaults to one this module builds from the environment. */
  client?: LambdaInvoker;
  /** The environment the settings are read from. Defaults to `process.env`, read per run. */
  env?: EnvRecord;
}

/**
 * The response was too large to return inline (ruling D2): the handler's own
 * refusal, or Lambda's `Function.ResponseSizeTooLarge`. A `NotebookExecutionError`,
 * so the route logs it by class.
 */
export class LambdaResponseTooLargeError extends NotebookExecutionError {
  constructor(bytes: number | null) {
    super(
      `the executed notebook is too large to return from Lambda inline${bytes === null ? '' : ` (${bytes} bytes)`}; ` +
        `a synchronous invoke returns at most ${INVOKE_PAYLOAD_LIMIT_BYTES} bytes`,
    );
    this.name = 'LambdaResponseTooLargeError';
  }
}

/** The invoke did not complete: a transport, permission or function failure. Named by kind, never by content. */
export class LambdaInvokeError extends NotebookExecutionError {
  /** The AWS error's name, or the function-error type: `AccessDeniedException`, `Unhandled`, …. */
  readonly kind: string;
  constructor(kind: string, cause?: unknown) {
    super(`the Lambda invoke failed (${kind})`, cause === undefined ? {} : { cause });
    this.name = 'LambdaInvokeError';
    this.kind = kind;
  }
}

/** The settings a run reads: the function, and the region when one is set. */
export function resolveLambdaSettings(env: EnvRecord = process.env): { functionName: string; region: string | null } {
  const functionName = (env[ENV_LAMBDA_FUNCTION] ?? '').trim();
  if (!functionName || !FUNCTION_SHAPE.test(functionName)) {
    throw new ExecutorSettingError(
      ENV_LAMBDA_FUNCTION,
      `${ENV_LAMBDA_FUNCTION} must name the notebook function, by name or ARN, when EXECUTOR_DRIVER=lambda ` +
        '(docs/deploy.md, the Lambda executor).',
    );
  }
  const region = (env[ENV_LAMBDA_REGION] ?? '').trim();
  if (region && !REGION_SHAPE.test(region)) {
    throw new ExecutorSettingError(
      ENV_LAMBDA_REGION,
      `${ENV_LAMBDA_REGION} must be a region name, such as us-east-1 (docs/deploy.md, the Lambda executor).`,
    );
  }
  return { functionName, region: region || null };
}

/** How long a run waits for the invoke to answer: the session cap and the grace. */
export function invokeWaitMs(timeoutMs: number): number {
  return timeoutMs + INVOKE_GRACE_MS;
}

/**
 * The transport fragment for the client: `{}` with no proxy configured, so the
 * client keeps the SDK's default node:http transport; otherwise the SDK's fetch
 * transport carrying its own dispatcher, whose header and body timeouts are
 * `waitMs`. Measured: FetchHttpHandler builds a `Request` from the init
 * `requestInit` returns and calls `fetch(request)`, and the runtime's fetch
 * takes the dispatcher the `Request` carries, so this dispatcher, not the
 * global one, governs the invoke.
 */
export function lambdaTransport(
  waitMs: number,
  env: EnvRecord = process.env,
): { requestHandler?: FetchHttpHandler } {
  const settings = resolveProxySettings(env);
  if (!settings.enabled) return {};
  const dispatcher = createProxyDispatcher(settings, { headersTimeout: waitMs, bodyTimeout: waitMs });
  return { requestHandler: new FetchHttpHandler({ requestInit: () => ({ dispatcher }) as RequestInit }) };
}

/** The client a run invokes through, built from the environment. */
function buildClient(region: string | null, timeoutMs: number, env: EnvRecord): LambdaClient {
  const config: LambdaClientConfig = {
    ...(region ? { region } : {}),
    maxAttempts: 1,
    ...lambdaTransport(invokeWaitMs(timeoutMs), env),
  };
  return new LambdaClient(config);
}

/** The region the client resolved, or a refusal naming both places one comes from. */
async function assertRegion(client: LambdaClient): Promise<void> {
  let region: string | undefined;
  try {
    region = await client.config.region();
  } catch {
    region = undefined;
  }
  if (!region) {
    throw new ExecutorSettingError(
      ENV_LAMBDA_REGION,
      `${ENV_LAMBDA_REGION} is unset and the AWS SDK found no region (AWS_REGION): set one of them ` +
        '(docs/deploy.md, the Lambda executor).',
    );
  }
}

/** The payload the handler reads, with the function-held variables removed. */
export function buildPayload(run: NotebookRun): Record<string, unknown> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(run.command.env)) {
    if (!(FUNCTION_HELD_VARIABLES as readonly string[]).includes(name)) env[name] = value;
  }
  return {
    protocol: LAMBDA_PROTOCOL,
    files: run.files.map((file) => ({ path: file.path, content: file.content })),
    command: { cmd: run.command.cmd, args: [...run.command.args], env },
    readBack: run.readBack,
    versionProbe: { cmd: run.versionProbe.cmd, args: [...run.versionProbe.args] },
    timeoutMs: run.timeoutMs,
  };
}

interface HandlerResponse {
  protocol?: unknown;
  requestId?: unknown;
  refused?: unknown;
  bytes?: unknown;
  exitCode?: unknown;
  stderr?: unknown;
  executed?: unknown;
  python?: unknown;
  errorType?: unknown;
}

function parseResponse(payload: Uint8Array | undefined): HandlerResponse {
  try {
    const value = JSON.parse(new TextDecoder().decode(payload ?? new Uint8Array())) as unknown;
    if (value && typeof value === 'object') return value as HandlerResponse;
  } catch {
    /* fall through */
  }
  throw new LambdaInvokeError('UnreadableResponse');
}

/** The one-shot run: one invoke, and the handler's answer read back as `NotebookRunResult`. */
async function invoke(deps: LambdaDriverDeps, run: NotebookRun): Promise<NotebookRunResult> {
  const env = deps.env ?? process.env;
  const { functionName, region } = resolveLambdaSettings(env);

  const payload = new TextEncoder().encode(JSON.stringify(buildPayload(run)));
  if (payload.byteLength > INVOKE_PAYLOAD_LIMIT_BYTES) {
    throw new NotebookExecutionError(
      `the notebook is too large to send to Lambda (${payload.byteLength} bytes; a synchronous invoke takes at ` +
        `most ${INVOKE_PAYLOAD_LIMIT_BYTES})`,
    );
  }

  let client: LambdaInvoker;
  if (deps.client) {
    client = deps.client;
  } else {
    const built = buildClient(region, run.timeoutMs, env);
    await assertRegion(built);
    client = built;
  }

  const waited = AbortSignal.timeout(invokeWaitMs(run.timeoutMs));
  const abortSignal = run.signal ? AbortSignal.any([run.signal, waited]) : waited;
  let out: InvokeCommandOutput;
  try {
    out = await client.send(
      new InvokeCommand({ FunctionName: functionName, InvocationType: 'RequestResponse', LogType: 'None', Payload: payload }),
      { abortSignal },
    );
  } catch (err) {
    if (waited.aborted) {
      throw new NotebookExecutionError(
        `the Lambda invoke did not answer within the session cap (${run.timeoutMs}ms) and its grace`,
        { exitCode: -1, cause: err, stderr: `[lambda-executor] wall-clock cap (${run.timeoutMs}ms) exceeded` },
      );
    }
    const kind = err instanceof Error && err.name ? err.name : 'Error';
    throw new LambdaInvokeError(kind, err);
  }

  const body = parseResponse(out.Payload);
  if (out.FunctionError) {
    // Lambda's own error object: {errorType, errorMessage, ...}. Read by type
    // only; the message is not carried anywhere.
    const errorType = typeof body.errorType === 'string' ? body.errorType : out.FunctionError;
    if (errorType === 'Function.ResponseSizeTooLarge') throw new LambdaResponseTooLargeError(null);
    throw new LambdaInvokeError(errorType);
  }
  if (body.refused === 'response-too-large') {
    throw new LambdaResponseTooLargeError(typeof body.bytes === 'number' ? body.bytes : null);
  }
  if (body.refused !== undefined || body.protocol !== LAMBDA_PROTOCOL) {
    throw new LambdaInvokeError(`Refused:${typeof body.refused === 'string' ? body.refused : 'protocol'}`);
  }
  if (typeof body.exitCode !== 'number') throw new LambdaInvokeError('UnreadableResponse');

  const handlerId = typeof body.requestId === 'string' ? body.requestId : '';
  return {
    id: out.$metadata?.requestId || handlerId || 'lambda-unknown',
    exitCode: body.exitCode,
    stderr: typeof body.stderr === 'string' ? body.stderr : '',
    executed: typeof body.executed === 'string' ? Buffer.from(body.executed, 'base64') : null,
    pythonVersion: typeof body.python === 'string' ? body.python : null,
  };
}

export function createLambdaDriver(deps: LambdaDriverDeps = {}): OneShotExecutorDriver {
  return {
    name: 'lambda',
    runNotebook: (run) => invoke(deps, run),
  };
}
