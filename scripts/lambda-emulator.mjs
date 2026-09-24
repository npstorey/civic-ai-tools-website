/**
 * The lambda executor driver, pointed at the AWS Lambda Runtime Interface
 * Emulator (#530 P2). Used by scripts/executor-parity.mjs (`--lambda-endpoint`)
 * and scripts/lambda-image-check.mjs; never by the app.
 *
 * CREDENTIAL-FREE BY CONSTRUCTION. The emulator checks no signature, so the
 * client below uses the SDK's no-auth scheme: it resolves no credentials and
 * sends no Authorization header. Measured against a loopback server on
 * @aws-sdk/client-lambda 3.1102.0: `POST /2015-03-31/functions/function/
 * invocations`, the emulator's own path, with no Authorization and no
 * X-Amz-Date. So no placeholder credential exists anywhere on this path, in
 * code or in CI.
 *
 * Everything but the client is the driver's own: the settings, the payload,
 * the response reading. The region below is the SDK's routing requirement;
 * the emulator ignores it.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

/** The function name the emulator serves every invoke under. */
export const EMULATOR_FUNCTION = 'function';

/** A client that invokes `endpoint` and signs nothing. */
export function emulatorLambdaClient(endpoint) {
  return new LambdaClient({
    region: 'us-east-1',
    endpoint,
    maxAttempts: 1,
    httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    httpAuthSchemes: [
      {
        schemeId: 'smithy.api#noAuth',
        identityProvider: () => async () => ({}),
        signer: { sign: async (request) => request },
      },
    ],
  });
}

/** The lambda driver on the emulator client, reading its settings from `env` with the emulator's function name. */
export async function emulatorLambdaDriver(endpoint, env = process.env) {
  const { createLambdaDriver } = await import('../src/lib/sandbox/lambda.ts');
  return createLambdaDriver({
    client: emulatorLambdaClient(endpoint),
    env: { ...env, EXECUTOR_LAMBDA_FUNCTION: env.EXECUTOR_LAMBDA_FUNCTION || EMULATOR_FUNCTION },
  });
}

/** One raw invoke of the emulator, for probes that are not notebooks. Returns the decoded payload. */
export async function invokeEmulator(endpoint, payload) {
  const out = await emulatorLambdaClient(endpoint).send(
    new InvokeCommand({
      FunctionName: EMULATOR_FUNCTION,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );
  return { functionError: out.FunctionError, body: new TextDecoder().decode(out.Payload ?? new Uint8Array()) };
}
