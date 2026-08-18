// --- Instance branding (chrome-only theming seam; #217) -------------------
//
// Every value that names or colors THIS deployment in the SITE CHROME — the
// header wordmark, page titles, the footer identity lines, the citation
// labels, and the accent-token override — resolves through the getters
// below.
//
// UNSET NAMES NOBODY (#259 P4, portability finding A3). These getters used
// to fall back to the civicaitools.org reference deployment's own strings,
// on a byte-parity argument: with nothing configured the chrome rendered
// exactly as it always had. That argument was written when the marketing
// face and the app were one deployment. Since #259 an instance that
// configures nothing serves the APP surface — so the fallback stopped being
// "this repo's historical chrome" and became "somebody else's name in an
// operator's header, page titles and citation text". A required prop cannot
// fix that on its own: it only pushes the substitution one level up if the
// resolver still answers with the reference name.
//
// So the nameable getters now return `null` when unset, and each surface
// renders honest absence — the `EVIDENCE_*` disposition in site-config.ts,
// applied to chrome. Titles drop their suffix, the footer tagline is
// omitted, citations say "Evidence Package" rather than naming a
// deployment, and the ONE surface that structurally needs a visible string
// (the header wordmark) falls back to `UNNAMED_WORDMARK` below, which is a
// navigation label rather than an identity claim. The reference deployment
// sets `SITE_BRAND_NAME` and `SITE_BRAND_TAGLINE` like any other instance.
//
// CHROME, NOT EVIDENCE. This module is deliberately separate from the
// `EVIDENCE_*` instance-identity set in src/lib/site-config.ts: those values
// are emitted INSIDE signed evidence artifacts and are cross-checked against
// the instance's trust registry (verify check #14). Nothing here is ever
// signed, verified, or emitted into a package — changing a `SITE_BRAND_*`
// variable can never invalidate an evidence surface. A fully renamed
// instance typically sets BOTH `SITE_BRAND_NAME` (chrome) and
// `EVIDENCE_PLATFORM_AGENT_TITLE` (evidence attribution); the two do not
// read each other on purpose, so neither can surprise the other.
//
// Values are read at CALL time (not module load) so tests can vary them
// per-process. On statically prerendered pages a call-time read still
// resolves during the build — the same seam behavior as
// `resolveHostLinks(process.env)` in the root layout. None of these may ever
// become `NEXT_PUBLIC_*`: build-time client inlining is exactly what breaks
// runtime container configuration (docs/deploy.md's build-time caveat).
//
// Client components cannot read these getters. The root layout threads the
// values instead: props where the layout renders the consumer directly
// (Header, the footer), context where the client boundary blocks a prop
// chain (components/BrandProvider.tsx) — the host-links precedent.

/**
 * What the header wordmark says on an instance that has not named itself.
 *
 * The wordmark is a link to the site root, and a link needs a label — it is
 * the only brand-name consumer with no honest empty rendering. "Home"
 * describes what the link DOES; it makes no claim about whose deployment
 * this is, which is the whole point. Every other consumer omits instead.
 */
export const UNNAMED_WORDMARK = 'Home';

/**
 * Display name of this instance in site chrome — the header wordmark, the
 * page `<title>`s, and the "… Evidence Package" citation labels.
 * Env: `SITE_BRAND_NAME`; `null` when unset (see the module note).
 */
export function getBrandName(): string | null {
  return process.env.SITE_BRAND_NAME || null;
}

/**
 * Footer tagline line (the first line of the footer identity block).
 * Env: `SITE_BRAND_TAGLINE`; `null` when unset — the footer omits the line.
 */
export function getBrandTagline(): string | null {
  return process.env.SITE_BRAND_TAGLINE || null;
}

/**
 * A page `<title>`, brand suffix included only when there is a brand.
 *
 * Every page in both route groups funnels through here so the unnamed case
 * is spelled once rather than ten times, and so no page can reintroduce a
 * `${page} - ${maybeNull}` template that renders the word "null" at an
 * instance that never named itself. `separator` exists because `/explore`
 * has always used a pipe; with `SITE_BRAND_NAME` set, every call site
 * produces the exact string it produced before.
 */
