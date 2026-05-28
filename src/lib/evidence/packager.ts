import crypto from 'crypto';
import { buildProvenanceGraph, type ProvGraph } from './provenance.ts';
import { buildDataSources, type DataSourceEntry } from './data-sources.ts';
import { getActiveKeyId, type SignerIdentity } from './signing.ts';
import { isBlobRef, parseBlobRef, type BlobRef } from './blob-ref.ts';
import { deriveOperationType } from '../mcp/operation-types.ts';

const PACKAGE_SCHEMA_VERSION = '0.1.0';

// Two-family node type taxonomy (spec §8.1.1, §8.12, ADR-0009): every node
// carries `type` of the form `content/<noun>/v<N>` or `attestation/<verb>/v<N>`.
// AI-Assisted Analysis output defaults to `content/analysis/v1`; pre-v0.1
// packages omit the field and are interpreted as this value.
export const DEFAULT_CONTENT_TYPE = 'content/analysis/v1';

// Producer Profile (spec §8.1.1, §8.6, ADR-0006): compound
// `<profile-type>/<profile-subtype>`. The v0.1 value auto-derived for the
// datHere content profile — the legacy `contentProfile` field is retained as
// a backwards-compatible alias, and the two MUST stay consistent.
const DATHERE_PRODUCER_PROFILE = 'ai-assisted-analysis/datHere';

/**
 * Capture method for the package contents (ADR-0003).
 *
 * Describes *how* the content was captured — the integrity-of-pipeline
 * property. Orthogonal to `ContentProfile` (ADR-0004), which describes
 * *what shape* the content is in.
 *
 * - `chat-flow-stream` — website server captured bytes as the model
 *   streamed to the browser. Verbatim by construction at the wire layer.
 * - `claude-code-jsonl-readback` — Claude Code publish skill read each
 *   turn's `content` and per-invocation `usage` directly from the session
 *   JSONL, filtering to `text`-typed content blocks. Verbatim by
 *   construction at the JSONL layer.
 * - `claude-code-self-report` — legacy: the publishing model paraphrased
 *   from in-context memory. Deprecated 2026-04-28; retained so packages
 *   predating that date can be labeled with their actual capture method.
 */
export type CaptureMethod =
  | 'chat-flow-stream'
  | 'claude-code-jsonl-readback'
  | 'claude-code-self-report';

/**
 * Content profile for the package contents (ADR-0004).
 *
 * Describes *what shape* the content is in — orthogonal to `CaptureMethod`.
 *
 * - `default` — legacy content shape. Pre-ADR-0004 packages omit the
 *   `contentProfile` field entirely; verifiers treat absence as `default`.
 *   No additional normative requirements beyond §4 of the standard.
 * - `datHere` — A-G envelope content profile (OES §9.1) with a
 *   deterministic Jupyter notebook in section E reproducing the rendered
 *   answer (F) against the documented runtime + stable upstream data.
 *   Packages with this profile MUST satisfy §9.1.1 requirements
 *   (full-text prompt, system prompt present, environment metadata
 *   present, notebook present, rendered answer present, summary present).
 *
 * `contentProfile` and `captureMethod` are independent. A chat-flow-stream
 * capture can have either content profile; the same is true for any other
 * captureMethod value. Future content profiles add ADRs and extend this
 * union.
 */
export type ContentProfile = 'default' | 'datHere';

export interface ToolCallInput {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
}

