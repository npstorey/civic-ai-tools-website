// #559 red stub: typed, requests nothing and returns nothing. The fix commit
// replaces it with the read through the app's attestation package route.

export interface AttestationContentDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export function attestationPackagePath(slug: string, id: string): string {
  void slug;
  void id;
  return '';
}

export async function loadAttestationPackage(
  slug: string,
  id: string,
  deps: AttestationContentDeps,
): Promise<Record<string, unknown> | null> {
  void slug;
  void id;
  void deps;
  return null;
}
