// The answer view's model: the seven parts every run surface lays out, in one
// order, and the words that say who wrote each (LAYOUT-WEB W3 P1, design §4.1
// and §6). Pure: no React, no DOM — the adapters build it from a surface's
// state (`adapt-comparison.ts`, `adapt-notebook.ts`), and `AnswerView.tsx`
// renders it. Where the parts sit is decided here and in the view, once, so
// the surfaces cannot drift (the failure #115 names).
//
// Relative, extension-carrying imports (the convention of src/lib since #345):
// the test runner has no path mapping.

import type { ClosingRow, ProgressGroup, ProgressLogEntry, StepCall, StepView } from '../../lib/answer-view/steps.ts';
import type { DeliberativeTraceLine, NotebookOutput } from './buildChatEvidenceView.ts';

// --- The order -------------------------------------------------------------------

/** The seven parts, in the order a reader meets them (design §4.1). */
export const PART_ORDER = ['status-row', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'] as const;
export type PartName = (typeof PART_ORDER)[number];

/** The one disclosure's label (LAYOUT-W1, kept). */
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
}

/** What the answer is: markdown, a rendering cell's outputs, or nothing. */
export type AnswerContent =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'cell-outputs'; outputs: NotebookOutput[] }
  | { kind: 'none' };

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
  | { kind: 'pending' };

/** Part 6: one disclosure, closed, holding the envelope's sections in order. */
export interface DisclosurePart {
  /** A · Initial prompt. */
  question?: { author: string; prompt: string };
  /** B · System prompts. */
  instructions?: InstructionsSection;
  /** C · Model + environment. */
  environment?: EnvironmentItem[];
  /** D · Deliberative trace: each call's recorded fields, in `deliberativeTraceLine`'s words. */
  trace?: Array<DeliberativeTraceLine & { failed: boolean }>;
  /** E · Answer notebook. */
  notebook?: { notebook: unknown; scopeSentence: string };
  /** F · Rendered answer: the answer part again. */
  answerAgain: boolean;
  /** G · Summary. */
  summary?: SummarySection;
  /** The signers, before publication. */
  signers?: { executedAt: string | null; signingKeyId: string | null };
}

/** The whole view. A part a surface does not have is null. */
export interface AnswerViewModel {
  status: StatusPart | null;
  /** A heading over the answer, when the surface names one. */
  title?: string;
  answer: AnswerPart;
  citation: CitationPart | null;
  steps: StepsPart | null;
  sources: SourcesPart | null;
  disclosure: DisclosurePart;
}
