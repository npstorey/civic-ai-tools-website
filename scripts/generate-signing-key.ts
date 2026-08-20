/**
 * Generate an Ed25519 signing keypair for record packages.
 *
 * Usage: node --experimental-strip-types scripts/generate-signing-key.ts
 *
 * WHICH NAMES THIS WRITES, and why a writer needs a rule of its own. Everything
 * that READS these variables accepts two spellings since the 2026-08-19
 * vocabulary settlement (Appendix J of the Typed Standards specification;
 * civic-ai-tools#160): the canonical `PUBLISHER_*` first, the prior-era
 * `EVIDENCE_*` as a fallback. A writer cannot be "both" — it has to pick one
 * name to put in a file. It writes the CANONICAL one, because the file it
 * produces is what an operator copies into a secret manager and keeps for
 * years, and because emitting the retiring name would manufacture new work for
 * the flip. The prior-era spelling is named in the output so an operator who
 * meets it in a deployment guide recognizes it.
 *
 * ONE CAVEAT WORTH STATING, because it is the case where the canonical name
 * does NOT reach the app: the bundled `docker-compose.yml` passes variables
 * through by explicit name, and its `environment:` map still lists the
 * prior-era spellings. On that deployment path — and only there — supply the
 * key under `EVIDENCE_SIGNING_KEY` until the compose file flips. Every other
 * path (a hosting platform's environment, a shell, a systemd unit) delivers
 * whatever name you set, and the app honors both.
 *
 * SECRET HYGIENE (#258 E2): this script never prints the private key to
 * stdout, logs, or anywhere else it could be scraped from a terminal
 * scrollback or a Claude Code session transcript. It writes
 * `PUBLISHER_SIGNING_KEY=<base64 DER PKCS8>` to a local file, created with
 * 0600 permissions, in the current working directory. Copy that line into
 * your secret manager (docs/instance-setup.md §1), then delete the file.
 * ONE private-key line only: writing the same secret twice under two names
 * would double the surface a leak has to cover, which no naming convenience
 * is worth.
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
 *   - `PUBLISHER_KEY_ID` — the kid naming this key's entry in your trust
 *     registry. With the key set but no kid, the instance refuses to seal
 *     or publish (`signing_key_id_missing`) rather than emit a kid it was
 *     never given.
 *   - The instance-identity set (`PUBLISHER_SITE_ORIGIN`,
 *     `PUBLISHER_SIGNER_BINDING_TIER`/`_IDENTIFIER`/`_DISPLAY_NAME`,
 *     `PUBLISHER_PLATFORM_AGENT_TITLE`) — with the signing pair set but any
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
// The canonical names come from the same census the readers use, so the
// writer cannot drift from them. Relative and extension-bearing: this script
// runs under `node --experimental-strip-types`, which resolves neither the
// `@/` alias nor extensionless specifiers.
import {
  canonicalEnvName,
  priorEraEnvName,
} from '../src/lib/publisher-env.ts';

/** Deliberately not `.env*`-shaped — see the header comment. */
export const KEY_FILE_NAME = 'signing-key.local.txt';

function main(): void {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const privB64 = privDer.toString('base64');
  const pubB64 = pubDer.toString('base64');

  const keyFilePath = path.join(process.cwd(), KEY_FILE_NAME);
  const signingKeyVar = canonicalEnvName('SIGNING_KEY');
  const publicKeyVar = canonicalEnvName('PUBLIC_KEY');
  const fileContents =
    `# Ed25519 record signing key — generated ${new Date().toISOString()}\n` +
    `# SENSITIVE — the ${signingKeyVar} line below is a private key.\n` +
    `# Copy it into your secret manager (docs/instance-setup.md §1), then\n` +
    `# delete this file. It is listed in .gitignore, but confirm before\n` +
    `# pushing — a pre-push scan is not a substitute for deleting it.\n` +
    `# The prior-era names ${priorEraEnvName('SIGNING_KEY')} /\n` +
    `# ${priorEraEnvName('PUBLIC_KEY')} are still read, so an environment\n` +
    `# already using them keeps working; rename when convenient.\n` +
    `${signingKeyVar}=${privB64}\n` +
    `${publicKeyVar}=${pubB64}\n`;

  // `mode` at creation is still subject to umask; chmod afterward guarantees
  // 0600 regardless of the caller's umask setting.
  fs.writeFileSync(keyFilePath, fileContents, { mode: 0o600 });
  fs.chmodSync(keyFilePath, 0o600);

  console.log('=== Record Package Signing Keypair (Ed25519) ===\n');
  console.log(`Private key written to: ${keyFilePath}`);
  console.log('File permissions: 0600 (owner read/write only).');
  console.log(
    `Not printed here, not logged: copy the ${signingKeyVar} line from`,
  );
  console.log('that file into your secret manager, then delete the file.\n');
  console.log('Public key (safe to share — embedded in every package this key signs):');
  console.log(pubB64);
  console.log('');
  console.log('This keypair alone does not make an instance a signing publisher.');
  console.log('Next (docs/instance-setup.md):');
  console.log('  1. Pick a kid, e.g. platform:evidence-2026-08 (§2).');
  console.log("  2. Publish a trust-registry entry for this public key under that kid (§3).");
  console.log(`  3. Set ${canonicalEnvName('KEY_ID')} to that kid — no default. With`);
  console.log(`     ${signingKeyVar} set but the key id unset, this instance refuses to`);
  console.log('     seal or publish (signing_key_id_missing).');
  console.log(`  4. Set the instance-identity set too — ${canonicalEnvName('SITE_ORIGIN')},`);
  console.log('     PUBLISHER_SIGNER_BINDING_TIER/_IDENTIFIER/_DISPLAY_NAME, and');
  console.log(`     ${canonicalEnvName('PLATFORM_AGENT_TITLE')} — also no default (§4).`);
  console.log('');
  console.log('Prior-era names: every variable above also answers to its EVIDENCE_*');
  console.log('spelling (EVIDENCE_KEY_ID, EVIDENCE_SITE_ORIGIN, and so on) — both work,');
  console.log('and the PUBLISHER_* form is the one to set from here on. The bundled');
  console.log('docker-compose.yml still passes through the EVIDENCE_* names only, so on');
  console.log('that deployment path use those until it flips.');
}

// Run main() only when invoked as a script, not when imported (the test
// imports KEY_FILE_NAME without wanting a keypair generated as a side
// effect) — same guard as scripts/preflight-env.mjs.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
