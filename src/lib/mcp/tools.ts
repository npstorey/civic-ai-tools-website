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
            // #340: this used to describe only the $q branch. The data-access
            // handler splits on whether the value starts with SELECT, and the
            // SoQL branch supersedes the individual clauses AND drops
            // limit/offset — so a model reading the old text could send both a
            // SELECT and a limit and be silently given neither bound it asked
            // for. Both branches are stated here because both are reachable.
            description: 'For type=catalog: search query. For type=metadata: the dataset ID. For type=query: either a full SoQL statement starting with SELECT, which is applied as the entire query and supersedes select/where/order/group (limit and offset are not applied either — bound the rows with the statement\'s own LIMIT), or a search phrase, applied as a full-text search within the data alongside the other clauses.',
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
  // #323: `search` and `fetch` are the Socrata MCP server's other two tools.
  // `registry.ts` has routed all three names since it was written
  // (`SOCRATA_TOOLS = ['get_data', 'search', 'fetch']`) and the skill text has
  // always described them — only the schemas were missing, so the model was
  // told about two capabilities it had no way to invoke. Measured in the
  // server's source and against the deployed endpoint: `tools/list` returns
  // exactly `get_data, search, fetch`.
  //
  // The two schemas below MIRROR the server's, which are deliberately narrow —
  // one required property each and `additionalProperties: false`. That is not
  // an omission to be helpfully filled in: neither tool accepts a portal or
  // domain, so anything else sent here is rejected upstream. The narrowness is
  // also why the loop core's portal injection stays scoped to `get_data`
  // (`run-tool-loop.ts`) — an injected portal would be stripped by the server
  // and would still corrupt the arguments recorded in the signed package.
  {
    type: 'function',
    function: {
      name: 'search',
      description: `Search the Socrata portal this instance's MCP server is configured for, returning matching datasets with identifiers that "fetch" accepts.

Returns, per hit: an "id" of the form dataset:<portal>:<dataset_id>, the title, the portal URL, a description snippet, and — where the dataset allows it — its column list and a few preview rows.

WHICH TOOL TO USE:
- This tool searches ONE portal: the one the server is configured with. It takes no portal argument.
- To search any OTHER portal, use get_data with { "type": "catalog", "portal": "...", "query": "..." }, which does take a portal.`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            description: 'Full-text search phrase, e.g. "311 noise complaints"',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch',
      description: `Retrieve a dataset's full metadata, or a single record, by the identifier "search" returned.

The identifier is normally taken verbatim from a search hit: dataset:<portal>:<dataset_id> for a dataset, record:<portal>:<dataset_id>:<row_id> for one row. A Socrata dataset URL is also accepted and names its own portal (the URL's hostname). A bare 4x4 dataset ID (or 4x4:<row_id> for one row) names no portal and resolves against the server's configured portal.

WHICH TOOL TO USE: this returns metadata and columns, not query results. To read or aggregate rows, use get_data with type=query.`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description: 'Identifier returned by the search tool, e.g. "dataset:data.cityofnewyork.us:erm2-nwe9"',
          },
        },
        required: ['id'],
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

// --- NYC Charter / Administrative Code / Rules (BetaNYC, warm sandbox) ---
// POC MCP-WARM-VM (spike, not chartered). Schemas transcribed from the live
// `tools/list` of `@betanyc/nyc-charter-laws-rules@0.2.0` driven over stdio,
// not from its README. The `nyc_charter__` prefix is applied by the bridge in
// scripts/poc-warm-vm/bridge.mjs, which strips it again before the call
// reaches the upstream server; it is load-bearing because the upstream
// `search` would otherwise displace Socrata's `search` in the registry's
// bare-name `toolIndex`.
const nycCharterMcpTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'nyc_charter__get_version',
      description: `Return the currency date for each document — how current the NYC Charter, Administrative Code, and Rules are. Each corpus updates on its own schedule. ALWAYS call this first when answering a question about NYC law, so the answer can state which version of the law it is grounded in. The text is bundled with the server, so this date — not today's date — is the freshness of every answer from this source. For informational purposes only. Not legal advice.`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_charter__search',
      description: `Search the NYC Charter, Administrative Code, and Rules of the City of New York by keyword or phrase. Relevance-ranked: heading matches rank above citation matches, which rank above body-text matches; whole-word matches rank above substring matches. Use this when you do not already know the citation; use nyc_charter__get_section when you do. For informational purposes only. Not legal advice. Verify against codelibrary.amlegal.com before relying on any result.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or phrase' },
          corpus: {
            type: 'string',
            enum: ['charter', 'admin_code', 'rules', 'all'],
            description: 'Which document to search (default: all)',
          },
          limit: { type: 'number', description: 'Max results to return (default 10, max 50)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_charter__get_section',
      description: `Retrieve one section in full by its citation (e.g. '§ 259', 'Section 259', '11-602.1', 'Chapter 11'). Input is normalized, with or without '§' and in any case. Pass 'corpus' to disambiguate when the same citation exists in more than one document; if several sections still match, a disambiguation list comes back instead of a section. For informational purposes only. Not legal advice. Verify against codelibrary.amlegal.com before relying on any result.`,
      parameters: {
        type: 'object',
        properties: {
          citation: { type: 'string', description: 'Section citation or heading' },
          corpus: {
            type: 'string',
            enum: ['charter', 'admin_code', 'rules'],
            description: 'Which document to look in (default: all three)',
          },
        },
        required: ['citation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_charter__list_titles',
      description: `List the top-level chapters or titles of one document. Use to orient before searching. For informational purposes only. Not legal advice.`,
      parameters: {
        type: 'object',
        properties: {
          corpus: {
            type: 'string',
            enum: ['charter', 'admin_code', 'rules'],
            description: 'Which document to list',
          },
        },
        required: ['corpus'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_charter__get_title',
      description: `Retrieve chapter/title records matching an identifier (whole-token match: 'Chapter 1' does not match 'Chapter 10'). NOTE: the upstream index is flat — sections are not nested within titles — so this returns matching chapter/title-level records, NOT the full contents of a title. To read a title's sections, search or fetch them by citation. For informational purposes only. Not legal advice.`,
      parameters: {
        type: 'object',
        properties: {
          corpus: {
            type: 'string',
            enum: ['charter', 'admin_code', 'rules'],
            description: 'Which document',
          },
          title: { type: 'string', description: "Chapter or title identifier (e.g. 'Chapter 11')" },
        },
        required: ['corpus', 'title'],
      },
    },
  },
];

