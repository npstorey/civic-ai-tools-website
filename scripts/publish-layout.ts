/**
 * Publish this instance's default layout as a signed `content/layout/v1` node
 * (LAYOUT-WEB W4 P2; spec §8.14; ruling D4 = A: a committed file, no table).
 *
 * WHAT IT BUILDS. The node is built from the `answer-first` built-in's seven
 * fields (`ANSWER_FIRST`, `src/lib/answer-layout/index.ts`) with produce-core's
 * `buildLayoutNode`, and nothing else: the envelope members are this run's own
 * (a fresh package id, the run's time, `PUBLISHER_KEY_ID`, and the instance's
 * signer identity). The script reads no payload, so no payload can carry an
 * envelope member in. The node carries no `captureMethod` (ruling D5 = A).
 *
 * HOW IT SIGNS. Through the website's own signing module
 * (`src/lib/evidence/signing.ts`): `signPackage` over the node id, the RFC 3161
 * timestamp from `TIMESTAMP_AUTHORITY_URL` (https://freetsa.org/tsr when
 * unset; the request carries only the hash), and the transparency-log entry
 * at `TRANSPARENCY_LOG_URL` (Sigstore Rekor when unset). There is no second
 * signing path. It is TypeScript because that module is: under
 * `node --experimental-strip-types` the script imports it as it stands, and
 * `npm run typecheck` checks the script with the rest of the repository.
 *
 * WHAT IT WRITES (only with --apply, and only when both proofs came back):
 *   public/.well-known/layouts/<nodeId>.json         the §9.4 view of the node
 *       with the package inline, built by produce-core's `buildCommitmentView`
 *       from exactly the inputs the published cli's `view` passes, so the cli's
 *       `verify` reads it; `packageUrl` is not set (the package is inline);
 *   public/.well-known/layouts/<nodeId>.proofs.json  the RFC 3161 token and the
 *       log entry's id, inclusion proof and body, under the names the site's
 *       commitment view uses; the cli's input refuses these keys, so they sit
 *       beside the view;
 *   src/lib/answer-layout/committed-nodes.ts          one import added for the
 *       new view, so the next build includes the node with no hand edit.
 * A node file that exists is never overwritten, and no node file is removed.
 *
 * DRY RUN BY DEFAULT. It builds the node, signs it in memory, requests the
 * timestamp, checks the signing key against the key the instance's published
 * trust registry carries, and verifies the built view in process with
 * verify-core's `verifyRecord`. Then it stops: no transparency-log request (an
 * entry is permanent, and repeated dry runs would clutter the log) and no
 * file. The id it prints never ships: the real run builds a new node.
 *
 * THE REAL RUN (--apply), in this order: the timestamp, the local checks, the
 * transparency log, the files. A timestamp failure makes no log request; a
 * check that fails (the key the registry carries is not this key) stops before
 * the log; a log failure writes nothing. The two external requests are made
 * one after the other, not in parallel as the publish routes make them, so a
 * timestamp failure never leaves a log entry behind.
 *
 * Run it in the operator's own terminal, with the signing variables from
 * docs/deploy.md "Instance identity and signing" injected (never a literal in
 * a dot-file):
 *
 *   Dry run:  op run --env-file=<file> -- node --experimental-strip-types scripts/publish-layout.ts
 *   Apply:    op run --env-file=<file> -- node --experimental-strip-types scripts/publish-layout.ts --apply
 *
 * `--root <dir>` writes under another checkout (the tests' temporary one);
 * the default is this repository.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLayoutNode } from '@typedstandards/produce-core';
import { CONTENT_LAYOUT, validateRegistry, verifyRecord, type TrustRegistry } from '@typedstandards/verify-core';
import { ANSWER_FIRST } from '../src/lib/answer-layout/index.ts';
import { buildLayoutNodeDocument, CLI_VIEW_KEYS } from '../src/lib/answer-layout/node-document.ts';
import {
  getActiveKeyId,
  getActiveSigner,
  getRfc3161Timestamp,
  publishToRekor,
  signPackage,
  timestampAuthorityUrl,
  transparencyLogUrl,
} from '../src/lib/evidence/signing.ts';
import { getSidecarTrustRegistryUrls } from '../src/lib/site-config.ts';
import { readPublisherEnv } from '../src/lib/publisher-env.ts';

/** Where the committed node files live, relative to the repository root. */
export const LAYOUTS_DIR = path.join('public', '.well-known', 'layouts');
/** The module that imports every committed node, relative to the repository root. */
export const COMMITTED_MODULE = path.join('src', 'lib', 'answer-layout', 'committed-nodes.ts');

