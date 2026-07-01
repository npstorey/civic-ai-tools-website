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

// `expert_attestation` is a free-text, signed review attached by a
// human domain expert (issue #53). The term "attestation" carries formal
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
// `datHere` — A-G envelope content profile per OES §9.1, with a
// deterministic Jupyter notebook in section E reproducing the rendered
// answer (F). When set, the packager promotes `summary` into canonical
// JSON and auto-emits the `org.civicaitools.environment` extension.
export const contentProfileEnum = pgEnum('content_profile', [
  'default',
  'datHere',
]);

// visibility mirrors the package's lifecycle visibility for query convenience
// (list filtering, dashboard labels). The CANONICAL representation is the
// attestation chain (spec §8.10, ADR-0010): a node is published iff an
// `attestation/publishes/v1` (+ ≥1 `attestation/locatedAt/v1`) references it;
// committed = zero-location base case. This column is a denormalized status
// mirror in the same pattern as the withdrawn/reinstated columns — the publish
// flow dual-writes it alongside emitting the signed attestation pair. Legacy
// rows backfill to 'published' (every pre-Phase-2 publish was public).
export const visibilityEnum = pgEnum('visibility', [
  'published',
  'committed',
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
  isPublic: boolean('is_public').notNull().default(true),
  // Visibility mirror (see visibilityEnum above). 'committed' records are
  // creator-only on every content-bearing surface; their commitment (hash,
  // signature, timestamp, Rekor proof) stays publicly served, redacted of
  // content and location, via the commitment endpoint.
  visibility: visibilityEnum('visibility').notNull().default('published'),
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
