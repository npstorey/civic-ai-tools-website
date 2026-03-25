// Types for streaming events
export type StreamEventType = 'progress' | 'token' | 'complete' | 'error';
export type PanelType = 'withMcp' | 'withoutMcp';

export interface StreamEvent {
  type: StreamEventType;
  panel: PanelType;
  data?: unknown;
}

export type ProgressPhase = 'analyze' | 'tool_start' | 'tool_complete' | 'tool_result' | 'thinking' | 'synthesize';

export interface ProgressEvent extends StreamEvent {
  type: 'progress';
  message: string;
  duration_ms?: number;
  phase?: ProgressPhase;
  iteration?: number;
  args?: Record<string, unknown>;
}

export interface TokenEvent extends StreamEvent {
  type: 'token';
  content: string;
}

export interface CompleteEvent extends StreamEvent {
  type: 'complete';
  data: {
    content: string;
    duration_ms: number;
    tokens_used: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    token_limit_exceeded?: boolean;
    tools_called?: { name: string; args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; duration_ms?: number; operationType?: string; reason?: string }[];
  };
}

export interface ErrorEvent extends StreamEvent {
  type: 'error';
  message: string;
}

// Format tool call arguments into human-readable progress messages
export function formatToolProgress(
  name: string,
  args: Record<string, unknown>,
  previousCalls?: { args: Record<string, unknown> }[],
): string {
  const type = args.type as string;
  const portal = args.portal as string;
  const datasetId = args.dataset_id as string;
  const query = args.query as string;

  // Get city name from portal
  const cityName = getPortalCity(portal);
  const datasetName = getDatasetName(datasetId);

  switch (type) {
    case 'catalog':
      return `Searching ${cityName} data catalog${query ? `: "${query}"` : ''}`;
    case 'metadata':
      return `Getting metadata for ${query || datasetName}`;
    case 'query': {
      const intent = generateQueryIntentLabel(args, previousCalls);
      return intent.label;
    }
    case 'metrics':
      return `Fetching metrics for ${datasetName}`;
    default:
      return `Calling ${name}...`;
  }
}

// Build structured SoQL clauses from tool args
export function buildSoqlClauses(args: Record<string, unknown>): { keyword: string; value: string }[] {
  const clauses: { keyword: string; value: string }[] = [];

  const select = args.select as string | undefined;
  const where = args.where as string | undefined;
  const group = args.group as string | undefined;
  const order = args.order as string | undefined;
  const limit = args.limit as number | undefined;

  if (select) clauses.push({ keyword: 'SELECT', value: select });
  if (where) clauses.push({ keyword: 'WHERE', value: where });
  if (group) clauses.push({ keyword: 'GROUP BY', value: group });
  if (order) clauses.push({ keyword: 'ORDER BY', value: order });
  if (limit) clauses.push({ keyword: 'LIMIT', value: String(limit) });

  return clauses;
}

export function getPortalCity(portal: string | undefined): string {
  if (!portal) return 'data';

  const portalCities: Record<string, string> = {
    'data.cityofnewyork.us': 'NYC',
    'data.cityofchicago.org': 'Chicago',
    'data.sfgov.org': 'San Francisco',
    'data.lacity.org': 'Los Angeles',
    'data.seattle.gov': 'Seattle',
  };

  return portalCities[portal] || 'open data';
}

export function getDatasetName(datasetId: string | undefined): string {
  if (!datasetId) return 'dataset';

  // Known dataset IDs from CLAUDE.md
  const datasetNames: Record<string, string> = {
    'erm2-nwe9': '311 Service Requests',
    '43nn-pn8j': 'Restaurant Inspections',
    'wvxf-dwi5': 'Housing Violations',
    'v6vf-nfxy': '311 Service Requests',
    'vw6y-z8j6': '311 Cases',
  };

  return datasetNames[datasetId] || `dataset ${datasetId}`;
}

// --- Query intent label system ---

const KNOWN_COLUMNS: Record<string, string> = {
  boro: 'borough',
  borough: 'borough',
  critical_flag: 'violation severity',
  violation_code: 'violation type',
  violation_description: 'violation type',
  inspection_date: 'inspection date',
  complaint_type: 'complaint type',
  created_date: 'report date',
  sr_type: 'service request type',
  service_name: 'service type',
  opened: 'open date',
  neighborhood: 'neighborhood',
  grade: 'grade',
  grade_date: 'grade date',
  cuisine_description: 'cuisine type',
  score: 'inspection score',
  zipcode: 'ZIP code',
  dba: 'restaurant name',
  currentstatus: 'status',
  violationid: 'violation ID',
};

