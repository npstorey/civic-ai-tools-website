/**
 * The plain map, built from the rows one call of the run returned (OF3a, Sprint OF-1, website #810; G0-3 = A, S3, S7,
 * C4 = A).
 *
 * WHAT THE AI CHOOSES, AND WHAT THIS MODULE BUILDS. In a run asked in a map format the AI names, through the site's
 * `present_result` step, which call's rows to map (`result`) and which of their columns labels each row (`label`).
 * Both are identifiers, checked here against the run's own results (S3). Everything drawn is built here, from that
 * call's rows and nothing else: no field of the map is written from the question or from the AI's text, so a
 * coordinate that appears only in the answer can never reach the map.
 *
 * WHICH ROWS ARE DRAWN. A row is located when its location columns give a latitude in [-90, 90] and a longitude in
 * [-180, 180] (`locationOf`). THE CAP KEEPS THE FIRST `MAP_POINT_CAP` LOCATED ROWS IN THE ORDER THE SOURCE RETURNED
 * THEM (`buildPlainMap`, the `slice` below), and counts the rest as `beyondCap`. So
 * `drawn + withoutLocation + beyondCap = returned`, always.
 *
 * A ROW'S ID is its position in the result the call returned, from 1, as a string: the one identifier every row of
 * every source has. The schema does not enforce unique feature ids (OF0 item 4), so `assertUniqueFeatureIds` is the
 * producer's own check, run on every map built here and again when a record is packaged (`record.ts`).
 *
 * THE MAP'S DATA is a squidmaps map spec valid against the schema copy beside this file
 * (`schema/squidmaps-map.d7cdb725.schema.json`, `squidmaps-io/squidmaps-map-spec@d7cdb725`): the seven required
 * fields, and no other. A feature carries its point, `[longitude, latitude]` at six decimal places, and one property,
 * `name`, the label column's value when it is text, a number or a boolean. The map's `name` is built from the counts
 * and the dataset's identifier; its `description` is empty and its `legend` and `basemap` are null: this site draws
 * the plot itself, with no basemap and no other host.
 */
import { getDatasetName } from '../streaming.ts';
import { MAP_POINT_CAP, mapCaption } from './map-words.ts';

/** The most points a plain map draws (C4 = A), defined beside the sentences that state it (`map-words.ts`). */
export { MAP_POINT_CAP };

/** Why no map was drawn (the record's `outcome.reason`). */
export type NoMapReason = 'no-result-named' | 'no-location-columns' | 'no-located-rows' | 'result-failed';
export const NO_MAP_REASONS: readonly NoMapReason[] = ['no-result-named', 'no-location-columns', 'no-located-rows', 'result-failed'];

/** The record's `outcome`: whether a map was drawn, and why not. */
export type MapOutcome = { drawn: true } | { drawn: false; reason: NoMapReason };

/** The record's `counts`: every row the named call returned is counted once. */
export interface MapCounts {
  returned: number;
  drawn: number;
  withoutLocation: number;
  beyondCap: number;
}

/** One point of the map. */
export interface PlainMapFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { name?: string | number | boolean };
}

/** The map's data: the seven required fields of the squidmaps schema at `d7cdb725`, and no other. */
export interface PlainMapSpec {
  name: string;
  description: string;
  basemap: null;
  extent: { zoom: { mode: 'range'; min: number; max: number } };
  view: null;
  legend: null;
  features: PlainMapFeature[];
}

/** What a present step produced: the record's `outcome`, `counts` (absent on `no-result-named` and `result-failed`)
 *  and `map` (only when drawn). */
export interface MapPresentation {
  outcome: MapOutcome;
  counts?: MapCounts;
  map?: PlainMapSpec;
}

/** A map whose features repeat an id: the producer's own check (the schema states uniqueness only in prose). */
export class DuplicateFeatureIdError extends Error {
  readonly featureId: string;
  constructor(featureId: string) {
    super(`map: feature id ${JSON.stringify(featureId)} appears more than once; a feature id is unique within the map`);
    this.name = 'DuplicateFeatureIdError';
    this.featureId = featureId;
  }
}

/** Throws `DuplicateFeatureIdError` when two features share an id. */
export function assertUniqueFeatureIds(map: { features: ReadonlyArray<{ id?: unknown }> }): void {
  const seen = new Set<string>();
  for (const feature of map.features) {
    const id = String(feature.id);
    if (seen.has(id)) throw new DuplicateFeatureIdError(id);
    seen.add(id);
  }
}

/** The rows of a call's result: a bare array or a `{ data: [...] }` envelope of objects; `undefined` when it is not
 *  rows (as the loop's `summarizeToolResult` reads a result). */
export function rowsOfResult(result: string): Record<string, unknown>[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return undefined;
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : undefined;
  if (!rows) return undefined;
  if (!rows.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) return undefined;
  return rows as Record<string, unknown>[];
}

/** Every column the rows carry, in first-seen order (a source may leave a null value's key out of a row). */
export function columnsOfRows(rows: readonly Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

const LATITUDE_NAMES = ['latitude', 'lat'];
const LONGITUDE_NAMES = ['longitude', 'lon', 'lng', 'long'];
const DECIMAL = /^\s*-?\d+(\.\d+)?\s*$/;

/** A number, or a decimal written as text (as a source often returns one); anything else is no coordinate. */
function coordinate(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && DECIMAL.test(value)) return Number(value);
  return undefined;
}

