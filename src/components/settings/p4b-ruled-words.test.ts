// UX-2 P4b, criterion 3 (M6): every string the words table assigns to parts B,
// C, D and F equals the research check's text, byte for byte.
//
// THE SOURCE. Planning `temp/ux-2/research-check-2-report.md` (sha256
// 0547a34b…0e98), ruled R1 = A, ASK1 = A and ASK2 = B; the first check's rows
// X22a, X22b and X22d where the second does not re-word them. Each REVISE row's
// paste-ready text, or the proposal where the verdict is KEEP, is written out
// below as a literal, with its item number. Where an item names a condition the
// constant carries its resolved form (item 13's one pointer; item 37's
// Allow-all half dropped, since the card shows no Allow-all control; B4c with
// S4's clause, since P4b builds "no further pause in this run").
//
// THE NAMES. A constant's name is this test's choice where the item adds a
// string the code does not hold yet (`SETTINGS_TEXT`, `sourcesShownLine`,
// `DONT_ALLOW_LINE`, `CONSENT_CARD.changeLine`, `CONSENT_STEP_TEXT.allowedAll`
// and the rest); the words are the ruling's.
//
// WHAT MAKES IT ABLE TO FAIL. At the base none of the new names exists and every
// re-worded constant holds today's words, each of which differs from the ruled
// text. The privacy golden is read line by line: five lines must move and the
// rest, hashed at the base, must not.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONSENT_SURFACE_STUBS, SRC, registerSurfaceHooks } from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const copy = await load('lib/sources/copy.ts');
const { CONSENT_STEP_TEXT: STEP } = await load('components/answer-view/ConsentStep.tsx');
const { friendlyStreamError } = await load('lib/streaming.ts');

// --- The ruled words ---------------------------------------------------------------------------

// Part B: the overlay and the tab.
const SETTINGS_HEADING = 'Settings'; // X22a, X22b
const LEDE_ACCOUNT = 'Your data sources and your consent, kept on your account. A change applies from your next question.'; // X22b
const LEDE_COOKIE = 'Your data sources and your consent, kept in a cookie for this browser session. A change applies from your next question.'; // 19
const TAB_DATA_SOURCES = 'Data sources'; // 45
const TAB_ABOUT = 'About these settings'; // 6-7
const SEARCH_LABEL = 'Search data sources'; // 17
const NO_MATCH = 'No data source matches.'; // 22
const SHOWN = (n: number, m: number) => `${n} of ${m} sources shown`; // 24
const ABOUT_KEPT_WITH = 'If you are signed in, your consent is kept on your account. If not, it is kept in a cookie until this browser session ends. The privacy page names the cookie.'; // 43
const ABOUT_KEPT_WITHOUT = 'Your consent is kept in a cookie until this browser session ends. The privacy page names the cookie.'; // 43
const POINTER = 'Data source settings'; // 10
const TAB_SENTENCE = 'Your data sources are set in Data source settings.'; // 41 (X22d)

// Part C: the card.
const DONT_ALLOW = "Don't allow"; // 8
const ALLOW_ALL = 'Allow all data sources'; // 9
const CARD_LEAD = [
  'To answer, this site sends your question to a model service, and sends the searches the model writes to the data sources that are On.',
  'Your question is not sent beyond this site before you answer.',
]; // 34: the ruled CARD_LEAD, byte for byte
const EFFECT = 'Allow: your question is sent to the model service. A data source is used only if it is On, or if it is set to Ask first and you allow it when asked. Don\'t allow: nothing is sent. You are asked again when you send a question.'; // 37/48, without the Allow-all half
const ITEM_11 = "Don't allow: nothing is sent. You are asked again when you send a question."; // 11, carried by 37 (M3)
const ASK1_LINE = 'You can change or withdraw this in Data source settings.'; // ASK1 = A
const DONT_ALLOW_LINE = "You chose Don't allow. Nothing was sent. Edit this question or write a new one, and you will be asked again before it is sent."; // 46