function humanizeColumn(col: string): string {
  // Strip aggregate/function wrappers: count(*), date_trunc_ym(field), etc.
  const stripped = col.replace(/\w+\(([^)]*)\)/g, '$1').replace(/\*/g, '').trim();
  // Handle aliases: "count(*) as total" → use the base column
  const base = stripped.split(/\s+as\s+/i)[0].trim();
  return KNOWN_COLUMNS[base.toLowerCase()] || base || col;
}

export function humanizeColumns(columnStr: string): string {
  const cols = columnStr.split(',').map(c => humanizeColumn(c.trim())).filter(Boolean);
  if (cols.length === 0) return columnStr;
  if (cols.length === 1) return cols[0];
  if (cols.length === 2) return `${cols[0]} and ${cols[1]}`;
  return `${cols.slice(0, -1).join(', ')}, and ${cols[cols.length - 1]}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

function shortVerb(aggregation: string): string {
  switch (aggregation) {
    case 'Counting': return 'Count';
    case 'Summing': return 'Sum';
    case 'Averaging': return 'Average';
    default: return aggregation;
  }
}

function pastTense(aggregation: string): string {
  switch (aggregation) {
    case 'Counting': return 'counted';
    case 'Summing': return 'summed';
    case 'Averaging': return 'averaged';
    default: return aggregation.toLowerCase();
  }
}

function detectAggregationType(select: string): string | null {
  if (/\bcount\s*\(/i.test(select)) return 'Counting';
  if (/\bsum\s*\(/i.test(select)) return 'Summing';
  if (/\bavg\s*\(/i.test(select)) return 'Averaging';
  return null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function extractDateDescription(where: string): string | null {
  // Single-day: column = 'YYYY-MM-DD'
  const singleDayMatch = where.match(/\w+\s*=\s*'(\d{4})-(\d{2})-(\d{2})'/);
  if (singleDayMatch) {
    const [, y, m, d] = singleDayMatch;
    return `on ${MONTH_NAMES[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
  }

  // Range: >= 'YYYY-MM-DD' AND column < 'YYYY-MM-DD'
  const rangeMatch = where.match(
    />=?\s*'(\d{4})-(\d{2})-(\d{2})'\s+AND\s+\w+\s*<\s*'(\d{4})-(\d{2})-(\d{2})'/i,
  );
  if (rangeMatch) {
    const [, sy, sm, sd, ey, em, ed] = rangeMatch;
    const startDay = parseInt(sd, 10);
    const endDay = parseInt(ed, 10);
    const startMonth = parseInt(sm, 10);
    const endMonth = parseInt(em, 10);
    const startYear = parseInt(sy, 10);
    const endYear = parseInt(ey, 10);

    // Exact calendar month: 1st of month to 1st of next month
    const isOneMonth =
      startDay === 1 &&
      endDay === 1 &&
      (endYear - startYear) * 12 + (endMonth - startMonth) === 1;
    if (isOneMonth) {
      return `for ${MONTH_NAMES[startMonth - 1]} ${sy}`;
    }

    // Sub-month or arbitrary range — show end as exclusive (day before)
    const endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay));
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const adjEndMonth = endDate.getUTCMonth(); // 0-indexed
    const adjEndDay = endDate.getUTCDate();
    const adjEndYear = endDate.getUTCFullYear();

    if (startYear === adjEndYear) {
      if (startMonth - 1 === adjEndMonth) {
        // Same month: "from Mar 1–7, 2026"
        return `from ${SHORT_MONTHS[startMonth - 1]} ${startDay}–${adjEndDay}, ${sy}`;
      }
      // Different months, same year: "from Feb 15 – Mar 7, 2026"
      return `from ${SHORT_MONTHS[startMonth - 1]} ${startDay} – ${SHORT_MONTHS[adjEndMonth]} ${adjEndDay}, ${sy}`;
    }
    // Different years: "from Dec 15, 2025 – Jan 7, 2026"
    return `from ${SHORT_MONTHS[startMonth - 1]} ${startDay}, ${sy} – ${SHORT_MONTHS[adjEndMonth]} ${adjEndDay}, ${adjEndYear}`;
  }

  // Open-ended start: >= 'YYYY-MM-DD' with no upper bound
  const openStartMatch = where.match(/>=?\s*'(\d{4})-(\d{2})-(\d{2})'/);
  if (openStartMatch) {
    const [, y, m, d] = openStartMatch;
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    if (day === 1) {
      return `since ${MONTH_NAMES[month - 1]} ${y}`;
    }
    return `since ${SHORT_MONTHS[month - 1]} ${day}, ${y}`;
  }

  // Bare year fallback: extract_y(...) = 2026 or just a year in quotes
  const yearMatch = where.match(/(?:'|)(20\d{2})(?:'|)/);
  if (yearMatch) return `for ${yearMatch[1]}`;

  return null;
}

