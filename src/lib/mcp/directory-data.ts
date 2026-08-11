// MCP Server Directory data fetching
// Fetches from the configured source at build time, falls back to the
// checked-in snapshot. Source URL is instance configuration — see
// src/lib/site-config.ts (#241). The result carries its provenance so the
// page can attribute entries that are not this instance's own.

import fallbackData from './directory-fallback.json';
import { getDirectorySource } from '@/lib/site-config';
import type { ContentProvenance } from '@/lib/content-source';

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

export interface DirectoryData {
  servers: McpServerEntry[];
  /** Whose entries these are: this instance's, the community index's, or the
   *  snapshot bundled with this codebase after a fetch failure. */
  provenance: ContentProvenance;
  /** The URL that was fetched — what the attribution byline points at. */
  sourceUrl: string;
}

export async function getDirectoryData(): Promise<DirectoryData> {
  const { url, provenance } = getDirectorySource();
  try {
    const res = await fetch(url, {
      next: { revalidate: 3600 }, // ISR: 1 hour
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { servers: (await res.json()) as McpServerEntry[], provenance, sourceUrl: url };
  } catch (error) {
    console.warn(
      '[Directory] Failed to fetch the configured source, using bundled snapshot:',
      error instanceof Error ? error.message : error
    );
    // The snapshot is this codebase's own checked-in copy of the community
    // index — upstream content whichever source was configured, so it is
    // attributed as such rather than passed off as the instance's data.
    return { servers: fallbackData as McpServerEntry[], provenance: 'snapshot', sourceUrl: url };
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
