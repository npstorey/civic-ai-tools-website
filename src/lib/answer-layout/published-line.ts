// The foot line when a record's publication attestation names a layout
// (LAYOUT-WEB W4 P2, design §7.3, the amendment's (b)). Pure, and safe for a
// client component to import: the view compares against the layout it is
// actually showing, so the line follows the reader's toggle.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import { layoutId, layoutLine, type LayoutPayload } from './index.ts';

/**
 * The layout a record was published under, as the page found it: its name
 * and version when the site holds the node the attestation names, and
 * `held: false` when it does not. Absent when the attestation names none.
 */
export type PublishedLayout = { held: true; name: string; version: number } | { held: false };

/** The sentence added when the site does not hold the layout a record was published under. */
export const NOT_HELD_SENTENCE = 'This site does not hold the layout this record was published under.';

/**
 * The foot line under `shown`, given the layout the record was published
 * under:
 *   - held, with another name or version: "Published under layout <name> v<N>;
 *     shown under layout <name> v<M>";
 *   - held with the same name and version, or none named: W4 P1's line;
 *   - not held: W4 P1's line, then a sentence saying so, never the
 *     "published under …; shown under …" form, which would imply a
 *     difference that may not exist.
 */
export function layoutFootLine(shown: Pick<LayoutPayload, 'name' | 'version'>, published?: PublishedLayout): string {
  if (published === undefined) return layoutLine(shown);
  if (!published.held) return `${layoutLine(shown)}. ${NOT_HELD_SENTENCE}`;
  if (layoutId(published) === layoutId(shown)) return layoutLine(shown);
  return `Published under layout ${published.name} v${published.version}; shown under layout ${shown.name} v${shown.version}`;
}
