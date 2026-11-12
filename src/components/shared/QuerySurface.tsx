'use client';

/**
 * The query surface: the ask-a-question form plus everything it produces.
 *
 * Owns the two streaming hooks (`useStreamingComparison` for the side-by-side
 * comparison, `useNotebookStream` for the executed-notebook mode), the
 * last-submitted query context those results need, and the scroll-to-results
 * behaviour. Mounted on the apex demo page today; extracted so the same
 * surface can be mounted elsewhere without duplicating the wiring.
 *
 * `children` renders in the form's narrow container, above the form — the
 * slot each mount uses for its own framing copy. Everything that is purely
 * framing (hero copy, calls to action, positioning) stays with the page; only
 * the form and its outputs live here.
 *
 * THE DOCK (UX-2 P3b-1; leg H, the owner's design change, dock at send: plan
 * v3, #729 6825049451 and 6835240316). The first send that starts a run moves
 * the form below the results and docks it there (sticky at the viewport's
 * bottom, `composer--docked`), for the surface's life: mid-stream, after a
 * refused or errored run, and after the answer. A send the consent guard holds
 * starts no run (the guard holds it before `onSubmit`), so it does not dock.
 * The form is one keyed child that changes place, so it moves rather than
 * remounts.
 *
 * THE FIRST-TIME LINE (X24; the seat's ruling, #729 6838758130). Docked, it
 * shows under the box from the first send, except after a run that ended with
 * no answer (refused or errored) and before any answer: then it is hidden until
 * the first answer arrives. It goes at the session's second question: a submit
 * made once an answer has arrived on this surface — the box (a chip only fills
 * it), "Continue this analysis", or the demoted comparison's run. A submit made
 * before any answer (the first send, a retry after a failed run, the form's
 * resend after Allow) is not counted. That is kept in session storage, so a
 * remount in the same session does not show it again.
 */

import { useState, useRef } from 'react';
import QueryForm from '@/components/QueryForm';
import { useDefaultPortalArg } from '@/components/DefaultPortalProvider';
import ComparisonDisplay from '@/components/ComparisonDisplay';
import NotebookOutput from '@/components/notebook/NotebookOutput';
import { ConsentPausePrompt, preferredScrollBehavior } from '@/components/answer-view/ConsentStep';
import { useStreamingComparison } from '@/hooks/useStreamingComparison';
import { useNotebookStream } from '@/hooks/useNotebookStream';
import { useSessionChoice } from '@/hooks/useSessionChoice';
import {
  COMPARISON_STORAGE_KEY,
  isComparisonRunComplete,
  parseStoredComparison,
  shouldRunMcpOnly,
  type QueryMode,
  type QuerySurfacePresentation,
} from '@/lib/query-presentation';

/** Session storage: the first-time line has been answered by a second question this session (UX-2 P3b-1). */
const FIRST_TIME_LINE_STORAGE_KEY = 'civicaitools.firstTimeLineDone';
const parseFirstTimeLineDone = (raw: string | null): 'done' | null => (raw === 'done' ? 'done' : null);

interface QuerySurfaceProps {
  /** Framing content rendered above the form, inside its container. */
  children?: React.ReactNode;
  /**
   * How this mount presents the standard-mode result (s6 P2, #229; Q62 G0).
   *
   * Default `'comparison'` — the apex demo's side-by-side, unchanged and
   * unconfigured (the marketing page passes nothing; the default is applied
   * here, inside the client component, so nothing about it serializes into
   * that mount's payload). `/ask` passes `'answer-first'`: the with-data
   * answer is primary, the comparison is demoted to an expand option, and
   * demoted runs make one model call instead of two. The visitor can
   * restore the comparison per session — via the demoted element under the
   * answer or the Advanced-options toggle — after which both arms run and
   * render exactly as on the apex.
   */
  presentation?: QuerySurfacePresentation;
  /**
   * The response mode the form starts in when the visitor has made no
   * explicit choice. Default `'standard'` — every existing mount's
   * behavior; `/ask` passes `'notebook'` (Q62 G0). An explicit mode choice
   * is session-sticky and wins over this default.
   */
  defaultMode?: QueryMode;
  /**
   * Whether the form offers Advanced options to a signed-out reader (UX pass
   * row 7). Default 'always', every mount as before; the public home page
   * passes 'hidden-signed-out'. Handed to `QueryForm` unchanged.
   */
  advancedOptions?: 'always' | 'hidden-signed-out';
}

