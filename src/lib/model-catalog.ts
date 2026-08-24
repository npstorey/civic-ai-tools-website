import type { ModelApiKind } from './model-client.ts';

/**
 * The model catalog — the shape of one instance's model list, the built-in
 * list the reference instance runs on, and the mechanical validation an
 * operator-supplied list has to pass.
 *
 * WHY THIS MODULE EXISTS. Before it, five hardcoded tables described the same
 * models and drifted independently: the offered list (`availableModels` in
 * mcp/tools.ts), the pricing table and the display-name map (both in
 * models.ts), the publication gate's two evaluator literals, and the notebook
 * route's default. Each answered a different question about the same id and
 * nothing kept them in agreement — #232 is that defect class already having
 * happened once.
 *
 * WHY IT IS SPLIT IN TWO. This half is PURE: no `process.env`, no `node:fs`,
 * no SDK. It has to be, because `models.ts` re-exports display and cost
 * helpers into two client components (`ProvenanceChain`, `ChatNotebookOutput`),
 * and a client bundle cannot reach a module that imports `node:fs`. Everything
 * that reads the environment — the two delivery forms, the built-in retention
 * rule, memoization — lives in `model-resolver.ts`, which is server-only. The
 * one import here is type-only and erased at compile time.
 *
 * THE EVIDENCE-INTEGRITY RULE THIS ENCODES. An entry separates three strings
 * that were one string before:
 *
 *   - `id`          — what a caller asks for and what `/api/models` serves.
 *   - `endpointModel` — what goes on the wire as `model`. An OpenRouter slug
 *     under the OpenAI-compatible dialect; an Azure DEPLOYMENT NAME under
 *     `azure-openai`, which is an operator's private label for a resource and
 *     asserts nothing about which model actually answered.
 *   - `model`       — the operator-DECLARED identity that signed output will
 *     assert. Consumed by website#30 P3; carried, not read, here.
 *
 * Under `openai-compatible` an entry may omit `model`: omission declares that
 * the identity IS `endpointModel`, which is true because the slug called is
 * the slug recorded. Under `azure-openai` that reasoning does not hold — a
 * deployment name is not a model identity — so `model` is REQUIRED per entry
 * and its absence is a refusal, not a default. That single asymmetry is the
 * reason this phase exists (ADR-0024 §A: on the evidence path, configuration
 * is absent-or-error, never defaulted).
 *
 * VALIDATION IS MECHANICAL (ADR-0024 §E). Every failure below names the entry
 * and the field, and returns rather than throws, so the pure half stays
 * testable without an environment and the server half owns the error type.
 */

/**
 * The seven fields `/api/models` serves, in the order the response has always
 * carried them. Unchanged from the pre-catalog `ModelDefinition` — the shape is
 * a wire contract with `parseModelsResponse` (src/lib/model-list.ts, #283) and
 * with `QueryForm`'s selector, and this phase does not touch it.
 */
export interface ModelDefinition {
  id: string;
  name: string;
  tag?: string; // short descriptor shown in dropdown only (e.g. "recommended")
  provider: string;
  supports_tools: boolean;
  description?: string;
  maxTokenBudget?: number; // per-model token limit override
}

/** Per-1M-token prices in USD. */
export interface ModelPricing {
  input: number;
  output: number;
}

/**
 * One catalog entry: the served fields plus the four this phase adds.
 *
 * `selectable` exists because two of this instance's reachable models are not
 * offered in the selector — the notebook route's default and the publication
 * gate's preferred evaluator are the same id, and it has never appeared in
 * `/api/models`. Suppressing it from the served list is what keeps that
 * response byte-identical while the id stays resolvable.
 */
