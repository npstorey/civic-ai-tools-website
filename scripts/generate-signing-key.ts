/**
 * Generate an Ed25519 signing keypair for evidence packages.
 *
 * Usage: npx tsx scripts/generate-signing-key.ts
 *
 * Copy the EVIDENCE_SIGNING_KEY value into your .env.local file.
 * The public key is embedded in signed evidence packages and used for verification.
 */

import crypto from 'crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
const pubDer = publicKey.export({ format: 'der', type: 'spki' });

console.log('=== Evidence Package Signing Keypair (Ed25519) ===\n');
console.log('Add to .env.local:\n');
console.log(`EVIDENCE_SIGNING_KEY=${privDer.toString('base64')}`);
console.log(`EVIDENCE_PUBLIC_KEY=${pubDer.toString('base64')}`);
console.log('\nPublic key (for independent verification):');
console.log(pubDer.toString('base64'));
