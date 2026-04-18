import crypto from 'crypto';
import { buildProvenanceGraph, type ProvGraph } from './provenance.ts';
import { buildDataSources, type DataSourceEntry } from './data-sources.ts';
import { getActiveKeyId } from './signing.ts';
import { isBlobRef, parseBlobRef, type BlobRef } from './blob-ref.ts';
import { deriveOperationType } from '../mcp/operation-types.ts';

const PACKAGE_SCHEMA_VERSION = '0.1.0';

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
    provenance,
    ...(input.extensions && Object.keys(input.extensions).length > 0
      ? { extensions: input.extensions }
      : {}),
  };

  // Compute package hash from canonical JSON (covers provenance + extensions)
  const canonical = JSON.stringify(pkg);
  const hash = sha256(canonical);

  return { pkg, hash };
}