export interface CatalogEntry extends ModelDefinition {
  /** The string sent as `model` on the wire (slug, or Azure deployment name). */
  endpointModel: string;
  /**
   * The operator-declared model identity signed output asserts. Omitted under
   * `openai-compatible` means "the same as `endpointModel`"; required under
   * `azure-openai`. Read `declaredModelIdentity()` rather than this field.
   */
  model?: string;
  /** False suppresses the entry from `/api/models`; it stays resolvable by id. */
  selectable?: boolean;
  /** Exactly one entry carries `true`: the notebook route's default model. */
  default?: boolean;
  /**
   * Rank in the publication gate's evaluator preference order — lower is
   * preferred. The gate walks this order and takes the first entry that is not
   * the analysis model (evaluator independence).
   */
  evaluator?: number;
  /**
   * At most one entry carries `true`: the model that drafts the one-paragraph
   * plain-language summary the publish dialog offers. Optional — the catalog
   * default stands in when no entry claims the role. That stand-in is not the
   * absent-or-error case ADR-0024 §A governs: the draft is a convenience the
   * publisher edits before anything is signed, so it is not on the evidence
   * path, and refusing to publish because no summariser was declared would be
   * a refusal out of all proportion to what the field decides.
   */
  summarizer?: boolean;
  /** Per-1M-token prices. Absent means cost estimation returns null. */
  pricing?: ModelPricing;
}

/**
 * The two strings this phase separates (civic-ai-tools-website#30 P3).
 *
 * Everything upstream of a request carries the pair; nothing carries one
 * string doing both jobs. `endpointModel` is addressed to the endpoint and is
 * never recorded; `declared` is addressed to the reader of a signed record and
 * is never sent. Under the built-in catalog they are the same string, which is
 * why the reference instance's bytes do not move.
 */
export interface ModelIdentity {
  /** Sent as `model` on the wire. A slug, or an Azure deployment name. */
  endpointModel: string;
  /** The operator-declared identity a signed record asserts. */
  declared: string;
}

/**
 * The list the reference instance runs on, kept ONLY while the resolved base
 * URL is the OpenRouter default (website#30 G0 D2 — the retention rule is
 * enforced in `model-resolver.ts`). Under that endpoint every `endpointModel`
 * is a public OpenRouter slug identical to its `id`, so the list asserts
 * nothing a record could get wrong: the slug called is the slug recorded, and
 * `model` is correctly omitted throughout.
 *
 * The first three entries are `availableModels` verbatim, in order, with their
 * pricing folded back in. The fourth was never in the selector and is not added
 * to it: it is the notebook route's `DEFAULT_MODEL` and the publication gate's
 * `DEFAULT_EVALUATOR_MODEL`, which were the same literal in two files.
 *
 * WHICH MODELS ARE OFFERED IS NOT THIS PHASE'S QUESTION (civic-ai-tools-website#302
 * holds it). This phase changes only where the list comes from.
 */
export const BUILT_IN_CATALOG: readonly CatalogEntry[] = Object.freeze([
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    tag: 'recommended',
    provider: 'OpenAI',
    supports_tools: true,
    description: 'Best balance of quality and speed',
    endpointModel: 'openai/gpt-4o',
    pricing: { input: 2.5, output: 10.0 },
    // The publication gate's FALLBACK_EVALUATOR_MODEL, at rank 2.
    evaluator: 2,
  },
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    tag: 'premium',
    provider: 'OpenAI',
    supports_tools: true,
    description: 'Highest quality analysis, newest model',
    endpointModel: 'openai/gpt-5.4',
    pricing: { input: 2.5, output: 15.0 },
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    tag: 'fastest',
    provider: 'Google',
    supports_tools: true,
    description: 'Fast and budget-friendly',
    maxTokenBudget: 150_000,
    endpointModel: 'google/gemini-3.5-flash-lite',
    pricing: { input: 0.3, output: 2.5 },
    // The summary-draft route's model, which was the fifth hardcoded slug —
    // `SUMMARY_MODEL` in api/evidence/generate-summary/route.ts, missed by P2's
    // inventory and routed here. Naming it as a role rather than a literal is
    // what makes it configurable per instance and visible to catalog
    // validation; the id is unchanged, so the route calls what it always did.
    summarizer: true,
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    supports_tools: true,
    // Never appeared in `/api/models`, and does not start now: this entry is
    // the pre-catalog notebook default and preferred evaluator, and adding it
    // to the selector would be a product change this phase is not making.
    selectable: false,
    endpointModel: 'anthropic/claude-sonnet-4-6',
    pricing: { input: 3.0, output: 15.0 },
    default: true,
    evaluator: 1,
  },
]);

