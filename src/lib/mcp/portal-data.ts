// Portal directory data loading
// Loads checked-in JSON files at build time — no fetching needed.

import socrataPortals from '../../../data/portals/socrata.json';
import ckanPortals from '../../../data/portals/ckan.json';

export interface PortalEntry {
  id: string;
  name: string;
  url: string;
  platform: 'socrata' | 'ckan';
  catalog_type: string;
  government_level: string;
  country: string;
  country_name: string;
  owner_name: string;
  owner_type: string;
  api_endpoint: string;
  dataset_count: number;
  status: string;
}

export interface PortalCounts {
  socrata: number;
  ckan: number;
  total: number;
}

export async function getPortalData(): Promise<PortalEntry[]> {
  return [...(socrataPortals as PortalEntry[]), ...(ckanPortals as PortalEntry[])];
}

export async function getPortalCounts(): Promise<PortalCounts> {
  const socrata = socrataPortals.length;
  const ckan = ckanPortals.length;
  return { socrata, ckan, total: socrata + ckan };
}
