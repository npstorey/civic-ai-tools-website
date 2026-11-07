// UX-2 P5 (X6, relay 13 ruling 4): "Data read on <date>" comes from the signed
// trace's successful calls to a data source, never from the packaging time.
//
// THE FIXTURE is a real record (`src/lib/flows/fixtures/record-2f32d9.package.json`):
// its two calls to Socrata began 2026-10-16T03:51:21Z and :23Z, and it was
// packaged at 03:52:42Z the same day, the time `dataSources[].accessTimestamp`
// carries.
//
// WHAT MAKES IT ABLE TO FAIL.
//   - The packaging time is moved to another date (October 18), so a line read
//     from `accessTimestamp` or `metadata.createdAt` names the wrong day.
//   - Four spans that must not count each sit on a date of their own: a model
//     call (October 10), the load step (an `mcp_tool_call` with no
//     `mcp.source`, October 11), a rejected call (`error: true`, October 12),
//     and a call with no recorded response (October 13). A predicate that
//     admits any of them yields a range, not one date.
//   - The process runs in a zone west of UTC, so a call at 02:00Z on October 17
//     falls on October 16 locally: a line built from the local date is wrong.
//
// The range form (relay 13, 4b; ruled by research check 2, C1) is read through
// `DATA_READ_RANGE`, its one home.
//
// Run with: npm test

process.env.TZ = 'America/Los_Angeles';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_READ_ON, DATA_READ_RANGE, dataReadDays, dataReadLine, formatReadDay } from './data-read-date.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORD = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'flows', 'fixtures', 'record-2f32d9.package.json'), 'utf8')) as {
  metadata: { createdAt: string };
  dataSources: Array<{ accessTimestamp: string }>;
  trace: { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> };
};

interface Attr { key: string; value: Record<string, unknown> }
interface Span { name: string; startTimeUnixNano: string; endTimeUnixNano?: string; attributes: Attr[] }

const nanos = (iso: string) => `${BigInt(Date.parse(iso)) * BigInt(1000000)}`;
const str = (key: string, v: string): Attr => ({ key, value: { stringValue: v } });

function toolSpan(iso: string, opts: { source?: boolean; response?: boolean; error?: boolean } = {}): Span {
  const { source = true, response = true, error = false } = opts;
  return {
    name: 'mcp_tool_call',
    startTimeUnixNano: nanos(iso),
    attributes: [
      str('tool.name', 'socrata__get_data'),
      ...(source ? [str('mcp.source', 'socrata')] : [str('tool.operation_type', 'load_source')]),
      ...(response ? [str('tool.response_hash', 'f'.repeat(64))] : []),
      ...(error ? [{ key: 'error', value: { boolValue: true } }, str('error.kind', 'timeout')] : []),
    ],
  };
}

/** The real record, with its packaging time moved and `extra` spans added. */
function record(extra: Span[] = [], packagedAt = '2026-10-18T09:00:00.000Z') {
  const pkg = structuredClone(RECORD);
  pkg.metadata.createdAt = packagedAt;
  for (const d of pkg.dataSources) d.accessTimestamp = packagedAt;
  pkg.trace.resourceSpans[0].scopeSpans[0].spans.push(...extra);
  return pkg;
}

const NOT_COUNTED: Span[] = [
  { name: 'llm_inference', startTimeUnixNano: nanos('2026-10-10T12:00:00Z'), attributes: [] },
  toolSpan('2026-10-11T12:00:00Z', { source: false }),
  toolSpan('2026-10-12T12:00:00Z', { error: true, response: false }),
  toolSpan('2026-10-13T12:00:00Z', { response: false }),
];

test('premise: the fixture\'s calls began on October 16 and its packaging time is the only date accessTimestamp carries', () => {
  const calls = RECORD.trace.resourceSpans[0].scopeSpans[0].spans.filter((s) => s.name === 'mcp_tool_call');
  assert.equal(calls.length, 2);
  for (const c of calls) assert.equal(new Date(Number(BigInt(c.startTimeUnixNano) / BigInt(1000000))).toISOString().slice(0, 10), '2026-10-16');
  assert.equal(record().dataSources[0].accessTimestamp.slice(0, 10), '2026-10-18');
});

test('X6: the line names the day the calls began, not the packaging day', () => {
  assert.deepEqual(dataReadDays(record().trace), ['2026-10-16']);
  assert.equal(dataReadLine(record().trace), DATA_READ_ON('October 16, 2026'));
  assert.equal(DATA_READ_ON('October 16, 2026'), 'Data read on October 16, 2026', 'the ruled words');
});

test('X6: a model call, the load step, a rejected call and a call with no response do not count', () => {
  const pkg = record(NOT_COUNTED);
  assert.deepEqual(dataReadDays(pkg.trace), ['2026-10-16']);
  assert.equal(dataReadLine(pkg.trace), DATA_READ_ON('October 16, 2026'));
});

test('X6 (4c): the day is the UTC day, in the page\'s date format', () => {
  const pkg = record();
  pkg.trace.resourceSpans[0].scopeSpans[0].spans = [toolSpan('2026-10-17T02:00:00Z')];
  assert.equal(new Date('2026-10-17T02:00:00Z').getDate(), 16, 'premise: the process zone puts that instant on October 16');
  assert.equal(formatReadDay('2026-10-17'), 'October 17, 2026');
  assert.equal(dataReadLine(pkg.trace), DATA_READ_ON('October 17, 2026'));
});

test('X6 (4b): calls on two UTC dates give the range, through its one constant; calls on one date give one date', () => {
  const two = record([toolSpan('2026-10-15T23:59:59Z')]);
  assert.deepEqual(dataReadDays(two.trace), ['2026-10-15', '2026-10-16']);
  assert.equal(dataReadLine(two.trace), DATA_READ_RANGE('October 15, 2026', 'October 16, 2026'));
  const same = record([toolSpan('2026-10-16T20:00:00Z')]);
  assert.equal(dataReadLine(same.trace), DATA_READ_ON('October 16, 2026'));
});

test('X6 (4a): a trace stored as a BlobRef, or one with no counted call, gives no line', () => {
  const ref = { ref: `blob:sha256:${'a'.repeat(64)}`, url: 'https://blobs.example.test/trace.json', contentType: 'application/json', size: 10 };
  assert.equal(dataReadLine(ref), null);
  assert.deepEqual(dataReadDays(ref), []);
  const none = record();
  none.trace.resourceSpans[0].scopeSpans[0].spans = NOT_COUNTED;
  assert.equal(dataReadLine(none.trace), null);
  assert.equal(dataReadLine(undefined), null);
});
