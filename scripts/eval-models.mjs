#!/usr/bin/env node

/**
 * Model evaluation harness for civic data queries.
 *
 * Runs a set of test queries against multiple LLMs via OpenRouter,
 * using the Socrata MCP server for tool calls. Captures raw responses,
 * token usage, latency, and tools called for manual scoring.
 *
 * THIS HARNESS IS PINNED TO OPENROUTER, AND THE APP IS NOT. Since
 * civic-ai-tools-website#30 the app reaches a configurable endpoint through
 * `src/lib/model-client.ts`, reading `MODEL_API_KEY` (with `OPENROUTER_API_KEY`
 * as its prior-era name) and `MODEL_API_BASE_URL` / `MODEL_API_KIND`. This
 * script reads none of that: it is `.mjs` run as bare `node`, so it cannot
 * import that TypeScript module, and it hardcodes OpenRouter's base URL and
 * requires `OPENROUTER_API_KEY` specifically. That is why the variable name
 * below differs from the one an operator now sets — the statement is accurate
 * about this script, not stale about the app. Repointing the harness at the
 * endpoint layer is tracked in civic-ai-tools#155 and is deliberately not a
 * find-and-replace.
 *
 * Usage:
 *   OPENROUTER_API_KEY=<your-key> SOCRATA_MCP_URL=https://your-mcp-host \
 *     node scripts/eval-models.mjs
 *
 * Required env vars:
 *   SOCRATA_MCP_URL  — MCP server URL. No fallback (civic-ai-tools#155 P1
 *                      E4): this used to default to the project's hosted
 *                      endpoint, which would silently route an
 *                      unconfigured run's queries through infrastructure
 *                      the caller does not operate. Point it at the Socrata
 *                      MCP deployment this eval run should query.
 *
 * Optional env vars:
 *   EVAL_MODELS      — comma-separated model IDs to test (default: all)
 *   EVAL_QUERIES     — comma-separated query indices to test, 1-based (default: all)
 *
 * Output: scripts/eval-results-YYYY-MM-DD.json
 */

import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Configuration ---

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('Error: OPENROUTER_API_KEY environment variable is required');
  process.exit(1);
}

const MCP_URL = process.env.SOCRATA_MCP_URL;
if (!MCP_URL) {
  console.error('Error: SOCRATA_MCP_URL environment variable is required (no reference-host default)');
  process.exit(1);
}

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
});

// --- Models ---

const ALL_MODELS = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
  // Candidates
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
  { id: 'openai/gpt-5.4', name: 'GPT-5.4' },
];

// --- Test Queries ---