// Part D: the pause.
const CHOICES = "Allow: this question is sent to it, and it is turned On for later questions. Don't allow: nothing is sent to it, and it is turned Off for later questions. Allow all data sources: every data source is turned On, and this question goes on without asking again."; // 20, 39, B4c with S4's clause
const DECLINED = "You chose Don't allow. Nothing is sent to it, and it is Off now."; // 13, 21, 39
const AFTER_CHOICES = "Allow: it is turned On for later questions. Don't allow: it is turned Off for later questions."; // 39
const DECLINED_AFTER = "You chose Don't allow. It is Off for later questions."; // 39
const STILL = 'You can still answer for later questions.'; // 39: unchanged
const ALLOWED_ALL = 'You chose Allow all data sources. Every data source is On now.'; // B4b
const CHANGE = 'You can change this in Data source settings at any time.'; // 13 (56), 40
const NEXT_QUESTION = 'You can turn it On in Data source settings for your next question.'; // 40
const ALLOWED_NOT_MOVED = 'You chose Allow. This question is sent to it, but it could not be turned On for later questions. You can turn it On in Data source settings.'; // 40
const ALLOWED_AFTER_NOT_MOVED = 'You chose Allow, but it could not be turned On. You can turn it On in Data source settings.'; // 40
const FAILED = 'Your answer could not be saved. You can set this source in Data source settings.'; // 40
const PRIVACY_777 = 'The source is not used for that question. You can turn it On in Data source settings for your next question.'; // 40
const ASK_FIRST_WITH_PAUSE = "Ask first: nothing is sent to this source until you turn it On, here or when the site asks you during a question. If you choose Allow then, it stays On for later questions. If you choose Don't allow, it is turned Off."; // 54

// Part E: the refusal (42/50), read here because it is a "panel" sentence of item 40.
const NO_SOURCES_ON = 'Every data source is set to Off or Ask first, so nothing was sent. Turn a source On in Data source settings, then ask again.';

// Part F: the panel and privacy sentences.
const WITHDRAW = 'To withdraw consent, open Data source settings.'; // 40 (X2c): one sentence for both
// Ruled W1 (relay 26): item 40's place word plus today's ruled panel phrase, true while the panel still shows the
// notices; P3b drops "and in the panel beside the question box" when it removes the panel.
const NOTIFY_LAST = 'We tell you in Data source settings and in the panel beside the question box, until you dismiss it.'; // 40 (X2d), W1
const NOTIFY_FIRST = 'A recipient may also be removed, or say it keeps less. If your answer is kept on your account, we tell you and do not ask again. If it is kept in a cookie, we may ask again instead.';
const X2B = 'You can set each data source to On, Ask first or Off in Data source settings at any time.'; // 41 (X2b)

// --- Part B ------------------------------------------------------------------------------------

test('criterion 3 (B): the overlay\'s heading, ledes, sub-page names, search, count, empty line and the About words equal the ruled text', () => {
  const s = copy.SETTINGS_TEXT as Mod | undefined;
  assert.ok(s, 'copy.ts exports no SETTINGS_TEXT');
  assert.equal(s!.heading, SETTINGS_HEADING, 'X22a/X22b: the heading');
  assert.equal(s!.ledeWithAccount, LEDE_ACCOUNT, 'X22b: the signed-in lede');
  assert.equal(s!.ledeCookie, LEDE_COOKIE, 'item 19: the signed-out lede');
  assert.equal(s!.tabs?.dataSources, TAB_DATA_SOURCES, 'item 45: the Data sources sub-page');
  assert.equal(s!.tabs?.about, TAB_ABOUT, 'items 6-7: About these settings');
  assert.equal(s!.search, SEARCH_LABEL, 'item 17: the search field\'s name');
  assert.equal(s!.noMatch, NO_MATCH, 'item 22: the empty line');
  assert.equal(s!.aboutKeptWithAccounts, ABOUT_KEPT_WITH, 'item 43, with accounts');
  assert.equal(s!.aboutKeptWithoutAccounts, ABOUT_KEPT_WITHOUT, 'item 43, without accounts');
  assert.equal(s!.link, POINTER, 'item 10: the pointer\'s link text');
  assert.equal(s!.tabSentence, TAB_SENTENCE, 'item 41 (X22d): the dashboard Sources tab\'s sentence');
  assert.equal(typeof copy.sourcesShownLine, 'function', 'copy.ts exports no sourcesShownLine');
  assert.equal(copy.sourcesShownLine(3, 13), SHOWN(3, 13), 'item 24: the count line');
});

