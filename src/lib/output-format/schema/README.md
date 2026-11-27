# The map schema copy

`squidmaps-map.d7cdb725.schema.json` is a copy of the map schema from the public repository
`squidmaps-io/squidmaps-map-spec`, at commit `d7cdb725e0e3ebbe0a8f5651c6f060dec5789ecc`. The plain map's tests
validate every map this site builds against it (`../plain-map.test.ts`, `src/app/api/output-format-map-driven.test.ts`).

`LICENSE.squidmaps` is that repository's `LICENSE` at the same commit, verbatim (MIT). It covers the schema copy beside
it; this repository's own `LICENSE` does not. `../schema-license.test.ts` fails if the notice is missing or changed.
