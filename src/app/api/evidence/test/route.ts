import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { putPackage, getPackage } from '@/lib/storage';
import { buildEvidencePackage } from '@/lib/evidence/packager';
import crypto from 'crypto';

/**
 * Temporary validation route for M0+M3.
 * Tests database, storage, and the evidence packager.
 * Remove this route before merging to main.
 */
export async function GET() {
  try {
    // 1. Upsert a test user
    const testGithubId = 'test-000000';
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.githubId, testGithubId))
      .limit(1);

    let userId: string;
    if (existing.length > 0) {
      userId = existing[0].id;
    } else {
      const inserted = await db
        .insert(users)
        .values({
          githubId: testGithubId,
          displayName: 'Test User',
          githubProfileUrl: 'https://github.com/test',
        })
        .returning({ id: users.id });
      userId = inserted[0].id;
    }

    // 1b. Test the evidence packager
    const { pkg, hash: pkgHash } = buildEvidencePackage({
      trace: { resourceSpans: [] },
      prompt: 'How many 311 complaints in NYC?',
      output: 'Based on the data, there were 2,500 complaints.',
      toolCalls: [
        {
          name: 'get_data',
          args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9', select: 'count(*)' },
          resultSummary: { rows: 1, columns: 1 },
          duration_ms: 450,
          operationType: 'query',
        },
      ],
      model: 'openai/gpt-4o-mini',
      portal: 'data.cityofnewyork.us',
      tokenUsage: { promptTokens: 1000, completionTokens: 200 },
      duration_ms: 3200,
      promptVisibility: 'full_text',
      title: 'NYC 311 Complaint Count',
      summary: 'A count of 311 complaints filed in NYC.',
    });

    // 2. Create a test evidence record
    const slug = `test-${Date.now()}`;
    const promptHash = crypto.createHash('sha256').update('test prompt').digest('hex');

    const record = await db
      .insert(evidenceRecords)
      .values({
        slug,
        creatorId: userId,
        title: 'Test Evidence Record',
        summary: 'Validating database + storage infrastructure.',
        model: 'test/model',
        promptHash,
      })
      .returning();

    // 3. Store a test blob in Vercel Blob (if token is configured)
    const testPackage = {
      type: 'evidence-package',
      version: '0.1.0',
      test: true,
      createdAt: new Date().toISOString(),
    };
    const packageJson = JSON.stringify(testPackage);
    const packageHash = crypto.createHash('sha256').update(packageJson).digest('hex');

    let blobUrl: string | null = null;
    let fetchedPackage: Record<string, unknown> | null = null;
    const blobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN;

    if (blobConfigured) {
      blobUrl = await putPackage(packageHash, testPackage);

      // 4. Update the evidence record with the package hash and storage key
      await db
        .update(evidenceRecords)
        .set({
          basePackageHash: packageHash,
          basePackageStorageKey: blobUrl,
        })
        .where(eq(evidenceRecords.slug, slug));

      fetchedPackage = await getPackage(blobUrl);
    }

    // 5. Retrieve the record to validate database round-trip
    const fetchedRecord = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.slug, slug))
      .limit(1);

    // 6. Clean up: delete ALL evidence records for this test user (including orphans
    //    from previous failed runs), then delete the user
    await db
      .delete(evidenceRecords)
      .where(eq(evidenceRecords.creatorId, userId));
    await db
      .delete(users)
      .where(eq(users.githubId, testGithubId));

    return NextResponse.json({
      success: true,
      packager: {
        packageHashLength: pkgHash.length,
        hasMetadata: !!pkg.metadata.packageId,
        hasPromptHash: !!pkg.prompt.hash,
        promptTextIncluded: !!pkg.prompt.text,
        queriesCount: pkg.queries.length,
        dataSourcesCount: pkg.dataSources.length,
        costModel: pkg.cost.model,
        schemaVersion: pkg.metadata.schemaVersion,
      },
      database: {
        recordCreated: record.length === 1,
        recordRetrieved: fetchedRecord.length === 1,
        slug: fetchedRecord[0]?.slug,
        packageHashStored: blobConfigured
          ? fetchedRecord[0]?.basePackageHash === packageHash
          : 'skipped (no BLOB_READ_WRITE_TOKEN)',
      },
      storage: blobConfigured
        ? {
            blobStored: !!blobUrl,
            blobUrl,
            blobRetrieved: !!fetchedPackage,
            contentMatches: fetchedPackage?.test === true,
          }
        : { skipped: true, reason: 'BLOB_READ_WRITE_TOKEN not configured' },
    });
  } catch (error) {
    console.error('Evidence test route error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
