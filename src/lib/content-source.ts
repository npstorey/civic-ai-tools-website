// Content-source description helpers (#241).
//
// The `/directory` and `/roadmap` pages tell the reader where their content
// came from. Both the visible LABEL and the link TARGET of that byline are
// derived here, from the one configured source URL — so an instance that
// re-points a page can never end up with a correct link under a stale label
// (the defect PR #242 flagged, where the label was separate hardcoded copy).
//
// Pure and I/O-free: no env reads, no fetches. `src/lib/site-config.ts` owns
// the environment; this module only describes a URL.

/** A content source as the page shows it: what to call it, where to link. */
export interface ContentSourceRef {
  /** Human label, e.g. `civic-ai-tools/ROADMAP.md`. */
  label: string;
  /** Human-viewable URL — the GitHub file page for a raw GitHub URL. */
  href: string;
}

/** Where the content a page rendered actually came from. */
export type ContentProvenance =
  /** This instance's own configured source. */
  | 'instance'
  /** The shared community source this codebase ships against (no instance
   *  source configured) — shown with attribution, never as the site's own. */
  | 'community'
  /** The snapshot checked into this codebase, after a fetch failure. */
  | 'snapshot';

/**
 * Describe a content-source URL for display.
 *
 * GitHub raw and blob URLs collapse to `repo/path` with a link to the file
 * page a human can read — `…/npstorey/civic-ai-tools/main/ROADMAP.md` becomes
 * `civic-ai-tools/ROADMAP.md`. Any other URL keeps its host and path and
 * links to itself. An unparseable value is passed through untouched rather
 * than dropped: a misconfigured instance should see what it configured.
 */
export function describeContentSource(url: string): ContentSourceRef {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { label: url, href: url };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);

  if (parsed.host === 'raw.githubusercontent.com' && segments.length >= 4) {
    const [owner, repo, ...rest] = segments;
    // Two raw shapes: `/owner/repo/<ref>/path` and the fully-qualified
    // `/owner/repo/refs/heads/<branch>/path`.
    const refLength = rest[0] === 'refs' && rest.length >= 3 ? 3 : 1;
    const ref = rest.slice(0, refLength).join('/');
    const filePath = rest.slice(refLength);
    if (filePath.length > 0) {
      return {
        label: `${repo}/${filePath.join('/')}`,
        href: `https://github.com/${owner}/${repo}/blob/${ref}/${filePath.join('/')}`,
      };
    }
  }

  if (parsed.host === 'github.com' && segments.length >= 5 && segments[2] === 'blob') {
    const [, repo, , , ...filePath] = segments;
    return { label: `${repo}/${filePath.join('/')}`, href: url };
  }

  const path = segments.join('/');
  return { label: path ? `${parsed.host}/${path}` : parsed.host, href: url };
}

/**
 * The attribution note `/directory` shows above its entries, or `null` when
 * the entries are the instance's own and nothing needs saying.
 *
 * The directory is a shared community resource — a curated index of public
 * MCP servers is useful to any instance — so an unconfigured instance keeps
 * serving it rather than hiding it, and says whose it is (#241). A roadmap
 * is first-person and gets the opposite treatment; see `getRoadmapSource`.
 */
export function directorySourceNote(
  provenance: ContentProvenance,
  sourceUrl: string,
): { kind: 'community'; source: ContentSourceRef } | { kind: 'snapshot' } | null {
  if (provenance === 'instance') return null;
  if (provenance === 'snapshot') return { kind: 'snapshot' };
  return { kind: 'community', source: describeContentSource(sourceUrl) };
}

/** The `/directory` attribution note as the page passes it to the client. */
export type DirectorySourceNote = NonNullable<ReturnType<typeof directorySourceNote>>;
