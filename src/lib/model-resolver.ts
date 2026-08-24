import { readFileSync } from 'node:fs';
import {
  BUILT_IN_CATALOG,
  catalogDefaultEntry,
  catalogEvaluatorOrder,
  findCatalogEntry,
  selectableModels,
  validateCatalog,
  type CatalogEntry,
  type ModelDefinition,
} from './model-catalog.ts';
import {
  DEFAULT_BASE_URL,
  ModelConfigurationError,
  getModelApiBaseUrl,
  getModelApiKind,
} from './model-client.ts';

/**
 * The model resolver — the one lookup every call site uses, and the only place
 * an instance's model catalog is read from its environment.
 *
 * DELIVERY (website#30 G0 D1 — both forms, one schema, env primary):
 *
 *   MODEL_CATALOG       — the catalog as a JSON document in the variable
 *     itself. Works where a file cannot be mounted: a Vercel project's
 *     environment, or an `op run` injection from a secret manager.
 *   MODEL_CATALOG_PATH  — a path to the same JSON document on disk, for a
 *     container that mounts config rather than passing a long value through
 *     its environment.
 *
 * Both set is a REFUSAL, not a precedence rule. Two catalogs in one environment
 * is an operator who believes something false about which models this instance
 * offers, and silently picking one would leave that belief in place — while the
 * bytes it produces go into signed records.
 *
 * BUILT-IN RETENTION (D2): the built-in catalog is the default ONLY while the
 * resolved endpoint is the OpenRouter default. There, every `endpointModel` is
 * a public slug identical to its id, so the built-in list asserts nothing a
 * record could get wrong — the slug called is the slug recorded. Point the app
 * at any other endpoint and that stops being true: the same slugs may name
 * nothing, or name something else. Any other endpoint with no catalog is
 * therefore refused by name, before any upstream call.
 *
 * MEMOIZATION mirrors `getModelClient()` in model-client.ts: resolved once per
 * process, so a catalog change needs a restart. Every refusal below says so.
 *
 * WHAT THIS PHASE DELIBERATELY DOES NOT DO. Call sites resolve an id to an
 * entry and still send `entry.id` on the wire, not `entry.endpointModel`. That
 * is not an oversight: today every call site uses ONE string for two jobs — the
 * wire parameter AND the identity that lands in `analysis.model`, in the
 * notebook stamp, and in an evaluation attestation's methodology. Swapping in
 * `endpointModel` here without splitting those two jobs would push a deployment
 * name into signed output, which is the exact defect this sprint exists to
 * prevent. The split belongs to website#30 P3, which owns the identity sites.
 * Nothing is wrong in the meantime: under the built-in catalog every entry's
 * `endpointModel` IS its `id` (pinned by a test), and a catalog where they
 * differ only reaches an endpoint that P3 lands before P4 documents.
 *
 * WHY THIS FILE IS SEPARATE FROM `model-catalog.ts`: this one reaches
 * `node:fs` and `process.env` and imports the SDK-bearing endpoint layer, so it
 * is server-only. The schema, the built-in list and the projection live in the
 * pure half, which two client components reach through `models.ts`.
 */

const CATALOG_ENV = 'MODEL_CATALOG';
const CATALOG_PATH_ENV = 'MODEL_CATALOG_PATH';

/**
 * A caller named a model this instance does not offer.
 *
 * Distinct from `ModelConfigurationError` on purpose: that one says the
 * operator's environment is wrong (an operability failure, 5xx), this one says
 * the REQUEST is wrong (a caller failure, 4xx). Before this phase an unknown id
 * was forwarded upstream and the endpoint decided — which meant an id this
 * instance never offered could still reach a model, be billed, and land in a
 * record's `cost.model`. It is now refused before any upstream call.
 */
export class ModelNotOfferedError extends Error {
  readonly code = 'model_not_offered';
  readonly modelId: string;

  constructor(modelId: string, offered: string[]) {
    super(
      `The model "${modelId}" is not offered by this instance. ` +
        `Choose one of: ${offered.join(', ')}.`,
    );
    this.name = 'ModelNotOfferedError';
    this.modelId = modelId;
  }
}

