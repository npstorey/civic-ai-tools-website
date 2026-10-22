// The answer view's model: the seven parts every surface lays out, in one
// order, and the words that say who wrote each (LAYOUT-WEB W3 P1 and P2,
// design §4.1 and §6). Pure: no React, no DOM — the adapters build it from a
// surface's state (`adapt-comparison.ts`, `adapt-notebook.ts`) or from a
// published record (`adapt-record.ts`), and `AnswerView.tsx` renders it. Where
// the parts sit is decided here and in the view, once, so the surfaces cannot
// drift (the failure #115 names). The fields marked "the record" are parts only
// a published record has; the run adapters never set them.
//
// Relative, extension-carrying imports (the convention of src/lib since #345):
// the test runner has no path mapping.

import type { ClosingRow, ProgressGroup, ProgressLogEntry, StepCall, StepView } from '../../lib/answer-view/steps.ts';
import type { DeliberativeTraceLine, NotebookOutput } from './buildChatEvidenceView.ts';
import type { SkillDisclosure } from '../../lib/evidence/skill-disclosure.ts';
import type { NotebookProvenanceState } from '../../lib/notebook-author/notebook-provenance-reading.ts';
import { PAGE_PART_VIEWS, type PagePartView } from '../../lib/answer-layout/index.ts';
import type { PublishedLayout } from '../../lib/answer-layout/published-line.ts';
import type { WhereItWentModel } from '../../lib/flows/where-it-went.ts';

// --- The order -------------------------------------------------------------------

/**
 * The seven parts, in their default places: the order a reader meets them
 * (design §4.1) when the layout is `answer-first`. Since LAYOUT-WEB W4 P1 the
 * view places them by the layout (`src/lib/answer-layout/`), whose part table
 * this is.
 */
export const PART_ORDER: readonly PagePartView[] = PAGE_PART_VIEWS;
export type PartName = PagePartView;

/** The one disclosure's label (LAYOUT-W1, kept): both built-in layouts carry it. */
export const DISCLOSURE_LABEL = 'Learn more about how this analysis was produced';

// --- Who wrote each part (design §6) ------------------------------------------------
//
// An author line is a fact about production, not a layout choice: a layout
// places it and never rewords it (layout rule 4). A line that names the
// instance is omitted when the instance declares none, as the copy footer's
// attribution is (#258 A2): an absent identity is never filled in.

export const AUTHOR = {
  /** A: the question. Both run surfaces are before publication, so "you". */
  question: (): string => 'Question, written by you',
  /** A on a published record: the package's `prompt`, the question its asker wrote. */
  questionAsked: (): string => 'Question, written by the person who asked',
  /** The answer, and F. */
  answer: (modelName: string | null): string =>
    modelName ? `Answer, written by the model ${modelName}` : 'Answer, written by the model',
  /** The answer's outputs that a cell computed in the sandbox. */
  computedOutputs: (): string => 'Tables and figures, computed in the sandbox from the data returned',
  /** The citation. */
  citation: (instance: string | null): string | null => (instance ? `Citation, assembled by ${instance}` : null),
  /** The sources line: the portal hosts the rows came from. */
  sources: (hosts: readonly string[]): string | null => (hosts.length > 0 ? `Rows returned by ${hosts.join(', ')}` : null),
  /** B: the instructions the model was given. */
  instructions: (instance: string | null): string | null =>
    instance ? `Instructions, written by ${instance} and the data source's skill` : null,
  /** G, when the model wrote it. */
  summaryByModel: (): string => 'Summary, written by the model',
  /** G, when it is the first-sentence fallback. */
  summaryDerived: (instance: string | null): string | null => (instance ? `Summary, derived by ${instance} from the answer` : null),
  /** The timing bar. */
  timing: (instance: string | null): string | null => (instance ? `Measured by ${instance}` : null),
} as const;

// --- The parts ---------------------------------------------------------------------

/** One fact on the status row: its words, a part of them set in bold, and whether it is muted. */
export interface StatusFact {
  text: string;
  /** Words after `text`, set in bold (the capture method: "Captured via **Web chat**"). */
  strong?: string;
  /** The publication state is set muted. */
  muted?: boolean;
  /** The record: the fact is a link (the spec section, the notebook download). */
  href?: string;
  /** The link opens in a new tab. */
  external?: boolean;
}

/** The capture method both run surfaces state: both publish as `chat-flow-stream`. */
export const CAPTURED_VIA_WEB_CHAT: StatusFact = { text: 'Captured via ', strong: 'Web chat' };

/** The publication state of a run that has not been published. */
export const NOT_YET_PUBLISHED: StatusFact = { text: 'not yet published', muted: true };

/** Part 1: the status row, one line, and the refused-request line under it. */
export interface StatusPart {
  facts: StatusFact[];
  /** `describeRefusedRequests`' line, or null when no call was refused. */
  refused: string | null;
  /** The record: `describeUnrecordedOutcomes`' sentence, or null when it has nothing to say. */
  unrecorded?: string | null;
}

/** What the answer is: markdown, a rendering cell's outputs, or nothing. */
export type AnswerContent =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'cell-outputs'; outputs: NotebookOutput[] }
  | { kind: 'none' }
  /** The record: its package could not be loaded, so no answer is placed — first or as F. */
  | { kind: 'absent' }
  /** The record: its output is a blob the page could not fetch. `text` is the site's sentence saying so. */
  | { kind: 'unavailable'; text: string };