const TEST_QUERIES = [
  {
    id: 'Q1',
    query: 'How many 311 complaints were filed in NYC last month?',
    portal: 'data.cityofnewyork.us',
    category: 'simple-lookup',
    expectedDataset: 'erm2-nwe9',
  },
  {
    id: 'Q2',
    query: 'What percentage of Chicago restaurant inspections failed last year?',
    portal: 'data.cityofchicago.org',
    category: 'simple-lookup',
    expectedDataset: '4ijn-s7e5',
  },
  {
    id: 'Q3',
    query: 'Show me the 5 most recent fire incidents in San Francisco',
    portal: 'data.sfgov.org',
    category: 'simple-lookup',
    expectedDataset: 'wr8u-xric',
  },
  {
    id: 'Q4',
    query: 'What are the top 10 complaint types in NYC 311 data this year?',
    portal: 'data.cityofnewyork.us',
    category: 'aggregation',
    expectedDataset: 'erm2-nwe9',
  },
  {
    id: 'Q5',
    query: 'Which Chicago ward had the most crimes in February 2026?',
    portal: 'data.cityofchicago.org',
    category: 'aggregation',
    expectedDataset: 'ijzp-q8t2',
  },
  {
    id: 'Q6',
    query: "What's the average building permit cost in Seattle by permit class?",
    portal: 'data.seattle.gov',
    category: 'aggregation',
    expectedDataset: '76t5-zqzr',
  },
  {
    id: 'Q7',
    query: 'Compare restaurant inspection grades across NYC boroughs — which borough has the highest percentage of A grades?',
    portal: 'data.cityofnewyork.us',
    category: 'multi-step',
    expectedDataset: '43nn-pn8j',
  },
  {
    id: 'Q8',
    query: "What are the highest-paying city jobs in Chicago and how do they compare to the median salary?",
    portal: 'data.cityofchicago.org',
    category: 'multi-step',
    expectedDataset: 'xzkq-xp2w',
  },
  {
    id: 'Q9',
    query: 'Show me the trend in LA 311 requests by month for the past 6 months',
    portal: 'data.lacity.org',
    category: 'multi-step',
    expectedDataset: 'h73f-gn57',
  },
  {
    id: 'Q10',
    query: "What's the crime rate?",
    portal: 'data.cityofnewyork.us',
    category: 'ambiguous',
    expectedDataset: null, // should ask for clarification
  },
  {
    id: 'Q11',
    query: 'Show me permit data',
    portal: 'data.cityofchicago.org',
    category: 'ambiguous',
    expectedDataset: null, // should ask for clarification
  },
  {
    id: 'Q12',
    query: 'How many building permits were issued in the Bronx in 1950?',
    portal: 'data.cityofnewyork.us',
    category: 'edge-case',
    expectedDataset: 'ic3t-wcy2',
  },
  {
    id: 'Q13',
    query: 'Show me noise complaints in manhattan from NYC 311',
    portal: 'data.cityofnewyork.us',
    category: 'edge-case',
    expectedDataset: 'erm2-nwe9',
  },
  {
    id: 'Q14',
    query: 'List all active business licenses in Seattle',
    portal: 'data.seattle.gov',
    category: 'edge-case',
    expectedDataset: 'wnbq-64tb',
  },
  {
    id: 'Q15',
    query: 'Compare 311 complaint volumes between NYC and Chicago for the past week',
    portal: 'data.cityofnewyork.us',
    category: 'edge-case',
    expectedDataset: null, // should decline on web
  },
];

// --- MCP Client ---

let mcpSessionId = null;

async function initMcpSession() {
  const res = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'eval-harness', version: '1.0.0' },
      },
    }),
  });

  if (!res.ok) throw new Error(`MCP init failed: ${res.status}`);
  mcpSessionId = res.headers.get('mcp-session-id');
  if (!mcpSessionId) throw new Error('No MCP session ID');
  console.log('MCP session initialized');
}

async function callMcpTool(name, args) {
  if (!mcpSessionId) await initMcpSession();

  const res = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': mcpSessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`MCP tool error: ${res.status}`);

  const text = await res.text();
  let jsonData = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      jsonData = line.slice(5).trim();
      break;
    }
  }

  const parsed = JSON.parse(jsonData || text);
  if (parsed.result?.content) {
    return parsed.result.content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n');
  }
  if (parsed.error) throw new Error(parsed.error.message);
  return JSON.stringify(parsed);
}

