'use client';

/**
 * The answer view: one component every surface renders its answer through
 * (LAYOUT-WEB W3 P1 and P2, design §4.1 option A). An adapter builds the model
 * from a surface's state (`adapt-comparison.ts`, `adapt-notebook.ts`) or from a
 * published record (`adapt-record.ts`); this file decides where each part
 * sits, once, so the surfaces cannot drift.
 *
 * THE ORDER, by position in the markup:
 *   1. the status row, one line (`data-part="status-row"`), with the
 *      refused-request line under it (ruling D2) and, on a record, the
 *      record-level unrecorded-outcomes sentence;
 *   2. the answer (`data-part="answer"`), under its author line, with no
 *      section heading;
 *   3. the citation (`data-part="citation"`): the run's preview, or the
 *      record's own block (`citationBlock`);
 *   4. the steps (`data-part="steps"`): the comparison's progress log, or the
 *      executed run's step view and its closing rows;
 *   5. the sources line (`data-part="sources"`), then what the surface adds
 *      outside the disclosure (`notices`);
 *   6. one disclosure, closed, labelled "Learn more about how this analysis
 *      was produced": A, B, C, D, E, F (the same answer element again), G, the
 *      signers, then what the surface adds (`disclosureExtras`: on a record,
 *      the parts W1 placed after the envelope);
 *   7. the actions (`data-part="actions"`), the surface's controls; a record's
 *      Status History sits between the disclosure and them (`afterDisclosure`).
 * A part the surface does not have is not rendered. The record page sets its
 * sections at `h2`, under its own `h1` (`sectionHeading`).
 *
 * THE LAYOUT (LAYOUT-WEB W4 P1). The order above is the parts' default places,
 * and the `answer-first` layout's order. A layout (`src/lib/answer-layout/`)
 * reorders the parts and the disclosure's sections by name; a part it does not
 * name renders at its default place, and a name the view does not know renders
 * nothing, so no part is dropped (layout rule 2). The layout is the instance's
 * (`AnswerLayoutsProvider.tsx`, mounted in the root layout; the built-ins
 * when none is mounted), or the one the
 * reader chose for the session with the toggle at the foot of the view, beside
 * the line that names the layout (rule 5). Both sit outside the disclosure.
 * The server, and a reader who has not chosen, render the instance's default.
 *
 * WHO WROTE EACH PART. Every author line comes from the model (`AUTHOR` in
 * `view-model.ts`, design §6) and is rendered with `data-author`; this file
 * places the lines and never writes one. An honest-provenance sentence the
 * model carries (the status row's reading, the refused-request line) sits
 * outside the disclosure (layout rule 3).
 *
 * The answer element is built once and placed twice, so the two cannot
 * drift; the same component renders it on every surface, so one answer
 * renders the same markup on each.
 */
import { Fragment, useCallback, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProgressLog from '@/components/ProgressLog';
import ConsentStep from '@/components/answer-view/ConsentStep';
import NotebookSection from '@/components/evidence/NotebookSection';
import ChatSignersSection from '@/components/notebook/ChatSignersSection';
import ChatCitationPreview from '@/components/notebook/ChatCitationPreview';
import RenderingCellOutputs from '@/components/notebook/RenderingCellOutputs';
import SkillSection from '@/components/evidence/SkillSection';
// What the record can disclose about its composed skill prompt (#411, D3): the
// one decision every `SkillSection` site asks.
import { carriesSkillText } from '@/lib/evidence/skill-disclosure';
import { UNPLACED_CALLS_LINE, type StepViewCall } from '@/lib/answer-view/steps';
import { secondsText } from '@/lib/evidence/query-step';
import { useSessionChoice } from '@/hooks/useSessionChoice';
import { useAnswerLayouts } from '@/components/answer-view/AnswerLayoutsProvider';
import WhereItWent from '@/components/answer-view/WhereItWent';
import { LAYOUT_STORAGE_KEY } from '@/lib/query-presentation';
import {
  disclosureOrder,
  layoutId,
  pageOrder,
  parseStoredLayoutChoice,
  selectLayout,
  type DisclosureSectionView,
  type InstanceLayouts,
  type LayoutPayload,
  type PagePartView,
  type RecordSectionView,
} from '@/lib/answer-layout';
import { layoutFootLine, type PublishedLayout } from '@/lib/answer-layout/published-line';
import {
  type AnswerPart,
  type AnswerViewModel,
  type DisclosurePart,
  type StatusPart,
  type StepsPart,
} from './view-model';

// --- Pieces ---------------------------------------------------------------------

/**
 * react-markdown hands every override its hast `node` as a prop. Spread onto an
 * element, it becomes the attribute `node="[object Object]"`; each override
 * below takes it out before spreading the rest.
 */
type MarkdownProps<T extends keyof React.JSX.IntrinsicElements> = React.ComponentPropsWithoutRef<T> & { node?: unknown };

/** Links in an answer open in a new tab. */
const MARKDOWN_COMPONENTS = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a: ({ node, href, children, ...props }: MarkdownProps<'a'>) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }} {...props}>
      {children}
    </a>
  ),
};

