// CKAN-1 P3 fix round 1, F6 (the seat's ruling 6934343514): "Where this question went" reads a pack's answered call
// as reaching the pack. A source whose pack id a call's span carries was reached by that call, and a start-of-run
// exclusion (`not-consented`, `not-selected`) never outranks a later answered call of that source.
//
// THE RECORD is the published City Record record cbd1c7 (`./fixtures/record-cbd1c7.package.json`), read from
// production on 2026-11-16, with one change: its notebook's cell outputs are removed, since they carry the contacts'
// email addresses from the notices and this reader reads none of them. Its run loaded `nyc_record` and made one data
// call, `nyc_record__get_data`, answered, whose span carries `mcp.source` `socrata` and `mcp.pack_id` the pack's id;
// its composition states City Record `not-consented`, the state before the load. Nothing in it is changed by the
// reading: only the page's reading of it moves.
//
// THE DISPLAY IS THE OWNER'S. The model carries both facts for a pack's call: the pack (`sourceId`) and the base
// whose server answered it (`answeredBy`). The default reading, one named place in `./where-it-went.ts`
// (`PACK_CALL_COUNTED_UNDER`), counts the call under the pack; the base's own count holds only calls with no pack id.
//
// SHAPED TO FAIL. A second source the run truly did not use (Data Commons, `not-selected`) must still read not used;
// the same record with its pack call refused before it was sent (`not_offered`) must not make the pack reached.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { whereItWentFromPackage } from './where-it-went.ts';
import { WHERE_IT_WENT_REASONS } from '../sources/copy.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORD = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'record-cbd1c7.package.json'), 'utf8')) as Record<string, unknown>;
const PACK_ID = 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx';

type Attr = { key: string; value: Record<string, unknown> };
type Span = { name: string; attributes: Attr[] };
const spansOf = (pkg: Record<string, unknown>) => (pkg.trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
const attr = (span: Span, key: string) => { const v = span.attributes.find((a) => a.key === key)?.value; return v === undefined ? undefined : Object.values(v)[0]; };
type Row = { kind: string; sourceId?: string; name?: string; calls?: number; answeredBy?: { sourceId: string; name: string } };

test('F6 premise: the record\'s one data call is City Record\'s, answered, its span carrying the base and the pack', () => {
  const calls = spansOf(RECORD).filter((s) => s.name === 'mcp_tool_call' && attr(s, 'tool.operation_type') !== 'load_source');
  assert.deepEqual(calls.map((s) => [attr(s, 'tool.name'), attr(s, 'mcp.source'), attr(s, 'mcp.pack_id'), attr(s, 'error')]), [['nyc_record__get_data', 'socrata', PACK_ID, undefined]]);
});

test('F6: City Record, whose pack id the answered call carries, is reached by it, with the base that answered; a source the run did not use still reads not used', () => {
  const model = whereItWentFromPackage(RECORD, null)!;
  assert.ok(model, 'premise: the record has a trace');
  const notReached = Object.fromEntries(model.notReached.map((r) => [r.sourceId, r.whyNotSent]));
  assert.equal(notReached['nyc-record'], undefined, `City Record reads as not used: ${notReached['nyc-record']}`);
  const pack = (model.reached as Row[]).find((r) => r.kind === 'source' && r.sourceId === 'nyc-record');
  assert.deepEqual(pack && { calls: pack.calls, name: pack.name, answeredBy: pack.answeredBy }, { calls: 1, name: 'NYC City Record', answeredBy: { sourceId: 'socrata', name: 'Socrata' } });
  assert.equal(notReached['data-commons'], WHERE_IT_WENT_REASONS.notPicked, 'a source the run did not use no longer reads not used');
});

test('F6: the same record with its pack call refused before it was sent does not make the pack reached', () => {
  const refused = structuredClone(RECORD);
  const span = spansOf(refused).find((s) => attr(s, 'tool.name') === 'nyc_record__get_data')!;
  span.attributes.push({ key: 'error', value: { boolValue: true } }, { key: 'error.kind', value: { stringValue: 'not_offered' } });
  const model = whereItWentFromPackage(refused, null)!;
  assert.deepEqual((model.reached as Row[]).filter((r) => r.kind === 'source'), [], 'a refused call reached a source');
  assert.equal(Object.fromEntries(model.notReached.map((r) => [r.sourceId, r.whyNotSent]))['nyc-record'], WHERE_IT_WENT_REASONS.allowedNotUsed);
});
