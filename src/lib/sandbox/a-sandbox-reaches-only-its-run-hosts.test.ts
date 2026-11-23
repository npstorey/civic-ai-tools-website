// A notebook's sandbox reaches only the hosts its run's data steps read (#807).
//
// Driven through the real executor (`executeNotebookWith`) and the real
// vercel-sandbox driver, with `Sandbox.create` replaced by a recorder that
// answers with a stand-in sandbox, so no request is made. The notebook is
// written by the real `synthesizeNotebook`, and its reach is the one it
// returns.
//
// THE FIXTURE, and what makes it able to fail. The data steps read two Socrata
// portals and Data Commons: three hosts that cannot collapse into one another.
// The synthesis cell names `example.com` and the host of a source the run did
// not read. An allowlist built from anything but the data steps, or none at
// all, is a different value from the one asserted.
//
//   - From a snapshot, the sandbox is created allowing exactly the three; a
//     notebook with no data step gets 'deny-all'. Nothing is updated later.
//   - With no snapshot, it is created allowing only the package index, and its
//     policy is updated to the three after pip and before the notebook is
//     written, in that order.
//
// Run with: npm test

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox } from '@vercel/sandbox';
import { synthesizeNotebook } from '../notebook-author/synthesize.ts';
import type { PhaseAToolCall } from '../notebook-author/tool-to-cell.ts';
import { SYNTHESIS_CELL_ROLE } from '../notebook-author/prompt.ts';
import { executeNotebookWith } from './execute.ts';
import { createVercelSandboxDriver } from './vercel-sandbox.ts';

