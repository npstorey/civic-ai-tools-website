// LAYOUT-W1 P2, criterion 3 (ruling D3): one citation text for a record.
//
// The record page shows a "Citation" block beneath the answer, and the Cite
// button in Actions opens a modal (`CitePopover`). Both take their text from
// `buildRecordCitations`, so the two cannot differ. This file drives the
// builder; `record-page-layout.test.ts` asserts from the source that both call
// it, and that the block renders its output.
//
// THE DATE IS STATED IN UTC. The block is rendered on the server and hydrated
// in the browser; a date formatted in the local time zone of each would read
// one day apart for a record created near midnight UTC, which is a hydration
// mismatch and a modal that disagrees with the block. The process time zone is
// set below to one where that record falls on the previous day, so a builder
// that formats in local time fails here rather than passing on a UTC runner.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Pacific/Honolulu';

const { buildRecordCitations } = await import('./record-citation.ts');

const BASE = {
  title: 'Noise complaints by borough',
  creatorName: 'A. Writer',
  createdAt: '2026-05-19T03:30:00.000Z',
  slug: 'noise-complaints-by-borough-abc123',
  brandName: 'Example Records',
  origin: 'https://records.example.test',
};

test('record citation: two formats, labelled, in order', () => {
  const citations = buildRecordCitations(BASE);
  assert.deepEqual(
    citations.map((c) => c.label),
    ['Plain text', 'For deliberative process reference'],
  );
});

test('record citation: the plain-text and deliberative formats, word for word', () => {
  const [plain, deliberative] = buildRecordCitations(BASE);
  assert.equal(
    plain?.text,
    'A. Writer (2026). "Noise complaints by borough." Example Records Record Package. ' +
      'https://records.example.test/records/noise-complaints-by-borough-abc123. Published: May 19, 2026.',
  );
  assert.equal(
    deliberative?.text,
    'Record: Noise complaints by borough [Published: May 19, 2026] ' +
      'https://records.example.test/records/noise-complaints-by-borough-abc123',
  );
});

test('record citation: the date is the UTC date, whatever the local time zone', () => {
  // 03:30 UTC on May 19 is the evening of May 18 in the time zone set above.
  assert.equal(new Date(BASE.createdAt).getDate(), 18, 'the premise: local time is the previous day');
  const [plain] = buildRecordCitations(BASE);
  assert.match(plain?.text ?? '', /Published: May 19, 2026\.$/);
  // The year is the UTC year as well: 2026-01-01T05:00Z is still 2025 here.
  const [newYear] = buildRecordCitations({ ...BASE, createdAt: '2026-01-01T05:00:00.000Z' });
  assert.match(newYear?.text ?? '', /^A\. Writer \(2026\)\./);
  assert.match(newYear?.text ?? '', /Published: January 1, 2026\.$/);
});

test('record citation: an instance with no name publishes a "Record Package" with no publisher', () => {
  const [plain] = buildRecordCitations({ ...BASE, brandName: null });
  assert.match(plain?.text ?? '', /"Noise complaints by borough\." Record Package\. https:/);
  assert.doesNotMatch(plain?.text ?? '', /null/);
});

test('record citation: with no origin the URL is the relative canonical address', () => {
  const [plain, deliberative] = buildRecordCitations({ ...BASE, origin: null });
  assert.match(plain?.text ?? '', / \/records\/noise-complaints-by-borough-abc123\. Published:/);
  assert.match(deliberative?.text ?? '', / \/records\/noise-complaints-by-borough-abc123$/);
});
