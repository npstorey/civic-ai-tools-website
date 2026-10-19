// The record adapter: a published record — its package, as stored and as the
// page resolved it, and its row — in, the answer view's model out (LAYOUT-WEB
// W3 P2, design §4.2 option A: the third adapter). Pure — no React, no DOM, no
// read of its own; the page (`src/app/(app)/evidence/[slug]/page.tsx`, a server
// component) calls it with what it loaded and the instance it declares, and
// hands the model to `AnswerView`, a client component. So the model is plain
// data: a function or a class instance cannot cross that boundary.
//
// It reads a record and places its parts; it never rewrites one (layout rule
// 1). What each part reads:
//   1. the status row: the notebook's own reading of whether it ran, then, for
//      an A-G-format record, the spec link and the notebook download (W1's
//      ruling D1); under it, the refused-request line and the record-level
//      unrecorded-outcomes sentence (D2), the request list read against the
//      trace once (D1, #430);
//   2. the answer, through the component every surface uses: for a record
//      carrying an executed notebook whose rendering cell's text is byte-equal
//      to the record's signed `output`, that cell's outputs as
//      `adapt-notebook.ts` takes them; otherwise the record's `output` (#115;
//      the W3 fix, ruling 1: the record shows what it signed);
//   3. the citation: the page's `CitationBlock`, under this instance's line;
//   4. the steps: one per signed `queries[]` entry (`buildRecordStepView`);
//   5. no sources line (see `record-page-layout.test.ts`'s W3 P2 header);
//   6. the disclosure: A-G as W1 placed them — A the question (or its hash),
//      B the skill prompt when the record carries its text, C the model and
//      environment, D each call's signed fields raw, E the notebook, F the
//      answer again, G the summary.
//
// WHO WROTE EACH PART (design §6), only where the record states it:
//   - the question is the package's `prompt`: "written by the person who asked";
//   - the answer, by the model `cost.model` names;
//   - the citation and the steps are written by this instance when it renders;
//   - B: this instance composed the instructions only for a record its own chat
//     flow captured (`captureMethod` `chat-flow-stream`: the package's signed
//     label, else the row's, which the publish route writes from the same
//     field). `serverAddressPolicy` (`packager.ts`) asks the same question of
//     the same label. Otherwise no line;
//   - G: the record states no producer for its summary, so no line;
//   - the status row, D and E: §6 gives no words (the owner's ruling A).
//
// Relative, extension-carrying imports, so the module runs under `node --test`
// with no loader, as the two run adapters beside it do.

import { adaptNotebook, renderingCellText } from './adapt-notebook.ts';
import { AUTHOR, type AnswerPart, type AnswerViewModel, type EnvironmentItem, type RecordTraceEntry, type StatusFact, type StepsPart } from './view-model.ts';
import { buildChatEvidenceView } from './buildChatEvidenceView.ts';
import { buildRecordStepView, stepsAuthorLine } from '../../lib/answer-view/steps.ts';
import {
  describeQueryOutcome,
  describeRefusedRequests,
  describeUnrecordedOutcomes,
  readRefusalsFromTrace,
} from '../../lib/evidence/query-step.ts';
import { describeSkillDisclosure, carriesSkillText } from '../../lib/evidence/skill-disclosure.ts';
import { formatDataSourcesSummary } from '../../lib/evidence/data-sources.ts';
import { upstreamToolName } from '../../lib/mcp/operation-types.ts';
import { formatModelName, estimateCostUsd } from '../../lib/models.ts';
import {
  NOTEBOOK_EXTENSION_KEY,
  readNotebookProvenanceOfNotebook,
} from '../../lib/notebook-author/notebook-provenance-reading.ts';
import { reproductionAssertionFor } from '../../lib/notebook-author/reproduction-assertion.ts';
// Type-only: erased at compile time.
import type { EvidencePackage } from '../../lib/evidence/packager.ts';
import type { BlobRef } from '../../lib/evidence/blob-ref.ts';
import type { Notebook } from '../../lib/notebook-author/cells.ts';

