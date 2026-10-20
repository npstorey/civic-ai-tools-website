// The instance's default layout node: the id its publication attestation names
// as `layoutNodeId` (LAYOUT-WEB W4 P2; spec §8.10.1; the amendment's (a)).
// Server-only.
//
// THE DEFAULT NODE IS THE LAYOUT THE INSTANCE RENDERS BY DEFAULT:
//   - `ANSWER_LAYOUT_URL` set: the node read from that URL, its id computed from
//     the fetched bytes. The pages and this function share one reading
//     (`readLayoutUrlOnce`). When that reading failed, the pages refuse and
//     this names no node.
//   - nothing set: a committed node whose seven fields equal `answer-first`'s
//     and which this instance's own key signed;
//   - `ANSWER_LAYOUT` or `ANSWER_LAYOUT_PATH` set: none.
// No node: nothing is named, and the publication attestation is byte-identical
// to one built before W4 P2.
//
// "SIGNED BY THIS INSTANCE" IS PROVED BY KEY. The node's signature must verify,
// its public key must equal the one derived from this instance's signing key
// (`instanceSigningPublicKey`, the key `SignResult.publicKey` carries), and its
// key id must equal the instance's. Not enough on its own, and not used: the
// node's signer claim equal to the configured identity (configuration, which
// a fork copies), the key id alone (a string the operator picks), or the key's
// presence in the instance's registry (a fork that syncs both the node file
// and the key file passes).
//
// The node id is computed from the node's bytes on every call, never kept as a
// constant.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import { derivePublicKeySpki } from '@typedstandards/produce-core';
import { readPublisherEnv, type EnvRecord } from '../publisher-env.ts';
import { isSigningKeyIdConfigured } from '../evidence/unsigned-tier.ts';
import { computeEnvelopeHash, verifySignature, CONTENT_LAYOUT } from '../evidence/verify.ts';
import { ANSWER_FIRST } from './index.ts';
import { sameLayout } from './layout-check.ts';
import { committedLayoutNodes, type CommittedLayoutNode } from './held.ts';
import { readLayoutUrlOnce, type NodeReadingDeps } from './node-reading.ts';
import { errorLogFacts } from '../streaming.ts';

/**
 * The public key of this instance's signing key, derived without signing
 * anything: the base64 SPKI DER that `signPackage`'s `SignResult.publicKey`
 * carries for the same key (both are produce-core's `derivePublicKeySpki`).
 * Null when no signing key is configured, or when the configured value is not
 * an Ed25519 key. The key itself never leaves this function.
 */
export function instanceSigningPublicKey(env: EnvRecord = process.env): string | null {
  const key = readPublisherEnv('SIGNING_KEY', env);
  if (typeof key !== 'string' || key.trim() === '') return null;
  try {
    return derivePublicKeySpki(key);
  } catch {
    return null;
  }
}

function present(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Whether `node` is the committed form of this instance's default: its seven
 * fields are `answer-first`'s, its type is `content/layout/v1`, its signature
 * verifies, and the key and key id it was signed under are this instance's.
 */
export function isInstanceDefaultNode(node: CommittedLayoutNode, publicKey: string, keyId: string): boolean {
  if (!sameLayout(node.layout, ANSWER_FIRST)) return false;
  const pkg = node.document.package as Record<string, unknown>;
  const sig = node.document.signature;
  if (pkg.type !== CONTENT_LAYOUT || !isObject(sig)) return false;
  if (sig.publicKey !== publicKey || sig.kid !== keyId) return false;
  const metadata = isObject(pkg.metadata) ? pkg.metadata : {};
  if (metadata.signingKeyId !== keyId) return false;
  if (computeEnvelopeHash(pkg) !== node.nodeId) return false;
  if (typeof sig.signature !== 'string') return false;
  return verifySignature(node.nodeId, sig.signature, publicKey, typeof sig.algorithm === 'string' ? sig.algorithm : undefined);
}

export interface DefaultNodeSources {
  /** The committed nodes; defaults to this build's. */
  committed?: readonly CommittedLayoutNode[];
  /** What the URL reading is handed on this process's first read of the URL (a fetcher, a registry). */
  urlDeps?: NodeReadingDeps;
}

/**
 * The node id this instance names as `layoutNodeId`, or undefined when it
 * names none. Never throws: a node that cannot be named is not named, and the
 * publication goes ahead without it.
 */
export async function defaultLayoutNodeId(env: EnvRecord = process.env, sources: DefaultNodeSources = {}): Promise<string | undefined> {
  try {
    const url = present(env.ANSWER_LAYOUT_URL);
    const documentForm = present(env.ANSWER_LAYOUT) !== undefined || present(env.ANSWER_LAYOUT_PATH) !== undefined;
    if (url !== undefined) {
      // Both forms set is refused by the pages; nothing is named for it.
      if (documentForm) return undefined;
      const reading = await readLayoutUrlOnce(url, sources.urlDeps);
      return reading.ok ? reading.nodeId : undefined;
    }
    if (documentForm) return undefined;

    const publicKey = instanceSigningPublicKey(env);
    if (publicKey === null || !isSigningKeyIdConfigured(env)) return undefined;
    const keyId = readPublisherEnv('KEY_ID', env) as string;
    const matches = (sources.committed ?? committedLayoutNodes()).filter((n) => isInstanceDefaultNode(n, publicKey, keyId));
    if (matches.length === 0) return undefined;
    // Several (the same layout signed again): the latest by its own createdAt, then by id.
    const createdAt = (n: CommittedLayoutNode) => String((n.document.package as { metadata?: { createdAt?: unknown } }).metadata?.createdAt ?? '');
    matches.sort((a, b) => createdAt(a).localeCompare(createdAt(b)) || a.nodeId.localeCompare(b.nodeId));
    return matches[matches.length - 1].nodeId;
  } catch (err) {
    console.warn('[answer-layout] no layout node is named on this publication:', errorLogFacts(err));
    return undefined;
  }
}
