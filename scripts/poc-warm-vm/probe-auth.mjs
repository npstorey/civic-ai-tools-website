#!/usr/bin/env node
/**
 * POC MCP-WARM-VM step 0 — auth reachability probe.
 *
 * Answers ONE question with no secret in its output: can a Vercel Sandbox
 * API call authenticate from the owner's terminal, and by which of the two
 * mechanisms `src/lib/sandbox/vercel-sandbox.ts` documents —
 *   (a) VERCEL_OIDC_TOKEN, or
 *   (b) the VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID triple.
 *
 * SECRET HYGIENE: prints only the NAME of each variable and the word
 * present/absent. Never a value, a length, a prefix or a hash. The live
 * check is `Sandbox.list({ ... })`, a read-only call that creates nothing
 * and is not billed as a creation.
 */
const NAMES = ['VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'];

const present = (n) => typeof process.env[n] === 'string' && process.env[n].trim().length > 0;

console.log('[probe-auth] variable presence (names only, never values):');
for (const n of NAMES) console.log(`  ${n}: ${present(n) ? 'present' : 'absent'}`);

const triple = present('VERCEL_TOKEN') && present('VERCEL_TEAM_ID') && present('VERCEL_PROJECT_ID');
const oidc = present('VERCEL_OIDC_TOKEN');
console.log(`[probe-auth] triple complete: ${triple}; OIDC token: ${oidc}`);

if (!triple && !oidc) {
  console.log('[probe-auth] RESULT: NO-AUTH — neither mechanism is available in this environment.');
  process.exit(2);
}

const { Sandbox } = await import('@vercel/sandbox');
const auth = triple
  ? {
      token: process.env.VERCEL_TOKEN.trim(),
      teamId: process.env.VERCEL_TEAM_ID.trim(),
      projectId: process.env.VERCEL_PROJECT_ID.trim(),
    }
  : {};

try {
  const res = await Sandbox.list({ ...auth });
  // Parsed WRAPPER: the rows are at `.json.sandboxes`. `.sandboxes` is always
  // undefined, so `?? 0` would report a confident "0 sandboxes" whether or not
  // the call authenticated — a probe that cannot fail.
  const rows = res?.json?.sandboxes;
  if (!Array.isArray(rows)) {
    console.log(`[probe-auth] RESULT: UNPROVEN — no sandboxes array in the response (keys: ${res && Object.keys(res)}).`);
    process.exit(1);
  }
  console.log(`[probe-auth] Sandbox.list() OK via ${triple ? 'triple' : 'OIDC'} — ${rows.length} sandbox(es) visible to this scope.`);
  for (const s of rows) {
    console.log(`    ${s.id}  status=${s.status}  vcpus=${s.vcpus}  memory=${s.memory}MB  runtime=${s.runtime}`);
  }
  console.log('[probe-auth] RESULT: PASS — the sandbox API authenticates from here.');
} catch (err) {
  // Error messages from the SDK name endpoints and status codes, not secrets.
  console.log(`[probe-auth] RESULT: FAIL — ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  process.exit(1);
}
