// The reading of an instance's layout setting (LAYOUT-WEB W4 P1, design §7.2
// A), and the check every layout passes before the site renders with it.
// Server-only: it reaches `node:fs` and produce-core's builder. The pure half
// (the built-ins, the name map, the placement rule) is `index.ts`.
//
// THE CHECK IS THE BUILDER'S. A layout is checked by building an unsigned
// `content/layout/v1` node from it with produce-core's `buildLayoutNode`, under
// fixed determinism inputs, so the site has no second parser: a layout the site
// accepts is one the builder accepts, its refusal message is the builder's, and
// the seven fields the site keeps are the ones the builder copied into the node.
//
// THE THREE FORMS, read like the model catalog's two (`src/lib/model-resolver.ts`):
//   ANSWER_LAYOUT       — the layout as a JSON document in the variable itself;
//   ANSWER_LAYOUT_PATH  — a path to the same JSON document on disk;
//   ANSWER_LAYOUT_URL   — a published layout node's package URL. Not read yet:
//     set, it is refused, so a URL never falls back silently to the built-in.
// Unset (or empty, or whitespace only) is absent. Absent: the built-in default.
// Both document forms set: refused, as the catalog refuses both of its forms.
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
import { buildLayoutNode, type LayoutPayload } from '@typedstandards/produce-core';
import { BUILT_IN_INSTANCE_LAYOUTS, BUILT_IN_LAYOUTS, layoutId, unknownPartNames, type InstanceLayouts } from './index.ts';

export const LAYOUT_ENV = 'ANSWER_LAYOUT';
export const LAYOUT_PATH_ENV = 'ANSWER_LAYOUT_PATH';
export const LAYOUT_URL_ENV = 'ANSWER_LAYOUT_URL';

/** The instance's layout setting is one the site cannot render with. */
export class AnswerLayoutConfigurationError extends Error {
  readonly code = 'answer_layout_invalid';
  constructor(message: string) {
    super(message);
    this.name = 'AnswerLayoutConfigurationError';
  }
}

/**
 * The fixed determinism inputs the check builds under. The node is never
 * signed, stored or shown: it exists so the builder can refuse a payload.
 */
const CHECK_INPUTS = {
  packageId: 'answer-layout-check',
  createdAt: '1970-01-01T00:00:00.000Z',
  signingKeyId: 'unsigned',
  signer: { bindingTier: 'pseudonymous', identifier: 'answer-layout-check', displayName: 'answer-layout-check' },
} as const;

/**
 * Checks `payload` by building an unsigned layout node from it, and returns
 * the seven fields the builder copied into the node. Throws
 * `AnswerLayoutConfigurationError` with `<source>: <the builder's message>`
 * when the builder refuses.
 */
export function checkLayout(payload: unknown, source: string): LayoutPayload {
  let node: LayoutPayload;
  try {
    ({ node } = buildLayoutNode({ ...(payload as object), ...CHECK_INPUTS } as Parameters<typeof buildLayoutNode>[0]));
  } catch (err) {
    throw new AnswerLayoutConfigurationError(`${source}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { name, version, appliesTo, order, disclosure, steps, rendererVersion } = node;
  return { name, version, appliesTo, order, disclosure, steps, rendererVersion };
}

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

const same = (a: LayoutPayload, b: LayoutPayload) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The instance's layouts from its setting. Absent: the built-ins, `answer-first`
 * the default. A configured layout is the default and is offered first, beside
 * the built-ins; one that repeats a built-in's name and version is that
 * built-in when its fields are the same, and is refused when they are not,
 * since a reader's choice names a layout by its name and version.
 *
 * `warn` receives one line when a configured layout names a part the renderer
 * does not know (spec §8.14.4: not malformed; the part renders nothing).
 */
export function resolveAnswerLayouts(
  setting: AnswerLayoutSetting,
  options: { readFile?: (path: string) => string; warn?: (line: string) => void } = {},
): AnswerLayoutReading {
  const inline = present(setting.inline);
  const path = present(setting.path);
  const url = present(setting.url);

  if (url !== undefined) {
    throw new AnswerLayoutConfigurationError(
      `${LAYOUT_URL_ENV} is set, and this version does not read it: the URL form, a published layout node, arrives with LAYOUT-WEB W4 P2. ` +
        `It is refused rather than ignored, so the instance never renders with a layout other than the one it names. ` +
        `Unset it, or deliver the layout in ${LAYOUT_ENV} or ${LAYOUT_PATH_ENV}, and restart the server.`,
    );
  }
  if (inline !== undefined && path !== undefined) {
    throw new AnswerLayoutConfigurationError(
      `${LAYOUT_ENV} and ${LAYOUT_PATH_ENV} are both set, and they are two ways to deliver the SAME layout. ` +
        'This is refused rather than resolved by precedence. Unset one of them and restart the server.',
    );
  }
  if (inline === undefined && path === undefined) return { ...BUILT_IN_INSTANCE_LAYOUTS, unknownParts: [] };

  const source = inline !== undefined ? LAYOUT_ENV : `${LAYOUT_PATH_ENV} (the file it names)`;
  const text = inline !== undefined ? inline : (options.readFile ?? readLayoutFile)(path as string);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AnswerLayoutConfigurationError(`${source} does not contain valid JSON. A layout is a JSON object of the seven §8.14.1 fields.`);
  }
  const configured = checkLayout(parsed, source);

  const twin = BUILT_IN_LAYOUTS.find((l) => layoutId(l) === layoutId(configured));
  if (twin !== undefined && !same(twin, configured)) {
    throw new AnswerLayoutConfigurationError(
      `${source}: the layout is named ${configured.name} v${configured.version}, a built-in's name and version, with different fields. ` +
        'Give it a name or a version of its own.',
    );
  }

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
