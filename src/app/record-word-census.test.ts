// UX-1 PW (#719, the census as ruled at G0-6): the site's saved item reads
// "analysis" / "analyses", and a record word the ruling renamed cannot come
// back in the files this phase owns.
//
// WHAT IS READ. Every file that holds a PW row of the census (`FILES` below):
// the rows this phase renamed, and the rows that stay (pending the research
// check, or kept). In each file, through the TypeScript compiler's own parser,
// every JSX text node, every string literal, every no-substitution template
// literal, and each text part of a template literal (its head, middles and
// tail, never its `${…}` substitutions, so `Analysis: ${record.title}` passes).
// Comments and identifiers are never read: they are not text nodes.
//
// WHAT FAILS. A text that matches `/\brecords?\b/i`, unless it is
//   - a path: it starts with `/`, `@/`, `./` or `../`, or carries a
//     `/records` segment (which also covers `/api/records`);
//   - an import or export specifier (`import … from '…'`, `export … from '…'`,
//     `import('…')`, `require('…')`);
//   - covered by an ALLOWLIST entry for its file. An entry names its text
//     either whole (`text`: the node's or part's whole text, whitespace
//     collapsed and trimmed) or as a `phrase` inside a node whose other words
//     the ruling renamed; a phrase covers only the record words that sit
//     inside it. Every entry carries its reason class and the census rows it
//     stands for.
// A failure names each offending line (the line the word itself sits on).
//
// BIDIRECTIONAL. Each entry must cover exactly `count` text parts in its file:
// an entry whose words were renamed or moved fails here, as does a second
// copy of an allowed sentence. A `pending` entry leaves the list when the
// research ruling renames its row (UX-1 PW's follow-up).
//
// BLIND SPOTS, stated. Only the files in `FILES` are read: P1's, P7's and
// P3a's files have their own phases, and ruled copy (`copy.ts`, `seal-only.ts`,
// `unsigned-tier.ts`, `RunningUnsignedBanner.tsx`) and `privacy-facts.ts` are
// out of this phase. A word assembled at run time from parts ("rec" + "ord"),
// or read from data, is not seen. Header.tsx's `My analyses` (was `Dashboard`)
// holds no record word on either side, so this guard does not read that
// rename; `ruled-words-surfaces.test.ts` does.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const WORD = /\brecords?\b/gi;

/** Every file holding a PW row of the census (#719 G0-6), RULED, one-for-one, pending or kept. */
const FILES: readonly string[] = [
  // The rows this phase renames (RULED and one-for-one).
  'src/components/dashboard/DashboardTabs.tsx',
  'src/components/Header.tsx',
  'src/app/(app)/evidence/page.tsx',
  'src/components/evidence/EvidenceIndex.tsx',
  'src/components/notebook/NotebookOutput.tsx',
  'src/components/shared/McpResponseDisplay.tsx',
  'src/app/(app)/dashboard/page.tsx',
  'src/app/(app)/evidence/[slug]/page.tsx',
  'src/app/(app)/auth/device/page.tsx',
  'src/app/(app)/auth/device/DeviceApprovalPanel.tsx',
  'src/components/evidence/EvidenceActions.tsx',
  'src/components/evidence/CitationBlock.tsx',
  'src/components/evidence/AttestationDialog.tsx',
  'src/components/evidence/AttestationSection.tsx',
  'src/components/answer-view/WhereItWent.tsx',
  'src/components/answer-view/adapt-record.ts',
  'src/lib/answer-layout/published-line.ts',
  'src/lib/evidence/query-step.ts',
  'src/lib/notebook.ts',
  'src/lib/streaming.ts',
  // Files whose PW rows are all pending (G0) or kept.
  'src/app/(app)/ask/page.tsx',
  'src/components/QueryForm.tsx',
  'src/components/evidence/VerifyBadge.tsx',
  'src/components/evidence/NotebookSection.tsx',
  'src/lib/evidence/package-download.ts',
  'src/lib/evidence/record-citation.ts',
  'src/components/notebook/ChatCitationPreview.tsx',
  'src/components/answer-view/AnswerView.tsx',
  'src/components/notebook/ChatSignersSection.tsx',
  'src/components/answer-view/view-model.ts',
  'src/app/api/evidence/[slug]/attestations/route.ts',
  'src/app/api/evidence/[slug]/bundle/route.ts',
  'src/app/api/evidence/[slug]/commitment/route.ts',
  'src/app/api/evidence/[slug]/evaluate/route.ts',
  'src/app/api/evidence/[slug]/publish/route.ts',
  'src/app/api/evidence/[slug]/reinstate/route.ts',
  'src/app/api/evidence/[slug]/replay/route.ts',
  'src/app/api/evidence/[slug]/withdraw/route.ts',
  'src/app/api/evidence/route.ts',
  'src/lib/evidence/identifier.ts',
];