/**
 * Display names and prices for model ids this instance does NOT offer but whose
 * bytes are already published.
 *
 * This is not a catalog and must not become one. `cost.model` inside a signed
 * package is history: the record detail page, the provenance chain and the
 * notebook output all render it long after the roster that produced it changed.
 * Dropping these three ids would regress those surfaces from "Claude Opus 5"
 * and a cost estimate to a raw slug and a blank — a reader-facing loss, and the
 * wrong side of "user language not implementation language"
 * (docs/design-principles.md).
 *
 * Pricing and display for a NON-OFFERED id is therefore deliberately not the
 * catalog's business. It stays a built-in constant: never operator-supplied,
 * never served, never resolvable by `resolveModel`. Adding a row here does not
 * offer a model; it teaches the renderer a name for bytes that already exist.
 */
const HISTORICAL_MODELS: Readonly<Record<string, { name: string; pricing: ModelPricing }>> =
  Object.freeze({
    'anthropic/claude-sonnet-4': { name: 'Claude Sonnet 4', pricing: { input: 3.0, output: 15.0 } },
    'anthropic/claude-opus-5': { name: 'Claude Opus 5', pricing: { input: 5.0, output: 25.0 } },
    'anthropic/claude-haiku-4.5': { name: 'Claude Haiku 4.5', pricing: { input: 1.0, output: 5.0 } },
  });

/**
 * The identity signed output asserts for this entry (website#30 P3 consumes
 * this; nothing in P2 reads it). Under `openai-compatible` an omitted `model`
 * resolves to `endpointModel`; under `azure-openai` validation guarantees
 * `model` is present, so the fallback is unreachable there.
 */
export function declaredModelIdentity(entry: CatalogEntry): string {
  return entry.model ?? entry.endpointModel;
}

/** The wire/record pair for one entry. The only way to obtain both strings. */
export function modelIdentity(entry: CatalogEntry): ModelIdentity {
  return { endpointModel: entry.endpointModel, declared: declaredModelIdentity(entry) };
}

/**
 * A string that is not an offered catalog id, carried on both sides.
 *
 * Two call sites need this and neither is a model selection: `POST
 * /api/evidence`, whose `model` field an external publisher supplies for an
 * analysis this instance never ran, and the replay path, which reads an
 * identity out of an already-signed package. Both predate the catalog and
 * neither has ever been validated against it; refusing them here would break
 * publishing from outside the app to close a hole that does not exist, since
 * an id the catalog does not describe has no second string to be wrong about.
 */
export function carriedModelIdentity(value: string): ModelIdentity {
  return { endpointModel: value, declared: value };
}

/**
 * How a record describes the endpoint a model was reached through, per wire
 * dialect (civic-ai-tools-website#30 P3, E4/E6).
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY. Not the resource host, not the
 * deployment name, not the vendor's product name — a public record must not
 * carry the deployer's infrastructure identifiers, and the operator of an
 * Azure resource did not choose to publish its brand alongside their analysis.
 * What is left is the only part a reader can act on: how the endpoint is
 * addressed. One dialect addresses a model by slug at a shared path; the other
 * addresses a deployment by name. That is the whole difference, and it is
 * exactly what `MODEL_API_KIND` selects.
 *
 * Before this phase both strings were the reference deployment's own — "via
 * OpenRouter", spread out of the harness's reference config and stamped into
 * the notebook — so every instance asserted a fact about somebody else's
 * gateway.
 */
const MODEL_ACCESS_PHRASE: Record<ModelApiKind, string> = Object.freeze({
  'openai-compatible': 'an OpenAI-compatible chat-completions API',
  'azure-openai': 'a deployment-routed chat-completions API',
});

/** The phrase completing "…reached over ___" for this instance's dialect. */
export function modelAccessPhrase(kind: ModelApiKind): string {
  return MODEL_ACCESS_PHRASE[kind];
}

/**
 * `dcterms:description` for the PROV-O model agent (E4).
 *
 * Replaces the harness's `CIVICAITOOLS_PROVENANCE_CONFIG.modelAgentDescription`,
 * which reads "Large language model via OpenRouter" — the reference
 * deployment's value, and false on any instance pointed elsewhere. The harness
 * treats an absent description as honest omission; a derived one is preferred
 * here because the field still has something true to say.
 */
