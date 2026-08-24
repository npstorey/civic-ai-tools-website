import OpenAI, { AzureOpenAI } from 'openai';
import type { ModelErrorCode } from './streaming.ts';

/**
 * Model-client factory — the single place the chat-completions endpoint is
 * configured. The endpoint is a WIRE DIALECT, not merely a base URL:
 *
 *   MODEL_API_KIND=openai-compatible  (default) — the OpenAI-compatible API.
 *     `MODEL_API_BASE_URL` points at any endpoint that speaks it; unset, the
 *     default below preserves the reference deployment's behavior
 *     (OpenRouter). Auth is `Authorization: Bearer <key>`.
 *
 *   MODEL_API_KIND=azure-openai — an Azure OpenAI resource. `MODEL_API_BASE_URL`
 *     is the RESOURCE ENDPOINT (e.g. https://example-resource.example.net);
 *     requests route to /openai/deployments/{deployment}/chat/completions,
 *     carry `api-version=MODEL_API_VERSION` as a query parameter, and
 *     authenticate with an `api-key` header instead of a bearer token. The
 *     deployment name is whatever the caller passes as `model` — see
 *     `createModelClient` for the measurement behind that claim.
 *
 * The credential is `MODEL_API_KEY`, with `OPENROUTER_API_KEY` accepted as its
 * prior-era name (expand half of the rename — the prior-era spelling keeps
 * working indefinitely in this phase; nothing flips). Precedence mirrors
 * `src/lib/publisher-env.ts` and `scripts/preflight-env.mjs` exactly: the
 * canonical name wins whenever it is DEFINED, empty string included. A
 * per-call key (a user-supplied key on the replay/evaluate routes) overrides
 * both.
 *
 * Construction is lazy on purpose: no client is built at import time, so
 * importing a module that uses the factory never requires the key to be
 * present (e.g. during `next build`). Credential and endpoint validation
 * therefore live on the request path: routes call
 * `getMissingModelCredentialError()` up front, and `createModelClient` throws
 * a typed `ModelConfigurationError` (instead of the SDK's generic constructor
 * error) the first time a request actually needs the missing value. See issue
 * #178 — a fresh instance with an incomplete env file must fail loudly, not
 * hang.
 */

/**
 * Exported so the built-in-catalog retention rule has ONE source of truth for
 * "the default endpoint" (website#30 G0 D2, enforced in `model-resolver.ts`):
 * the built-in model list is kept only while the RESOLVED base URL is this
 * value. A second copy of the literal would let the two drift silently in the
 * direction that matters — a catalog trusted against an endpoint it no longer
 * describes.
 */
export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/** The credential's canonical name, and the prior-era name still accepted. */
const CANONICAL_KEY_NAME = 'MODEL_API_KEY';
const PRIOR_ERA_KEY_NAME = 'OPENROUTER_API_KEY';

/**
 * The wire dialects this factory speaks. A closed set: an unrecognized
 * `MODEL_API_KIND` is a typed refusal, never a silent fall-through to the
 * default, because falling through would send OpenAI-compatible requests at
 * an endpoint the operator told us speaks something else.
 */
export const MODEL_API_KINDS = ['openai-compatible', 'azure-openai'] as const;
export type ModelApiKind = (typeof MODEL_API_KINDS)[number];
const DEFAULT_MODEL_API_KIND: ModelApiKind = 'openai-compatible';

/**
 * Auth modes. `entra` is RESERVED — it names the Microsoft Entra token-provider
 * path (`azureADTokenProvider` in the SDK) so that the enum does not have to
 * change when that ships, and there is deliberately no code behind it: setting
 * it is a typed refusal, not a silent fallback to `api-key`.
 */
export const MODEL_API_AUTH_MODES = ['bearer', 'api-key', 'entra'] as const;
export type ModelApiAuth = (typeof MODEL_API_AUTH_MODES)[number];

/**
 * `MODEL_API_AUTH` is DERIVED from `MODEL_API_KIND` by default. Each dialect's
 * client emits exactly one auth shape (measured — see the test), so an
 * explicit value that contradicts the kind describes a request this factory
 * cannot produce; it is refused rather than ignored.
 */
const DERIVED_AUTH: Record<ModelApiKind, Exclude<ModelApiAuth, 'entra'>> = {
  'openai-compatible': 'bearer',
  'azure-openai': 'api-key',
};

/**
 * Typed, operator-actionable configuration failure: the environment cannot
 * describe a usable model endpoint. Distinct from an upstream auth rejection
 * (a key that exists but the endpoint refuses) — see `classifyModelError`.
 *
 * Every message names the variable at fault and the fix. These are operability
 * refusals: they are raised on the request path, before any upstream call, and
 * none of them ever reaches a published record.
 */
