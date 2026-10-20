// Reading a published layout node (LAYOUT-WEB W4 P2; spec §8.14, §9.2, §9.4).
// Server-only: it reaches the trust registry's build-time import and the
// network.
//
// WHAT A NODE DOCUMENT IS. The §9.4 commitment view of a `content/layout/v1`
// node with its package inline: the shape `scripts/publish-layout.ts` writes,
// the published cli's `view` prints and its `verify` reads. The package is the
// signed node; the view's `packageHash` is its claimed node id and `signature`
// its signature envelope. Proofs (the RFC 3161 token, the transparency-log
// entry) are not in it: they sit in a sibling file the cli's input refuses.
//
// HOW A DOCUMENT IS ACCEPTED. Its bytes are parsed with verify-core's
// `parseStrictJson` (a repeated member name is refused before any hash is
// computed, spec §8.2), and its inline package is verified with verify-core's
// `verifyRecord`. It is accepted only when every one of these holds, and
// refused with the verifier's status otherwise:
//   - check #1: the envelope recomputes to the claimed hash (`verified`);
//   - the signature verifies under the key the envelope carries;
//   - check #4: the content hash is not a mismatch;
//   - check #12: the type resolves `ok` to `content/layout/v1`;
//   - check #5: the key is trusted. First by this instance's own trust
//     registry (the build-time import, `src/lib/evidence/verify.ts`); when
//     that registry does not hold the key, by the registry the document itself
//     declares in `trustRegistryUrl`, over `https:` only, fetched once per
//     process and passed to `verifyRecord` as `deps.registry` with
//     `registryProvenance: 'declared-url'`;
//   - check #14 and check #6 report no mismatch;
//   - its seven payload fields pass produce-core's builder (`checkLayout`).
// The node id is the one `verifyRecord` recomputes from the package bytes.
//
// ONE READING PER URL, PER PROCESS. `readLayoutUrlOnce` keeps the first
// result for a URL, a failure included, so the pages and the publish route
// share one reading and the URL is fetched once. A failure is kept too: a
// node that could not be read stays unread until the server restarts.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import type { LayoutPayload } from '@typedstandards/produce-core';
import {
  CONTENT_LAYOUT,
  loadTrustRegistry,
  parseStrictJson,
  validateRegistry,
  verifyRecord,
  type FetchLike,
  type TrustRegistry,
  type VerifyResult,
  type VerifySignatureEnvelope,
} from '../evidence/verify.ts';
import { AnswerLayoutConfigurationError, checkLayout } from './layout-check.ts';

/** A layout node the site holds: its node id, and the seven fields it carries. */
export interface HeldLayoutNode {
  nodeId: string;
  layout: LayoutPayload;
}

/** What reading a node document gave: the node, or the status that refused it. */
export type LayoutNodeReading =
  | ({ ok: true } & HeldLayoutNode)
  | { ok: false; status: string; message: string };

const refuse = (status: string, message: string): LayoutNodeReading => ({ ok: false, status, message });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The seven §8.14.1 fields of a layout node, and nothing else. */
export function layoutFieldsOf(pkg: Record<string, unknown>): Record<string, unknown> {
  const { name, version, appliesTo, order, disclosure, steps, rendererVersion } = pkg;
  return { name, version, appliesTo, order, disclosure, steps, rendererVersion };
}

export interface NodeReadingDeps {
  /** The fetcher for the document and for a declared registry. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** This instance's trust registry. Defaults to the build-time import. */
  registry?: TrustRegistry | undefined;
}

const FETCH_TIMEOUT_MS = 10_000;

const declaredRegistries = new Map<string, Promise<TrustRegistry | undefined>>();

/** A registry a document declares, over `https:` only, fetched once per process. */
function fetchDeclaredRegistry(url: string, fetcher: FetchLike): Promise<TrustRegistry | undefined> {
  let pending = declaredRegistries.get(url);
  if (pending === undefined) {
    pending = (async () => {
      try {
        const res = await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) return undefined;
        return validateRegistry(await res.json());
      } catch {
        return undefined;
      }
    })();
    declaredRegistries.set(url, pending);
  }
  return pending;
}

