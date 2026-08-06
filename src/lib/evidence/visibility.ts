// Visibility vocabulary boundary (ADR-0016 Decision A).
//
// ADR-0016 §A renames the two `visibility` STATE labels: the not-yet-disclosed
// state `committed` -> `sealed`, and the disclosed state `published` ->
// `public`. Deliberately NOT renamed by that ADR: the verb "Publish", the
// cryptographic "commitment" noun (the `/commitment` endpoint, the commitment
// view, the commitment bundle), and the `attestation/publishes/v1` sub-type.
// Only the state label moves; the state MEANINGS are unchanged.
//
// ---------------------------------------------------------------------------
// MIGRATION STRATEGY — expand, then flip, then keep the dead values
// ---------------------------------------------------------------------------
//
//   M1  EXPAND   `ALTER TYPE visibility ADD VALUE 'sealed' / 'public'`
//                (drizzle/0014_add_sealed_public_visibility.sql). The enum then
//                carries all four labels. No row changes; no behavior changes.
//
//   M2  FLIP     Rewrite the rows onto the new labels and move the column
//                default. Only after this does the database hold any
//                new-vocabulary row. Paired with the code-side flip of
//                `toDbValue` below.
//
//   ---  KEEP    The legacy labels `committed` / `published` are NEVER dropped.
//                Postgres cannot remove an enum value without recreating the
//                type, and leaving them in place costs nothing while keeping
//                every step reversible, every historical dump readable, and
//                every already-shipped client's request body valid.
//
// ---------------------------------------------------------------------------
// THE TWO DIRECTIONS ARE ASYMMETRIC — that asymmetry is the point
// ---------------------------------------------------------------------------
//
//   `fromDbValue` is PERMANENTLY total over all four labels. A row that was
//   written before the flip keeps its legacy label forever, and the flip is not
//   the only way a legacy label reaches this process: a restored backup, a
//   downstream fork part-way through the migration, or a replica that has not
//   run M2 all serve legacy labels. Reading must never assume the flip ran.
//
//   `toDbValue` is the SINGLE place that decides what gets WRITTEN. It is
//   phase-gated (see its comment) so the flip is a one-line change instead of a
//   second sweep across every write site.
//
// Read sites therefore normalize through `fromDbValue` / `normalizeVisibility`
// and branch on the canonical vocabulary; write sites go through `toDbValue`.
// No call site outside this module should compare a `visibility` value against
// a raw string literal.

/**
 * The canonical, internal visibility vocabulary (ADR-0016 §A). Every branch in
 * application code is keyed on THIS type — never on a raw DB label.
 *
 * - `sealed` — signed + RFC 3161-timestamped + transparency-log-logged; content
 *   creator-only / unlisted / at a non-derivable key.
 * - `public` — carries the `attestation/publishes/v1` + `attestation/locatedAt/v1`
 *   pair; content served and listed.
 */
export type Visibility = 'sealed' | 'public';

/**
 * Every label the `visibility` Postgres enum can hold across the migration
 * window: the two legacy labels plus the two ADR-0016 labels. The legacy pair
 * is never dropped, so this union is the permanent shape of the column — not a
 * transitional one.
 */
export type VisibilityDbValue = 'published' | 'committed' | 'sealed' | 'public';

/** DB labels that denote the SEALED state. Legacy first, matching enum order. */
export const SEALED_DB_VALUES = ['committed', 'sealed'] as const satisfies readonly VisibilityDbValue[];

/** DB labels that denote the PUBLIC state. Legacy first, matching enum order. */
export const PUBLIC_DB_VALUES = ['published', 'public'] as const satisfies readonly VisibilityDbValue[];

/**
 * Every literal the API boundary accepts for `visibility`, in the order the
 * validation error lists them. Both vocabularies are accepted indefinitely
 * (ADR-0016 §A back-compat SHOULD: already-shipped clients and the published
 * skill keep sending the legacy labels).
 */
export const ACCEPTED_VISIBILITY_INPUTS = [
  'sealed',
  'public',
  'committed',
  'published',
] as const satisfies readonly VisibilityDbValue[];

/**
 * Normalize a DB label to the canonical vocabulary. Total over all four labels
 * and permanently so — see the asymmetry note above.
 *
 * The column is a `NOT NULL` enum, so the input domain is closed and the
 * `default` branch is unreachable through the ORM. It throws rather than
 * coercing anyway: a value outside the enum means the schema declaration and
 * the database have diverged, and silently treating an unknown label as
 * `public` would disclose content the row never authorized.
 */
export function fromDbValue(value: VisibilityDbValue): Visibility {
  switch (value) {
    case 'sealed':
    case 'committed':
      return 'sealed';
    case 'public':
    case 'published':
      return 'public';
    default: {
      const unexpected: never = value;
      throw new Error(`Unrecognized visibility value: ${String(unexpected)}`);
    }
  }
}

/**
 * Does this DB label denote the sealed (not-yet-disclosed) state, under either
 * vocabulary? This is the exact predicate the creator-only read gate keys on
 * (`isSealedRecord` in `sealed-access.ts`), named here so it is
 * directly exercisable — that module cannot be loaded by the test runner,
 * which resolves no path aliases.
 */
export function isSealedDbValue(value: VisibilityDbValue): boolean {
  return fromDbValue(value) === 'sealed';
}

/**
 * ============================ THE FLIP POINT ============================
 *
 * PHASE P1 (this phase): returns the LEGACY label. The application continues
 * to WRITE exactly what it writes today (`sealed` -> `'committed'`,
 * `public` -> `'published'`), which is what makes P1's merge behaviorally
 * inert — the new labels do not yet exist in the database.
 *
 * PHASE P2 (after the owner-run M1 expand migration lands): this function
 * becomes the identity — `sealed` -> `'sealed'`, `public` -> `'public'` — and
 * that is the ENTIRE code-side flip. Nothing else has to change, because no
 * other module decides what a write puts in the column.
 *
 * =======================================================================
 */
export function toDbValue(value: Visibility): VisibilityDbValue {
  return value === 'sealed' ? 'committed' : 'published';
}

/**
 * Boundary normalizer: accepts any of the four labels (either vocabulary) from
 * an untrusted source — a request body, or a JSON response being read by a
 * client component — and returns the canonical value, or `null` for anything
 * else. Callers turn `null` into their own rejection (a 400 listing
 * `ACCEPTED_VISIBILITY_INPUTS`, or a safe default).
 *
 * Deliberately non-throwing and `unknown`-typed: unlike `fromDbValue`, whose
 * domain is closed by the enum, this one's domain is whatever a caller sent.
 */
export function normalizeVisibility(value: unknown): Visibility | null {
  if (typeof value !== 'string') return null;
  if ((SEALED_DB_VALUES as readonly string[]).includes(value)) return 'sealed';
  if ((PUBLIC_DB_VALUES as readonly string[]).includes(value)) return 'public';
  return null;
}
