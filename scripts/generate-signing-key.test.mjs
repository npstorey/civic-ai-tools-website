// Tests for scripts/generate-signing-key.ts (#258 E2).
//
// The script must never print the private key to stdout — it writes
// EVIDENCE_SIGNING_KEY=... to a local, git-ignored, 0600-permission file
// instead. Spawned as a CHILD PROCESS in a throwaway temp directory, exactly
// the command an operator runs — the same idiom
// src/lib/evidence/instance-rehearsal.test.ts uses for
// scripts/rehearse-instance-identity.ts.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY_FILE_NAME } from './generate-signing-key.ts';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './generate-signing-key.ts',
);

test('never prints the private key to stdout; writes it to a 0600 local file instead', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-signing-key-test-'));
  try {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    assert.equal(
      result.status,
      0,
      `script exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    // --- stdout carries guidance but no private-key material --------------
    // Mentioning the variable NAME (e.g. "copy the EVIDENCE_SIGNING_KEY
    // line") is fine; an actual assignment — the name followed by `=` and a
    // base64-looking value — is the thing that must never appear.
    assert.doesNotMatch(result.stdout, /EVIDENCE_SIGNING_KEY=[A-Za-z0-9+/]/);
    assert.match(result.stdout, /Public key/i);
    assert.match(result.stdout, /EVIDENCE_KEY_ID/);
    assert.match(result.stdout, /signing_key_id_missing/);
    assert.match(result.stdout, /docs\/instance-setup\.md/);

    // --- the private key landed in the file, not the terminal -------------
    const keyFilePath = path.join(tmpDir, KEY_FILE_NAME);
    assert.equal(fs.existsSync(keyFilePath), true, 'expected key file was not created');

    const stat = fs.statSync(keyFilePath);
    // Mask off the file-type bits; compare only the permission bits.
    assert.equal(
      stat.mode & 0o777,
      0o600,
      `expected 0600, got ${(stat.mode & 0o777).toString(8)}`,
    );

    const fileContents = fs.readFileSync(keyFilePath, 'utf-8');
    assert.match(fileContents, /^EVIDENCE_SIGNING_KEY=[A-Za-z0-9+/=]+$/m);
    assert.match(fileContents, /^EVIDENCE_PUBLIC_KEY=[A-Za-z0-9+/=]+$/m);

    // The public key printed to stdout must be the SAME keypair as the file
    // — only the private half is withheld from stdout, not a different key.
    const pubMatch = fileContents.match(/^EVIDENCE_PUBLIC_KEY=([A-Za-z0-9+/=]+)$/m);
    assert.ok(pubMatch, 'file did not contain EVIDENCE_PUBLIC_KEY');
    assert.ok(
      result.stdout.includes(pubMatch[1]),
      'stdout did not echo the same public key written to the file',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('the key filename is not .env*-shaped and is covered by .gitignore', () => {
  assert.doesNotMatch(KEY_FILE_NAME, /^\.env/);

  const gitignorePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../.gitignore',
  );
  const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
  assert.match(
    gitignore,
    new RegExp(`^${KEY_FILE_NAME.replace(/\./g, '\\.')}$`, 'm'),
    'the key filename must be listed in .gitignore',
  );
});
