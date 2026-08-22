import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// --- Enums ---

export const promptVisibilityEnum = pgEnum('prompt_visibility', [
  'full_text',
  'hash_only',
]);

export const verificationStatusEnum = pgEnum('verification_status', [
  'unverified',
  'consistency_tested',
  'evaluated',
  'fully_attested',
]);

export const consistencyClassificationEnum = pgEnum('consistency_classification', [
  'highly_reproducible',
  'moderately_stable',
  'inconsistent',
]);

// `expert_attestation` is a free-text review attached by a human domain
// expert (issue #53), signed by the instance that records it; reviews
// submitted before signing was enforced are labeled unsigned on the record.
// See `attestationPackages` below for the columns that carry the signature
// and for what a null one means. The term "attestation" carries formal
// AICPA Statements-on-Standards meaning in accounting / audit contexts;
// this implementation is not bound by those standards — it's a signed
// claim that something is true, in the broader tech sense (cryptographic
// attestation, hardware attestation). Future financial-auditor
// integrations may need to revisit this distinction.
export const attestationTypeEnum = pgEnum('attestation_type', [
  'consistency',
  'evaluation',
  're_evaluation',
  'correction',
  'expert_attestation',
]);

// captureMethod labels how the package contents were captured (ADR-0003).
// Describes *how* the content was captured — the integrity-of-pipeline
// property. Orthogonal to contentProfile (ADR-0004).
//
// `chat-flow-stream` — server captured bytes streaming to the browser.
// `claude-code-jsonl-readback` — Claude Code skill read each turn from
// the session JSONL, filtering to text-typed content blocks.
// `claude-code-self-report` — legacy: the publishing model paraphrased
// from in-context memory. Deprecated 2026-04-28; retained so pre-ADR
// records can be labeled with their actual capture method rather than
// silently re-described.
// `datHere` — UNUSED. Added by migration 0008 when datHere was framed
// as a captureMethod variant; the 2026-05-19 reframe (ADR-0004 status
// note) moved datHere to a separate `content_profile` column. The enum
// value remains in the Postgres type because `ALTER TYPE DROP VALUE` is
// non-trivial and the value carries no production data. Route validation
// rejects this value at the API layer; new publishes never reach the DB
// with captureMethod='datHere'.
export const captureMethodEnum = pgEnum('capture_method', [
  'chat-flow-stream',
  'claude-code-jsonl-readback',
  'claude-code-self-report',
  'datHere',
]);

// contentProfile labels the content shape of the package (ADR-0004).
// Describes *what shape* the content is in — orthogonal to captureMethod.
//
// `default` — legacy / default content shape. Equivalent to the column
// being NULL on legacy rows (the route layer never writes 'default'
// explicitly; absence is treated as default by surfaces).
// `datHere` — A-G envelope content profile per spec §8.7, with a
// deterministic Jupyter notebook in section E reproducing the rendered
// answer (F). When set, the packager promotes `summary` into canonical
// JSON and auto-emits the `org.civicaitools.environment` extension.
export const contentProfileEnum = pgEnum('content_profile', [
  'default',
  'datHere',
]);

