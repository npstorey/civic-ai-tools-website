/**
 * Every reader-facing sentence of the plain map, in one place (OF3b, Sprint OF-1, website #810): the count line (W7),
 * the no-map sentences (W8), the table's caption, the plot's alternative text and the save action (W9), the run's lines
 * (W10), the record page's lines (W11), and the menu's two reason lines (C3 = A, K3 = A).
 *
 * THE WORDS. As ruled: W3 ("the AI") and W4 ("rows") applied, W5 = A ("mapped" everywhere; "points" only for the map's
 * own limit). The owner's rulings of the three-card set (website #810, 7175769495) are folded: C1 = A (W8's first
 * reason), C2a = A (the record page's added line), C2b = A (the record page's count line is W7 in full), C2c = A (the
 * number rule below) and C2d = B (the over-cap sentence). The seat ruled the Compare and Sandbox reason lines
 * (7172716367) and the summary clause with no dataset (7175461805).
 *
 * THE NUMBER RULE (C2c = A). Each noun, and the verb that goes with it, follows the number in front of it. In
 * "{drawn} of {returned} rows" that number is {returned}. Every sentence here that carries a count builds it through
 * `counted`, which applies the rule, so a form cannot be written twice. A count is written with the en-US grouping
 * ("1,203"), as the cap is ("1,000").
 *
 * Pure, with no import: the loop's prose (`streaming.ts`), the steps (`answer-view/steps.ts`), the menu and the map
 * part all read it, and it reads none of them.
 */

/** The most points a plain map draws (C4 = A). `plain-map.ts` re-exports it; the cap's sentences state it from here. */
export const MAP_POINT_CAP = 1000;

const number = (n: number): string => n.toLocaleString('en-US');
/** The cap as the sentences write it: "1,000". */
const CAP = number(MAP_POINT_CAP);

/** The number rule (C2c = A): `n` and then the words that follow it, singular for 1 and plural otherwise. */
export function counted(n: number, one: string, many: string): string {
  return `${number(n)} ${n === 1 ? one : many}`;
}

/** The record's counts, as the sentences read them. */
export interface MapCountsWords {
  returned: number;
  drawn: number;
  withoutLocation: number;
  beyondCap: number;
}

/** Why no map was drawn, as the record states it. */
export type NoMapReasonWords = 'no-result-named' | 'no-location-columns' | 'no-located-rows' | 'result-failed';

// --- W7: the count line (the map part and, C2b = A, the record page) -------------------------------------------------

/**
 * W7. Normal: "{drawn} of {returned} rows mapped; {withoutLocation} had no location.", the second clause only when it is
 * not 0. Over the cap (C2d = B): "{drawn} of {returned} rows mapped. Of the rows with a location, the map shows the
 * first 1,000 the data source returned. {beyondCap} more rows with a location are not shown. The rows not shown may
 * come from other places or dates. {withoutLocation} had no location.", the last sentence only when it is not 0.
 */
export function mapCountLine(counts: MapCountsWords): string {
  const head = `${number(counts.drawn)} of ${counted(counts.returned, 'row', 'rows')} mapped`;
  if (counts.beyondCap === 0) {
    return counts.withoutLocation > 0 ? `${head}; ${number(counts.withoutLocation)} had no location.` : `${head}.`;
  }
  return [
    `${head}.`,
    `Of the rows with a location, the map shows the first ${CAP} the data source returned.`,
    `${counted(counts.beyondCap, 'more row with a location is not shown', 'more rows with a location are not shown')}.`,
    'The rows not shown may come from other places or dates.',
    ...(counts.withoutLocation > 0 ? [`${number(counts.withoutLocation)} had no location.`] : []),
  ].join(' ');
}

// --- W8: no map (the checker's forms; C1 = A for the first) -----------------------------------------------------------

