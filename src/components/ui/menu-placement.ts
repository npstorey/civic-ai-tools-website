// P2 · Menu's horizontal placement (UX-2 P4a, leg D): how far to move an open
// panel sideways so it lies inside the viewport.
//
// UX-2 P4a leg D red: a typed stub. The red commit carries this signature so
// the test type-checks and fails at its assertions; the fix fills it in.

/** The gap the panel keeps from the viewport's edges, in px. */
export const MENU_EDGE_MARGIN = 8;

/**
 * The sideways shift, in px, that puts an open panel's box (`left`, `right`, as
 * `getBoundingClientRect` reads them) inside a viewport `viewportWidth` wide,
 * `MENU_EDGE_MARGIN` from each edge; 0 when it already lies inside.
 */
export function horizontalShift(panel: { left: number; right: number }, viewportWidth: number): number {
  void panel;
  void viewportWidth;
  return 0;
}