/** What the page resolved before rendering (`resolvePackageForRender`). */
export interface ResolvedPackageData {
  /** The package with a BlobRef `output` fetched into a string, and a BlobRef `skillText` blanked. */
  pkg: EvidencePackage;
  outputIsBlob: boolean;
  outputBlobRef: BlobRef | null;
  /** The output is a blob the page could not fetch: `pkg.output` holds a placeholder, not the model's words. */
  outputUnavailable?: boolean;
  /**
   * The output is a blob whose fetched bytes verify-core's check (`verifyBlobRef`)
   * found to match the record's reference, and `pkg.output` holds those bytes.
   * The blob note says "verified" only when this is true.
   */
  outputVerified?: boolean;
  /**
   * The output is a blob whose fetched bytes did not verify against the
   * record's reference: `pkg.output` holds a placeholder, and the bytes are not shown.
   */
  outputMismatch?: boolean;
  skillTextIsBlob: boolean;
  skillTextBlobRef: BlobRef | null;
}

/** The fields of the record's row the view reads; nothing else of the row reaches the model. */
export interface RecordRowInput {
  slug: string;
  /** The row's summary: G when the package carries none. */
  summary: string;
  contentProfile: string | null;
  captureMethod: string | null;
}

export interface RecordAdapterInput {
  /** The package as stored, or null when none was loaded. */
  stored: EvidencePackage | null;
  /** What the page resolved from it; null when there is no package. */
  resolution: ResolvedPackageData | null;
  row: RecordRowInput;
  /** The instance's declared host (`getInstanceAttribution().host`), or null. */
  instance: string | null;
}

/**
 * The answer part's words when the output blob could not be fetched. The site
 * wrote them, so they sit under no author line (design §6: nothing the site
 * wrote sits under a label that names the model).
 */
export const OUTPUT_UNAVAILABLE =
  'The answer is not shown: the stored copy of this record’s output could not be fetched. The package hash below identifies the record for audit.';

/**
 * The answer part's words when the output blob was fetched and its bytes do
 * not match the record's reference. The site wrote them, so they sit under no
 * author line, as `OUTPUT_UNAVAILABLE` does.
 */
export const OUTPUT_DOES_NOT_MATCH =
  'The answer is not shown: the stored copy of this record’s output does not match the record’s reference to it. The package hash below identifies the record for audit.';

/** The spec section the status row links an A-G-format record to. */
export const DATHERE_SPEC_URL =
  'https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/typed-standards-specification.md#87-content-profile-dathere';

/** The org.civicaitools.environment extension (spec §8.7.1 requirement 3), or null when absent or malformed. */
function environmentExtension(pkg: EvidencePackage): {
  modelVersion?: string;
  temperature?: number;
  mcpServers?: Array<{ url: string; name?: string }>;
  host?: string;
} | null {
  const ext = pkg.extensions?.['org.civicaitools.environment'];
  if (!ext || typeof ext !== 'object') return null;
  return ext as ReturnType<typeof environmentExtension> & object;
}

/**
 * C's "MCP servers" value (R7 P4, ruling a2): each entry's host, or its raw
 * value when the URL parses with an empty host (a hosted source's purl) or does
 * not parse. Carried from the page unchanged.
 */
export function mcpServerHosts(servers: Array<{ url: string }> | undefined): string | undefined {
  return servers
    ?.map((s) => {
      try { return new URL(s.url).host || s.url; } catch { return s.url; }
    })
    .join(', ');
}

/**
 * The answer: what the record signed (the W3 fix, ruling 1).
 *   - An output blob the page could not fetch, or whose bytes did not verify,
 *     is not shown: the site says so, under no author line.
 *   - A record carrying an executed notebook whose rendering cell holds outputs
 *     answers with that cell's outputs, taken by the executed run's own adapter
 *     so the two cannot differ, ONLY when the cell's text (`renderingCellText`)
 *     is byte-equal to the signed `output`. Otherwise a later divergence would
 *     put unsigned text in the answer's place; the cell stays in E.
 *   - Any other record answers with its `output`, under the model's line; a
 *     record with no output text answers `none`, the site's sentence, under no
 *     line (design §6).
 */
