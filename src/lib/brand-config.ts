// --- Instance branding (chrome-only theming seam; #217) -------------------
//
// Every value that names or colors THIS deployment in the SITE CHROME — the
// header wordmark, page titles, the footer identity lines, the citation
// labels, and the accent-token override — resolves through the getters
// below. The demo defaults are the civicaitools.org reference deployment's
// historical hardcoded values, so with NO environment set the rendered
// chrome is byte-identical to before (the same byte-parity bar as
// site-config.ts).
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

/** Demo default site/brand display name — the header wordmark and title base. */
export const DEMO_BRAND_NAME = 'Civic AI Tools';

/** Demo default footer tagline. */
export const DEMO_BRAND_TAGLINE = 'Open-source tools for AI-powered civic data access';

/**
 * Display name of this instance in site chrome — the header wordmark, the
 * page `<title>`s, and the "… Evidence Package" citation labels.
 * Env: `SITE_BRAND_NAME`.
 */
export function getBrandName(): string {
  return process.env.SITE_BRAND_NAME || DEMO_BRAND_NAME;
}

/**
 * Footer tagline line (the first line of the footer identity block).
 * Env: `SITE_BRAND_TAGLINE`.
 */
export function getBrandTagline(): string {
  return process.env.SITE_BRAND_TAGLINE || DEMO_BRAND_TAGLINE;
}

/**
 * Footer attribution line, as plain text. Env: `SITE_BRAND_ATTRIBUTION`.
 *
 * `null` (unset) means "render the demo deployment's authored attribution
 * markup" — that line carries a hyperlink, so it lives as JSX in the root
 * layout rather than as a string default here. A configured instance
 * replaces the whole line with its own plain-text attribution.
 */
export function getBrandAttribution(): string | null {
  return process.env.SITE_BRAND_ATTRIBUTION || null;
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
