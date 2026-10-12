#!/usr/bin/env node

/**
 * Portal registry discovery script.
 *
 * Discovers active open data portals and produces unified registry files
 * with a schema inspired by commondataio/dataportals-registry.
 *
 *   Platforms:
 *     Socrata — Socrata Discovery API (scroll for domains, per-domain counts),
 *               named from commondataio; an entry whose portal moved follows
 *               it (mergeRedirectedEntries), and a domain with no public
 *               datasets and no commondataio entry is left out
 *               (isEmptyUnlistedDomain)
 *     CKAN    — commondataio registry primary, dataportals.org fills gaps,
 *               live dataset counts via each portal's CKAN API
 *
 *   ArcGIS is tracked separately (see website#38).
 *
 * Outputs JSON + CSV to data/portals/.
 * Run locally:  node scripts/update-portals.mjs  (Node >=22.15)
 * Run via CI:   .github/workflows/update-portal-registries.yml
 * Tests:        scripts/update-portals.test.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
// The full scroll took 181 pages on 2026-10-12. Hitting the cap is fatal, not
// a quiet stop: a truncated scroll writes a registry missing every later id.
const SOCRATA_MAX_PAGES = 400;

/** Scroll the full Socrata catalog to discover every domain. */
async function discoverSocrataDomains() {
  const domains = new Set();
  // scroll_id goes on the first page too, empty. Without it the API answers in
  // relevance order, so the last id on page 1 is not a cursor and the scroll
  // skips every id below it: measured 2026-10-12, 2,652 datasets scanned
  // where a July run had passed 63,000.
  let scrollId = '';
  let totalScanned = 0;
  let exhausted = false;

  for (let page = 0; page < SOCRATA_MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(SOCRATA_PAGE_SIZE), scroll_id: scrollId });

    console.log(`  Socrata: page ${page + 1}${scrollId ? ` (scroll_id=${scrollId})` : ''}…`);
    const res = await fetch(`${SOCRATA_CATALOG_URL}?${params}`);
    if (!res.ok) throw new Error(`Socrata API ${res.status}: ${await res.text()}`);
    const data = await res.json();

    const results = data.results ?? [];

    for (const result of results) {
      const domain = result.metadata?.domain;
      if (domain) domains.add(domain);
    }

    totalScanned += results.length;
    console.log(`  Socrata: ${domains.size} unique domains (${totalScanned} datasets scanned)`);

    if (results.length < SOCRATA_PAGE_SIZE) {
      exhausted = true;
      break;
    }
    scrollId = results[results.length - 1].resource?.id;
    if (!scrollId) throw new Error(`Socrata scroll: page ${page + 1}'s last result has no resource.id`);

    await new Promise(r => setTimeout(r, 200));
  }

  if (!exhausted) {
    throw new Error(`Socrata scroll: still going after ${SOCRATA_MAX_PAGES} pages (${totalScanned} datasets)`);
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
 * Returns null when neither API answered with a count, so a failed request is
 * never read as "no datasets" (isEmptyUnlistedDomain drops measured zeros).
 *
 * Known limitation: both APIs cap resultSetSize at 10,000.
 */
export async function getSocrataCount(rawDomain) {
  const centralData = await fetchJson(
    `${SOCRATA_CATALOG_URL}?domains=${encodeURIComponent(rawDomain)}&limit=0&only=datasets`,
    10000,
  );
  const centralCount = centralData?.resultSetSize;

  if (centralCount >= 10) return centralCount;

  // Fallback: query the portal directly (catches portals not indexed centrally)
  const portalData = await fetchJson(
    `https://${rawDomain}/api/catalog/v1?domains=${encodeURIComponent(rawDomain)}&limit=0&only=datasets`,
    10000,
  );
  const portalCount = portalData?.resultSetSize;

  const measured = [centralCount, portalCount].filter(Number.isInteger);
  return measured.length > 0 ? Math.max(...measured) : null;
}

/**
 * Whether a Socrata domain is left out of the registry: only when its count
 * was measured and is zero, AND the upstream registry has no entry for it.
 * Socrata's catalog lists hundreds of tenant domains with no public datasets
 * (UAT, staging, internal systems); 323 of 689 rows on 2026-10-12. A domain
 * the upstream registry describes stays even when empty, and one whose count
 * could not be measured stays (#589).
 */
export function isEmptyUnlistedDomain(count, hasRegistryEntry) {
  return count === 0 && !hasRegistryEntry;
}

/** Hostname a portal's catalog URL lands on after redirects; null on failure. */
async function finalHost(domain, timeoutMs = 10000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://${domain}/api/catalog/v1?limit=0`, { signal: controller.signal });
    clearTimeout(timer);
    await res.body?.cancel();
    return domainOf(res.url);
  } catch {
    return null;
  }
}

