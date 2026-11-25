/**
 * The output formats this site knows, which it offers, and how a question asks for one (OF2, Sprint OF-1, website #810;
 * G0-1 = A, G0-2 = A, G0-9 = A; the seat's S4 and S8).
 *
 * "Auto" is not a format here: it is the absence of one. A question in "Auto" carries no `outputFormat` field, its
 * run's root span states nothing, and its record carries no `org.civicaitools.output-format` key, so every byte of it
 * is what it was before formats existed. The converse does not hold: a record with no such key states nothing about
 * the format ("not recorded"), since a trace that recorded none looks the same (`record.ts`).
 *
 *   THE SETTING. `SITE_OUTPUT_FORMAT`: `on` or `off` (trimmed, any case), unset meaning off; any other value is off.
 *     Off, the menu shows no "Output format" item, and a question that names a format anyway is refused. Read at call
 *     time, server-side only: the root layout resolves it and hands the offered list to the page
 *     (`OutputFormatProvider`), as `SITE_PORTAL_LOCKED` reaches the form.
 *   THE FORMATS. Each has an id, a version, the words the menu shows, and whether it is offered. OF3a registers the
 *     plain map, not offered: readers are offered "Auto" only until OF3b (G0-9 = A). A test registers its own
 *     (`registerOutputFormatForTests`).
 *   THE REQUEST (`outputFormatFromBody`). No `outputFormat` key is "Auto". Anything else is a format asked: an object
 *     carrying exactly the id and version of a format this instance offers, with the setting on; otherwise the
 *     question is refused, `output_format_not_offered`, at the point the routes refuse unusable picks: before the
 *     limiter, the model or any source.
 *   THE CHOICE, in the page (choice a, ruled A at G0b, seat 7168515476; S9): per browser session, in `sessionStorage` under
 *     `OUTPUT_FORMAT_STORAGE_KEY`, as Session type and Compare are. `auto`, or `<id>@<version>`.
 */
import { friendlyStreamError } from '../streaming.ts';

/** The setting's name (S8). */
export const OUTPUT_FORMAT_SETTING = 'SITE_OUTPUT_FORMAT';
/** The record's key (S4): `extensions["org.civicaitools.output-format"].preset = { id, version }`. */
export const OUTPUT_FORMAT_EXTENSION_KEY = 'org.civicaitools.output-format';
/** The request body's field: `{ id, version }`, absent under "Auto". */
export const OUTPUT_FORMAT_BODY_FIELD = 'outputFormat';
/** Where the page keeps the reader's choice for the browser session (choice a; ruled A at G0b). */
export const OUTPUT_FORMAT_STORAGE_KEY = 'civicaitools.outputFormat';
/** The stored value for "Auto". */
export const AUTO_STORED_VALUE = 'auto';
/** The refusal's kind (`STREAM_ERROR_KINDS`). */
export const OUTPUT_FORMAT_REFUSAL_CODE = 'output_format_not_offered';

/** A format, as a question asks for it and a record states it. */
export interface OutputFormatRef {
  id: string;
  version: string;
}

/** A format, as the page shows it: its words travel with it. */
export interface OfferedOutputFormat extends OutputFormatRef {
  label: string;
  description?: string;
}

/** A format this site knows. `offered` false keeps a known format from being asked for. `kind: 'map'` (OF3a) marks a
 *  map format: its run is composed with the map guidance and the `present_result` step (`present-step.ts`), it is
 *  Standard-session only (K3 = A), and its record states the outcome, the counts and the map. */
export interface OutputFormatDefinition extends OfferedOutputFormat {
  offered: boolean;
  kind?: 'map';
}

/**
 * The plain map (OF3a; W6 = A names it "Map"; the record's `preset.id` `plain-map`, `version` `"1"`). Registered
 * here and NOT YET OFFERED: OF3b offers it with its menu, its Compare and Sandbox reason lines and its map part. Until
 * then no reader can ask for it, and a question that names it is refused as any format not offered is.
 */
export const PLAIN_MAP_FORMAT: Readonly<OutputFormatDefinition> = Object.freeze({
  id: 'plain-map',
  version: '1',
  label: 'Map',
  description: 'Points from the data, drawn by this site. No other service receives anything to draw the map.',
  offered: false,
  kind: 'map',
});

