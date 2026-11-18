/**
 * A pack's fixed values, and the refusal of a call outside them (S2-B W3,
 * npstorey/civic-ai-tools#309).
 *
 * Since router 0.8.0 NYC City Record is a pack: a source with no server of its
 * own whose tools are its base's (the Socrata server's `get_data` and `fetch`)
 * with the portal and the dataset fixed. The router states the fixed values in
 * the pack's own tool schemas, not as a field of the manifest entry: the
 * `portal` and `dataset_id` enums of its `get_data`, and the `pattern` of its
 * `fetch` identifier. This module reads them there, so the website holds no
 * copy of them, and the loop core (`run-tool-loop.ts`) uses them beside the
 * portal lock:
 *
 *   - INJECTION. A pack `get_data` call that omits `portal` or `dataset_id` is
 *     given the pack's value before anything reads or records the arguments,
 *     as the lock's run portal is injected (`run-tool-loop.ts`, #359): the
 *     check below reads the arguments as they will be recorded and sent.
 *   - REFUSAL. A call naming another portal or dataset, or a `fetch` of an
 *     identifier outside the pattern, is refused before anything is sent and
 *     recorded as a rejected call; the model is told why through
 *     `describeToolFailureForLlm` (`packFilterRefusalForLlm`), which knows this
 *     error by its type.
 */
import { CIVIC_MANIFEST, civicRouter } from '@typedstandards/civic-typed-router';
import { readerSourceName } from '../sources/source-name.ts';

/** A pack's fixed values, as its tool schemas state them. */
export interface PackFilter {
  /** The pack's inventory id (`mcp.pack_id`). */
  packId: string;
  /** The pack's name as a reader reads it ("NYC City Record"). */
  source: string;
  /** The one portal the pack reads. */
  portal: string;
  /** The one dataset the pack reads, when it fixes one. */
  datasetId?: string;
  /** The pattern a `fetch` identifier must match, when the pack's `fetch` states one. */
  idPattern?: string;
}

type Properties = Record<string, { enum?: unknown[]; pattern?: unknown }>;

function propertiesOf(entry: (typeof CIVIC_MANIFEST)[number], upstream: string): Properties {
  const tool = entry.tools.find((candidate) => candidate.type === 'function' && candidate.function.name === upstream);
  const parameters = tool?.type === 'function' ? (tool.function.parameters as { properties?: Properties } | undefined) : undefined;
  return parameters?.properties ?? {};
}

function onlyValue(property: { enum?: unknown[] } | undefined): string | undefined {
  return property?.enum?.length === 1 && typeof property.enum[0] === 'string' ? property.enum[0] : undefined;
}

/** The base whose packs this module reads, by `sourceId`. A pack over any other base stops the module at load. Router
 *  0.11.0's CKAN pack, Analyze Boston, was retired by router 0.12.0 (CKAN-2-WEB P1), and its filter with it. */
const SOCRATA_BASE = 'socrata';

/** Each pack's filter, by its `sourceId`, read once from the manifest. */
const FILTERS: ReadonlyMap<string, PackFilter> = new Map(
  CIVIC_MANIFEST.filter((entry) => entry.base !== undefined).map((entry) => {
    if (entry.base !== SOCRATA_BASE) throw new Error(`pack ${entry.sourceId}: no filter is read for a pack over ${entry.base}`);
    const getData = propertiesOf(entry, 'get_data');
    const fetchId = propertiesOf(entry, 'fetch').id?.pattern;
    const portal = onlyValue(getData.portal);
    if (portal === undefined) throw new Error(`pack ${entry.sourceId}: its get_data schema fixes no portal`);
    const datasetId = onlyValue(getData.dataset_id);
    const filter: PackFilter = {
      packId: entry.id,
      source: readerSourceName({ sourceId: entry.sourceId, displayName: entry.displayName }),
      portal,
      ...(datasetId !== undefined ? { datasetId } : {}),
      ...(typeof fetchId === 'string' ? { idPattern: fetchId } : {}),
    };
    return [entry.sourceId, filter] as const;
  }),
);