async function fetchSkillGuidance() {
  if (!mcpSessionId) await initMcpSession();

  const res = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': mcpSessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'prompts/get',
      params: { name: 'skill-guidance', arguments: { modality: 'web' } },
    }),
  });

  if (!res.ok) throw new Error(`Prompt fetch failed: ${res.status}`);

  const text = await res.text();
  let jsonData = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      jsonData = line.slice(5).trim();
      break;
    }
  }

  const parsed = JSON.parse(jsonData || text);
  return parsed.result.messages
    .map((msg) => {
      const content = msg.content;
      if (Array.isArray(content))
        return content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n');
      if (typeof content === 'object' && content.type === 'text') return content.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// --- Tool definitions (must match website's socrataMcpTools exactly) ---
// Copied from src/lib/mcp/tools.ts — the examples and property descriptions
// are critical for getting models to actually invoke the tool.

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_data',
      description: `Unified Socrata open data access tool. Supports multiple operation types:
- catalog: Search the catalog for datasets matching a query on a Socrata portal
- metadata: Get detailed metadata about a specific dataset
- query: Execute a SoQL query against a dataset to fetch and filter data
- metrics: Get row count, view count, last-updated timestamps for a dataset

IMPORTANT TIPS:
1. For type=metadata and type=metrics, pass the dataset ID in "dataset_id"
2. For type=query, ALWAYS start by fetching a sample with no WHERE clause to see actual column values
3. NYC 311 data uses field names like: complaint_type, descriptor, created_date, community_board
4. Field values are case-sensitive - fetch sample data first to see exact formats

Examples:
- Search catalog: { "type": "catalog", "portal": "data.cityofnewyork.us", "query": "311 complaints" }
- Get metadata: { "type": "metadata", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9" }
- Get metrics: { "type": "metrics", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9" }
- Fetch sample data first: { "type": "query", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9", "limit": 5 }
- Query with filter: { "type": "query", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9", "select": "complaint_type, COUNT(*) as count", "group": "complaint_type", "order": "count DESC", "limit": 10 }`,
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['catalog', 'metadata', 'query', 'metrics'],
            description: 'The type of operation to perform',
          },
          portal: {
            type: 'string',
            description: 'Socrata portal domain (e.g., data.cityofnewyork.us, data.sfgov.org)',
          },
          query: {
            type: 'string',
            description: 'For type=catalog: search query. For type=metadata: the dataset ID. For type=query: optional full-text search within data.',
          },
          dataset_id: {
            type: 'string',
            description: 'Dataset identifier (required for type=query, metadata, and metrics)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of rows to return (default: 10)',
          },
          offset: {
            type: 'number',
            description: 'Number of rows to skip (for pagination)',
          },
          select: {
            type: 'string',
            description: 'SoQL select clause (for type=query)',
          },
          where: {
            type: 'string',
            description: 'SoQL where clause (for type=query)',
          },
          order: {
            type: 'string',
            description: 'SoQL order clause (for type=query)',
          },
          group: {
            type: 'string',
            description: 'SoQL group clause (for type=query)',
          },
        },
        required: ['type'],
      },
    },
  },
];

// --- Guardrails ---

const QUERY_TIMEOUT_MS = 120_000; // 120 seconds per query
const QUERY_TOKEN_CAP = 50_000;   // 50K tokens per query

class TokenBudgetExceeded extends Error {
  constructor(tokens) {
    super(`Token budget exceeded: ${tokens} tokens used (cap: ${QUERY_TOKEN_CAP})`);
    this.name = 'TokenBudgetExceeded';
    this.tokens = tokens;
  }
}

// --- Query execution ---

// Estimate tokens from message content to predict next API call cost.
// ~4 chars per token is a rough but safe heuristic.
function estimateMessageTokens(messages) {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') chars += msg.content.length;
    // tool_calls in assistant messages also contribute
    if (msg.tool_calls) chars += JSON.stringify(msg.tool_calls).length;
  }
  return Math.ceil(chars / 4);
}