function extractFilterDescription(where: string): string | null {
  const parts: string[] = [];

  const datePart = extractDateDescription(where);
  if (datePart) parts.push(datePart);

  const boroMatch = where.match(/(?:borough|boro|neighborhood)\s*(?:=|ILIKE)\s*'([^']+)'/i);
  if (boroMatch) parts.push(`in ${boroMatch[1].replace(/%/g, '')}`);

  const criticalMatch = where.match(/critical_flag\s*(?:=|ILIKE)\s*'([^']+)'/i);
  if (criticalMatch) {
    const val = criticalMatch[1].toLowerCase();
    parts.push(val === 'critical' ? 'critical only' : 'non-critical');
  }

  const gradeMatch = where.match(/grade\s*=\s*'([^']+)'/i);
  if (gradeMatch) parts.push(`grade ${gradeMatch[1]}`);

  if (!boroMatch && !criticalMatch) {
    const ilikeMatch = where.match(/ILIKE\s+'%([^%]+)%'/i);
    if (ilikeMatch) parts.push(`matching "${ilikeMatch[1]}"`);
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

function extractNewFilter(currentWhere: string, previousWhere: string | undefined): string | null {
  if (!previousWhere) return extractFilterDescription(currentWhere);

  // If current WHERE contains previous WHERE, extract the added part
  if (currentWhere.includes(previousWhere)) {
    const newPart = currentWhere.replace(previousWhere, '')
      .replace(/^\s*AND\s*/i, '').replace(/\s*AND\s*$/i, '').trim();
    if (newPart) {
      return extractFilterDescription(newPart) || newPart;
    }
  }

  return extractFilterDescription(currentWhere);
}

export interface QueryIntent {
  label: string;
  refinedFromIndex?: number;
}

export function generateQueryIntentLabel(
  args: Record<string, unknown>,
  previousCalls?: { args: Record<string, unknown> }[],
): QueryIntent {
  const datasetId = args.dataset_id as string | undefined;
  const datasetName = getDatasetName(datasetId);
  const select = args.select as string | undefined;
  const where = args.where as string | undefined;
  const group = args.group as string | undefined;
  const order = args.order as string | undefined;
  const limit = args.limit as number | undefined;

  // Pattern: SELECT * LIMIT small → previewing data
  if ((!select || select === '*') && limit && limit <= 10 && !where && !group) {
    return { label: `Previewing ${datasetName} data` };
  }

  const aggregation = select ? detectAggregationType(select) : null;

  // Check for refinement vs previous queries on same dataset
  let refinedFromIndex: number | undefined;
  if (previousCalls) {
    for (let i = previousCalls.length - 1; i >= 0; i--) {
      const prev = previousCalls[i].args;
      if (prev.type !== 'query' || prev.dataset_id !== datasetId) continue;

      const prevGroup = prev.group as string | undefined;
      const prevWhere = prev.where as string | undefined;

      // Same grouping + added/changed filter → refinement
      if (group && group === prevGroup && where && where !== prevWhere) {
        const newFilter = extractNewFilter(where, prevWhere);
        if (newFilter) {
          return { label: `Refining: adding ${newFilter}`, refinedFromIndex: i };
        }
      }

      // Same filter, different grouping → different breakdown
      if (where === prevWhere && group && prevGroup && group !== prevGroup) {
        refinedFromIndex = i;
      }

      break;
    }
  }

  // Check for "top N" pattern: ORDER BY ... DESC + LIMIT + GROUP BY
  const hasTopPattern = order && /DESC$/i.test(order) && limit && group;

  let label: string;

  if (hasTopPattern) {
    const groupCols = humanizeColumns(group);
    const plural = groupCols.endsWith('s') ? groupCols : groupCols + 's';
    label = `Top ${plural}`;
  } else if (group) {
    const groupCols = humanizeColumns(group);
    label = aggregation ? `${aggregation} by ${groupCols}` : `Counting by ${groupCols}`;
  } else if (aggregation) {
    label = `${aggregation} ${datasetName} records`;
  } else if (select && select !== '*') {
    const cols = select.split(',').map(c => c.trim());
    if (cols.length <= 3) {
      label = `Getting ${humanizeColumns(select)}`;
    } else {
      label = `Querying ${datasetName} details`;
    }
  } else {
    label = `Querying ${datasetName}`;
  }

  // Append filter context
  if (where) {
    const filterDesc = extractFilterDescription(where);
    if (filterDesc) label += ` ${filterDesc}`;
  }

  return { label, refinedFromIndex };
}

// Format a human-readable message describing tool results
export function formatToolResult(
  args: Record<string, unknown>,
  resultSummary?: { rows: number; columns: number }
): string | null {
  const type = args.type as string;
  const datasetId = args.dataset_id as string | undefined;
  const datasetName = getDatasetName(datasetId);

  switch (type) {
    case 'catalog':
      return resultSummary
        ? `Found ${resultSummary.rows} dataset${resultSummary.rows !== 1 ? 's' : ''} matching the search`
        : 'Catalog search complete';
    case 'query':
      return resultSummary
        ? `Retrieved ${resultSummary.rows} record${resultSummary.rows !== 1 ? 's' : ''} from ${datasetName}`
        : `Query to ${datasetName} complete`;
    case 'metadata':
      return `Loaded metadata for ${datasetName}`;
    case 'metrics':
      return `Loaded metrics for ${datasetName}`;
    default:
      return null;
  }
}

// Generate a brief "why" reason from tool args for display in progress log and tool cards
export function generateToolReason(args: Record<string, unknown>): string {
  const type = args.type as string;
  const datasetId = args.dataset_id as string | undefined;
  const query = args.query as string | undefined;
  const datasetName = getDatasetName(datasetId);
  const group = args.group as string | undefined;
  const where = args.where as string | undefined;
  const select = args.select as string | undefined;

  switch (type) {
    case 'catalog':
      return query ? `to find datasets about "${query}"` : 'to search for relevant datasets';
    case 'metadata':
      return `to understand ${datasetName} structure`;
    case 'query':
      if (group) return `to aggregate ${datasetName} by ${group}`;
      if (where) return `to filter ${datasetName} records`;
      if (select) return `to retrieve specific fields from ${datasetName}`;
      return `to query ${datasetName}`;
    case 'metrics':
      return `to check ${datasetName} statistics`;
    default:
      return 'to gather data';
  }
}

// Generate a plain-English translation of a SoQL query from structured args
export function generatePlainEnglishQuery(args: Record<string, unknown>): string | null {
  const type = args.type as string;
  if (type !== 'query') return null;

  const datasetId = args.dataset_id as string | undefined;
  const datasetName = getDatasetName(datasetId);
  const select = args.select as string | undefined;
  const where = args.where as string | undefined;
  const group = args.group as string | undefined;
  const order = args.order as string | undefined;
  const limit = args.limit as number | undefined;

  const parts: string[] = [];
  parts.push(`In the ${datasetName} dataset`);

  if (select && select !== '*') {
    const fields = select.split(',').map(s => s.trim());
    const hasAgg = fields.some(f => /count|sum|avg|min|max/i.test(f));
    if (hasAgg) {
      parts.push('count or aggregate records');
    } else {
      parts.push(`look at ${fields.join(', ')}`);
    }
  }

  if (where) {
    parts.push(humanizeWhereClause(where));
  }

  if (group) {
    parts.push(`grouped by ${group}`);
  }

  if (order) {
    const descMatch = order.match(/^(.+?)\s+DESC$/i);
    if (descMatch) {
      parts.push(`sorted from most to fewest by ${descMatch[1]}`);
    } else {
      parts.push(`sorted by ${order}`);
    }
  }

  if (limit) {
    parts.push(`showing the top ${limit}`);
  }

  return `This asks: "${parts.join(', ')}."`;
}

function humanizeWhereClause(where: string): string {
  let result = where;

  // Replace operators with words
  result = result.replace(/\s*>=\s*/g, ' on or after ');
  result = result.replace(/\s*<=\s*/g, ' on or before ');
  result = result.replace(/\s*>\s*/g, ' greater than ');
  result = result.replace(/\s*<\s*/g, ' less than ');
  result = result.replace(/\s*=\s*/g, ' equal to ');

  // Handle LIKE / ILIKE patterns
  result = result.replace(/\s+ILIKE\s+'%([^%]+)%'/gi, (_, term) => ` containing "${term}"`);
  result = result.replace(/\s+LIKE\s+'%([^%]+)%'/gi, (_, term) => ` containing "${term}"`);
  result = result.replace(/\s+ILIKE\s+'([^']+)%'/gi, (_, term) => ` starting with "${term}"`);

  // Handle AND/OR
  result = result.replace(/\s+AND\s+/gi, ', and ');
  result = result.replace(/\s+OR\s+/gi, ', or ');

  return `where ${result}`;
}