/**
 * The filter of the pack whose exposed tool `toolName` is, or `undefined` for
 * any other name. A bare name is not one, so the loop core asks this of the
 * target the dispatch sends the call to (`dispatchTargetOf`, `./registry.ts`;
 * S2-B F1), not of the called name: a bare `get_data` the run's selection
 * resolves to a pack is that pack's call.
 */
export function packFilterOf(toolName: string): PackFilter | undefined {
  const target = civicRouter.dispatchMap.get(toolName);
  return target?.base !== undefined ? FILTERS.get(target.sourceId) : undefined;
}

/** The pack filters, by the pack's `sourceId`. */
export function packFilters(): ReadonlyMap<string, PackFilter> {
  return FILTERS;
}

/** Give a pack call the pack's fixed values where it omits them: a Socrata pack's `get_data` its portal and dataset.
 *  Mutates `args`. */
export function injectPackFilter(upstream: string, args: Record<string, unknown>, filter: PackFilter): void {
  if (upstream !== 'get_data') return;
  if (args.portal === undefined || args.portal === null || args.portal === '') args.portal = filter.portal;
  if (filter.datasetId !== undefined && (args.dataset_id === undefined || args.dataset_id === null || args.dataset_id === '')) {
    args.dataset_id = filter.datasetId;
  }
}

const same = (value: unknown, fixed: string) => String(value).trim().toLowerCase() === fixed.toLowerCase();

/** Whether a pack call names a portal, dataset or identifier outside its pack's fixed values. */
export function packCallOutsideFilter(upstream: string, args: Record<string, unknown>, filter: PackFilter): boolean {
  if (upstream === 'get_data') {
    for (const key of ['portal', 'domain'] as const) {
      if (args[key] !== undefined && args[key] !== null && !same(args[key], filter.portal)) return true;
    }
    return filter.datasetId !== undefined && args.dataset_id !== undefined && args.dataset_id !== null && String(args.dataset_id).trim() !== filter.datasetId;
  }
  if (upstream === 'fetch' && filter.idPattern !== undefined) {
    return !new RegExp(filter.idPattern).test(String(args.id ?? ''));
  }
  return false;
}

/**
 * The failure the loop core throws for a pack call outside its pack's fixed
 * values, before anything is sent. Like `PortalLockedCallError`
 * (`../portal-lock.ts`), its message is this app's own and matches none of
 * `classifyStreamError`'s message shapes, so the call is recorded with the
 * failure kind `unknown`, and the reader reads the generic failed-request
 * words (R9b).
 */
export class PackFilterRefusedError extends Error {
  readonly filter: PackFilter;
  constructor(filter: PackFilter) {
    super('This call names a portal, dataset or identifier outside what its source reads, so it was not sent.');
    this.name = 'PackFilterRefusedError';
    this.filter = filter;
  }
}

/**
 * Whether `sql` is the one statement the CKAN server's `ckan_datastore_search_sql` sends (ruling D3 = A), as the tool's
 * own `sql` description states the rule: "it begins, after any whitespace and SQL comments, with SELECT or WITH, and
 * no second statement follows a semicolon outside a quoted literal". The check establishes that and nothing more: it
 * does not establish that the statement only reads (a data-modifying `WITH` and `SELECT … INTO` both pass it).
 *
 * The datastore is PostgreSQL, so the statement is read by PostgreSQL's lexical forms (fix round 1, F1): `--` line
 * comments; block comments, which nest; `"…"` identifiers with `""` inside; escape strings `E'…'`, in which a
 * backslash escapes the next character; dollar quotes `$$…$$` and `$tag$…$tag$`; and plain `'…'` literals with `''`
 * inside, read BOTH ways a server may read a backslash in them (as a plain character, and as an escape, the
 * `standard_conforming_strings = off` reading). It is one statement only when it is one under both readings. A
 * literal, identifier, dollar quote or comment that does not end, under either reading, is a statement the check
 * cannot be sure of, and it is refused.
 */