function recordAnswer(pkg: EvidencePackage, notebook: unknown, modelName: string, resolution: ResolvedPackageData | null): AnswerPart {
  if (resolution?.outputUnavailable === true) {
    return { content: { kind: 'unavailable', text: OUTPUT_UNAVAILABLE }, authors: [], streaming: false };
  }
  if (resolution?.outputMismatch === true) {
    return { content: { kind: 'unavailable', text: OUTPUT_DOES_NOT_MATCH }, authors: [], streaming: false };
  }
  if (typeof pkg.output !== 'string') {
    return { content: { kind: 'none' }, authors: [], streaming: false };
  }
  if (notebook !== undefined && readNotebookProvenanceOfNotebook(notebook).state === 'executed') {
    const outputs = buildChatEvidenceView({ notebook: notebook as Notebook, prompt: '', model: '', portal: '', toolCalls: [] }).renderingCellOutputs;
    if (outputs !== null && outputs.length > 0 && renderingCellText(outputs) === pkg.output) {
      return adaptNotebook({
        notebook: notebook as Notebook,
        prompt: '',
        model: pkg.cost.model,
        portal: '',
        toolCalls: [],
        instance: null,
        socrataMcpUrl: null,
      }).answer;
    }
  }
  return {
    content: { kind: 'markdown', markdown: pkg.output },
    authors: [{ key: 'answer', text: AUTHOR.answer(modelName) }],
    streaming: false,
  };
}

