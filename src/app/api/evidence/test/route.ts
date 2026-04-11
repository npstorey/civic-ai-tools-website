import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { putPackage, getPackage } from '@/lib/storage';
import crypto from 'crypto';

/**
 * Temporary validation route for Milestone 0.
 * Creates a test user, evidence record, and blob — then retrieves both.
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