export function isOneSelectOrWithStatement(sql: unknown): boolean {
  if (typeof sql !== 'string') return false;
  return statementsIn(sql, false) === 'one' && statementsIn(sql, true) === 'one';
}

/** Whether `c` can continue an identifier, so a quote or a `$` after it is not the start of a literal. */
const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;

/** PostgreSQL 16's whitespace (`scan.l`, `space [ \t\n\r\f]`; a vertical tab is not one there, driven): not
 *  JavaScript's `\s`, which also holds characters PostgreSQL reads as part of a word (a no-break space). */
const PG_SPACE = /[ \t\n\r\f]/;

/** Where a `--` comment from `from` ends: at a line feed or a carriage return (`scan.l`, `newline`), else the end. */
function lineCommentEnd(sql: string, from: number): number {
  for (let k = from; k < sql.length; k += 1) if (sql[k] === '\n' || sql[k] === '\r') return k;
  return sql.length;
}

/**
 * Whether the word that ends just before `at` is an identifier, which a `$` continues (`scan.l`, `ident_cont`), and
 * not a number or a parameter, after which PostgreSQL starts a dollar quote. The word is read back to the nearest
 * character that is neither an identifier character nor a `.`; its last `.`-separated part decides.
 */
function wordBeforeIsIdentifier(sql: string, at: number): boolean {
  let start = at;
  while (start > 0 && (IDENTIFIER_CHAR.test(sql[start - 1]) || sql[start - 1] === '.')) start -= 1;
  const part = sql.slice(start, at).split('.').pop() ?? '';
  return /^[A-Za-z_\u0080-\uffff]/.test(part);
}

/**
 * One reading of `sql`: `one` when it begins (after whitespace and comments) with SELECT or WITH and holds no second
 * statement, `many` when it does not, `unsure` when a quoted form or a comment does not end. `backslashEscapes` is
 * the reading of a backslash inside a plain `'…'` literal; inside `E'…'` a backslash always escapes.
 */
function statementsIn(sql: string, backslashEscapes: boolean): 'one' | 'many' | 'unsure' {
  let i = 0;
  // Skips whitespace and comments from `i`; false when a block comment does not end.
  const skipSpaceAndComments = (): boolean => {
    for (;;) {
      while (i < sql.length && PG_SPACE.test(sql[i])) i += 1;
      if (sql.startsWith('--', i)) {
        i = lineCommentEnd(sql, i);
      } else if (sql.startsWith('/*', i)) {
        if (!skipBlockComment()) return false;
      } else {
        return true;
      }
    }
  };
  // A block comment from `i`, nested as PostgreSQL nests them; false when it does not end.
  const skipBlockComment = (): boolean => {
    let depth = 0;
    while (i < sql.length) {
      if (sql.startsWith('/*', i)) { depth += 1; i += 2; }
      else if (sql.startsWith('*/', i)) { depth -= 1; i += 2; if (depth === 0) return true; }
      else i += 1;
    }
    return false;
  };
  // A quoted form opened at `i` by `quote`; false when it does not end. `escapes`: a backslash escapes the next character.
  const skipQuoted = (quote: string, escapes: boolean): boolean => {
    i += 1;
    while (i < sql.length) {
      const c = sql[i];
      if (escapes && c === '\\') { i += 2; continue; }
      if (c === quote) {
        if (sql[i + 1] === quote) { i += 2; continue; }
        i += 1;
        return true;
      }
      i += 1;
    }
    return false;
  };

  if (!skipSpaceAndComments()) return 'unsure';
  if (!/^(select|with)\b/i.test(sql.slice(i))) return 'many';
  while (i < sql.length) {
    const c = sql[i];
    const before = i > 0 ? sql[i - 1] : '';
    if (c === '-' && sql[i + 1] === '-') {
      i = lineCommentEnd(sql, i);
    } else if (c === '/' && sql[i + 1] === '*') {
      if (!skipBlockComment()) return 'unsure';
    } else if (c === '"') {
      if (!skipQuoted('"', false)) return 'unsure';
    } else if (c === "'") {
      // An escape string when an `E` (not part of a longer word) opens it; else a plain literal, read both ways.
      const escapeString = /[eE]/.test(before) && !IDENTIFIER_CHAR.test(i > 1 ? sql[i - 2] : '');
      if (!skipQuoted("'", escapeString || backslashEscapes)) return 'unsure';
    } else if (c === '$' && IDENTIFIER_CHAR.test(before) && !wordBeforeIsIdentifier(sql, i)) {
      // A `$` directly after a number or a parameter (`1$$`, `1.5$$`, `$1$$`): PostgreSQL starts a dollar quote there
      // where this check would read a word (fix round 2, F7). Refused: the check is not sure of the reading.
      return 'unsure';
    } else if (c === '$' && !IDENTIFIER_CHAR.test(before)) {
      // A dollar quote: `$tag$`, the tag empty or an identifier that does not start with a digit (`$1` is a parameter).
      const tag = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end === -1) return 'unsure';
        i = end + tag[0].length;
      } else {
        i += 1;
      }
    } else if (c === ';') {
      i += 1;
      if (!skipSpaceAndComments()) return 'unsure';
      return i >= sql.length ? 'one' : 'many';
    } else {
      i += 1;
    }
  }
  return 'one';
}