export function modelAgentDescription(kind: ModelApiKind): string {
  return `Large language model reached over ${modelAccessPhrase(kind)}`;
}

/**
 * Project one entry down to the seven served fields, in the response's
 * historical key order, omitting absent optionals rather than emitting them.
 * Key order is load-bearing: `/api/models` must stay byte-identical.
 */
export function projectServedModel(entry: CatalogEntry): ModelDefinition {
  return {
    id: entry.id,
    name: entry.name,
    ...(entry.tag !== undefined ? { tag: entry.tag } : {}),
    provider: entry.provider,
    supports_tools: entry.supports_tools,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.maxTokenBudget !== undefined ? { maxTokenBudget: entry.maxTokenBudget } : {}),
  };
}

/** The catalog as `/api/models` serves it: selectable entries, catalog order. */
export function selectableModels(catalog: readonly CatalogEntry[]): ModelDefinition[] {
  return catalog.filter((e) => e.selectable !== false).map(projectServedModel);
}

/** The entry offered under `id`, or undefined. Selectability is not consulted. */
export function findCatalogEntry(
  catalog: readonly CatalogEntry[],
  id: string,
): CatalogEntry | undefined {
  return catalog.find((e) => e.id === id);
}

/** The single `default: true` entry. Validation guarantees exactly one. */
export function catalogDefaultEntry(catalog: readonly CatalogEntry[]): CatalogEntry {
  const entry = catalog.find((e) => e.default === true);
  if (!entry) {
    // Unreachable through the resolver: `validateCatalog` refuses a catalog
    // without exactly one default before it can be returned.
    throw new Error('model catalog has no default entry');
  }
  return entry;
}

/**
 * The entry that drafts publish-dialog summaries: the one carrying
 * `summarizer: true`, or the catalog default when no entry claims the role.
 * Validation guarantees at most one claimant.
 */
export function catalogSummarizerEntry(catalog: readonly CatalogEntry[]): CatalogEntry {
  return catalog.find((e) => e.summarizer === true) ?? catalogDefaultEntry(catalog);
}

/** Evaluator candidates in preference order (lowest `evaluator` rank first). */
export function catalogEvaluatorOrder(catalog: readonly CatalogEntry[]): CatalogEntry[] {
  return catalog
    .filter((e) => typeof e.evaluator === 'number')
    .sort((a, b) => (a.evaluator as number) - (b.evaluator as number));
}

/**
 * Human-readable name for a model id, for rendering a value that is already
 * recorded. Consults the built-in catalog and then the historical table; falls
 * back to the raw id, which is what an operator-configured catalog's ids reach
 * (see the limitation noted in `models.ts`).
 */
export function builtInDisplayName(id: string): string | undefined {
  const entry = findCatalogEntry(BUILT_IN_CATALOG, id);
  if (entry) return entry.name;
  return HISTORICAL_MODELS[id]?.name;
}

/** Prices for a model id, from the built-in catalog then the historical table. */
export function builtInPricing(id: string): ModelPricing | undefined {
  const entry = findCatalogEntry(BUILT_IN_CATALOG, id);
  if (entry?.pricing) return entry.pricing;
  return HISTORICAL_MODELS[id]?.pricing;
}

// --- Mechanical validation (ADR-0024 §E) ---

export type CatalogValidation =
  | { ok: true; catalog: CatalogEntry[] }
  | { ok: false; message: string };

/** Every key an entry may carry. An unknown key is a refusal, not an ignore. */
const KNOWN_ENTRY_KEYS = new Set([
  'id',
  'name',
  'tag',
  'provider',
  'supports_tools',
  'description',
  'maxTokenBudget',
  'endpointModel',
  'model',
  'selectable',
  'default',
  'evaluator',
  'summarizer',
  'pricing',
]);

