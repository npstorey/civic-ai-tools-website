// Tests for scripts/update-portals.mjs (#589).
//
// Two rules decide which Socrata rows the registry writes. A commondataio
// entry whose portal moved follows it (San Francisco: data.sfgov.org now
// redirects to data.sf.gov, and the upstream registry still lists the old
// address). A domain with no public datasets and no commondataio entry is left
// out (Socrata's catalog lists hundreds of empty tenant domains). The second
// rule must never read a failed count request as zero, or a transient network
// error would drop a real portal.
//
// buildSocrataRegistry is driven end to end against a stubbed fetch, so these
// tests read the rows the script writes, not only the helpers. Every host is
// under example.*; nothing here reaches the network.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocrataRegistry,
  getSocrataCount,
  isEmptyUnlistedDomain,
  mergeRedirectedEntries,
} from './update-portals.mjs';

/** A fetch whose answers come from `route(url)`: an object, or null to fail. */
function stubFetch(route) {
  return async (input) => {
    const url = String(input);
    const answer = route(url);
    if (!answer) throw new TypeError('fetch failed');
    const status = answer.status ?? 200;
    return {
      ok: status < 400,
      status,
      url: answer.url ?? url,
      json: async () => answer.json,
      body: { cancel: async () => {} },
    };
  };
}

function withFetch(t, route) {
  t.mock.method(globalThis, 'fetch', stubFetch(route));
  t.mock.method(console, 'log', () => {});
}

const entry = (link, name) => ({ link, name, software: { id: 'socrata' } });

test('a moved portal follows its redirect; an alias of an entry that exists is dropped', () => {
  const alias = entry('https://alias.example.org', 'Alias name');
  const own = entry('https://own.example.gov', 'Own name');
  const moved = entry('https://old.example.org', 'Moved name');
  const left = entry('https://left.example.org', 'Left Socrata');
  const dead = entry('https://dead.example.org', 'No answer');
  const listed = entry('https://listed.example.gov', 'Listed itself');
  // The alias comes BEFORE the entry it duplicates, so an implementation that
  // moves entries in input order would put the alias on the target first.
  const input = new Map([
    ['alias.example.org', alias],
    ['own.example.gov', own],
    ['old.example.org', moved],
    ['left.example.org', left],
    ['dead.example.org', dead],
    ['listed.example.gov', listed],
  ]);
  const catalog = new Set(['own.example.gov', 'new.example.gov', 'listed.example.gov']);
  const redirects = new Map([
    ['alias.example.org', 'own.example.gov'],
    ['old.example.org', 'new.example.gov'],
    ['left.example.org', 'elsewhere.example.com'], // not a catalog domain
    ['listed.example.gov', 'new.example.gov'], // listed itself: stays
  ]);

  const merged = mergeRedirectedEntries(input, catalog, redirects);

  assert.deepEqual([...merged.keys()].sort(), [
    'dead.example.org',
    'left.example.org',
    'listed.example.gov',
    'new.example.gov',
    'own.example.gov',
  ]);
  assert.equal(merged.get('own.example.gov'), own);
  assert.equal(merged.get('new.example.gov'), moved);
  assert.equal(merged.get('listed.example.gov'), listed);
  assert.equal(input.size, 6, 'the input map is not modified');
});

test('only a measured zero with no upstream entry is left out', () => {
  assert.equal(isEmptyUnlistedDomain(0, false), true);
  assert.equal(isEmptyUnlistedDomain(0, true), false);
  assert.equal(isEmptyUnlistedDomain(null, false), false);
  assert.equal(isEmptyUnlistedDomain(3, false), false);
});

test('a count no API answered is null, never zero', async (t) => {
  withFetch(t, (url) => {
    if (url.includes('domains=down.example.com')) return null;
    if (url.startsWith('https://api.us.socrata.com/') && url.includes('domains=half.example.com')) {
      return { json: { resultSetSize: 0 } };
    }
    if (url.startsWith('https://api.us.socrata.com/') && url.includes('domains=refused.example.com')) {
      return { status: 503, json: {} };
    }
    if (url.startsWith('https://refused.example.com/')) return { json: { resultSetSize: 3 } };
    if (url.startsWith('https://api.us.socrata.com/') && url.includes('domains=big.example.com')) {
      return { json: { resultSetSize: 25 } };
    }
    return null;
  });

  assert.equal(await getSocrataCount('down.example.com'), null);
  assert.equal(await getSocrataCount('half.example.com'), 0, 'central measured 0, the portal failed');
  assert.equal(await getSocrataCount('refused.example.com'), 3);
  assert.equal(await getSocrataCount('big.example.com'), 25);
});

test('the rows written: a moved portal under its new domain, empty unlisted domains left out', async (t) => {
  const counts = {
    'new.example.gov': 4,
    'own.example.gov': 40,
    'empty-uat.example.com': 0,
    'empty-listed.example.gov': 0,
  };
  withFetch(t, (url) => {
    const u = new URL(url);
    // Redirect probes of the upstream-only domains
    if (u.hostname === 'old.example.org') return { url: 'https://new.example.gov/api/catalog/v1?limit=0', json: {} };
    if (u.hostname === 'alias.example.org') return { url: 'https://own.example.gov/api/catalog/v1?limit=0', json: {} };
    // Counts, central and per portal
    const domain = u.searchParams.get('domains');
    if (domain === 'unreachable.example.com') return null;
    if (domain in counts) return { json: { resultSetSize: counts[domain] } };
    return null;
  });

  const rows = await buildSocrataRegistry(
    ['new.example.gov', 'own.example.gov', 'empty-uat.example.com', 'unreachable.example.com'],
    [
      entry('https://alias.example.org', 'Alias name'),
      entry('https://old.example.org', 'Moved name'),
      entry('https://own.example.gov', 'Own name'),
      entry('https://empty-listed.example.gov', 'Empty but listed'),
      { link: 'https://some.ckan.example.org', name: 'Not Socrata', software: { id: 'ckan' } },
    ],
  );

  assert.deepEqual(
    rows.map(r => [r.id, r.name, r.dataset_count]),
    [
      ['empty-listed.example.gov', 'Empty but listed', 0],
      ['new.example.gov', 'Moved name', 4],
      ['own.example.gov', 'Own name', 40],
      ['unreachable.example.com', '', 0],
    ],
  );
  const moved = rows.find(r => r.id === 'new.example.gov');
  assert.equal(moved.url, 'https://new.example.gov');
  assert.equal(moved.api_endpoint, 'https://new.example.gov/api');
});
