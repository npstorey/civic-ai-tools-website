/**
 * UX-2 P6 + P10 (#729; contract p6p10.md item 7, PQ3 = (a), 0d item 2): the directory-to-source mapping.
 *
 * RED STUB. The red commit lands the module's names, typed, so the tests that read them type-check and fail at
 * their assertions; the table is empty and the function maps nothing. The green fills both.
 */

/** Directory entry id → the `sourceId` of the source that entry is (its server or package, or the router's carry-over entry). */
export const DIRECTORY_SOURCE_MAP: Readonly<Record<string, string>> = Object.freeze({});

/** The source a directory entry is, when this instance offers it; otherwise null. */
export function offeredSourceFor(entryId: string, offered: readonly string[]): string | null {
  void entryId;
  void offered;
  return null;
}