export class ModelConfigurationError extends Error {
  readonly code: ModelErrorCode = 'model_not_configured';

  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigurationError';
  }
}

const MISSING_CREDENTIAL_MESSAGE =
  `No model API key is configured: ${CANONICAL_KEY_NAME} is missing or empty in the server environment ` +
  `(its prior-era name ${PRIOR_ERA_KEY_NAME} is still accepted and was not set either). ` +
  `Set ${CANONICAL_KEY_NAME} and restart the server; whichever endpoint MODEL_API_BASE_URL names reads its key from it.`;

/** Trimmed environment read: unset, empty and whitespace-only are all absent. */
function readSetting(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Resolve the credential's name and raw value under the two accepted names.
 *
 * The precedence rule is DEFINED, not truthy — the canonical name wins even
 * when set to the empty string. That mirrors `src/lib/publisher-env.ts` and
 * `resolveEnvName` in `scripts/preflight-env.mjs`, and the agreement is the
 * point: a preflight that resolved differently from this reader would pass a
 * configuration the app then refuses.
 */
function resolveModelApiKeyFromEnv(): {
  name: string;
  raw: string | undefined;
  viaPriorEra: boolean;
} {
  const canonical = process.env[CANONICAL_KEY_NAME];
  if (typeof canonical === 'string') {
    return { name: CANONICAL_KEY_NAME, raw: canonical, viaPriorEra: false };
  }
  const priorEra = process.env[PRIOR_ERA_KEY_NAME];
  if (typeof priorEra === 'string') {
    return { name: PRIOR_ERA_KEY_NAME, raw: priorEra, viaPriorEra: true };
  }
  return { name: CANONICAL_KEY_NAME, raw: undefined, viaPriorEra: false };
}

/**
 * The resolved wire dialect. Unset or empty takes the default; anything
 * outside the closed set is a typed refusal naming the variable and the
 * accepted values. Mirrors the driver-selector convention in
 * `scripts/preflight-env.mjs` (`env.X || '<default>'`, throw outside the set),
 * which is what lets the preflight agree with this reader.
 */
export function getModelApiKind(): ModelApiKind {
  const raw = readSetting('MODEL_API_KIND');
  if (raw === undefined) return DEFAULT_MODEL_API_KIND;
  if ((MODEL_API_KINDS as readonly string[]).includes(raw)) return raw as ModelApiKind;
  throw new ModelConfigurationError(
    `MODEL_API_KIND is set to a value this build does not recognize. ` +
      `Set it to one of: ${MODEL_API_KINDS.join(', ')} (or leave it unset for ${DEFAULT_MODEL_API_KIND}), and restart the server.`,
  );
}

/** The resolved auth mode: derived from the kind unless explicitly declared. */
export function getModelApiAuth(kind: ModelApiKind = getModelApiKind()): ModelApiAuth {
  const derived = DERIVED_AUTH[kind];
  const raw = readSetting('MODEL_API_AUTH');
  if (raw === undefined) return derived;
  if (!(MODEL_API_AUTH_MODES as readonly string[]).includes(raw)) {
    throw new ModelConfigurationError(
      `MODEL_API_AUTH is set to a value this build does not recognize. ` +
        `Set it to one of: ${MODEL_API_AUTH_MODES.join(', ')} (or leave it unset to derive it from MODEL_API_KIND), and restart the server.`,
    );
  }
  if (raw === 'entra') {
    throw new ModelConfigurationError(
      `MODEL_API_AUTH=entra is reserved and not implemented in this build. ` +
        `Use MODEL_API_AUTH=api-key with MODEL_API_KEY, or leave MODEL_API_AUTH unset to derive it from MODEL_API_KIND.`,
    );
  }
  if (raw !== derived) {
    throw new ModelConfigurationError(
      `MODEL_API_AUTH=${raw} contradicts MODEL_API_KIND=${kind}, which authenticates with '${derived}'. ` +
        `Leave MODEL_API_AUTH unset to derive it, or change MODEL_API_KIND to the dialect you meant.`,
    );
  }
  return raw as ModelApiAuth;
}

/**
 * Resolved chat-completions base URL (env override or the default above).
 *
 * Under `azure-openai` this is the RESOURCE ENDPOINT rather than an
 * OpenAI-style base; `azureBaseUrl` below derives the client's base from it.
 * Unchanged for the default dialect: unset still resolves to the reference
 * deployment's endpoint.
 */
export function getModelApiBaseUrl(): string {
  return process.env.MODEL_API_BASE_URL || DEFAULT_BASE_URL;
}

/**
 * OpenAI's own chat-completions host. The ONE base URL for which `openai` is a
 * statement about the configuration rather than a guess about it.
 *
 * Compared by hostname rather than by prefix so that a path, a trailing slash
 * or a port cannot make a lookalike host match, and a legitimately-written
 * `https://api.openai.com/v1` fails to.
 */
const OPENAI_OWN_HOST = 'api.openai.com';

function isOpenAiOwnHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === OPENAI_OWN_HOST;
  } catch {
    // An unparseable base URL is certainly not OpenAI's host. It is not this
    // function's job to refuse it — `createModelClient` does that.
    return false;
  }
}