const NODE_FILE = /^[0-9a-f]{64}\.json$/;

class Stop extends Error {}

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

function stop(text: string): never {
  throw new Stop(text);
}

/** The committed-nodes module, listing `nodeIds` (sorted), in the one form this script writes and reads. */
export function committedModuleSource(nodeIds: readonly string[]): string {
  const ids = [...new Set(nodeIds)].sort();
  const imports = ids.map((id, i) => `import node${i} from '../../../public/.well-known/layouts/${id}.json' with { type: 'json' };\n`).join('');
  const entries = ids.map((_, i) => `  node${i},\n`).join('');
  return (
    `// The layout nodes this instance has committed under \`public/.well-known/layouts/\`\n` +
    `// (LAYOUT-WEB W4 P2, ruling D4 = A), as build-time imports.\n` +
    `//\n` +
    `// WRITTEN BY \`scripts/publish-layout.ts --apply\`, which adds one import per node\n` +
    `// document it writes; a node file is never removed, so its id stays resolvable.\n` +
    `// Nothing reads \`public/.well-known/layouts/\` from disk at run time: Next.js\n` +
    `// bundles each JSON document into the server's module graph at build, as it\n` +
    `// bundles the trust registry (\`src/lib/evidence/verify.ts\`).\n` +
    `//\n` +
    `// The list holds node documents (the §9.4 view with the package inline). The\n` +
    `// sibling \`<nodeId>.proofs.json\` files are not imported: nothing on the site\n` +
    `// reads them; they are for verifiers outside it.\n` +
    (imports ? `\n${imports}` : '') +
    `\nexport const COMMITTED_LAYOUT_DOCUMENTS: readonly unknown[] = [\n${entries}];\n`
  );
}

/** The node ids the committed-nodes module lists. */
export function committedModuleNodeIds(source: string): string[] {
  return [...source.matchAll(/public\/\.well-known\/layouts\/([0-9a-f]{64})\.json'/g)].map((m) => m[1]);
}

async function fetchRegistry(url: string): Promise<TrustRegistry> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return stop(`The instance's published trust registry could not be fetched (${url}). Nothing was sent to the log and nothing was written.`);
  }
  if (!res.ok) stop(`The instance's published trust registry answered HTTP ${res.status} (${url}). Nothing was sent to the log and nothing was written.`);
  const registry = validateRegistry(await res.json().catch(() => null));
  if (registry === undefined) stop(`The instance's published trust registry is not a registry (${url}). Nothing was sent to the log and nothing was written.`);
  return registry;
}

