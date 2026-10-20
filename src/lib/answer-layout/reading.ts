// The reading of an instance's layout setting (LAYOUT-WEB W4 P1, design §7.2
// A), and the check every layout passes before the site renders with it.
// Server-only: it reaches `node:fs` and produce-core's builder. The pure half
// (the built-ins, the name map, the placement rule) is `index.ts`.
//
// THE CHECK IS THE BUILDER'S (`layout-check.ts`, re-exported here): a layout
// is accepted exactly when produce-core's `buildLayoutNode` accepts it.
//
// THE THREE FORMS, read like the model catalog's two (`src/lib/model-resolver.ts`):
//   ANSWER_LAYOUT       — the layout as a JSON document in the variable itself;
//   ANSWER_LAYOUT_PATH  — a path to the same JSON document on disk;
//   ANSWER_LAYOUT_URL   — a published layout node (W4 P2): the URL of a node
//     document, the §9.4 view with the package inline that
//     `scripts/publish-layout.ts` writes. It is fetched and verified once per
//     process (`node-reading.ts`), at module load below, so the root layout's
//     synchronous call finds it read; a node that fails is refused with the
//     verifier's status, never replaced by the built-in.
// Unset (or empty, or whitespace only) is absent. Absent: the built-in default.
// Both document forms set, or the URL beside either: refused, as the catalog
// refuses both of its forms.
// A document that is not JSON, or that the builder refuses: refused, naming the
// form and carrying the builder's message.
//
// THE ENVIRONMENT IS READ IN ONE PLACE: `instanceAnswerLayouts()`, by literal
// name, which the root layout calls for every page (`src/app/layout.tsx`).
// `resolveAnswerLayouts` takes the three values as given, so it is driven with
// any values without touching the process's environment. The three are
// declared in ENV_SPEC (`scripts/preflight-env.mjs`) as read at build and at
// run time: the home page is prerendered, so it bakes what `next build` saw,
// and a malformed setting fails the build there; request-time pages read the
// running server's, and a malformed setting refuses each of them.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import { readFileSync } from 'node:fs';
import type { LayoutPayload } from '@typedstandards/produce-core';
import { BUILT_IN_INSTANCE_LAYOUTS, BUILT_IN_LAYOUTS, layoutId, unknownPartNames, type InstanceLayouts } from './index.ts';
import { AnswerLayoutConfigurationError, checkLayout } from './layout-check.ts';
import { checkNoTwins, committedLayoutNodes } from './held.ts';
import { readLayoutUrlOnce, settledLayoutUrlReading, urlReadingError, type HeldLayoutNode, type LayoutNodeReading } from './node-reading.ts';

export { AnswerLayoutConfigurationError, checkLayout };

export const LAYOUT_ENV = 'ANSWER_LAYOUT';
export const LAYOUT_PATH_ENV = 'ANSWER_LAYOUT_PATH';
export const LAYOUT_URL_ENV = 'ANSWER_LAYOUT_URL';

/** The three settings' values, as read: `undefined` or blank is absent. */
export interface AnswerLayoutSetting {
  inline?: string;
  path?: string;
  url?: string;
}

/** What the reading resolved, and the names in a configured layout the renderer does not know. */
export interface AnswerLayoutReading extends InstanceLayouts {
  unknownParts: string[];
}

function present(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readLayoutFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // The path is not echoed: this message reaches server logs, and the operator knows what they set.
    throw new AnswerLayoutConfigurationError(
      `${LAYOUT_PATH_ENV} names a file this server cannot read. ` +
        'Check that the path is correct, that the file exists, and that the server process can read it; then restart the server.',
    );
  }
}

/** What the reading may be handed instead of reading for itself, so it is driven without a network or a build. */
export interface AnswerLayoutReadingOptions {
  readFile?: (path: string) => string;
  warn?: (line: string) => void;
  /** The URL node's reading, when the setting names a URL. Absent: the one this process has finished, if any. */
  urlReading?: LayoutNodeReading;
  /** The committed nodes. Absent: this build's. */
  committed?: readonly HeldLayoutNode[];
}

/**
 * The instance's layouts from its setting. Absent: the built-ins, `answer-first`
 * the default. A configured layout (a document, or the node a URL names) is the
 * default and is offered first, beside the built-ins; one that repeats a
 * built-in's name and version is that built-in when its fields are the same,
 * and is refused when they are not, since a reader's choice names a layout by
 * its name and version. The same holds against every node the site holds
 * (the committed nodes, and the URL node): two held layouts with one name and
 * version and different fields are refused.
 *
 * `warn` receives one line when a configured layout names a part the renderer
 * does not know (spec §8.14.4: not malformed; the part renders nothing).
 */
