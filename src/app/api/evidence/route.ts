import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users, evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { putPackage } from '@/lib/storage';
import { buildEvidencePackage, type PackageInput } from '@/lib/evidence/packager';
import { hash } from '@/lib/evidence/trace';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let attempt = 0;
  while (true) {
    const existing = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.slug, slug))
      .limit(1);
    if (existing.length === 0) return slug;
    attempt++;
    slug = `${base}-${attempt}`;
  }
}

interface PublishRequest {
  trace: Record<string, unknown>;
  prompt: string;
  output: string;
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
}

export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Look up internal DB user ID
    const githubId = session.user.id;
    const dbUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.githubId, githubId))
      .limit(1);

    if (dbUser.length === 0) {
      return NextResponse.json({ error: 'User not found in database' }, { status: 404 });
    }
    const userId = dbUser[0].id;

    const body: PublishRequest = await request.json();

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
    };

    const { pkg, hash: packageHash } = buildEvidencePackage(packageInput);

    // Store package in Vercel Blob
    const blobUrl = await putPackage(packageHash, pkg as unknown as Record<string, unknown>);

    // Generate unique slug
    const slug = await uniqueSlug(slugify(body.title));

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
    });

    return NextResponse.json({
      slug,
      url: `/evidence/${slug}`,
      packageHash,
    });
  } catch (error) {
    console.error('Evidence publish error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish evidence' },
      { status: 500 },
    );
  }
}
