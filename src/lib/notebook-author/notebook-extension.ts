/**
 * The value a signed package carries under `extensions["org.civicaitools.notebook"]`
 * — the notebook, plus the verdict the validator returned on it (#400).
 *
 * THE DEFECT THIS CLOSES. `validateExecutedNotebook` ran, said no, and the
 * pipeline published anyway: the verdict was computed at
 * `api/query-notebook/route.ts`, emitted onto the wire as `validation`, and
 * dropped. The package then asserted a notebook that reproduces the analysis
 * while the one component that checked had found that it does not, and nothing
 * downstream could recover the fact. D1 was ruled **A** by the owner: the
 * package carries the verdict and the page states it. There is no publish gate
 * — disclosure, not validation (docs/design-principles.md Principle 1).
 *
 * WHERE THE VERDICT SITS, AND WHY NOT AT THE TOP LEVEL. Beside the notebook's
 * own provenance stamp, at
 * `metadata.extensions["org.civicaitools.notebook"].validation` — the address
 * #401 established for "what this notebook says about itself". The obvious
 * alternative, a top-level `validation` key sitting beside `cells`, was
 * measured and rejected: nbformat v4's root schema is closed
 * (`additionalProperties: false`, verified against nbformat 5.10.4), while
 * `metadata` is open (`additionalProperties: true`). A top-level key makes
 * every downloaded `.ipynb` fail `nbformat.validate` — and this extension IS
 * the download: `NotebookSection`'s button serialises it verbatim and
 * `/api/records/[slug]/bundle` serves it as `application/x-ipynb+json`. The
 * verdict would have cost the reader the artifact it is a verdict about.
 *
 * WHERE IT IS ATTACHED, AND WHY THERE. At the source — the route, immediately
 * after the validator returns — not at publish time. #400 is a defect of
 * TRANSPORT: the fact was known and then dropped by an intermediate. Attaching
 * it at the source means the notebook carries its own verdict through every hop
 * (wire → stream state → publish POST → package → storage → record page) and no
 * intermediate has to remember to forward it. `PublishEvidenceDialog` posts the
 * executed notebook verbatim, so the verdict reaches the package without the
 * dialog knowing verdicts exist.
 *
 * A SKELETON CARRIES NO VERDICT. Absent is absent (#401's rule, and D1's).
 * `validateNotebookProvenance` accepts only `"executed"`; the validator is for
 * executed notebooks and is never run on a skeleton, so there is no verdict to
 * carry and none may be invented. Called with no verdict this function returns
 * the notebook UNCHANGED — it never writes `ok: true`, which would assert a
 * check that never ran, and it never removes a verdict already present.
 *
 * BYTE IMPACT. The dathere content hash is `sha256(jcs(notebook))`
 * (`verify-core/canonicalization.js`), so a new package's content hash reflects
 * the added key. Stored packages are never re-emitted, so nothing published
 * changes. A notebook built without a verdict is byte-identical to today's.
 */
import { NOTEBOOK_EXTENSION_KEY } from './notebook-provenance-reading.ts';
import type { ValidationResult } from './validate.ts';

/**
 * What this function needs of its input, and no more.
 *
 * Deliberately looser than `Notebook`: the same shape has to survive being read
 * back out of stored package bytes that are never regenerated, and a producer
 * outside this repository may hand us a notebook missing fields our own type
 * requires. The generic parameter means a caller passing a `Notebook` gets a
 * `Notebook` back.
 */
export interface NotebookExtensionInput {
  metadata?: { extensions?: Record<string, unknown>; [key: string]: unknown };
}

/**
 * Build the value that goes under `extensions["org.civicaitools.notebook"]`.
 *
 * With a verdict: a copy of the notebook carrying it at
 * `metadata.extensions["org.civicaitools.notebook"].validation`, issues and
 * all — the object the validator returned, not a boolean and not a summary a
 * reader would have to recompute to trust.
 *
 * Without one: the notebook itself, unchanged and by reference. The input is
 * never mutated in either case; the executed notebook lives in React state on
 * the client and in the stream's closure on the server.
 */
export function buildNotebookExtension<T extends NotebookExtensionInput>(
  notebook: T,
  validation?: ValidationResult,
): T {
  if (validation === undefined) return notebook;

  const metadata = notebook.metadata ?? {};
  const extensions = metadata.extensions ?? {};
  const existing = extensions[NOTEBOOK_EXTENSION_KEY];
  const notebookExtension =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  // The cast is the price of the loose input type: the spread widens `metadata`
  // to the structural shape above, which is exactly `T`'s minus the fields the
  // spread preserves verbatim.
  return {
    ...notebook,
    metadata: {
      ...metadata,
      extensions: {
        ...extensions,
        [NOTEBOOK_EXTENSION_KEY]: { ...notebookExtension, validation },
      },
    },
  } as T;
}