/**
 * Why a record word stays. `pending`: a G0 row of the census, awaiting the
 * research check's ruling. `keep`: a row the census marks keep. `KEPT`: R19 A's
 * exceptions. `ruled copy`: text a ruling holds verbatim. `sense 2`: rows of a
 * dataset. `sense 4`: the standard's noun. `verb`: "records" as a verb.
 * `code value`: a value the code reads and no reader sees (UX-2 P5: the P9
 * frame's `width="record"`, `ui/Page.tsx`).
 */
type Reason = 'pending' | 'keep' | 'KEPT' | 'ruled copy' | 'sense 2' | 'sense 4' | 'verb' | 'code value';

interface Allowed {
  file: string;
  /** The census rows (`:line`) this entry stands for, as read at the base. */
  rows: string;
  reason: Reason;
  /** The node's or part's whole text, whitespace collapsed and trimmed. */
  text?: string;
  /** A phrase inside a node whose other record words were renamed. */
  phrase?: string;
  /** How many text parts in the file this entry covers. */
  count: number;
}

const API_NOT_FOUND = 'Record not found';

// The rulings that keep a row (UX-1, 2026-11-03): C12 ("execution record"),
// D6 (download file names), C22 (the API messages no dialog shows). D4 B's
// not-reversible sentence and D5's unsigned and sealed sentences left the list
// in UX-2 PW2: G0-4 B moved their noun to "analysis" (#729, S1-S3, S8).
const ALLOWLIST: readonly Allowed[] = [
  // DashboardTabs.tsx
  { file: 'src/components/dashboard/DashboardTabs.tsx', rows: ':601', reason: 'keep', phrase: 'The prior withdrawal record is preserved', count: 1 },

  // The P9 frame's width name (UX-2 P5, the record frame): a value, never rendered.
  { file: 'src/app/(app)/evidence/page.tsx', rows: 'UX-2 P5 (`<Page width="record">`)', reason: 'code value', text: 'record', count: 1 },
  { file: 'src/app/(app)/evidence/[slug]/page.tsx', rows: 'UX-2 P5 (`<Page width="record">`)', reason: 'code value', text: 'record', count: 1 },

  // NotebookOutput.tsx: "execution record" (C12).
  { file: 'src/components/notebook/NotebookOutput.tsx', rows: ':241 (C12)', reason: 'keep', text: 'Publishes the executed notebook and its execution record — not a regenerated skeleton.', count: 1 },

  // streaming.ts: rows of a dataset (F18's sense 2).
  { file: 'src/lib/streaming.ts', rows: ':1064', reason: 'sense 2', text: 'bill, law or other legislative record', count: 1 },
  { file: 'src/lib/streaming.ts', rows: ':1065', reason: 'sense 2', text: 'bills, laws and other legislative records', count: 1 },
  { file: 'src/lib/streaming.ts', rows: ':1067', reason: 'sense 2', text: 'Search legislative records', count: 1 },
  { file: 'src/lib/streaming.ts', rows: ':1510, :1554 (`Retrieved ${n} record${…}`)', reason: 'sense 2', text: 'record', count: 2 },
  { file: 'src/lib/streaming.ts', rows: ':1461, :1587, :1821, :1901 (twice)', reason: 'sense 2', text: 'records', count: 5 },
  { file: 'src/lib/streaming.ts', rows: ':1677', reason: 'sense 2', text: 'count or aggregate records', count: 1 },
  { file: 'src/lib/streaming.ts', rows: ':1751', reason: 'sense 2', text: 'Running a structured query against the dataset — filtering and aggregating records to answer the question.', count: 1 },
  { file: 'src/lib/streaming.ts', rows: ':1759', reason: 'sense 2', text: 'Checking dataset statistics — how many records exist and how often the data is updated.', count: 1 },
  { file: 'src/lib/streaming.ts', rows: ':1905', reason: 'sense 2', text: 'queried records', count: 1 },
  { file: 'src/lib/streaming.ts', rows: ':2118', reason: 'sense 2', text: 'records analyzed', count: 1 },

  // QueryForm.tsx: "execution record" (C12).
  { file: 'src/components/QueryForm.tsx', rows: ':578 (C12)', reason: 'keep', text: 'Generates and executes a Jupyter notebook against live data. Typically 30 to 90 seconds. The notebook and a cryptographic execution record are signed by the platform.', count: 1 },
  { file: 'src/components/QueryForm.tsx', rows: ':654, :655 (C12)', reason: 'keep', phrase: 'Executed-sandbox mode generates and runs a Jupyter notebook against live data, then signs the execution record.', count: 2 },

  // Download file names (D6).
  { file: 'src/components/evidence/NotebookSection.tsx', rows: ':96 (D6, file name)', reason: 'keep', text: 'record-', count: 1 },
  { file: 'src/lib/evidence/package-download.ts', rows: ':37 (D6, file name)', reason: 'keep', text: 'record-', count: 1 },

  // adapt-record.ts: X29's note (UX-2 P5, RULED), "record" in the standard's sense.
  { file: 'src/components/answer-view/adapt-record.ts', rows: ':360 (X29)', reason: 'ruled copy', phrase: 'Answer kept outside the signed record', count: 1 },

  // AnswerView.tsx
  { file: 'src/components/answer-view/AnswerView.tsx', rows: ':605', reason: 'verb', text: 'The notebook metadata records the sandbox runtime versions used at execution.', count: 1 },

  // The API messages no dialog shows (C22).
  { file: 'src/app/api/evidence/[slug]/bundle/route.ts', rows: ':162, :172 (C22)', reason: 'keep', text: API_NOT_FOUND, count: 2 },
  { file: 'src/app/api/evidence/[slug]/commitment/route.ts', rows: ':113 (C22)', reason: 'keep', text: API_NOT_FOUND, count: 1 },
  { file: 'src/lib/evidence/identifier.ts', rows: ':72 (C22)', reason: 'keep', text: 'No published record package for this identifier', count: 1 },
  { file: 'src/lib/evidence/identifier.ts', rows: ':77 (C22)', reason: 'keep', text: API_NOT_FOUND, count: 1 },
];