export function resolveAnswerLayouts(setting: AnswerLayoutSetting, options: AnswerLayoutReadingOptions = {}): AnswerLayoutReading {
  const inline = present(setting.inline);
  const path = present(setting.path);
  const url = present(setting.url);
  const committed = options.committed ?? committedLayoutNodes();
  const held = committed.map((n) => ({ source: `the committed layout node ${n.nodeId}`, layout: n.layout }));

  if (url !== undefined && (inline !== undefined || path !== undefined)) {
    throw new AnswerLayoutConfigurationError(
      `${LAYOUT_URL_ENV} is set beside ${inline !== undefined ? LAYOUT_ENV : LAYOUT_PATH_ENV}, and they are two ways to name the instance's layout. ` +
        'This is refused rather than resolved by precedence. Unset one of them and restart the server.',
    );
  }
  if (inline !== undefined && path !== undefined) {
    throw new AnswerLayoutConfigurationError(
      `${LAYOUT_ENV} and ${LAYOUT_PATH_ENV} are both set, and they are two ways to deliver the SAME layout. ` +
        'This is refused rather than resolved by precedence. Unset one of them and restart the server.',
    );
  }
  if (inline === undefined && path === undefined && url === undefined) {
    checkNoTwins(held);
    return { ...BUILT_IN_INSTANCE_LAYOUTS, unknownParts: [] };
  }

  let source: string;
  let configured: LayoutPayload;
  if (url !== undefined) {
    source = `${LAYOUT_URL_ENV} (the node it names)`;
    const reading = options.urlReading ?? settledLayoutUrlReading(url);
    if (reading === undefined) {
      throw new AnswerLayoutConfigurationError(
        `${LAYOUT_URL_ENV} is set to a URL this server has not read. The node is read once, when the server starts; restart the server to read it.`,
      );
    }
    if (!reading.ok) throw urlReadingError(LAYOUT_URL_ENV, reading);
    configured = reading.layout;
  } else {
    source = inline !== undefined ? LAYOUT_ENV : `${LAYOUT_PATH_ENV} (the file it names)`;
    const text = inline !== undefined ? inline : (options.readFile ?? readLayoutFile)(path as string);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AnswerLayoutConfigurationError(`${source} does not contain valid JSON. A layout is a JSON object of the seven §8.14.1 fields.`);
    }
    configured = checkLayout(parsed, source);
  }

  checkNoTwins([...held, { source, layout: configured }]);

  const unknownParts = unknownPartNames(configured);
  if (unknownParts.length > 0) {
    (options.warn ?? ((line: string) => console.warn(line)))(
      `[answer-layout] ${source} names ${unknownParts.length === 1 ? 'a part' : 'parts'} this renderer does not know, ` +
        `which render nothing: ${unknownParts.map((n) => JSON.stringify(n)).join(', ')}.`,
    );
  }

  const others = BUILT_IN_LAYOUTS.filter((l) => layoutId(l) !== layoutId(configured));
  return { default: configured, offered: [configured, ...others], unknownParts };
}

let cached: { key: string; layouts: InstanceLayouts } | null = null;

/**
 * This instance's layouts, from its environment. Throws
 * `AnswerLayoutConfigurationError` when the setting cannot be rendered with:
 * the page that reads it refuses, rather than falling back to the built-ins.
 * The result is kept for as long as the three values are unchanged, so the
 * unknown-part line is logged once per setting, not once per request.
 */
export function instanceAnswerLayouts(): InstanceLayouts {
  const setting: AnswerLayoutSetting = {
    inline: process.env.ANSWER_LAYOUT,
    path: process.env.ANSWER_LAYOUT_PATH,
    url: process.env.ANSWER_LAYOUT_URL,
  };
  const key = JSON.stringify([setting.inline ?? null, setting.path ?? null, setting.url ?? null]);
  if (cached === null || cached.key !== key) {
    const reading = resolveAnswerLayouts(setting);
    cached = { key, layouts: { default: reading.default, offered: reading.offered } };
  }
  return cached.layouts;
}

// The URL form is read here, once, when this module loads (a top-level
// await): `next build` reads it before it prerenders a page, and a running
// server before its first request, so the synchronous call above finds the
// reading finished. A failed reading is kept, and every page then refuses with
// the verifier's status. The publish route reads through the same
// `readLayoutUrlOnce`, so a process fetches the URL once.
{
  const urlAtStart = present(process.env.ANSWER_LAYOUT_URL);
  if (urlAtStart !== undefined) await readLayoutUrlOnce(urlAtStart);
}