// Get educational annotation text for a given phase and operation type
export function getEducationalAnnotation(phase: string, operationType?: string, queryStepIndex?: number): string | null {
  if (phase === 'analyze') {
    return 'The AI is reading the question and planning which data to look for.';
  }
  if (phase === 'synthesize') {
    return 'The AI has collected its data and is now writing a summary of what it found.';
  }
  if (phase === 'tool_start' && operationType) {
    switch (operationType) {
      case 'catalog':
        return 'The AI is searching an open data portal — a public catalog where governments publish datasets for anyone to use.';
      case 'metadata':
        return 'Reading the data dictionary — the list of columns and what each one contains.';
      case 'query': {
        if (queryStepIndex === undefined || queryStepIndex === 0) {
          return 'Running a structured query against the dataset — filtering and aggregating records to answer the question.';
        }
        if (queryStepIndex === 1) {
          return 'Each query builds on the last — the AI is narrowing its focus based on what it found.';
        }
        return null;
      }
      case 'metrics':
        return 'Checking dataset statistics — how many records exist and how often the data is updated.';
      default:
        return null;
    }
  }
  return null;
}

// Build a short chip/breadcrumb label for a single tool call (~30 chars, action-verb led)
export function buildBreadcrumbLabel(
  tool: { name: string; args: Record<string, unknown>; operationType?: string },
  allTools?: { name: string; args: Record<string, unknown>; operationType?: string }[],
  index?: number,
): string {
  const opType = tool.operationType || (tool.args.type as string) || 'call';
  const query = tool.args.query as string | undefined;

  switch (opType) {
    case 'catalog':
      return query ? `Search "${truncate(query, 15)}"` : 'Search catalog';
    case 'metadata':
      return 'Check schema';
    case 'query': {
      const select = tool.args.select as string | undefined;
      const where = tool.args.where as string | undefined;
      const group = tool.args.group as string | undefined;
      const order = tool.args.order as string | undefined;
      const limit = tool.args.limit as number | undefined;

      // Preview pattern
      if ((!select || select === '*') && limit && limit <= 10 && !where && !group) {
        return 'Preview data';
      }

      // Refinement
      const previousCalls = allTools && index !== undefined ? allTools.slice(0, index) : undefined;
      if (previousCalls) {
        const intent = generateQueryIntentLabel(tool.args, previousCalls);
        if (intent.refinedFromIndex !== undefined) {
          const prevWhere = allTools![intent.refinedFromIndex].args.where as string | undefined;
          const newFilter = where ? extractNewFilter(where, prevWhere) : null;
          return newFilter ? `Refine: ${truncate(newFilter, 18)}` : 'Refine query';
        }
      }

      const aggregation = select ? detectAggregationType(select) : null;
      const hasTopPattern = order && /DESC$/i.test(order) && limit && group;

      if (hasTopPattern) {
        return `Top ${truncate(humanizeColumns(group!), 22)}`;
      }
      if (group) {
        const verb = aggregation ? shortVerb(aggregation) : 'Count';
        return `${verb} by ${truncate(humanizeColumns(group), 18)}`;
      }
      if (aggregation) {
        return `${shortVerb(aggregation)} records`;
      }

      const filterDesc = where ? extractFilterDescription(where) : null;
      return filterDesc ? `Query ${truncate(filterDesc, 20)}` : 'Query data';
    }
    case 'metrics':
      return 'Get stats';
    default:
      return tool.name;
  }
}

