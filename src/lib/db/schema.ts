import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
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
// `chat-flow-stream` — server captured bytes streaming to the browser.
// `claude-code-jsonl-readback` — Claude Code skill read each turn from
// the session JSONL, filtering to text-typed content blocks.
// `claude-code-self-report` — legacy: the publishing model paraphrased
// from in-context memory. Deprecated 2026-04-28; retained so pre-ADR
// records can be labeled with their actual capture method rather than
// silently re-described.
export const captureMethodEnum = pgEnum('capture_method', [
  'chat-flow-stream',
  'claude-code-jsonl-readback',
  'claude-code-self-report',
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
  captureMethod: captureMethodEnum('capture_method'),
  verificationStatus: verificationStatusEnum('verification_status')
    .notNull()
    .default('unverified'),
  consistencyClassification: consistencyClassificationEnum('consistency_classification'),
  isPublic: boolean('is_public').notNull().default(true),
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
});

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
