// Roadmap content fetching
// Fetches the instance's roadmap markdown at build time with 1-hour ISR. Mirrors the pattern in
// `src/lib/mcp/directory-data.ts` — the source repo is source of truth, drift window is small
// because the doc refreshes quarterly and carries its own version label in the body.
// The URL is passed in by the page: an instance with no roadmap source of its own never gets
// here at all, because there is nothing of its own to fetch — see src/lib/site-config.ts (#241).

export interface RoadmapFetchResult {
  ok: boolean;
  markdown: string | null;
  error?: string;
}

export async function getRoadmapMarkdown(rawUrl: string): Promise<RoadmapFetchResult> {
  try {
    const res = await fetch(rawUrl, {
      next: { revalidate: 3600 }, // ISR: 1 hour
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const markdown = await res.text();
    return { ok: true, markdown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Roadmap] Failed to fetch the configured source:', message);
    return { ok: false, markdown: null, error: message };
  }
}
