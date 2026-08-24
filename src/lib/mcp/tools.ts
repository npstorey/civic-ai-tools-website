import type { ChatCompletionTool } from 'openai/resources/chat/completions';

// Unified OpenAI-style function-calling schema spanning every MCP source the
// website talks to. The client in `./client.ts` uses the tool name to route
// each call to the correct MCP server via `./registry.ts`.

// --- Socrata MCP (city open data portals) ---
const socrataMcpTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_data',
      description: `Unified Socrata open data access tool. Supports multiple operation types:
- catalog: Search the catalog for datasets matching a query on a Socrata portal
- metadata: Get detailed metadata about a specific dataset
- query: Execute a SoQL query against a dataset to fetch and filter data
- metrics: Get row count, view count, last-updated timestamps for a dataset

IMPORTANT TIPS:
1. For type=metadata and type=metrics, pass the dataset ID in "dataset_id"
2. For type=query, ALWAYS start by fetching a sample with no WHERE clause to see actual column values
3. NYC 311 data uses field names like: complaint_type, descriptor, created_date, community_board
4. Field values are case-sensitive - fetch sample data first to see exact formats

Examples:
- Search catalog: { "type": "catalog", "portal": "data.cityofnewyork.us", "query": "311 complaints" }
- Get metadata: { "type": "metadata", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9" }
- Get metrics: { "type": "metrics", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9" }
- Fetch sample data first: { "type": "query", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9", "limit": 5 }
- Query with filter: { "type": "query", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9", "select": "complaint_type, COUNT(*) as count", "group": "complaint_type", "order": "count DESC", "limit": 10 }`,
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['catalog', 'metadata', 'query', 'metrics'],
            description: 'The type of operation to perform',
          },
          portal: {
            type: 'string',
            description: 'Socrata portal domain (e.g., data.cityofnewyork.us, data.sfgov.org)',
          },
          query: {
            type: 'string',
            description: 'For type=catalog: search query. For type=metadata: the dataset ID. For type=query: optional full-text search within data.',
          },
          dataset_id: {
            type: 'string',
            description: 'Dataset identifier (required for type=query, metadata, and metrics)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of rows to return (default: 10)',
          },
          offset: {
            type: 'number',
            description: 'Number of rows to skip (for pagination)',
          },
          select: {
            type: 'string',
            description: 'SoQL select clause (for type=query)',
          },
          where: {
            type: 'string',
            description: 'SoQL where clause (for type=query)',
          },
          order: {
            type: 'string',
            description: 'SoQL order clause (for type=query)',
          },
          group: {
            type: 'string',
            description: 'SoQL group clause (for type=query)',
          },
        },
        required: ['type'],
      },
    },
  },
];

