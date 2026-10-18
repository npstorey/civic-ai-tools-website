'use client';

/**
 * Phase 2a1 — chat-output renderer for executed-notebook responses.
 * Phase 2a2 refinements layered in:
 *   - Item 1: Section B now surfaces the composed system prompt inline
 *             behind a disclosure; SHA-256 hash (truncated) is visible.
 *   - Item 2: Section F renders the rendering code cell's outputs verbatim
 *             (markdown via display_data, tables via DataFrame outputs,
 *             plain text via stream). Legacy notebooks (no synthesis-role
 *             code cell) fall back to ReactMarkdown over the legacy
 *             `## Synthesis` markdown body.
 *   - Item 3: Section G renders the structured two-clause summary from
 *             notebook root metadata; falls back to a one-line derived
 *             summary when the structured field is absent.
 *   - Item 4: Signers/citation handed the active platform key id so the
 *             pre-publish framing is honest (handled in the sibling
 *             ChatSignersSection component).
 *
 * Each section is honest about pre-publish state: no slug yet, no
 * `EvidencePackage` row in the DB, no Rekor entry.
 *
 * Sections:
 *   A · Initial prompt    — verbatim user input
 *   B · System prompts    — inline composed prompt behind disclosure
 *   C · Model + environment — model name, runtime, MCP servers
 *   D · Deliberative trace — Phase A tool calls (collapsed)
 *   E · Answer notebook   — NotebookSection (.ipynb download + cell preview)
 *   F · Rendered answer   — outputs of the rendering code cell (hero)
 *   G · Summary           — structured two-clause blurb
 *
 * Signers, attestations placeholder, and citation block are rendered by
 * sibling components composed into this output.
 *
 * LAYOUT (LAYOUT-W1 P1, anchor #598). The reader meets the answer first:
 *   1. the status row — one line, the run's three facts;
 *   2. the refused-request line (ruling D2), only when a captured call is
 *      stated as failed, written by `describeRefusedRequests`;
 *   3. the answer, with no section heading — the A-G letters are the
 *      envelope's section names, implementation language to a reader;
 *   4. the citation, directly beneath it;
 *   5. the steps (LAYOUT-WEB W2 P2): one per Phase A iteration, each call
 *      with the sentence the site writes from its name and arguments and the
 *      outcome `describeQueryOutcome` states, under one author line — shown
 *      when the run recorded its steps (`stepGroups`);
 *   6. one disclosure, closed by default, holding A-G and the signers in
 *      envelope order. F renders the answer again, so the envelope reads whole
 *      to someone inspecting it. D keeps each call's recorded fields.
 * The answer element is built once and rendered in both places, so the two
 * cannot drift. A render test pins the order
 * (`chat-notebook-output-layout.test.ts`).
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatModelName } from '@/lib/models';
import NotebookSection from '@/components/evidence/NotebookSection';
import ChatSignersSection from './ChatSignersSection';
import ChatCitationPreview from './ChatCitationPreview';
import RenderingCellOutputs from './RenderingCellOutputs';
import { approximateMcpServers, buildChatEvidenceView, deliberativeTraceLine } from './buildChatEvidenceView';
import { useSocrataMcpUrl } from '@/components/McpRoutingProvider';
import type { Notebook } from '@/lib/notebook-author';
import { readReproductionClaim, reproductionScopeSentence } from '@/lib/notebook-author/reproduction-claim';
import { describeRefusedRequests } from '@/lib/evidence/query-step';
import type { CapturedToolCall } from '@/hooks/useNotebookStream';
import { useInstanceAttribution } from '@/components/EvidenceOriginProvider';
import {
  UNPLACED_CALLS_LINE,
  asStepCall,
  buildRunStepView,
  stepsAuthorLine,
  type ProgressGroup,
  type StepViewCall,
} from '@/lib/answer-view/steps';

interface ChatNotebookOutputProps {
  notebook: Notebook;
  prompt: string;
  model: string;
  portal: string;
  toolCalls: CapturedToolCall[];
  /**
   * Phase A's steps as the hook grouped them, one per iteration (LAYOUT-WEB
   * W2 P2). Absent when the state recorded none: the step view is not shown.
   */
  stepGroups?: ProgressGroup[];
  /** Phase 2a2 item 1: composed system prompt text streamed via SSE. */
  composedSystemPrompt?: string | null;
  composedSystemPromptHash?: string | null;
  /** Phase 2a2 item 4: active platform signing key id streamed via SSE. */
  signingKeyId?: string | null;
  /** Optional title — defaults to the prompt's first sentence/clause. */
  title?: string;
}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function ChatNotebookOutput({
  notebook,
  prompt,
  model,
  portal,
  toolCalls,
  stepGroups,
  composedSystemPrompt,
  composedSystemPromptHash,
  signingKeyId,
  title,
}: ChatNotebookOutputProps) {
  // The author of the steps' sentences is this instance; with none declared,
  // the line is omitted (as the comparison's copy footer omits its own).
  const stepsAuthor = stepsAuthorLine(useInstanceAttribution().host);
  const view = buildChatEvidenceView({
    notebook,
    prompt,
    model,
    portal,
    toolCalls,
    composedSystemPrompt,
    composedSystemPromptHash,
    signingKeyId,
  });
  // #258 C5: the server-resolved SOCRATA_MCP_URL, threaded through
  // McpRoutingProvider — null (not configured) yields an empty list, and the
  // "MCP servers" row below is omitted rather than showing a fallback host.
  const socrataMcpUrl = useSocrataMcpUrl();
  const mcpServers = approximateMcpServers(portal, socrataMcpUrl);
  const portalLabel = portal && portal !== '__all__' ? portal : 'all portals';

  // Phase 2a2 item 1: compute line count once for the disclosure label.
  const composedPromptLineCount = useMemo(() => {
    if (!view.composedSystemPrompt) return 0;
    return view.composedSystemPrompt.split(/\r?\n/).length;
  }, [view.composedSystemPrompt]);

  // Slug is "(unpublished)" since the chat output is pre-publish. The
  // NotebookSection download filename uses this; we pick a slug-shaped
  // string that signals the pre-publish state honestly.
  const placeholderSlug = 'unpublished-chat-notebook';

  // Ruling D2: section D states each failed call, behind the disclosure; this
  // line states, outside it, how many of the run's calls failed. Counted by
  // `describeQueryOutcome` over the same fields `deliberativeTraceLine` hands
  // it, so the line and D cannot disagree about which calls failed.
  const refusedRequests = describeRefusedRequests(
    view.toolCalls.map((q) => ({
      failed: q.failed,
      failureKind: q.failureKind,
      resultRows: q.resultSummary?.rows,
      resultColumns: q.resultSummary?.columns,
    })),
  );

  // The steps (W2 P2): the hook's groups paired with the captured calls, which
  // the route sends without the repeats it drops (`pairCallsToSteps`).
  const stepView = stepGroups !== undefined ? buildRunStepView(stepGroups, toolCalls.map(asStepCall)) : null;

  // The answer: the rendering code cell's outputs (Phase 2a2 item 2), else the
  // legacy synthesis markdown, else a statement that there is none. Built once
  // here and rendered twice — first, with no heading, and as F inside the
  // disclosure — so the two cannot drift.
  const answer = (
    <div data-part="answer" style={{
      padding: '16px 20px', border: '1px solid var(--border-color)',
      borderRadius: '6px', backgroundColor: 'white',
      fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
    }}>
      {view.renderingCellOutputs !== null ? (
        <RenderingCellOutputs outputs={view.renderingCellOutputs} />
      ) : view.synthesisMarkdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{view.synthesisMarkdown}</ReactMarkdown>
      ) : (
        <em style={{ color: 'var(--text-muted)' }}>
          No synthesis was produced for this analysis.
        </em>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Status row — mirrors the detail page's small label row
          ("Captured via Web chat · datHere content profile · …") but honest
          about not-yet-published state. */}
      <div style={{
        fontSize: '13px', color: 'var(--text-secondary)',
        marginBottom: refusedRequests !== null ? '8px' : '24px',
        display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'center',
      }}>
        <span>Captured via <strong>Web chat</strong></span>
        <span>·</span>
        <span>Executed in signed sandbox</span>
        <span>·</span>
        <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>not yet published</span>
      </div>

      {/* Ruling D2: outside the disclosure, under the status row. */}
      {refusedRequests !== null && (
        <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--error)' }}>
          {refusedRequests}
        </p>
      )}

      {title && (
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px', lineHeight: 1.3 }}>
          {title}
        </h2>
      )}

      {/* The answer, first, with no section heading. */}
      <div style={{ marginBottom: '24px' }}>
        {answer}
      </div>

      {/* The citation, directly beneath the answer. */}
      <ChatCitationPreview
        prompt={view.prompt}
        executedAt={view.executedAt}
        structuredSummary={view.structuredSummary}
      />

      {/* The steps, outside the disclosure, after the citation (W2 P2). */}
      {stepView !== null && (stepView.steps.length > 0 || stepView.unplaced.length > 0) && (
        <div data-part="steps" style={{ margin: '16px 0 8px' }}>
          {stepsAuthor !== null && (
            <p data-part="steps-author" style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              {stepsAuthor}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {stepView.steps.map((step, i) => (
              <div data-part="step" key={i} style={{ padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent)', marginRight: '6px' }}>Step {i + 1}</span>
                  <span data-part="step-label">{step.label}</span>
                </div>
                {step.calls.map((call, j) => <StepCallRow key={j} call={call} />)}
              </div>
            ))}
          </div>
          {stepView.unplaced.length > 0 && (
            <div data-part="steps-unplaced" style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <p style={{ margin: 0 }}>{UNPLACED_CALLS_LINE}</p>
              {stepView.unplaced.map((call, j) => <StepCallRow key={j} call={call} />)}
            </div>
          )}
        </div>
      )}

      {/* Everything else, closed by default: the envelope A-G in order, then
          the signers. Section titles inside are the envelope's own. */}
      <details style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
        <summary style={{
          cursor: 'pointer', fontSize: '14px', fontWeight: 500,
          color: 'var(--accent)', padding: '8px 0',
        }}>
          Learn more about how this analysis was produced
        </summary>
        <div style={{ marginTop: '16px' }}>
          {/* A · Initial prompt */}
          <Section title="A · Initial prompt">
            <div style={{
              padding: '16px 20px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
              borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
              fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
            }}>
              {view.prompt}
            </div>
          </Section>

          {/* B · System prompts (Phase 2a2 item 1: inline composed prompt + truncated hash) */}
          <Section title="B · System prompts">
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
              {view.composedSystemPromptHash && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: '6px 12px',
                  alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)',
                  marginBottom: '8px',
                }}>
                  <span>SHA-256:</span>
                  <code
                    title={view.composedSystemPromptHash}
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                      background: '#f5f5f5', padding: '1px 6px', borderRadius: '3px',
                    }}
                  >
                    {view.composedSystemPromptHash.slice(0, 16)}…
                  </code>
                  <span style={{ fontStyle: 'italic' }}>
                    (truncated; full hash is what the record package will sign)
                  </span>
                </div>
              )}
              {view.composedSystemPrompt ? (
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: '13px', padding: '4px 0' }}>
                    Show full system prompt ({composedPromptLineCount.toLocaleString()} lines)
                  </summary>
                  <pre style={{
                    marginTop: '8px', padding: '12px 14px', background: '#f9f9f9',
                    border: '1px solid var(--border-color)', borderRadius: '4px',
                    fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word', maxHeight: '420px', overflow: 'auto',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                    color: 'var(--text-primary)',
                  }}>
                    {view.composedSystemPrompt}
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

          {/* C · Model + environment */}
          <Section title="C · Model + environment">
            {(() => {
              const items: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
                { label: 'Model', value: formatModelName(view.model) },
                { label: 'Data portal', value: portalLabel },
                ...(mcpServers.length > 0 ? [{
                  label: 'MCP servers',
                  value: mcpServers.join(', '),
                }] : []),
                ...(view.environment?.python ? [{
                  label: 'Python runtime',
                  value: view.environment.python,
                }] : []),
                ...(view.environment?.libraries
                  ? Object.entries(view.environment.libraries).slice(0, 4).map(([name, version]) => ({
                      label: name,
                      value: version,
                      mono: true,
                    }))
                  : []),
                ...(view.executedAt ? [{
                  label: 'Executed at',
                  value: new Date(view.executedAt).toLocaleString(),
                }] : []),
                ...(view.executionDurationMs !== null && view.executionDurationMs !== undefined ? [{
                  label: 'Sandbox duration',
                  value: `${(view.executionDurationMs / 1000).toFixed(1)}s`,
                }] : []),
              ];
              return (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '12px',
                }}>
                  {items.map((item) => (
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
              );
            })()}
          </Section>

          {/* D · Deliberative trace */}
          <Section title="D · Deliberative trace">
            {view.toolCalls.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No tool calls were captured for this analysis.
              </div>
            ) : (
              <details>
                <summary style={{
                  cursor: 'pointer', fontSize: '13px',
                  color: 'var(--text-secondary)', padding: '8px 0',
                }}>
                  Show {view.toolCalls.length} tool {view.toolCalls.length === 1 ? 'call' : 'calls'}
                </summary>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {view.toolCalls.map((q, i) => {
                    // Each call's words come from `deliberativeTraceLine`
                    // (buildChatEvidenceView.ts), where a test reads them (#426):
                    // the recorded phrase through the shared sanitiser on every
                    // call — the call's number when it drops (R5) — and the
                    // outcome in `describeQueryOutcome`'s words, so a rejected
                    // call reads as rejected here as it does on the record page.
                    const line = deliberativeTraceLine(q, i + 1);
                    return (
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
                          <div style={{ fontSize: '11px', color: q.failed ? 'var(--error)' : 'var(--text-muted)' }}>
                            {line.outcome}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </Section>

          {/* E · Answer notebook */}
          <Section title="E · Answer notebook">
            {/*
              The reproduction claim is CONDITIONAL, and the condition is in the
              notebook rather than here (#371). This line asserted flatly that
              re-executing the notebook reproduces section F, which is true only of
              the steps that re-run a live request — a notebook where three of four
              fetches were rejected got the same sentence. Then it said "the
              notebook states how many of them do", which a discovery-only notebook
              does not (#384 P8, F6). The sentence is now written by the one
              formatter that reads the claim off the cells, so it is true of a
              notebook that states a count and of one that states none.
            */}
            <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {reproductionScopeSentence(readReproductionClaim(view.notebook.cells))}{' '}
              The notebook metadata records the sandbox runtime versions used at execution.
            </div>
            <NotebookSection notebook={view.notebook} slug={placeholderSlug} />
          </Section>

          {/* F · Rendered answer — the same answer element shown above */}
          <Section title="F · Rendered answer">
            {answer}
          </Section>

          {/* G · Summary (Phase 2a2 item 3: structured two-clause blurb) */}
          <Section title="G · Summary">
            <div style={{
              padding: '12px 16px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
              borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
              fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)',
            }}>
              {view.structuredSummary ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      Analysis:
                    </span>{' '}
                    {view.structuredSummary.analysisDescription}
                  </div>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      Headline finding:
                    </span>{' '}
                    {view.structuredSummary.headlineFinding}
                  </div>
                </div>
              ) : view.derivedSummary ? (
                view.derivedSummary
              ) : (
                <em style={{ color: 'var(--text-muted)' }}>
                  Summary will be generated at publish time.
                </em>
              )}
            </div>
          </Section>

          {/* Signers + attestations — sibling sections beneath G */}
          <ChatSignersSection executedAt={view.executedAt} signingKeyId={view.signingKeyId} />
        </div>
      </details>
    </div>
  );
}
