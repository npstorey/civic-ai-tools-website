/**
 * UX-2 P6 + P10 (#729; contract p6p10.md item 14, P10-11 under C1 = A): the one sources sentence.
 *
 * "This site answers from <N> data sources: <names>." N and the names are read from the instance's statement
 * (`buildFlowsStatement()`), in its order, each by its reader name (`readerSourceName`), never typed. N = 1 takes the
 * ruled singular. There is no N = 0 form (D-15): the statement always lists one source or more (the router defaults
 * the Data Commons address), which `marketing-pages.test.ts` holds as a guard.
 */
import type { FlowsSource } from './statement.ts';
import { readerSourceName } from '../sources/source-name.ts';

/** "A", "A and B", "A, B and C": the ruled sentences' list form (no comma before "and"). */
function listed(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function sourcesSentence(sources: readonly Pick<FlowsSource, 'sourceId' | 'displayName'>[]): string {
  const names = sources.map((source) => readerSourceName(source));
  if (names.length === 1) return `This site answers from 1 data source: ${names[0]}.`;
  return `This site answers from ${names.length} data sources: ${listed(names)}.`;
}
