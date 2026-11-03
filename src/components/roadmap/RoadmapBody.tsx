'use client';

import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  linkIssueRefs,
  slugify,
  resolveRoadmapHref,
  roadmapLinkBase,
  splitRoadmapPreamble,
  type SectionHeading,
} from '@/lib/roadmap/format';
import { PageToc } from '@/components/ui/PageToc';

interface RoadmapBodyProps {
  markdown: string;
  /** The URL the markdown was fetched from; its relative links resolve against this file. */
  sourceUrl: string;
}

/** The design's rule (§2 P9): a page with more than five h2s gets a jump list. */
const JUMP_LIST_ABOVE = 5;

/** The minimal shape of a parsed (hast) node this file reads. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function hastText(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/**
 * The ONE source of the roadmap's section ids (UX-1 P7). A rehype step over
 * the parsed body: each h2 gets its id here, from the text it renders (a
 * link, code or emphasis inside it contributes its text, never its syntax),
 * de-duplicated in document order, and the same id goes into `headings`, which
 * the jump list renders. The h2 renderer below writes the id it is given and
 * computes none of its own.
 */
function sectionIds(headings: SectionHeading[]) {
  return (tree: HastNode) => {
    const seen = new Map<string, number>();
    const visit = (node: HastNode) => {
      if (node.type === 'element' && node.tagName === 'h2') {
        const text = hastText(node).trim();
        const base = slugify(text) || 'section';
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        const id = count === 1 ? base : `${base}-${count}`;
        node.properties = { ...node.properties, id };
        headings.push({ text, id });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

export default function RoadmapBody({ markdown, sourceUrl }: RoadmapBodyProps) {
  const { preamble, body, lastUpdated } = splitRoadmapPreamble(linkIssueRefs(markdown));
  const linkBase = roadmapLinkBase(sourceUrl);

  const components: Components = {
    // Swallow the source doc's H1 — the page already has a "Roadmap" header;
    // two H1s would be redundant and a11y-noisy.
    h1: () => null,
    // The id comes from `sectionIds`, the one source the jump list reads too.
    h2: ({ id, children }) => <h2 id={id}>{children}</h2>,
    a: ({ href: written, children }) => {
      const href = resolveRoadmapHref(written, linkBase);
      const isExternal = href?.startsWith('http');
      return (
        <a
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
        >
          {children}
        </a>
      );
    },
  };

  // The body is rendered here, before the jump list, so the jump list reads
  // the ids `sectionIds` wrote while rendering it.
  const headings: SectionHeading[] = [];
  const rehypePlugins = [[sectionIds, headings]] as unknown as NonNullable<Options['rehypePlugins']>;
  const renderedBody = ReactMarkdown({ children: body, remarkPlugins: [remarkGfm], rehypePlugins, components });

  return (
    <div className="roadmap-layout">
      {headings.length > JUMP_LIST_ABOVE && (
        <PageToc label="On this page" items={headings.map((h) => ({ id: h.id, label: h.text }))} />
      )}
      <article className="roadmap-body">
        {/* The status lines and framing above section 1 fold behind one line, so the
            first section is what a reader sees first. */}
        {preamble && (
          <details className="roadmap-about">
            <summary>
              {lastUpdated && (
                <>
                  <span>Last updated on {lastUpdated}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="roadmap-about-toggle">
                {lastUpdated ? 'More about this document' : 'About this document'}
              </span>
            </summary>
            <div className="roadmap-about-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {preamble}
              </ReactMarkdown>
            </div>
          </details>
        )}
        {renderedBody}
      </article>

      <style jsx>{`
        .roadmap-body {
          font-size: 16px;
          line-height: 1.7;
          color: var(--text-secondary);
        }
        .roadmap-about {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-muted);
        }
        .roadmap-about summary {
          display: inline-block;
          cursor: pointer;
          list-style: none;
        }
        .roadmap-about summary > span + span {
          margin-left: 8px;
        }
        .roadmap-about summary::-webkit-details-marker {
          display: none;
        }
        .roadmap-about-toggle {
          color: var(--text-secondary);
        }
        .roadmap-about summary:hover .roadmap-about-toggle {
          color: var(--accent);
          text-decoration: underline;
        }
        .roadmap-about-toggle::after {
          content: '▸';
          display: inline-block;
          margin-left: 6px;
        }
        .roadmap-about[open] .roadmap-about-toggle::after {
          transform: rotate(90deg);
        }
        .roadmap-about-body {
          margin-top: 16px;
          padding-left: 16px;
          border-left: 2px solid var(--border-color);
        }
        .roadmap-about-body :global(p:last-child) {
          margin-bottom: 0;
        }
        .roadmap-body :global(h2) {
          font-size: 24px;
          line-height: 1.3;
          color: var(--text-primary);
          margin-top: 48px;
          margin-bottom: 16px;
          scroll-margin-top: 96px;
        }
        .roadmap-body :global(h3) {
          font-size: 18px;
          line-height: 1.4;
          color: var(--text-primary);
          margin-top: 32px;
          margin-bottom: 12px;
        }
        .roadmap-body :global(p) {
          margin-bottom: 16px;
        }
        .roadmap-body :global(ul),
        .roadmap-body :global(ol) {
          margin: 0 0 16px 0;
          padding-left: 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .roadmap-body :global(li) {
          line-height: 1.6;
        }
        .roadmap-body :global(li > ul),
        .roadmap-body :global(li > ol) {
          margin-top: 12px;
        }
        .roadmap-body :global(hr) {
          margin: 48px 0;
          border: 0;
          border-top: 1px solid var(--border-color);
        }
        .roadmap-body :global(strong) {
          color: var(--text-primary);
        }
        .roadmap-body :global(em) {
          color: var(--text-secondary);
        }
        .roadmap-body :global(code) {
          background-color: var(--card-background);
          border: 1px solid var(--border-color);
          border-radius: 3px;
          padding: 1px 6px;
          font-size: 13px;
          font-family: var(--font-mono, monospace);
        }
        .roadmap-body :global(blockquote) {
          border-left: 3px solid var(--border-color);
          padding-left: 16px;
          margin: 16px 0;
          color: var(--text-muted);
          font-style: italic;
        }
        .roadmap-body :global(table) {
          border-collapse: collapse;
          margin: 16px 0;
          font-size: 14px;
          width: 100%;
        }
        .roadmap-body :global(th),
        .roadmap-body :global(td) {
          border: 1px solid var(--border-color);
          padding: 8px 12px;
          text-align: left;
        }
        .roadmap-body :global(th) {
          background-color: var(--card-background);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
