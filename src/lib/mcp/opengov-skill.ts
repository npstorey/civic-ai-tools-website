// OpenGov MCP Skill - Domain knowledge for querying Socrata open data portals
// Based on: civic-ai-tools/docs/opengov-skill.md

export const OPENGOV_SKILL = `
## CRITICAL REQUIREMENTS
- NEVER hallucinate data - only report what tool calls actually return
- ALWAYS discover columns first with SELECT * LIMIT 1 before querying unfamiliar datasets
- Show the queries you used
- Field names are CASE-SENSITIVE

## WORKFLOW
1. Use type="catalog" to find datasets, OR use known dataset IDs below
2. Use type="query" with "select": "*", "limit": 1 to discover column names
3. Use type="query" with proper filters based on actual column names/values observed

## NYC KEY DATASETS (data.cityofnewyork.us)
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
| 311 Cases | vw6y-z8j6 | service_name, opened, closed, neighborhood |

## SoQL PATTERNS
- Aggregation: "select": "complaint_type, COUNT(*) as count", "group": "complaint_type", "order": "count DESC"
- Date filter: "where": "created_date >= '2024-01-01'"
- Text search: "where": "complaint_type ILIKE '%noise%'"
- Multiple values: "where": "borough IN ('BROOKLYN', 'MANHATTAN')"
- Date range: "where": "created_date >= '2024-01-01' AND created_date < '2024-02-01'"

## TOOL PARAMETERS
- For type=metadata, pass dataset_id in "query" parameter: {"type": "metadata", "query": "erm2-nwe9"}
- For type=query, use dataset_id parameter

## DATE RANGE GUIDELINES (to avoid timeouts)
| Dataset Type | Safe Range |
|--------------|------------|
| NYC 311 (~10k/day) | Up to 30 days |
| Chicago 311 (~5k/day) | Up to 30 days |
| Housing Violations (~500/day) | Up to 90 days |

## ERROR HANDLING
- 400 Bad Request: Check field names (case-sensitive), validate data types
- 404 Not Found: Verify dataset ID format (4x4: abcd-1234)
- Empty results: Try broader query, check field values with sample data first
`;

export const getSkillForPortal = (portal: string): string => {
  const portalSpecificGuidance: Record<string, string> = {
    'data.cityofnewyork.us': `
Use these NYC dataset IDs directly:
- 311 complaints: erm2-nwe9 (fields: complaint_type, borough, created_date)
- Restaurant inspections: 43nn-pn8j
- Housing violations: wvxf-dwi5`,
    'data.cityofchicago.org': `
Use these Chicago dataset IDs directly:
- 311 requests: v6vf-nfxy (fields: sr_type, created_date, community_area)`,
    'data.sfgov.org': `
Note: SF search sometimes returns incorrect results. Use dataset IDs directly:
- 311 cases: vw6y-z8j6 (fields: service_name, opened, neighborhood)`,
  };

  return portalSpecificGuidance[portal] || '';
};

export const buildSystemPrompt = (portal: string): string => {
  const portalGuidance = getSkillForPortal(portal);

  return `You are a helpful assistant with access to Socrata open data portals via the get_data tool.

${OPENGOV_SKILL}

## PORTAL-SPECIFIC GUIDANCE
Default portal: ${portal}
${portalGuidance}

When you get results, summarize clearly and cite the dataset ID used.`;
};