// --- Google Data Commons MCP (US demographic + federal statistical data) ---
// Two-tool surface: discover variables/topics with `search_indicators`, then
// fetch observed values with `get_observations`. Tools hit the hosted
// endpoint at https://api.datacommons.org/mcp. Full aggregation-semantics
// guidance (variable DCIDs, place hierarchies, vintage, margins of error) is
// a M9.2 concern and lives in the skill prompt, not the tool descriptions.
const dataCommonsMcpTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_indicators',
      description: `Discover statistical variables and topics available in Google Data Commons — the knowledge graph aggregating US Census Bureau (ACS, Decennial), BLS, CDC, Department of Education, EPA, and many international statistical sources.

Use this first when the user asks for demographic, economic, health, education, or environmental statistics and you don't already know the exact variable DCID. The tool returns candidate variable DCIDs that you then pass to get_observations.

IMPORTANT: Data Commons uses DCIDs (Data Commons identifiers) rather than raw Census field names. Always discover the variable DCID via search_indicators before calling get_observations — guessing the DCID silently returns wrong data.

Examples:
- { "query": "median household income", "places": ["geoId/3604600637"] }  // search near a NYC census tract
- { "query": "poverty rate", "parent_place": "geoId/36061" }  // search indicators scoped to New York County
- { "query": "asthma prevalence adults" }  // free-text topic search`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Free-text search query (e.g., "median household income", "poverty rate", "asthma prevalence")',
          },
          places: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of place DCIDs to scope the search to — the tool returns variables that have observations for those places.',
          },
          parent_place: {
            type: 'string',
            description: 'Optional parent place DCID — the tool returns variables that cover children of this place.',
          },
          per_search_limit: {
            type: 'number',
            description: 'Max results per category (default: 10)',
          },
          include_topics: {
            type: 'boolean',
            description: 'Include topic-level results alongside individual variables (default: true)',
          },
          maybe_bilateral: {
            type: 'boolean',
            description: 'Include bilateral (two-place) variables such as trade flows (default: false)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_observations',
      description: `Fetch statistical observations for a Data Commons variable at a specified place and time.

Requires a variable_dcid (discovered via search_indicators) and a place_dcid. Common place DCID patterns:
- Country: "country/USA"
- State: "geoId/36" (NY)
- County: "geoId/36061" (New York County)
- Census Tract: "geoId/36061013700" (state + county + tract FIPS)
- ZCTA: "zip/10001"

Use child_place_type to fetch observations for all children of a place at a given geography level (e.g., all tracts within a county).

CRITICAL: Data Commons returns wrong data silently if you pick the wrong variable, time range, or place type. Always prefer the latest vintage unless the user explicitly asks for a historical series. Cite the variable DCID and observation date in your summary.

Examples:
- Latest median household income for a NYC census tract:
  { "variable_dcid": "Median_Income_Household", "place_dcid": "geoId/36061013700" }
- All tracts in New York County (Manhattan):
  { "variable_dcid": "Median_Income_Household", "place_dcid": "geoId/36061", "child_place_type": "CensusTract" }
- Historical range:
  { "variable_dcid": "Count_Person", "place_dcid": "country/USA", "date_range_start": "2015", "date_range_end": "2023" }`,
      parameters: {
        type: 'object',
        properties: {
          variable_dcid: {
            type: 'string',
            description: 'Data Commons identifier for the statistical variable (e.g., "Median_Income_Household"). Discover via search_indicators.',
          },
          place_dcid: {
            type: 'string',
            description: 'Data Commons identifier for the place (e.g., "geoId/36061" for New York County, "country/USA", "zip/10001")',
          },
          child_place_type: {
            type: 'string',
            description: 'Optional child geography to enumerate (e.g., "CensusTract", "County", "State"). Returns observations for every child of place_dcid at this level.',
          },
          source_override: {
            type: 'string',
            description: 'Optional override for the upstream data source when multiple sources provide the same variable.',
          },
          date: {
            type: 'string',
            description: 'Specific observation date (default: "LATEST"). Use ISO year or YYYY-MM format.',
          },
          date_range_start: {
            type: 'string',
            description: 'Start of a date range query (inclusive). Use with date_range_end instead of date.',
          },
          date_range_end: {
            type: 'string',
            description: 'End of a date range query (inclusive).',
          },
        },
        required: ['variable_dcid', 'place_dcid'],
      },
    },
  },
];

