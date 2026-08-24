import { readFileSync } from 'node:fs';
import {
  BUILT_IN_CATALOG,
  carriedModelIdentity,
  catalogDefaultEntry,
  catalogEvaluatorOrder,
  catalogSummarizerEntry,
  declaredModelIdentity,
  findCatalogEntry,
  modelIdentity,
  selectableModels,
  validateCatalog,
  type CatalogEntry,
  type ModelDefinition,
  type ModelIdentity,
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
 * THE SPLIT, PERFORMED (website#30 P3). P2 resolved an id to an entry and then
 * sent `entry.id` on the wire, because one string was still doing two jobs —
 * the wire parameter AND the identity that lands in `analysis.model`, in the
 * notebook stamp, in `cost.model`, and in an evaluation attestation's
 * methodology. Threading `endpointModel` before separating those jobs would
 * have pushed a deployment name into signed output, which is the defect this
 * sprint exists to prevent. Call sites now take a `ModelIdentity` — both
 * strings, each addressed to exactly one audience — so the wire gets
 * `endpointModel` and every recorded field gets `declared`.
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
 *
 * The argument is the analysis model's DECLARED identity, because the only
 * place the caller can read it from is `pkg.cost.model` inside a signed
 * package — so the comparison is declared-against-declared (website#30 P3).
 * Comparing an id against a recorded identity would be comparing two
 * namespaces, and under a catalog where they differ the gate would happily
 * pick the analysis model to grade itself.
 */
export function resolveEvaluatorModel(analysisModel: string): CatalogEntry | null {
  const candidates = catalogEvaluatorOrder(getModelCatalog());
  return candidates.find((e) => declaredModelIdentity(e) !== analysisModel) ?? null;
}

/** The entry that drafts publish-dialog summaries (`summarizer`, else default). */
export function getSummarizerModel(): CatalogEntry {
  return catalogSummarizerEntry(getModelCatalog());
}

// --- The identity pair every call site carries (website#30 P3) --------------

/** The wire/record pair for an id this instance offers, or a typed refusal. */
export function resolveModelIdentity(id: string): ModelIdentity {
  return modelIdentity(resolveModel(id));
}

/**
 * Best-effort pair for a string that need not be an offered id.
 *
 * An id the catalog describes resolves to its pair; anything else is carried
 * through on both sides, unchanged.
 *
 * Four call sites take this path and none of them is a model selection:
 * `POST /api/evidence`, whose `model` field an external publisher supplies for
 * an analysis this instance never ran; the evaluation preview, which runs a
 * caller's own key against a model they named from a dialog whose list
 * website#30 P4 still owns; and the two comparison routes, which have never
 * validated a caller's model id. All four predate the catalog, so introducing
 * a refusal here would be a product change rather than this phase's split.
 *
 * A catalog this instance cannot read is the same case, deliberately: none of
 * those four depended on one, so a broken catalog must not be the thing that
 * turns them into failures. The paths that DO select a model
 * (`resolveModelIdentity`, `getDefaultModel`, `getSummarizerModel`) refuse
 * loudly instead.
 */
export function modelIdentityForValue(value: string): ModelIdentity {
  let catalog: readonly CatalogEntry[];
  try {
    catalog = getModelCatalog();
  } catch {
    return carriedModelIdentity(value);
  }
  const entry = findCatalogEntry(catalog, value);
  return entry ? modelIdentity(entry) : carriedModelIdentity(value);
}

/**
 * The reverse direction: given an identity read out of an already-signed
 * package, the wire string that reaches that model at THIS instance's
 * endpoint. Falls back to the recorded string when no entry declares it —
 * a record may name a model this instance no longer offers, which the replay
 * path has always had to tolerate.
 */
export function endpointModelForDeclared(declared: string): string {
  let catalog: readonly CatalogEntry[];
  try {
    catalog = getModelCatalog();
  } catch {
    return declared;
  }
  const entry = catalog.find((e) => declaredModelIdentity(e) === declared);
  return entry ? entry.endpointModel : declared;
}