// Describe a tool call in past-tense narrative form
function describeToolNarrative(
  tool: { name: string; args: Record<string, unknown>; operationType?: string },
  index: number,
  allTools: { name: string; args: Record<string, unknown>; operationType?: string }[],
): string {
  const opType = tool.operationType || (tool.args.type as string) || 'call';
  const query = tool.args.query as string | undefined;

  switch (opType) {
    case 'catalog':
      return query ? `searched for datasets about "${query}"` : 'searched the data catalog';
    case 'metadata':
      return 'examined the dataset structure';
    case 'query': {
      const select = tool.args.select as string | undefined;
      const where = tool.args.where as string | undefined;
      const group = tool.args.group as string | undefined;
      const order = tool.args.order as string | undefined;
      const limit = tool.args.limit as number | undefined;

      // Preview pattern
      if ((!select || select === '*') && limit && limit <= 10 && !where && !group) {
        return 'sampled the data';
      }

      // Check refinement
      const previousCalls = allTools.slice(0, index);
      const intent = generateQueryIntentLabel(tool.args, previousCalls);
      if (intent.refinedFromIndex !== undefined) {
        const prevWhere = allTools[intent.refinedFromIndex]?.args?.where as string | undefined;
        const newFilter = where ? extractNewFilter(where, prevWhere) : null;
        return newFilter ? `refined the query (${newFilter})` : 'refined the previous query';
      }

      const aggregation = select ? detectAggregationType(select) : null;
      const hasTopPattern = order && /DESC$/i.test(order) && limit && group;

      if (hasTopPattern) {
        const groupCols = humanizeColumns(group!);
        const filterDesc = where ? extractFilterDescription(where) : null;
        return filterDesc ? `found top ${groupCols} ${filterDesc}` : `found top ${groupCols}`;
      }
      if (group) {
        const groupCols = humanizeColumns(group);
        const filterDesc = where ? extractFilterDescription(where) : null;
        const verb = aggregation ? pastTense(aggregation) : 'compared counts';
        return filterDesc ? `${verb} by ${groupCols} ${filterDesc}` : `${verb} by ${groupCols}`;
      }

      if (aggregation) {
        const filterDesc = where ? extractFilterDescription(where) : null;
        return filterDesc ? `${pastTense(aggregation)} records ${filterDesc}` : `${pastTense(aggregation)} records`;
      }

      const filterDesc = where ? extractFilterDescription(where) : null;
      return filterDesc ? `queried records ${filterDesc}` : 'queried the data';
    }
    case 'metrics':
      return 'checked dataset statistics';
    default:
      return `called ${tool.name}`;
  }
}

