// #552 (anchor #555, P1, criteria 1 and 3) — where the two publish routes
// refuse under SITE_SEAL_ONLY, and how the signing-status route, the publish
// dialog, the dashboard and its page carry the setting to the reader.
//
// WHY SOURCE. The dialog, the dashboard and its page are JSX, which
// `--experimental-strip-types` cannot parse, so their use of the module is
// pinned here. The precedent is `portal-lock-ordering.test.ts`: ORDER is
// asserted as the relative position of calls in a straight-line handler. The
// BEHAVIOUR each position protects — what the setting reads as, what each gate
// refuses and with what, what the dialog and the dashboard are told — is
// driven in `src/lib/evidence/seal-only.test.ts`, through the same calls these
// sources are pinned to make. The two route handlers are additionally driven
// whole, under stubs that record every put, signing call, write, lookup and
// evaluation, in `seal-only-handlers-driven.test.ts`; the pins here stay,
// because a driven run sees only the calls its stubs record, and these name
// every call by position.
//
// WHAT MAKES THE ORDER ASSERTIONS ABLE TO FAIL. Each is a comparison of two
// positions that both must exist (`at` asserts presence), so deleting the
// refusal, or moving it below the first storage put, signing call, database
// write or evaluation (on `/publish`, below the record lookup), fails. Shown red
// on this phase's PR at the commit that landed these tests ahead of the
// wiring, and by moving the `/publish` refusal below the lookup.
//
// BLIND SPOT, stated. A source read cannot tell that the block it finds is the
// one that runs: a second, unreached copy above the writes would satisfy it,
// and so would a refusal whose `if` never holds. Each handler is a single
// straight-line function with one call to its gate (the count assertions pin
// that), and the gate is handed `isSealOnly()` itself, not a value computed
// elsewhere — what that call returns is the driven half. Nor can it see a
// write reached by a call whose name is not in the lists below: the lists are
// every storage, signing, database-write and evaluation call each handler
// makes at this commit, and a new one has to be added here by hand.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(HERE, relative), 'utf8');

function at(source: string, needle: string, where: string): number {
  const index = source.indexOf(needle);
  assert.ok(index > 0, `${where} should contain ${needle}`);
  return index;
}

const count = (source: string, needle: string) => source.split(needle).length - 1;

/** The refusal must return what the gate built, immediately after the call. */
function assertReturnsRefusal(source: string, call: string, where: string): void {
  const start = at(source, call, where) + call.length;
  assert.match(
    source.slice(start, start + 400),
    /^\s*if \(sealOnlyRefusal\) \{\s*return NextResponse\.json\(sealOnlyRefusal\.body, \{ status: sealOnlyRefusal\.status \}\);\s*\}/,
    `${where}: the refusal does not return the gate's body and status at once`,
  );
}

// --- POST /api/records -------------------------------------------------------

const RECORDS = 'evidence/route.ts';
const RECORDS_GATE = 'const sealOnlyRefusal = evaluateSealOnlyRecordsGate(isSealOnly(), visibility);';

test('#552 C1: POST /api/records resolves its visibility once, through the function the gate is driven with', () => {
  const source = read(RECORDS);
  assert.equal(count(source, 'resolveRequestedVisibility('), 1, `${RECORDS} resolves its visibility more than once`);
  assert.ok(source.includes('const requestedVisibility = resolveRequestedVisibility(body.visibility);'), `${RECORDS} does not resolve the body's visibility through resolveRequestedVisibility`);
  assert.ok(!source.includes('body.visibility === undefined'), `${RECORDS} still carries its own absent-means-public line`);
  assert.equal(count(source, 'evaluateSealOnlyRecordsGate('), 1, `${RECORDS} calls the seal-only gate other than once`);
  assert.ok(source.includes("import { isSealOnly } from '@/lib/site-config';"), `${RECORDS} reads the setting from somewhere else`);
});

test('#552 C1: POST /api/records refuses after resolving the visibility and before any write or signing', () => {
  const source = read(RECORDS);
  const refusal = at(source, RECORDS_GATE, RECORDS);
  assertReturnsRefusal(source, RECORDS_GATE, RECORDS);
  // After: the body is read, the visibility resolved and validated.
  for (const before of ['await request.json()', 'resolveRequestedVisibility(body.visibility)', 'const visibility: Visibility = requestedVisibility;', 'const gate = evaluateSealCommitGate();']) {
    assert.ok(refusal > at(source, before, RECORDS), `${RECORDS}: the refusal comes before ${before}`);
  }
  // Before: every storage put, signing call, database write and publication
  // the handler makes.
  for (const after of ['buildEvidencePackage(', 'putCommittedPackage(', 'putPackage(', 'signPackage(', 'getRfc3161Timestamp(', 'publishToRekor(', 'await resolveSlug(', 'db.insert(', 'emitPublicationPair(']) {
    assert.ok(refusal < at(source, after, RECORDS), `${RECORDS}: ${after} runs before the refusal`);
  }
});