test('criterion 3 (B, L6): item 43 is new constants: KEPT_* and the privacy page keep the ruled sentences', () => {
  assert.equal(copy.KEPT_WITH_ACCOUNTS, 'If you are signed in, we keep your answer on your account. If not, we keep it in a cookie, named below, until this browser session ends.');
  assert.equal(copy.KEPT_WITHOUT_ACCOUNTS, 'We keep your answer in a cookie, named below, until this browser session ends.');
  assert.notEqual(copy.SETTINGS_TEXT?.aboutKeptWithAccounts, copy.KEPT_WITH_ACCOUNTS, 'item 43\'s words are KEPT_WITH_ACCOUNTS itself');
});

// --- Part C ------------------------------------------------------------------------------------

test('criterion 3 (C): the card\'s lead, effect, ASK1 line, decline word, pointer and after-line equal the ruled text', () => {
  const card = copy.CONSENT_CARD as Mod;
  assert.deepEqual([...card.lead], CARD_LEAD, 'item 34: CARD_LEAD, byte for byte');
  assert.equal(card.effect, EFFECT, 'items 37/48: CARD_EFFECT');
  assert.ok(!String(card.effect).includes(ALLOW_ALL), 'item 37: the card shows no Allow-all control, so its effect carries no Allow-all half');
  assert.ok(String(card.effect).includes(ITEM_11), 'M3: item 11\'s words are carried by item 37\'s Don\'t-allow half');
  assert.equal(card.changeLine, ASK1_LINE, 'ASK1 = A: the line above the buttons');
  assert.equal(card.decline, DONT_ALLOW, 'item 8: the decline button');
  assert.equal(card.settingsLink, POINTER, 'item 10: the card\'s link');
  assert.equal(copy.DONT_ALLOW_LINE, DONT_ALLOW_LINE, 'item 46: the card\'s after-line');
});

test('criterion 3 (C, F): the privacy page\'s "How consent works" carries item 38 and X2b', () => {
  const how = (copy.PRIVACY_CONSENT_SECTIONS as Array<{ heading: string; sentences: string[] }>).find((s) => s.heading === 'How consent works');
  assert.ok(how, 'premise: the privacy page has "How consent works"');
  assert.ok(how!.sentences.includes(EFFECT), `items 38/49: ALLOW_EFFECT is not item 37's words: ${JSON.stringify(how!.sentences)}`);
  assert.ok(how!.sentences.includes(X2B), `item 41 (X2b): ${JSON.stringify(how!.sentences)}`);
  assert.ok(!how!.sentences.some((s) => s.includes('Not now') || s.includes('the panel')), 'the old sentences remain');
});

// --- Part D ------------------------------------------------------------------------------------

test('criterion 3 (D): the pause\'s sentences equal the ruled text', () => {
  assert.equal(STEP.choices, CHOICES, 'items 20, 39, B4c (with S4\'s clause): choices');
  assert.equal(STEP.declined, DECLINED, 'items 13, 21, 39: declined');
  assert.equal(STEP.afterChoices, AFTER_CHOICES, 'item 39: afterChoices');
  assert.equal(STEP.declinedAfter, DECLINED_AFTER, 'item 39: declinedAfter');
  assert.equal(STEP.stillAnswer, STILL, 'item 39: stillAnswer, unchanged');
  assert.equal(STEP.allowedAll, ALLOWED_ALL, 'B4b: allowedAll');
  assert.equal(STEP.change, CHANGE, 'items 13, 40: change');
  assert.equal(STEP.nextQuestion, NEXT_QUESTION, 'item 40: nextQuestion');
  assert.equal(STEP.allowedNotMoved, ALLOWED_NOT_MOVED, 'item 40: allowedNotMoved');
  assert.equal(STEP.allowedAfterNotMoved, ALLOWED_AFTER_NOT_MOVED, 'item 40: allowedAfterNotMoved');
  assert.equal(STEP.failed, FAILED, 'item 40: failed');
  assert.equal(copy.ASK_FIRST_MEANS_WITH_PAUSE, ASK_FIRST_WITH_PAUSE, 'item 54');
  assert.equal(copy.ALLOW_ALL_SOURCES, ALLOW_ALL, 'item 9: the third button');
});