// Build a narrative summary telling the analytical story of what the AI did
export function buildNarrativeSummary(
  toolsCalled: { name: string; args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; duration_ms?: number; operationType?: string }[],
): string {
  if (toolsCalled.length === 0) return '';

  // Collect unique portals
  const portalSet = new Set<string>();
  for (const tool of toolsCalled) {
    const p = tool.args.portal as string | undefined;
    if (p) portalSet.add(p);
  }
  const portals = [...portalSet];
  const isMultiPortal = portals.length > 1;

  const datasets = new Map<string, { name: string; portal: string }>();
  for (const tool of toolsCalled) {
    const id = tool.args.dataset_id as string | undefined;
    const p = tool.args.portal as string | undefined;
    if (id && !datasets.has(id)) {
      datasets.set(id, { name: getDatasetName(id), portal: p || portals[0] || '' });
    }
  }

  // Build action phrases using intent-aware narrative descriptions
  const actions: string[] = [];
  for (let i = 0; i < toolsCalled.length; i++) {
    actions.push(describeToolNarrative(toolsCalled[i], i, toolsCalled));
  }

  // Deduplicate consecutive identical actions
  const deduped: { text: string; count: number }[] = [];
  for (const action of actions) {
    const last = deduped[deduped.length - 1];
    if (last && last.text === action) {
      last.count++;
    } else {
      deduped.push({ text: action, count: 1 });
    }
  }
  const parts = deduped.map(a => a.count > 1 ? `${a.text} (${a.count} times)` : a.text);

  // Build prefix with dataset context (includes markdown links when portal is known)
  let prefix = '';
  if (datasets.size === 1) {
    const [id, { name, portal }] = [...datasets.entries()][0];
    const cityName = getPortalCity(portal);
    const url = datasetUrl(portal, id);
    const datasetRef = url ? `[${name} (${id})](${url})` : `${name} (${id})`;
    prefix = `Using ${cityName}'s ${datasetRef}, the AI `;
  } else if (datasets.size > 1) {
    const entries = [...datasets.entries()];
    if (isMultiPortal) {
      const linkedNames = entries.map(([id, { name, portal }]) => {
        const cityName = getPortalCity(portal);
        const url = datasetUrl(portal, id);
        return url ? `${cityName}'s [${name} (${id})](${url})` : `${cityName}'s ${name} (${id})`;
      });
      prefix = `Using ${linkedNames.join(' and ')}, the AI `;
    } else {
      const cityName = getPortalCity(portals[0]);
      const linkedNames = entries.map(([id, { name, portal }]) => {
        const url = datasetUrl(portal, id);
        return url ? `[${name} (${id})](${url})` : `${name} (${id})`;
      });
      prefix = `Using ${linkedNames.length} ${cityName} datasets (${linkedNames.join(', ')}), the AI `;
    }
  } else {
    prefix = 'The AI ';
  }

  // Join into natural sentence
  if (parts.length === 1) {
    return `${prefix}${parts[0]}.`;
  }
  if (parts.length === 2) {
    return `${prefix}${parts[0]}, then ${parts[1]}.`;
  }
  const last = parts.pop()!;
  return `${prefix}${parts.join(', ')}, then ${last}.`;
}