export default function QuerySurface({
  children,
  presentation = 'comparison',
  defaultMode = 'standard',
  advancedOptions = 'always',
}: QuerySurfaceProps) {
  const [queryCount, setQueryCount] = useState(0);
  const [usedModel, setUsedModel] = useState<string>('');
  const [lastQuery, setLastQuery] = useState<string>('');
  const [lastPortal, setLastPortal] = useState<string>('');
  const [lastMode, setLastMode] = useState<QueryMode>('standard');
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const streaming = useStreamingComparison();
  const notebook = useNotebookStream();
  // This instance's configured default portal as a wire value, or '' when it
  // declared none (#407) — server-resolved, threaded through the root layout.
  const defaultPortal = useDefaultPortalArg();

  // Answer-first configuration (s6 P2, #229). The restore choice is
  // session-sticky through the same mechanism as the response mode; it only
  // means anything on an answer-first mount — the apex neither reads it into
  // behavior (shouldRunMcpOnly is constant-false for 'comparison') nor
  // renders the toggle that writes it.
  const answerFirstConfigured = presentation === 'answer-first';
  const [comparisonChoice, setComparisonChoice] = useSessionChoice(
    COMPARISON_STORAGE_KEY,
    parseStoredComparison,
  );
  const comparisonRestored = comparisonChoice === 'on';
  // Presentation follows the run, not the toggle: flipping the toggle
  // mid-result must not reshape an already-rendered answer (a restored
  // comparison has nothing to show for a run whose without-data arm never
  // executed). The next submit picks the toggle up.
  const answerFirstActive = answerFirstConfigured && streaming.mcpOnly;

  // The dock (UX-2 P3b-1 leg H): the first send that starts a run docks the form, for good (`handleSubmit`).
  const [docked, setDocked] = useState(false);
  // The run on show has finished with an answer — standard: every panel the run has is complete and one has content;
  // notebook: the run ended with a notebook. `answeredOnce` latches the first time it does on this surface.
  const answered = lastMode === 'standard'
    ? !streaming.isLoading
      && isComparisonRunComplete(streaming.mcpOnly, streaming.withoutMcp.isComplete, streaming.withMcp.isComplete)
      && (streaming.withMcp.content !== '' || streaming.withoutMcp.content !== '')
    : !notebook.state.isLoading && notebook.state.notebook != null;
  const running = streaming.isLoading || notebook.state.isLoading;
  const [answeredOnce, setAnsweredOnce] = useState(false);
  // A run that ended with no answer (refused or errored) before any answer: the first-time line waits for one.
  const [endedWithoutAnswer, setEndedWithoutAnswer] = useState(false);
  if (answered && !answeredOnce) {
    // The "adjust state when a value changes" render-time pattern.
    setAnsweredOnce(true);
  }
  if (docked && !running && !answered && !answeredOnce && !endedWithoutAnswer) {
    setEndedWithoutAnswer(true);
  }
  const [firstTimeLineDone, setFirstTimeLineDone] = useSessionChoice(FIRST_TIME_LINE_STORAGE_KEY, parseFirstTimeLineDone);
  /**
   * The session's second question is a submit made once an answer has arrived on this surface: the first-time line
   * has done its job. Before any answer nothing is counted, so the line still shows at the first answer
   * (composer-dock.test.ts: the refused first send, Allow's resend, and the errored first runs fail if it is).
   */
  const countQuestion = () => {
    if (answeredOnce) setFirstTimeLineDone('done');
  };
  const showFirstTimeLine = docked && firstTimeLineDone !== 'done' && (answeredOnce || !endedWithoutAnswer);

  // Extract display name from model ID (e.g., "anthropic/claude-sonnet-4" -> "Claude Sonnet 4")
  const getModelDisplayName = (modelId: string) => {
    const name = modelId.split('/')[1] || modelId;
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleSubmit = async (query: string, model: string, portal: string, mode: QueryMode) => {
    // The form's selection, else this instance's configured default, else
    // NONE (#407). '' is the wire's "no portal" — the id of the form's "All
    // portals" entry — and it is what the routes read as absent. It used to
    // be a literal here, so choosing "All portals" silently ran against one
    // deployment's city and every surface downstream said so.
    const effectivePortal = portal || defaultPortal;
    countQuestion();
    // Dock at send (leg H): set after the count, so a send is read against the state it was made in.
    setDocked(true);
    setUsedModel(model);
    setLastQuery(query);
    setLastPortal(effectivePortal);
    setLastMode(mode);

    // Scroll to results after a brief delay to let the loading state render.
    // At once, not smoothly, when the reader asked for reduced motion (R9 P1).
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
    }, 100);

    if (mode === 'notebook') {
      streaming.abort();
      notebook.start(query, model, effectivePortal);
    } else {
      notebook.reset();
      streaming.startComparison(query, model, effectivePortal, {
        mcpOnly: shouldRunMcpOnly(presentation, comparisonRestored),
      });
    }
    setQueryCount((c) => c + 1);
  };

  const handleContinue = (continuationPrompt: string) => {
    countQuestion();
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
    }, 100);
    streaming.startComparison(continuationPrompt, usedModel, lastPortal, {
      mcpOnly: shouldRunMcpOnly(presentation, comparisonRestored),
    });
    setQueryCount((c) => c + 1);
  };

  // Expand option on the demoted comparison (answer-first mounts): restore
  // the side-by-side presentation for the session and re-run the question
  // with both arms — the without-data arm was skipped, so there is nothing
  // to expand without running it.
  const handleRunComparison = () => {
    if (!lastQuery) return;
    countQuestion();
    setComparisonChoice('on');
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
    }, 100);
    streaming.startComparison(lastQuery, usedModel, lastPortal, { mcpOnly: false });
    setQueryCount((c) => c + 1);
  };

  const handleNotebookRetry = () => {
    if (lastQuery) notebook.start(lastQuery, usedModel, lastPortal);
  };

  // One element, keyed, placed above the results or (docked) below them: React moves it rather than remounting it,
  // so the question typed and the guard's state survive the dock.
  const form = (
    <QueryForm
      key="query-form"
      onSubmit={handleSubmit}
      // Any run, Standard or Sandbox, docked or not, disables the box and its arrow (UX-2 P3b-1, 1A; addendum 3, 3.1):
      // a send during a Sandbox run would otherwise restart it (`useNotebookStream.start` aborts the run in progress).
      isLoading={streaming.isLoading || notebook.state.isLoading}
      queryCount={queryCount}
      defaultMode={defaultMode}
      advancedOptions={advancedOptions}
      comparisonControl={
        answerFirstConfigured
          ? {
              restored: comparisonRestored,
              onChange: (restored) => setComparisonChoice(restored ? 'on' : 'off'),
            }
          : undefined
      }
      docked={docked}
      showFirstTimeLine={showFirstTimeLine}
    />
  );

  // The reader's question, first in each results container (leg H; A2 = B, A3/D2 = yes): the question as sent, which
  // "Continue this analysis" keeps (it sends a built prompt and leaves `lastQuery` as it was). No screen-reader name:
  // after the page's hidden h1 it reads as the question, then the run's heading.
  const bubble = lastQuery ? <div data-part="question-bubble" className="query-bubble">{lastQuery}</div> : null;

  return (
    <>
      {/* Framing: narrow container */}
      <div key="framing" style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px 0' }}>
        {children}
      </div>

      {/* Query Form, before the first answer (its narrow column is the composer's own, `composer--form`) */}
      {!docked && form}

      {/* Results: wide container matching header max-w-6xl */}
      {lastMode === 'standard' && streaming.error && (
        <div key="error" className="max-w-6xl mx-auto px-6">
          <div
            style={{
              marginBottom: '32px',
              padding: '16px 24px',
              backgroundColor: 'rgba(236, 19, 30, 0.1)',
              color: 'var(--error)',
              borderRadius: '4px',
              border: '1px solid var(--error)',
            }}
          >
            {streaming.error}
          </div>
        </div>
      )}

      {lastMode === 'standard' && (streaming.isLoading || streaming.withoutMcp.content || streaming.withMcp.content ||
        streaming.withoutMcp.isComplete || streaming.withMcp.isComplete || streaming.error) && (
        <div key="results" ref={resultsRef} className="max-w-6xl mx-auto px-6" style={{ marginBottom: '24px' }}>
          {bubble}
          <h2 style={{ marginBottom: '16px' }}>Results</h2>
          {/* R9 P1 (#672): where the submit scroll leaves the reader, a run's open question, with its two answers. */}
          <ConsentPausePrompt />
          <ComparisonDisplay
            withoutMcp={null}
            withMcp={null}
            isLoading={streaming.isLoading}
            modelName={getModelDisplayName(usedModel)}
            isStreaming={true}
            streamingWithoutMcp={streaming.withoutMcp}
            streamingWithMcp={streaming.withMcp}
            queryText={lastQuery}
            // The bubble above shows the question; the answer leaves out its italic quote (A4 = A). /explore keeps it.
            showQueryQuote={false}
            portal={lastPortal}
            model={usedModel}
            evidenceTrace={streaming.evidenceTrace}
            publishDialogOpen={publishDialogOpen}
            onPublishDialogChange={setPublishDialogOpen}
            onContinue={handleContinue}
            answerFirst={answerFirstActive}
            onRunComparison={answerFirstConfigured ? handleRunComparison : undefined}
          />
        </div>
      )}

      {lastMode === 'notebook' && (notebook.state.isLoading || notebook.state.notebook || notebook.state.error) && (
        <div key="notebook-results" ref={resultsRef} className="max-w-6xl mx-auto px-6" style={{ marginBottom: '24px' }}>
          {bubble}
          {/* UX pass row 19: the reader's words for the mode, as the record page says it. */}
          <h2 style={{ marginBottom: '16px' }}>Answer, executed in a signed sandbox</h2>
          {/* R9 P1 (#672): the run's open question, as above. */}
          <ConsentPausePrompt />
          <NotebookOutput
            state={notebook.state}
            prompt={lastQuery}
            model={usedModel}
            portal={lastPortal}
            onRetry={handleNotebookRetry}
          />
        </div>
      )}

      {/* Query Form, docked below the results from the first send that starts a run */}
      {docked && form}
    </>
  );
}
