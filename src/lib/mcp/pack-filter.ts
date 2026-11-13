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

/** Each pack's filter, by its `sourceId`, read once from the manifest. */
const FILTERS: ReadonlyMap<string, PackFilter> = new Map(
  CIVIC_MANIFEST.filter((entry) => entry.base !== undefined).map((entry) => {
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

/** The filter of the pack whose exposed tool `toolName` is, or `undefined` for any other name (a bare name included). */
export function packFilterOf(toolName: string): PackFilter | undefined {
  const target = civicRouter.dispatchMap.get(toolName);
  return target?.base !== undefined ? FILTERS.get(target.sourceId) : undefined;
}

/** The pack filters, by the pack's `sourceId`. */
export function packFilters(): ReadonlyMap<string, PackFilter> {
  return FILTERS;
}

/** Give a pack `get_data` call the pack's fixed values where it omits them. Mutates `args`. */
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
