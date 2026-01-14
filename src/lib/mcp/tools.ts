import type { ChatCompletionTool } from 'openai/resources/chat/completions';

// Tool definitions for OpenRouter that map to opengov-mcp-server tools
export const opengovMcpTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_data',
      description: `Unified Socrata open data access tool. Supports multiple operation types:
- catalog: Search the catalog for datasets matching a query on a Socrata portal
- metadata: Get detailed metadata about a specific dataset (IMPORTANT: pass dataset_id in the "query" parameter, not "dataset_id")
- query: Execute a SoQL query against a dataset to fetch and filter data
- metrics: Get metrics/statistics about a dataset

IMPORTANT TIPS:
1. For type=metadata, pass the dataset ID in the "query" parameter (e.g., "query": "erm2-nwe9")
2. For type=query, ALWAYS start by fetching a sample with no WHERE clause to see actual column values
3. NYC 311 data uses field names like: complaint_type, descriptor, created_date, community_board
4. Field values are case-sensitive - fetch sample data first to see exact formats

Examples:
- Search catalog: { "type": "catalog", "portal": "data.cityofnewyork.us", "query": "311 complaints" }
- Get metadata: { "type": "metadata", "portal": "data.cityofnewyork.us", "query": "erm2-nwe9" }
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
            description: 'Dataset identifier (required for type=query)',
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

// Model definitions for the model selector
export interface ModelDefinition {
  id: string;
  name: string;
  provider: string;
  supports_tools: boolean;
  description?: string;
}

export const availableModels: ModelDefinition[] = [
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    supports_tools: true,
    description: 'Fast and affordable for most tasks',
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    supports_tools: true,
    description: 'Most capable OpenAI model',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    supports_tools: true,
    description: 'Excellent reasoning and analysis',
  },
  {
    id: 'meta-llama/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B',
    provider: 'Meta',
    supports_tools: true,
    description: 'Open source alternative',
  },
];
