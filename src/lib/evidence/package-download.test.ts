// #553 criterion 2 — the record page's Download goes through the app's package
// route, saves `record-<slug>.json`, and saves nothing when the route refuses.
//
// WHY TWO HALVES. `EvidenceActions.tsx` is JSX, which `--experimental-strip-types`
// cannot parse, so the BEHAVIOUR lives in `./package-download.ts` and is driven
// here with a fetch and a save the test controls: the path requested, the bytes
// saved, the file name, and what a 404, a 502, a dropped connection and a body
// that fails mid-read each come to. The component's USE of that module, and the
// detail page's handing it no storage address, are asserted over the source.
// `src/app/api/evidence/package-route.test.ts` drives the same function against
// the real route handler, so a 404 there is the gate's own 404, not a fake's.
//
// WHAT MAKES THE ASSERTIONS ABLE TO FAIL. Every fixture body is bytes the test
// chose, including a non-ASCII run, compared by SHA-256 against what was saved;
// the refusal fixtures carry a JSON error body, so a helper that saved whatever
// came back would save a file and fail the "nothing saved" assertion. Shown red
// at #553's red commit against a stub that requested nothing and saved nothing.
//
// BLIND SPOT, stated. The source assertions cannot tell that `handleDownload` is
// what the button's click runs at runtime, only that the file wires it so; and
// `saveBlobAsFile` is driven against a fake document, not a browser. Whether a
// given browser honours `download` on an object URL is not measured here.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  downloadRecordPackage,
  recordPackageFileName,
  recordPackagePath,
  saveBlobAsFile,
} from './package-download.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with comments removed, so a comment cannot satisfy or trip an assertion. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const sha256 = (bytes: Uint8Array | ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(bytes as ArrayBuffer)).digest('hex');

const SLUG = 'noise-complaints-2026-q3-a1b2c3';
const STORED = '{"packageVersion":"0.1","title":"Bodega — café hours ☕","n":1.0}';

interface Drive {
  requested: Array<{ input: string; init?: RequestInit }>;
  saved: Array<{ blob: Blob; fileName: string }>;
}

function harness(respond: () => Promise<Response>): Drive & { deps: Parameters<typeof downloadRecordPackage>[1] } {
  const requested: Drive['requested'] = [];
  const saved: Drive['saved'] = [];
  return {
    requested,
    saved,
    deps: {
      fetch: async (input, init) => {
        requested.push({ input, init });
        return respond();
      },
      save: (blob, fileName) => {
        saved.push({ blob, fileName });
      },
    },
  };
}

test('#553 C2: the path is the canonical same-origin package route, and the name is record-<slug>.json', () => {
  assert.equal(recordPackagePath(SLUG), `/api/records/${SLUG}/package`);
  assert.equal(recordPackageFileName(SLUG), `record-${SLUG}.json`);
  // A slug never carries a path separator, but the path is built for one that did.
  assert.equal(recordPackagePath('a/b'), '/api/records/a%2Fb/package');
});

test('#553 C2: a 200 saves the response bytes, unchanged, as record-<slug>.json', async () => {
  const h = harness(async () => new Response(STORED, { status: 200, headers: { 'content-type': 'application/json' } }));
  const result = await downloadRecordPackage(SLUG, h.deps);
  assert.deepEqual(result, { ok: true });
  assert.equal(h.requested.length, 1, 'exactly one request');
  assert.equal(h.requested[0].input, `/api/records/${SLUG}/package`, 'the request goes to the app, not to storage');
  assert.equal(h.requested[0].init?.credentials, 'same-origin', 'the session travels, so a sealed record downloads for its creator');
  assert.equal(h.saved.length, 1, 'exactly one file saved');
  assert.equal(h.saved[0].fileName, `record-${SLUG}.json`);
  assert.equal(
    sha256(await h.saved[0].blob.arrayBuffer()),
    sha256(new TextEncoder().encode(STORED)),
    'the saved bytes are the response bytes',
  );
});

for (const status of [404, 502] as const) {
  test(`#553 C2: a ${status} saves nothing and reports the failure`, async () => {
    const body = JSON.stringify({ error: status === 404 ? 'Not found' : 'Package retrieval failed' });
    const h = harness(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }));
    const result = await downloadRecordPackage(SLUG, h.deps);
    assert.equal(h.requested.length, 1, 'the route was asked');
    assert.equal(h.saved.length, 0, `a ${status} body must never be saved under the record's name`);
    assert.deepEqual(result, { ok: false, status });
  });
}

test('#553 C2: a dropped connection saves nothing and reports the failure', async () => {
  const h = harness(async () => {
    throw new TypeError('Failed to fetch');
  });
  const result = await downloadRecordPackage(SLUG, h.deps);
  assert.equal(h.requested.length, 1, 'the route was asked');
  assert.equal(h.saved.length, 0);
  assert.deepEqual(result, { ok: false, status: null });
});

