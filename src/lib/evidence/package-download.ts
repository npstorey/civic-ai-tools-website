// The record page's Download (#553): fetch the package through the app's own
// route, then save it as `record-<slug>.json`.
//
// WHY THROUGH THE APP. The page used to hand the browser the stored object's
// address, which works only while the bucket is world-readable. The route
// `/api/records/:slug/package` reads the object through the storage driver,
// applies the record's read gate (a sealed record is its creator's alone), and
// answers with the stored bytes unchanged — so an instance can keep its bucket
// private, and the reader still gets the exact bytes that were signed.
//
// WHY FETCH FIRST, NOT A LINK. A same-origin `<a download>` that receives an
// error status may save the error body under the record's name, depending on
// the browser. A file named `record-<slug>.json` holding `{"error":…}` is a
// false record in a reader's hands. So the bytes are fetched, the status is
// checked, and only a complete 2xx body is ever saved.
//
// Driven in `./package-download.test.ts`, and against the real route in
// `src/app/api/evidence/package-route.test.ts`.

/** What one Download attempt came to. `status` is null when no response arrived. */
export type PackageDownloadResult =
  | { ok: true }
  | { ok: false; status: number | null };

export interface PackageDownloadDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  save: (blob: Blob, fileName: string) => void;
}

/** The app's package route for a record, on the page's own origin. */
export function recordPackagePath(slug: string): string {
  return `/api/records/${encodeURIComponent(slug)}/package`;
}

/** The saved file's name — unchanged from the storage-address Download. */
export function recordPackageFileName(slug: string): string {
  return `record-${slug}.json`;
}

/**
 * Fetch the record's package through the app and save it. Saves nothing unless
 * the route answered 2xx and the whole body arrived; the caller tells the
 * reader the download failed.
 */
export async function downloadRecordPackage(
  slug: string,
  deps: PackageDownloadDeps,
): Promise<PackageDownloadResult> {
  // Called unbound: a browser's `fetch` throws when invoked as a method of
  // another object.
  const { fetch: fetchPackage, save } = deps;
  let blob: Blob;
  try {
    const res = await fetchPackage(recordPackagePath(slug), { credentials: 'same-origin' });
    if (!res.ok) return { ok: false, status: res.status };
    blob = await res.blob();
  } catch {
    return { ok: false, status: null };
  }
  save(blob, recordPackageFileName(slug));
  return { ok: true };
}

export interface SaveBlobHost {
  document: Pick<Document, 'createElement' | 'body'>;
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

/**
 * How long the object URL outlives the click. Revoking it in the same task can
 * cancel the save in some browsers; the bytes are small, so holding them a
 * while longer costs nothing.
 */
const REVOKE_AFTER_MS = 40_000;

/** Save fetched bytes as a file, through a temporary object URL. */
export function saveBlobAsFile(blob: Blob, fileName: string, host?: SaveBlobHost): void {
  const { document: doc, URL: urls, setTimeout: later } = host ?? {
    document: globalThis.document,
    URL: globalThis.URL,
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
  };
  const objectUrl = urls.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  later(() => urls.revokeObjectURL(objectUrl), REVOKE_AFTER_MS);
}
