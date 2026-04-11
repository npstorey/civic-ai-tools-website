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

export const attestationTypeEnum = pgEnum('attestation_type', [
  'consistency',
  'evaluation',
  're_evaluation',
  'correction',
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
  verificationStatus: verificationStatusEnum('verification_status')
    .notNull()
    .default('unverified'),
  consistencyClassification: consistencyClassificationEnum('consistency_classification'),
  isPublic: boolean('is_public').notNull().default(true),
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
