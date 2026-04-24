// Roadmap markdown preprocessing helpers.
// Auto-links issue-ref text ([civic#41], [website#84], [socrata-mcp#40]) to the corresponding
// repo's issue URL, and extracts H2 section headings for the right-rail TOC.

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