test('#553 C2: a body that fails mid-read saves nothing and reports the failure', async () => {
  const h = harness(async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"packageVersion":'));
        controller.error(new Error('connection reset'));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await downloadRecordPackage(SLUG, h.deps);
  assert.equal(h.requested.length, 1, 'the route was asked');
  assert.equal(h.saved.length, 0, 'a truncated body is not a record');
  assert.deepEqual(result, { ok: false, status: null });
});

test('#553 C2: saveBlobAsFile names the file, clicks once, and revokes the object URL afterwards', () => {
  const events: string[] = [];
  const anchor = {
    href: '',
    download: '',
    rel: '',
    click: () => events.push('click'),
    remove: () => events.push('remove'),
  };
  const timers: Array<() => void> = [];
  const blob = new Blob([STORED], { type: 'application/json' });
  saveBlobAsFile(blob, `record-${SLUG}.json`, {
    document: {
      createElement: ((tag: string) => {
        events.push(`create:${tag}`);
        return anchor;
      }) as unknown as Document['createElement'],
      body: { appendChild: () => events.push('append') } as unknown as HTMLElement,
    },
    URL: {
      createObjectURL: (b: Blob) => {
        assert.equal(b, blob, 'the object URL is for the fetched bytes');
        events.push('createObjectURL');
        return 'blob:fixture/1';
      },
      revokeObjectURL: (u: string) => events.push(`revoke:${u}`),
    },
    setTimeout: (fn) => {
      timers.push(fn);
      return 0;
    },
  });
  assert.equal(anchor.download, `record-${SLUG}.json`);
  assert.equal(anchor.href, 'blob:fixture/1', 'the link is the fetched bytes, never a storage address');
  assert.deepEqual(events, ['createObjectURL', 'create:a', 'append', 'click', 'remove']);
  assert.equal(timers.length, 1, 'the revoke is deferred, so the click is not cancelled under it');
  timers[0]();
  assert.deepEqual(events.at(-1), 'revoke:blob:fixture/1');
});

// --- The component's use of the module, by source ------------------------------

test('#553 C2: EvidenceActions receives no storage address and downloads through the module', () => {
  const src = code(read('src/components/evidence/EvidenceActions.tsx'));
  assert.doesNotMatch(src, /packageUrl/, 'the component still declares or reads a storage-address prop');
  assert.doesNotMatch(src, /\.href\s*=/, 'the component still points a link at an address itself');
  assert.match(
    src,
    /import\s*\{[^}]*\bdownloadRecordPackage\b[^}]*\bsaveBlobAsFile\b[^}]*\}\s*from\s*'@\/lib\/evidence\/package-download'/,
    'the component imports the download module',
  );

  const handler = src.indexOf('const handleDownload = async () => {');
  assert.ok(handler > 0, 'handleDownload is an async handler');
  const call = src.indexOf('downloadRecordPackage(slug,', handler);
  const end = src.indexOf('\n  };', handler);
  assert.ok(call > handler && call < end, 'handleDownload calls downloadRecordPackage(slug, …) in its own body');
  assert.ok(src.indexOf('save: saveBlobAsFile', handler) < end, 'the save is the module\'s saveBlobAsFile');
  const failed = src.indexOf('setDownloadFailed(true)', call);
  assert.ok(failed > call && failed < end, 'a failed result sets the failure state');
  assert.ok(src.indexOf('if (!result.ok)', call) < failed, 'the failure state is set on a non-ok result');

  assert.equal(src.split('onClick={handleDownload}').length - 1, 1, 'the Download button runs handleDownload');
  const notice = src.indexOf('{downloadFailed && (');
  assert.ok(notice > 0, 'the failure state renders a notice');
  assert.ok(src.indexOf('role="alert"', notice) > notice, 'the notice is announced');
  assert.ok(src.indexOf('Download failed', notice) > notice, 'the notice tells the reader the download failed');
});

test('#553 C2: the detail page hands EvidenceActions no storage key', () => {
  const src = code(read('src/app/(app)/evidence/[slug]/page.tsx'));
  const open = src.indexOf('<EvidenceActions');
  assert.ok(open > 0, 'the page mounts EvidenceActions');
  const close = src.indexOf('/>', open);
  const props = src.slice(open, close);
  assert.ok(props.includes('slug={slug}'), 'the component is handed the slug it downloads by');
  assert.doesNotMatch(props, /basePackageStorageKey|packageUrl/, 'the page still hands the component a storage address');
  assert.equal(src.split('<EvidenceActions').length - 1, 1, 'one mount');
});
