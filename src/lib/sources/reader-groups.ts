/**
 * The groups a reader sees (S4 W2a, npstorey/civic-ai-tools#335; criteria B1 and B2): Settings' Data sources tab and
 * the picker list the configured sources by class (`classes.ts`, G0-1 = A), a group of two or more under one head with
 * one control, and a source alone as its own row. The class of a source is read from the manifest the server reads:
 * the flows statement does not carry it (its bytes do not move, A5), so the client reads the same `CIVIC_MANIFEST`
 * the server's `flowsManifest()` returns outside a test.
 *
 * THE TEST HOOK. A test that sets the statement's inputs through its own test hook (A14, `statement.ts`) sets the same
 * manifest here, so a surface driven at 200 sources groups them as the routes do. It is a module variable set only by
 * `setGroupManifestForTests`: no request, header, cookie or environment variable reaches it, and no app module calls
 * the setter (`src/components/settings/settings-groups.test.ts` holds that).
 */
import { CIVIC_MANIFEST, type ManifestEntry } from '@typedstandards/civic-typed-router';
import type { FlowsSource } from '../flows/statement.ts';
import { sourceClasses } from './classes.ts';
import { groupName, readerSourceName, reachedThrough } from './source-name.ts';

type GroupManifest = ReadonlyArray<Pick<ManifestEntry, 'sourceId' | 'base' | 'displayName'>>;

let manifestForTests: GroupManifest | null = null;

/** Tests only: the manifest the groups are read from until reset with `null`. */
export function setGroupManifestForTests(manifest: GroupManifest | null): void {
  manifestForTests = manifest;
}

function groupManifest(): GroupManifest {
  return manifestForTests ?? (CIVIC_MANIFEST as unknown as GroupManifest);
}

/** One block of the list: a group of two or more, or a source alone. */
export type ReaderBlock =
  | { kind: 'group'; classId: string; name: string; reached: string; members: FlowsSource[] }
  | { kind: 'alone'; source: FlowsSource };

/**
 * The configured `sources` as blocks, in the order the first member of each class appears in the manifest, members in
 * manifest order. A source the manifest does not list is a class of its own (`classIdOfSource`). The group is named by
 * its server: the configured server's reader name, else the manifest's.
 */
export function readerBlocks(sources: readonly FlowsSource[]): ReaderBlock[] {
  const manifest = groupManifest();
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  const listed = new Set(manifest.map((entry) => entry.sourceId));
  // A configured source the manifest does not list keeps its place after the manifest's, alone.
  const classes = [
    ...sourceClasses(manifest, sources.map((s) => s.sourceId)),
    ...sources.filter((s) => !listed.has(s.sourceId)).map((s) => ({ id: s.sourceId, members: [s.sourceId] })),
  ];
  return classes.map((klass): ReaderBlock => {
    const members = klass.members.map((id) => byId.get(id)!).filter(Boolean);
    if (members.length === 1) return { kind: 'alone', source: members[0] };
    const server = byId.get(klass.id) ?? manifest.find((entry) => entry.sourceId === klass.id) ?? { sourceId: klass.id };
    const serverName = readerSourceName(server);
    return { kind: 'group', classId: klass.id, name: groupName(serverName), reached: reachedThrough(serverName), members };
  });
}

/** The class a configured source is in, as `readerBlocks` groups it: its group's id, or `null` for a source alone. */
export function groupOf(blocks: readonly ReaderBlock[], sourceId: string): Extract<ReaderBlock, { kind: 'group' }> | null {
  for (const block of blocks) {
    if (block.kind === 'group' && block.members.some((m) => m.sourceId === sourceId)) return block;
  }
  return null;
}