export async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes('--apply');
  const rootAt = argv.indexOf('--root');
  const known = new Set(['--apply', '--root']);
  const unknown = argv.filter((a, i) => !known.has(a) && !(rootAt !== -1 && i === rootAt + 1));
  if (unknown.length > 0 || (rootAt !== -1 && argv[rootAt + 1] === undefined)) {
    line(`Usage: node --experimental-strip-types scripts/publish-layout.ts [--apply] [--root <dir>] (unknown: ${unknown.join(' ') || '--root needs a directory'})`);
    return 2;
  }
  const root = rootAt !== -1 ? path.resolve(argv[rootAt + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  try {
    line(apply ? 'publish-layout: the real run (--apply).' : 'publish-layout: a DRY run. It makes no log request and writes no file; --apply does both.');

    // An unresolved secret reference is a string, and would pass a presence check.
    const rawKey = readPublisherEnv('SIGNING_KEY') ?? '';
    if (rawKey.includes('op://') || /["'\s]/.test(rawKey)) {
      stop('PUBLISHER_SIGNING_KEY holds an unresolved secret reference or quotes, not a key. Run the script under `op run` with an unquoted reference.');
    }

    // The instance's identity: each throws, naming the variable, when unset.
    const signer = getActiveSigner();
    const kid = getActiveKeyId();
    const registryUrl = getSidecarTrustRegistryUrls().canonical;

    // 1. The node: answer-first's seven fields, this run's envelope members.
    const { node, nodeId } = buildLayoutNode({
      ...ANSWER_FIRST,
      packageId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      signingKeyId: kid,
      signer,
    });
    line(`Built a ${CONTENT_LAYOUT} node from ${ANSWER_FIRST.name} v${ANSWER_FIRST.version}: ${nodeId}`);

    // 2. The signature, in memory.
    const signed = signPackage(nodeId);
    if (signed === null) stop('PUBLISHER_SIGNING_KEY is not set, so nothing can be signed. Nothing was written.');

    // 3. The timestamp, first of the two external requests.
    line(`Requesting the RFC 3161 timestamp from ${timestampAuthorityUrl()} (the request carries only the hash).`);
    const token = await getRfc3161Timestamp(nodeId);
    if (token === null) stop('The timestamp authority returned no token. No log request was made and nothing was written.');
    line('Timestamp: received.');

    // 4. The local checks: the key the published registry carries, then the built view, verified.
    const registry = await fetchRegistry(registryUrl);
    const entry = registry.keys.find((k) => k.kid === kid);
    const keyMatches = entry !== undefined && entry.publicKey === signed.publicKey;
    line(`Key check against ${registryUrl}: kid ${kid} ${entry === undefined ? 'is not in the registry' : `is ${entry.status}`}; the signing key ${keyMatches ? 'matches' : 'does NOT match'} the key it carries.`);
    if (!keyMatches || entry.status !== 'active') {
      stop('The signing key is not the active key the instance publishes for this kid. Stopped before the log; nothing was written.');
    }

    const document = buildLayoutNodeDocument(node, nodeId, signed, registryUrl);
    const outside = Object.keys(document).filter((k) => !CLI_VIEW_KEYS.includes(k));
    if (outside.length > 0) stop(`The view carries keys the cli's verify refuses: ${outside.join(', ')}. Nothing was written.`);

    const result = await verifyRecord(
      { package: document.package as Record<string, unknown>, packageHash: nodeId, signature: document.signature as { signature: string; publicKey: string } },
      { registry },
    );
    const verified =
      result.envelopeIntegrity.status === 'verified' &&
      result.signatureValid === true &&
      result.typeResolution?.status === 'ok' &&
      result.typeResolution.type === CONTENT_LAYOUT &&
      result.keyTrust?.verified === true &&
      result.signerIdentity?.status === 'ok';
    line(
      `verifyRecord on the built view: envelope ${result.envelopeIntegrity.status}, signature ${result.signatureValid}, ` +
        `type ${result.typeResolution?.status} (${result.typeResolution?.type}), key ${result.keyTrust?.status}, signer ${result.signerIdentity?.status}.`,
    );
    if (!verified) stop('The built view does not verify. Stopped before the log; nothing was written.');

    if (!apply) {
      line(`DRY run complete. The node id above (${nodeId}) never ships: the real run builds a new node, with its own package id and time, so its id differs.`);
      return 0;
    }

    // 5. The transparency log, only now.
    line(`Requesting the transparency-log entry from ${transparencyLogUrl()}.`);
    const rekor = await publishToRekor(nodeId, signed.signature, signed.publicKey);
    if (rekor === null) stop('The transparency log returned no entry. Nothing was written.');
    line(`Log entry: ${rekor.entryId} (index ${rekor.logIndex}).`);

    // 6. The files.
    const layoutsDir = path.join(root, LAYOUTS_DIR);
    const viewPath = path.join(layoutsDir, `${nodeId}.json`);
    const proofsPath = path.join(layoutsDir, `${nodeId}.proofs.json`);
    const modulePath = path.join(root, COMMITTED_MODULE);
    if (!NODE_FILE.test(path.basename(viewPath))) stop(`Not a node id: ${nodeId}`);
    const proofs = {
      packageHash: nodeId,
      rfc3161Timestamp: token,
      rekorEntryId: rekor.entryId,
      rekorInclusionProof: rekor.inclusionProof,
      ...(rekor.entryBody !== null ? { rekorEntryBody: rekor.entryBody } : {}),
    };
    const listed = fs.existsSync(modulePath) ? committedModuleNodeIds(fs.readFileSync(modulePath, 'utf8')) : [];
    fs.mkdirSync(layoutsDir, { recursive: true });
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(viewPath, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
    fs.writeFileSync(proofsPath, `${JSON.stringify(proofs, null, 2)}\n`, { flag: 'wx' });
    fs.writeFileSync(modulePath, committedModuleSource([...listed, nodeId]));
    line('Wrote:');
    for (const p of [viewPath, proofsPath, modulePath]) line(`  ${path.relative(root, p)}`);
    return 0;
  } catch (err) {
    if (err instanceof Stop) {
      line(err.message);
      return 1;
    }
    // The identity readers name the missing variable; anything else is reported by its name only.
    line(`publish-layout stopped: ${err instanceof Error && err.name === 'InstanceIdentityError' ? err.message : err instanceof Error && /^\[signing\]/.test(err.message) ? err.message : err instanceof Error ? err.name : 'error'}. Nothing was written.`);
    return 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