export interface PackageInput {
  /** OTel trace object OR a BlobRef pointing at the same content stored
   *  out of band. When a BlobRef is supplied, the packager cannot walk
   *  trace spans to auto-extract skill metadata or build a rich PROV-O
   *  graph; publishers shipping trace-as-BlobRef should also provide
   *  `skillMetadataOverride` so those fields aren't blanked. */
  trace: Record<string, unknown> | BlobRef;
  prompt: string;
  /** Assistant output text OR a BlobRef pointing at it. The detail-page
   *  renderer resolves BlobRef outputs server-side; verify follows the
   *  reference and confirms the hash matches. */
  output: string | BlobRef;
  toolCalls: ToolCallInput[];
  model: string;
  portal: string;
  tokenUsage: { promptTokens?: number; completionTokens?: number };
  duration_ms?: number;
  promptVisibility: 'full_text' | 'hash_only';
  title: string;
  summary: string;
  /**
   * Capture method label per ADR-0003. Optional at the packager layer so
   * existing tests and any internal call sites that don't supply it still
   * produce canonical JSON identical to pre-ADR shape. Required at the
   * route layer (`POST /api/evidence` rejects requests that omit it) so
   * every published package has an explicit, signed label.
   */
  captureMethod?: CaptureMethod;
  /**
   * Content profile label per ADR-0004. Optional; absence is treated as
   * `default`. Set to `'datHere'` to produce an A-G envelope package
   * (OES §9.1), which triggers two additional packager behaviors:
   * `summary` is emitted into canonical JSON (covered by the package
   * hash) and `extensions["org.civicaitools.environment"]` is auto-
   * emitted. Both behaviors are no-ops when contentProfile is `default`
   * or absent, preserving byte-identical pre-ADR-0004 canonical JSON
   * for legacy packages.
   */
  contentProfile?: ContentProfile;
  /**
   * Producer Profile label per ADR-0006 (spec §8.1.1, §8.6). Compound
   * `<profile-type>/<profile-subtype>` string. Optional at the packager
   * layer (conditional-spread keeps existing-shape inputs byte-identical);
   * when omitted but `contentProfile === 'datHere'`, the packager
   * auto-derives `'ai-assisted-analysis/datHere'`. The route default-fills
   * and validates the consistency invariant.
   */
  producerProfile?: string;
  /**
   * Node type per the two-family taxonomy (ADR-0009, spec §8.1.1, §8.12).
   * Optional at the packager layer so existing-shape inputs stay
   * byte-identical; the route default-fills `'content/analysis/v1'` for the
   * standard publish path. Absence is interpreted as `content/analysis/v1`.
   */
  type?: string;
  /**
   * Envelope-side identity claim per ADR-0009 (spec §8.1.1, §8.5).
   * "Recommended": the route default-fills it from the active signing key.
   * Optional at the packager layer (conditional-spread); pre-v0.1 packages
   * have no signer and verifiers derive it from the trust registry instead.
   */
  signer?: SignerIdentity;
  /**
   * Override the skill metadata that the packager would otherwise extract
   * from the trace. Required when `trace` is a BlobRef (the packager can't
   * inspect trace spans in that case). Also accepts a BlobRef for
   * `skillText` so publishers can dedupe very large composed skills
   * across packages.
   */
  skillMetadataOverride?: {
    systemPromptHash?: string;
    mcpServerUrl?: string;
    skillText?: string | BlobRef;
  };
  /**
   * Optional implementation-specific artifacts.
   * Keys MUST follow reverse-DNS conventions (e.g., "org.civicaitools.notebook")
   * to prevent collisions across adopters of the evidence package spec.
   */
  extensions?: Record<string, unknown>;
}

