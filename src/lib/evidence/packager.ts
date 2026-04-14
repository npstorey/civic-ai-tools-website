import crypto from 'crypto';
import { buildProvenanceGraph, type ProvGraph } from './provenance';

const PACKAGE_SCHEMA_VERSION = '0.1.0';

export interface ToolCallInput {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
}

export interface PackageInput {
  trace: Record<string, unknown>;
  prompt: string;
  output: string;
  toolCalls: ToolCallInput[];
  model: string;
  portal: string;
  tokenUsage: { promptTokens?: number; completionTokens?: number };
  duration_ms?: number;
  promptVisibility: 'full_text' | 'hash_only';
  title: string;
  summary: string;
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
  dataSources: Array<{
    catalogType: string;
    portalUrl: string;
    datasetId: string;
    datasetUrl: string;
    accessTimestamp: string;
  }>;
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
    skillText?: string;
  };
  output: string;
  trace: Record<string, unknown>;
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
 */
export function buildEvidencePackage(input: PackageInput): { pkg: EvidencePackage; hash: string } {
  const now = new Date().toISOString();
  const packageId = crypto.randomUUID();
  const promptHash = sha256(input.prompt);

  // Extract queries (only tool calls with operation type)
  const queries = input.toolCalls.map(tc => ({
    tool: tc.name,
    operationType: tc.operationType || (tc.args.type as string) || 'unknown',
    arguments: tc.args,
    datasetId: (tc.args.dataset_id as string) || undefined,
    portal: (tc.args.portal as string) || undefined,
    duration_ms: tc.duration_ms,
    resultRows: tc.resultSummary?.rows,
    resultColumns: tc.resultSummary?.columns,
  }));

  // Extract unique data sources from tool calls
  const sourceMap = new Map<string, { portalUrl: string; datasetId: string }>();
  for (const tc of input.toolCalls) {
    const datasetId = tc.args.dataset_id as string | undefined;
    const portal = (tc.args.portal as string) || input.portal;
    if (datasetId && !sourceMap.has(datasetId)) {
      sourceMap.set(datasetId, { portalUrl: `https://${portal}`, datasetId });
    }
  }
  const dataSources = Array.from(sourceMap.values()).map(s => ({
    catalogType: 'socrata',
    portalUrl: s.portalUrl,
    datasetId: s.datasetId,
    datasetUrl: `${s.portalUrl}/d/${s.datasetId}`,
    accessTimestamp: now,
  }));

  const totalTokens = (input.tokenUsage.promptTokens || 0) + (input.tokenUsage.completionTokens || 0);
  const skillMeta = extractSkillMetadata(input.trace);

  // Build PROV-O provenance graph from the OTel trace
  const provenance = buildProvenanceGraph(input.trace, {
    packageId,
    promptHash,
    promptText: input.promptVisibility === 'full_text' ? input.prompt : undefined,
    outputText: input.output,
    model: input.model,
    portal: input.portal,
  });

  const pkg: EvidencePackage = {
    metadata: {
      schemaVersion: PACKAGE_SCHEMA_VERSION,
      packageId,
      createdAt: now,
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