// --- POST /api/records/:slug/publish -----------------------------------------

const PUBLISH = 'evidence/[slug]/publish/route.ts';
const PUBLISH_GATE = 'const sealOnlyRefusal = evaluateSealOnlyPublishGate(isSealOnly());';

test('#552 C1: POST /api/records/:slug/publish calls the seal-only gate once, on the setting itself', () => {
  const source = read(PUBLISH);
  assert.equal(count(source, 'evaluateSealOnlyPublishGate('), 1, `${PUBLISH} calls the seal-only gate other than once`);
  assert.ok(source.includes("import { isSealOnly } from '@/lib/site-config';"), `${PUBLISH} reads the setting from somewhere else`);
});

test('#552 C1: POST /api/records/:slug/publish refuses beside the signing gate, before the lookup and before the evaluation', () => {
  const source = read(PUBLISH);
  const refusal = at(source, PUBLISH_GATE, PUBLISH);
  assertReturnsRefusal(source, PUBLISH_GATE, PUBLISH);
  for (const before of ['hasPublishScope(auth)', 'const gate = evaluateSealCommitGate();']) {
    assert.ok(refusal > at(source, before, PUBLISH), `${PUBLISH}: the refusal comes before ${before}`);
  }
  // Before the lookup (so the refusal says nothing about whether a record
  // exists), the body, the stored package, the evaluation — which emits a
  // SIGNED attestation/evaluates/v1 node — and every write.
  for (const after of [
    '.from(evidenceRecords)',
    'resolveLifecycle(',
    'await request.json()',
    'getPackage(',
    'getMissingModelCredentialError(',
    'runAdversarialEval(',
    'emitEvaluationAttestation(',
    '.update(evidenceRecords)',
    'putPackage(',
    'emitPublicationPair(',
    'deletePackageBlob(',
  ]) {
    assert.ok(refusal < at(source, after, PUBLISH), `${PUBLISH}: ${after} runs before the refusal`);
  }
});

// --- What the reader is told -------------------------------------------------

test('#552 C3: the signing-status response carries the setting, as one more boolean and nothing else', () => {
  const source = read('evidence/signing-status/route.ts');
  assert.match(
    source,
    /NextResponse\.json\(\{\s*signingConfigured: evaluateSealCommitGate\(\) === null,\s*sealOnly: isSealOnly\(\),?\s*\}\)/,
    'signing-status does not answer { signingConfigured, sealOnly } from the gate and the setting',
  );
  assert.equal(count(source, 'NextResponse.json('), 1, 'signing-status answers in more than one place');
});