/**
 * The OTel `gen_ai.system` value for the resolved endpoint — the trace
 * attribute naming which GenAI API answered (website#30 P3 E5, corrected in P6
 * F4).
 *
 * VERIFIED AGAINST THE DECLARED VERSION, not assumed. `CIVICAITOOLS_TRACE_CONFIG`
 * (the harness's `capture/trace.ts`, re-exported by `src/lib/evidence/trace.ts`)
 * declares `semconvVersion: '1.30.0'`, and every span this app writes carries
 * that version as `otel.semconv.version`. Read against the v1.30.0 text of
 * `docs/gen-ai/gen-ai-spans.md` (2026-08-24):
 *
 *   - `gen_ai.system` is **Required**, so it is emitted on every inference
 *     span. Omitting it where no listed value fits — the tempting move — is
 *     not available: it would break conformance with the version the package
 *     itself declares.
 *   - Its well-known values are fourteen vendor names; `az.ai.openai` and
 *     `openai` are among them, `openrouter` is not, and neither is `_OTHER`
 *     (that value is in the table for `error.type`). What the same document
 *     says instead is: "If one of them applies, then the respective value MUST
 *     be used; otherwise, a custom value MAY be used", and, in the attribute's
 *     own note, "For custom model, a custom friendly name SHOULD be used."
 *
 * WHY NOT DEFAULT TO `openai`. The note also says that where several systems
 * are reachable through OpenAI client libraries the value "is set to `openai`
 * based on the instrumentation's best knowledge", and that "the `server.address`
 * attribute may help identify the actual system in use for `openai`". That
 * disambiguation is exactly what this app does not offer: a resource hostname
 * is the deployer's infrastructure and never enters a signed package (P3). So
 * the reading that leans on `server.address` is the wrong reading HERE — it
 * would put a vendor name nobody configured into a public trace with nothing
 * beside it to correct the impression.
 *
 * WHAT IS EMITTED, and what each value is derived from:
 *
 *   azure-openai                      → `az.ai.openai`   (well-known)
 *   openai-compatible @ the default   → `openrouter`     (custom, unchanged)
 *   openai-compatible @ OpenAI's host → `openai`         (well-known)
 *   openai-compatible @ anywhere else → `openai-compatible`, the CUSTOM value
 *
 * The last one is the correction. It is `MODEL_API_KIND` itself — declared
 * configuration, not an inference about a URL — so the span says what the
 * operator told this build and nothing more. It also agrees with the PROV model
 * agent's description in the same package, which already says "an
 * OpenAI-compatible chat-completions API" rather than naming a vendor.
 *
 * The built-in default keeps `openrouter`: semconv's escape for a system with
 * no well-known value is a custom one, the provider's name in lowercase is what
 * that convention produces, and the reference instance's traces therefore do
 * not move on this attribute.
 *
 * Note what this still does NOT add: `server.address`. See above — the
 * omission is deliberate and it is why the fallback had to change.
 */
export function getGenAiSystem(): string {
  const kind = getModelApiKind();
  if (kind === 'azure-openai') return 'az.ai.openai';
  const baseUrl = getModelApiBaseUrl();
  if (baseUrl === DEFAULT_BASE_URL) return 'openrouter';
  if (isOpenAiOwnHost(baseUrl)) return 'openai';
  return kind;
}

