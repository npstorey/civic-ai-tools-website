'use client';

import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkIssueRefs, extractH2Headings, slugify, type SectionHeading } from '@/lib/roadmap/format';

interface RoadmapBodyProps {
  markdown: string;
}

export default function RoadmapBody({ markdown }: RoadmapBodyProps) {
  const processed = linkIssueRefs(markdown);
  const headings = extractH2Headings(markdown);

  return (
    <div className="roadmap-layout">
      <article className="roadmap-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Swallow the source doc's H1 — the page already has a "Roadmap" header;
            // two H1s would be redundant and a11y-noisy.
            h1: () => null,
            h2: ({ children }) => {
              const text = extractHeadingText(children);
              const id = slugify(text);
              return <h2 id={id}>{children}</h2>;
            },
            a: ({ href, children }) => {
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
          }}
        >
          {processed}
        </ReactMarkdown>
      </article>

      <TocRail headings={headings} />

      <style jsx>{`
        .roadmap-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 32px;
          align-items: start;
        }
        @media (min-width: 960px) {
          .roadmap-layout {
            grid-template-columns: minmax(0, 1fr) 220px;
          }
        }
        .roadmap-body {
          font-size: 16px;
          line-height: 1.7;
          color: var(--text-secondary);
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

function TocRail({ headings }: { headings: SectionHeading[] }) {
  if (headings.length === 0) return null;

  return (
    <>
      <aside className="toc-rail-desktop" aria-label="On this page">
        <div className="toc-inner">
          <div className="toc-label">On this page</div>
          <ul>
            {headings.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <details className="toc-rail-mobile">
        <summary>On this page</summary>
        <ul>
          {headings.map((h) => (
            <li key={h.id}>
              <a href={`#${h.id}`}>{h.text}</a>
            </li>
          ))}
        </ul>
      </details>

      <style jsx>{`
        .toc-rail-desktop {
          display: none;
        }
        @media (min-width: 960px) {
          .toc-rail-desktop {
            display: block;
            position: sticky;
            top: calc(var(--header-height, 72px) + 24px);
            align-self: start;
          }
        }
        .toc-inner {
          border-left: 1px solid var(--border-color);
          padding: 4px 0 4px 16px;
        }
        .toc-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 12px;
        }
        .toc-rail-desktop ul,
        .toc-rail-mobile ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .toc-rail-desktop a,
        .toc-rail-mobile a {
          font-size: 13px;
          color: var(--text-secondary);
          text-decoration: none;
          line-height: 1.4;
        }
        .toc-rail-desktop a:hover,
        .toc-rail-mobile a:hover {
          color: var(--nyc-blue);
          text-decoration: underline;
        }
        .toc-rail-mobile {
          order: -1;
          margin-bottom: 8px;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          padding: 12px 16px;
          font-size: 14px;
        }
        @media (min-width: 960px) {
          .toc-rail-mobile {
            display: none;
          }
        }
        .toc-rail-mobile summary {
          cursor: pointer;
          font-weight: 500;
          color: var(--text-primary);
        }
        .toc-rail-mobile ul {
          margin-top: 12px;
        }
      `}</style>
    </>
  );
}

function extractHeadingText(children: ReactNode): string {
  if (children == null) return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractHeadingText).join('');
  if (typeof children === 'object' && 'props' in children) {
    const props = (children as { props?: { children?: ReactNode } }).props;
    return extractHeadingText(props?.children);
  }
  return '';
}
