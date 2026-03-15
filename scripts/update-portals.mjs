#!/usr/bin/env node

/**
 * Portal registry discovery script.
 *
 * Discovers active open data portals and produces unified registry files
 * with a schema inspired by commondataio/dataportals-registry.
 *
 *   Platforms:
 *     Socrata — Socrata Discovery API (scroll for domains, per-domain counts)
 *     CKAN    — commondataio registry primary, dataportals.org fills gaps,
 *               live dataset counts via each portal's CKAN API
 *
 *   ArcGIS is tracked separately (see website#38).
 *
 * Outputs JSON + CSV to data/portals/.
 * Run locally:  node scripts/update-portals.mjs
 * Run via CI:   .github/workflows/update-portal-registries.yml
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'data', 'portals');

// ---------------------------------------------------------------------------
// Shared schema (unified across platforms)
// ---------------------------------------------------------------------------
//
// {
//   id:               string  — normalized domain, unique key
//   name:             string  — human-readable portal name
//   url:              string  — portal URL
//   platform:         string  — "socrata" | "ckan"
//   catalog_type:     string  — "Open data portal" | "Geoportal" | etc.
//   government_level: string  — "local" | "state" | "federal" | "international" | ""
//   country:          string  — ISO 3166-1 alpha-2
//   country_name:     string  — human-readable
//   owner_name:       string  — organization name
//   owner_type:       string  — "Central government", "Local government", etc.
//   api_endpoint:     string  — API base URL
//   dataset_count:    number  — live count (0 if unknown)
//   status:           string  — "active" | "inactive" | "deprecated"
// }

const COLUMNS = [
  'id', 'name', 'url', 'platform', 'catalog_type', 'government_level',
  'country', 'country_name', 'owner_name', 'owner_type',
  'api_endpoint', 'dataset_count', 'status',
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Extract bare hostname from any URL-ish string, lowercase, no www. */
function domainOf(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
  }
}

/**
 * Map commondataio coverage level + owner type → our government_level vocabulary.
 * commondataio levels: 10=international, 20=national, 30=subnational, 40+=local.
 * Level 30 is ambiguous (state vs city), so we use owner_type as a tiebreaker.
 */
function mapGovLevel(cdioEntry) {
  const level = cdioEntry?.coverage?.[0]?.location?.level;
  const ownerType = cdioEntry?.owner?.type || '';

  if (level === 10) return 'international';
  if (level === 20) return 'federal';
  if (level >= 40) return 'local';
  if (level === 30) {
    // Subnational: use owner_type to distinguish local (city/county) vs state
    if (/local government/i.test(ownerType)) return 'local';
    return 'state';
  }
  // No level — fall back to owner type
  if (/central government|federal government/i.test(ownerType)) return 'federal';
  if (/local government/i.test(ownerType)) return 'local';
  if (/regional government|state government/i.test(ownerType)) return 'state';
  if (/international/i.test(ownerType)) return 'international';
  return '';
}

/** Extract country from a commondataio entry. */
function cdioCountry(entry) {
  const c = entry?.coverage?.[0]?.location?.country;
  return { id: c?.id || '', name: c?.name || '' };
}

/** CSV with proper quoting. */
function toCSV(rows, columns) {
  const esc = (val) => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = columns.join(',');
  const body = rows.map(row => columns.map(col => esc(row[col])).join(','));
  return [header, ...body].join('\n') + '\n';
}

/** Run async fn over items with bounded concurrency. */
async function pMap(items, fn, concurrency = 5) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/** Fetch JSON with timeout. Returns null on failure. */
async function fetchJson(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source 1: Socrata Discovery API
// ---------------------------------------------------------------------------

const SOCRATA_CATALOG_URL = 'https://api.us.socrata.com/api/catalog/v1';
const SOCRATA_PAGE_SIZE = 1000;
const SOCRATA_MAX_PAGES = 200;

/** Scroll the full Socrata catalog to discover every domain. */
async function discoverSocrataDomains() {
  const domains = new Set();
  let scrollId = null;
  let totalScanned = 0;

  for (let page = 0; page < SOCRATA_MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(SOCRATA_PAGE_SIZE) });
    if (scrollId) params.set('scroll_id', scrollId);

    console.log(`  Socrata: page ${page + 1}${scrollId ? ` (scroll_id=${scrollId})` : ''}…`);
    const res = await fetch(`${SOCRATA_CATALOG_URL}?${params}`);
    if (!res.ok) throw new Error(`Socrata API ${res.status}: ${await res.text()}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) break;

    for (const result of data.results) {
      const domain = result.metadata?.domain;
      if (domain) domains.add(domain);
    }

    totalScanned += data.results.length;
    console.log(`  Socrata: ${domains.size} unique domains (${totalScanned} datasets scanned)`);

    if (data.results.length < SOCRATA_PAGE_SIZE) break;
    scrollId = data.results[data.results.length - 1].resource?.id;
    if (!scrollId) break;

    await new Promise(r => setTimeout(r, 200));
  }

  return [...domains].sort();
}

/**
 * Get dataset count for a Socrata domain. Uses only=datasets to exclude
 * derived views (maps, charts, filtered views, stories).
 *
 * Strategy:
 *   1. Central Discovery API with only=datasets (accurate for most portals)
 *   2. If central returns <10, portal may not be indexed centrally (e.g. SF) —
 *      fall back to querying the portal's own API
 *   3. Use whichever is higher
 *
 * Known limitation: both APIs cap resultSetSize at 10,000.
 */
async function getSocrataCount(rawDomain) {
  const centralData = await fetchJson(
    `${SOCRATA_CATALOG_URL}?domains=${encodeURIComponent(rawDomain)}&limit=0&only=datasets`,
    10000,
  );
  const centralCount = centralData?.resultSetSize ?? 0;

  if (centralCount >= 10) return centralCount;

  // Fallback: query the portal directly (catches portals not indexed centrally)
  const portalData = await fetchJson(
    `https://${rawDomain}/api/catalog/v1?domains=${encodeURIComponent(rawDomain)}&limit=0&only=datasets`,
    10000,
  );
  const portalCount = portalData?.resultSetSize ?? 0;

  return Math.max(centralCount, portalCount);
}