/** The formats this site knows: the plain map (OF3a), not yet offered (G0-9 = A until OF3b). */
const FORMATS: OutputFormatDefinition[] = [{ ...PLAIN_MAP_FORMAT }];

/** For tests only: register a format, and get back the call that removes it. */
export function registerOutputFormatForTests(definition: OutputFormatDefinition): () => void {
  const entry = { ...definition };
  FORMATS.push(entry);
  return () => {
    const at = FORMATS.indexOf(entry);
    if (at >= 0) FORMATS.splice(at, 1);
  };
}

type Env = Record<string, string | undefined>;

/** `SITE_OUTPUT_FORMAT` is `on` (trimmed, any case). Unset, `off` and anything else read off. */
export function outputFormatSettingOn(env: Env = process.env): boolean {
  return (env[OUTPUT_FORMAT_SETTING] ?? '').trim().toLowerCase() === 'on';
}

/** The formats offered to readers, with their words; `null` when the setting is off (the menu shows no item). */
export function offeredOutputFormats(env: Env = process.env): OfferedOutputFormat[] | null {
  if (!outputFormatSettingOn(env)) return null;
  return FORMATS.filter((f) => f.offered).map((f) => ({
    id: f.id,
    version: f.version,
    label: f.label,
    ...(f.description !== undefined ? { description: f.description } : {}),
  }));
}

/** What a question's body says about its format. */
export type RequestOutputFormat = { kind: 'auto' } | { kind: 'asked'; format: OutputFormatRef } | { kind: 'refused' };

/** Whether `format` names a map format this site knows (OF3a): one whose run carries the present step. */
export function isMapFormat(format: OutputFormatRef): boolean {
  return FORMATS.some((f) => f.kind === 'map' && f.id === format.id && f.version === format.version);
}

/**
 * Read `outputFormat` from a parsed request body, against this instance's setting and offered formats. A route that
 * runs no map (`mapFormats: false`: the Sandbox route, K3 = A) refuses a map format as a format it does not offer.
 */
export function outputFormatFromBody(body: unknown, env: Env = process.env, options: { mapFormats?: boolean } = {}): RequestOutputFormat {
  if (body === null || typeof body !== 'object' || !Object.hasOwn(body, OUTPUT_FORMAT_BODY_FIELD)) return { kind: 'auto' };
  if (!outputFormatSettingOn(env)) return { kind: 'refused' };
  const value = (body as Record<string, unknown>)[OUTPUT_FORMAT_BODY_FIELD];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { kind: 'refused' };
  const keys = Object.keys(value);
  const { id, version } = value as Record<string, unknown>;
  if (keys.length !== 2 || typeof id !== 'string' || typeof version !== 'string') return { kind: 'refused' };
  const offered = FORMATS.some((f) => f.offered && f.id === id && f.version === version && (options.mapFormats !== false || f.kind !== 'map'));
  return offered ? { kind: 'asked', format: { id, version } } : { kind: 'refused' };
}

/** The refusal's body: reader-facing words and the kind, never a raw message. */
export function outputFormatRefusalPayload(): { error: string; code: typeof OUTPUT_FORMAT_REFUSAL_CODE } {
  return { error: friendlyStreamError({ code: OUTPUT_FORMAT_REFUSAL_CODE }), code: OUTPUT_FORMAT_REFUSAL_CODE };
}

/** The stored value for a choice: `auto`, or `<id>@<version>`. */
export function storedOutputFormatValue(choice: OutputFormatRef | null): string {
  return choice ? `${choice.id}@${choice.version}` : AUTO_STORED_VALUE;
}

/** Parse a stored choice; anything that is not `auto` or `<id>@<version>` is "no choice". */
export function parseStoredOutputFormat(raw: string | null): string | null {
  if (raw === AUTO_STORED_VALUE) return raw;
  return raw !== null && /^[^@\s]+@[^@\s]+$/.test(raw) ? raw : null;
}

/** The offered format a stored choice names, or null ("Auto"): a choice the instance no longer offers is "Auto". */
export function chosenOutputFormat(stored: string | null, offered: readonly OfferedOutputFormat[] | null): OfferedOutputFormat | null {
  if (!offered || stored === null || stored === AUTO_STORED_VALUE) return null;
  return offered.find((f) => storedOutputFormatValue(f) === stored) ?? null;
}
