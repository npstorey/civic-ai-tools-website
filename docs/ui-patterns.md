# UI patterns: the `ui-*` primitives

**Scope:** the nine shared primitives under `src/components/ui/`, their classes in `src/app/globals.css`,
and what each one replaces. This is the pattern list for the principles in
[`design-principles.md`](design-principles.md); read that first for any AI-output or attestation surface.
**Status:** the primitives exist (UX-1 P0). No page uses them yet; later phases convert the surfaces
named under "Replaces", one phase at a time.

## Rules every primitive follows

- **No built-in words.** Every visible or accessible string is a prop the caller supplies. The one
  exception is the close control of `Dialog` and `Sheet`, whose accessible name is "Close". Glyphs
  (the caret, the close ×, a signal's silhouette) are decorative and `aria-hidden`.
- **Tokens by name.** No hex in a component; colours, spacing and shadows come from `globals.css`. The
  status colours have `-rgb` twins (`--success-rgb`, `--caution-rgb`, `--error-rgb`, beside
  `--accent-rgb` and `--info-rgb`), so a wash is `rgba(var(--<token>-rgb), α)`;
  `src/app/token-rgb-twins.test.ts` holds each twin equal to its token. The two shadows are named:
  `--shadow-menu` (`0 4px 12px rgba(0, 0, 0, 0.1)`) and `--shadow-dialog`
  (`0 20px 60px rgba(0, 0, 0, 0.3)`). The existing literal sites of both are not yet moved.
- **Every class is written in full.** A primitive chooses classes from a table of literal names and
  never builds one from a template. `src/app/ui-class-names.test.ts` reads the primitives' string
  literals and fails on a `ui-*` class with no selector, and on a template that builds one.
- **Light mode only.** 12 px paddings are literals until the design system rules on a token.
- **Tests.** Each primitive has a fixture test beside it (`<Name>.test.ts`) that renders every state
  below on the surface harness. The harness has no layout, focus or browser events, so keyboard,
  focus and pointer behaviour is implemented but not asserted there.

## The nine

### P1 · Disclosure (`ui-disclosure`)

- **Element:** a native `<details>` with `ui-disclosure-summary` and `ui-disclosure-body`.
- **Sizes:**
  - `inline` (`ui-disclosure--inline`): 13 px, a line under a paragraph;
  - `section` (`ui-disclosure--section`, the default): 14 px 500, an 8 px pad and a 1 px top rule;
  - `row` (`ui-disclosure--row`): 12 px, inside a row.
- **States:** closed and open. It has no disabled state: a disclosure with nothing to show is not
  rendered. `open` may be controlled for a group that auto-expands. `ui-disclosure--destination`
  paints the summary `--accent` only when the page told the reader to look for it.
- **Rule:** it only shows. It never changes behaviour or state; that belongs to a Menu or a Sheet.
- **Replaces:**
  - the gear toggle region (`QueryForm.tsx`);
  - "Show details / Hide details" (`AttestationSection.tsx`);
  - the narration explainer (`NarrationExplainer.tsx`);
  - "How was the AI guided?" (`SkillPromptDisclosure.tsx`);
  - "Show all steps" (`ProgressLog.tsx`);
  - `ToolCallCard`'s header toggle;
  - "Show Filters" (×2);
  - the mobile comparison card (`ComparisonDisplay.tsx`);
  - the roadmap's dual TOC (`RoadmapBody.tsx`);
  - the provenance graph "Expand".

  Every native `<details>` already in use stays, restyled.

### P2 · Menu (`ui-menu`)

- **Trigger:** `ui-menu-trigger`, a `<button>` with `aria-haspopup="menu"` and `aria-expanded`.
  Sizes:
  - `icon` (`ui-menu-trigger--icon`): a 32 px square;
  - `label` (`ui-menu-trigger--label`): text plus a caret;
  - `field` (`ui-menu-trigger--field`, root `ui-menu--field`): a full-width current-value button.
- **Panel:** `ui-menu-panel`, `role="menu"`, 220-360 px wide, at most 60vh tall with its own scroll,
  with `--shadow-menu`. `ui-menu-panel--end` anchors it at the trigger's end edge; `ui-menu-panel--up`
  flips it above the trigger when the room below is short (measured when the trigger opens it).
- **Items:** `ui-menu-item`, a `menuitem`, or a `menuitemradio` with `aria-checked` in a radio menu.
  An item with an `href` is a link.
- **States:**
  - trigger: idle, hover, open, disabled;
  - item: idle, hover (`--card-background`), selected (`--text-primary` 600), and
    disabled-with-reason (`aria-disabled`, with the reason as a second line, `ui-menu-item-reason`).
- **Behaviour:**
  - Escape closes the menu and returns focus to the trigger;
  - an outside click closes it;
  - the arrow keys, Home and End move among the enabled items;
  - Enter selects an item, then focus returns to the trigger;
  - Tab closes it.
- **Not in this phase:** submenus. A later phase extends the contract for the model picker.
- **Replaces:** the three Header dropdowns, the model and portal pickers (`QueryForm.tsx`), both
  `FilterDropdown`s (`DirectoryClient.tsx`, `PortalDirectoryClient.tsx`), and the avatar menu.
- **New uses:** the composer's "+" and settings.

### P3 · Sheet (`ui-sheet`)

- **Placement:** a side panel at 900 px and wider (420 px, full height); below 900 px, a bottom sheet
  (up to 85vh). It sits over a `ui-backdrop` (`rgba(0, 0, 0, 0.5)`) and uses `--shadow-dialog`.
- **Regions** (each a `data-part`):
  - `header` (`ui-sheet-header`): the title (`ui-sheet-title`, 18 px display font) and the close
    control (`ui-close`);
  - `body` (`ui-sheet-body`): the only region that scrolls;
  - `footer` (`ui-sheet-footer`): a sibling of the body, never inside it. It carries one primary
    action (`ui-action ui-action--primary`), or a status line (`ui-sheet-footer-line`,
    `role="status"`) when changes apply immediately.
- **States:** closed (renders nothing), open, and busy. Busy means `aria-busy`, an inert body, the
  action disabled with a spinner (`ui-spinner`), and the close control disabled.
- **Behaviour:** `role="dialog"` with `aria-modal` and `aria-labelledby` (the title). Opening focuses
  the first control and a focus trap holds it there. Escape and a backdrop click close the sheet
  unless it is busy, and focus returns where it was.
- **Uses:** the Sources panel, the add-review flow, the per-source sign-in step, the mobile navigation
  drawer.
- **Replaces:** the inline Sources `<details>` mounts (`QueryForm.tsx`, `TraceControls.tsx`) and the
  inline mobile menu (`Header.tsx`).

### P4 · Dialog (`ui-dialog`)

- **Placement:** a centred modal over `ui-backdrop ui-backdrop--center`, with `--shadow-dialog`, at
  most 90vh tall.
- **Sizes:** `short` (`ui-dialog--short`, max 480 px) and `form` (`ui-dialog--form`, max 520 px, the
  default).
- **Regions** (each a `data-part`):
  - `header` (`ui-dialog-header`): the title (`ui-dialog-title`, 18 px) and the close control
    (`ui-close`);
  - `body` (`ui-dialog-body`): the only region that scrolls;
  - `footer` (`ui-dialog-footer`): outside the scroll, a sibling of the body. It carries the primary
    action (`ui-action--primary`, `--accent` on `--white`, 0.5 opacity when disabled), an optional
    secondary action (`ui-action--secondary`), and the one-line consequence or disabled reason
    (`ui-dialog-footer-line`).
- **States:** `form`, `busy`, `success`, `error` (as `data-state`). Busy means `aria-busy`, an inert
  body, the actions disabled, a spinner on the primary action, and the close control disabled.
- **Behaviour:** `role="dialog"` with `aria-modal` and `aria-labelledby` (the title), and a focus trap.
  Escape closes it, and so does a backdrop click unless it is busy; focus returns where it was.
- **Replaces:** `PublishEvidenceDialog` (its action is today inside the scroll), `AttestationDialog`'s
  modal, the dashboard's four overlays (`DashboardTabs.tsx`), and the Cite modal in `EvidenceActions`.

### P5 · Card (`ui-card`)

- **Variants:**
  - `plain` (`ui-card--plain`): `--white`, border `--border-color`;
  - `tinted` (`ui-card--tinted`): a wash by tone through the tone's `-rgb` twin;
  - `selectable` (`ui-card--selectable`): a radio or link card, 1.5 px border, focus ring as
    `.ui-button`.
- **Tones** (`ui-card--tone-*`): `accent`, `info`, `caution`, `error`, `success`.
- **Sizes:** padding `--space-sm`, or 12 px with `compact` (`ui-card--compact`). Radius 6 px.
- **States:** idle; hover (selectable only); selected (`ui-card--selected`, a border in the tone's
  token); disabled-with-reason (`ui-card--disabled`, `aria-disabled`, with the reason as
  `ui-card-reason`).
- **Replaces:**
  - seven local cards: `ServerCard`, `AudienceCardTile`, `GroupCard`, `AttestationCard`, `MetricCard`,
    `ConsentCard`'s box, `ToolCallCard`'s box;
  - the record page's three banners;
  - the first-run box (`ask/page.tsx`);
  - the signed-out dashed box in Advanced options (`QueryForm.tsx`);
  - the rating cards in the review form (`AttestationDialog.tsx`).

### P6 · Signal row (`ui-signal`)

- **Anatomy:**
  - a decorative glyph by silhouette (`ui-signal-glyph`, `aria-hidden`, with `data-glyph` naming it);
  - the caller's label (`ui-signal-label`), which carries the meaning;
  - an optional detail (`ui-signal-detail`);
  - an optional `inline` disclosure.
- **Tiers** (`ui-signal--*`; glyph and token, never colour alone):

  | Tier | Glyph | Token |
  |---|---|---|
  | `neutral` | dot | `--text-muted` |
  | `ok` | check | `--success` |
  | `caution` | triangle | `--caution` |
  | `problem` | cross | `--error` |
  | `info` | i | `--info` |

- **Sizes:** `line` (`ui-signal--line`, 13 px, the detail beside the label) and `block`
  (`ui-signal--block`, 14 px, the detail under it).
- **Rules:**
  - one row per axis, never a merged chip (Principle 7);
  - the label states a process, never a verdict (Principle 1);
  - absent signal, absent row (Principle 3);
  - a secondary axis renders in the `neutral` tier at `line` size, under the dominant split, never
    above it (Principle 4).
- **Reference implementation:** `src/components/evidence/TrustSignal.tsx` (tiers
  `verified | normal | attention | alarm`). It is live and is not replaced in this phase; whether it
  becomes `Signal` is a later phase's decision, and the tier words go through a research check first.
- **Replaces:** the three `StatusBadge`s, `TypeBadge` (`DashboardTabs.tsx`), the type and rating pills
  in `AttestationSection`, and the "Unverified" pill (`EvidenceIndex.tsx`).

### P7 · List row (`ui-row`)

- **Anatomy:**
  - title (`ui-row-title`, a link, 16 px display font);
  - summary (`ui-row-summary`, 14 px, clamped to two lines);
  - meta line (`ui-row-meta`, 12 px `--text-muted`, items `ui-row-meta-item` separated by CSS; date ·
    author · model display name, and the model stays, Principle 2);
  - a trailing column (`ui-row-trailing`) of `line` signals (`ui-row-signals`) and an optional `icon`
    menu (`ui-row-menu`);
  - an optional `row` disclosure.
- **Sizes:** `list` (`ui-row--list`: full width, 12 px vertical padding, a 1 px rule) and `card`
  (`ui-row--card`, carrying `ui-card ui-card--plain`, for grids). Below 640 px the trailing column
  wraps under the meta line.
- **States:** idle; hover (`--card-background`); withdrawn (`ui-row--withdrawn`: the title struck,
  the row at 0.65 opacity); selected (`ui-row--selected`, a focus ring).
- **Used by:** `/records`, My chats, Reviews I wrote, Activity, the directory's servers at narrow
  width, the "+" menu's source rows, the attestations list.
- **Replaces:** the registry row (`EvidenceIndex.tsx`), the dashboard record card, and the Evaluations
  and Activity cards (`DashboardTabs.tsx`).

### P8 · Tabs (`ui-tabs`)

- **Elements:** a `role="tablist"` (`ui-tabs`, named by the caller) of `role="tab"` buttons
  (`ui-tab`, `aria-selected`, a roving tabindex) and one `role="tabpanel"` (`ui-tabs-panel`),
  labelled by the selected tab.
- **Look:** the selected tab underlined 2 px `--accent`, text 14 px, in a flex row that wraps at narrow
  width. The count stays in each label, as today.
- **States:** idle; hover; selected; disabled-with-reason (`aria-disabled`, described by its reason,
  `ui-tab-reason`).
- **Behaviour:** the arrow keys, Home and End move among the enabled tabs and select them. The
  selection is the caller's, so a page that syncs it to `?tab=` keeps doing so.
- **Replaces:** `DirectoryWrapper`'s tab bar, `TraceControls`' mode tabs, `AttestationDialog`'s
  `TabButton`, and `DashboardTabs`' row.

### P9 · Page frame (`ui-page`)

- **Widths:**
  - `reading` (`ui-page--reading`, 720 px): about, learn, project, privacy, the roadmap body, device;
  - `record` (`ui-page--record`, 800 px): the records index, the record page, ask, dashboard;
  - `wide` (`ui-page--wide`, 1200 px): directory, explore, an answer with the comparison.

  The side gutter is 24 px, 16 px below 640.
- **Type:**
  - one `h1` (`ui-page-title`, 36 px at every width, as globals.css styles every `h1`);
  - one lede (`ui-page-lede`, 20 px `--text-secondary`);
  - one section heading (`PageSection`, `ui-page-section-heading`, 18 px 600).
- **Rhythm:** sections (`ui-page-section`) `--space-lg` apart, blocks `--space-sm`.
- **Chip row** (`ChipRow`, `ui-chip-row`): a named group of 13 px outlined buttons, 6 px apart, that
  scrolls sideways (`overflow-x: auto`) and never wraps, with no "·" separators.
- **Not in this phase:** `PageToc`, the jump list rendered from the h2s when a page has more than five.
  A later phase builds it on this frame.
- **Replaces:** the seven page widths and the `h1` overrides on `/records`, `/auth/device` and the
  record page, and the example-chip row (`QueryForm.tsx`).

## Not primitives

The composer is one component, not a primitive. The consent card, the Sources panel and the pause card
are not primitives either: their words and order were ruled after research checks, so they move as
blocks.

## Not in this phase (UX-1 P0's non-goals)

- any page or component using the primitives;
- the neutral scale;
- a 12 px token;
- submenus in `Menu`;
- editing or replacing `TrustSignal.tsx` or any `StatusBadge`;
- `Signal`'s tier words;
- the `--op-*` twins;
- `PageToc`;
- any change to an existing selector, token or shadow site.
