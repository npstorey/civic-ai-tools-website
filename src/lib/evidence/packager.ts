// Evidence-package builder — app-side adapter over
// @typedstandards/civic-typed-harness + @typedstandards/produce-core
// (S3a P2, #166; the verify-core shim pattern of #116-WS3 applied to the
// assembly layer).
//
// The operating rule (ADR-0021 §B): THE HARNESS DERIVES, THE CORE ASSEMBLES.
//   - produce-core owns envelope ASSEMBLY (`buildEnvelope`) with the byte-
//     compat discipline: conditional spreads, the v0.1 `type` discriminator,
//     contentHash computed from the base object and spread last, the shared
//     §8.2 envelope-hash detection chain.
//   - the civic harness owns the DERIVATIONS: the datHere policy
//     (producerProfile auto-derive, canonicalization-rule selection,
//     summary-emission gate, the `org.civicaitools.environment` extension),
//     skill extraction from the trace's `skill_fetch` span, the BlobRef-safe
//     trace-inspection fallback, and the PROV-O graph build.
//   - THIS FILE supplies what stays app-side: the determinism inputs
//     (`randomUUID` / clock / active kid — ADR-0021 §D: the core takes them
//     as arguments), the `deriveOperationType` fallback (the MCP registry is
//     app knowledge), the data-source population via the app's resolver
//     (./data-sources.ts), and the instance-identity config (ADR-0020:
//     publication host + PROV platform agent from `src/lib/site-config.ts`;
//     demo defaults = byte-identical emission with no config set).

import crypto from 'crypto';
import { buildProvenanceGraph, type ProvGraph } from './provenance.ts';
import { buildDataSources, type DataSourceEntry } from './data-sources.ts';
import { getActiveKeyId, type SignerIdentity } from './signing.ts';
import { isBlobRef, parseBlobRef, type BlobRef } from './blob-ref.ts';
import { deriveOperationType } from '../mcp/operation-types.ts';
import {
  buildEnvelope,
  sha256Hex,
  DEFAULT_CONTENT_TYPE,
} from '@typedstandards/produce-core';
import {
  deriveDatHereEnvelopeFields,
  extractSkillMetadata,
  traceForInspection,
  CIVICAITOOLS_PROVENANCE_CONFIG,
  type ProvenanceConfig,
} from '@typedstandards/civic-typed-harness';
import {
  requirePublicationHost,
  getPlatformAgentOverrides,
  InstanceIdentityError,
} from '../site-config.ts';
import { canonicalEnvName } from '../publisher-env.ts';

// Two-family node type taxonomy (spec §8.1.1, §8.12, ADR-0009): every node
// carries `type` of the form `content/<noun>/v<N>` or `attestation/<verb>/v<N>`.
// AI-Assisted Analysis output defaults to `content/analysis/v1`; pre-v0.1
// packages omit the field and are interpreted as this value. Re-exported from
// produce-core (same value).
export { DEFAULT_CONTENT_TYPE };

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
  /** Content-canonicalization rule URI (spec §8.1.1, §8.2). Names how the
   *  off-log content reduces to the bytes `contentHash` fingerprints. Emitted
   *  on v0.1 packages: `…/legacy-json/v1` by default, `…/dathere-ag-jupyter/v1`
   *  for the datHere content profile. Absent on pre-v0.1 packages (verifiers
   *  infer the rule from contentProfile). Covered by the envelope hash. */
  contentCanonicalization?: string;
  /** Multihash content-hash digest set (spec §8.1.1, §8.2). Object keyed by
   *  lowercase algorithm name (`sha256` required default) with hex digest
   *  values, fingerprinting the off-log content canonicalized per
   *  `contentCanonicalization`. Its presence as a multihash object is the
   *  §8.2 detection signal routing a package to the JCS chain; pre-v0.1
   *  packages omit it and stay on the legacy `JSON.stringify` chain. Covered
   *  by the envelope hash. */
  contentHash?: Record<string, string>;
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

/**
 * PROV-O graph config for this instance: the harness's config with the
 * platform agent resolved from instance identity (ADR-0020 — the agent names
 * WHO published inside the signed graph). As of #258 the agent NEVER falls
 * back to the harness's reference-deployment values: title and url are
 * required identity (`PUBLISHER_PLATFORM_AGENT_TITLE`, with url following
 * `PUBLISHER_SITE_ORIGIN` unless overridden), and a missing agent id derives
 * from the publication host — operator-grounded, never another deployment's
 * URN. Callers reach this only behind `evaluateSealCommitGate`; the throw is
 * the last-resort guard for any path that forgets the gate. The harness's
 * `CIVICAITOOLS_PLATFORM_AGENT` remains the anti-drift pin for the reference
 * deployment's own configured values (instance-config.test.ts), not a
 * runtime fallback.
 */
