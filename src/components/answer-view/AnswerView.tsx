'use client';

/**
 * The answer view: one component every run surface renders its answer
 * through (LAYOUT-WEB W3 P1, design §4.1 option A). An adapter builds the
 * model from a surface's state (`adapt-comparison.ts`, `adapt-notebook.ts`);
 * this file decides where each part sits, once, so the surfaces cannot drift.
 *
 * THE ORDER, by position in the markup:
 *   1. the status row, one line (`data-part="status-row"`), with the
 *      refused-request line under it (ruling D2);
 *   2. the answer (`data-part="answer"`), under its author line, with no
 *      section heading;
 *   3. the citation (`data-part="citation"`);
 *   4. the steps (`data-part="steps"`): the comparison's progress log, or the
 *      executed run's step view and its closing rows;
 *   5. the sources line (`data-part="sources"`), then what the surface adds
 *      outside the disclosure (`notices`);
 *   6. one disclosure, closed, labelled "Learn more about how this analysis
 *      was produced": A, B, C, D, E, F (the same answer element again), G, the
 *      signers, then what the surface adds (`disclosureExtras`);
 *   7. the actions (`data-part="actions"`), the surface's controls.
 * A part the surface does not have is not rendered.
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
import { Fragment, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProgressLog from '@/components/ProgressLog';
import NotebookSection from '@/components/evidence/NotebookSection';
import ChatSignersSection from '@/components/notebook/ChatSignersSection';
import ChatCitationPreview from '@/components/notebook/ChatCitationPreview';
import RenderingCellOutputs from '@/components/notebook/RenderingCellOutputs';
import { UNPLACED_CALLS_LINE, type StepViewCall } from '@/lib/answer-view/steps';
import {
  DISCLOSURE_LABEL,
  type AnswerPart,
  type AnswerViewModel,
  type DisclosurePart,
  type StatusPart,
  type StepsPart,
} from './view-model';

// --- Pieces ---------------------------------------------------------------------

/** Links in an answer open in a new tab. */
const MARKDOWN_COMPONENTS = {
  a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }} {...props}>
      {children}
    </a>
  ),
};