export interface EvidencePackage {
  metadata: {
    schemaVersion: string;
    packageId: string;
    createdAt: string;
    /** Key identifier that signed this package. Captured in the canonical
     *  hash so a kid swap produces a different hash (defense against
     *  post-hoc trust-registry relabeling). Verifiers cross-check this
     *  against the `kid` embedded in the signature blob. */
    signingKeyId: string;
    /** Capture-method label (ADR-0003). Present on packages built after
     *  the ADR's enforcement landed; absent on legacy packages, which the
     *  detail page surfaces as "Unknown (pre-ADR-0003)". When set, the
     *  field is part of canonical JSON and therefore covered by the
     *  package hash and signature. */
    captureMethod?: CaptureMethod;
    /** Content-profile label (ADR-0004). Present on packages built after
     *  ADR-0004's enforcement landed *and* whose publisher selected a
     *  non-default profile. Absence is treated as `default`. When set,
     *  the field is part of canonical JSON and therefore covered by the
     *  package hash and signature. */
    contentProfile?: ContentProfile;
  };
  /** Producer Profile label (ADR-0006, spec §8.1.1). Top-level envelope
   *  field (parallel axis to `metadata.contentProfile`, which stays nested
   *  as the grandfathered legacy alias). Present when supplied or
   *  auto-derived for the datHere content profile; covered by the package
   *  hash and signature when present. */
  producerProfile?: string;
  /** Node type per the two-family taxonomy (ADR-0009, spec §8.1.1, §8.12).
   *  Top-level. Present on packages built via the publish route (default
   *  `content/analysis/v1`); absence is interpreted as `content/analysis/v1`. */
  type?: string;
  /** Envelope-side identity claim (ADR-0009, spec §8.1.1, §8.5). Top-level.
   *  Distinct from the signature envelope (`kid`/publicKey); verifiers
   *  cross-check the two via the trust registry (check #14). Absent on
   *  pre-v0.1 packages. */
  signer?: SignerIdentity;
  prompt: {
    hash: string;
    visibility: 'full_text' | 'hash_only';
    text?: string;
  };
  queries: Array<{
    tool: string;
    operationType: string;
    arguments: Record<string, unknown>;
    datasetId?: string;
    portal?: string;
    duration_ms?: number;
    resultRows?: number;
    resultColumns?: number;
  }>;
  dataSources: DataSourceEntry[];
  cost: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    model: string;
    durationMs?: number;
  };
  skillMetadata: {
    systemPromptHash?: string;
    mcpServerUrl?: string;
    /** Inline skill text, or a BlobRef for very large composed skills.
     *  The detail page fetches the blob lazily when the section expands. */
    skillText?: string | BlobRef;
  };
  /** Assistant output. Inline text on historic packages; a BlobRef on
   *  packages that uploaded large outputs via the upload-token flow. */
  output: string | BlobRef;
  /** OTel trace, either inline or referenced by hash. */
  trace: Record<string, unknown> | BlobRef;
  /** Short, indexable, citation-ready summary (OES §4.1, ADR-0004).
   *  Required when `metadata.captureMethod === 'datHere'`; optional and
   *  typically absent for other capture methods (where summary lives on
   *  the DB row only). When present in the canonical JSON, it is covered
   *  by the package hash and the platform signature. */
  summary?: string;
  provenance?: ProvGraph;
  /**
   * Optional implementation-specific artifacts, keyed by reverse-DNS identifier
   * (e.g., "org.civicaitools.notebook"). Core consumers of the evidence package
   * spec MUST NOT require any particular extension. Extensions are included in
   * the canonical JSON and therefore covered by the package hash.
   */
  extensions?: Record<string, unknown>;
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Build the `org.civicaitools.environment` extension content for a
 * package with `contentProfile === 'datHere'`. Per OES §9.1.1 requirement
 * 3 the extension MUST carry `modelVersion`, `temperature`, `mcpServers`,
 * `toolDefinitions`, `host`.
 *
 * Prototype limitations (tracked as known gaps; tightened in follow-up work):
 * - `temperature` is not yet captured by the chat flow. Placeholder `0`.
 * - `toolDefinitions` is not yet captured. Placeholder `[]`.
 * - `mcpServers` is derived from the trace's skill-fetch span URL (the
 *   primary MCP server for the analysis). A richer derivation that walks
 *   per-query portals can land later without breaking the field shape.
 *
 * Fields the prototype DOES capture honestly: `modelVersion` (from the
 * model identifier surfaced through the chat flow) and `host` (the
 * publishing host of civicaitools.org's reference implementation).
 */
function buildDatHereEnvironment(
  input: PackageInput,
  skillMcpServerUrl: string | undefined,
): Record<string, unknown> {
  const mcpServers: Array<{ url: string; name?: string }> = [];
  if (skillMcpServerUrl) {
    mcpServers.push({ url: skillMcpServerUrl });
  }
  return {
    modelVersion: input.model,
    temperature: 0,
    mcpServers,
    toolDefinitions: [],
    host: 'civicaitools.org',
  };
}

function extractSkillMetadata(trace: Record<string, unknown>): { systemPromptHash?: string; mcpServerUrl?: string; skillText?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spans = (trace as any)?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans;
    if (!Array.isArray(spans)) return {};
    const skillSpan = spans.find((s: { name: string }) => s.name === 'skill_fetch');
    if (!skillSpan) return {};
    const attrs: Record<string, string> = {};
    for (const a of skillSpan.attributes || []) {
      attrs[a.key] = a.value?.stringValue || '';
    }
    return {
      systemPromptHash: attrs['skill.text_hash'] || undefined,
      mcpServerUrl: attrs['skill.mcp_server_url'] || undefined,
      skillText: attrs['skill.text'] || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Build a structured evidence package from analysis data.
 * Returns the package object and its SHA-256 hash.
 *
 * BlobRef fields (`trace`, `output`, `skillMetadataOverride.skillText`) are
 * passed through unchanged. The packager does not download them, so the
 * resulting package commits to the reference object while leaving the
 * content in Vercel Blob. Detail-page rendering and verification each
 * follow the reference when they need the bytes.
 */
export function buildEvidencePackage(input: PackageInput): { pkg: EvidencePackage; hash: string } {
  const now = new Date().toISOString();
  const packageId = crypto.randomUUID();
  const promptHash = sha256(input.prompt);

  // Extract queries (only tool calls with operation type)
  const queries = input.toolCalls.map(tc => ({
    tool: tc.name,
    operationType: tc.operationType || deriveOperationType(tc.name, tc.args) || 'unknown',
    arguments: tc.args,
    datasetId: (tc.args.dataset_id as string) || undefined,
    portal: (tc.args.portal as string) || undefined,
    duration_ms: tc.duration_ms,
    resultRows: tc.resultSummary?.rows,
    resultColumns: tc.resultSummary?.columns,
  }));

  // Helpers: when trace is a BlobRef the packager can't inspect spans for
  // data-source detection, skill extraction, or PROV-O graph construction.
  // Fall back to an empty trace so downstream builders degrade gracefully.
  const traceIsBlob = isBlobRef(input.trace);
  const traceForInspection: Record<string, unknown> = traceIsBlob
    ? { resourceSpans: [] }
    : (input.trace as Record<string, unknown>);

  const dataSources = buildDataSources(input.toolCalls, traceForInspection, input.portal, now);

  const totalTokens = (input.tokenUsage.promptTokens || 0) + (input.tokenUsage.completionTokens || 0);

  // Skill metadata: prefer the explicit override when provided (required if
  // trace is a BlobRef; optional otherwise), otherwise extract from spans.
  const skillMeta = input.skillMetadataOverride
    ? {
        systemPromptHash: input.skillMetadataOverride.systemPromptHash,
        mcpServerUrl: input.skillMetadataOverride.mcpServerUrl,
        skillText: input.skillMetadataOverride.skillText,
      }
    : extractSkillMetadata(traceForInspection);

  // PROV-O provenance graph. When output is a BlobRef we pass the ref hash
  // through `outputHash` rather than rehashing a string — the ref IS the
  // content hash by construction, so this preserves the identity chain
  // between the evidence record and the referenced blob.
  const outputIsBlob = isBlobRef(input.output);
  const provenance = buildProvenanceGraph(traceForInspection, {
    packageId,
    promptHash,
    promptText: input.promptVisibility === 'full_text' ? input.prompt : undefined,
    outputText: outputIsBlob ? undefined : (input.output as string),
    outputHash: outputIsBlob ? parseBlobRef((input.output as BlobRef).ref).hash : undefined,
    model: input.model,
    portal: input.portal,
  });

  // Producer Profile (ADR-0006): emit when explicitly supplied, else
  // auto-derive from the datHere content profile. Left undefined (and thus
  // unspread below) for default/legacy inputs so their canonical JSON — and
  // package hash — stays byte-identical to pre-ADR-0006 shape. The route
  // enforces the contentProfile↔producerProfile consistency invariant.
  const producerProfile =
    input.producerProfile ??
    (input.contentProfile === 'datHere' ? DATHERE_PRODUCER_PROFILE : undefined);

  const pkg: EvidencePackage = {
    metadata: {
      schemaVersion: PACKAGE_SCHEMA_VERSION,
      packageId,
      createdAt: now,
      signingKeyId: getActiveKeyId(),
      // Conditional spread so legacy/test inputs without captureMethod
      // produce canonical JSON identical to pre-ADR-0003 shape (and
      // therefore identical hashes). The route layer enforces presence
      // for production publishes.
      ...(input.captureMethod ? { captureMethod: input.captureMethod } : {}),
      // ADR-0004 §7: contentProfile is optional; absence means `default`.
      // Only emit into canonical JSON when explicitly set so pre-ADR-0004
      // packages (which never supply this field) produce byte-identical
      // canonical JSON to before.
      ...(input.contentProfile ? { contentProfile: input.contentProfile } : {}),
    },
    // Top-level envelope fields (ADR-0006/0009, spec §8.1.1). Conditional
    // spread so existing-shape inputs (no producerProfile/type/signer) emit
    // byte-identical canonical JSON to before; the route default-fills `type`
    // and `signer` for the production publish path.
    ...(producerProfile ? { producerProfile } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.signer ? { signer: input.signer } : {}),
    prompt: {
      hash: promptHash,
      visibility: input.promptVisibility,
      ...(input.promptVisibility === 'full_text' ? { text: input.prompt } : {}),
    },
    queries,
    dataSources,
    cost: {
      promptTokens: input.tokenUsage.promptTokens,
      completionTokens: input.tokenUsage.completionTokens,
      totalTokens: totalTokens || undefined,
      model: input.model,
      durationMs: input.duration_ms,
    },
    skillMetadata: skillMeta,
    output: input.output,
    trace: input.trace,
    // ADR-0004 §7 backwards-compat: emit `summary` into canonical JSON only
    // when contentProfile === 'datHere' (where the spec requires it).
    // Other content profiles keep `summary` on the DB row only, so their
    // canonical JSON — and therefore their package hash — remains
    // byte-identical to pre-ADR-0004 behavior.
    ...(input.contentProfile === 'datHere' && input.summary
      ? { summary: input.summary }
      : {}),
    provenance,
    // ADR-0004 §2 + OES §9.1.1 requirement 3: datHere-content-profile
    // packages auto-receive an `org.civicaitools.environment` extension
    // carrying section-C metadata, layered on top of any caller-supplied
    // extensions (e.g. the existing `org.civicaitools.notebook` written
    // by the chat-flow publish dialog). Non-datHere content profiles
    // emit only the caller-supplied extensions, preserving their
    // canonical JSON.
    ...(() => {
      const extensions: Record<string, unknown> = { ...(input.extensions ?? {}) };
      if (input.contentProfile === 'datHere') {
        extensions['org.civicaitools.environment'] = buildDatHereEnvironment(
          input,
          skillMeta.mcpServerUrl,
        );
      }
      return Object.keys(extensions).length > 0 ? { extensions } : {};
    })(),
  };

  // Compute package hash from canonical JSON (covers provenance + extensions)
  const canonical = JSON.stringify(pkg);
  const hash = sha256(canonical);

  return { pkg, hash };
}
