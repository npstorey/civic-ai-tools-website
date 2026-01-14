import type { ChatCompletionTool } from 'openai/resources/chat/completions';

// Tool definitions for OpenRouter that map to opengov-mcp-server tools
export const opengovMcpTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_data',
      description: `Unified Socrata open data access tool. Supports multiple operation types:
- search: Search for datasets matching a query on a Socrata portal
- fetch: Fetch rows from a specific dataset by ID
- query: Execute a SoQL query against a dataset
- metadata: Get detailed metadata about a dataset

Examples:
- Search for datasets: { "type": "search", "portal": "data.sfgov.org", "query": "311 complaints" }
- Fetch data: { "type": "fetch", "portal": "data.sfgov.org", "dataset_id": "abc123", "limit": 10 }
- Query data: { "type": "query", "portal": "data.sfgov.org", "dataset_id": "abc123", "select": "category, COUNT(*)", "group": "category" }
- Get metadata: { "type": "metadata", "portal": "data.sfgov.org", "dataset_id": "abc123" }`,
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['search', 'fetch', 'query', 'metadata'],
            description: 'The type of operation to perform',
          },
          portal: {
            type: 'string',
            description: 'Socrata portal domain (e.g., data.sfgov.org, data.cityofchicago.org)',
          },
          query: {
            type: 'string',
            description: 'Search query (required for type=search)',
          },
          dataset_id: {
            type: 'string',
            description: 'Dataset identifier (required for fetch/query/metadata)',
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