/** The sources line renders inline: no block wrappers, monospace links. */
const SOURCES_COMPONENTS = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  p: ({ node, children, ...props }: MarkdownProps<'p'>) => <span {...props}>{children}</span>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a: ({ node, href, children, ...props }: MarkdownProps<'a'>) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--success)', textDecoration: 'underline', textUnderlineOffset: '2px', fontFamily: 'monospace', fontSize: '12px' }}
      {...props}
    >
      {children}
    </a>
  ),
};

const AUTHOR_LINE_STYLE: React.CSSProperties = { margin: '0 0 8px', fontSize: '12px', color: 'var(--text-muted)' };

function AuthorLine({ part, text }: { part: string; text: string | null }) {
  if (text === null) return null;
  return <p data-author={part} style={AUTHOR_LINE_STYLE}>{text}</p>;
}

/** A section heading's level: `h3` under a run's own `h2`, `h2` under the record page's `h1`. */
type HeadingLevel = 'h2' | 'h3';

function Section({ title, author, children, level = 'h3' }: { title: string; author?: ReactNode; children: ReactNode; level?: HeadingLevel }) {
  const Heading = level;
  return (
    <section style={{ marginBottom: '32px' }}>
      <Heading style={{ fontSize: level === 'h2' ? '18px' : '16px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
        {title}
      </Heading>
      {author}
      {children}
    </section>
  );
}

// --- 1. The status row -------------------------------------------------------------

function StatusRow({ status }: { status: StatusPart }) {
  const unrecorded = status.unrecorded ?? null;
  const lines = status.refused !== null || unrecorded !== null;
  return (
    <>
      {status.facts.length > 0 && (
        <div data-part="status-row" style={{
          fontSize: '13px', color: 'var(--text-secondary)',
          marginBottom: lines ? '8px' : '24px',
          display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'center',
        }}>
          {status.facts.map((fact, i) => (
            <Fragment key={i}>
              {i > 0 && <span>·</span>}
              {fact.href !== undefined ? (
                <a
                  href={fact.href}
                  {...(fact.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  style={{ color: 'var(--accent)' }}
                >
                  {fact.text}
                </a>
              ) : (
                <span style={fact.muted ? { fontStyle: 'italic', color: 'var(--text-muted)' } : undefined}>
                  {fact.text}{fact.strong !== undefined && <strong>{fact.strong}</strong>}
                </span>
              )}
            </Fragment>
          ))}
        </div>
      )}
      {/* Ruling D2: outside the disclosure, under the status row. Per-call text stays in D. */}
      {lines && (
        <div data-part="refused-requests" style={{ margin: '0 0 24px' }}>
          {status.refused !== null && (
            <p style={{ margin: unrecorded !== null ? '0 0 6px' : 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--error)' }}>
              {status.refused}
            </p>
          )}
          {unrecorded !== null && (
            <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {unrecorded}
            </p>
          )}
        </div>
      )}
    </>
  );
}

// --- 2. The answer ------------------------------------------------------------------

/** The answer's one render site, on every surface. */
export function AnswerBody({ answer }: { answer: AnswerPart }) {
  const content = answer.content;
  return (
    <div data-part="answer" className="response-markdown">
      {content.kind === 'cell-outputs' ? (
        <RenderingCellOutputs outputs={content.outputs} />
      ) : content.kind === 'unavailable' ? (
        // The site's own words, under no author line: nothing the model wrote is shown.
        <em data-part="answer-unavailable" style={{ color: 'var(--text-muted)' }}>{content.text}</em>
      ) : content.kind === 'markdown' ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{content.markdown}</ReactMarkdown>
      ) : (
        <em style={{ color: 'var(--text-muted)' }}>
          No synthesis was produced for this analysis.
        </em>
      )}
      {answer.streaming && (
        <span style={{
          display: 'inline-block', width: '2px', height: '1em', backgroundColor: 'var(--text-secondary)',
          marginLeft: '2px', animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom',
        }} />
      )}
    </div>
  );
}

function AnswerAuthors({ answer }: { answer: AnswerPart }) {
  return <>{answer.authors.map((a) => <AuthorLine key={a.key} part={a.key} text={a.text} />)}</>;
}

// --- 4. The steps -------------------------------------------------------------------

/**
 * One call in the step view: the site's sentence for it, and its outcome.
 * `line` is the reason line to print above the outcome, which may be none:
 * within a step a reason shared by consecutive calls is printed once
 * (`reasonLines`).
 */
function StepCallRow({ call, line }: { call: StepViewCall; line?: string | null }) {
  // `line` absent: the call's own sentence; null: no line (a shared reason printed above).
  const sentence = line === undefined ? call.sentence : line ?? undefined;
  return (
    <div data-part="step-call" style={{ marginTop: '6px', paddingLeft: '20px', fontSize: '13px', lineHeight: 1.5 }}>
      {sentence !== undefined && (
        <div data-part="step-sentence" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{sentence}</div>
      )}
      <div data-part="step-outcome" style={{ fontSize: '12px', color: call.failed ? 'var(--error)' : 'var(--text-muted)' }}>{call.outcome}</div>
    </div>
  );
}

/**
 * The reason line each call of a step prints (UX pass row 24): a run of
 * consecutive calls sharing one sentence prints it once, on its first call,
 * with ", N calls" when N > 1; the run's other calls print none. A call with
 * no sentence prints none and ends a run. Every call keeps its outcome row.
 * Render-time only: the step view model is unchanged.
 */
function reasonLines(calls: StepViewCall[]): Array<string | null> {
  const lines: Array<string | null> = calls.map(() => null);
  for (let i = 0; i < calls.length; ) {
    const sentence = calls[i].sentence;
    let j = i + 1;
    if (sentence !== undefined) while (j < calls.length && calls[j].sentence === sentence) j++;
    if (sentence !== undefined) lines[i] = j - i > 1 ? `${sentence}, ${j - i} calls` : sentence;
    i = j;
  }
  return lines;
}

/** The steps part, under its one author line. Also rendered by the executed run while it is under way. */
export function StepsPartView({ steps }: { steps: StepsPart }) {
  return (
    <div data-part="steps" style={{ margin: '16px 0 8px' }}>
      {steps.author !== null && (
        <p data-part="steps-author" data-author="steps" style={AUTHOR_LINE_STYLE}>
          {steps.author}
        </p>
      )}
      {steps.kind === 'progress-log' ? (
        <ProgressLog
          groups={steps.groups}
          standaloneEntries={steps.standaloneEntries}
          variant="with-mcp"
          isActive={false}
          isComplete={steps.isComplete}
          toolsCalled={steps.toolsCalled}
          totalDuration_ms={steps.totalDuration_ms}
        />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {steps.view.steps.map((step, i) => (
              <div data-part="step" key={i} style={{ padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent)', marginRight: '6px' }}>Step {i + 1}</span>
                  <span data-part="step-label">{step.label}</span>
                </div>
                {(() => {
                  const lines = reasonLines(step.calls);
                  return step.calls.map((call, j) => <StepCallRow key={j} call={call} line={lines[j]} />);
                })()}
              </div>
            ))}
          </div>
          {/* A load paused to ask the reader (#644 W2): its consent step, after the steps so far */}
          {steps.consent?.map((entry, i) => (entry.pause ? <ConsentStep key={`c-${i}`} pause={entry.pause} ended={entry.isComplete === true} /> : null))}
          {steps.view.unplaced.length > 0 && (
            <div data-part="steps-unplaced" style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <p style={{ margin: 0 }}>{UNPLACED_CALLS_LINE}</p>
              {steps.view.unplaced.map((call, j) => <StepCallRow key={j} call={call} />)}
            </div>
          )}
          {steps.closing.map((row) => (
            <div data-part="closing-row" key={row.phase} style={{
              marginTop: '8px', padding: '6px 12px', fontSize: '13px',
              color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '0 8px',
            }}>
              <span>{row.label}</span>
              {row.fact !== undefined && (
                <span data-part="closing-fact" style={{ color: 'var(--text-muted)' }}>{row.fact}</span>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// --- 6. The disclosure --------------------------------------------------------------

function Disclosure({ disclosure, answer, answerElement, extras, recordSections, layout, level }: {
  disclosure: DisclosurePart;
  answer: AnswerPart;
  answerElement: ReactNode;
  extras?: ReactNode;
  recordSections?: Partial<Record<RecordSectionView, ReactNode>>;
  layout: LayoutPayload;
  level: HeadingLevel;
}) {
  const { question, instructions, recordInstructions, environment, trace, recordTrace, notebook, recordNotebook, summary, signers } = disclosure;
  const promptLines = instructions?.text ? instructions.text.split(/\r?\n/).length : 0;
  // Each section by the view's name; the layout's `disclosure.order` places
  // them (`disclosureOrder`), and a section it does not name sits at its
  // default place, so none is dropped (layout rule 2).
  const sections: Record<DisclosureSectionView, ReactNode> = {
    question: question && (
      <Section level={level} title="A · Initial prompt" author={<AuthorLine part="question" text={question.author} />}>
        {question.prompt !== null ? (
          <div style={{
            padding: '16px 20px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
            borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
            fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
          }}>
            {question.prompt}
          </div>
        ) : (
          <>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Prompt visibility was hash-only; verbatim text not captured.
            </div>
            {/* The hash identifies the prompt that was used (W1 ruling D7). */}
            {question.hash && (
              <div style={{
                marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)',
                fontFamily: 'monospace', wordBreak: 'break-all',
              }}>
                Prompt hash: {question.hash}
              </div>
            )}
          </>
        )}
      </Section>
    ),

    // B on a record: the skill prompt it carries, inline or as a blob it fetches on click.
    instructions: (
      <>
        {recordInstructions && carriesSkillText(recordInstructions.disclosure) && (
          <Section level={level} title="B · System prompts" author={<AuthorLine part="instructions" text={recordInstructions.author} />}>
            {(() => {
              const d = recordInstructions.disclosure;
              return (
                <SkillSection
                  skillText={d.kind === 'inline' ? d.text : undefined}
                  skillTextRef={d.kind === 'blob' ? d.ref : undefined}
                  skillHash={d.kind === 'inline' || d.kind === 'blob' ? d.hash : undefined}
                />
              );
            })()}
          </Section>
        )}
        {instructions && (
          <Section level={level} title="B · System prompts" author={<AuthorLine part="instructions" text={instructions.author} />}>
            <div style={{
              padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: '6px',
              fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6,
            }}>
              <p style={{ margin: '0 0 10px' }}>
                The system prompt is composed from the base civic-data skill
                guidance plus the web overlay (and any portal-specific overlays).
                The content hash below is captured at execution time and embedded
                in the record package when this analysis is published.
              </p>
              {instructions.hash && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: '6px 12px',
                  alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)',
                  marginBottom: '8px',
                }}>
                  <span>SHA-256:</span>
                  <code
                    title={instructions.hash}
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                      background: '#f5f5f5', padding: '1px 6px', borderRadius: '3px',
                    }}
                  >
                    {instructions.hash.slice(0, 16)}…
                  </code>
                  <span style={{ fontStyle: 'italic' }}>
                    (truncated; full hash is what the record package will sign)
                  </span>
                </div>
              )}
              {instructions.text === undefined ? null : instructions.text ? (
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: '13px', padding: '4px 0' }}>
                    Show full system prompt ({promptLines.toLocaleString()} lines)
                  </summary>
                  <pre data-part="composed-prompt" style={{
                    marginTop: '8px', padding: '12px 14px', background: '#f9f9f9',
                    border: '1px solid var(--border-color)', borderRadius: '4px',
                    fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word', maxHeight: '420px', overflow: 'auto',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                    color: 'var(--text-primary)',
                  }}>
                    {instructions.text}
                  </pre>
                </details>
              ) : (
                <p style={{
                  margin: 0, fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic',
                }}>
                  Full text was not captured in this stream. (The route emits it as
                  the first SSE event; if you opened this preview from a fixture
                  or a cached page, the inline disclosure is unavailable.)
                </p>
              )}
            </div>
          </Section>
        )}
      </>
    ),

    environment: environment && (
      <Section level={level} title="C · Model + environment">
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '12px',
        }}>
          {environment.map((item) => (
            <div data-part="c-item" key={item.label} style={{
              padding: '10px 14px', border: '1px solid var(--border-color)',
              borderRadius: '4px',
            }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                {item.label}
              </div>
              <div style={{
                fontSize: item.mono ? '12px' : '14px',
                color: item.mono ? 'var(--text-muted)' : 'var(--text-primary)',
                fontWeight: 500,
                fontFamily: item.mono ? 'monospace' : 'inherit',
              }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </Section>
    ),

    // D on a record: each call's signed fields, raw (W1 ruling D6).
    trace: (
      <>
        {recordTrace && (
          <Section level={level} title="D · Deliberative trace">
            <details>
              <summary style={{
                cursor: 'pointer', fontSize: '13px',
                color: 'var(--text-secondary)', padding: '8px 0',
              }}>
                Show {recordTrace.length} tool {recordTrace.length === 1 ? 'call' : 'calls'}
              </summary>
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {recordTrace.map((q, i) => (
                  <div data-part="call" key={i} style={{
                    padding: '10px 14px', border: '1px solid var(--border-color)',
                    borderRadius: '4px', fontSize: '13px',
                  }}>
                    <div style={{ fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: '4px' }}>
                      {q.label}
                    </div>
                    {/* The signed entry's dataset and portal, when it carries them,
                        and its duration when the outcome below does not state it. */}
                    {(q.datasetId || q.portal || q.durationMs !== undefined) && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        {[
                          q.datasetId ? <span key="dataset">Dataset <code>{q.datasetId}</code></span> : null,
                          q.portal ? <span key="portal">Portal <code>{q.portal}</code></span> : null,
                          q.durationMs !== undefined ? <span key="duration">Duration <code>{secondsText(q.durationMs)}</code></span> : null,
                        ]
                          .filter((part) => part !== null)
                          .flatMap((part, j) => (j === 0 ? [part] : [<span key={`sep-${j}`}>{' · '}</span>, part]))}
                      </div>
                    )}
                    <pre style={{
                      fontSize: '11px', color: 'var(--text-secondary)', margin: 0,
                      overflow: 'auto', whiteSpace: 'pre-wrap',
                    }}>
                      {q.argumentsJson}
                    </pre>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {q.outcome}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </Section>
        )}
        {trace && (
          <Section level={level} title="D · Deliberative trace">
            {trace.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No tool calls were captured for this analysis.
              </div>
            ) : (
              <details>
                <summary style={{
                  cursor: 'pointer', fontSize: '13px',
                  color: 'var(--text-secondary)', padding: '8px 0',
                }}>
                  Show {trace.length} tool {trace.length === 1 ? 'call' : 'calls'}
                </summary>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {trace.map((line, i) => (
                    // Each call's words were written by `deliberativeTraceLine`
                    // (buildChatEvidenceView.ts) in the adapter; this places them.
                    <div key={i} style={{
                      padding: '10px 14px', border: '1px solid var(--border-color)',
                      borderRadius: '4px', fontSize: '13px',
                    }}>
                      <div style={{ fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: '4px' }}>
                        {line.label}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        {line.heading}
                      </div>
                      {line.outcome !== null && (
                        <div style={{ fontSize: '11px', color: line.failed ? 'var(--error)' : 'var(--text-muted)' }}>
                          {line.outcome}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </Section>
        )}
      </>
    ),

    // E on a record: the claim about re-running it, the bundle (A-G format only), the notebook.
    notebook: (
      <>
        {recordNotebook && (
          <Section level={level} title="E · Answer notebook">
            {(recordNotebook.assertion !== null || recordNotebook.bundleHref !== null) && (
              <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {recordNotebook.assertion !== null && (
                  <>
                    {recordNotebook.assertion}{' '}
                  </>
                )}
                {recordNotebook.bundleHref !== null && (
                  <a href={recordNotebook.bundleHref} style={{ color: 'var(--accent)' }}>
                    Download notebook (.ipynb)
                  </a>
                )}
              </div>
            )}
            <NotebookSection notebook={recordNotebook.notebook} slug={recordNotebook.slug} />
          </Section>
        )}
        {notebook && (
          <Section level={level} title="E · Answer notebook">
            <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {notebook.scopeSentence}{' '}
              The notebook metadata records the sandbox runtime versions used at execution.
            </div>
            {/* The slug is a placeholder: the run is not yet published. */}
            <NotebookSection notebook={notebook.notebook} slug="unpublished-chat-notebook" />
          </Section>
        )}
      </>
    ),

    'answer-again': disclosure.answerAgain && answer.content.kind !== 'absent' && (
      <Section level={level} title="F · Rendered answer" author={<AnswerAuthors answer={answer} />}>
        {answerElement}
        {disclosure.answerNote !== undefined && (
          <div style={{
            marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)',
            fontFamily: 'monospace',
          }}>
            {disclosure.answerNote}
          </div>
        )}
      </Section>
    ),

    summary: summary && (
      <Section
        level={level}
        title="G · Summary"
        author={summary.kind === 'pending' ? undefined : <AuthorLine part="summary" text={summary.author} />}
      >
        <div style={{
          padding: '12px 16px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
          borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
          fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)',
        }}>
          {summary.kind === 'structured' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Analysis:
                </span>{' '}
                {summary.analysisDescription}
              </div>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Headline finding:
                </span>{' '}
                {summary.headlineFinding}
              </div>
            </div>
          ) : summary.kind === 'derived' || summary.kind === 'stated' ? (
            summary.text
          ) : (
            <em style={{ color: 'var(--text-muted)' }}>
              Summary will be generated at publish time.
            </em>
          )}
        </div>
      </Section>
    ),

    signers: signers && <ChatSignersSection executedAt={signers.executedAt} signingKeyId={signers.signingKeyId} provenance={signers.provenance} />,

    'provenance-graph': recordSections?.['provenance-graph'],
    'additional-artifacts': recordSections?.['additional-artifacts'],
    evaluations: recordSections?.evaluations,
    attestations: recordSections?.attestations,
    verification: recordSections?.verification,

    'surface-extras': extras,
  };
  return (
    <details
      data-part="disclosure"
      {...(layout.disclosure.openByDefault ? { open: true } : {})}
      style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}
    >
      <summary style={{
        cursor: 'pointer', fontSize: '14px', fontWeight: 500,
        color: 'var(--accent)', padding: '8px 0',
      }}>
        {layout.disclosure.label}
      </summary>
      <div style={{ marginTop: '16px' }}>
        {disclosureOrder(layout).order.map((name) => <Fragment key={name}>{sections[name]}</Fragment>)}
      </div>
    </details>
  );
}

// --- The layout: the instance's, and the reader's choice --------------------------

/**
 * The layout this view renders with: the reader's choice for the session when
 * the instance offers it, else the instance's default. The server, and a
 * reader who has not chosen, read no choice (`useSessionChoice`), so the
 * server's markup is always the default's.
 */
function useChosenLayout(layouts: InstanceLayouts): [LayoutPayload, (id: string) => void] {
  const parse = useCallback((raw: string | null) => parseStoredLayoutChoice(raw, layouts.offered), [layouts]);
  const [chosen, setChosen] = useSessionChoice(LAYOUT_STORAGE_KEY, parse);
  const choose = useCallback((id: string) => {
    setChosen(id);
    // The storage event never fires in the tab that wrote the value; another
    // view on this page re-reads the choice from this one.
    if (typeof window !== 'undefined') window.dispatchEvent(new StorageEvent('storage', { key: LAYOUT_STORAGE_KEY }));
  }, [setChosen]);
  return [selectLayout(layouts, chosen), choose];
}

/** Rule 5: the line that names the layout, and beside it the reader's choice. Outside the disclosure. */
function LayoutFoot({ layout, layouts, onChoose, published }: { layout: LayoutPayload; layouts: InstanceLayouts; onChoose: (id: string) => void; published?: PublishedLayout }) {
  return (
    <div data-part="layout-foot" style={{
      marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '4px 12px',
      alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)',
    }}>
      <span data-part="layout-line">{layoutFootLine(layout, published)}</span>
      {layouts.offered.length > 1 && (
        <label style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
          Show under layout
          <select
            data-part="layout-toggle"
            value={layoutId(layout)}
            onChange={(e) => onChoose(e.target.value)}
            style={{ fontSize: '12px' }}
          >
            {layouts.offered.map((l) => (
              <option key={layoutId(l)} value={layoutId(l)}>{`${l.name} v${l.version}`}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// --- The view -----------------------------------------------------------------------

export interface AnswerViewProps {
  model: AnswerViewModel;
  /** Part 7: the surface's controls (copy, notebook, publish). */
  actions?: ReactNode;
  /** What the surface adds outside the disclosure, after the sources line. */
  notices?: ReactNode;
  /** What the surface adds inside the disclosure, at its end. */
  disclosureExtras?: ReactNode;
  /** The record's sections after the envelope, by name, so a layout can place each (`disclosure.order`). */
  recordSections?: Partial<Record<RecordSectionView, ReactNode>>;
  /** The record's own citation block, placed in the citation part under `model.recordCitation`'s line. */
  citationBlock?: ReactNode;
  /** What the surface places directly after the disclosure (a record's Status History). */
  afterDisclosure?: ReactNode;
  /** The level of the disclosure's section headings. */
  sectionHeading?: HeadingLevel;
}

export default function AnswerView({
  model, actions, notices, disclosureExtras, recordSections, citationBlock, afterDisclosure, sectionHeading = 'h3',
}: AnswerViewProps) {
  const layouts = useAnswerLayouts();
  const [layout, choose] = useChosenLayout(layouts);
  // Built once, placed twice: first, and again as F inside the disclosure.
  const answerElement = <AnswerBody answer={model.answer} />;
  // Each part by the view's name. What a surface adds travels with the part it
  // belongs to: the heading over the answer with the answer, the notices with
  // the sources line, Status History with the disclosure.
  const parts: Record<PagePartView, ReactNode> = {
    'status-row': model.status !== null && <StatusRow status={model.status} />,

    answer: (
      <>
        {model.title && (
          <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px', lineHeight: 1.3 }}>
            {model.title}
          </h2>
        )}

        {model.answer.content.kind !== 'absent' && (
          <div style={{ marginBottom: '24px' }}>
            <AnswerAuthors answer={model.answer} />
            {answerElement}
          </div>
        )}
      </>
    ),

    citation: model.citation !== null ? (
      <div data-part="citation">
        <AuthorLine part="citation" text={model.citation.author} />
        <ChatCitationPreview
          prompt={model.citation.prompt}
          executedAt={model.citation.executedAt}
          structuredSummary={model.citation.structuredSummary}
          statesExecution={model.citation.statesExecution}
        />
      </div>
    ) : model.recordCitation !== undefined && citationBlock !== undefined ? (
      <div data-part="citation">
        <AuthorLine part="citation" text={model.recordCitation.author} />
        {citationBlock}
      </div>
    ) : null,

    steps: model.steps !== null && <StepsPartView steps={model.steps} />,

    sources: (
      <>
        {model.sources !== null && (
          <div data-part="sources" style={{
            borderLeft: '3px solid var(--success)', backgroundColor: 'rgba(0, 183, 3, 0.05)',
            padding: '6px 10px', marginTop: '16px', fontSize: '13px',
            color: 'var(--text-secondary)', borderRadius: '0 4px 4px 0',
          }}>
            <AuthorLine part="sources" text={model.sources.author} />
            <ReactMarkdown components={SOURCES_COMPONENTS}>{model.sources.line}</ReactMarkdown>
          </div>
        )}

        {notices}
      </>
    ),

    // R6 W4: rendered only when the surface has the model; absent, not empty, otherwise.
    'where-it-went': model.whereItWent !== undefined && <WhereItWent model={model.whereItWent} />,

    disclosure: (
      <>
        <Disclosure
          disclosure={model.disclosure}
          answer={model.answer}
          answerElement={answerElement}
          extras={disclosureExtras}
          recordSections={recordSections}
          layout={layout}
          level={sectionHeading}
        />

        {afterDisclosure}
      </>
    ),

    actions: actions !== undefined && actions !== null && (
      <div data-part="actions" style={{ marginTop: '16px' }}>
        {actions}
      </div>
    ),
  };
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {pageOrder(layout).order.map((name) => <Fragment key={name}>{parts[name]}</Fragment>)}

      <LayoutFoot layout={layout} layouts={layouts} onChoose={choose} published={model.publishedLayout} />
    </div>
  );
}
