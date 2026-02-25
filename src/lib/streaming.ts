// Types for streaming events
export type StreamEventType = 'progress' | 'token' | 'complete' | 'error';
export type PanelType = 'withMcp' | 'withoutMcp';

export interface StreamEvent {
  type: StreamEventType;
  panel: PanelType;
  data?: unknown;
}

export type ProgressPhase = 'analyze' | 'tool_start' | 'tool_complete' | 'tool_result' | 'thinking' | 'synthesize';

export interface ProgressEvent extends StreamEvent {
  type: 'progress';
  message: string;
  duration_ms?: number;
  phase?: ProgressPhase;
  iteration?: number;
}

export interface TokenEvent extends StreamEvent {
  type: 'token';
  content: string;
}

export interface CompleteEvent extends StreamEvent {
  type: 'complete';
  data: {
    content: string;
    duration_ms: number;
    tokens_used: number;
    tools_called?: { name: string; args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; duration_ms?: number; operationType?: string; reason?: string }[];
  };
}

export interface ErrorEvent extends StreamEvent {
  type: 'error';
  message: string;
}

// Format tool call arguments into human-readable progress messages
export function formatToolProgress(name: string, args: Record<string, unknown>): string {
  const type = args.type as string;
  const portal = args.portal as string;
  const datasetId = args.dataset_id as string;
  const query = args.query as string;

  // Get city name from portal
  const cityName = getPortalCity(portal);
  const datasetName = getDatasetName(datasetId);

  switch (type) {
    case 'catalog':
      return `Searching ${cityName} data catalog${query ? `: "${query}"` : ''}`;
    case 'metadata':
      return `Getting metadata for ${query || datasetName}`;
    case 'query':
      // Build SoQL query string from separate parameters
      const soqlQuery = buildSoqlDisplay(args);
      if (soqlQuery) {
        const truncated = soqlQuery.length > 100 ? soqlQuery.slice(0, 100) + '...' : soqlQuery;
        return `Querying ${datasetName}: ${truncated}`;
      }
      return `Querying ${datasetName}`;
    case 'metrics':
      return `Fetching metrics for ${datasetName}`;
    default:
      return `Calling ${name}...`;
  }
}

// Build a display string showing the SoQL query being executed
function buildSoqlDisplay(args: Record<string, unknown>): string {
  return buildSoqlClauses(args).map(c => `${c.keyword} ${c.value}`).join(' ');
}

// Build structured SoQL clauses from tool args
export function buildSoqlClauses(args: Record<string, unknown>): { keyword: string; value: string }[] {
  const clauses: { keyword: string; value: string }[] = [];

  const select = args.select as string | undefined;
  const where = args.where as string | undefined;
  const group = args.group as string | undefined;
  const order = args.order as string | undefined;
  const limit = args.limit as number | undefined;

  if (select) clauses.push({ keyword: 'SELECT', value: select });
  if (where) clauses.push({ keyword: 'WHERE', value: where });
  if (group) clauses.push({ keyword: 'GROUP BY', value: group });
  if (order) clauses.push({ keyword: 'ORDER BY', value: order });
  if (limit) clauses.push({ keyword: 'LIMIT', value: String(limit) });

  return clauses;
}

function getPortalCity(portal: string | undefined): string {
  if (!portal) return 'data';

  const portalCities: Record<string, string> = {
    'data.cityofnewyork.us': 'NYC',
    'data.cityofchicago.org': 'Chicago',
    'data.sfgov.org': 'San Francisco',
    'data.lacity.org': 'Los Angeles',
    'data.seattle.gov': 'Seattle',
  };

  return portalCities[portal] || 'open data';
}

function getDatasetName(datasetId: string | undefined): string {
  if (!datasetId) return 'dataset';

  // Known dataset IDs from CLAUDE.md
  const datasetNames: Record<string, string> = {
    'erm2-nwe9': '311 Service Requests',
    '43nn-pn8j': 'Restaurant Inspections',
    'wvxf-dwi5': 'Housing Violations',
    'v6vf-nfxy': '311 Service Requests',
    'vw6y-z8j6': '311 Cases',
  };

  return datasetNames[datasetId] || `dataset ${datasetId}`;
}

// Format a human-readable message describing tool results
export function formatToolResult(
  args: Record<string, unknown>,
  resultSummary?: { rows: number; columns: number }
): string | null {
  const type = args.type as string;
  const datasetId = args.dataset_id as string | undefined;
  const datasetName = getDatasetName(datasetId);

  switch (type) {
    case 'catalog':
      return resultSummary
        ? `Found ${resultSummary.rows} dataset${resultSummary.rows !== 1 ? 's' : ''} matching the search`
        : 'Catalog search complete';
    case 'query':
      return resultSummary
        ? `Retrieved ${resultSummary.rows} record${resultSummary.rows !== 1 ? 's' : ''} from ${datasetName}`
        : `Query to ${datasetName} complete`;
    case 'metadata':
      return `Loaded metadata for ${datasetName}`;
    case 'metrics':
      return `Loaded metrics for ${datasetName}`;
    default:
      return null;
  }
}

// Generate a brief "why" reason from tool args for display in progress log and tool cards
export function generateToolReason(args: Record<string, unknown>): string {
  const type = args.type as string;
  const datasetId = args.dataset_id as string | undefined;
  const query = args.query as string | undefined;
  const datasetName = getDatasetName(datasetId);
  const group = args.group as string | undefined;
  const where = args.where as string | undefined;
  const select = args.select as string | undefined;

  switch (type) {
    case 'catalog':
      return query ? `to find datasets about "${query}"` : 'to search for relevant datasets';
    case 'metadata':
      return `to understand ${datasetName} structure`;
    case 'query':
      if (group) return `to aggregate ${datasetName} by ${group}`;
      if (where) return `to filter ${datasetName} records`;
      if (select) return `to retrieve specific fields from ${datasetName}`;
      return `to query ${datasetName}`;
    case 'metrics':
      return `to check ${datasetName} statistics`;
    default:
      return 'to gather data';
  }
}

// Encode a stream event as SSE format
export function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
