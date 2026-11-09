// P2 · Menu's horizontal placement (UX-2 P4a, leg D): how far to move an open
// panel sideways so it lies inside the viewport. `align` says where a panel
// starts (its left edge at the trigger's, or its right edge at the trigger's);
// this says how far it then moves. A pure function of the panel's box and the
// viewport's width, so the runner can drive it (`menu-placement.test.ts`);
// `Menu` reads the box from the open panel before it paints.

/** The gap the panel keeps from the viewport's edges, in px. */
export const MENU_EDGE_MARGIN = 8;

/**
 * The sideways shift, in px, that puts an open panel's box (`left`, `right`, as
 * `getBoundingClientRect` reads them) inside a viewport `viewportWidth` wide,
 * `MENU_EDGE_MARGIN` from each edge; 0 when it already lies inside. A panel
 * wider than the room keeps its left edge, where its items start, in view.
 */
export function horizontalShift(panel: { left: number; right: number }, viewportWidth: number): number {
  const min = MENU_EDGE_MARGIN;
  const max = viewportWidth - MENU_EDGE_MARGIN;
  if (panel.left < min) return min - panel.left;
  if (panel.right > max) return Math.max(max - panel.right, min - panel.left);
  return 0;
}
