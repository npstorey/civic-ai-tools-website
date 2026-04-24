// Roadmap content fetching
// Fetches ROADMAP.md from the civic-ai-tools hub repo on GitHub raw at build time with 1-hour ISR.
// Mirrors the pattern in `src/lib/mcp/directory-data.ts` — hub repo is source of truth, drift window
// is small because the doc refreshes quarterly and carries its own version label in the body.

export const ROADMAP_RAW_URL =
  'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/ROADMAP.md';

export const ROADMAP_GITHUB_URL =
  'https://github.com/npstorey/civic-ai-tools/blob/main/ROADMAP.md';

export interface RoadmapFetchResult {
  ok: boolean;
  markdown: string | null;
  error?: string;
}

export async function getRoadmapMarkdown(): Promise<RoadmapFetchResult> {
  try {
    const res = await fetch(ROADMAP_RAW_URL, {
      next: { revalidate: 3600 }, // ISR: 1 hour
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const markdown = await res.text();
    return { ok: true, markdown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Roadmap] Failed to fetch from GitHub:', message);
    return { ok: false, markdown: null, error: message };
  }
}
