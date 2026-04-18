import { hash } from './trace.ts';
import type { OTelTrace, Span, OTelAttribute } from './trace.ts';

/**
 * W3C PROV-O JSON-LD graph built from an OTel trace.
 * Maps the analysis pipeline (LLM inference, MCP tool calls, data responses)
 * to a machine-readable provenance chain of Entities, Activities, and Agents.
 */

// --- Types ---

interface ProvNode {
  '@id': string;
  '@type': string | string[];
  [key: string]: unknown;
}

export interface ProvGraph {
  '@context': Record<string, string>;
  '@graph': ProvNode[];
}

interface ProvenanceInput {
  packageId: string;
  promptHash: string;
  promptText?: string;
  /** Inline output text. Used to derive the output hash unless
   *  `outputHash` is supplied explicitly. */
  outputText?: string;
  /** Pre-computed SHA-256 hex of the output. Supplied when the output is
   *  stored as a BlobRef and inline text isn't available; the ref hash
   *  itself is exactly this value by construction. */
  outputHash?: string;
  model: string;
  portal: string;
}

// --- Helpers ---

function getAttr(attrs: OTelAttribute[], key: string): string | undefined {
  const attr = attrs.find(a => a.key === key);
  return attr?.value?.stringValue ?? attr?.value?.intValue ?? undefined;
}

function nanoToIso(nano: string): string {
  const ms = Math.floor(Number(nano) / 1_000_000);
  return new Date(ms).toISOString();
}

function urn(packageId: string, type: string, id: string): string {
  return `urn:civic-evidence:${packageId}:${type}:${id}`;
}

// --- Builder ---

/**
 * Build a W3C PROV-O JSON-LD graph from an OTel trace and package metadata.
 *
 * Walks the trace spans and maps them to PROV concepts:
 * - LLM inference spans → prov:Activity
 * - MCP tool call spans → prov:Activity
 * - Prompt, skill guidance, data responses, output → prov:Entity
 * - LLM model, MCP server, platform → prov:Agent
 */
