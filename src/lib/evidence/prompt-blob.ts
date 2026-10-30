// The run's system prompt, kept as a content-addressed blob (R10 P1b, #694,
// ruled C; P1b-a ruled A).
//
// WHAT A RECORD CARRIES. `skillMetadata.systemPromptHash`, the final
// request's prompt hash, inline; and `skillMetadata.skillText`, a BlobRef to
// that prompt's bytes. The prose stays out of the signed bytes (#411 D3): the
// BlobRef binds it by hash, and a reader fetches it from the store.
//
// THE SEAM. The final prompt exists only on the server, during the run. So:
//   - AT THE RUN'S END (`storeRunPrompt`), compare-stream before its `trace`
//     event and query-notebook before `publish_inputs` write the final
//     prompt to `evidence-refs/<sha256>.txt`, unless an object is already
//     listed at that key. One object per distinct prompt, whichever run or
//     record it serves. A key nobody publishes is an orphan the 24-hour
//     sweep removes (`blob-gc.ts`).
//   - AT PUBLISH (`runPromptMetadata`), the route takes the hash the trace
//     states, lists the key, reads the stored bytes, checks their SHA-256,
//     and builds the BlobRef itself. A missing or mismatched blob gives the
//     hash alone.
// Nothing the client posts is trusted for this: the dialog posts no text and
// no BlobRef, and a trace that names a hash can only ever be answered with
// bytes that hash to it. A failed write or read never fails the run, the
// answer or the publish; it is logged by its facts (`errorLogFacts`), never
// its message.

import { extractSkillMetadata } from '@typedstandards/civic-typed-harness';
import { findBlob, putBlob, getBlobText } from '../storage/index.ts';
import { errorLogFacts } from '../streaming.ts';
import { isBlobRef, sha256Hex, type BlobRef } from './blob-ref.ts';
import { BLOB_PREFIX } from './blob-gc.ts';
import { finalSystemPromptHashOfTrace } from './prompt-hashes.ts';

/** UTF-8 named, so a browser that opens the blob decodes it as the prompt was written. */
export const PROMPT_BLOB_CONTENT_TYPE = 'text/plain; charset=utf-8';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The key a prompt with this hash is stored under: the shape the upload grant and the sweep use. */
export function promptBlobPathname(hash: string): string {
  return `${BLOB_PREFIX}${hash}.txt`;
}

/**
 * Store the run's final system prompt, unless its key already holds an
 * object. Never throws: a run whose prompt could not be stored still answers,
 * and its record carries the hash without a BlobRef.
 */
export async function storeRunPrompt(prompt: string): Promise<void> {
  const pathname = promptBlobPathname(sha256Hex(prompt));
  try {
    if (await findBlob(pathname)) return;
    await putBlob(pathname, prompt, PROMPT_BLOB_CONTENT_TYPE);
  } catch (err) {
    // Another run may have written the same key between the list and the put;
    // the driver refuses the second put, and the key is then held.
    try {
      if (await findBlob(pathname)) return;
    } catch {
      // Reported below, by the first failure's facts.
    }
    console.warn('[prompt-blob] the run\'s system prompt was not stored', errorLogFacts(err));
  }
}

/**
 * A BlobRef to the stored prompt with this hash, built from the store, or null
 * when no object is stored under its key or the stored bytes do not hash to it.
 */
export async function promptBlobRef(hash: string): Promise<BlobRef | null> {
  if (!HASH_PATTERN.test(hash)) return null;
  try {
    const found = await findBlob(promptBlobPathname(hash));
    if (!found) return null;
    const text = await getBlobText(found.url);
    if (text === null) return null;
    const bytes = new TextEncoder().encode(text);
    if (sha256Hex(bytes) !== hash) return null;
    return { ref: `blob:sha256:${hash}`, url: found.url, contentType: PROMPT_BLOB_CONTENT_TYPE, size: bytes.byteLength };
  } catch (err) {
    console.warn('[prompt-blob] the stored system prompt was not read', errorLogFacts(err));
    return null;
  }
}

/** What the publish route hands the packager as `skillMetadataOverride`. */
export interface RunPromptMetadata {
  systemPromptHash: string;
  mcpServerUrl?: string;
  skillText?: BlobRef;
}

/**
 * The skill metadata a run's own trace supports, with the prompt's BlobRef
 * when the store holds it. Called by the publish route only for a
 * `chat-flow-stream` publish that posts no override.
 *
 * The hash is the `skill_fetch` span's (the comparison), else the last one an
 * `llm_inference` span states (the executed run, which opens no `skill_fetch`
 * span). `mcpServerUrl` is stated only where the trace states one. Undefined,
 * so the packager extracts as before, for a trace that is a BlobRef, carries
 * its own prompt text (records before #411), or states no hash at all.
 */
export async function runPromptMetadata(trace: unknown): Promise<RunPromptMetadata | undefined> {
  if (trace === null || typeof trace !== 'object' || isBlobRef(trace)) return undefined;
  const fromSpan = extractSkillMetadata(trace as Record<string, unknown>);
  if (fromSpan.skillText !== undefined) return undefined;
  const hash = fromSpan.systemPromptHash ?? finalSystemPromptHashOfTrace(trace) ?? undefined;
  if (hash === undefined) return undefined;
  const ref = await promptBlobRef(hash);
  return {
    systemPromptHash: hash,
    ...(fromSpan.mcpServerUrl ? { mcpServerUrl: fromSpan.mcpServerUrl } : {}),
    ...(ref ? { skillText: ref } : {}),
  };
}