/**
 * Whether a streaming request may ask the endpoint to report token usage.
 *
 * Usage is read only from the final chunk, and under the OpenAI dialect a
 * streaming response carries no `usage` object at all unless it is requested —
 * which is why every streamed answer this app has published recorded zero
 * prompt and completion tokens (website#30 P3, §2.5).
 * `stream_options: { include_usage: true }` is the OpenAI-dialect parameter
 * that asks for it.
 *
 * ON THE BUILT-IN DEFAULT ENDPOINT THE PARAMETER IS A NO-OP, and that is
 * recorded rather than assumed (website#30 P6 F4/F7). OpenRouter's own
 * usage-accounting documentation, read 2026-08-24, says: "The
 * `usage: { include: true }` and `stream_options: { include_usage: true }`
 * parameters are deprecated and have no effect. Full usage details are now
 * always included automatically in every response" — "in the last SSE message
 * for streaming responses". So on the reference instance the parameter is
 * accepted and ignored, not a 400 waiting to happen; a live production query
 * on 2026-08-24 confirmed the path answers. It is still sent, because this
 * dialect is not one endpoint: an OpenAI-compatible endpoint that has not
 * made the same change still needs to be asked.
 *
 * Asked only under `openai-compatible`. Under `azure-openai` the parameter's
 * availability is an api-version question — an api-version that does not know
 * it answers 400 for the whole request rather than ignoring the field — and
 * this build cannot know which version an operator's deployment admits. A
 * missing token count is recorded as missing (see `packager.ts`); a refused
 * request would be a lost answer.
 */
export function includeStreamUsage(): boolean {
  return getModelApiKind() === 'openai-compatible';
}

/**
 * The Azure client's base URL, derived from the resource endpoint.
 *
 * Measured, not assumed (Node 22, local fake server — see the test): the SDK's
 * own `endpoint` option does exactly `${endpoint}/openai`, and passing that
 * result as `baseURL` produces a byte-identical request. `baseURL` is passed
 * instead of `endpoint` for two reasons: `endpoint` and `baseURL` are mutually
 * exclusive in the SDK constructor AND `baseURL` silently defaults from
 * `process.env.OPENAI_BASE_URL`, so an unrelated variable in the environment
 * would otherwise turn a correct configuration into a constructor throw.
 *
 * An endpoint already written with the `/openai` suffix is accepted as-is, so
 * that a documented resource URL copied either way resolves the same.
 */
function azureBaseUrl(resourceEndpoint: string): string {
  const trimmed = resourceEndpoint.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/openai') ? trimmed : `${trimmed}/openai`;
}

/** The fully resolved endpoint configuration. Presence-checked, never echoed. */
export interface ModelEndpointConfig {
  kind: ModelApiKind;
  auth: ModelApiAuth;
  /** As configured: an OpenAI-style base URL, or an Azure resource endpoint. */
  baseUrl: string;
  /** Present only under `azure-openai`, where it is required. */
  apiVersion?: string;
}

/**
 * Resolve every endpoint setting, or throw the first typed refusal.
 *
 * Reads no credential: this is the shape of the endpoint, not the right to
 * call it. Order is deliberate — the dialect is resolved first because every
 * other question ("is a version required?", "is the base URL a resource
 * endpoint?") is asked of a dialect.
 */
export function resolveModelEndpointConfig(): ModelEndpointConfig {
  const kind = getModelApiKind();
  const auth = getModelApiAuth(kind);

  if (kind !== 'azure-openai') {
    return { kind, auth, baseUrl: getModelApiBaseUrl() };
  }

  // Under the Azure dialect an api-version is part of every URL. There is no
  // safe default: versions gate which request and response fields exist, so a
  // guessed one silently changes what the endpoint answers. Refuse instead —
  // an operability refusal, raised before any upstream call.
  const apiVersion = readSetting('MODEL_API_VERSION');
  if (apiVersion === undefined) {
    throw new ModelConfigurationError(
      `MODEL_API_VERSION is required when MODEL_API_KIND=azure-openai and is missing or empty in the server environment. ` +
        `Set it to the api-version your deployment accepts (the value your resource's documentation gives for chat completions) and restart the server.`,
    );
  }

  // Equally, no default resource endpoint exists — the built-in default is an
  // OpenAI-compatible gateway, which would be the wrong host in the wrong
  // dialect. `getModelApiBaseUrl()` is not consulted here on purpose: its
  // fallback is exactly the value that must not be accepted.
  const resourceEndpoint = readSetting('MODEL_API_BASE_URL');
  if (resourceEndpoint === undefined) {
    throw new ModelConfigurationError(
      `MODEL_API_BASE_URL is required when MODEL_API_KIND=azure-openai and is missing or empty in the server environment. ` +
        `Set it to your resource endpoint (the https:// origin of the resource, without a path) and restart the server.`,
    );
  }

  return { kind, auth, baseUrl: resourceEndpoint, apiVersion };
}

/**
 * Request-path guard: returns a typed `ModelConfigurationError` when the
 * environment cannot describe a usable model endpoint — an unrecognized
 * dialect, a dialect missing a setting it requires, or no usable credential
 * (missing or empty `MODEL_API_KEY`, with `OPENROUTER_API_KEY` accepted as its
 * prior-era name) — or null when a request could be made. Detectable before
 * any upstream call: routes use this to fail fast instead of opening the model
 * pipeline. Deliberately a check-and-return (not a throw) so routes can shape
 * their own response (SSE error event vs. JSON status).
 */
