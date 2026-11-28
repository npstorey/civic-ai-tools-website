// S4 W2b (npstorey/civic-ai-tools#335): the run's and the record's words for a load not enabled (C3-O = B: S122 to
// S125), the where-line under the question box (the renaming: S87), the refusal when no source is enabled (S90), and
// the pause's third answer at twelve or fewer (S96). Each taken form byte for byte, from planning's W2 words list.
//
// B7 (pin, amended 2026-11-24): "Where this question went" and the steps read these words at render time, from the
// record's outcomes, so a record made before S4 takes them on its page with no change to its signed bytes. The last test
// reads a record's spans, as a record page does, and finds the new reasons.
//
// RED AT W2a's HEAD (e783f69): every line below says "set to Ask first", "On", "Off" or "the model service".
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNarrativeSummary, formatConsentPause, formatToolResult, friendlyStreamError } from './streaming.ts';
import { WHERE_IT_WENT_REASONS, ALLOW_ALL_SOURCES } from './sources/copy.ts';
import { WHERE_LINE } from '../components/composer/copy.ts';
import { whereItWentFromSpans } from './flows/where-it-went.ts';

const LOAD = 'load_source';
const UNKNOWN_ALIAS = '{"alias":"x"} `injected`';
const CHECKBOOK = { sourceId: 'nyc-checkbook', displayName: 'NYC Checkbook' };

test('S122 (red; C3-O = B): the progress line a pause is shown with: S122[3] while the question waits, S122[4] when it cannot ask', () => {
  assert.equal(formatConsentPause({ source: CHECKBOOK as never, holds: true }), 'Waiting for your answer about NYC Checkbook');
  assert.equal(formatConsentPause({ source: CHECKBOOK as never, holds: false }), 'NYC Checkbook is not answered yet, and this question cannot stop to ask you');
});

test('S123 (red; C3-O = B): the steps\' line for a load not enabled: S123[4] and S123[5] declined, S123[6] with no answer and no name', () => {
  assert.equal(formatToolResult({ alias: 'nyc_checkbook' }, undefined, LOAD, 'declined'), 'The NYC Checkbook source was declined when you were asked, so it was not used for this question');
  assert.equal(formatToolResult({ alias: UNKNOWN_ALIAS }, undefined, LOAD, 'declined'), 'A source declined when you were asked was not used for this question');
  assert.equal(formatToolResult({ alias: UNKNOWN_ALIAS }, undefined, LOAD, 'no-answer'), 'A source not enabled was not used. This site could not ask you, or no answer arrived in time.');
});

test('S124 (red; C3-O = B): the narrative\'s fragment for a declined load: S124[3] named, S124[4] not', () => {
  const named = buildNarrativeSummary([{ name: LOAD, args: { alias: 'nyc_checkbook' }, operationType: 'load_source', loadOutcome: 'declined' }]);
  assert.ok(named.includes('did not use the NYC Checkbook source, which was declined when you were asked'), named);
  const unnamed = buildNarrativeSummary([{ name: LOAD, args: { alias: UNKNOWN_ALIAS }, operationType: 'load_source', loadOutcome: 'declined' }]);
  assert.ok(unnamed.includes('did not use a source declined when you were asked'), unnamed);
});

test('S125 (red; C3-O = B): the six reasons of "Where this question went", forms 3 to 8', () => {
  assert.deepEqual(
    {
      noAnswer: WHERE_IT_WENT_REASONS.noAnswer,
      onNotUsed: WHERE_IT_WENT_REASONS.onNotUsed,
      off: WHERE_IT_WENT_REASONS.off,
      notAsked: WHERE_IT_WENT_REASONS.notAsked,
      allowedNotUsed: WHERE_IT_WENT_REASONS.allowedNotUsed,
      declined: WHERE_IT_WENT_REASONS.declined,
    },
    {
      noAnswer: 'Not enabled: it could not be asked about, or no answer arrived in time.',
      onNotUsed: 'Enabled, not used for this question.',
      off: 'Disabled.',
      notAsked: 'Not enabled: not asked for this question.',
      allowedNotUsed: 'Accepted when asked, but not used for this question.',
      declined: 'Declined when asked, so not used for this question.',
    },
  );
});

