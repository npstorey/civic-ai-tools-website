// The check every layout passes before the site renders with it (LAYOUT-WEB
// W4 P1), in a module of its own since W4 P2 so the node reading
// (`node-reading.ts`) and the setting's reading (`reading.ts`) share it without
// importing each other. `reading.ts` re-exports both names.
//
// THE CHECK IS THE BUILDER'S. A layout is checked by building an unsigned
// `content/layout/v1` node from it with produce-core's `buildLayoutNode`, under
// fixed determinism inputs, so the site has no second parser: a layout the site
// accepts is one the builder accepts, its refusal message is the builder's, and
// the seven fields the site keeps are the ones the builder copied into the node.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import { buildLayoutNode, type LayoutPayload } from '@typedstandards/produce-core';

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

/** Two layouts carry the same seven fields. */
export const sameLayout = (a: LayoutPayload, b: LayoutPayload): boolean => JSON.stringify(a) === JSON.stringify(b);