test('criterion 3 (D): no pause sentence names "the panel" or "Not now"', () => {
  for (const [name, value] of Object.entries(STEP as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    assert.ok(!value.includes('in the panel'), `CONSENT_STEP_TEXT.${name} still says "in the panel": ${value}`);
    assert.ok(!value.includes('Not now'), `CONSENT_STEP_TEXT.${name} still says "Not now": ${value}`);
  }
});

test('criterion 3 (D, item 40): privacy-facts.ts holds the pause-memory sentence with "in Data source settings"', () => {
  const source = fs.readFileSync(path.join(SRC, 'lib', 'privacy-facts.ts'), 'utf8');
  assert.ok(source.includes(PRIVACY_777), 'privacy-facts.ts does not hold item 40\'s sentence');
  assert.ok(!source.includes('You can turn it On in the panel for your next question.'), 'privacy-facts.ts still holds "in the panel"');
});

test('criterion 3 (E, 42/50): the no_sources_on refusal reads item 42\'s words', () => {
  assert.equal(friendlyStreamError({ code: 'no_sources_on' }), NO_SOURCES_ON);
});

// --- Part F ------------------------------------------------------------------------------------

test('criterion 3 (F): WITHDRAW_* are one sentence, and NOTIFY_WITH_ACCOUNTS ends in item 40\'s words', () => {
  assert.equal(copy.WITHDRAW_WITH_ACCOUNTS, WITHDRAW, 'item 40 (X2c): WITHDRAW_WITH_ACCOUNTS');
  assert.equal(copy.WITHDRAW_WITHOUT_ACCOUNTS, WITHDRAW, 'item 40 (X2c): WITHDRAW_WITHOUT_ACCOUNTS');
  assert.equal(copy.NOTIFY_WITH_ACCOUNTS, `${NOTIFY_FIRST} ${NOTIFY_LAST}`, 'item 40 (X2d): NOTIFY_WITH_ACCOUNTS');
});

test('criterion 3 (D6 B): CARD_CONTROLS_* no longer exist', () => {
  assert.equal(copy.CARD_CONTROLS_WITH_ACCOUNTS, undefined, 'CARD_CONTROLS_WITH_ACCOUNTS is still exported');
  assert.equal(copy.CARD_CONTROLS_WITHOUT_ACCOUNTS, undefined, 'CARD_CONTROLS_WITHOUT_ACCOUNTS is still exported');
});

// --- The privacy golden (H2) -------------------------------------------------------------------

const GOLDEN = path.join(SRC, 'app', '(app)', 'privacy', 'privacy-sections.golden.json');
/** The lines that move (1-based), and the hash of every other line as the base (664175d) holds them. */
const MOVES = [10, 25, 243, 258, 274];
const BASE_LINES = 585;
const BASE_REST_SHA256 = 'c33cd61a2ff37c6e5b0d2c7e5a89f942886fd49fa7100b3d4a93b6f60ce0499f';
const BASE_15 = '          "text": "We keep your answer in a cookie, named below, until this browser session ends."';
const BASE_248 = '          "text": "If you are signed in, we keep your answer on your account. If not, we keep it in a cookie, named below, until this browser session ends."';

const jsonText = (s: string) => JSON.stringify(s).slice(1, -1);

test('criterion 3 (H2): the privacy golden moves on exactly :10, :25, :243, :258 and :274; :15 and :248 equal the base', () => {
  const lines = fs.readFileSync(GOLDEN, 'utf8').split('\n');
  assert.equal(lines.length, BASE_LINES, 'the golden gained or lost lines');
  assert.equal(lines[14], BASE_15, ':15 moved');
  assert.equal(lines[247], BASE_248, ':248 moved');
  const skip = new Set(MOVES);
  const rest = lines.filter((_, i) => !skip.has(i + 1)).join('\n');
  assert.equal(crypto.createHash('sha256').update(rest).digest('hex'), BASE_REST_SHA256, 'a line other than the five moved');
  for (const n of [10, 243]) {
    assert.ok(lines[n - 1].includes(jsonText(EFFECT)), `:${n} does not carry item 38`);
    assert.ok(lines[n - 1].includes(jsonText(X2B)), `:${n} does not carry X2b`);
  }
  assert.equal(lines[24], `          "text": "${jsonText(WITHDRAW)}"`, ':25 is not item 40\'s withdraw sentence');
  assert.equal(lines[257], `          "text": "${jsonText(WITHDRAW)}"`, ':258 is not item 40\'s withdraw sentence');
  assert.ok(lines[273].includes(jsonText(NOTIFY_LAST)), ':274 does not end in item 40\'s words');
});
