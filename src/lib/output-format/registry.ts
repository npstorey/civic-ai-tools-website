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
 *     Off, the menu shows no "Output format" item, and a question that names a format anyway is refused. Read
 *     server-side only: the root layout resolves it and hands the offered list to the page (`OutputFormatProvider`),
 *     as `SITE_PORTAL_LOCKED` reaches the form. WHEN it is read depends on the page: `/` is statically prerendered,
 *     so its menu holds what the setting was when the site was built, and changing the setting reaches `/` only with
 *     a new build; `/ask` is rendered per request and reads it on each one (measured by OF3b, website #810). The
 *     routes read it per request (`outputFormatFromBody`).
 *   THE FORMATS. Each has an id, a version, the words the menu shows, and whether it is offered. OF3a registered the
 *     plain map; OF3b offers it, with the setting on (G0-9 = A). A test registers its own
 *     (`registerOutputFormatForTests`).
 *   THE REQUEST (`outputFormatFromBody`). No `outputFormat` key is "Auto". Anything else is a format asked: an object
 *     carrying exactly the id and version of a format this instance offers, with the setting on; otherwise the
 *     question is refused, `output_format_not_offered`, at the point the routes refuse unusable picks: before the
 *     limiter, the model or any source.
 *   THE CHOICE, in the page (choice a, ruled A at G0b, seat 7168515476; S9): per browser session, in `sessionStorage` under
 *     `OUTPUT_FORMAT_STORAGE_KEY`, as Session type and Compare are. `auto`, or `<id>@<version>`.
 */
import { friendlyStreamError } from '../streaming.ts';
import { MAP_CAP_LINE } from './map-words.ts';

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

/** A format, as the page shows it: its words travel with it. `kind: 'map'` tells the menu that Compare and Sandbox do
 *  not run it (C3 = A, K3 = A); `capLine` is the second line under the format's line (C4's note). */
export interface OfferedOutputFormat extends OutputFormatRef {
  label: string;
  description?: string;
  capLine?: string;
  kind?: 'map';
}

/** A format this site knows. `offered` false keeps a known format from being asked for. `kind: 'map'` (OF3a) marks a
 *  map format: its run is composed with the map guidance and the `present_result` step (`present-step.ts`), it is
 *  Standard-session only (K3 = A), and its record states the outcome, the counts and the map. */
export interface OutputFormatDefinition extends OfferedOutputFormat {
  offered: boolean;
}

/**
 * The plain map (OF3a; W6 = A names it "Map"; the record's `preset.id` `plain-map`, `version` `"1"`), offered since
 * OF3b with its menu, its Compare and Sandbox reason lines and its map part. Its line is the owner's (C3 = C,
 * 7175769495), and rests on OF3b's criterion 12: the reader's browser contacts no host the "Auto" answer does not, and
 * the site sends nothing to any map service. The cap line under it is the seat's (7175128278).
 */
export const PLAIN_MAP_FORMAT: Readonly<OutputFormatDefinition> = Object.freeze({
  id: 'plain-map',
  version: '1',
  label: 'Map',
  description: 'This site maps rows the AI chose from the data. No map service receives anything.',
  capLine: MAP_CAP_LINE,
  offered: true,
  kind: 'map',
});

/** The formats this site knows: the plain map, offered with the setting on (OF3b). */
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
    ...(f.capLine !== undefined ? { capLine: f.capLine } : {}),
    ...(f.kind !== undefined ? { kind: f.kind } : {}),
  }));
}

/** What a question's body says about its format. */
export type RequestOutputFormat = { kind: 'auto' } | { kind: 'asked'; format: OutputFormatRef } | { kind: 'refused' };

/** The name a format this site knows goes by (the record page's "Output format: {name}", W11), or null. */
export function outputFormatLabel(format: OutputFormatRef): string | null {
  return FORMATS.find((f) => f.id === format.id && f.version === format.version)?.label ?? null;
}

/** Whether `format` names a map format this site knows (OF3a): one whose run carries the present step. The page reads
 *  the same registry, so the menu and the routes agree. */
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

/** The format a question carries: the chosen one, except a map format in a Sandbox session, which carries none (K3 =
 *  A): the menu shows Auto there and the stored choice is kept for Standard. */
export function outputFormatInForce<T extends { kind?: 'map' }>(chosen: T | null, sandbox: boolean): T | null {
  return chosen !== null && sandbox && chosen.kind === 'map' ? null : chosen;
}

/** Whether a chosen format is a map format, which runs with data tools only (C3 = A). */
export function isMapChoice(chosen: { kind?: 'map' } | null | undefined): boolean {
  return chosen?.kind === 'map';
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
