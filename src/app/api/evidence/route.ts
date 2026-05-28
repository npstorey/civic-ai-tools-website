import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { putPackage } from '@/lib/storage';
import { buildEvidencePackage, type PackageInput, type CaptureMethod, type ContentProfile, DEFAULT_CONTENT_TYPE } from '@/lib/evidence/packager';
import { hash } from '@/lib/evidence/trace';
import { signPackage, getRfc3161Timestamp, publishToRekor, getActiveSigner, type SignerIdentity } from '@/lib/evidence/signing';
import { captureVocabForProfile } from '@/lib/evidence/profiles';
import { type BlobRef } from '@/lib/evidence/blob-ref';
import { resolveRequestUser, hasScope } from '@/lib/api-auth';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Build a content-addressable slug: {title-slug}-{shortHash}
 * Uses the first 6 hex chars of the package SHA-256 hash for a compact
 * integrity signal. ~16.7M values per title make collisions negligible.
 */
function buildSlug(title: string, packageHash: string, chars: number = 6): string {
  return `${slugify(title)}-${packageHash.slice(0, chars)}`;
}

/**
 * Resolve a slug that doesn't collide with an existing record.
 * Starts with a 6-char hash suffix; falls back to 8 chars (and then 16)
 * on the extraordinarily unlikely chance of a collision for the same title.
 */
async function resolveSlug(title: string, packageHash: string): Promise<string> {
  for (const chars of [6, 8, 16]) {
    const slug = buildSlug(title, packageHash, chars);
    const existing = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.slug, slug))
      .limit(1);
    if (existing.length === 0) return slug;
  }
  // Fall through: use full hash (true collision would be cryptographically unbroken)
  return buildSlug(title, packageHash, 64);
}

// ADR-0004: contentProfile values. Orthogonal to captureMethod. Optional
// at the route layer; absence is equivalent to `'default'`.
const VALID_CONTENT_PROFILES: readonly ContentProfile[] = [
  'default',
  'datHere',
] as const;