/** The CKAN tool whose `sql` argument the check reads. */
export const CKAN_SQL_TOOL = 'ckan_datastore_search_sql';

/** The name the model is told a refused statement's source by: the CKAN server's, as a reader reads it. */
const CKAN_SERVER_NAME = (() => {
  const entry = CIVIC_MANIFEST.find((candidate) => candidate.sourceId === 'ckan-server');
  return readerSourceName({ sourceId: 'ckan-server', displayName: entry?.displayName });
})();

/**
 * The refusal of a call to a server's own tool, before anything is sent, or `null` when it may be sent (CKAN-2-WEB
 * P1, W3): since router 0.12.0 `ckan_datastore_search_sql` is the hosted CKAN server's own tool, offered as
 * `ckan__ckan_datastore_search_sql` with no pack, and its `sql` must be one statement beginning with SELECT or WITH
 * (`isOneSelectOrWithStatement`), the rule its `sql` description states. Keyed on the UPSTREAM name, so either
 * spelling is checked; no other manifest source declares the name. The check's named limit stands (website issue
 * 789 item 4): it does not establish that a statement only reads.
 */
export function serverCallRefusal(upstream: string, args: Record<string, unknown>): SqlStatementRefusedError | null {
  if (upstream === CKAN_SQL_TOOL && !isOneSelectOrWithStatement(args.sql)) return new SqlStatementRefusedError({ source: CKAN_SERVER_NAME });
  return null;
}

/**
 * The refusal of a pack call, before anything is sent, or `null` when it may be sent: a portal, dataset or identifier
 * outside the pack's (`PackFilterRefusedError`). The statement check is the CKAN server's own tool's since router
 * 0.12.0 (`serverCallRefusal`), with no pack.
 */
export function packCallRefusal(upstream: string, args: Record<string, unknown>, filter: PackFilter): PackFilterRefusedError | null {
  return packCallOutsideFilter(upstream, args, filter) ? new PackFilterRefusedError(filter) : null;
}

/**
 * The CKAN server's `ckan_datastore_search_sql` call whose `sql` is not one statement beginning with SELECT or WITH, refused before
 * anything is sent (D3 = A). Its own type, so the model is told the statement was refused, not the portal
 * (`sqlStatementRefusalForLlm`, `../streaming.ts`). Recorded, as the portal's refusal is, with the kind `unknown`.
 */
export class SqlStatementRefusedError extends Error {
  readonly filter: Pick<PackFilter, 'source'>;
  constructor(filter: Pick<PackFilter, 'source'>) {
    super('This call carries something other than one statement beginning with SELECT or WITH, so it was not sent.');
    this.name = 'SqlStatementRefusedError';
    this.filter = filter;
  }
}
