/**
 * Generate an Ed25519 signing keypair for evidence packages.
 *
 * Usage: node --experimental-strip-types scripts/generate-signing-key.ts
 *
 * SECRET HYGIENE (#258 E2): this script never prints the private key to
 * stdout, logs, or anywhere else it could be scraped from a terminal
 * scrollback or a Claude Code session transcript. It writes
 * `EVIDENCE_SIGNING_KEY=<base64 DER PKCS8>` to a local file, created with
 * 0600 permissions, in the current working directory. Copy that line into
 * your secret manager (docs/instance-setup.md §1), then delete the file.
 *
 * The output filename is deliberately NOT `.env*`-shaped: an `.env*`-fenced
 * agent-session hook would hang on a matching path. It is also listed in
 * `.gitignore` so an accidental `git add -A` cannot commit it.
 *
 * Only the PUBLIC key and setup guidance print to stdout — safe to paste
 * anywhere, since the public key is what a verifier checks a signature
 * against and is embedded in every package this instance signs.
 *
 * A keypair alone does not make an instance a signing publisher. Two more
 * things are required and NEITHER has a default:
 *   - `EVIDENCE_KEY_ID` — the kid naming this key's entry in your trust
 *     registry. With the key set but no kid, the instance refuses to seal
 *     or publish (`signing_key_id_missing`) rather than emit a kid it was
 *     never given.
 *   - The instance-identity set (`EVIDENCE_SITE_ORIGIN`,
 *     `EVIDENCE_SIGNER_BINDING_TIER`/`_IDENTIFIER`/`_DISPLAY_NAME`,
 *     `EVIDENCE_PLATFORM_AGENT_TITLE`) — with the signing pair set but any
 *     of these absent, every seal/publish attempt refuses
 *     (`instance_identity_missing`).
 *
 * See docs/instance-setup.md for the kid convention, the trust-registry
 * template, and the full environment-variable table.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** Deliberately not `.env*`-shaped — see the header comment. */
export const KEY_FILE_NAME = 'signing-key.local.txt';

function main(): void {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const privB64 = privDer.toString('base64');
  const pubB64 = pubDer.toString('base64');

  const keyFilePath = path.join(process.cwd(), KEY_FILE_NAME);
  const fileContents =
    `# Ed25519 evidence signing key — generated ${new Date().toISOString()}\n` +
    `# SENSITIVE — the EVIDENCE_SIGNING_KEY line below is a private key.\n` +
    `# Copy it into your secret manager (docs/instance-setup.md §1), then\n` +
    `# delete this file. It is listed in .gitignore, but confirm before\n` +
    `# pushing — a pre-push scan is not a substitute for deleting it.\n` +
    `EVIDENCE_SIGNING_KEY=${privB64}\n` +
    `EVIDENCE_PUBLIC_KEY=${pubB64}\n`;

  // `mode` at creation is still subject to umask; chmod afterward guarantees
  // 0600 regardless of the caller's umask setting.
  fs.writeFileSync(keyFilePath, fileContents, { mode: 0o600 });
  fs.chmodSync(keyFilePath, 0o600);

  console.log('=== Evidence Package Signing Keypair (Ed25519) ===\n');
  console.log(`Private key written to: ${keyFilePath}`);
  console.log('File permissions: 0600 (owner read/write only).');
  console.log(
    'Not printed here, not logged: copy the EVIDENCE_SIGNING_KEY line from',
  );
  console.log('that file into your secret manager, then delete the file.\n');
  console.log('Public key (safe to share — embedded in every package this key signs):');
  console.log(pubB64);
  console.log('');
  console.log('This keypair alone does not make an instance a signing publisher.');
  console.log('Next (docs/instance-setup.md):');
  console.log('  1. Pick a kid, e.g. platform:evidence-2026-08 (§2).');
  console.log("  2. Publish a trust-registry entry for this public key under that kid (§3).");
  console.log('  3. Set EVIDENCE_KEY_ID to that kid — no default. With EVIDENCE_SIGNING_KEY');
  console.log('     set but EVIDENCE_KEY_ID unset, this instance refuses to seal or publish');
  console.log('     (signing_key_id_missing).');
  console.log('  4. Set the instance-identity set too — EVIDENCE_SITE_ORIGIN,');
  console.log('     EVIDENCE_SIGNER_BINDING_TIER/_IDENTIFIER/_DISPLAY_NAME, and');
  console.log('     EVIDENCE_PLATFORM_AGENT_TITLE — also no default (§4).');
}

// Run main() only when invoked as a script, not when imported (the test
// imports KEY_FILE_NAME without wanting a keypair generated as a side
// effect) — same guard as scripts/preflight-env.mjs.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
