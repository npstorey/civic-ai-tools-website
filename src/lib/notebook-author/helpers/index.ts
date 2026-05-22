/**
 * Helper-function source loader for executed notebooks.
 *
 * Per ADR-0005 §3, civic-data helper functions (fetch_socrata,
 * fetch_data_commons, fetch_opencontext) are embedded inline in cell-3 of
 * every executed notebook. The Python source files in this directory are
 * the source-of-truth; this loader reads them at startup and exposes the
 * raw text so the LLM prompt template (../prompt.ts) can interpolate the
 * subset relevant to each notebook.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));

export type HelperId = 'fetch_socrata' | 'fetch_data_commons' | 'fetch_opencontext';

const FILE_BY_ID: Record<HelperId, string> = {
  fetch_socrata: 'fetch_socrata.py',
  fetch_data_commons: 'fetch_data_commons.py',
  fetch_opencontext: 'fetch_opencontext.py',
};

function readHelperSource(id: HelperId): string {
  return fs.readFileSync(path.join(HELPERS_DIR, FILE_BY_ID[id]), 'utf8');
}

const SOURCE_CACHE: Partial<Record<HelperId, string>> = {};

/** Return the raw Python source for a helper, cached per-process. */
export function getHelperSource(id: HelperId): string {
  if (!SOURCE_CACHE[id]) {
    SOURCE_CACHE[id] = readHelperSource(id);
  }
  return SOURCE_CACHE[id]!;
}

/** Return Python source for every helper concatenated, in canonical order. */
export function getAllHelperSources(): string {
  const order: HelperId[] = ['fetch_socrata', 'fetch_data_commons', 'fetch_opencontext'];
  return order.map(id => getHelperSource(id)).join('\n\n');
}

/**
 * Map an MCP tool name to the helper it implies. Used by the prompt template
 * to pick the minimal helper subset for the notebook based on which MCP
 * tools the LLM actually called during Phase A discovery.
 */
export function helperForToolName(toolName: string): HelperId | null {
  if (toolName === 'get_data') return 'fetch_socrata';
  if (toolName === 'search_indicators' || toolName === 'get_observations') return 'fetch_data_commons';
  if (toolName.startsWith('ckan__')) return 'fetch_opencontext';
  return null;
}

/**
 * Given a list of MCP tool names called during Phase A, return the deduped
 * helper-id list in canonical order, or all three helpers if none mapped
 * (defensive: an empty list means the notebook will have an unused-helpers
 * cell, which is harmless; we never want to ship a notebook missing a
 * helper it actually needs).
 */
export function helpersForToolNames(toolNames: readonly string[]): HelperId[] {
  const set = new Set<HelperId>();
  for (const name of toolNames) {
    const id = helperForToolName(name);
    if (id) set.add(id);
  }
  if (set.size === 0) {
    return ['fetch_socrata'];
  }
  const order: HelperId[] = ['fetch_socrata', 'fetch_data_commons', 'fetch_opencontext'];
  return order.filter(id => set.has(id));
}