function point(latitude: unknown, longitude: unknown): [number, number] | undefined {
  const lat = coordinate(latitude);
  const lon = coordinate(longitude);
  if (lat === undefined || lon === undefined) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return [lon, lat];
}

/** Where a row's location is read from: a latitude and longitude column pair, then each point column in column order. */
export interface LocationColumns {
  pair?: { latitude: string; longitude: string };
  points: string[];
}

/** A value shaped as a point: GeoJSON `{ type: 'Point', coordinates: [lon, lat] }`, or `{ latitude, longitude }`. */
function pointOfValue(value: unknown): [number, number] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (v.type === 'Point' && Array.isArray(v.coordinates) && v.coordinates.length >= 2) return point(v.coordinates[1], v.coordinates[0]);
  if ('latitude' in v && 'longitude' in v) return point(v.latitude, v.longitude);
  return undefined;
}

function isPointShaped(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (v.type === 'Point' && Array.isArray(v.coordinates)) || ('latitude' in v && 'longitude' in v);
}

/** The rows' location columns: a column pair named for latitude and longitude (any case), and the columns any row
 *  holds a point-shaped value in. None of either is "no location column". */
export function locationColumnsOf(rows: readonly Record<string, unknown>[], columns: readonly string[]): LocationColumns {
  const byLower = new Map(columns.map((c) => [c.toLowerCase(), c] as const));
  const latitude = LATITUDE_NAMES.map((n) => byLower.get(n)).find((c) => c !== undefined);
  const longitude = LONGITUDE_NAMES.map((n) => byLower.get(n)).find((c) => c !== undefined);
  const points = columns.filter((c) => rows.some((row) => isPointShaped(row[c])));
  return { ...(latitude && longitude ? { pair: { latitude, longitude } } : {}), points };
}

/** A row's point, `[longitude, latitude]`, from the first of its location columns that gives one. */
export function locationOf(row: Record<string, unknown>, where: LocationColumns): [number, number] | undefined {
  if (where.pair) {
    const found = point(row[where.pair.latitude], row[where.pair.longitude]);
    if (found) return found;
  }
  for (const column of where.points) {
    const found = pointOfValue(row[column]);
    if (found) return found;
  }
  return undefined;
}

/** Six decimal places, the schema's stated precision. */
function sixPlaces(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** What a call's data is called where the map names it: the dataset (or CKAN resource) the call named, as
 *  `getDatasetName` names one; a call that named none is "the data the AI chose" (unchecked words, OF3a). */
export const UNNAMED_DATA = 'the data the AI chose';
export function datasetOfCall(call: { args: Record<string, unknown> }): string {
  const id = call.args.dataset_id ?? call.args.resource_id;
  return typeof id === 'string' && id.length > 0 ? getDatasetName(id) : UNNAMED_DATA;
}

/** The map's name (at most 100 characters, the schema's limit): W9's caption, "The {drawn} mapped rows from {dataset}",
 *  built by the one caption builder (`map-words.ts`, the number rule C2c = A). */
export function mapName(drawn: number, dataset: string): string {
  const name = mapCaption(drawn, dataset);
  return name.length <= 100 ? name : `${name.slice(0, 99)}…`;
}

/**
 * Build the map from one call's rows. `label` has been checked against the rows' columns by the caller (the present
 * step) when there are rows; with none, nothing is labelled.
 */
export function buildPlainMap(input: { rows: readonly Record<string, unknown>[]; label: string; dataset: string }): MapPresentation {
  const { rows, label, dataset } = input;
  const returned = rows.length;
  if (returned === 0) {
    return { outcome: { drawn: false, reason: 'no-located-rows' }, counts: { returned: 0, drawn: 0, withoutLocation: 0, beyondCap: 0 } };
  }
  const where = locationColumnsOf(rows, columnsOfRows(rows));
  if (!where.pair && where.points.length === 0) {
    return { outcome: { drawn: false, reason: 'no-location-columns' }, counts: { returned, drawn: 0, withoutLocation: returned, beyondCap: 0 } };
  }
  const located: Array<{ position: number; at: [number, number]; row: Record<string, unknown> }> = [];
  rows.forEach((row, index) => {
    const at = locationOf(row, where);
    if (at) located.push({ position: index + 1, at, row });
  });
  const withoutLocation = returned - located.length;
  if (located.length === 0) {
    return { outcome: { drawn: false, reason: 'no-located-rows' }, counts: { returned, drawn: 0, withoutLocation, beyondCap: 0 } };
  }
  // THE CAP (C4 = A): the first MAP_POINT_CAP located rows, in the order the source returned them.
  const kept = located.slice(0, MAP_POINT_CAP);
  const beyondCap = located.length - kept.length;
  const features: PlainMapFeature[] = kept.map(({ position, at, row }) => {
    const value = row[label];
    const name = typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined;
    return {
      type: 'Feature',
      id: String(position),
      geometry: { type: 'Point', coordinates: [sixPlaces(at[0]), sixPlaces(at[1])] },
      properties: name === undefined ? {} : { name },
    };
  });
  const map: PlainMapSpec = {
    name: mapName(kept.length, dataset),
    description: '',
    basemap: null,
    extent: { zoom: { mode: 'range', min: 0, max: 22 } },
    view: null,
    legend: null,
    features,
  };
  assertUniqueFeatureIds(map);
  return { outcome: { drawn: true }, counts: { returned, drawn: kept.length, withoutLocation, beyondCap }, map };
}