function isHttps(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The first check `result` fails, as a status and a sentence, or null when it passes all but key trust. */
function envelopeRefusal(result: VerifyResult): LayoutNodeReading | null {
  if (result.envelopeIntegrity.status !== 'verified') {
    return refuse(`envelope_${result.envelopeIntegrity.status}`, `check #1 reads ${result.envelopeIntegrity.status}: the package does not recompute to the hash the document claims`);
  }
  if (result.signatureValid !== true) {
    return refuse('signature_invalid', 'the signature does not verify under the key the document carries');
  }
  if (result.contentHash?.status === 'content_hash_mismatch') {
    return refuse('content_hash_mismatch', 'check #4 reads content_hash_mismatch: the node\'s content hash is not the one its fields recompute to');
  }
  const type = result.typeResolution;
  if (type === null || type.status !== 'ok' || type.type !== CONTENT_LAYOUT) {
    return refuse(
      type?.status === 'ok' ? 'type_not_layout' : `type_${type?.status ?? 'absent'}`,
      `check #12 reads ${type?.status ?? 'nothing'} for type ${JSON.stringify(type?.type ?? null)}, not ok for ${CONTENT_LAYOUT}`,
    );
  }
  const identity = result.signerIdentity?.status;
  if (identity === 'signer_identity_mismatch' || identity === 'key_derived_mismatch') {
    return refuse(identity, `check #14 reads ${identity}: the signer the node claims is not the one its key is registered to`);
  }
  if (result.signingKeyIdConsistency?.status === 'signingKeyId_mismatch') {
    return refuse('signingKeyId_mismatch', 'check #6 reads signingKeyId_mismatch: the signature names another key id than the node does');
  }
  return null;
}

/**
 * Verifies a parsed node document and takes its seven fields. `instance` is
 * this instance's registry; the document's declared registry is read only
 * when `instance` does not hold the key.
 */
export async function verifyLayoutDocument(doc: unknown, deps: NodeReadingDeps = {}): Promise<LayoutNodeReading> {
  if (!isObject(doc) || !isObject(doc.package) || typeof doc.packageHash !== 'string' || !isObject(doc.signature)) {
    return refuse('not_a_node_document', 'the document is not a layout node view: it needs packageHash, signature and the package inline');
  }
  const signature = doc.signature;
  if (typeof signature.signature !== 'string' || typeof signature.publicKey !== 'string') {
    return refuse('not_a_node_document', 'the document\'s signature carries no signature and publicKey strings');
  }
  const fetcher = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const input = { package: doc.package, packageHash: doc.packageHash, signature: signature as unknown as VerifySignatureEnvelope };
  const instance = 'registry' in deps ? deps.registry : await loadTrustRegistry();

  let result = await verifyRecord(input, { registry: instance, fetch: fetcher });
  const early = envelopeRefusal(result);
  if (early !== null) return early;

  if (result.keyTrust?.verified !== true && isHttps(doc.trustRegistryUrl)) {
    const declared = await fetchDeclaredRegistry(doc.trustRegistryUrl, fetcher);
    if (declared !== undefined) {
      result = await verifyRecord(input, { registry: declared, registryProvenance: 'declared-url', fetch: fetcher });
      const again = envelopeRefusal(result);
      if (again !== null) return again;
    }
  }
  if (result.keyTrust?.verified !== true) {
    const status = result.keyTrust?.status ?? 'unknown_key';
    return refuse(status, `check #5 reads ${status}: neither this instance's trust registry nor the one the document declares (https only) holds the signing key as trusted`);
  }

  let layout: LayoutPayload;
  try {
    layout = checkLayout(layoutFieldsOf(doc.package), 'the node');
  } catch (err) {
    return refuse('malformed_layout', err instanceof Error ? err.message : String(err));
  }
  if (result.nodeId === null) return refuse('envelope_unavailable', 'the verifier recomputed no node id');
  return { ok: true, nodeId: result.nodeId, layout };
}

/**
 * Fetches a node document from `url`, parses it strictly and verifies it.
 * Never throws: every failure is a refusal with a status.
 */
export async function readLayoutNodeFromUrl(url: string, deps: NodeReadingDeps = {}): Promise<LayoutNodeReading> {
  const fetcher = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  let bytes: Uint8Array;
  try {
    const res = (await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })) as unknown as Response;
    if (!res.ok) return refuse('fetch_failed', `the URL answered HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return refuse('fetch_failed', 'the URL could not be fetched (no answer within 10 seconds, or the connection failed)');
  }
  let doc: unknown;
  try {
    doc = parseStrictJson(bytes);
  } catch (err) {
    const repeated = err instanceof Error && err.name === 'RepeatedMemberNameError';
    return refuse(repeated ? 'repeated_member_name' : 'not_json', repeated ? err.message : 'the URL did not answer with JSON');
  }
  return verifyLayoutDocument(doc, deps);
}

const urlReadings = new Map<string, Promise<LayoutNodeReading>>();
const settledUrlReadings = new Map<string, LayoutNodeReading>();

/**
 * The one reading of `url` this process makes: the first call fetches and
 * verifies, every later call gets the same result, a failure included.
 */
export function readLayoutUrlOnce(url: string, deps: NodeReadingDeps = {}): Promise<LayoutNodeReading> {
  let pending = urlReadings.get(url);
  if (pending === undefined) {
    pending = readLayoutNodeFromUrl(url, deps).then((reading) => {
      settledUrlReadings.set(url, reading);
      return reading;
    });
    urlReadings.set(url, pending);
  }
  return pending;
}

/** The kept reading of `url`, when this process has finished one; else undefined. */
export function settledLayoutUrlReading(url: string): LayoutNodeReading | undefined {
  return settledUrlReadings.get(url);
}

/** The refusal a page raises for a URL reading that failed. */
export function urlReadingError(envName: string, reading: Extract<LayoutNodeReading, { ok: false }>): AnswerLayoutConfigurationError {
  return new AnswerLayoutConfigurationError(
    `${envName}: the layout node was refused (${reading.status}): ${reading.message}. ` +
      'The instance does not fall back to another layout. Fix the node or the setting, and restart the server.',
  );
}
