// Unit tests for the evidence detail page's machine-readable metadata
// builders (#256, #258).
//
// The load-bearing assertions here are NEGATIVE: these blocks must not carry a
// publication date, because no publication timestamp is stored. A defect of
// that shape reads as a plain field on an object literal and would return
// silently under any refactor, so it gets a named test rather than a comment.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidenceJsonLd,
  buildEvidenceCitationTags,
} from './page-metadata.ts';

const RECORD = {
  title: 'NYC 311 noise complaints by borough, 2025',
  summary:
    'Counts of noise complaints per borough for calendar year 2025, from NYC Open Data 311 Service Requests (erm2-nwe9).',
  creatorName: 'A. Analyst',
  url: 'https://example.org/evidence/nyc-311-noise-by-borough-2025',
};

// --- schema.org JSON-LD ---------------------------------------------------

test('buildEvidenceJsonLd: emits a schema.org Dataset with title, summary and creator', () => {
  const jsonLd = buildEvidenceJsonLd(RECORD);

  assert.equal(jsonLd['@context'], 'https://schema.org');
  assert.equal(jsonLd['@type'], 'Dataset');
  assert.equal(jsonLd.name, RECORD.title);
  assert.equal(jsonLd.description, RECORD.summary);
  assert.deepEqual(jsonLd.creator, { '@type': 'Person', name: 'A. Analyst' });
});

test('buildEvidenceJsonLd: asserts NO publication date (#256)', () => {
  const jsonLd = buildEvidenceJsonLd(RECORD);

  // The specific field search engines and citation tooling read to date a
  // work. `evidence_records` stores no publication timestamp — only row-insert
  // time, which for a sealed-then-published record is the SEAL time. Absent on
  // purpose; see the no-publication-date note in page-metadata.ts.
  assert.ok(
    !('datePublished' in jsonLd),
    'JSON-LD must not carry datePublished — no publication timestamp is stored',
  );
  // The ruling was omission, not substitution: `dateCreated` was considered
  // and rejected, so its reappearance is also a regression.
  assert.ok(
    !('dateCreated' in jsonLd),
    'JSON-LD must not substitute dateCreated for the omitted publication date',
  );
  // Belt and braces: no date-shaped key of any spelling reintroduces the claim.
  const dateKeys = Object.keys(jsonLd).filter((k) => /date/i.test(k));
  assert.deepEqual(dateKeys, [], 'JSON-LD must carry no date-bearing key');
});

test('buildEvidenceJsonLd: url omitted when the instance declared no origin (#258)', () => {
  const withUrl = buildEvidenceJsonLd(RECORD);
  assert.equal(withUrl.url, RECORD.url);

  const withoutUrl = buildEvidenceJsonLd({ ...RECORD, url: null });
  assert.ok(
    !('url' in withoutUrl),
    'url key must be absent, not null — never another deployment’s URL',
  );
  // Omitting the URL must not disturb anything else in the block.
  assert.equal(withoutUrl.name, RECORD.title);
  assert.equal(withoutUrl['@type'], 'Dataset');
});

// --- Highwire-Press citation tags -----------------------------------------

test('buildEvidenceCitationTags: emits title, author and public url', () => {
  const tags = buildEvidenceCitationTags(RECORD);

  assert.equal(tags.citation_title, RECORD.title);
  assert.equal(tags.citation_author, RECORD.creatorName);
  assert.equal(tags.citation_public_url, RECORD.url);
});

test('buildEvidenceCitationTags: asserts NO citation_date (#256)', () => {
  const tags = buildEvidenceCitationTags(RECORD);

  // `citation_date` IS a publication-date assertion in the Highwire-Press
  // vocabulary that Zotero and Google Scholar read. Same defect as
  // `datePublished`, same fix.
  assert.ok(
    !('citation_date' in tags),
    'citation tags must not carry citation_date — no publication timestamp is stored',
  );
  const dateKeys = Object.keys(tags).filter((k) => /date/i.test(k));
  assert.deepEqual(dateKeys, [], 'citation tags must carry no date-bearing key');
});

test('buildEvidenceCitationTags: citation_public_url omitted when no origin (#258)', () => {
  const tags = buildEvidenceCitationTags({ ...RECORD, url: null });

  assert.ok(
    !('citation_public_url' in tags),
    'citation_public_url must be absent, not empty, when no origin is declared',
  );
  assert.equal(tags.citation_title, RECORD.title);
  assert.equal(tags.citation_author, RECORD.creatorName);
});

// --- Shape guard ----------------------------------------------------------

test('both builders emit only string-valued keys Next.js metadata accepts', () => {
  // `other:` values must be string | number | Array<string|number>; the
  // citation builder is the one whose output lands there directly.
  for (const value of Object.values(buildEvidenceCitationTags(RECORD))) {
    assert.equal(typeof value, 'string');
  }
});
