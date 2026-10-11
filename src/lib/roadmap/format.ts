// Roadmap markdown preprocessing helpers.
// Auto-links issue-ref text ([civic#41], [website#84], [socrata-mcp#40]) to the corresponding
// repo's issue URL, resolves the document's relative links against the file it came from, and
// extracts H2 section headings for the right-rail TOC.

import { describeContentSource } from '../content-source.ts';

const REPO_ISSUE_URLS: Record<string, string> = {
  civic: 'https://github.com/npstorey/civic-ai-tools/issues',
  website: 'https://github.com/npstorey/civic-ai-tools-website/issues',
  'socrata-mcp': 'https://github.com/npstorey/socrata-mcp-server/issues',
};

// Matches a bracketed group of one or more issue refs separated by commas.
// Example matches: [civic#41], [website#84], [civic#41, civic#43], [civic#44, website#65, website#57]
const REF_GROUP_RE =
  /\[((?:(?:civic|website|socrata-mcp)#\d+)(?:,\s*(?:civic|website|socrata-mcp)#\d+)*)\]/g;

const SINGLE_REF_RE = /(civic|website|socrata-mcp)#(\d+)/g;

export function linkIssueRefs(markdown: string): string {
  return markdown.replace(REF_GROUP_RE, (_match, inner: string) => {
    return inner.replace(
      SINGLE_REF_RE,
      (_m: string, repo: string, num: string) =>
        `[${repo}#${num}](${REPO_ISSUE_URLS[repo]}/${num})`
    );
  });
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Where the roadmap's relative links resolve from: the page of the file the
 * markdown was fetched from. A GitHub raw URL resolves to its file page, so
 * `docs/x.md` lands on the repository's view of that file; any other host
 * resolves against the fetched URL itself.
 *
 * Derived from the raw URL, never from `ROADMAP_GITHUB_URL`: the byline's
 * link may be set to a repository or any other page, but a relative link in
 * a document is relative to where that document lives.
 */
export function roadmapLinkBase(rawUrl: string): string {
  return describeContentSource(rawUrl).href;
}

/**
 * A link in the roadmap markdown, as the page should render it.
 *
 * A relative path (`README.md`, `docs/adr/0025-….md#section`, `../x.md`) is
 * written relative to the source file. Rendered as-is it resolves against
 * this site and 404s (C6, 2026-10-10: five such links on /roadmap). It is
 * resolved against `base` (`roadmapLinkBase`). Left unchanged: absolute URLs
 * and other schemes (`mailto:`), in-page fragments (`#…`, which the TOC rail
 * uses), and root-relative paths (`/records`), which name a page on the site
 * rendering the roadmap.
 */
export function resolveRoadmapHref(href: string | undefined, base: string): string | undefined {
  if (!href || href.startsWith('#') || href.startsWith('/') || URL_SCHEME_RE.test(href)) {
    return href;
  }
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

export interface SectionHeading {
  text: string;
  id: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Extracts H2 section headings from a markdown string in source order.
// Used to build the right-rail TOC; IDs match what RoadmapBody's h2 renderer emits.
export function extractH2Headings(markdown: string): SectionHeading[] {
  const headings: SectionHeading[] = [];
  const re = /^## (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const text = match[1].trim();
    headings.push({ text, id: slugify(text) });
  }
  return headings;
}