// Build a stats summary line leading with data volume
export function buildStatsSummary(
  toolsCalled: { name: string; args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; duration_ms?: number; operationType?: string }[],
  totalDuration_ms?: number,
): string {
  const statParts: string[] = [];

  const totalRows = toolsCalled.reduce((sum, t) => sum + (t.resultSummary?.rows || 0), 0);
  if (totalRows > 0) {
    statParts.push(`${totalRows.toLocaleString()} records analyzed`);
  }

  const queryCount = toolsCalled.filter(t => (t.operationType || t.args.type) === 'query').length;
  if (queryCount > 0) {
    statParts.push(`${queryCount} ${queryCount === 1 ? 'query' : 'queries'}`);
  } else {
    statParts.push(`${toolsCalled.length} tool call${toolsCalled.length !== 1 ? 's' : ''}`);
  }

  if (totalDuration_ms) {
    statParts.push(`${(totalDuration_ms / 1000).toFixed(1)}s`);
  }

  return statParts.join(' \u00b7 ');
}

// Generate a Socrata dataset URL from portal and dataset ID
export function datasetUrl(portal: string | undefined, datasetId: string | undefined): string | null {
  if (!portal || !datasetId) return null;
  return `https://${portal}/d/${datasetId}`;
}

// Build source provenance line with markdown links for dataset references
export function buildProvenanceLine(
  tools: { args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; operationType?: string }[]
): string | null {
  const queryTools = tools.filter(t => t.operationType === 'query');
  if (queryTools.length === 0) return null;

  const parts: string[] = [];

  // Collect unique portals from all tool calls
  const portalSet = new Set<string>();
  for (const tool of tools) {
    const p = tool.args.portal as string | undefined;
    if (p) portalSet.add(p);
  }
  const portals = [...portalSet];

  if (portals.length === 1) {
    parts.push(`${getPortalCity(portals[0])} Open Data`);
  } else if (portals.length > 1) {
    const cities = portals.map(p => getPortalCity(p)).filter(c => c !== 'open data');
    if (cities.length > 0) {
      parts.push(`${cities.join(' + ')} Open Data`);
    }
  }

  const seen = new Set<string>();
  for (const tool of queryTools) {
    const did = tool.args.dataset_id as string | undefined;
    const portal = (tool.args.portal as string | undefined) || portals[0];
    if (did && !seen.has(did)) {
      seen.add(did);
      const name = getDatasetName(did);
      const url = datasetUrl(portal, did);
      if (url) {
        parts.push(`[${name} (${did})](${url})`);
      } else {
        parts.push(`${name} (${did})`);
      }
    }
  }

  const totalRows = queryTools.reduce((sum, t) => sum + (t.resultSummary?.rows || 0), 0);
  if (totalRows > 0) {
    parts.push(`${totalRows.toLocaleString()} rows returned`);
  }

  return parts.length > 0 ? `Source: ${parts.join(' \u00b7 ')}` : null;
}

// Encode a stream event as SSE format
export function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
