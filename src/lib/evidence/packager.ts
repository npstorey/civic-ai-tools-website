import crypto from 'crypto';
import { buildProvenanceGraph, type ProvGraph } from './provenance.ts';
import { buildDataSources, type DataSourceEntry } from './data-sources.ts';
import { getActiveKeyId } from './signing.ts';
import { isBlobRef, parseBlobRef, type BlobRef } from './blob-ref.ts';
import { deriveOperationType } from '../mcp/operation-types.ts';

const PACKAGE_SCHEMA_VERSION = '0.1.0';

/**
 * Capture method for the package contents (ADR-0003, ADR-0004).
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
 * - `datHere` — Civic AI Tools answer pipeline captured the analysis as
 *   the A-G envelope content profile (OES §9.1), with a deterministic
 *   Jupyter notebook in section E that reproduces the rendered answer
 *   in section F against the documented runtime + stable upstream data.
 *   Reproducible-by-construction against a documented runtime. ADR-0004.
 */
export type CaptureMethod =
  | 'chat-flow-stream'
  | 'claude-code-jsonl-readback'
  | 'claude-code-self-report'
  | 'datHere';

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
  };
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
 * `datHere`-captured package. Per OES §9.1.1 requirement 3 the extension
 * MUST carry `modelVersion`, `temperature`, `mcpServers`, `toolDefinitions`,
 * `host`.
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
    },
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
    // when captureMethod === 'datHere' (where the spec requires it). Other
    // capture methods keep `summary` on the DB row only, so their canonical
    // JSON — and therefore their package hash — remains byte-identical to
    // pre-ADR-0004 behavior.
    ...(input.captureMethod === 'datHere' && input.summary
      ? { summary: input.summary }
      : {}),
    provenance,
    // ADR-0004 §2 + OES §9.1.1 requirement 3: datHere-captured packages
    // auto-receive an `org.civicaitools.environment` extension carrying
    // section-C metadata, layered on top of any caller-supplied
    // extensions (e.g. the existing `org.civicaitools.notebook` written
    // by the chat-flow publish dialog). Non-datHere captures emit only
    // the caller-supplied extensions, preserving their canonical JSON.
    ...(() => {
      const extensions: Record<string, unknown> = { ...(input.extensions ?? {}) };
      if (input.captureMethod === 'datHere') {
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
