// STUB (#553, red commit). The typed surface the tests drive, landed before
// the behaviour so the red fails at its assertions rather than at an import.
// Every body here is deliberately inert; the next commit replaces it.

/** What one Download attempt came to. `status` is null when no response arrived. */
export type PackageDownloadResult =
  | { ok: true }
  | { ok: false; status: number | null };

export interface PackageDownloadDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  save: (blob: Blob, fileName: string) => void;
}

export function recordPackagePath(slug: string): string {
  void slug;
  return '';
}

export function recordPackageFileName(slug: string): string {
  void slug;
  return '';
}

export async function downloadRecordPackage(
  slug: string,
  deps: PackageDownloadDeps,
): Promise<PackageDownloadResult> {
  void slug;
  void deps;
  return { ok: true };
}

export interface SaveBlobEnv {
  document: Pick<Document, 'createElement' | 'body'>;
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

export function saveBlobAsFile(blob: Blob, fileName: string, env?: SaveBlobEnv): void {
  void blob;
  void fileName;
  void env;
}
