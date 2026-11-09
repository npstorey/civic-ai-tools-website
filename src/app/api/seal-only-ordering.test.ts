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

/**
 * The publish dialog's option enclosing the radio at `radio`: from the nearest
 * `<Card` before it to the first `</Card>` after it (UX-1 P1: each option is a
 * P5 selectable card rendered as a <label>). Both ends must exist, and no other
 * card may open between them, so the block cannot run past its option.
 */
function optionBlock(source: string, radio: number, what: string): string {
  const start = source.lastIndexOf('<Card', radio);
  const end = source.indexOf('</Card>', radio);
  assert.ok(start > 0 && end > radio, `PublishEvidenceDialog.tsx: ${what} is not inside a <Card>`);
  assert.ok(!source.slice(radio, end).includes('<Card'), `PublishEvidenceDialog.tsx: ${what}'s card does not close before the next opens`);
  return source.slice(start, end);
}

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
  // Each option is a selectable card rendered as a <label> (UX-1 P1): its block
  // runs from the card's opening `<Card` to its `</Card>`, and the public
  // card's reason is its `disabledReason`, rendered inside that <label>.
  const publicRadio = at(dialog, "checked={visibility === 'public'}", where);
  const publicBlock = optionBlock(dialog, publicRadio, 'the public radio');
  assert.ok(publicBlock.includes('disabled={!publicChoice.available}'), `${where}: the public radio is not disabled when unavailable`);
  assert.ok(publicBlock.includes('disabledReason={publicChoice.available ? undefined : publicChoice.explanation}'), `${where}: the reason is not shown beside the public radio`);
  const sealRadio = at(dialog, "checked={visibility === 'sealed'}", where);
  const sealBlock = optionBlock(dialog, sealRadio, 'the Seal radio');
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

  // The Seal choice's description, inside the Seal option's card.
  const sealRadio = at(dialog, "checked={visibility === 'sealed'}", where);
  optionBlock(dialog, sealRadio, 'the Seal radio');
  const sealBlock = dialog.slice(sealRadio, dialog.indexOf('</Card>', sealRadio));
  assert.ok(sealBlock.includes('{sealedCopy.sealChoice}'), `${where}: the Seal choice does not render the module's wording`);

  // The sealed result's line above the address.
  const sealedResult = at(dialog, "resultVisibility === 'sealed' ? (", where);
  const resultBlock = dialog.slice(sealedResult, dialog.indexOf('</p>', sealedResult));
  assert.ok(resultBlock.includes('{sealedCopy.sealedResult}'), `${where}: the sealed result does not render the module's wording`);
});

test('#552 C3: the dashboard shows Publish disabled with the reason, from the page\'s props', () => {
  const tabs = read('../../components/dashboard/DashboardTabs.tsx');
  const where = 'DashboardTabs.tsx';
  // UX-2 P4a (relay 46, R2) moved the row's actions into a P2 menu, whose items
  // carry their reason as `disabledReason`, so this test pins the property, not
  // the inline button's shape: (1) the module is asked once; (2) there is one
  // enabled Publish path; (3) the seal-only item's reason is the module's
  // explanation; (4) the unsigned item carries its reason. Each part was shown
  // red on a mutation at that phase's gate.
  assert.ok(tabs.includes("import { sealedRecordPublishAffordance } from '@/lib/evidence/seal-only';"), `${where} decides the affordance itself`);
  assert.match(tabs, /signingConfigured = true, sealOnly = false \}: DashboardTabsProps\)/, `${where}: a mount that passes no setting must be unchanged`);
  assert.ok(tabs.includes('signingConfigured={signingConfigured} sealOnly={sealOnly}'), `${where} does not hand the setting to the records tab`);

  // (1) The module is asked once, on the page's props.
  assert.equal(count(tabs, 'sealedRecordPublishAffordance('), 1, `${where} asks the module more than once`);
  assert.ok(tabs.includes('const publishAffordance = sealedRecordPublishAffordance({ signingConfigured, sealOnly });'), `${where} does not ask the module`);
  assert.ok(!tabs.includes('{signingConfigured ? ('), `${where} still branches on signing alone`);

  // (2) One enabled Publish path: one place opens the publish dialog, and one
  // Publish item carries no reason, in the \`available\` branch.
  assert.equal(count(tabs, 'setPublishTarget(r)'), 1, `${where} offers Publish from more than one place`);
  const item = tabs.slice(at(tabs, 'function publishItem(', where), tabs.indexOf('\n}\n', at(tabs, 'function publishItem(', where)));
  const enabled = "if (publishAffordance.kind === 'available') return { id: 'publish', label: 'Publish' };";
  assert.ok(item.includes(enabled), `${where}: the enabled Publish item is not the \`available\` branch`);
  assert.equal(count(tabs, "label: 'Publish' }"), 1, `${where} has a second Publish item without a reason`);
  assert.equal(count(tabs, "id: 'publish'"), 3, `${where}: the Publish item is not the three branches of publishItem`);

  // (3) On a seal-only instance, the item's reason is the module's explanation.
  assert.ok(
    item.trimEnd().endsWith("return { id: 'publish', label: 'Publish', disabledReason: publishAffordance.explanation };"),
    `${where}: the seal-only Publish item does not carry publishAffordance.explanation`,
  );

  // (4) On an unsigned instance, the item carries the unsigned reason, today's words.
  assert.ok(
    item.includes("if (publishAffordance.kind === 'unsigned') return { id: 'publish', label: 'Publish', disabledReason: UNSIGNED_PUBLISH_REASON };"),
    `${where}: the unsigned Publish item does not carry its reason`,
  );
  const reason = /const UNSIGNED_PUBLISH_REASON =\s*'([^']+)';/.exec(tabs);
  assert.ok(reason && reason[1].startsWith('Publishing is unavailable'), `${where}: the unsigned reason is not today's words`);

  const page = read('../(app)/dashboard/page.tsx');
  assert.ok(page.includes("import { isSealOnly } from '@/lib/site-config';"), 'the dashboard page reads the setting from somewhere else');
  assert.ok(page.includes('sealOnly={isSealOnly()}'), 'the dashboard page does not pass the setting');
  assert.ok(page.includes('signingConfigured={isSigningConfigured()}'), 'the dashboard page stopped passing the signing state');
});

// R6 W2 (#632, C6): the publish routes stay outside the consent gate. A
// publish sends a record's content to the model endpoint (the adversarial
// evaluation) and dispatches no source tool; it stays inside the privacy
// page's model-endpoint row, and R8 may revisit it. This states the boundary
// so a gate added here is a decision, not a drift. (It holds at the base too:
// it pins an absence, and is not one of W2's reds.)
test('R6 W2 (C6): neither publish route reads the consent gate', () => {
  for (const file of [RECORDS, PUBLISH]) {
    assert.ok(!read(file).includes('consentInForce('), `${file} reads the consent gate; C6 keeps it outside`);
  }
});