test('S87 (red; the renaming): the where-line\'s Standard forms, S87[1] to S87[5]', () => {
  assert.equal(WHERE_LINE.askFirst(false), 'Where your question goes: the AI provider; the AI\'s searches go to data sources you enable');
  assert.equal(WHERE_LINE.everyOff, 'Where your question goes: nowhere; every data source is disabled');
  assert.equal(WHERE_LINE.cannotAsk, 'Where your question goes: nowhere; no data source is enabled');
  assert.equal(WHERE_LINE.on(6, false), 'Where your question goes: the AI provider; the AI\'s searches go to 6 data sources');
  assert.equal(WHERE_LINE.on(197, false), 'Where your question goes: the AI provider; the AI\'s searches go to 197 data sources');
});

test('S90 (red): the refusal when no data source is enabled', () => {
  assert.equal(friendlyStreamError({ code: 'no_sources_on' }), 'No data source is enabled, so nothing was sent. Enable a source in Data source settings, then ask again.');
});

test('S96 (red; C3-ALL = A): the pause\'s third answer at twelve or fewer', () => {
  assert.equal(ALLOW_ALL_SOURCES, 'Enable all data sources');
});

test('fix round 1, item 3 (red): a record whose load span says no question was put about the source (`tool.load_asked: false`) words it as loaded on another source\'s answer; one with no such attribute keeps S125[7]', () => {
  const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  const load = (alias: string, asked?: boolean) => ({
    name: 'mcp_tool_call',
    attributes: [
      attr('tool.name', LOAD), attr('tool.operation_type', LOAD), attr('tool.arguments', JSON.stringify({ alias })), attr('tool.load_outcome', 'loaded'),
      ...(asked === undefined ? [] : [{ key: 'tool.load_asked', value: { boolValue: asked } }]),
    ],
  });
  const model = whereItWentFromSpans({
    spans: [load('socrata', true), load('nyc_record', false), load('nyc_checkbook')],
    sourcesOffered: [
      { sourceId: 'socrata', alias: 'socrata', reason: 'not-consented' },
      { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'not-consented' },
      { sourceId: 'nyc-checkbook', alias: 'nyc_checkbook', reason: 'not-consented' },
    ],
  });
  assert.deepEqual(model.notReached.map((row) => [row.sourceId, row.whyNotSent]), [
    ['socrata', 'Accepted when asked, but not used for this question.'],
    ['nyc-record', 'Enabled by an answer about another source, but not used for this question.'],
    ['nyc-checkbook', 'Accepted when asked, but not used for this question.'],
  ]);
});

test('B7 (red at the words): a record made before S4, read from its spans, takes S125\'s words; its sources and outcomes do not move', () => {
  const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  const load = (alias: string, outcome: string) => ({ name: 'mcp_tool_call', attributes: [attr('tool.name', LOAD), attr('tool.operation_type', LOAD), attr('tool.arguments', JSON.stringify({ alias })), attr('tool.load_outcome', outcome)] });
  // A record's spans as an in-loop run wrote them before S4 (#644 W1): three loads, three outcomes.
  const model = whereItWentFromSpans({
    spans: [load('boston_opencontext', 'declined'), load('nyc_checkbook', 'no-answer'), load('nys_legislation', 'loaded')],
    sourcesOffered: [
      { sourceId: 'boston-opencontext', alias: 'boston_opencontext', reason: 'not-consented' },
      { sourceId: 'nyc-checkbook', alias: 'nyc_checkbook', reason: 'not-consented' },
      { sourceId: 'nys-legislation', alias: 'nys_legislation', reason: 'not-consented' },
      { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-consented' },
      { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
      { sourceId: 'data-commons', alias: 'data_commons', reason: 'reader-off' },
    ],
  });
  assert.deepEqual(model.notReached.map((row) => [row.sourceId, row.whyNotSent]), [
    ['boston-opencontext', 'Declined when asked, so not used for this question.'],
    ['nyc-checkbook', 'Not enabled: it could not be asked about, or no answer arrived in time.'],
    ['nys-legislation', 'Accepted when asked, but not used for this question.'],
    ['nyc-charter', 'Not enabled: not asked for this question.'],
    ['socrata', 'Enabled, not used for this question.'],
    ['data-commons', 'Disabled.'],
  ]);
});
