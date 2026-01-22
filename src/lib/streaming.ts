// Types for streaming events
export type StreamEventType = 'progress' | 'token' | 'complete' | 'error';
export type PanelType = 'withMcp' | 'withoutMcp';

export interface StreamEvent {
  type: StreamEventType;
  panel: PanelType;
  data?: unknown;
}

export interface ProgressEvent extends StreamEvent {
  type: 'progress';
  message: string;
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
    tools_called?: { name: string; args: Record<string, unknown> }[];
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
      return `Getting metadata for ${datasetName}`;
    case 'query':
      // Show the actual SoQL query being executed
      if (query) {
        // Truncate very long queries but show the key parts
        const truncatedQuery = query.length > 120 ? query.slice(0, 120) + '...' : query;
        return `Querying ${datasetName}: ${truncatedQuery}`;
      }
      return `Querying ${datasetName}`;
    case 'metrics':
      return `Fetching metrics for ${datasetName}`;
    default:
      return `Calling ${name}...`;
  }
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

// Encode a stream event as SSE format
export function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
