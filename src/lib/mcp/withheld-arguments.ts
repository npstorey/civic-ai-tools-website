/**
 * Arguments this site withholds from a source's tool (CKAN-2-WEB P1, criterion 7; seat ruling 6983432990): not
 * offered in the tool's schema, and stripped from any call that carries one anyway, before the call is recorded or
 * sent, so the record states the arguments the source received.
 *
 * `check_source_portal` on the hosted CKAN server's `ckan_list_resources` (router 0.12.0): with it true, the pinned
 * server probes up to ten other hosts taken from a dataset's resource links (the fork `npstorey/ckan-mcp-server` at
 * `pin` 05cd1a86, `src/tools/package.ts`). Those probes reach portals no call named.
 *
 * Keyed by UPSTREAM name, so either spelling is covered; no other manifest source declares `ckan_list_resources`.
 */
import { upstreamToolName } from './operation-types.ts';

export const WITHHELD_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  ckan_list_resources: ['check_source_portal'],
};

type FunctionTool = { type: string; function: { name: string; parameters?: unknown } };
type Parameters = { properties?: Record<string, unknown>; required?: unknown };

/** `tool` without the arguments this site withholds from it: the same object when it withholds none. */
function withoutWithheld<T>(tool: T): T {
  const fn = (tool as unknown as FunctionTool).function;
  if ((tool as unknown as FunctionTool).type !== 'function' || fn === undefined) return tool;
  const withheld = WITHHELD_ARGUMENTS[upstreamToolName(fn.name)];
  const parameters = fn.parameters as Parameters | undefined;
  if (withheld === undefined || parameters?.properties === undefined) return tool;
  const properties = Object.fromEntries(Object.entries(parameters.properties).filter(([key]) => !withheld.includes(key)));
  const required = Array.isArray(parameters.required) ? { required: parameters.required.filter((key) => !withheld.includes(String(key))) } : {};
  return { ...tool, function: { ...fn, parameters: { ...parameters, properties, ...required } } } as T;
}

/** The tool schemas with every withheld argument removed: the same array when no schema withholds one. */
export function withholdArgumentsFromTools<T>(tools: T[]): T[] {
  const result = tools.map(withoutWithheld);
  return result.every((tool, i) => tool === tools[i]) ? tools : result;
}

/** Strip the withheld arguments from a call's `args`, named in either spelling. Mutates `args`. */
export function stripWithheldArguments(toolName: string, args: Record<string, unknown>): void {
  for (const key of WITHHELD_ARGUMENTS[upstreamToolName(toolName)] ?? []) delete args[key];
}