// --- The reader -------------------------------------------------------------------

/** One record word in one text part. */
interface Hit {
  /** The line the word sits on (1-based). */
  line: number;
  /** The part's text, whitespace collapsed and trimmed. */
  text: string;
  /** The word's offsets in `text`. */
  start: number;
  end: number;
  /** The text part it sits in (one per node, or per template part). */
  part: number;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

const isPath = (s: string): boolean => /^(\/|@\/|\.\.?\/)/.test(s) || /\/records\b/i.test(s);

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent) && parent.parent && ts.isImportTypeNode(parent.parent)) return true;
  if (ts.isCallExpression(parent)) {
    if (parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(parent.expression) && parent.expression.text === 'require') return true;
  }
  return false;
}

/** Every record word in a source's text nodes and template text parts. */
function recordWords(fileName: string, source: string): Hit[] {
  const kind = /\.[cm]?[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits: Hit[] = [];
  let part = 0;
  const visit = (node: ts.Node): void => {
    let cooked: string | null = null;
    if (ts.isJsxText(node)) cooked = node.text;
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) cooked = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) cooked = node.text;
    if (cooked !== null && !isModuleSpecifier(node) && !isPath(cooked)) {
      const text = collapse(cooked);
      const words = [...text.matchAll(WORD)];
      if (words.length > 0) {
        part += 1;
        // The line each word sits on: the same word, counted the same way, in the raw source span.
        const start = node.getStart(sf);
        const raw = source.slice(start, node.getEnd());
        const rawWords = [...raw.matchAll(WORD)];
        words.forEach((m, i) => {
          const at = rawWords.length === words.length ? start + (rawWords[i].index ?? 0) : start;
          hits.push({ line: sf.getLineAndCharacterOfPosition(at).line + 1, text, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, part });
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** The entry that covers a hit: a whole-text entry first, then a phrase that contains the word. */
function coveringEntry(hit: Hit, entries: readonly Allowed[]): Allowed | undefined {
  const whole = entries.find((e) => e.text !== undefined && e.text === hit.text);
  if (whole) return whole;
  return entries.find((e) => {
    if (e.phrase === undefined) return false;
    for (let i = hit.text.indexOf(e.phrase); i !== -1; i = hit.text.indexOf(e.phrase, i + 1)) {
      if (i <= hit.start && hit.end <= i + e.phrase.length) return true;
    }
    return false;
  });
}

interface FileReading {
  /** Record words no entry covers: `:line  "text"`. */
  uncovered: { line: number; text: string }[];
  /** How many text parts each entry covers. */
  used: Map<Allowed, number>;
}

function readFile(file: string, source: string, allowlist: readonly Allowed[]): FileReading {
  const entries = allowlist.filter((e) => e.file === file);
  const used = new Map<Allowed, number>(entries.map((e) => [e, 0]));
  const partsCovered = new Map<Allowed, Set<number>>();
  const uncovered: { line: number; text: string }[] = [];
  for (const hit of recordWords(file, source)) {
    const entry = coveringEntry(hit, entries);
    if (entry === undefined) {
      if (!uncovered.some((u) => u.line === hit.line && u.text === hit.text)) uncovered.push({ line: hit.line, text: hit.text });
      continue;
    }
    const parts = partsCovered.get(entry) ?? new Set<number>();
    parts.add(hit.part);
    partsCovered.set(entry, parts);
  }
  for (const [entry, parts] of partsCovered) used.set(entry, parts.size);
  return { uncovered, used };
}

const sourceOf = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

// --- The instrument, shown able to fail --------------------------------------------

test('the reader finds a record word in each kind of text node, and skips paths, specifiers, substitutions, comments and identifiers', () => {
  const fixture = [
    "import x from './records/a';",
    "export { y } from '@/lib/record-thing';",
    'const lazy = () => import(\'./record-lazy\');',
    '// a comment about a record',
    'const record = 1;',
    "const a = 'Browse records';",
    'const b = `My Records`;',
    'const c = `Analysis: ${record} and record ${record}`;',
    "const d = '/records/abc';",
    "const e = '/api/records/list';",
    'export function F() { return <p title="Cite this record">Withdraw Record</p>; }',
  ].join('\n');
  const hits = recordWords('fixture.tsx', fixture);
  const seen = hits.map((h) => `${h.line}:${h.text}`);
  assert.deepEqual(seen, [
    '6:Browse records',
    '7:My Records',
    '8:and record',
    '11:Cite this record',
    '11:Withdraw Record',
  ], `the reader read: ${JSON.stringify(seen)}`);

  // An entry covers its own text and nothing else; a phrase covers only the words inside it.
  const allow: Allowed[] = [
    { file: 'f.tsx', rows: '-', reason: 'keep', text: 'Withdraw Record', count: 1 },
    { file: 'f.tsx', rows: '-', reason: 'keep', phrase: 'the prior withdrawal record', count: 1 },
  ];
  const mixed = 'export const P = () => <p>This record is back; the prior withdrawal record stays.</p>;\nexport const Q = () => <h3>Withdraw Record</h3>;';
  const reading = readFile('f.tsx', mixed, allow);
  assert.deepEqual(reading.uncovered.map((u) => u.line), [1], 'the phrase covered a word outside it');
  assert.deepEqual([...reading.used.values()], [1, 1]);
});

// --- The guard ---------------------------------------------------------------------

for (const file of FILES) {
  test(`census guard: no record word the ruling renamed in ${file}`, () => {
    const { uncovered } = readFile(file, sourceOf(file), ALLOWLIST);
    assert.equal(
      uncovered.length,
      0,
      `${uncovered.length} line(s) carry a record word no allowlist entry covers:\n` +
        uncovered.map((u) => `  ${file}:${u.line}  ${JSON.stringify(u.text)}`).join('\n'),
    );
  });
}

test('census guard: every allowlist entry covers exactly its count of text parts, in a file the guard reads', () => {
  const problems: string[] = [];
  const unread = ALLOWLIST.filter((e) => !FILES.includes(e.file));
  for (const e of unread) problems.push(`${e.file} ${e.rows}: the guard does not read this file`);
  for (const e of ALLOWLIST) {
    if ((e.text === undefined) === (e.phrase === undefined)) problems.push(`${e.file} ${e.rows}: an entry names a text or a phrase, exactly one`);
    const named = e.text ?? e.phrase ?? '';
    if (!new RegExp(WORD.source, 'i').test(named)) problems.push(`${e.file} ${e.rows}: the entry holds no record word`);
  }
  for (const file of FILES) {
    const { used } = readFile(file, sourceOf(file), ALLOWLIST);
    for (const [e, n] of used) {
      if (n !== e.count) problems.push(`${file} ${e.rows} (${e.reason}) ${JSON.stringify(e.text ?? e.phrase)}: covers ${n} text part(s), expected ${e.count}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('census guard: every file the guard reads exists', () => {
  const missing = FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, []);
});
