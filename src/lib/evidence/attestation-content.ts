// The record page's read of one attestation's content (#559): through the app's
// attestation package route, never from a storage URL.
//
// WHY THROUGH THE APP. The Attestations section used to fetch each attestation's
// stored object by its storage address, which works only while the bucket is
// world-readable. The route `/api/records/:slug/attestations/:id/package` reads
// the object through the storage driver, applies the record's read gate (a
// sealed record's attestations are its creator's alone), and answers with the
// stored bytes unchanged — so an instance can keep its bucket private, and the
// page still shows each attestation's details.
//
// WHAT A FAILED READ COMES TO. `null`, and nothing else: a refusal (404), a
// storage failure (502), a dropped connection, a body that is not JSON, and a
// JSON body that is not an object. The route answers a refusal with a JSON error
// body, so the status is checked before anything is parsed; an error body is
// never handed to the page as an attestation's content. The page shows a `null`
// as unavailable.
//
// Driven in `./attestation-content.test.ts`, and against the real route in
// `src/app/api/evidence/attestation-package-route.test.ts`.

export interface AttestationContentDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/** The app's package route for one attestation of a record, on the page's own origin. */
export function attestationPackagePath(slug: string, id: string): string {
  return `/api/records/${encodeURIComponent(slug)}/attestations/${encodeURIComponent(id)}/package`;
}

/**
 * Read one attestation's stored package through the app. Returns the parsed
 * package when the route answered 2xx with a whole JSON object, and `null` for
 * every other outcome.
 */
export async function loadAttestationPackage(
  slug: string,
  id: string,
  deps: AttestationContentDeps,
): Promise<Record<string, unknown> | null> {
  // Called unbound: a browser's `fetch` throws when invoked as a method of
  // another object.
  const { fetch: fetchPackage } = deps;
  try {
    const res = await fetchPackage(attestationPackagePath(slug, id), { credentials: 'same-origin' });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