interface PublishRequest {
  /** OTel trace OR a BlobRef. See `docs/api/evidence-publish.md` for the
   *  blob-reference contract. */
  trace: Record<string, unknown> | BlobRef;
  prompt: string;
  /** Assistant output text OR a BlobRef to the same. */
  output: string | BlobRef;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    resultSummary?: { rows: number; columns: number };
    duration_ms?: number;
    operationType?: string;
  }>;
  model: string;
  portal: string;
  tokenUsage: { promptTokens?: number; completionTokens?: number };
  duration_ms?: number;
  promptVisibility: 'full_text' | 'hash_only';
  title: string;
  summary: string;
  /** Capture-method label per ADR-0003. Required for all publishes; the
   *  route rejects requests that omit or misvalue this field. */
  captureMethod: CaptureMethod;
  /** Content-profile label per ADR-0004. Optional; absence is equivalent
   *  to `'default'`. When set to `'datHere'`, the route enforces additional
   *  constraints (full_text prompt visibility, non-empty summary) and the
   *  packager promotes `summary` into canonical JSON + auto-emits the
   *  `org.civicaitools.environment` extension. */
  contentProfile?: ContentProfile;
  /** Producer Profile label per ADR-0006 (spec §8.1.1). Optional; when
   *  omitted the packager auto-derives it for the datHere content profile.
   *  Must stay consistent with contentProfile (validated below). */
  producerProfile?: string;
  /** Node type per ADR-0009 (spec §8.1.1, §8.12). Optional; defaults to
   *  `content/analysis/v1`. This endpoint accepts only that value — other
   *  sub-types are emitted by their own routes / reserved. */
  type?: string;
  /** Envelope-side identity claim per ADR-0009 (spec §8.1.1, §8.5).
   *  Optional; the route default-fills it from the active signing key. */
  signer?: SignerIdentity;
  /** Optional override for the skill metadata that would otherwise be
   *  extracted from the trace. Required when `trace` is a BlobRef. */
  skillMetadataOverride?: {
    systemPromptHash?: string;
    mcpServerUrl?: string;
    skillText?: string | BlobRef;
  };
  extensions?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveRequestUser(request);
    if (!auth) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!hasScope(auth, 'evidence:publish')) {
      return NextResponse.json(
        { error: 'Token missing required scope: evidence:publish' },
        { status: 403 },
      );
    }
    const userId = auth.userId;

    const body: PublishRequest = await request.json();

    // Validate contentProfile (ADR-0004). Optional; absence is equivalent
    // to `'default'`. When set, must be a recognized value.
    if (body.contentProfile && !VALID_CONTENT_PROFILES.includes(body.contentProfile)) {
      return NextResponse.json(
        {
          error:
            'contentProfile, when provided, must be one of: default, datHere',
        },
        { status: 400 },
      );
    }

    // Validate producerProfile consistency (ADR-0006, spec §8.1.1). When a
    // producerProfile is supplied it MUST agree with contentProfile:
    // contentProfile === 'datHere' iff producerProfile begins with
    // 'ai-assisted-analysis/datHere'. When omitted, the packager
    // auto-derives a consistent value for the datHere profile.
    if (body.producerProfile) {
      const ppIsDatHere = body.producerProfile.startsWith('ai-assisted-analysis/datHere');
      const cpIsDatHere = body.contentProfile === 'datHere';
      if (ppIsDatHere !== cpIsDatHere) {
        return NextResponse.json(
          {
            error:
              'producerProfile and contentProfile are inconsistent: contentProfile "datHere" iff producerProfile begins with "ai-assisted-analysis/datHere".',
          },
          { status: 400 },
        );
      }
    }

    // Validate type (ADR-0009). The standard publish path produces
    // content/analysis/v1; attestation/* sub-types are emitted by their own
    // routes and typed-content sub-types are reserved (out of scope here).
    if (body.type && body.type !== DEFAULT_CONTENT_TYPE) {
      return NextResponse.json(
        { error: `type, when provided to this endpoint, must be "${DEFAULT_CONTENT_TYPE}".` },
        { status: 400 },
      );
    }

    // Validate captureMethod (ADR-0003/0011). Required for all publishes;
    // must be in the captureMethod vocabulary declared by the package's
    // Producer Profile (spec §8.6), resolved via the shared hardcoded
    // PROFILE_CAPTURE_VOCAB table. Resolve once here, never re-derive
    // downstream.
    const captureVocab = captureVocabForProfile(body.producerProfile, body.contentProfile);
    if (!body.captureMethod || !captureVocab || !captureVocab.includes(body.captureMethod)) {
      return NextResponse.json(
        {
          error:
            'captureMethod is required and must be one of the values declared by the producerProfile vocabulary (ai-assisted-analysis: chat-flow-stream, claude-code-jsonl-readback, claude-code-self-report).',
        },
        { status: 400 },
      );
    }

    // ADR-0004 §9.1.1: contentProfile=datHere requires full_text prompt
    // visibility (the A-G envelope needs section A readable) and a
    // non-empty summary (section G). Other content profiles don't require
    // either. captureMethod is orthogonal — chat-flow-stream, claude-code-
    // jsonl-readback, and claude-code-self-report can each have either
    // content profile.
    if (body.contentProfile === 'datHere') {
      if (body.promptVisibility !== 'full_text') {
        return NextResponse.json(
          {
            error:
              'contentProfile "datHere" requires promptVisibility "full_text" (OES §9.1.1 requirement 1).',
          },
          { status: 400 },
        );
      }
      if (!body.summary || body.summary.trim().length === 0) {
        return NextResponse.json(
          {
            error:
              'contentProfile "datHere" requires a non-empty summary (OES §9.1.1 requirement 6).',
          },
          { status: 400 },
        );
      }
    }

    // Build evidence package
    const packageInput: PackageInput = {
      trace: body.trace,
      prompt: body.prompt,
      output: body.output,
      toolCalls: body.toolCalls,
      model: body.model,
      portal: body.portal,
      tokenUsage: body.tokenUsage,
      duration_ms: body.duration_ms,
      promptVisibility: body.promptVisibility,
      title: body.title,
      summary: body.summary,
      captureMethod: body.captureMethod,
      contentProfile: body.contentProfile,
      // ADR-0006: pass through; the packager auto-derives for datHere when omitted.
      producerProfile: body.producerProfile,
      // ADR-0009: default-fill the standard content type + the envelope-side
      // signer identity (the active platform signing key) for every publish.
      type: body.type ?? DEFAULT_CONTENT_TYPE,
      signer: body.signer ?? getActiveSigner(),
      skillMetadataOverride: body.skillMetadataOverride,
      extensions: body.extensions,
    };

    const { pkg, hash: packageHash } = buildEvidencePackage(packageInput);

    // Store package in Vercel Blob
    const blobUrl = await putPackage(packageHash, pkg as unknown as Record<string, unknown>);

    // Sign the package hash (non-blocking — failures don't prevent publishing)
    const signResult = signPackage(packageHash);

    // RFC 3161 timestamp and Rekor transparency log (run in parallel, non-blocking)
    const [rfc3161Token, rekorResult] = await Promise.all([
      getRfc3161Timestamp(packageHash).catch(() => null),
      signResult
        ? publishToRekor(packageHash, signResult.signature, signResult.publicKey).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Generate content-addressable slug: {title-slug}-{shortHash}
    const slug = await resolveSlug(body.title, packageHash);

    // Create evidence record in database
    const promptHash = hash(body.prompt);
    const systemPromptHash = pkg.skillMetadata.systemPromptHash || null;
    const mcpServer = pkg.skillMetadata.mcpServerUrl || null;

    await db.insert(evidenceRecords).values({
      slug,
      creatorId: userId,
      title: body.title,
      summary: body.summary,
      model: body.model,
      promptHash,
      promptVisibility: body.promptVisibility,
      promptText: body.promptVisibility === 'full_text' ? body.prompt : null,
      systemPromptHash,
      mcpServer,
      basePackageHash: packageHash,
      basePackageStorageKey: blobUrl,
      basePackageSignature: signResult
        ? JSON.stringify({
            signature: signResult.signature,
            publicKey: signResult.publicKey,
            algorithm: signResult.algorithm,
            kid: signResult.kid,
          })
        : null,
      basePackageRfc3161Timestamp: rfc3161Token,
      basePackageRekorEntryId: rekorResult?.entryId || null,
      basePackageRekorInclusionProof: rekorResult?.inclusionProof || null,
      captureMethod: body.captureMethod,
      contentProfile: body.contentProfile ?? null,
    });

    const response = NextResponse.json({
      slug,
      url: `/evidence/${slug}`,
      packageHash,
    });
    if (auth.method === 'cookie') {
      // Nudge toward programmatic device-flow tokens for non-browser
      // clients. See docs/api/evidence-publish.md#authentication.
      response.headers.set('X-Auth-Deprecated', 'cookie');
      console.log('[api/evidence] cookie-auth publish (deprecated path)', {
        userId,
      });
    }
    return response;
  } catch (error) {
    console.error('Evidence publish error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish evidence' },
      { status: 500 },
    );
  }
}
