import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

// Canonical trust-registry path (spec §8.3.3, ADR-0012 §3 parallel-serve).
// Returns the legacy static file at /.well-known/evidence-public-keys.json
// VERBATIM — the same bytes, not a re-serialization of the parsed JSON
// (which would compact whitespace and diverge byte-wise). ADR-0012 §3
// requires the two paths emit byte-identical content; reading the one
// source file guarantees that.
//
// The route is force-static, so the read runs at build time where
// process.cwd() resolves to the project root and the file is present —
// reliable, and the prerendered response is the file's exact bytes. The new
// path is canonical going forward; the legacy path is served indefinitely
// (no forced cutover). New external clients SHOULD fetch this path.
export const dynamic = 'force-static';

export async function GET() {
  const body = await fs.readFile(
    path.join(process.cwd(), 'public', '.well-known', 'evidence-public-keys.json'),
    'utf-8',
  );
  return new NextResponse(body, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
