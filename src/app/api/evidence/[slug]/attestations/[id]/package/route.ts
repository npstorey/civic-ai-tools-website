import { NextRequest, NextResponse } from 'next/server';

// #559 red stub: the route exists and serves nothing. The fix commit replaces
// this body with the gated read of the attestation's stored package.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  await params;
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