export function pageTitle(page: string, separator: string = '-'): string {
  const brand = getBrandName();
  return brand === null ? page : `${page} ${separator} ${brand}`;
}

/**
 * Footer attribution line, as plain text — who runs this deployment.
 * Env: `SITE_BRAND_ATTRIBUTION`; `null` when unset, and the footer then
 * renders NO attribution line at all.
 *
 * `null` used to mean "render the reference deployment's authored
 * attribution markup", which lived as JSX in the root layout because it
 * carries a hyperlink. That made the unset case a statement about a named
 * person on every instance's every surface, `(app)` included (#259 P4,
 * portability finding A2). The markup is gone; the reference deployment
 * sets this variable like any other instance, in exchange for the line
 * being plain text rather than linked.
 */
export function getBrandAttribution(): string | null {
  return process.env.SITE_BRAND_ATTRIBUTION || null;
}

/**
 * This instance's own source repository, linked as "GitHub" in the footer.
 * Env: `SITE_BRAND_REPO_URL`; `null` when unset, and the link is omitted.
 *
 * It was a hardcoded link to the reference project's hub repo (#259 P4,
 * finding D7). The footer renders on the `(app)` surfaces too, so every
 * instance — including one that ships no marketing site at all — carried a
 * contribution funnel into a repository its operator does not own and its
 * users have no reason to file against. There is no honest default for
 * "where does this deployment's source live", so unset renders nothing.
 */
export function getBrandRepoUrl(): string | null {
  return process.env.SITE_BRAND_REPO_URL || null;
}

/**
 * The resolved accent override: the four accent-family custom properties the
 * root layout writes onto `<html style=…>` when `SITE_BRAND_ACCENT` is set.
 * Property names match the neutral tokens in src/app/globals.css.
 */
export interface BrandAccent {
  /** The accent color itself (normalized `#rrggbb`) → `--accent`. */
  accent: string;
  /** Comma-separated channel triplet (`"r, g, b"`) → `--accent-rgb`,
   *  consumed as `rgba(var(--accent-rgb), α)` at the alpha call sites. */
  accentRgb: string;
  /** Derived darker companion for hover/active states → `--accent-hover`. */
  accentHover: string;
  /** Derived lighter companion for soft fills → `--accent-light`. */
  accentLight: string;
}

/**
 * Parse and derive the accent family from a raw `SITE_BRAND_ACCENT` value.
 * Pure — exported for tests.
 *
 * Accepts `#rgb` or `#rrggbb` (case-insensitive). Anything else returns
 * `null` — an invalid value must degrade to the stylesheet defaults, never
 * leak garbage into an inline style attribute.
 *
 * The hover/light companions are DERIVED (channel-scale toward black /
 * mix toward white) rather than independently configurable: one variable is
 * the whole theming story, and the pair can never drift out of step with the
 * accent. The derivation runs only for a CONFIGURED accent — the unset case
 * never reaches this code and keeps the stylesheet's authored values, so the
 * demo palette is not an output of these formulas.
 */
export function parseBrandAccent(raw: string | undefined): BrandAccent | null {
  if (!raw) return null;
  const m = /^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i.exec(raw.trim());
  if (!m) return null;
  const hex6 = m[2] ?? m[1]!.split('').map((c) => c + c).join('');
  const channels = [0, 2, 4].map((i) => parseInt(hex6.slice(i, i + 2), 16));
  const toHex = (values: number[]) =>
    '#' + values.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return {
    accent: toHex(channels),
    accentRgb: channels.join(', '),
    accentHover: toHex(channels.map((c) => c * 0.6)),
    accentLight: toHex(channels.map((c) => c * 0.25 + 255 * 0.75)),
  };
}

/**
 * Accent override for this instance, or `null` when `SITE_BRAND_ACCENT` is
 * unset or invalid — `null` means the root layout writes NO style attribute
 * and the stylesheet defaults render, a zero-byte delta.
 */
export function getBrandAccent(): BrandAccent | null {
  return parseBrandAccent(process.env.SITE_BRAND_ACCENT);
}
