/**
 * Source classes (S4 W1, npstorey/civic-ai-tools#335; G0-1 = A): a class is a server and the packs over it,
 * identified by the server's source id. A pack names its base server in its manifest entry (`base`, router 0.8.0 on);
 * a server's entry has none, so its class is its own id. A class is computed beside the flows statement, never stored
 * in it: the statement's bytes do not move (A5), and both consent stores stay per source (G0-7 = B). A class is a
 * control and an answer, each of which sets the state of the sources then in the class (`applyConsentMove`).
 *
 * Pure: the caller passes the manifest (`flowsManifest()`, which a test can set) and, where it matters, the ids this
 * instance configures.
 */
import type { ManifestEntry } from '@typedstandards/civic-typed-router';

type ClassEntry = Pick<ManifestEntry, 'sourceId' | 'base'>;

export interface SourceClass {
  /** The server's source id. */
  id: string;
  /** The server and the packs over it, in manifest order. */
  members: string[];
}

/** The class a manifest entry is in: its base server's id for a pack, its own id for a server. */
export function classIdOf(entry: ClassEntry): string {
  return entry.base ?? entry.sourceId;
}

/** The class of a source id, read from the manifest; an id the manifest does not list is a class of its own. */
export function classIdOfSource(manifest: readonly ClassEntry[], sourceId: string): string {
  const entry = manifest.find((candidate) => candidate.sourceId === sourceId);
  return entry ? classIdOf(entry) : sourceId;
}

/**
 * Every class over `manifest`, in the order its first member appears, each with its members in manifest order;
 * with `ids`, only those members (the configured set), and a class with none is left out.
 */
export function sourceClasses(manifest: readonly ClassEntry[], ids?: readonly string[]): SourceClass[] {
  const keep = ids ? new Set(ids) : null;
  const classes = new Map<string, string[]>();
  for (const entry of manifest) {
    if (keep && !keep.has(entry.sourceId)) continue;
    const id = classIdOf(entry);
    const members = classes.get(id);
    if (members) members.push(entry.sourceId);
    else classes.set(id, [entry.sourceId]);
  }
  return [...classes].map(([id, members]) => ({ id, members }));
}

/** The members of one class, in manifest order, limited to `ids` when given. */
export function classMembers(manifest: readonly ClassEntry[], classId: string, ids?: readonly string[]): string[] {
  return sourceClasses(manifest, ids).find((candidate) => candidate.id === classId)?.members ?? [];
}