export function getMissingModelCredentialError(): ModelConfigurationError | null {
  try {
    resolveModelEndpointConfig();
  } catch (error) {
    if (error instanceof ModelConfigurationError) return error;
    throw error;
  }
  const { raw } = resolveModelApiKeyFromEnv();
  if (!raw || raw.trim() === '') {
    return new ModelConfigurationError(MISSING_CREDENTIAL_MESSAGE);
  }
  return null;
}

/**
 * Classify a request-path model failure into a typed, operator-actionable
 * code, or null for anything else (network errors, model errors — those keep
 * their existing handling).
 *
 * - `model_not_configured`: our typed guard error, or the SDK's own
 *   missing-credentials constructor error (belt and braces — the guard should
 *   fire first; both the OpenAI and the Azure constructor use that wording).
 * - `model_auth_rejected`: the configured endpoint answered 401/403 (or an
 *   equivalent auth rejection), i.e. a credential exists but was refused
 *   upstream. Shape-based (`status` on the SDK's APIError) rather than
 *   instanceof so it survives SDK class-identity quirks and stays unit-testable.
 * - `model_rate_limited`: the configured endpoint answered 429, i.e. the MODEL
 *   SERVICE is limiting this instance (website#30 G0 D6). This is where the two
 *   429s part company, and it is deliberately here rather than in
 *   `classifyStreamError`: only an error thrown by the SDK reaches this
 *   function, so a 429 seen here is unambiguously the endpoint's, while a 429
 *   seen by the stream classifier is this app's own limiter answering a
 *   request. Text could not tell them apart; the shape can.
 *
 *   This matters most under a deployment-routed dialect, where quota is
 *   per-model and per-region: an upstream 429 there is routine operational
 *   information about one deployment's pool, and reporting it as the reader's
 *   own exhausted daily allowance is simply false.
 */
export function classifyModelError(error: unknown): ModelErrorCode | null {
  if (error instanceof ModelConfigurationError) return 'model_not_configured';
  if (error instanceof Error && /missing credentials/i.test(error.message)) {
    return 'model_not_configured';
  }
  if (error !== null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 401 || status === 403) return 'model_auth_rejected';
    if (status === 429) return 'model_rate_limited';
  }
  return null;
}

/**
 * Build a new client against the configured endpoint. Pass `apiKey` to use a
 * caller-supplied key; omitted, the key comes from `MODEL_API_KEY` (or its
 * prior-era name `OPENROUTER_API_KEY`).
 *
 * Throws a typed `ModelConfigurationError` when the endpoint configuration is
 * unusable or no key resolves. That replaces three silent-failure shapes: the
 * SDK's generic constructor error for an unset key; an empty-string key, which
 * the OpenAI constructor accepts and then sends as a blank bearer token
 * upstream; and the Azure constructor's api-version error, which names the
 * SDK's own `OPENAI_API_VERSION` variable rather than this app's.
 *
 * WHAT THE AZURE CLIENT EMITS, measured rather than assumed (Node 22, against
 * a local fake HTTP server; see `model-client.test.ts`): with `baseURL` set to
 * `<resource>/openai` and `apiVersion` supplied, `chat.completions.create`
 * POSTs to `/openai/deployments/{model}/chat/completions?api-version=…` with
 * an `api-key` header and NO `Authorization` header, where `{model}` is the
 * value the caller passed as `model` — so on this dialect the `model`
 * parameter carries the DEPLOYMENT NAME. The request body is unchanged, model
 * slug included. Selecting the deployment per call rather than pinning one on
 * the client is what keeps a single lazily-built client usable for the
 * analysis and evaluator models alike.
 */
export function createModelClient(opts: { apiKey?: string } = {}): OpenAI {
  const config = resolveModelEndpointConfig();
  const apiKey = opts.apiKey ?? resolveModelApiKeyFromEnv().raw;
  if (!apiKey || apiKey.trim() === '') {
    throw new ModelConfigurationError(MISSING_CREDENTIAL_MESSAGE);
  }

  if (config.kind === 'azure-openai') {
    return new AzureOpenAI({
      baseURL: azureBaseUrl(config.baseUrl),
      apiKey,
      // Non-null: `resolveModelEndpointConfig` refuses this dialect without it.
      apiVersion: config.apiVersion!,
    });
  }

  return new OpenAI({
    baseURL: config.baseUrl,
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
