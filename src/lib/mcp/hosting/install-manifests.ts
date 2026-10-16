/**
 * The pin's `package.json` a hosted source's sandbox installs from (#617 P4,
 * criterion L; the bridge's is `BRIDGE_PACKAGE_JSON`), and the shape of the
 * lockfile beside each.
 *
 * Held apart from the lockfiles themselves (`./lockfiles.generated.ts`)
 * because both the lifecycle and the script that GENERATES the lockfiles read
 * them: `scripts/generate-hosted-lockfiles.ts` writes each `package.json` into
 * an empty directory, resolves it with `npm install --package-lock-only`
 * against the public registry, and writes the lockfiles module. The sandbox
 * then runs `npm ci --ignore-scripts`, which installs exactly the lockfile's
 * tree or fails when the `package.json` beside it disagrees with it. One
 * builder for both sides, so they cannot disagree.
 *
 * A pin move (the manifest's `hosting.version`) or a bridge package move
 * (`BRIDGE_PACKAGES`) re-runs the script; `lockfiles.test.ts` fails until it
 * has been re-run.
 */
import type { SourceHosting } from '@typedstandards/civic-typed-router';

/** The pin directory's package name. */
export const PIN_PACKAGE_NAME = 'civic-source-pin';

/** The pin directory's `package.json`: one dependency, the pinned package at its exact version. */
export function pinPackageJson(hosting: Pick<SourceHosting, 'package' | 'version'>): string {
  return JSON.stringify({ name: PIN_PACKAGE_NAME, private: true, dependencies: { [hosting.package]: hosting.version } }, null, 2);
}

/** The key the lockfiles module holds a pin's lockfile under. */
export function pinLockfileKey(hosting: Pick<SourceHosting, 'package' | 'version'>): string {
  return `${hosting.package}@${hosting.version}`;
}

/** One package entry of an npm lockfile (lockfileVersion 3), as far as this
 *  repository reads it. */
export interface NpmLockfileEntry {
  name?: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  dependencies?: Record<string, string>;
  [field: string]: unknown;
}

/** An npm lockfile (lockfileVersion 3). */
export interface NpmLockfile {
  name: string;
  lockfileVersion: number;
  requires?: boolean;
  packages: Record<string, NpmLockfileEntry>;
}
