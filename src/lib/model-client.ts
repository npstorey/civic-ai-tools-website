import OpenAI from 'openai';

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
 * present (e.g. during `next build`).
 */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/** Resolved chat-completions base URL (env override or the default above). */
export function getModelApiBaseUrl(): string {
  return process.env.MODEL_API_BASE_URL || DEFAULT_BASE_URL;
}

/**
 * Build a new client against the configured endpoint. Pass `apiKey` to use a
 * caller-supplied key; omitted, the key comes from OPENROUTER_API_KEY.
 */
export function createModelClient(opts: { apiKey?: string } = {}): OpenAI {
  return new OpenAI({
    baseURL: getModelApiBaseUrl(),
    apiKey: opts.apiKey ?? process.env.OPENROUTER_API_KEY,
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