const CLEARED = [
  'SANDBOX_SNAPSHOT_ID', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID',
  'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy',
  'EXECUTOR_SESSION_TIMEOUT_S', 'EXECUTOR_CELL_TIMEOUT_S', 'SOCRATA_APP_TOKEN', 'DC_API_KEY',
];
const saved = Object.fromEntries(CLEARED.map((name) => [name, process.env[name]]));
for (const name of CLEARED) delete process.env[name];
after(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const ANSWER = [
  'Both cities are below.',
  '',
  '```python',
  'import requests',
  'requests.get("https://example.com/")',
  'requests.get("https://data.boston.gov/api/3/action/package_list")',
  '```',
].join('\n');

const DATA_STEPS: PhaseAToolCall[] = [
  { name: 'get_data', args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9', query: 'SELECT count(*)' }, resultSummary: { rows: 1, columns: 1 } },
  { name: 'get_data', args: { type: 'query', portal: 'data.cityofchicago.org', dataset_id: 'ijzp-q8t2', query: 'SELECT count(*)' }, resultSummary: { rows: 1, columns: 1 } },
  { name: 'get_observations', args: { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' }, resultSummary: { rows: 3, columns: 4 } },
];
const THE_THREE = ['api.datacommons.org', 'data.cityofchicago.org', 'data.cityofnewyork.us'];
const PACKAGE_INDEX = ['pypi.org', 'files.pythonhosted.org'];

function synthesize(toolCalls: PhaseAToolCall[]) {
  return synthesizeNotebook({
    query: 'How do the two cities compare?',
    defaultPortal: 'data.cityofnewyork.us',
    toolCalls,
    finalAnswer: ANSWER,
    modelName: 'fixture/model',
    modelAccess: 'through a fixture endpoint',
    generatedAt: '2026-11-23T00:00:00.000Z',
  });
}

interface Step { what: string; detail: unknown }

/**
 * One run through the real driver with `Sandbox.create` recorded. Returns the
 * create params and every call made of the stand-in sandbox, in order.
 */
async function drive(toolCalls: PhaseAToolCall[], snapshotId: string | undefined) {
  const synthesis = synthesize(toolCalls);
  const steps: Step[] = [];
  const created: Record<string, unknown>[] = [];
  const realCreate = Sandbox.create;
  Sandbox.create = (async (params: Record<string, unknown>) => {
    created.push(params);
    return {
      name: params.name,
      async runCommand(cmd: { cmd: string; args: string[] }) {
        steps.push({ what: `runCommand ${cmd.cmd}`, detail: cmd.args[0] });
        return { exitCode: 0, stdout: async () => '3.13.1\n', stderr: async () => '' };
      },
      async update(params: Record<string, unknown>) {
        steps.push({ what: 'update', detail: params });
      },
      async writeFiles(files: Array<{ path: string }>) {
        steps.push({ what: 'writeFiles', detail: files.map((f) => f.path) });
      },
      async readFileToBuffer() {
        steps.push({ what: 'readFileToBuffer', detail: null });
        return Buffer.from(JSON.stringify(synthesis.notebook));
      },
      async stop() {
        steps.push({ what: 'stop', detail: null });
      },
    };
  }) as unknown as typeof Sandbox.create;
  // Typed loosely so this file also type-checks where the option does not exist.
  const opts: Record<string, unknown> = {
    reach: (synthesis as unknown as { reach?: unknown }).reach,
    ...(snapshotId ? { snapshotId } : {}),
  };
  try {
    await executeNotebookWith(createVercelSandboxDriver(), synthesis.notebook, opts as never);
  } finally {
    Sandbox.create = realCreate;
  }
  assert.equal(created.length, 1, 'one run makes exactly one Sandbox.create call');
  return { synthesis, params: created[0]!, steps };
}

test('premise: the data steps read the three hosts, and the synthesis cell names two others', () => {
  const synthesis = synthesize(DATA_STEPS);
  const code = synthesis.notebook.cells.filter((c) => c.cell_type === 'code').map((c) => [].concat(c.source as never).join(''));
  for (const host of ['data.cityofnewyork.us', 'data.cityofchicago.org']) {
    assert.ok(code.some((s) => s.includes(`portal=${JSON.stringify(host)}`)), `no data step reads ${host}`);
  }
  assert.ok(code.some((s) => s.includes('fetch_data_commons(')), 'no data step reads Data Commons');
  const synthesisCell = synthesis.notebook.cells.find((c) => (c.metadata as { role?: string } | undefined)?.role === SYNTHESIS_CELL_ROLE);
  const source = [].concat(synthesisCell?.source as never).join('');
  assert.ok(source.includes('https://example.com/') && source.includes('https://data.boston.gov/'), 'the synthesis cell names neither other host');
});

test('from a snapshot: the sandbox is created allowing exactly the hosts its data steps read', async () => {
  const { params, steps } = await drive(DATA_STEPS, 'snap_fixture');
  assert.equal('source' in params, true, 'premise: the snapshot branch was taken');
  assert.deepEqual(params.networkPolicy, { allow: THE_THREE });
  assert.ok(!steps.some((s) => s.what === 'update'), 'a sandbox created with its run\'s policy is not updated');
});

test('from a snapshot: a notebook with no data step is created deny-all', async () => {
  const { params } = await drive([{ name: 'get_data', args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: 'permits' } }], 'snap_fixture');
  assert.equal('source' in params, true, 'premise: the snapshot branch was taken');
  assert.equal(params.networkPolicy, 'deny-all');
});

test('with no snapshot: created allowing only the package index, then narrowed after pip and before the notebook is written', async () => {
  const { params, steps } = await drive(DATA_STEPS, undefined);
  assert.equal('source' in params, false, 'premise: the fresh branch was taken');
  assert.deepEqual(params.networkPolicy, { allow: PACKAGE_INDEX });
  const order = steps.map((s) => s.what);
  const pip = order.indexOf('runCommand pip');
  const update = order.indexOf('update');
  const write = order.indexOf('writeFiles');
  const nbconvert = order.indexOf('runCommand jupyter');
  assert.ok(pip >= 0 && update >= 0 && write >= 0 && nbconvert >= 0, `a step is missing: ${JSON.stringify(order)}`);
  assert.ok(pip < update && update < write && write < nbconvert, `the order was ${JSON.stringify(order)}`);
  assert.equal(order.filter((s) => s === 'update').length, 1, 'the policy is updated once');
  assert.deepEqual(steps[update]!.detail, { networkPolicy: { allow: THE_THREE } });
});

test('with no snapshot: a notebook with no data step is narrowed to deny-all', async () => {
  const { steps } = await drive([{ name: 'get_data', args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: 'permits' } }], undefined);
  const update = steps.find((s) => s.what === 'update');
  assert.deepEqual(update?.detail, { networkPolicy: 'deny-all' });
});
