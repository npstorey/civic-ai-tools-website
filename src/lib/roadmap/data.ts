import { errorLogFacts } from '../streaming.ts';

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
    // The status rides on the error as a number, so the log line below keeps it.
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const markdown = await res.text();
    return { ok: true, markdown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `message` still goes back to the page, unchanged; the log line gets the
    // bounded facts, not the message (#503 WF).
    console.warn('[Roadmap] Failed to fetch the configured source:', errorLogFacts(error));
    return { ok: false, markdown: null, error: message };
  }
}