// visibility mirrors the package's lifecycle visibility for query convenience
// (list filtering, dashboard labels). The CANONICAL representation is the
// attestation chain (spec §8.10, ADR-0010): a node is public iff an
// `attestation/publishes/v1` (+ ≥1 `attestation/locatedAt/v1`) references it;
// sealed = zero-location base case. This column is a denormalized status
// mirror in the same pattern as the withdrawn/reinstated columns — the publish
// flow dual-writes it alongside emitting the signed attestation pair. Legacy
// rows backfill to the public state (every pre-Phase-2 publish was public).
//
// ADR-0016 §A renames the two STATE labels — `committed` -> `sealed`,
// `published` -> `public` — while the verb "Publish", the cryptographic
// "commitment" noun, and `attestation/publishes/v1` all stay put. The rename
// ships as expand -> flip -> keep-the-dead-values, so the enum carries all four
// labels permanently.
//
// DEAD VALUES, DELIBERATELY RETAINED (sprint decision G0-3). `published` and
// `committed` are no longer WRITTEN by any code path — `toDbValue` in
// `src/lib/evidence/visibility.ts` is the identity, and the 0015 migration
// rewrites every existing row — but they stay declared here and in the live
// Postgres type. Dropping an enum value requires recreating the type (Postgres
// has no `ALTER TYPE ... DROP VALUE`), which means rewriting every dependent
// column under a lock; that rebuild was considered and DECLINED. Keeping the
// pair costs nothing and buys three things: every step of the rename stays
// reversible, every historical dump and restored backup remains loadable, and a
// downstream fork part-way through the migration keeps working. Reads must
// therefore treat all four labels as live forever — `fromDbValue` is total over
// them by design.
//
// Enum ORDER matches what `ALTER TYPE ... ADD VALUE` produced in migration
// 0014: the new labels append after the original two. It is the physical sort
// order of the type, not a statement about which are current.
//
// SCHEMA-VS-DATABASE ASYMMETRY ON THE DEFAULT. The declaration below says
// `'public'` as of this phase, but the DB-side `DEFAULT` moves in migration
// 0015 (`ALTER COLUMN visibility SET DEFAULT 'public'`), which the owner runs
// AFTER this code deploys. In the window between the two, the declaration and
// the live column disagree — harmlessly, because every INSERT this application
// makes supplies `visibility` explicitly (see `src/app/api/evidence/route.ts`),
// so the column default is never exercised by the write path. It matters only
// for hand-written SQL and for `drizzle-kit`'s diff.
export const visibilityEnum = pgEnum('visibility', [
  'published',
  'committed',
  'sealed',
  'public',
]);

// --- Tables ---

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  githubId: text('github_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  githubProfileUrl: text('github_profile_url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const evidenceRecords = pgTable('evidence_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  model: text('model').notNull(),
  promptHash: text('prompt_hash').notNull(),
  promptVisibility: promptVisibilityEnum('prompt_visibility')
    .notNull()
    .default('full_text'),
  promptText: text('prompt_text'),
  systemPromptHash: text('system_prompt_hash'),
  mcpServer: text('mcp_server'),
  jurisdiction: text('jurisdiction'),
  civicContext: text('civic_context'),
  basePackageHash: text('base_package_hash'),
  basePackageStorageKey: text('base_package_storage_key'),
  basePackageSignature: text('base_package_signature'),
  basePackageRfc3161Timestamp: text('base_package_rfc3161_timestamp'),
  basePackageRekorEntryId: text('base_package_rekor_entry_id'),
  basePackageRekorInclusionProof: text('base_package_rekor_inclusion_proof'),
  // The Rekor entry's canonical leaf bytes (its base64 `body`), captured at publish
  // so an independent verifier can recompute the RFC 6962 leaf and verify Merkle
  // inclusion OFFLINE — no re-fetch from Rekor, no civicaitools.org dependency
  // (civic-ai-tools-website#119 P1 / D2). Carried in the commitment as `rekorEntryBody`.
  basePackageRekorEntryBody: text('base_package_rekor_entry_body'),
  captureMethod: captureMethodEnum('capture_method'),
  contentProfile: contentProfileEnum('content_profile'),
  verificationStatus: verificationStatusEnum('verification_status')
    .notNull()
    .default('unverified'),
  consistencyClassification: consistencyClassificationEnum('consistency_classification'),
  // Host-display axis (ADR-0016 §A.1) — does this host index the record? A
  // SEPARATE dimension from `visibility` below, and orthogonal to it: the two
  // may legitimately disagree. Served as `listed` (canonical key) with
  // `isPublic` as a back-compat alias on `GET /api/evidence/[slug]`.
  isPublic: boolean('is_public').notNull().default(true),
  // Content-disclosure axis / visibility mirror (see visibilityEnum above).
  // Sealed records are creator-only on every content-bearing surface; their
  // commitment (hash, signature, timestamp, Rekor proof) stays publicly served,
  // redacted of content and location, via the commitment endpoint.
  visibility: visibilityEnum('visibility').notNull().default('public'),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  withdrawnReason: text('withdrawn_reason'),
  withdrawalSignature: text('withdrawal_signature'),
  withdrawalTimestamp: text('withdrawal_timestamp'),
  reinstatedAt: timestamp('reinstated_at', { withTimezone: true }),
  reinstatedReason: text('reinstated_reason'),
  reinstatementSignature: text('reinstatement_signature'),
  reinstatementTimestamp: text('reinstatement_timestamp'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  // Hash-addressable commitment lookup (`GET /api/evidence/<hash>/commitment`)
  // matches on `base_package_hash`; index it so the lookup is not a table scan.
  // Non-unique on purpose: a re-published package can share a base_package_hash
  // across rows (identical immutable blob, a separate signing run).
  basePackageHashIdx: index('evidence_records_base_package_hash_idx').on(
    table.basePackageHash,
  ),
}));