export function adaptRecord(input: RecordAdapterInput): AnswerViewModel {
  const { row, instance } = input;
  const pkg = input.resolution?.pkg ?? input.stored;
  const isDatHere = row.contentProfile === 'datHere';
  const bundleHref = `/api/records/${row.slug}/bundle`;

  const notebook = pkg?.extensions?.[NOTEBOOK_EXTENSION_KEY];
  const reading = notebook !== undefined ? readNotebookProvenanceOfNotebook(notebook) : null;

  // The status row (ruling D1): the notebook's reading, then the A-G links.
  const facts: StatusFact[] = [
    ...(reading !== null ? [{ text: reading.label }] : []),
    ...(isDatHere
      ? [{ text: 'Typed Standards §8.7', href: DATHERE_SPEC_URL, external: true }, { text: 'Download notebook (.ipynb)', href: bundleHref }]
      : []),
  ];

  // The citation is the page's block, under this instance's line.
  const recordCitation = { author: AUTHOR.citation(instance) };

  if (pkg === null) {
    // No package to load: the parts that need none — the status links, the
    // citation, and G from the row.
    return {
      status: { facts, refused: null, unrecorded: null },
      answer: { content: { kind: 'absent' }, authors: [], streaming: false },
      citation: null,
      recordCitation,
      steps: null,
      sources: null,
      disclosure: { answerAgain: false, summary: { kind: 'stated', author: null, text: row.summary } },
    };
  }

  // Ruling D1 (#430): the request list read against its trace once; a declined
  // reading leaves every entry as its own fields say. Read by the refused line,
  // the steps and D, so the three cannot disagree.
  const fromTrace = readRefusalsFromTrace(pkg);
  const modelName = formatModelName(pkg.cost.model);

  const stepView = buildRecordStepView(pkg.queries, fromTrace.refused);
  const steps: StepsPart | null = stepView.steps.length > 0
    ? { kind: 'step-view', author: stepsAuthorLine(instance), view: stepView, closing: [] }
    : null;

  // B: the skill prompt, asked of the package AS STORED — the page's resolution
  // blanks a BlobRef `skillText`, and the disclosure has to see the reference
  // to answer `blob` rather than `hash-only` (#411, D3).
  const skillDisclosure = describeSkillDisclosure(input.stored?.skillMetadata ?? pkg.skillMetadata);
  const captureMethod = pkg.metadata.captureMethod ?? row.captureMethod;
  const recordInstructions = carriesSkillText(skillDisclosure)
    ? { author: captureMethod === 'chat-flow-stream' ? AUTHOR.instructions(instance) : null, disclosure: skillDisclosure }
    : undefined;

  // C · Model + environment, with what the old format's Resources Used carried
  // (W1 ruling D7), for every format.
  const env = environmentExtension(pkg);
  const envMcpHosts = mcpServerHosts(env?.mcpServers);
  const cost = estimateCostUsd(pkg.cost.model, pkg.cost.promptTokens || 0, pkg.cost.completionTokens || 0);
  const skillHash = pkg.skillMetadata?.systemPromptHash;
  const dataSourcesSummary = formatDataSourcesSummary(pkg.dataSources);
  const blobFields: string[] = [];
  if (input.resolution?.outputIsBlob) blobFields.push('output');
  if (input.resolution?.skillTextIsBlob) blobFields.push('skill text');
  const environment: EnvironmentItem[] = [
    { label: 'Model', value: modelName },
    ...(env?.modelVersion && env.modelVersion !== pkg.cost.model ? [{ label: 'Model version', value: env.modelVersion }] : []),
    ...(env?.temperature !== undefined ? [{ label: 'Temperature', value: String(env.temperature) }] : []),
    ...(env?.host ? [{ label: 'Publishing host', value: env.host }] : []),
    ...(envMcpHosts ? [{ label: 'MCP servers', value: envMcpHosts }] : []),
    { label: 'Content profile', value: row.contentProfile ?? 'default' },
    { label: 'Data sources', value: dataSourcesSummary ?? '—' },
    // A hash-only skill prompt (#411) has no section B; this is where its hash is disclosed.
    ...(skillHash ? [{ label: 'Skill hash', value: skillHash.slice(0, 12), mono: true }] : []),
    { label: 'Prompt tokens', value: pkg.cost.promptTokens?.toLocaleString() || '—' },
    { label: 'Completion tokens', value: pkg.cost.completionTokens?.toLocaleString() || '—' },
    { label: 'Total tokens', value: pkg.cost.totalTokens?.toLocaleString() || '—' },
    { label: 'Estimated cost', value: cost !== null ? `~$${cost.toFixed(cost < 0.01 ? 4 : 2)}` : '—' },
    { label: 'Duration', value: pkg.cost.durationMs ? `${(pkg.cost.durationMs / 1000).toFixed(1)}s` : '—' },
    { label: 'Tool calls', value: String(pkg.queries.length) },
    ...(blobFields.length > 0 ? [{ label: 'Blob-stored fields', value: blobFields.join(', ') }] : []),
  ];

  // D · each call's signed fields, raw (W1 ruling D6). #384 F5: what the call
  // returned is stated through the one formatter every renderer shares, reading
  // the trace as the refused line does. The signed duration is shown raw only
  // when the outcome sentence does not state it (LAYOUT-W1 P3, #413).
  const recordTrace: RecordTraceEntry[] = pkg.queries.map((q, i) => {
    const outcome = describeQueryOutcome(q, { refusedInTrace: fromTrace.refused.has(i) });
    const duration = outcome.kind === 'unrecorded' ? q.duration_ms : undefined;
    return {
      // Read, and shown, by the upstream name (W2 P2): the name the model called stays where the record states it.
      label: `${upstreamToolName(q.tool)}${q.operationType ? ` (${q.operationType})` : ''}`,
      ...(q.datasetId ? { datasetId: q.datasetId } : {}),
      ...(q.portal ? { portal: q.portal } : {}),
      ...(duration !== undefined ? { durationMs: duration } : {}),
      argumentsJson: JSON.stringify(q.arguments, null, 2) ?? null,
      outcome: outcome.text,
    };
  });

  return {
    status: {
      facts,
      // Ruling D2: under the status row, outside the disclosure; each null when it has nothing to say.
      refused: describeRefusedRequests(pkg.queries, fromTrace.refused),
      unrecorded: describeUnrecordedOutcomes(pkg),
    },
    answer: recordAnswer(pkg, notebook, modelName, input.resolution),
    citation: null,
    recordCitation,
    steps,
    sources: null,
    disclosure: {
      question: { author: AUTHOR.questionAsked(), prompt: pkg.prompt.text || null, hash: pkg.prompt.hash || null },
      ...(recordInstructions ? { recordInstructions } : {}),
      environment,
      recordTrace,
      // E: what the page may claim about re-executing the notebook, read off the
      // notebook in hand (#416); the bundle download for an A-G-format record
      // only — the bundle route refuses any other profile.
      ...(notebook !== undefined
        ? { recordNotebook: { notebook, slug: row.slug, assertion: reproductionAssertionFor(notebook), bundleHref: isDatHere ? bundleHref : null } }
        : {}),
      answerAgain: true,
      // "Verified" only after verify-core's check passed on the bytes the page
      // renders (the W3 fix); no note for a blob that was not fetched or did not verify.
      ...(input.resolution?.outputIsBlob && input.resolution.outputBlobRef && input.resolution.outputVerified === true
        ? { answerNote: `Output stored as blob (verified) · ${input.resolution.outputBlobRef.size.toLocaleString()} bytes` }
        : {}),
      // G: the package's summary, else the row's, under no author line.
      summary: { kind: 'stated', author: null, text: pkg.summary ?? row.summary },
    },
  };
}