/** The sources line renders inline: no block wrappers, monospace links. */
const SOURCES_COMPONENTS = {
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => <span {...props}>{children}</span>,
  a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
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

function Section({ title, author, children }: { title: string; author?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {author}
      {children}
    </section>
  );
}

// --- 1. The status row -------------------------------------------------------------

function StatusRow({ status }: { status: StatusPart }) {
  return (
    <>
      {status.facts.length > 0 && (
        <div data-part="status-row" style={{
          fontSize: '13px', color: 'var(--text-secondary)',
          marginBottom: status.refused !== null ? '8px' : '24px',
          display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'center',
        }}>
          {status.facts.map((fact, i) => (
            <Fragment key={i}>
              {i > 0 && <span>·</span>}
              <span style={fact.muted ? { fontStyle: 'italic', color: 'var(--text-muted)' } : undefined}>
                {fact.text}{fact.strong !== undefined && <strong>{fact.strong}</strong>}
              </span>
            </Fragment>
          ))}
        </div>
      )}
      {/* Ruling D2: outside the disclosure, under the status row. */}
      {status.refused !== null && (
        <p data-part="refused-requests" style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--error)' }}>
          {status.refused}
        </p>
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

/** One call in the step view: the site's sentence for it, and its outcome. */
function StepCallRow({ call }: { call: StepViewCall }) {
  return (
    <div data-part="step-call" style={{ marginTop: '6px', paddingLeft: '20px', fontSize: '13px', lineHeight: 1.5 }}>
      {call.sentence !== undefined && (
        <div data-part="step-sentence" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{call.sentence}</div>
      )}
      <div data-part="step-outcome" style={{ fontSize: '12px', color: call.failed ? 'var(--error)' : 'var(--text-muted)' }}>{call.outcome}</div>
    </div>
  );
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
                {step.calls.map((call, j) => <StepCallRow key={j} call={call} />)}
              </div>
            ))}
          </div>
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

function Disclosure({ disclosure, answer, answerElement, extras }: {
  disclosure: DisclosurePart;
  answer: AnswerPart;
  answerElement: ReactNode;
  extras?: ReactNode;
}) {
  const { question, instructions, environment, trace, notebook, summary, signers } = disclosure;
  const promptLines = instructions?.text ? instructions.text.split(/\r?\n/).length : 0;
  return (
    <details data-part="disclosure" style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
      <summary style={{
        cursor: 'pointer', fontSize: '14px', fontWeight: 500,
        color: 'var(--accent)', padding: '8px 0',
      }}>
        {DISCLOSURE_LABEL}
      </summary>
      <div style={{ marginTop: '16px' }}>
        {question && (
          <Section title="A · Initial prompt" author={<AuthorLine part="question" text={question.author} />}>
            <div style={{
              padding: '16px 20px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
              borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
              fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
            }}>
              {question.prompt}
            </div>
          </Section>
        )}

        {instructions && (
          <Section title="B · System prompts" author={<AuthorLine part="instructions" text={instructions.author} />}>
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

        {environment && (
          <Section title="C · Model + environment">
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px',
            }}>
              {environment.map((item) => (
                <div key={item.label} style={{
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
        )}

        {trace && (
          <Section title="D · Deliberative trace">
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

        {notebook && (
          <Section title="E · Answer notebook">
            <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {notebook.scopeSentence}{' '}
              The notebook metadata records the sandbox runtime versions used at execution.
            </div>
            {/* The slug is a placeholder: the run is not yet published. */}
            <NotebookSection notebook={notebook.notebook} slug="unpublished-chat-notebook" />
          </Section>
        )}

        {disclosure.answerAgain && (
          <Section title="F · Rendered answer" author={<AnswerAuthors answer={answer} />}>
            {answerElement}
          </Section>
        )}

        {summary && (
          <Section
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
              ) : summary.kind === 'derived' ? (
                summary.text
              ) : (
                <em style={{ color: 'var(--text-muted)' }}>
                  Summary will be generated at publish time.
                </em>
              )}
            </div>
          </Section>
        )}

        {signers && <ChatSignersSection executedAt={signers.executedAt} signingKeyId={signers.signingKeyId} />}

        {extras}
      </div>
    </details>
  );
}

// --- The view -----------------------------------------------------------------------

export interface AnswerViewProps {
  model: AnswerViewModel;
  /** Part 7: the surface's controls (copy, notebook, publish). */
  actions?: ReactNode;
  /** What the surface adds outside the disclosure, after the sources line. */
  notices?: ReactNode;
  /** What the surface adds inside the disclosure, after the signers. */
  disclosureExtras?: ReactNode;
}

export default function AnswerView({ model, actions, notices, disclosureExtras }: AnswerViewProps) {
  // Built once, placed twice: first, and again as F inside the disclosure.
  const answerElement = <AnswerBody answer={model.answer} />;
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {model.status !== null && <StatusRow status={model.status} />}

      {model.title && (
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px', lineHeight: 1.3 }}>
          {model.title}
        </h2>
      )}

      <div style={{ marginBottom: '24px' }}>
        <AnswerAuthors answer={model.answer} />
        {answerElement}
      </div>

      {model.citation !== null && (
        <div data-part="citation">
          <AuthorLine part="citation" text={model.citation.author} />
          <ChatCitationPreview
            prompt={model.citation.prompt}
            executedAt={model.citation.executedAt}
            structuredSummary={model.citation.structuredSummary}
          />
        </div>
      )}

      {model.steps !== null && <StepsPartView steps={model.steps} />}

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

      <Disclosure disclosure={model.disclosure} answer={model.answer} answerElement={answerElement} extras={disclosureExtras} />

      {actions !== undefined && actions !== null && (
        <div data-part="actions" style={{ marginTop: '16px' }}>
          {actions}
        </div>
      )}
    </div>
  );
}