// --- Boston OpenContext MCP (CKAN-native, data.boston.gov) ---
// Six-tool surface routed to the production OpenContext endpoint at
// https://data-mcp.boston.gov/mcp. OpenContext is the City of Boston's
// open-source MCP framework fronting the CKAN DataStore; full CKAN vs Socrata
// workflow and Boston-specific geography guidance lives in the skill prompt
// (see `./boston-skill.ts`). Tool names preserve the `ckan__` prefix used by
// the upstream server so the registry-layer tool-name → source routing works
// without a rename layer.
const bostonOpencontextMcpTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'ckan__search_datasets',
      description: `Natural-language dataset discovery against Boston's CKAN portal (data.boston.gov). Returns candidate datasets with their CKAN UUID resource ids, titles, and descriptions.

Use this first when the user asks about Boston civic data and you don't already know the resource UUID. Pair with ckan__get_dataset to inspect a specific candidate or ckan__get_schema to fetch field names for querying.

Examples:
- { "query": "311 pothole requests", "limit": 5 }
- { "query": "building permits" }`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Free-text search query (e.g., "311 pothole requests", "building permits", "assessing values")',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results (default: 20)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ckan__get_dataset',
      description: `Fetch detailed metadata for a specific Boston dataset — title, publisher, update cadence, description, and the list of CKAN resources attached to it. Use after ckan__search_datasets when you need to pick the right resource within a dataset that bundles several.

Example:
- { "dataset_id": "311-service-requests" }
- { "dataset_id": "8048697b-ad64-4bfc-b090-ee00169f2323" }`,
      parameters: {
        type: 'object',
        properties: {
          dataset_id: {
            type: 'string',
            description: 'CKAN dataset ID or slug (UUID or human-readable name)',
          },
        },
        required: ['dataset_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ckan__get_schema',
      description: `Fetch the field names and types for a specific Boston CKAN resource. Always run this before querying an unfamiliar resource — Boston follows CKAN field-naming conventions that differ from Socrata portals (NYC, Chicago, etc.), and guessing a field name can silently return zero rows.

Example:
- { "resource_id": "8048697b-ad64-4bfc-b090-ee00169f2323" }`,
      parameters: {
        type: 'object',
        properties: {
          resource_id: {
            type: 'string',
            description: 'CKAN resource UUID (e.g., "8048697b-ad64-4bfc-b090-ee00169f2323")',
          },
        },
        required: ['resource_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ckan__query_data',
      description: `Simple equality-filter query against a Boston CKAN resource. Supports exact-match filtering on one or more fields. For GROUP BY / aggregation, use ckan__aggregate_data. For complex SQL (CTEs, window functions, JOINs), use ckan__execute_sql.

Example:
- { "resource_id": "8048697b-ad64-4bfc-b090-ee00169f2323", "filters": { "neighborhood": "Dorchester" }, "limit": 100 }`,
      parameters: {
        type: 'object',
        properties: {
          resource_id: {
            type: 'string',
            description: 'CKAN resource UUID to query',
          },
          filters: {
            type: 'object',
            description: 'Optional exact-match filters as field: value pairs (e.g., { "neighborhood": "Dorchester" })',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of records (default: 100)',
          },
        },
        required: ['resource_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ckan__aggregate_data',
      description: `Structured GROUP BY + aggregation against a Boston CKAN resource. The server compiles a safe SQL query from a JSON spec — prefer this over ckan__execute_sql whenever the question is countable / summable / averageable. Supports count(*), sum(), avg(), min(), max(), stddev().

Run ckan__get_schema first to confirm field names.

Examples:
- Count 311 requests by neighborhood:
  { "resource_id": "8048697b-ad64-4bfc-b090-ee00169f2323", "group_by": ["neighborhood"], "metrics": { "count": "count(*)" }, "order_by": "count DESC", "limit": 25 }
- Requests matching a specific case type grouped by year:
  { "resource_id": "...", "group_by": ["year"], "metrics": { "total": "count(*)" }, "filters": { "case_title": "Request for Pothole Repair" } }`,
      parameters: {
        type: 'object',
        properties: {
          resource_id: {
            type: 'string',
            description: 'CKAN resource UUID',
          },
          group_by: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fields to group by',
          },
          metrics: {
            type: 'object',
            description: 'Aggregation metrics as alias: expression pairs (e.g., { "count": "count(*)", "avg_val": "avg(amount)" })',
          },
          filters: {
            type: 'object',
            description: 'Optional exact-match filters before aggregation',
          },
          having: {
            type: 'object',
            description: 'Optional post-aggregation filters',
          },
          order_by: {
            type: 'string',
            description: 'Optional ORDER BY clause (e.g., "count DESC")',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of groups to return (default: 100)',
          },
        },
        required: ['resource_id', 'metrics'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ckan__execute_sql',
      description: `Execute a raw PostgreSQL SELECT against a Boston CKAN resource. For complex queries only — prefer ckan__query_data or ckan__aggregate_data first.

CRITICAL:
- Only SELECT is allowed. INSERT / UPDATE / DELETE / DDL are rejected server-side.
- Resource UUIDs MUST be double-quoted in the FROM clause: FROM "8048697b-ad64-4bfc-b090-ee00169f2323"

Supports CTEs (WITH ...), window functions (RANK() OVER (...)), percentile aggregates (PERCENTILE_CONT), and JOINs across resources.

Example:
- { "sql": "SELECT neighborhood, count(*) AS requests FROM \\"8048697b-ad64-4bfc-b090-ee00169f2323\\" WHERE open_dt >= '2024-01-01' GROUP BY neighborhood ORDER BY requests DESC LIMIT 10" }`,
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'PostgreSQL SELECT statement. Resource UUIDs must be double-quoted in FROM.',
          },
        },
        required: ['sql'],
      },
    },
  },
];

/** Unified tool schema sent to whichever chat-completions endpoint this instance is configured to call (see src/lib/model-client.ts). The client in ./client.ts routes each call to the correct MCP server by tool name. */
export const mcpTools: ChatCompletionTool[] = [
  ...socrataMcpTools,
  ...dataCommonsMcpTools,
  ...bostonOpencontextMcpTools,
];

// Model definitions moved to src/lib/model-catalog.ts (civic-ai-tools-website#30
// P2). `ModelDefinition`, the offered list, its pricing and its display names
// were four tables in three files describing the same ids; they are now one
// catalog with one resolver (src/lib/model-resolver.ts). Nothing about MCP
// tooling lived in them, which is why they left this file rather than staying.
