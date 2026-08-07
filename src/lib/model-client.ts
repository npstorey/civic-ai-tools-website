import OpenAI from 'openai';
import type { ModelErrorCode } from './streaming.ts';

/**
 * Model-client factory — the single place the chat-completions endpoint is
 * configured. The app speaks the OpenAI-compatible API, so any
 * OpenAI-compatible endpoint works: set MODEL_API_BASE_URL to point at it.
 * Unset, the default below preserves the demo deployment's behavior
 * (OpenRouter). The API key stays OPENROUTER_API_KEY in either case unless a
 * per-call key is passed in (e.g. a user-supplied key on the replay/evaluate
 * routes).
 *
 * Construction is lazy on purpose: no client is built at import time, so
 * importing a module that uses the factory never requires the key to be
 * present (e.g. during `next build`). Credential validation therefore lives on
 * the request path: routes call `getMissingModelCredentialError()` up front,
 * and `createModelClient` throws a typed `ModelConfigurationError` (instead of
 * the SDK's generic constructor error) the first time a request actually needs
 * the missing key. See issue #178 — a fresh instance with an incomplete env
 * file must fail loudly, not hang.
 */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Typed, operator-actionable configuration failure: the environment has no
 * usable model credential. Distinct from an upstream auth rejection (a key
 * that exists but the endpoint refuses) — see `classifyModelError`.
 */
export class ModelConfigurationError extends Error {
  readonly code: ModelErrorCode = 'model_not_configured';

  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigurationError';
  }
}

const MISSING_CREDENTIAL_MESSAGE =
  'No model API key is configured: OPENROUTER_API_KEY is missing or empty in the server environment. ' +
  'Set it (any OpenAI-compatible endpoint configured via MODEL_API_BASE_URL still reads its key from OPENROUTER_API_KEY) and restart the server.';

/**
 * Request-path guard: returns a typed `ModelConfigurationError` when the
 * environment holds no usable model credential (missing or empty
 * OPENROUTER_API_KEY), or null when a credential is present. Detectable before
 * any upstream call — routes use this to fail fast instead of opening the
 * model pipeline. Deliberately a check-and-return (not a throw) so routes can
 * shape their own response (SSE error event vs. JSON status).
 */
export function getMissingModelCredentialError(): ModelConfigurationError | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.trim() === '') {
    return new ModelConfigurationError(MISSING_CREDENTIAL_MESSAGE);
  }
  return null;
}

/**
 * Classify a request-path model failure into a typed, operator-actionable
 * code, or null for anything else (network errors, rate limits, model errors —
 * those keep their existing handling).
 *
 * - `model_not_configured`: our typed guard error, or the SDK's own
 *   missing-credentials constructor error (belt and braces — the guard should
 *   fire first).
 * - `model_auth_rejected`: the configured endpoint answered 401/403 (or an
 *   equivalent auth rejection), i.e. a credential exists but was refused
 *   upstream. Shape-based (`status` on the SDK's APIError) rather than
 *   instanceof so it survives SDK class-identity quirks and stays unit-testable.
 */
export function classifyModelError(error: unknown): ModelErrorCode | null {
  if (error instanceof ModelConfigurationError) return 'model_not_configured';
  if (error instanceof Error && /missing credentials/i.test(error.message)) {
    return 'model_not_configured';
  }
  if (error !== null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 401 || status === 403) return 'model_auth_rejected';
  }
  return null;
}

/** Resolved chat-completions base URL (env override or the default above). */
export function getModelApiBaseUrl(): string {
  return process.env.MODEL_API_BASE_URL || DEFAULT_BASE_URL;
}

/**
 * Build a new client against the configured endpoint. Pass `apiKey` to use a
 * caller-supplied key; omitted, the key comes from OPENROUTER_API_KEY.
 *
 * Throws a typed `ModelConfigurationError` when no usable key resolves. This
 * replaces two silent-failure shapes: the SDK's generic constructor error for
 * an unset key, and — worse — an empty-string key, which the SDK constructor
 * accepts and then sends as a blank bearer token upstream.
 */
export function createModelClient(opts: { apiKey?: string } = {}): OpenAI {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new ModelConfigurationError(MISSING_CREDENTIAL_MESSAGE);
  }
  return new OpenAI({
    baseURL: getModelApiBaseUrl(),
    apiKey,
  });
}

let defaultClient: OpenAI | null = null;

/**
 * Shared lazily-constructed client using the environment's key — the
 * equivalent of the former module-level singletons, built on first use
 * instead of at import.
 */
export function getModelClient(): OpenAI {
  if (!defaultClient) {
    defaultClient = createModelClient();
  }
  return defaultClient;
}

/** Test support: drop the cached default client so env changes take effect. */
export function _resetDefaultModelClientForTests(): void {
  defaultClient = null;
}
