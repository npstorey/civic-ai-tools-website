// TEST-ONLY (R8 W3 criterion 5 (a)): the check that every per-source privacy
// statement traces its own source's hosting switch and no other source's.
// Imported by `src/app/(app)/privacy/privacy-page.test.ts` (over the page's
// real render) and `src/lib/privacy-hosted-trace-stubbed.test.ts` (over a
// stubbed manifest holding a second hosted entry), so the red on the stub and
// the green on the real page are shown on the same code. No app module
// imports it.
//
// "Own switch": for a source the manifest hosts (an entry with an
// `npm-package` variant), its `configuration.addressVariable`, the switch that
// offers it; for a remote source, none, so its trace names no hosting switch
// at all. The four families are `recipient-hosted-*`,
// `recipient-hosted-exchange-*`, `held-sandbox-platform-*` and `source-row-*`.

/** The statement families that state one source each, longest prefix first. */
export const PER_SOURCE_FAMILIES = ['recipient-hosted-exchange-', 'recipient-hosted-', 'held-sandbox-platform-', 'source-row-'] as const;

/** As much of a manifest entry as the check reads. */
export interface SwitchManifestEntry {
  sourceId: string;
  configuration: { addressVariable?: string };
  hostings: ReadonlyArray<{ kind: string }>;
}

/** One statement as the check reads it: its id and its trace. */
export interface TracedStatement {
  id: string;
  traces: readonly string[];
}

/** Each hosted source's switch, by source id. */
export function hostingSwitches(manifest: readonly SwitchManifestEntry[]): Map<string, string> {
  const switches = new Map<string, string>();
  for (const entry of manifest) {
    if (entry.hostings.some((variant) => variant.kind === 'npm-package') && entry.configuration.addressVariable) {
      switches.set(entry.sourceId, entry.configuration.addressVariable);
    }
  }
  return switches;
}

/** The family and the source id a per-source statement states, or null. */
export function perSourceStatement(id: string): { family: string; sourceId: string } | null {
  const family = PER_SOURCE_FAMILIES.find((prefix) => id.startsWith(prefix));
  return family ? { family, sourceId: id.slice(family.length) } : null;
}

/**
 * Every problem with the switch traces of `statements` against `manifest`:
 * a hosted source's statement that does not trace its own switch, and any
 * per-source statement that traces another source's switch. Statements of
 * other families are ignored. An empty list is a pass.
 */
export function switchTraceProblems(statements: readonly TracedStatement[], manifest: readonly SwitchManifestEntry[]): string[] {
  const switches = hostingSwitches(manifest);
  const allSwitches = new Set(switches.values());
  const problems: string[] = [];
  for (const statement of statements) {
    const which = perSourceStatement(statement.id);
    if (!which) continue;
    const own = switches.get(which.sourceId);
    const traced = statement.traces.filter((trace) => trace.startsWith('env:')).map((trace) => trace.slice('env:'.length));
    if (own !== undefined && !traced.includes(own)) problems.push(`${statement.id}: does not trace its own switch ${own}`);
    for (const name of traced) {
      if (allSwitches.has(name) && name !== own) problems.push(`${statement.id}: traces another source's switch ${name}`);
    }
  }
  return problems;
}
