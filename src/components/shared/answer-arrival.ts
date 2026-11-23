'use client';

/**
 * The answer, for a reader who scrolled, and the surface's two announcements (FIX-1 FX2, website #807; G0's rulings D4
 * to D8 on #802). Used by `QuerySurface` only.
 *
 * THE MOVE (D4 = A, D5 = A). When a run's answer first renders with content, the surface measures its top (its topmost
 * author line's, when it has one: FX2b, Seat ruling 7080749045): if it is
 * not between the sticky header's bottom and the viewport's bottom, the window scrolls once so the top sits just under
 * the header, with the surface's own behaviour (`preferredScrollBehavior`: at once under reduced motion). An answer
 * that arrives in view moves nothing. Keyboard focus is never moved. The measure waits a moment after the answer
 * renders, as the results scroll and the pause prompt's scroll do, so the browser's scroll anchoring has settled the
 * page first. On the chat path the answer streams in, so "arrives" is its first render with content (Seat 7047605178).
 *
 * THE ANSWER'S ANNOUNCEMENT (D6 = A, D7 = A). One polite live region, mounted with the surface (so it stays across the
 * swap from progress to answer, where the progress panel's own region unmounts), reads `ANSWER_READY` once per run when
 * the run's answer is ready, whether or not the view moved. Its text is derived from the run: empty while a run works,
 * the sentence once its answer is ready, so each run's answer is announced once.
 *
 * THE PAUSE REPLY (D8 = A). When the pause prompt closes after an answer (`promptPause` stops naming its pause, and the
 * pause has a decision or a failure), a second polite region reads the consent card's own outcome sentence, whichever
 * the card shows. The sentence is read from what the card renders and matched against `CONSENT_STEP_TEXT`, never
 * copied: when the card's sentences change, the announcement follows.
 *
 * Neither trigger fires for an answer with no content: `AnswerBody` always draws `data-part="answer"`, with "No
 * synthesis was produced for this analysis." when there is nothing, so the surface decides on the answer's content.
 */

import { useEffect, useRef, useState } from 'react';
import { CONSENT_STEP_TEXT, preferredScrollBehavior, promptPause } from '@/components/answer-view/ConsentStep';
import { pauseEntry, useSourceConsent } from '@/components/sources/useSourceConsent';

/** The space kept between the sticky header's bottom and the answer's top after the move. */
export const ANSWER_TOP_GAP = 16;
/** How long the surface waits after the answer renders before it measures (as `QuerySurface`'s results scroll waits). */
export const ARRIVAL_WAIT_MS = 100;

/** The sticky site header's bottom in the viewport, or 0 when it is not there or above the viewport. */
function headerBottom(): number {
  const header = document.querySelector?.('header')?.getBoundingClientRect?.();
  return header && header.bottom > 0 ? header.bottom : 0;
}

/**
 * The answer's top as the page draws it (FIX-1 FX2b, Seat ruling 7080749045): the topmost of the author lines directly
 * before the answer part (`<p data-author>`, "Answer, written by the model …"; zero, one or two of them,
 * `adapt-notebook.ts`), or the answer part itself when it has none.
 */
export function answerTopElement(answer: Element): Element {
  let top = answer;
  for (let prev = answer.previousElementSibling; prev && prev.hasAttribute?.('data-author'); prev = prev.previousElementSibling) top = prev;
  return top;
}

/** The answer's top is in view: between the header's bottom and the viewport's bottom (D4). */
export function answerTopInView(top: number, header: number, viewportHeight: number): boolean {
  return top >= header - 0.5 && top < viewportHeight;
}

/**
 * Brings the answer's top under the header when it is out of view (D5): one scroll of the window. Returns what it did.
 * `root` is the results container; the document when it is not attached. The answer part is the first in the document
 * (the main one; the disclosure's second placement comes later), and its top is its topmost author line's (FX2b).
 */
export function bringAnswerIntoView(root: ParentNode | null): 'moved' | 'in-view' | 'absent' {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 'absent';
  const answer = (root ?? document).querySelector?.('[data-part="answer"]');
  const box = answer ? answerTopElement(answer).getBoundingClientRect?.() : undefined;
  if (!box) return 'absent';
  const top = headerBottom();
  if (answerTopInView(box.top, top, window.innerHeight)) return 'in-view';
  if (typeof window.scrollBy !== 'function') return 'absent';
  window.scrollBy({ top: box.top - top - ANSWER_TOP_GAP, behavior: preferredScrollBehavior() });
  return 'moved';
}

/**
 * D4, D5: brings the answer into view once per run, at the render where `arrived` turns true (a run's answer has
 * rendered with content). A new run resets `arrived` to false, so its answer is measured again.
 */
export function useAnswerArrival(arrived: boolean, root: { current: ParentNode | null }): void {
  const was = useRef(false);
  useEffect(() => {
    const arriving = arrived && !was.current;
    was.current = arrived;
    if (!arriving) return;
    const timer = setTimeout(() => { bringAnswerIntoView(root.current); }, ARRIVAL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [arrived, root]);
}

/** The outcome sentence a consent card's outcome line holds: the longest of the card's sentences it begins with. */
export function outcomeSentence(rendered: string): string {
  const text = rendered.replace(/\s+/g, ' ').trim();
  let best = '';
  for (const sentence of Object.values(CONSENT_STEP_TEXT)) {
    if (typeof sentence === 'string' && sentence.length > best.length && text.startsWith(sentence)) best = sentence;
  }
  return best || text;
}

/** The outcome the consent card for `sourceId` shows: the run's steps' card first, the newest one; else a row's. */
function renderedOutcome(sourceId: string): string | null {
  if (typeof document === 'undefined') return null;
  const cards = [...(document.querySelectorAll?.('[data-part="consent-step"]') ?? [])]
    .filter((card) => card.getAttribute?.('data-consent-source') === sourceId);
  const ordered = [
    ...cards.filter((card) => card.getAttribute?.('data-consent-place') === 'steps').reverse(),
    ...cards.filter((card) => card.getAttribute?.('data-consent-place') !== 'steps'),
  ];
  for (const card of ordered) {
    const text = card.querySelector?.('[data-part="consent-outcome"]')?.textContent;
    if (text && text.trim() !== '') return outcomeSentence(text);
  }
  return null;
}

/**
 * D8: the text of the pause reply's polite region. When the prompt stops asking about a pause that now holds an answer
 * or a failure, the card's outcome sentence, read once the card has rendered it; cleared first, so the same sentence
 * after a second reply is announced again.
 */
export function useConsentReplyAnnouncement(): string {
  const consent = useSourceConsent({ load: false });
  const asking = promptPause(consent.pauses)?.[0];
  const was = useRef<string | undefined>(undefined);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [reply, setReply] = useState('');
  useEffect(() => {
    const before = was.current;
    was.current = asking;
    if (before === undefined || before === asking) return;
    const entry = pauseEntry(consent.pauses, before);
    if (!entry || (entry.decision === undefined && entry.failure === undefined)) return;
    const sourceId = entry.payload.source.sourceId;
    timers.current.push(setTimeout(() => {
      setReply('');
      timers.current.push(setTimeout(() => {
        const sentence = renderedOutcome(sourceId);
        if (sentence !== null) setReply(sentence);
      }, 50));
    }, 0));
  }, [asking, consent.pauses]);
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  return reply;
}
