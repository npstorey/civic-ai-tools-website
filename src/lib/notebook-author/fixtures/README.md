# `pre-stamp-package.json` — where these bytes came from

A record package whose notebook genuinely predates the notebook-provenance stamp
(#401). It exists so the "not stated" reading can be driven against an artifact
that really lacks the key, rather than against an object hand-written to omit it
— a fixture shaped so a criterion cannot fail is not a demonstration of it.

## Provenance of the bytes

`extensions["org.civicaitools.notebook"]` is the verbatim return value of
`generateNotebook` **at `7f52a6b`** — the commit this phase branched from, and
the last commit at which the skeleton generator stamped nothing. Produced by
calling it with the arguments the reading test restates, and no configured
instance identity (`{ origin: null, host: null, platformTitle: null }`), which
is what keeps the output free of an "on <date>" attribution line:

```ts
generateNotebook(
  'How many noise complaints were filed last year?',
  'data.cityofnewyork.us',
  [ /* three get_data calls: catalog, metadata, query — see the test */ ],
  'About 412,000 noise complaints were filed.',
  { origin: null, host: null, platformTitle: null },
);
```

The enclosing `{ extensions: { … } }` is the one package field the record page
reads (`renderPkg.extensions[NOTEBOOK_EXTENSION_KEY]` **is** the notebook), so
the fixture is walked by the test exactly as the page walks a stored package.
That envelope is a wrapper; the notebook inside it is the artifact under test.

## What keeps it honest

`notebook-provenance-reading.test.ts` re-derives today's generator output from
the same arguments and asserts that the two differ **only** by the stamp — same
`kernelspec`, same `language_info`, same cells once the generation date is
normalised. If that ever fails, this file is no longer "the same notebook,
before the stamp" and re-freezing it is the fix, not relaxing the assertion.

## Do not regenerate it to make a test pass

Stored package bytes are never regenerated in production — a published record
keeps the bytes it was signed over forever. That is precisely the situation this
fixture models, so it is frozen on purpose. Regenerating it against a later
commit would silently replace "a package that predates the field" with "a
package that carries it", which is the one thing it exists to not be.
