# Vendored typefaces

The two faces the site renders in, self-hosted so that `next build`
needs no network egress to `fonts.googleapis.com` (#225). They are
loaded by `src/app/layout.tsx` through `next/font/local` and exposed as
the `--font-space-grotesk` / `--font-noto-sans` CSS variables that
`src/app/globals.css` and the components consume.

## What is here

| File | Family | Weight | Bytes |
|------|--------|--------|-------|
| `space-grotesk-latin-500-normal.woff2` | Space Grotesk | 500 | 13,312 |
| `space-grotesk-latin-600-normal.woff2` | Space Grotesk | 600 | 13,284 |
| `space-grotesk-latin-700-normal.woff2` | Space Grotesk | 700 | 12,840 |
| `noto-sans-latin-400-normal.woff2` | Noto Sans | 400 | 13,120 |
| `noto-sans-latin-500-normal.woff2` | Noto Sans | 500 | 13,496 |
| `noto-sans-latin-600-normal.woff2` | Noto Sans | 600 | 13,496 |

Six files, 79,548 bytes (~78 KB) total. The weight sets are exactly the ones the
previous `next/font/google` call asked for — Space Grotesk 500/600/700
for headings and the wordmark, Noto Sans 400/500/600 for body copy — so
self-hosting changed no rendered weight. The `latin` subset matches the
previous `subsets: ['latin']`.

## Provenance and license

Both faces are **SIL Open Font License 1.1**. Full license texts:
`LICENSE-space-grotesk.txt` and `LICENSE-noto-sans.txt`.

- **Space Grotesk** — Copyright 2020 The Space Grotesk Project Authors
  (<https://github.com/floriankarsten/space-grotesk>). Upstream release
  `v22` via <https://github.com/google/fonts>.
- **Noto Sans** — Copyright 2022 The Noto Project Authors
  (<https://github.com/notofonts/latin-greek-cyrillic>). Upstream
  release `v42` via <https://github.com/google/fonts>.

The `.woff2` binaries were taken verbatim from the `@fontsource/*` npm
packages at version 5.3.0 (`@fontsource/space-grotesk`,
`@fontsource/noto-sans`), which repackage the Google Fonts builds — the
same subsetted binaries the site was fetching from
`fonts.googleapis.com` at build time before this change.

## Why vendored rather than an `@fontsource` dependency

`@fontsource/noto-sans` alone is a ~7 MB tarball: nine weights times two
styles times eight subsets, in both `.woff` and `.woff2`. We need three
of those files. Adding a runtime dependency of that size to pull ~40 KB
of bytes fails this repo's dependency-budget discipline (and would make
the font files an `npm ci` network dependency, trading one egress
requirement for another), and pointing
`next/font/local` at paths inside `node_modules/` is fragile across
installer layouts and adds a resolution step to the container build. Six
static files that will never change are cheaper to carry, cheaper to
audit, and inherited cleanly by a fork.

## Changing or adding a face

Add the `.woff2` here, add a `{ path, weight, style }` entry to the
matching `localFont()` call in `src/app/layout.tsx`, and record the
license and upstream release above. Do not add a weight that nothing
renders — an unused weight is bytes on every page load. Making the
typefaces an instance-configuration knob is tracked separately in #221;
this directory is the substrate that would extend.
