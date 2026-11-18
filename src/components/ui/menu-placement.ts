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

/** The panel's tallest estimate per item before it renders, for the flip decision. */
const ITEM_HEIGHT_ESTIMATE = 40;
/** The least a capped panel is given, so a cramped window still shows a few rows (fix 2). */
export const MIN_CAP = 120;

/**
 * Which side an opening panel takes and how tall it may be (UX-2 P3b-2 fix 2), from the trigger's box (`top`,
 * `bottom`, as `getBoundingClientRect` reads them), the viewport's height, the sticky header's bottom edge and the
 * number of items. The panel opens up when the room below is short of what it wants and the room above is larger. The
 * cap is the room on the chosen side, less the panel's 4 px offset and an 8 px margin, measured above to the sticky
 * header's bottom, and floored at `MIN_CAP`. Every menu takes it, with a group or without (#790 item 8: a long menu
 * without one opened mid-screen ran under the header or past the window's bottom); `Menu` hands it to the stylesheet,
 * which composes it with each rule's own cap (`globals.css`, `--ui-menu-cap`).
 */
export function verticalPlacement(
  trigger: { top: number; bottom: number },
  viewportHeight: number,
  headerBottom: number,
  itemCount: number,
): { above: boolean; cap: number } {
  const below = viewportHeight - trigger.bottom;
  const wanted = Math.min(viewportHeight * 0.6, itemCount * ITEM_HEIGHT_ESTIMATE + 16);
  const above = below < wanted && trigger.top > below;
  const room = above ? trigger.top - Math.max(0, headerBottom) - 12 : below - 12;
  return { above, cap: Math.max(MIN_CAP, Math.floor(room)) };
}