test('#552 C3: the dialog learns the setting from signing-status and shows the public choice disabled, with the reason', () => {
  const dialog = read('../../components/PublishEvidenceDialog.tsx');
  const where = 'PublishEvidenceDialog.tsx';
  assert.ok(dialog.includes("import { publicStateAvailability } from '@/lib/evidence/seal-only';"), `${where} decides availability itself`);

  // The setting arrives from the signing-status response.
  const fetchAt = at(dialog, "fetch('/api/records/signing-status')", where);
  const learn = at(dialog, 'setSealOnly(data.sealOnly === true);', where);
  assert.ok(learn > fetchAt && learn - fetchAt < 400, `${where} does not read sealOnly from the signing-status response`);

  // One decision, from the driven function, and the visibility sent is the
  // chosen one only while the public choice is available.
  assert.equal(count(dialog, 'publicStateAvailability('), 1);
  assert.ok(dialog.includes('const publicChoice = publicStateAvailability(sealOnly);'), `${where} does not ask the module`);
  assert.ok(dialog.includes("const visibility: Visibility = publicChoice.available ? chosenVisibility : 'sealed';"), `${where} can send "public" while the choice is unavailable`);
  assert.match(dialog, /body: JSON\.stringify\(\{[\s\S]*?\n\s+visibility,\n/, `${where} no longer sends the visibility explicitly`);

  // The public radio is disabled with the reason beside it; the Seal radio is not.
  const publicRadio = at(dialog, "checked={visibility === 'public'}", where);
  const publicBlock = dialog.slice(dialog.lastIndexOf('<input', publicRadio), dialog.indexOf('</label>', publicRadio));
  assert.ok(publicBlock.includes('disabled={!publicChoice.available}'), `${where}: the public radio is not disabled when unavailable`);
  assert.ok(publicBlock.includes('publicChoice.explanation'), `${where}: the reason is not shown beside the public radio`);
  const sealRadio = at(dialog, "checked={visibility === 'sealed'}", where);
  const sealBlock = dialog.slice(dialog.lastIndexOf('<input', sealRadio), dialog.indexOf('</label>', sealRadio));
  assert.ok(!sealBlock.includes('disabled'), `${where}: the Seal radio can be disabled`);
  assert.ok(sealRadio < publicRadio, `${where}: the radios moved`);
});

test('#552 C3: the dialog\'s sealed-state sentences come from the module, on the same setting', () => {
  const dialog = read('../../components/PublishEvidenceDialog.tsx');
  const where = 'PublishEvidenceDialog.tsx';
  assert.ok(/import \{[^}]*\bsealedStateCopy\b[^}]*\} from '@\/lib\/evidence\/seal-only';/.test(dialog), `${where} does not import sealedStateCopy`);
  assert.equal(count(dialog, 'sealedStateCopy('), 1);
  assert.ok(dialog.includes('const sealedCopy = sealedStateCopy(sealOnly);'), `${where} does not ask the module on the setting it learned`);
  // No sentence in the dialog promises publication from the dashboard on its own.
  assert.ok(!/from\s+your\s+dashboard/.test(dialog), `${where} still carries its own dashboard sentence`);

  // The Seal choice's description.
  const sealRadio = at(dialog, "checked={visibility === 'sealed'}", where);
  const sealBlock = dialog.slice(sealRadio, dialog.indexOf('</label>', sealRadio));
  assert.ok(sealBlock.includes('{sealedCopy.sealChoice}'), `${where}: the Seal choice does not render the module's wording`);

  // The sealed result's line above the address.
  const sealedResult = at(dialog, "resultVisibility === 'sealed' ? (", where);
  const resultBlock = dialog.slice(sealedResult, dialog.indexOf('</p>', sealedResult));
  assert.ok(resultBlock.includes('{sealedCopy.sealedResult}'), `${where}: the sealed result does not render the module's wording`);
});

test('#552 C3: the dashboard shows Publish disabled with the reason, from the page\'s props', () => {
  const tabs = read('../../components/dashboard/DashboardTabs.tsx');
  const where = 'DashboardTabs.tsx';
  assert.ok(tabs.includes("import { sealedRecordPublishAffordance } from '@/lib/evidence/seal-only';"), `${where} decides the affordance itself`);
  assert.match(tabs, /signingConfigured = true, sealOnly = false \}: DashboardTabsProps\)/, `${where}: a mount that passes no setting must be unchanged`);
  assert.ok(tabs.includes('signingConfigured={signingConfigured} sealOnly={sealOnly}'), `${where} does not hand the setting to the records tab`);
  assert.equal(count(tabs, 'sealedRecordPublishAffordance('), 1);
  assert.ok(tabs.includes('const publishAffordance = sealedRecordPublishAffordance({ signingConfigured, sealOnly });'), `${where} does not ask the module`);
  assert.ok(!tabs.includes('{signingConfigured ? ('), `${where} still branches on signing alone`);

  // One enabled Publish, inside the `available` branch; then the unsigned
  // tier's disabled action as before; then the seal-only one, disabled, with
  // the reason and the label.
  assert.equal(count(tabs, 'setPublishTarget(r)'), 1, `${where} offers Publish from more than one place`);
  const available = at(tabs, "{publishAffordance.kind === 'available' ? (", where);
  const enabled = at(tabs, 'setPublishTarget(r)', where);
  const unsigned = at(tabs, "publishAffordance.kind === 'unsigned' ? (", where);
  const unsignedLabel = at(tabs, 'Publish unavailable (unsigned)', where);
  const reason = at(tabs, 'title={publishAffordance.explanation}', where);
  const label = at(tabs, '{publishAffordance.label}', where);
  assert.ok(available < enabled && enabled < unsigned && unsigned < unsignedLabel && unsignedLabel < reason && reason < label, `${where}: the three branches are out of order`);
  const sealOnlyButton = tabs.slice(tabs.lastIndexOf('<button', reason), label);
  assert.match(sealOnlyButton, /^<button\s+disabled\b/, `${where}: the seal-only action is not a disabled button`);

  const page = read('../(app)/dashboard/page.tsx');
  assert.ok(page.includes("import { isSealOnly } from '@/lib/site-config';"), 'the dashboard page reads the setting from somewhere else');
  assert.ok(page.includes('sealOnly={isSealOnly()}'), 'the dashboard page does not pass the setting');
  assert.ok(page.includes('signingConfigured={isSigningConfigured()}'), 'the dashboard page stopped passing the signing state');
});