/** W8's sentence for a reason; `returned` is the rows the named call returned, which `no-located-rows` reads. */
export function noMapSentence(why: NoMapReasonWords, returned?: number): string {
  // Named `why`, not `reason`: this repository reserves `reason` for a recorded call's phrase (reason-phrase-readers.test.ts).
  switch (why) {
    case 'no-result-named':
      return 'No map: the AI did not make a choice this site could use.';
    case 'no-location-columns':
      return 'No map: the data chosen for the map has no location column.';
    case 'no-located-rows':
      if (returned === undefined || returned === 0) return 'No map: the data chosen for the map returned no rows.';
      if (returned === 1) return 'No map: the one row returned had no location.';
      return `No map: none of the ${counted(returned, 'row', 'rows')} had a location.`;
    case 'result-failed':
      return 'No map: the data for the map did not arrive or could not be read.';
  }
}

// --- W9: the table, the plot's alternative text, the save action -------------------------------------------------------

/** W9's caption: "The {drawn} mapped rows from {dataset}". */
export function mapCaption(drawn: number, dataset: string): string {
  return `The ${counted(drawn, 'mapped row', 'mapped rows')} from ${dataset}`;
}

/** W9's alternative text: "Map of {drawn} points from {dataset}.", then "{withoutLocation} rows had no location." when not 0. */
export function mapAltText(drawn: number, withoutLocation: number, dataset: string): string {
  const first = `Map of ${counted(drawn, 'point', 'points')} from ${dataset}.`;
  return withoutLocation > 0 ? `${first} ${counted(withoutLocation, 'row', 'rows')} had no location.` : first;
}

/** W9's save action (the file is the map data as the record keeps it). */
export const MAP_DATA_DOWNLOAD = 'Download map data';

/**
 * The table's column headings, and the two lines under the table that say what "Label" and "Row" hold (the seat's
 * 7225128356, from the words check's replacement lines; "Latitude" and "Longitude" stay as built).
 */
export const MAP_TABLE_HEADINGS = { row: 'Row', name: 'Label', latitude: 'Latitude', longitude: 'Longitude' } as const;

/** Under the table: "Label: the value in the {column} column. The AI chose that column." */
export function mapLabelLine(column: string): string {
  return `Label: the value in the ${column} column. The AI chose that column.`;
}

/** Under the table: "Row: its place in the {returned} rows the data source returned, counting from 1." (rule C2c). */
export function mapRowLine(returned: number): string {
  return `Row: its place in the ${counted(returned, 'row', 'rows')} the data source returned, counting from 1.`;
}

/** A row's empty label value (the ORCH's proposal, ruled by the seat, 7225128356; Appendix B's words for an absent value). */
export const MAP_VALUE_NOT_STATED = 'not stated';

// --- W10: the run's lines --------------------------------------------------------------------------------------------

/** W10, while the step runs. */
export const MAP_STEP_RUNNING = 'Choosing what to map';

/** W10, in the steps list: "This site mapped {drawn} of {returned} rows from {dataset}". */
export function mapStepLine(drawn: number, returned: number, dataset: string): string {
  return `This site mapped ${number(drawn)} of ${counted(returned, 'row', 'rows')} from ${dataset}`;
}

/**
 * W10, in the summary sentence: "…, then chose rows from {dataset} for this site to map."; with no dataset or resource
 * named, "…, then chose rows for this site to map." (the seat, 7175461805).
 */
export function mapSummaryClause(dataset: string | undefined): string {
  return dataset !== undefined ? `chose rows from ${dataset} for this site to map` : 'chose rows for this site to map';
}

// --- W11: the record page ----------------------------------------------------------------------------------------------

/** W11: "Output format: Map", from the format's own name. */
export function recordFormatLine(label: string): string {
  return `Output format: ${label}`;
}

/** C2a = A: under the format line on the record page. */
export const RECORD_MAP_NOT_SHOWN = 'This page lists the mapped rows. It does not show the map.';

// --- The menu's reason lines (C3 = A, K3 = A; the seat's 7172716367) --------------------------------------------------

/** Compare's reason while a map format is chosen; the compare route's refusal says the same (`streaming.ts`). */
export const MAP_COMPARE_REASON = 'Not offered while a map format is chosen. Switch Output format to Auto to compare.';
/** A map format's reason in a Sandbox session. */
export const MAP_SANDBOX_REASON = 'Not offered in a Sandbox session. Switch Session type to Standard to use a map.';
/** The cap, stated where the format is described (C4's note; the seat's 7175128278). */
export const MAP_CAP_LINE = `The map shows at most ${CAP} points.`;
