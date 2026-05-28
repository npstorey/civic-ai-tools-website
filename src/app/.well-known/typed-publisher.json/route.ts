import { NextResponse } from 'next/server';
import registry from '../../../../public/.well-known/evidence-public-keys.json' with { type: 'json' };

// Canonical trust-registry path (spec §8.3.3, ADR-0012 §3 parallel-serve).
// Serves the same content as the legacy static file at
// /.well-known/evidence-public-keys.json. Single-source: this route returns
// the same bundled registry JSON, so the two paths never diverge. The new
// path is canonical going forward; the legacy path is served indefinitely
// (no forced cutover). New external clients SHOULD fetch this path.
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(registry);
}