function instanceProvenanceConfig(): ProvenanceConfig {
  const overrides = getPlatformAgentOverrides();
  const missing: string[] = [];
  // Report the CANONICAL names (civic-ai-tools#160 P5). The presence LOGIC is
  // two-name and unchanged — `getPlatformAgentOverrides` resolves
  // `PUBLISHER_*`-then-`EVIDENCE_*` — but an operator told to set a retiring
  // variable is told the wrong thing, and this string is the one they act on.
  // Names come from `canonicalEnvName` rather than literals so the report and
  // the resolver cannot drift apart.
  if (!overrides.title) missing.push(canonicalEnvName('PLATFORM_AGENT_TITLE'));
  if (!overrides.url) missing.push(canonicalEnvName('SITE_ORIGIN'));
  if (missing.length > 0) {
    throw new InstanceIdentityError(
      missing,
      "the signed provenance graph's platform agent",
    );
  }
  return {
    ...CIVICAITOOLS_PROVENANCE_CONFIG,
    platformAgent: {
      id: overrides.id ?? requirePublicationHost(),
      title: overrides.title as string,
      url: overrides.url as string,
    },
  };
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
 *
 * Known constraint (civic-ai-tools#116 P1 rider): a v0.1 datHere input
 * without an `org.civicaitools.notebook` extension THROWS —
 * `computeContentHashSha256` refuses to fingerprint `dathere-ag-jupyter/v1`
 * content with no notebook. The real publish flow always supplies one; the
 * adapter keeps the invariant (pinned in packager-instance-config.test.ts).
 */
export function buildEvidencePackage(input: PackageInput): { pkg: EvidencePackage; hash: string } {
  const now = new Date().toISOString();
  const packageId = crypto.randomUUID();
  const promptHash = sha256Hex(input.prompt);

  // Extract queries (only tool calls with operation type). The
  // `deriveOperationType` fallback is app-side knowledge — the MCP tool
  // registry lives in `../mcp/`, and produce-core carries no derivation table.
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

  // When trace is a BlobRef the packager can't inspect spans for data-source
  // detection, skill extraction, or PROV-O graph construction; the harness's
  // `traceForInspection` falls back to an empty trace so downstream builders
  // degrade gracefully.
  const inspectableTrace = traceForInspection(input.trace);

  const dataSources = buildDataSources(input.toolCalls, inspectableTrace, input.portal, now);

  const totalTokens = (input.tokenUsage.promptTokens || 0) + (input.tokenUsage.completionTokens || 0);

  // Skill metadata: prefer the explicit override when provided (required if
  // trace is a BlobRef; optional otherwise), otherwise extract from spans
  // via the harness.
  const skillMeta = input.skillMetadataOverride
    ? {
        systemPromptHash: input.skillMetadataOverride.systemPromptHash,
        mcpServerUrl: input.skillMetadataOverride.mcpServerUrl,
        skillText: input.skillMetadataOverride.skillText,
      }
    : extractSkillMetadata(inspectableTrace);

  // PROV-O provenance graph. When output is a BlobRef we pass the ref hash
  // through `outputHash` rather than rehashing a string — the ref IS the
  // content hash by construction, so this preserves the identity chain
  // between the evidence record and the referenced blob.
  const outputIsBlob = isBlobRef(input.output);
  const provenance = buildProvenanceGraph(
    inspectableTrace,
    {
      packageId,
      promptHash,
      promptText: input.promptVisibility === 'full_text' ? input.prompt : undefined,
      outputText: outputIsBlob ? undefined : (input.output as string),
      outputHash: outputIsBlob ? parseBlobRef((input.output as BlobRef).ref).hash : undefined,
      model: input.model,
      portal: input.portal,
    },
    instanceProvenanceConfig(),
  );

  // datHere policy (ADR-0004/0006, OES §9.1.1): producerProfile auto-derive,
  // canonicalization-rule selection, the summary-emission gate, and the
  // `org.civicaitools.environment` extension layered onto caller-supplied
  // extensions — all derived by the harness; the environment's `host` is this
  // instance's publication host (ADR-0020 config; REQUIRED identity as of
  // #258 — the strict resolver throws rather than emit another deployment's
  // host into canonical JSON). Non-datHere inputs pass through untouched,
  // keeping their canonical JSON byte-identical.
  const datHere = deriveDatHereEnvelopeFields(
    {
      model: input.model,
      contentProfile: input.contentProfile,
      producerProfile: input.producerProfile,
      summary: input.summary,
      skillMcpServerUrl: skillMeta.mcpServerUrl,
      extensions: input.extensions,
    },
    { host: requirePublicationHost() },
  );

  // Envelope assembly + hashing (spec §8.1.1, §8.2) — produce-core, with the
  // determinism inputs supplied here (ADR-0021 §D) and every derived value
  // passed as explicit envelope-field input.
  const { pkg, envelopeHash } = buildEnvelope({
    packageId,
    createdAt: now,
    signingKeyId: getActiveKeyId(),
    prompt: input.prompt,
    promptVisibility: input.promptVisibility,
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
    summary: datHere.summary,
    captureMethod: input.captureMethod,
    contentProfile: input.contentProfile,
    producerProfile: datHere.producerProfile,
    type: input.type,
    signer: input.signer,
    contentCanonicalization: datHere.contentCanonicalization,
    provenance,
    extensions: datHere.extensions,
  });

  return { pkg: pkg as EvidencePackage, hash: envelopeHash };
}
