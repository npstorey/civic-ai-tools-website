/**
 * The output formats this site knows, which it offers, and how a question asks for one (OF2, Sprint OF-1, website #810;
 * G0-1 = A, G0-2 = A, G0-9 = A; the seat's S4 and S8).
 *
 * "Auto" is not a format here: it is the absence of one. A question in "Auto" carries no `outputFormat` field, its
 * run's root span states nothing, and its record carries no `org.civicaitools.output-format` key, so every byte of it
 * is what it was before formats existed.
 *
 *   THE SETTING. `SITE_OUTPUT_FORMAT`: `on` or `off` (trimmed, any case), unset meaning off; any other value is off.
 *     Off, the menu shows no "Output format" item, and a question that names a format anyway is refused. Read at call
 *     time, server-side only: the root layout resolves it and hands the offered list to the page
 *     (`OutputFormatProvider`), as `SITE_PORTAL_LOCKED` reaches the form.
 *   THE FORMATS. Each has an id, a version, the words the menu shows, and whether it is offered. OF2 registers none:
 *     readers are offered "Auto" only (G0-9 = A). A test registers its own (`registerOutputFormatForTests`).
 *   THE REQUEST (`outputFormatFromBody`). No `outputFormat` key is "Auto". Anything else is a format asked: an object
 *     carrying exactly the id and version of a format this instance offers, with the setting on; otherwise the
 *     question is refused, `output_format_not_offered`, at the point the routes refuse unusable picks: before the
 *     limiter, the model or any source.
 *   THE CHOICE, in the page (choice a, a draft for G0b; S9): per browser session, in `sessionStorage` under
 *     `OUTPUT_FORMAT_STORAGE_KEY`, as Session type and Compare are. `auto`, or `<id>@<version>`.
 */
import { friendlyStreamError } from '../streaming.ts';

/** The setting's name (S8). */
export const OUTPUT_FORMAT_SETTING = 'SITE_OUTPUT_FORMAT';
/** The record's key (S4): `extensions["org.civicaitools.output-format"].preset = { id, version }`. */
export const OUTPUT_FORMAT_EXTENSION_KEY = 'org.civicaitools.output-format';
/** The request body's field: `{ id, version }`, absent under "Auto". */
export const OUTPUT_FORMAT_BODY_FIELD = 'outputFormat';
/** Where the page keeps the reader's choice for the browser session (choice a; a draft for G0b). */
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

/** A format this site knows. `offered` false keeps a known format from being asked for. */
export interface OutputFormatDefinition extends OfferedOutputFormat {
  offered: boolean;
}

/** The formats this site knows. OF2 registers none (G0-9 = A). */
const FORMATS: OutputFormatDefinition[] = [];

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

/** Read `outputFormat` from a parsed request body, against this instance's setting and offered formats. */
export function outputFormatFromBody(body: unknown, env: Env = process.env): RequestOutputFormat {
  if (body === null || typeof body !== 'object' || !Object.hasOwn(body, OUTPUT_FORMAT_BODY_FIELD)) return { kind: 'auto' };
  if (!outputFormatSettingOn(env)) return { kind: 'refused' };
  const value = (body as Record<string, unknown>)[OUTPUT_FORMAT_BODY_FIELD];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { kind: 'refused' };
  const keys = Object.keys(value);
  const { id, version } = value as Record<string, unknown>;
  if (keys.length !== 2 || typeof id !== 'string' || typeof version !== 'string') return { kind: 'refused' };
  const offered = FORMATS.some((f) => f.offered && f.id === id && f.version === version);
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