/**
 * Moves upstream-registry Socrata entries onto the domain their portal moved
 * to. An entry whose domain the Socrata catalog does not list, and whose
 * portal redirects to a domain the catalog does list, describes that domain:
 * it moves there, or, when the target has an entry of its own, it is dropped
 * as an alias. A redirect anywhere else (a portal that left Socrata) changes
 * nothing. On 2026-10-12 this moved San Francisco's entry onto the portal's
 * new domain and dropped an old-domain alias of Marin County's (#589).
 *
 * @param {Map<string, object>} entriesByDomain normalized domain → entry
 * @param {Set<string>} catalogDomains normalized domains the catalog lists
 * @param {Map<string, string>} redirects normalized domain → normalized host it lands on
 * @returns {Map<string, object>} a new map; the input is not modified
 */
export function mergeRedirectedEntries(entriesByDomain, catalogDomains, redirects) {
  const movesTo = (d) => {
    const target = redirects.get(d);
    return !catalogDomains.has(d) && target && target !== d && catalogDomains.has(target) ? target : null;
  };
  const merged = new Map();
  // Entries that stay go first, so a moved entry never displaces one of them.
  for (const [d, entry] of entriesByDomain) {
    if (!movesTo(d)) merged.set(d, entry);
  }
  for (const [d, entry] of entriesByDomain) {
    const target = movesTo(d);
    if (target && !merged.has(target)) merged.set(target, entry);
  }
  return merged;
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

// The registry moved from commondataio/ to datenoio/ and, on 2026-09-12
// (upstream d06d9b2), stopped publishing catalogs.jsonl uncompressed; only the
// zstd file remains. zlib gained zstd in Node 22.15, hence .nvmrc's 22.
const COMMONDATAIO_URL =
  'https://raw.githubusercontent.com/datenoio/dataportals-registry/main/data/datasets/catalogs.jsonl.zst';

async function fetchCommondataio() {
  console.log('  Fetching commondataio catalogs.jsonl.zst…');
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error(`commondataio: node:zlib has no zstd in Node ${process.version} (needs >=22.15)`);
  }
  const res = await fetch(COMMONDATAIO_URL);
  if (!res.ok) throw new Error(`commondataio ${res.status}`);
  const text = zlib.zstdDecompressSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  console.log(`  commondataio: ${lines.length} records loaded`);
  return lines.map(line => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// Build Socrata registry
// ---------------------------------------------------------------------------

export async function buildSocrataRegistry(socrataDomains, cdioEntries) {
  // Index commondataio Socrata entries by normalized domain
  const listedByDomain = new Map();
  for (const entry of cdioEntries) {
    if (entry.software?.id !== 'socrata') continue;
    const d = domainOf(entry.link || '');
    if (d) listedByDomain.set(d, entry);
  }

  // Follow the redirects of entries the Socrata catalog does not list
  const catalogDomains = new Set(socrataDomains.map(domainOf));
  const unlisted = [...listedByDomain.keys()].filter(d => !catalogDomains.has(d));
  console.log(`  Socrata: checking ${unlisted.length} upstream-only domains for a moved portal…`);
  const finals = await pMap(unlisted, d => finalHost(d), 10);
  const redirects = new Map(unlisted.map((d, i) => [d, finals[i]]).filter(([, f]) => f));
  for (const [d, target] of redirects) {
    if (target !== d && catalogDomains.has(target)) console.log(`    ${d} → ${target}`);
  }
  const cdioByDomain = mergeRedirectedEntries(listedByDomain, catalogDomains, redirects);

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

  const kept = sorted.filter((d, i) => !isEmptyUnlistedDomain(counts[i], cdioByDomain.has(d)));
  console.log(
    `  Socrata: left out ${sorted.length - kept.length} domains with no public datasets and no upstream entry; ` +
      `${counts.filter(c => c === null).length} counts could not be measured`,
  );
  const countOf = new Map(sorted.map((d, i) => [d, counts[i] ?? 0]));

  return kept.map((normDomain) => {
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
      dataset_count: countOf.get(normDomain),
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

// Imported by its test, run as a script by the workflow.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
