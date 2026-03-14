// MCP Server Directory data fetching
// Fetches from GitHub raw at build time, falls back to checked-in snapshot.

import fallbackData from './directory-fallback.json';

// Types — compatible subset of civic-ai-tools/data/mcp-server-schema.ts

export type Transport = 'stdio' | 'http' | 'sse';

export type CivicDomain =
  | 'open-data-portals'
  | 'census-demographics'
  | 'legislation-legal'
  | 'elections-campaign-finance'
  | 'health-public-health'
  | 'economic-financial'
  | 'government-contracting'
  | 'geospatial-gis'
  | 'weather-environment'
  | 'education'
  | 'transportation'
  | 'international-government'
  | 'framework-multi-portal'
  | 'civic-adjacent'
  | 'federal-government';

export type GovernmentLevel = 'local' | 'state' | 'federal' | 'international' | 'global' | 'multi';
export type Status = 'active' | 'inactive' | 'archived' | 'beta';
export type VerificationStatus = 'official' | 'community' | 'commercial';
export type PriorityTier = 'tier1' | 'tier2' | 'tier3';
export type DataPlatform = 'socrata' | 'ckan' | 'arcgis' | 'custom-api' | 'data-commons';

export interface McpServerEntry {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  transport: Transport[];
  categories: CivicDomain[];
  governmentLevel: GovernmentLevel[];
  maintainer: string;
  status: Status;
  dateAdded: string;
  dataSources?: string[];
  jurisdiction?: string;
  toolCount?: number;
  notes?: string;
  docsUrl?: string;
  npmPackage?: string;
  license?: string;
  programmingLanguage?: string;
  apiKeyRequired?: boolean;
  verificationStatus?: VerificationStatus;
  included?: boolean;
  dateModified?: string;
  dataPlatform?: DataPlatform[];
  tags?: string[];
  endpointUrl?: string;
  version?: string;
  publisher?: string;
  priority?: PriorityTier;
}

const GITHUB_RAW_URL =
  'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/data/mcp-servers.json';

export async function getDirectoryData(): Promise<McpServerEntry[]> {
  try {
    const res = await fetch(GITHUB_RAW_URL, {
      next: { revalidate: 3600 }, // ISR: 1 hour
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as McpServerEntry[];
  } catch (error) {
    console.warn(
      '[Directory] Failed to fetch from GitHub, using fallback:',
      error instanceof Error ? error.message : error
    );
    return fallbackData as McpServerEntry[];
  }
}

// Human-readable labels for domains
export const DOMAIN_LABELS: Record<CivicDomain, string> = {
  'open-data-portals': 'Open Data Portals',
  'census-demographics': 'Census & Demographics',
  'legislation-legal': 'Legislation & Legal',
  'elections-campaign-finance': 'Elections & Campaign Finance',
  'health-public-health': 'Health & Public Health',
  'economic-financial': 'Economic & Financial',
  'government-contracting': 'Government Contracting',
  'geospatial-gis': 'Geospatial / GIS',
  'weather-environment': 'Weather & Environment',
  'education': 'Education',
  'transportation': 'Transportation',
  'international-government': 'International Government',
  'framework-multi-portal': 'Framework / Multi-Portal',
  'civic-adjacent': 'Civic-Adjacent',
  'federal-government': 'Federal Government',
};

export const DATA_PLATFORM_LABELS: Record<DataPlatform, string> = {
  socrata: 'Socrata',
  ckan: 'CKAN',
  arcgis: 'ArcGIS',
  'custom-api': 'Custom API',
  'data-commons': 'Data Commons',
};

export const GOVERNMENT_LEVEL_LABELS: Record<GovernmentLevel, string> = {
  local: 'Local',
  state: 'State',
  federal: 'Federal',
  international: 'International',
  global: 'Global',
  multi: 'Multi-level',
};