/** Part 2 (and F): rendered once, placed twice. */
export interface AnswerPart {
  content: AnswerContent;
  /** The author lines, in order: the model, then what the sandbox computed. */
  authors: Array<{ key: 'answer' | 'computed'; text: string }>;
  /** The answer is still streaming: the view draws a cursor after it. */
  streaming: boolean;
}

/** Part 3: the pre-publication citation (`ChatCitationPreview`). */
export interface CitationPart {
  prompt: string;
  executedAt: string | null;
  /** The run executes, so the preview states "Executed" and its date; false states neither. */
  statesExecution: boolean;
  structuredSummary: { analysisDescription: string; headlineFinding: string } | null;
  author: string | null;
}

/** Part 4: the steps — the comparison's progress log, or the executed run's step view. */
export type StepsPart =
  | {
      kind: 'progress-log';
      author: string | null;
      groups: ProgressGroup[];
      standaloneEntries: ProgressLogEntry[];
      isComplete: boolean;
      toolsCalled?: StepCall[];
      totalDuration_ms?: number;
    }
  | {
      kind: 'step-view';
      author: string | null;
      view: StepView;
      closing: ClosingRow[];
    };

/** Part 5: the sources line — the provenance line, under the hosts the rows came from. */
export interface SourcesPart {
  author: string | null;
  /** `buildProvenanceLine`'s markdown. */
  line: string;
}

/** One item of section C. */
export interface EnvironmentItem {
  label: string;
  value: string;
  mono?: boolean;
}

/** The record's citation: the page renders its own block (`CitationBlock`); the model names who assembled it. */
export interface RecordCitationPart {
  author: string | null;
}

/** The record's section B: the skill prompt it carries, as `describeSkillDisclosure` reads it. */
export interface RecordInstructionsSection {
  author: string | null;
  disclosure: SkillDisclosure;
}

/** One call in the record's section D: its signed fields, raw (W1 ruling D6). */
export interface RecordTraceEntry {
  /** The tool by its upstream name, and the operation type. */
  label: string;
  datasetId?: string;
  portal?: string;
  /** The signed `duration_ms`, only when the outcome sentence does not state it (#413). */
  durationMs?: number;
  /** The signed `arguments`, as JSON; null when the entry carries none. */
  argumentsJson: string | null;
  /** `describeQueryOutcome`'s text, read against the trace. */
  outcome: string;
}

/** The record's section E: the notebook, what the page may claim about re-running it, and the bundle. */
export interface RecordNotebookSection {
  notebook: unknown;
  slug: string;
  /** `reproductionAssertionFor`'s sentence, or null (#416). */
  assertion: string | null;
  /** The bundle download, for an A-G-format record only; else null. */
  bundleHref: string | null;
}

/** Section B: the instructions, by hash and, where the surface carries it, in full. */
export interface InstructionsSection {
  author: string | null;
  /** The SHA-256 of the composed prompt, or null when none was recorded. */
  hash: string | null;
  /**
   * The composed prompt itself. `undefined`: this surface never carries the
   * text (the comparison's trace records the hash only, #411 D3). `null`: it
   * carries it, and this run's stream did not deliver it.
   */
  text?: string | null;
}

/** Section G: the summary. */
export type SummarySection =
  | { kind: 'structured'; author: string; analysisDescription: string; headlineFinding: string }
  | { kind: 'derived'; author: string | null; text: string }
  /** The record: its summary, under a line only when the record states who produced it. */
  | { kind: 'stated'; author: string | null; text: string }
  | { kind: 'pending' };

/** Part 6: one disclosure, closed, holding the envelope's sections in order. */
export interface DisclosurePart {
  /** A · Initial prompt. `prompt` null: the record kept the hash only, shown instead. */
  question?: { author: string; prompt: string | null; hash?: string | null };
  /** B · System prompts. */
  instructions?: InstructionsSection;
  /** B on a published record. */
  recordInstructions?: RecordInstructionsSection;
  /** C · Model + environment. */
  environment?: EnvironmentItem[];
  /** D · Deliberative trace: each call's recorded fields, in `deliberativeTraceLine`'s words. */
  trace?: Array<DeliberativeTraceLine & { failed: boolean }>;
  /** D on a published record. */
  recordTrace?: RecordTraceEntry[];
  /** E · Answer notebook. */
  notebook?: { notebook: unknown; scopeSentence: string };
  /** E on a published record. */
  recordNotebook?: RecordNotebookSection;
  /** F · Rendered answer: the answer part again. */
  answerAgain: boolean;
  /** The record: a note under F (the output was stored as a blob). */
  answerNote?: string;
  /** G · Summary. */
  summary?: SummarySection;
  /** The signers, before publication; `provenance` is the notebook's own reading, which the production method states. */
  signers?: {
    executedAt: string | null;
    signingKeyId: string | null;
    provenance: { state: NotebookProvenanceState; label: string; detail: string | null };
  };
}

/** The whole view. A part a surface does not have is null. */
export interface AnswerViewModel {
  status: StatusPart | null;
  /** A heading over the answer, when the surface names one. */
  title?: string;
  answer: AnswerPart;
  citation: CitationPart | null;
  /** The record's citation, when the surface renders its own block. */
  recordCitation?: RecordCitationPart;
  steps: StepsPart | null;
  sources: SourcesPart | null;
  disclosure: DisclosurePart;
  /** The record: the layout its publication attestation names (LAYOUT-WEB W4 P2), for the foot line. */
  publishedLayout?: PublishedLayout;
  /** R6 W4: where the question went. Absent: the run carried no `flows`, or the record has no trace. */
  whereItWent?: WhereItWentModel;
}