export function buildProvenanceGraph(
  trace: Record<string, unknown>,
  input: ProvenanceInput,
): ProvGraph {
  const otel = trace as unknown as OTelTrace;
  const spans = otel?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans || [];
  const { packageId, promptHash, promptText, outputText, model, portal } = input;
  const outputHash = input.outputHash ?? hash(outputText ?? '');

  const graph: ProvNode[] = [];

  // --- Entities ---

  // User prompt
  const promptEntity: ProvNode = {
    '@id': urn(packageId, 'prompt', promptHash),
    '@type': 'prov:Entity',
    'civic:contentHash': `sha256:${promptHash}`,
    'dcterms:description': 'User query prompt',
  };
  if (promptText) {
    promptEntity['prov:value'] = promptText;
  }
  graph.push(promptEntity);

  // Skill guidance (from skill_fetch span). Since M9.2 the skill is a
  // composition of per-source guidance (Socrata + Data Commons), so the
  // description is source-neutral. Per-source tool agents are emitted from
  // the tool spans below based on which sources were actually invoked.
  const skillSpan = spans.find(s => s.name === 'skill_fetch');
  const skillHash = skillSpan ? getAttr(skillSpan.attributes, 'skill.text_hash') : undefined;
  const skillServerUrl = skillSpan ? getAttr(skillSpan.attributes, 'skill.mcp_server_url') : undefined;

  if (skillHash) {
    graph.push({
      '@id': urn(packageId, 'skill', skillHash),
      '@type': ['prov:Entity', 'prov:Plan'],
      'civic:contentHash': `sha256:${skillHash}`,
      'dcterms:description': 'Composed MCP skill guidance (system prompt)',
    });
  }

  // Final output
  graph.push({
    '@id': urn(packageId, 'output', outputHash),
    '@type': 'prov:Entity',
    'civic:contentHash': `sha256:${outputHash}`,
    'dcterms:description': 'AI-generated analysis output',
  });

  // --- Agents ---

  // LLM model
  const modelId = model.replace(/\//g, '-');
  const modelUrn = `urn:civic-evidence:model:${modelId}`;
  graph.push({
    '@id': modelUrn,
    '@type': ['prov:Agent', 'prov:SoftwareAgent'],
    'dcterms:title': model,
    'dcterms:description': 'Large language model via OpenRouter',
  });

  // MCP server agents — one per distinct data source that appears in the
  // trace. M9.1 added `mcp.source` to every tool span; evidence records
  // published before M9.1 have no source attribute, so they fall back to
  // `socrata` (the only source at the time) for backwards compatibility.
  const toolSpans = spans.filter(s => s.name === 'mcp_tool_call');
  const sourceAgentMap: Record<string, { urn: string; title: string; serverUrl: string }> = {
    socrata: {
      urn: `urn:civic-evidence:mcp-server:socrata`,
      title: 'Socrata MCP Server',
      serverUrl: skillServerUrl || 'https://socrata-mcp.civicaitools.org',
    },
    'data-commons': {
      urn: `urn:civic-evidence:mcp-server:data-commons`,
      title: 'Google Data Commons MCP Server',
      serverUrl: 'https://api.datacommons.org/mcp',
    },
  };

  const sourcesInTrace = new Set<string>();
  for (const span of toolSpans) {
    const source = getAttr(span.attributes, 'mcp.source') || 'socrata';
    sourcesInTrace.add(source);
  }

  for (const sourceId of sourcesInTrace) {
    const meta = sourceAgentMap[sourceId] ?? {
      urn: `urn:civic-evidence:mcp-server:${encodeURIComponent(sourceId)}`,
      title: `${sourceId} MCP Server`,
      serverUrl: sourceId,
    };
    graph.push({
      '@id': meta.urn,
      '@type': ['prov:Agent', 'prov:SoftwareAgent'],
      'dcterms:title': meta.title,
      'civic:serverUrl': meta.serverUrl,
      'civic:sourceId': sourceId,
    });
  }

  // Resolve a source id to its agent URN, falling back to socrata for
  // pre-M9.1 evidence records that never tagged the span.
  function agentUrnForSource(sourceId: string | undefined): string {
    const id = sourceId || 'socrata';
    return sourceAgentMap[id]?.urn ?? sourceAgentMap.socrata.urn;
  }

  // Platform
  graph.push({
    '@id': 'urn:civic-evidence:platform:civic-ai-tools',
    '@type': ['prov:Agent', 'prov:SoftwareAgent'],
    'dcterms:title': 'Civic AI Tools',
    'civic:url': 'https://civicaitools.org',
  });

  // --- Activities ---

  // LLM inference spans
  const inferenceSpans = spans.filter(s => s.name === 'llm_inference');
  const inferenceUrns: string[] = [];

  for (const span of inferenceSpans) {
    const spanUrn = urn(packageId, 'inference', span.spanId);
    inferenceUrns.push(spanUrn);

    const used: { '@id': string }[] = [
      { '@id': urn(packageId, 'prompt', promptHash) },
    ];
    if (skillHash) {
      used.push({ '@id': urn(packageId, 'skill', skillHash) });
    }

    const node: ProvNode = {
      '@id': spanUrn,
      '@type': 'prov:Activity',
      'dcterms:description': `LLM inference call (iteration ${getAttr(span.attributes, 'gen_ai.inference_index') || '0'})`,
      'prov:wasAssociatedWith': { '@id': modelUrn },
      'prov:used': used,
    };
    if (span.startTimeUnixNano) {
      node['prov:startedAtTime'] = { '@value': nanoToIso(span.startTimeUnixNano), '@type': 'xsd:dateTime' };
    }
    if (span.endTimeUnixNano) {
      node['prov:endedAtTime'] = { '@value': nanoToIso(span.endTimeUnixNano), '@type': 'xsd:dateTime' };
    }

    const promptTokens = getAttr(span.attributes, 'gen_ai.response.prompt_tokens');
    const completionTokens = getAttr(span.attributes, 'gen_ai.response.completion_tokens');
    if (promptTokens) node['civic:promptTokens'] = Number(promptTokens);
    if (completionTokens) node['civic:completionTokens'] = Number(completionTokens);

    graph.push(node);
  }

  // MCP tool call spans
  const dataResponseUrns: string[] = [];

  for (const span of toolSpans) {
    const toolCallUrn = urn(packageId, 'tool-call', span.spanId);
    const argsStr = getAttr(span.attributes, 'tool.arguments') || '{}';
    const queryHash = hash(argsStr);
    const responseHash = getAttr(span.attributes, 'tool.response_hash');
    const toolName = getAttr(span.attributes, 'tool.name') || 'get_data';
    const opType = getAttr(span.attributes, 'tool.operation_type') || 'unknown';
    const datasetId = getAttr(span.attributes, 'tool.dataset_id');
    const portalDomain = getAttr(span.attributes, 'tool.portal_domain') || portal;
    const toolSource = getAttr(span.attributes, 'mcp.source') || 'socrata';
    const toolAgentUrn = agentUrnForSource(toolSource);

    // SoQL query entity
    const queryUrn = urn(packageId, 'query', queryHash);
    const queryNode: ProvNode = {
      '@id': queryUrn,
      '@type': 'prov:Entity',
      'civic:contentHash': `sha256:${queryHash}`,
      'civic:toolName': toolName,
      'civic:operationType': opType,
      'dcterms:description': `MCP tool arguments (${opType})`,
    };

    // Find the most recent inference span before this tool call to link as generator
    const toolStart = Number(span.startTimeUnixNano);
    const precedingInference = inferenceSpans
      .filter(is => Number(is.endTimeUnixNano || '0') <= toolStart)
      .sort((a, b) => Number(b.endTimeUnixNano || '0') - Number(a.endTimeUnixNano || '0'))[0];

    if (precedingInference) {
      queryNode['prov:wasGeneratedBy'] = { '@id': urn(packageId, 'inference', precedingInference.spanId) };
    }

    graph.push(queryNode);

    // Data response entity
    if (responseHash) {
      const dataUrn = urn(packageId, 'data', responseHash);
      dataResponseUrns.push(dataUrn);

      // Description varies by source — Socrata has a portal domain, Data
      // Commons calls run against a knowledge graph keyed by DCIDs.
      const description = toolSource === 'socrata'
        ? `Data response from ${portalDomain}`
        : `Data response from ${sourceAgentMap[toolSource]?.title || toolSource}`;

      const dataNode: ProvNode = {
        '@id': dataUrn,
        '@type': 'prov:Entity',
        'civic:contentHash': `sha256:${responseHash}`,
        'dcterms:description': description,
        'civic:sourceId': toolSource,
        'prov:wasGeneratedBy': { '@id': toolCallUrn },
      };

      // Croissant 1.1 placeholder — only meaningful for Socrata today
      if (toolSource === 'socrata' && datasetId) {
        dataNode['civic:datasetId'] = datasetId;
        dataNode['civic:portalDomain'] = portalDomain;
        dataNode['civic:datasetUrl'] = `https://${portalDomain}/d/${datasetId}`;
        dataNode['civic:croissantMetadataUrl'] = null; // hook for future Croissant integration
      }

      const responseRows = getAttr(span.attributes, 'tool.response_rows');
      if (responseRows) dataNode['civic:responseRows'] = Number(responseRows);

      graph.push(dataNode);
    }

    // Tool call activity — associated with the MCP source agent that handled
    // the call. In multi-source analyses each call may target a different
    // agent (e.g. socrata for `get_data`, data-commons for `get_observations`).
    const toolCallNode: ProvNode = {
      '@id': toolCallUrn,
      '@type': 'prov:Activity',
      'dcterms:description': `MCP tool call: ${toolName} (${opType})`,
      'civic:sourceId': toolSource,
      'prov:used': [{ '@id': queryUrn }],
      'prov:wasAssociatedWith': { '@id': toolAgentUrn },
    };
    if (span.startTimeUnixNano) {
      toolCallNode['prov:startedAtTime'] = { '@value': nanoToIso(span.startTimeUnixNano), '@type': 'xsd:dateTime' };
    }
    if (span.endTimeUnixNano) {
      toolCallNode['prov:endedAtTime'] = { '@value': nanoToIso(span.endTimeUnixNano), '@type': 'xsd:dateTime' };
    }

    const durationMs = getAttr(span.attributes, 'tool.duration_ms');
    if (durationMs) toolCallNode['civic:durationMs'] = Number(durationMs);

    graph.push(toolCallNode);
  }

  // --- Final output relationships ---

  // Output wasGeneratedBy the last inference or synthesis span
  const synthesisSpan = spans.find(s => s.name === 'synthesis');
  const lastInference = inferenceSpans.length > 0
    ? inferenceSpans[inferenceSpans.length - 1]
    : undefined;
  const generatorSpan = synthesisSpan || lastInference;

  if (generatorSpan) {
    const generatorUrn = synthesisSpan
      ? urn(packageId, 'synthesis', synthesisSpan.spanId)
      : urn(packageId, 'inference', generatorSpan.spanId);

    // Add synthesis activity if it exists
    if (synthesisSpan) {
      graph.push({
        '@id': generatorUrn,
        '@type': 'prov:Activity',
        'dcterms:description': 'Output synthesis',
        'prov:wasAssociatedWith': { '@id': modelUrn },
        ...(synthesisSpan.startTimeUnixNano ? { 'prov:startedAtTime': { '@value': nanoToIso(synthesisSpan.startTimeUnixNano), '@type': 'xsd:dateTime' } } : {}),
        ...(synthesisSpan.endTimeUnixNano ? { 'prov:endedAtTime': { '@value': nanoToIso(synthesisSpan.endTimeUnixNano), '@type': 'xsd:dateTime' } } : {}),
      });
    }

    // Output wasGeneratedBy
    graph.push({
      '@id': urn(packageId, 'output', outputHash),
      '@type': 'prov:Entity',
      'prov:wasGeneratedBy': { '@id': generatorUrn },
      ...(dataResponseUrns.length > 0
        ? { 'prov:wasDerivedFrom': dataResponseUrns.map(u => ({ '@id': u })) }
        : {}),
    });
  }

  // Add data responses to inference used list (inference used data to synthesize)
  if (dataResponseUrns.length > 0 && inferenceUrns.length > 0) {
    const lastInferenceUrn = inferenceUrns[inferenceUrns.length - 1];
    const existing = graph.find(n => n['@id'] === lastInferenceUrn);
    if (existing && Array.isArray(existing['prov:used'])) {
      for (const dUrn of dataResponseUrns) {
        (existing['prov:used'] as { '@id': string }[]).push({ '@id': dUrn });
      }
    }
  }

  // --- Skill hadPlan relationship ---
  if (skillHash && inferenceUrns.length > 0) {
    graph.push({
      '@id': inferenceUrns[0],
      '@type': 'prov:Activity',
      'prov:qualifiedAssociation': {
        '@type': 'prov:Association',
        'prov:agent': { '@id': modelUrn },
        'prov:hadPlan': { '@id': urn(packageId, 'skill', skillHash) },
      },
    });
  }

  return {
    '@context': {
      'prov': 'http://www.w3.org/ns/prov#',
      'xsd': 'http://www.w3.org/2001/XMLSchema#',
      'civic': 'https://civicaitools.org/ns/evidence/',
      'dcterms': 'http://purl.org/dc/terms/',
    },
    '@graph': graph,
  };
}
