'use client';

// Curated excerpts from src/lib/mcp/socrata-skill.ts (SOCRATA_SKILL constant).
// If that file changes, update the excerpts below to stay in sync.

import { useState } from 'react';

const GITHUB_SKILL_URL = 'https://github.com/npstorey/civic-ai-tools-website/blob/main/src/lib/mcp/socrata-skill.ts';

interface Category {
  id: string;
  name: string;
  description: string;
  excerpt: string;
}

const CATEGORIES: Category[] = [
  {
    id: 'data-sources',
    name: 'Data source knowledge',
    description: 'Known dataset IDs and field names for NYC, Chicago, SF',
    excerpt: `## NYC KEY DATASETS (data.cityofnewyork.us)
| Dataset | ID | Key Fields |
|---------|-----|------------|
| 311 Service Requests | erm2-nwe9 | complaint_type, borough, created_date, closed_date, descriptor, status |
| Restaurant Inspections | 43nn-pn8j | boro, grade, inspection_date, cuisine_description |
| Housing Violations | wvxf-dwi5 | boro, violationid, inspectiondate |
| Budget Data | d52a-yn36 | agency_name, budget_amount, fiscal_year |
| Payroll Data | k397-673e | agency_name, title_description, base_salary |

## CHICAGO KEY DATASETS (data.cityofchicago.org)
| Dataset | ID | Key Fields |
|---------|-----|------------|
| 311 Service Requests | v6vf-nfxy | sr_type, created_date, community_area |

## SF KEY DATASETS (data.sfgov.org)
| Dataset | ID | Key Fields |
|---------|-----|------------|
| 311 Cases | vw6y-z8j6 | service_name, opened, closed, neighborhood |`,
  },
  {
    id: 'query-patterns',
    name: 'Query patterns',
    description: 'SoQL syntax and Socrata-specific date functions',
    excerpt: `## SoQL PATTERNS
- Aggregation: "select": "complaint_type, COUNT(*) as count", "group": "complaint_type", "order": "count DESC"
- Date filter: "where": "created_date >= '2024-01-01'"
- Text search: "where": "complaint_type ILIKE '%noise%'"
- Multiple values: "where": "borough IN ('BROOKLYN', 'MANHATTAN')"
- Date range: "where": "created_date >= '2024-01-01' AND created_date < '2024-02-01'"

## SoQL DATE FUNCTIONS (NOT standard SQL!)
- Monthly aggregation: "select": "date_trunc_ym(created_date) as month, COUNT(*) as count", "group": "month", "order": "month"
- Year truncation: date_trunc_y(date_field)
- Year-month truncation: date_trunc_ym(date_field) - returns YYYY-MM-01T00:00:00
- Extract year: date_extract_y(date_field)
- Extract month: date_extract_m(date_field)
- Extract day: date_extract_d(date_field)
- IMPORTANT: Do NOT use DATE_TRUNC(), EXTRACT(), MONTH(), YEAR() - these are NOT supported!`,
  },
  {
    id: 'anti-hallucination',
    name: 'Anti-hallucination rules',
    description: '"NEVER hallucinate data" and verification requirements',
    excerpt: `## CRITICAL REQUIREMENTS
- NEVER hallucinate data - only report what tool calls actually return
- ALWAYS discover columns first with SELECT * LIMIT 1 before querying unfamiliar datasets
- Show the queries you used
- Field names are CASE-SENSITIVE`,
  },
  {
    id: 'workflow',
    name: 'Workflow guidance',
    description: 'Catalog \u2192 metadata \u2192 query progression',
    excerpt: `## WORKFLOW
1. Use type="catalog" to find datasets, OR use known dataset IDs below
2. Use type="query" with "select": "*", "limit": 1 to discover column names
3. Use type="query" with proper filters based on actual column names/values observed`,
  },
  {
    id: 'error-handling',
    name: 'Error handling',
    description: 'Timeouts, empty results, and safe date ranges',
    excerpt: `## DATE RANGE GUIDELINES (to avoid timeouts)
| Dataset Type | Safe Range |
|--------------|------------|
| NYC 311 (~10k/day) | Up to 30 days |
| Chicago 311 (~5k/day) | Up to 30 days |
| Housing Violations (~500/day) | Up to 90 days |

## ERROR HANDLING
- 400 Bad Request: Check field names (case-sensitive), validate data types
- 404 Not Found: Verify dataset ID format (4x4: abcd-1234)
- Empty results: Try broader query, check field values with sample data first`,
  },
];

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{
        transition: 'transform 0.15s',
        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        flexShrink: 0,
        color: 'var(--text-muted)',
      }}
    >
      <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z" />
    </svg>
  );
}

export default function SkillPromptDisclosure() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div style={{ marginTop: '12px' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--nyc-blue-40)',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          padding: 0,
          textDecoration: 'underline',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        How was the AI guided?
        <ChevronIcon expanded={isOpen} />
      </button>

      {isOpen && (
        <div
          style={{
            marginTop: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <p
            style={{
              margin: '0 0 6px 0',
              fontSize: '13px',
              lineHeight: '1.5',
              color: 'var(--text-secondary)',
            }}
          >
            Real AI applications are shaped by instructions most users never see.
            Here&apos;s exactly what this AI was told before answering your question &mdash; and why each instruction matters.
          </p>

          {CATEGORIES.map((cat) => {
            const expanded = expandedCategories.has(cat.id);
            return (
              <div
                key={cat.id}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => toggleCategory(cat.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'var(--card-background)',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '13px',
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {cat.name}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                    {cat.description}
                  </span>
                  <span style={{ flex: 1 }} />
                  <ChevronIcon expanded={expanded} />
                </button>

                {expanded && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      padding: '8px 12px',
                      backgroundColor: 'var(--card-background)',
                    }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        lineHeight: '1.5',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {cat.excerpt}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            <a
              href="/learn#system-prompt"
              style={{
                fontSize: '12px',
                color: 'var(--nyc-blue)',
                textDecoration: 'underline',
              }}
            >
              See the full system prompt breakdown &rarr;
            </a>
            <a
              href={GITHUB_SKILL_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '12px',
                color: 'var(--nyc-blue)',
                textDecoration: 'underline',
              }}
            >
              View on GitHub &rarr;
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