/** How an entry is named in a refusal: by id when it has a usable one. */
function entryLabel(raw: Record<string, unknown>, index: number): string {
  const id = raw.id;
  return typeof id === 'string' && id.trim() !== ''
    ? `entry "${id}"`
    : `entry #${index + 1}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  raw: Record<string, unknown>,
  field: string,
  label: string,
  source: string,
): string | { message: string } {
  const value = raw[field];
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      message:
        `${source} is invalid: ${label} has no usable "${field}". ` +
        `Give every entry a non-empty string "${field}", then restart the server.`,
    };
  }
  return value;
}

/**
 * Validate a parsed catalog document against the schema, for one wire dialect.
 *
 * `kind` is a parameter rather than an environment read so this stays pure and
 * so the azure-only rule can be tested without an Azure endpoint. `source` is
 * the operator-facing name of where the document came from, and appears at the
 * head of every message so a refusal says which variable to edit.
 */
export function validateCatalog(
  document: unknown,
  opts: { source: string; kind: ModelApiKind },
): CatalogValidation {
  const { source, kind } = opts;

  if (!Array.isArray(document)) {
    return {
      ok: false,
      message:
        `${source} is not a JSON array. The catalog is a JSON array of model entries ` +
        `(for example: [{"id":"my-model","name":"My Model","provider":"Example",` +
        `"supports_tools":true,"endpointModel":"example-deployment","model":"vendor/model-1",` +
        `"default":true,"evaluator":1}]). Fix it and restart the server.`,
    };
  }

  if (document.length === 0) {
    return {
      ok: false,
      message:
        `${source} is an empty array, so this instance offers no models at all. ` +
        `Declare at least one entry, exactly one of which carries "default": true, and restart the server.`,
    };
  }

  const catalog: CatalogEntry[] = [];
  const seenIds = new Set<string>();
  const seenEvaluatorRanks = new Map<number, string>();
  const defaults: string[] = [];
  const summarizers: string[] = [];

  for (const [index, raw] of document.entries()) {
    if (!isPlainObject(raw)) {
      return {
        ok: false,
        message:
          `${source} is invalid: entry #${index + 1} is not a JSON object. ` +
          `Every element of the catalog array is an object describing one model. Fix it and restart the server.`,
      };
    }

    const label = entryLabel(raw, index);

    for (const key of Object.keys(raw)) {
      if (!KNOWN_ENTRY_KEYS.has(key)) {
        return {
          ok: false,
          message:
            `${source} is invalid: ${label} carries an unknown field "${key}". ` +
            `Accepted fields are: ${[...KNOWN_ENTRY_KEYS].join(', ')}. ` +
            `Check the spelling (an unrecognized field is refused rather than ignored, so a typo cannot silently do nothing) and restart the server.`,
        };
      }
    }

    for (const field of ['id', 'name', 'provider', 'endpointModel'] as const) {
      const value = requireString(raw, field, label, source);
      if (typeof value !== 'string') return { ok: false, message: value.message };
    }
    const id = raw.id as string;
    const endpointModel = raw.endpointModel as string;

    if (seenIds.has(id)) {
      return {
        ok: false,
        message:
          `${source} is invalid: the id "${id}" appears on more than one entry. ` +
          `An id selects exactly one model, so duplicates are refused rather than resolved by position. Remove one and restart the server.`,
      };
    }
    seenIds.add(id);

    if (typeof raw.supports_tools !== 'boolean') {
      return {
        ok: false,
        message:
          `${source} is invalid: ${label} has no usable "supports_tools". ` +
          `Set it to true or false (this instance's query path needs tool calling; a model without it cannot answer a data question) and restart the server.`,
      };
    }

    for (const field of ['tag', 'description'] as const) {
      if (raw[field] !== undefined && typeof raw[field] !== 'string') {
        return {
          ok: false,
          message: `${source} is invalid: ${label} has a non-string "${field}". Remove it or make it a string, then restart the server.`,
        };
      }
    }

    if (raw.maxTokenBudget !== undefined) {
      const budget = raw.maxTokenBudget;
      if (typeof budget !== 'number' || !Number.isInteger(budget) || budget <= 0) {
        return {
          ok: false,
          message: `${source} is invalid: ${label} has a "maxTokenBudget" that is not a positive whole number. Fix it or remove it, then restart the server.`,
        };
      }
    }

    for (const field of ['selectable', 'default', 'summarizer'] as const) {
      if (raw[field] !== undefined && typeof raw[field] !== 'boolean') {
        return {
          ok: false,
          message: `${source} is invalid: ${label} has a non-boolean "${field}". Set it to true or false, or remove it, then restart the server.`,
        };
      }
    }

    // THE RULE THIS PHASE EXISTS FOR. A deployment name is an operator's
    // private label; it asserts nothing about which model answered, so under
    // Azure the declared identity cannot be inferred from the wire string.
    if (raw.model !== undefined && (typeof raw.model !== 'string' || raw.model.trim() === '')) {
      return {
        ok: false,
        message: `${source} is invalid: ${label} has an empty or non-string "model". Give it the model identity this instance will assert in signed records, or remove it, then restart the server.`,
      };
    }
    if (kind === 'azure-openai' && raw.model === undefined) {
      return {
        ok: false,
        message:
          `${source} is invalid: ${label} has no "model", which is required when MODEL_API_KIND=azure-openai. ` +
          `Its "endpointModel" ("${endpointModel}") is a deployment name — an operator's label for a resource — so it cannot stand in for the model identity that signed records will assert. ` +
          `Declare "model" on every entry and restart the server.`,
      };
    }

    if (raw.default === true) defaults.push(id);
    if (raw.summarizer === true) summarizers.push(id);

    if (raw.evaluator !== undefined) {
      const rank = raw.evaluator;
      if (typeof rank !== 'number' || !Number.isInteger(rank) || rank <= 0) {
        return {
          ok: false,
          message: `${source} is invalid: ${label} has an "evaluator" that is not a positive whole number. It is a preference rank (1 is tried first), not a flag. Fix it or remove it, then restart the server.`,
        };
      }
      const clash = seenEvaluatorRanks.get(rank);
      if (clash !== undefined) {
        return {
          ok: false,
          message:
            `${source} is invalid: entries "${clash}" and "${id}" both claim evaluator rank ${rank}. ` +
            `The rank is a preference ORDER, so a tie has no defined answer. Give each candidate a distinct rank and restart the server.`,
        };
      }
      seenEvaluatorRanks.set(rank, id);
    }

    if (raw.pricing !== undefined) {
      const pricing = raw.pricing;
      const valid =
        isPlainObject(pricing) &&
        typeof pricing.input === 'number' &&
        Number.isFinite(pricing.input) &&
        pricing.input >= 0 &&
        typeof pricing.output === 'number' &&
        Number.isFinite(pricing.output) &&
        pricing.output >= 0;
      if (!valid) {
        return {
          ok: false,
          message: `${source} is invalid: ${label} has a "pricing" that is not {"input": <number>, "output": <number>} with both values zero or greater (USD per 1M tokens). Fix it or remove it — an entry without pricing simply reports no cost estimate — then restart the server.`,
        };
      }
    }

    catalog.push(raw as unknown as CatalogEntry);
  }

  if (defaults.length === 0) {
    return {
      ok: false,
      message:
        `${source} declares no default model: no entry carries "default": true. ` +
        `The notebook route needs one when a caller names no model, and there is no safe guess. Mark exactly one entry and restart the server.`,
    };
  }
  if (defaults.length > 1) {
    return {
      ok: false,
      message:
        `${source} declares more than one default model: ${defaults.map((d) => `"${d}"`).join(', ')} all carry "default": true. ` +
        `Exactly one entry may. Mark one and restart the server.`,
    };
  }

  if (summarizers.length > 1) {
    return {
      ok: false,
      message:
        `${source} declares more than one summariser: ${summarizers.map((s) => `"${s}"`).join(', ')} all carry "summarizer": true. ` +
        `At most one entry may. Mark one — or none, in which case the default model drafts summaries — and restart the server.`,
    };
  }

  if (seenEvaluatorRanks.size === 0) {
    return {
      ok: false,
      message:
        `${source} declares no evaluator: no entry carries an "evaluator" rank. ` +
        `The publication gate runs an adversarial evaluation before a record goes public and has no candidate to run it with. ` +
        `Give at least one entry "evaluator": 1 — two or more ranks let the gate pick a different model from the one under evaluation — and restart the server.`,
    };
  }

  return { ok: true, catalog };
}