/** Trimmed environment read: unset, empty and whitespace-only are all absent. */
function readSetting(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * True when this instance runs against the endpoint the built-in catalog
 * describes. The dialect is checked as well as the URL: under `azure-openai`
 * the resolved base URL is a resource endpoint, and `getModelApiBaseUrl()`
 * would otherwise report the OpenRouter default for an Azure instance that has
 * not set `MODEL_API_BASE_URL` — a configuration `resolveModelEndpointConfig()`
 * refuses anyway, but this predicate must not depend on that ordering.
 */
function isBuiltInEndpoint(): boolean {
  return getModelApiKind() === 'openai-compatible' && getModelApiBaseUrl() === DEFAULT_BASE_URL;
}

function readCatalogFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // The path itself is not echoed: this message reaches server logs, and the
    // operator knows what they set. Naming the variable is what makes it
    // actionable (same discipline as the endpoint layer, which echoes no
    // configured value).
    throw new ModelConfigurationError(
      `${CATALOG_PATH_ENV} names a file this server cannot read. ` +
        `Check that the path is correct, that the file exists inside the container, and that the server process can read it; then restart the server.`,
    );
  }
}

function loadCatalog(): readonly CatalogEntry[] {
  const inline = readSetting(CATALOG_ENV);
  const path = readSetting(CATALOG_PATH_ENV);

  if (inline !== undefined && path !== undefined) {
    throw new ModelConfigurationError(
      `${CATALOG_ENV} and ${CATALOG_PATH_ENV} are both set, and they are two ways to deliver the SAME catalog. ` +
        `This is refused rather than resolved by precedence: whichever one lost would be a list of models an operator believes this instance offers and it does not. ` +
        `Unset one of them and restart the server.`,
    );
  }

  if (inline === undefined && path === undefined) {
    if (isBuiltInEndpoint()) return BUILT_IN_CATALOG;
    throw new ModelConfigurationError(
      `${CATALOG_ENV} is required when this instance does not use the built-in model endpoint. ` +
        `The built-in model list names public OpenRouter slugs; against any other endpoint those ids may name nothing, or name something else, and the identity they would put in a signed record would be a guess. ` +
        `Declare this instance's models in ${CATALOG_ENV} (or in a file named by ${CATALOG_PATH_ENV}) and restart the server.`,
    );
  }

  const source = inline !== undefined ? CATALOG_ENV : `${CATALOG_PATH_ENV} (the file it names)`;
  const text = inline !== undefined ? inline : readCatalogFile(path as string);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ModelConfigurationError(
      `${source} does not contain valid JSON. The catalog is a JSON array of model entries. Fix it and restart the server.`,
    );
  }

  const result = validateCatalog(parsed, { source, kind: getModelApiKind() });
  if (!result.ok) throw new ModelConfigurationError(result.message);
  return result.catalog;
}

let cachedCatalog: readonly CatalogEntry[] | null = null;

/**
 * This instance's model catalog. Throws a typed `ModelConfigurationError` when
 * the environment cannot describe one — always before any upstream call.
 */
export function getModelCatalog(): readonly CatalogEntry[] {
  if (!cachedCatalog) cachedCatalog = loadCatalog();
  return cachedCatalog;
}

/** Test support: drop the memoized catalog so env changes take effect. */
export function _resetModelCatalogForTests(): void {
  cachedCatalog = null;
}

/**
 * The entry this instance offers under `id`, or a typed not-offered error.
 * Non-selectable entries resolve: `selectable` governs what `/api/models`
 * lists, not what a caller may name.
 */
export function resolveModel(id: string): CatalogEntry {
  const catalog = getModelCatalog();
  const entry = findCatalogEntry(catalog, id);
  if (!entry) throw new ModelNotOfferedError(id, catalog.map((e) => e.id));
  return entry;
}

/** The models `/api/models` serves, in catalog order. */
export function getOfferedModels(): ModelDefinition[] {
  return selectableModels(getModelCatalog());
}

/** The entry a caller gets when it names no model. */
export function getDefaultModel(): CatalogEntry {
  return catalogDefaultEntry(getModelCatalog());
}

/**
 * The publication gate's evaluator, given the model that produced the analysis.
 *
 * Evaluator independence (civic-ai-tools#72, Q26): the evaluator must differ
 * from the analysis model, so the declared preference order is walked and the
 * first candidate that is not the analysis model wins. Null when every declared
 * candidate IS the analysis model — an instance-configuration answer the caller
 * cannot fix by retrying, which the publish route reports as such.
 */
export function resolveEvaluatorModel(analysisModelId: string): CatalogEntry | null {
  const candidates = catalogEvaluatorOrder(getModelCatalog());
  return candidates.find((e) => e.id !== analysisModelId) ?? null;
}