export const attestationPackages = pgTable('attestation_packages', {
  id: uuid('id').defaultRandom().primaryKey(),
  evidenceRecordId: uuid('evidence_record_id')
    .notNull()
    .references(() => evidenceRecords.id),
  type: attestationTypeEnum('type').notNull(),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => users.id),
  packageHash: text('package_hash').notNull(),
  storageKey: text('storage_key').notNull(),
  referencesBaseHash: text('references_base_hash').notNull(),
  // --- Signature columns (migration 0016) ------------------------------
  //
  // ALL NULLABLE, and deliberately so. This is an EXPAND migration: the write
  // path only began persisting a signature at 0016, so every row that already
  // existed when it ran is legitimately null in all five columns and stays
  // that way until the backfill. A NOT NULL column here would have required
  // inventing a value for rows whose signature was computed and discarded —
  // there is nothing honest to put there.
  //
  // A NULL `signature` therefore means one of TWO different things, and the
  // difference matters to a reader weighing the review:
  //
  //   * `unsigned_reason` IS NULL  — the row predates 0016. Nothing wrote the
  //     column because nothing was writing these columns at all.
  //   * `unsigned_reason` IS NOT NULL — the row was written by the current
  //     path on an instance with no signing key (ADR-0020 §B's intended
  //     unsigned tier), which recorded WHY it did not sign.
  //
  // That asymmetry is the whole discriminator: no date comparison can separate
  // the two honestly, since an instance may adopt a key at any time and the
  // rows carry no record of the instance's state when they were written. The
  // reading logic and the user-facing copy live together in
  // `evidence/trust-signal.ts` (`resolveReviewSignature`); the writing logic is
  // `evidence/attestation-signing.ts`.
  //
  // Signature envelope JSON — `{signature, publicKey, algorithm, kid}`,
  // matching how the publish route writes `base_package_signature`.
  signature: text('signature'),
  // The envelope's `kid`, duplicated into its own column so "which key signed
  // this" is queryable without extracting it from JSON.
  signingKeyId: text('signing_key_id'),
  // Base64 RFC 3161 token; null when the timestamp authority was unreachable.
  // Never a reason to refuse a submission — a signed, untimestamped review is
  // a legitimate state, and the third-party TSA's uptime is not this
  // instance's to guarantee.
  rfc3161Timestamp: text('rfc3161_timestamp'),
  // When the signature was produced. Null exactly when `signature` is null:
  // this column never claims a signing time for a row that has none.
  signedAt: timestamp('signed_at', { withTimezone: true }),
  // Why this row carries no signature, recorded at the moment that decision
  // was made — the only point at which the answer is actually knowable.
  //
  // CLOSED VOCABULARY. `text` at the database level, but the permitted values
  // are a closed, named set — not free-form text. The full vocabulary today:
  //
  //   'no_signing_key'  — the instance held no signing key when the review was
  //                       recorded (ADR-0020 §B, the intended unsigned tier).
  //                       This is the ONLY value any P1 code path writes.
  //
  // The set is declared ONCE, as `REVIEW_UNSIGNED_REASONS` in
  // `evidence/trust-signal.ts`, and mirrored there into
  // `REVIEW_UNSIGNED_REASON_STATUS` — a `Record<>` keyed by the vocabulary, so
  // a value with no rendering status is a build error rather than a row that
  // silently renders as something else. The write path types this column as
  // that union too, so it cannot emit a reason the read path has no copy for.
  // Adding a value (P2's backfill will need one for any row it cannot sign)
  // means appending in that one file; it needs no migration, and there is no
  // second list here to keep in sync — this comment names the vocabulary, and
  // `trust-signal.ts` defines it.
  //
  // A value this build does not recognize reads as the conservative unsigned
  // state and is NEVER relabeled as 'no_signing_key'.
  unsignedReason: text('unsigned_reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Signed `attestation/*` nodes (spec §8.10, §8.12; ADR-0010). Each row is a
// full signed envelope — its own nodeId (envelope hash), signature, timestamp,
// and Rekor proof — referencing a content node by `target_node_id`. PR3
// operationalizes the lifecycle sub-types (`attestation/withdraws/v1`,
// `attestation/reinstates/v1`); the `type` column + `payload` jsonb keep the
// table GENERAL so future sub-types (supersedes / publishes / locatedAt /
// corroborates / endorses / evaluates / certifies …) land here with no further
// migration (planning Q6). Distinct from `attestation_packages`, the pre-v0.1
// "comment on a package" feature that has no signature/type-URI/targetNodeId
// columns (see PR3 summary for the fold-in recommendation).
export const attestationNodes = pgTable('attestation_nodes', {
  // The attestation's own envelope hash (spec §8.2/§8.3.1) — its nodeId.
  nodeId: text('node_id').primaryKey(),
  // The content node this attestation references by nodeId (spec §8.12.1).
  targetNodeId: text('target_node_id').notNull(),
  // The attestation sub-type URI, e.g. `attestation/withdraws/v1`.
  type: text('type').notNull(),
  // Vercel Blob URL of the canonical attestation package JSON.
  storageKey: text('storage_key').notNull(),
  // Signature envelope JSON ({signature, publicKey, algorithm, kid}); null when
  // signing was unavailable at emit time (best-effort, like content packages).
  signature: text('signature'),
  rfc3161Timestamp: text('rfc3161_timestamp'),
  rekorEntryId: text('rekor_entry_id'),
  rekorInclusionProof: text('rekor_inclusion_proof'),
  // Envelope-side signer identity claim (spec §8.1.1 `signer`).
  signer: jsonb('signer'),
  // Sub-type-specific payload (lifecycle: reason / effectiveAt /
  // priorWithdrawalNodeId; future sub-types: their own fields). jsonb keeps
  // the table general across all attestation/* sub-types.
  payload: jsonb('payload'),
  // The human author who requested the attestation (route-level authz/audit).
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// OAuth 2.0 device authorization grant (RFC 8628). A client (Claude Code
// publish skill, CI job, etc.) creates a row with an opaque `device_code`
// and a short human-readable `user_code`. The human visits /auth/device
// while signed in, finds the row by `user_code`, and approves it; the
// client polls `/api/auth/device/token` with the `device_code` to mint a
// bearer token. Rows are single-use (`consumed_at`) and expire in ~15min.
export const deviceCodes = pgTable('device_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceCode: text('device_code').notNull().unique(),
  userCode: text('user_code').notNull().unique(),
  clientName: text('client_name').notNull(),
  scope: text('scope').notNull(),
  approvedUserId: uuid('approved_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Bearer tokens minted via the device flow. Stored as SHA-256 of the raw
// token so a DB compromise doesn't leak tokens. `token_prefix` is the
// first ~12 chars of the raw token (e.g. "evpub_XXXXXX") kept for UI
// identification — it's not secret on its own and can't be used to auth.
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  name: text('name').notNull(),
  scope: text('scope').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