async function runQuery(query, model, systemPrompt) {
  const startTime = Date.now();
  const toolsCalled = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let budgetExceeded = false;
  let hardAbort = false;

  // Check budget after every token-producing event.
  // Returns 'ok' | 'soft' (exceeded cap, summarize) | 'hard' (exceeded 2x cap, abort now)
  function checkBudget() {
    const total = totalInputTokens + totalOutputTokens;
    if (total >= QUERY_TOKEN_CAP * 2) return 'hard';
    if (total >= QUERY_TOKEN_CAP) return 'soft';
    return 'ok';
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: query.query },
  ];

  let response = await openrouter.chat.completions.create({
    model: model.id,
    messages,
    tools,
    tool_choice: 'auto',
    max_tokens: 2000,
  });

  totalInputTokens += response.usage?.prompt_tokens || 0;
  totalOutputTokens += response.usage?.completion_tokens || 0;

  // Check after initial call
  let status = checkBudget();
  if (status === 'hard') {
    hardAbort = true;
    budgetExceeded = true;
  } else if (status === 'soft') {
    budgetExceeded = true;
  }

  let iterations = 0;
  const maxIterations = 10;

  while (
    !hardAbort &&
    !budgetExceeded &&
    response.choices[0]?.message?.tool_calls &&
    iterations < maxIterations
  ) {
    const assistantMessage = response.choices[0].message;
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls || []) {
      if (toolCall.type === 'function') {
        const args = JSON.parse(toolCall.function.arguments);

        // Inject default portal
        if (!args.portal) args.portal = query.portal;

        toolsCalled.push({ name: toolCall.function.name, args });

        try {
          const result = await callMcpTool(toolCall.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${error.message}`,
          });
        }
      }
    }

    // Before making the next API call, estimate whether the accumulated
    // messages would blow past the cap. Each API call charges for the
    // full conversation, so estimate the next call's input tokens.
    const estimatedNextInput = estimateMessageTokens(messages);
    const projectedTotal = totalInputTokens + totalOutputTokens + estimatedNextInput;
    if (projectedTotal >= QUERY_TOKEN_CAP * 2) {
      hardAbort = true;
      budgetExceeded = true;
      break;
    }
    if (projectedTotal >= QUERY_TOKEN_CAP) {
      budgetExceeded = true;
      break;
    }

    response = await openrouter.chat.completions.create({
      model: model.id,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 2000,
    });

    totalInputTokens += response.usage?.prompt_tokens || 0;
    totalOutputTokens += response.usage?.completion_tokens || 0;
    iterations++;

    // Check after every API call
    status = checkBudget();
    if (status === 'hard') {
      hardAbort = true;
      budgetExceeded = true;
      break;
    } else if (status === 'soft') {
      budgetExceeded = true;
      break;
    }
  }

  // Hard abort — don't even attempt a summary, just return what we have
  if (hardAbort) {
    const durationMs = Date.now() - startTime;
    const total = totalInputTokens + totalOutputTokens;
    return {
      queryId: query.id,
      modelId: model.id,
      modelName: model.name,
      query: query.query,
      portal: query.portal,
      category: query.category,
      expectedDataset: query.expectedDataset,
      response: `[HARD ABORT] Token budget exceeded: ${total.toLocaleString()} tokens (2x cap: ${(QUERY_TOKEN_CAP * 2).toLocaleString()})`,
      toolsCalled,
      toolCallCount: toolsCalled.length,
      iterations,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: total,
      durationMs,
      budgetExceeded: true,
      hardAbort: true,
      timestamp: new Date().toISOString(),
    };
  }

  // Soft cap or iteration limit — force a text summary
  const lastMessage = response.choices[0]?.message;
  if (!lastMessage?.content && (iterations >= maxIterations || lastMessage?.tool_calls || budgetExceeded)) {
    if (lastMessage?.tool_calls) {
      messages.push(lastMessage);
      const reason = budgetExceeded
        ? `Token budget exceeded (${(totalInputTokens + totalOutputTokens).toLocaleString()} tokens). Summarize based on data already collected.`
        : 'Tool call limit reached. Summarize based on data already collected.';
      for (const tc of lastMessage.tool_calls) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: reason,
        });
      }
    }
    response = await openrouter.chat.completions.create({
      model: model.id,
      messages: [
        ...messages,
        {
          role: 'user',
          content: 'Based on the data collected, provide a comprehensive answer.',
        },
      ],
      max_tokens: 2000,
    });
    totalInputTokens += response.usage?.prompt_tokens || 0;
    totalOutputTokens += response.usage?.completion_tokens || 0;
  }

  const durationMs = Date.now() - startTime;
  const content = response.choices[0]?.message?.content || '';

  return {
    queryId: query.id,
    modelId: model.id,
    modelName: model.name,
    query: query.query,
    portal: query.portal,
    category: query.category,
    expectedDataset: query.expectedDataset,
    response: content,
    toolsCalled,
    toolCallCount: toolsCalled.length,
    iterations,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    durationMs,
    budgetExceeded,
    hardAbort: false,
    timestamp: new Date().toISOString(),
  };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

function buildOutput(models, results, errors, skillGuidanceLength) {
  const date = new Date().toISOString().split('T')[0];
  return {
    metadata: {
      date,
      mcpServer: MCP_URL,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      queryTokenCap: QUERY_TOKEN_CAP,
      modelsEvaluated: models.map((m) => m.id),
      totalRuns: results.length,
      totalErrors: errors.length,
      totalTimeouts: errors.filter((e) => e.isTimeout).length,
      totalBudgetExceeded: results.filter((r) => r.budgetExceeded).length,
      totalHardAborts: results.filter((r) => r.hardAbort).length,
      skillGuidanceLength,
    },
    results,
    errors,
    summary: models.map((model) => {
      const modelResults = results.filter((r) => r.modelId === model.id);
      const totalTokens = modelResults.reduce((sum, r) => sum + r.totalTokens, 0);
      const totalDuration = modelResults.reduce((sum, r) => sum + r.durationMs, 0);
      const avgToolCalls =
        modelResults.length > 0
          ? modelResults.reduce((sum, r) => sum + r.toolCallCount, 0) / modelResults.length
          : 0;

      return {
        modelId: model.id,
        modelName: model.name,
        queriesRun: modelResults.length,
        budgetExceeded: modelResults.filter((r) => r.budgetExceeded).length,
        hardAborts: modelResults.filter((r) => r.hardAbort).length,
        totalTokens,
        avgTokensPerQuery: modelResults.length > 0 ? Math.round(totalTokens / modelResults.length) : 0,
        totalDurationMs: totalDuration,
        avgDurationMs: modelResults.length > 0 ? Math.round(totalDuration / modelResults.length) : 0,
        avgToolCalls: Math.round(avgToolCalls * 10) / 10,
      };
    }),
  };
}

// --- Main ---

async function main() {
  console.log('=== Model Evaluation Harness ===\n');
  console.log(`Guardrails: ${QUERY_TIMEOUT_MS / 1000}s timeout, ${QUERY_TOKEN_CAP.toLocaleString()} token cap per query\n`);

  // Filter models/queries if env vars set
  const modelFilter = process.env.EVAL_MODELS?.split(',').map((s) => s.trim());
  const queryFilter = process.env.EVAL_QUERIES?.split(',').map((s) => parseInt(s.trim()));

  // Validate EVAL_MODELS against known model IDs
  if (modelFilter) {
    const knownIds = ALL_MODELS.map((m) => m.id);
    const unknown = modelFilter.filter((id) => !knownIds.includes(id));
    if (unknown.length > 0) {
      console.error(`Error: Unknown model ID(s): ${unknown.join(', ')}`);
      console.error(`Available models:`);
      for (const m of ALL_MODELS) {
        console.error(`  ${m.id} (${m.name})`);
      }
      process.exit(1);
    }
  }

  const models = modelFilter
    ? ALL_MODELS.filter((m) => modelFilter.includes(m.id))
    : ALL_MODELS;

  const queries = queryFilter
    ? TEST_QUERIES.filter((_, i) => queryFilter.includes(i + 1))
    : TEST_QUERIES;

  console.log(`Models: ${models.map((m) => m.name).join(', ')}`);
  console.log(`Queries: ${queries.length} (${queries.map((q) => q.id).join(', ')})`);
  console.log(`MCP Server: ${MCP_URL}\n`);

  // Initialize MCP session
  await initMcpSession();

  // Fetch skill guidance once
  console.log('Fetching skill guidance...');
  const skillGuidance = await fetchSkillGuidance();
  console.log(`Skill guidance: ${skillGuidance.length} chars\n`);

  const results = [];
  const errors = [];
  const total = models.length * queries.length;
  let completed = 0;

  // Incremental save — writes after every query so partial results survive hangs
  const date = new Date().toISOString().split('T')[0];
  const outputPath = resolve(__dirname, `eval-results-${date}.json`);

  function saveResults() {
    const output = buildOutput(models, results, errors, skillGuidance.length);
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
  }

  for (const model of models) {
    console.log(`\n--- ${model.name} (${model.id}) ---\n`);

    for (const query of queries) {
      completed++;
      const progress = `[${completed}/${total}]`;

      console.log(`${progress} ${query.id}: "${query.query.slice(0, 60)}..."`);

      // Build system prompt (same as the website's buildSystemPrompt)
      const today = new Date().toISOString().split('T')[0];
      const systemPrompt = `You are a helpful assistant with access to Socrata open data portals via the get_data tool.

Today's date is ${today}. Always use this as the current date for interpreting relative time expressions like "last year" or "past two months."

${skillGuidance}

## PORTAL-SPECIFIC GUIDANCE
Default portal: ${query.portal}

When you get results, summarize clearly and cite the dataset ID used.`;

      try {
        const result = await withTimeout(
          runQuery(query, model, systemPrompt),
          QUERY_TIMEOUT_MS
        );
        results.push(result);

        const flags = result.hardAbort
          ? ' [HARD ABORT]'
          : result.budgetExceeded
            ? ' [BUDGET EXCEEDED]'
            : '';
        console.log(
          `  → ${result.toolCallCount} tool calls, ${result.totalTokens.toLocaleString()} tokens, ${(result.durationMs / 1000).toFixed(1)}s${flags}`
        );
      } catch (error) {
        const isTimeout = error.message.includes('Timed out');
        console.error(`  ✗ ${isTimeout ? 'TIMEOUT' : 'Error'}: ${error.message}`);
        errors.push({
          queryId: query.id,
          modelId: model.id,
          error: error.message,
          isTimeout,
          timestamp: new Date().toISOString(),
        });
      }

      // Save after every query
      saveResults();

      // Brief pause between queries to avoid rate limits
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Final save
  saveResults();
  console.log(`\n=== Results saved to ${outputPath} ===`);

  // Print summary table
  const finalOutput = buildOutput(models, results, errors, skillGuidance.length);
  console.log('\n=== Summary ===\n');
  console.log(
    'Model'.padEnd(25) +
      'Queries'.padEnd(10) +
      'Avg Tokens'.padEnd(12) +
      'Avg Time'.padEnd(12) +
      'Avg Tools'.padEnd(10) +
      'Budget!'.padEnd(8)
  );
  console.log('-'.repeat(77));
  for (const s of finalOutput.summary) {
    console.log(
      s.modelName.padEnd(25) +
        String(s.queriesRun).padEnd(10) +
        String(s.avgTokensPerQuery).padEnd(12) +
        `${(s.avgDurationMs / 1000).toFixed(1)}s`.padEnd(12) +
        String(s.avgToolCalls).padEnd(10) +
        String(s.budgetExceeded).padEnd(8)
    );
  }

  const timeouts = errors.filter((e) => e.isTimeout).length;
  const otherErrors = errors.length - timeouts;
  if (errors.length > 0) {
    const parts = [];
    if (timeouts > 0) parts.push(`${timeouts} timeouts`);
    if (otherErrors > 0) parts.push(`${otherErrors} errors`);
    console.log(`\n${parts.join(', ')} — see ${outputPath} for details.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