// ---------------------------------------------------------------------------
// Source 2: dataportals.org
// ---------------------------------------------------------------------------

async function fetchDataportals() {
  console.log('  Fetching dataportals.org…');
  const res = await fetch('https://dataportals.org/api/data.json');
  if (!res.ok) throw new Error(`dataportals.org ${res.status}: ${await res.text()}`);
  const raw = await res.json();
  return Array.isArray(raw) ? raw : Object.values(raw);
}

// ---------------------------------------------------------------------------
// Source 3: commondataio/dataportals-registry
// ---------------------------------------------------------------------------

const COMMONDATAIO_URL =
  'https://raw.githubusercontent.com/commondataio/dataportals-registry/main/data/datasets/catalogs.jsonl';

async function fetchCommondataio() {
  console.log('  Fetching commondataio catalogs.jsonl…');
  const res = await fetch(COMMONDATAIO_URL);
  if (!res.ok) throw new Error(`commondataio ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n').filter(Boolean);
  console.log(`  commondataio: ${lines.length} records loaded`);
  return lines.map(line => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// Build Socrata registry
// ---------------------------------------------------------------------------

async function buildSocrataRegistry(socrataDomains, cdioEntries) {
  // Index commondataio Socrata entries by normalized domain
  const cdioByDomain = new Map();
  for (const entry of cdioEntries) {
    if (entry.software?.id !== 'socrata') continue;
    const d = domainOf(entry.link || '');
    if (d) cdioByDomain.set(d, entry);
  }

  // Union of Socrata API + commondataio, deduplicating www. variants
  const domainMap = new Map(); // normalized → raw
  for (const raw of socrataDomains) {
    const norm = domainOf(raw);
    if (!domainMap.has(norm) || raw.length < domainMap.get(norm).length) {
      domainMap.set(norm, raw);
    }
  }
  for (const d of cdioByDomain.keys()) {
    if (!domainMap.has(d)) domainMap.set(d, d);
  }
  const sorted = [...domainMap.keys()].sort();

  // Get accurate dataset counts — 10 concurrent
  console.log(`  Socrata: querying dataset counts for ${sorted.length} domains…`);
  const counts = await pMap(
    sorted,
    async (normDomain, i) => {
      if (i > 0 && i % 100 === 0) console.log(`    …${i}/${sorted.length}`);
      return getSocrataCount(domainMap.get(normDomain));
    },
    10,
  );

  return sorted.map((normDomain, i) => {
    const rawDomain = domainMap.get(normDomain);
    const cdio = cdioByDomain.get(normDomain);
    const country = cdioCountry(cdio);
    return {
      id: normDomain,
      name: cdio?.name?.trim() || '',
      url: `https://${rawDomain}`,
      platform: 'socrata',
      catalog_type: cdio?.catalog_type || 'Open data portal',
      government_level: mapGovLevel(cdio),
      country: country.id,
      country_name: country.name,
      owner_name: cdio?.owner?.name || '',
      owner_type: cdio?.owner?.type || '',
      api_endpoint: `https://${rawDomain}/api`,
      dataset_count: counts[i],
      status: cdio?.status || 'active',
    };
  });
}

// ---------------------------------------------------------------------------
// Build CKAN registry
// ---------------------------------------------------------------------------