// --- NYC City Record notices (BetaNYC, warm sandbox over a LIVE city service) ---
// POC MCP-LIVE-SOURCE (spike, not chartered). Schemas transcribed from the live
// `tools/list` of `@betanyc/nyc-record-mcp@1.1.0` driven through the bridge,
// not from its README; the run that produced this file's numbers re-reads that
// list and fails if it has drifted.
//
// The `nyc_record__` prefix is applied by scripts/poc-warm-vm/bridge.mjs, which
// strips it again upstream. Unlike Charter, this source answers from a live
// service — every tool below is one SODA query against dataset `dg92-zbpx` on
// data.cityofnewyork.us — so its freshness is the city's, not a package's, and
// a network block turns every one of these into a refusal rather than a
// slightly stale answer.
//
// Every upstream schema is zod `.strict()`: a parameter the tool does not
// declare is a loud failure, not a silently ignored filter. That matters for
// the overlap with Socrata, whose tools take `portal` and `dataset_id` —
// arguments that have no meaning here and cannot be quietly absorbed.
const nycRecordMcpTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'nyc_record__search_notices',
      description: `Full-text search across NYC City Record notices — the city's official daily journal of public hearings, procurement solicitations, contract awards and public comment periods. Answers from the live NYC Open Data service, so results are as current as the city's own publication. Use this when you do not know which agency or notice type you want. This source covers ONLY City Record notices; for any other New York City dataset use the Socrata tools instead.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
          limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_record__get_notices_by_agency',
      description: `Get City Record notices published by a specific city agency (partial name match, e.g. 'DCAS', 'Parks'). Live data from NYC Open Data.`,
      parameters: {
        type: 'object',
        properties: {
          agency_name: { type: 'string', description: "Agency name or partial name, e.g. 'DCAS', 'Parks'" },
          limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        },
        required: ['agency_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_record__get_notices_by_type',
      description: `Get City Record notices filtered by notice type. Live data from NYC Open Data.`,
      parameters: {
        type: 'object',
        properties: {
          notice_type: {
            type: 'string',
            enum: [
              'Solicitation',
              'Award',
              'Intent to Award',
              'Intent to Negotiate',
              'Public Hearings',
              'Public Comment',
              'Meeting',
              'Notice',
              'Vendor List',
              'Sale',
            ],
            description: 'Notice type',
          },
          limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        },
        required: ['notice_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_record__get_procurement_notices',
      description: `Get recent procurement-related City Record notices: solicitations, awards, intent to award, intent to negotiate and vendor lists. Useful for tracking open contracts and recent awards. Live data from NYC Open Data.`,
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max results (default 25, max 100)' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_record__get_public_hearings',
      description: `Get recent public hearings, public comment periods and agency meetings from the City Record. Live data from NYC Open Data.`,
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max results (default 25, max 100)' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_record__get_open_solicitations',
      description: `Get active solicitations (RFPs, RFQs, IFBs) whose due date has not yet passed, soonest deadline first. Live data from NYC Open Data — "open" is judged against today's New York date at call time.`,
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max results (default 25, max 100)' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nyc_record__get_notices_by_date_range',
      description: `Get all City Record notices published within a date range. Live data from NYC Open Data.`,
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Start date, YYYY-MM-DD' },
          end_date: { type: 'string', description: 'End date, YYYY-MM-DD' },
          limit: { type: 'number', description: 'Max results (default 50, max 200)' },
        },
        required: ['start_date', 'end_date'],
      },
    },
  },
];

/** Unified tool schema sent to whichever chat-completions endpoint this instance is configured to call (see src/lib/model-client.ts). The client in ./client.ts routes each call to the correct MCP server by tool name. */
export const mcpTools: ChatCompletionTool[] = [
  ...socrataMcpTools,
  ...dataCommonsMcpTools,
  ...bostonOpencontextMcpTools,
  // POC MCP-WARM-VM (spike): advertised unconditionally, exactly as Socrata's
  // three are while unconfigured. With NYC_CHARTER_MCP_URL unset the registry
  // routes these five to `unconfiguredTools`, so a call refuses by naming the
  // variable instead of dying as an unknown tool.
  ...nycCharterMcpTools,
  // POC MCP-LIVE-SOURCE (spike): advertised unconditionally, same as the rest.
  // With NYC_RECORD_MCP_URL unset the registry routes these seven to
  // `unconfiguredTools`, so a call refuses by naming the variable.
  ...nycRecordMcpTools,
];

// Model definitions moved to src/lib/model-catalog.ts (civic-ai-tools-website#30
// P2). `ModelDefinition`, the offered list, its pricing and its display names
// were four tables in three files describing the same ids; they are now one
// catalog with one resolver (src/lib/model-resolver.ts). Nothing about MCP
// tooling lived in them, which is why they left this file rather than staying.
