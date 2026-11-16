/**
 * UX-2 P6 + P10 (#729; contract p6p10.md item 14, P10-11): the one sources sentence, read from the statement.
 *
 * RED STUB. The red commit lands the name, typed, so criterion 12's test type-checks and fails at its assertions;
 * it returns no sentence. The green builds "This site answers from <N> data sources: <names>." from the statement.
 */
import type { FlowsSource } from './statement';

export function sourcesSentence(sources: readonly Pick<FlowsSource, 'sourceId' | 'displayName'>[]): string {
  void sources;
  return '';
}