/** Query a CKAN portal for its dataset count via the standard API. */
async function getCkanCount(apiEndpoint) {
  if (!apiEndpoint) return 0;
  // Normalize: ensure it ends with /3 or similar, then call package_search
  const base = apiEndpoint.replace(/\/+$/, '');
  const searchUrl = base.endsWith('/3')
    ? `${base}/action/package_search?rows=0`
    : `${base}/3/action/package_search?rows=0`;
  const data = await fetchJson(searchUrl, 8000);
  return data?.result?.count ?? 0;
}

function buildCkanRegistry(dpEntries, cdioEntries) {
  const byDomain = new Map();

  // commondataio first (primary)
  for (const entry of cdioEntries) {
    if (entry.software?.id !== 'ckan') continue;
    const d = domainOf(entry.link || '');
    if (!d) continue;
    const country = cdioCountry(entry);
    const ckanEp = entry.endpoints?.find(e => e.type === 'ckan')?.url || '';

    byDomain.set(d, {
      id: d,
      name: entry.name?.trim() || d,
      url: entry.link || `https://${d}`,
      platform: 'ckan',
      catalog_type: entry.catalog_type || 'Open data portal',
      government_level: mapGovLevel(entry),
      country: country.id,
      country_name: country.name,
      owner_name: entry.owner?.name || '',
      owner_type: entry.owner?.type || '',
      api_endpoint: ckanEp,
      dataset_count: 0, // filled in by live query pass
      status: entry.status || '',
    });
  }

  // dataportals.org — only add portals not already present
  for (const entry of dpEntries) {
    if (!entry.generator || !/ckan/i.test(entry.generator)) continue;
    const d = domainOf(entry.url || '');
    if (!d || byDomain.has(d)) continue;

    byDomain.set(d, {
      id: d,
      name: entry.title || entry.name || d,
      url: entry.url || `https://${d}`,
      platform: 'ckan',
      catalog_type: 'Open data portal',
      government_level: '',
      country: entry.country || '',
      country_name: '',
      owner_name: '',
      owner_type: '',
      api_endpoint: entry.api_endpoint || '',
      dataset_count: 0,
      status: '',
    });
  }

  return [...byDomain.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Enrich CKAN portals with live dataset counts. */
async function enrichCkanCounts(portals) {
  const withEndpoint = portals.filter(p => p.api_endpoint);
  console.log(`  CKAN: querying dataset counts for ${withEndpoint.length} portals (${portals.length - withEndpoint.length} have no API endpoint)…`);
  let responded = 0;

  await pMap(
    withEndpoint,
    async (portal, i) => {
      if (i > 0 && i % 200 === 0) console.log(`    …${i}/${withEndpoint.length} (${responded} responded)`);
      const count = await getCkanCount(portal.api_endpoint);
      if (count > 0) {
        portal.dataset_count = count;
        responded++;
      }
    },
    20,
  );

  console.log(`  CKAN: ${responded}/${withEndpoint.length} portals returned live dataset counts`);
  return portals;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Portal registry discovery\n');

  // Phase 1: Fetch all sources in parallel
  console.log('Phase 1: Fetching sources…');
  const [socrataDomains, dpEntries, cdioEntries] = await Promise.all([
    discoverSocrataDomains(),
    fetchDataportals(),
    fetchCommondataio(),
  ]);
  console.log(
    `\n  Sources: ${socrataDomains.length} Socrata domains, ` +
      `${dpEntries.length} dataportals.org, ${cdioEntries.length} commondataio\n`,
  );

  // Phase 2: Build registries (Socrata counts are fetched inline)
  console.log('Phase 2: Building Socrata registry…');
  const socrata = await buildSocrataRegistry(socrataDomains, cdioEntries);

  console.log('\nPhase 3: Building CKAN registry…');
  let ckan = buildCkanRegistry(dpEntries, cdioEntries);

  console.log('\nPhase 4: Enriching CKAN with live dataset counts…');
  ckan = await enrichCkanCounts(ckan);

  // Phase 5: Write output files
  console.log('\nPhase 5: Writing files…');

  writeFileSync(join(OUTPUT_DIR, 'socrata.json'), JSON.stringify(socrata, null, 2) + '\n');
  writeFileSync(join(OUTPUT_DIR, 'socrata.csv'), toCSV(socrata, COLUMNS));

  writeFileSync(join(OUTPUT_DIR, 'ckan.json'), JSON.stringify(ckan, null, 2) + '\n');
  writeFileSync(join(OUTPUT_DIR, 'ckan.csv'), toCSV(ckan, COLUMNS));

  console.log(`\nResults:`);
  console.log(`  Socrata: ${socrata.length} portals`);
  console.log(`  CKAN:    ${ckan.length} portals (${ckan.filter(p => p.dataset_count > 0).length} with live counts)`);
  console.log(`  Total:   ${socrata.length + ckan.length} portals`);
  console.log(`\nFiles written to ${OUTPUT_DIR}/`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
