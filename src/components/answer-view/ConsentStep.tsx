'use client';

/**
 * The consent step (#644 W2, C3; design §1.6): a load of a source the reader
 * set to Ask first has stopped to ask. Shown as a step of its own in a run's
 * steps (`ProgressLog` on the comparison surfaces and `/explore`,
 * `StepsPartView`'s step view on the executed run), and in the Sources
 * panel's row for that source while the question waits, so a reader who
 * scrolled can answer there. Never a part of its own, never inside the
 * disclosure.
 *
 * WHAT IT SAYS, decision first (fix round 1, item 3), so it is read in
 * well under a minute: the source by its reader name, never a tool's exposed
 * name, and that the AI asked; what Allow and Don't allow each send, that the
 * choice can be changed, how long the question waits, and the two buttons,
 * equal in size and style. Then, in the Sources panel's own form (R6 PL),
 * what the source is and whose connector reaches it, running where
 * (`sourceRowLines`); who holds its logs, as `KeptByLines` renders them, each
 * with its date or "not stated"; the hosts its variant would reach beyond its
 * address, when it names any; the privacy page, and the deployment guide or
 * the sentence that says this site names none (R6's D10). The outcome, once
 * there is one, is last.
 *
 * Every fact comes from the pause the server sent (`ConsentPausePayload`):
 * the flows statement's entry for the source, as the panel renders it, and
 * the hosts its hosting variant may reach. The answer is posted with the
 * pause's own key (`decideConsentPause`), and once given, the card shows it.
 * A pause that does not hold (no store, or the run's holds spent) shows no
 * buttons: it says the source was not used, and how to turn it On.
 *
 * THE ANSWERS (UX-2 P4b; items 8, 9, 20, 21, 39, B4b, B4c; D7 = C, ASK2 =
 * B with S4). "Allow" and "Don't allow" are the equal pair; "Don't allow"
 * posts `off`, which turns the source Off for later questions too. While the
 * pause asks, "Allow all data sources" is a lighter, full-width third button
 * below the pair: it posts `allow-all`, every configured source is turned On,
 * and the run goes on with no further pause. The outcome sentences are this
 * card's only (L1), each with item 13's one pointer to Data source settings.
 *
 * S4 W2b (npstorey/civic-ai-tools#335; criterion B3). The words are the
 * rulings' taken forms (`CONSENT_STEP_TEXT`): the pair is "Enable" and "Don't
 * enable" (S100), and the third button "Enable all data sources" (S96) at
 * twelve or fewer configured sources. Above twelve, a source in a group of
 * two or more gets the class answers instead, S12 and S13 (`allow-class`,
 * `off-class`), which set every member of the group not set on its own, and
 * a source alone gets the pair only (`pauseScope`, over the grouping Settings
 * reads). The heading is S146 while the hold is open and unanswered and S147
 * in every closed state, only the name bold, with no line under it
 * (C3-D-H B). The prompt keeps S104 in view and puts the choices sentence
 * behind "What each answer does" (S105); the card puts the source's facts
 * behind "More about this source" (S103) (C3-D = C). The outcomes, and when
 * the pointer follows them, are `pauseOutcome` and `pauseOutcomePointed`.
 *
 * ONE PLACE TO ANSWER (UX-2 HG; D1-D4 = A; W2 = A). While `ConsentPausePrompt`
 * asks about a pause, it holds the only buttons, the choices sentence, and the
 * `change` sentence with its link to Data source settings, so the reader is
 * told before answering that the choice can be undone. The card
 * in the run's steps for the same pause then states the step without them:
 * the heading, that the AI asked, how long the question waits, then the
 * source's lines, in the steps' own grey frame (`STEP_FRAME`), not the accent
 * frame that marks where to answer. The two read one predicate,
 * `promptPause`, so the card has no buttons exactly when the prompt shows them
 * for the same key, whatever the run's own state says (`runMovedOn`). A pause
 * the bus does not hold (none was reported to this page) keeps its buttons in
 * the card. The Sources row's card (`place="row"`) keeps its buttons
 * throughout (D4 A).
 *
 * THE RUN ENDED WHILE THE PROMPT ASKS (UX-2 HG, W4 = b). A run that ends or
 * fails during the hold can leave the page's hold open (#704), so the prompt
 * still asks while the card's step is closed (`runMovedOn`). The card then reads
 * as a cancelled card reads: the heading, the source's lines, then `gone`, with
 * no `asked`, no `wait` and no buttons, in the steps' frame. The prompt is
 * unchanged.
 *
 * AFTER THE HOLD (R9 P1, #669 D2). The run waits a minute; the entry lives
 * ten (`entryExpiresAt`). Between the two the card keeps Allow and Don't
 * allow, equal as before, and says the run went on without the answer and that
 * an answer now applies to the reader's next question; once given, it says so.
 * No "Allow all data sources" then (ruled W2, relay 26): the run has moved on,
 * the card no longer asks, and the button would promise a question that goes
 * on without asking again, which it cannot do.
 * At the entry's end, on a 404, or on Cancel, the buttons go and the card
 * says the question is no longer waiting. The run's own "moved on" state
 * (`runMovedOn`, the step's `isComplete`) changes the words, never the
 * buttons (the seat's note 4): the bus's entry decides those. While the
 * prompt asks, it changes no button, and the words only as THE RUN ENDED
 * WHILE THE PROMPT ASKS says.
 *
 * IN VIEW (R9 P1, #672). `ConsentPausePrompt`, rendered by the surface that
 * owns the question box (at the top of the answer area on the home page and
 * `/ask`, under the running question on `/explore`), shows the card's
 * heading, what each choice sends, that the choice can be changed, and the
 * page's only answer buttons while a hold is open and unanswered. Once per pause, if the prompt is not already in the
 * viewport (below the sticky header), it brings the PROMPT into view
 * (`block: 'nearest'`; `behavior: 'auto'` when the reader asked for reduced
 * motion, as `preferredScrollBehavior` says for every scroll the question
 * surface makes); when it is in view, nothing moves. The step card is never
 * the scroll target: it carries no answer while the prompt asks, and at
 * 393 x 852 a scroll to it took the prompt 237 px above the viewport (the
 * owner's preview read, R9 P1 Amendment 3).
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import type { FlowsStatement } from '@/lib/flows/statement';
import type { ConsentPausePayload } from '@/lib/streaming';
import { ALLOW_ALL_SOURCES, COOKIE_FULL_TEXT, PANEL_PRIVACY_LINK, PANEL_ROW_MORE, SETTINGS_HREF, SETTINGS_TEXT, countInWords } from '@/lib/sources/copy';
import { pauseScope, type PauseScope } from '@/lib/sources/reader-groups';
import { readerSourceName, sourceRowLines } from '@/lib/sources/source-name';
import { KeptByLines } from '@/components/sources/KeptByLine';
import LocalOnlyOffer from '@/components/sources/LocalOnlyOffer';
import { decideConsentPause, pauseEntry, useSourceConsent, type PauseAnswer, type PendingPause } from '@/components/sources/useSourceConsent';

/**
 * The pause `ConsentPausePrompt` asks about: the newest that holds, whose hold is open, and that has no answer or
 * failure. One predicate for the prompt and the card (UX-2 HG), so the card has no buttons exactly when the prompt
 * shows them for the same key.
 */
export function promptPause(pauses: Record<string, PendingPause>): [string, PendingPause] | undefined {
  return Object.entries(pauses).reverse().find(([, p]) => p.payload.holds && !p.holdEnded && !p.expired && p.decision === undefined && p.failure === undefined);
}

/** The heading's two forms around the source's name (C3-D-H B): S146 while waiting, S147 when closed. */
const HEADING_WAITING = { before: 'The AI has asked to use ', after: '. Nothing has been sent to it yet.' } as const;
const HEADING_CLOSED = { before: 'The AI asked to use ', after: '.' } as const;
/** The full form of a cookie-full outcome's reason (C4 = A). */
const COOKIE_IS_FULL = 'because the cookie that keeps your settings is full.';
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "{K} set on {its|their} own {was|were} left as {it is|they are}." (S17, S19, and S27's and S28's clause.) */
const leftAsIs = (left: number) =>
  `${capital(countInWords(left))} set on ${left === 1 ? 'its' : 'their'} own ${left === 1 ? 'was' : 'were'} left as ${left === 1 ? 'it is' : 'they are'}.`;

/**
 * The card's own sentences, each checked against the consent-wording research. S4 W2b (npstorey/civic-ai-tools#335):
 * the taken forms of the owner's rulings of 2026-11-24 (C3 = A, C3-ALL = A, C3-D = C, C4 = A, C6 = B; DR-7 B, DR-8 A,
 * DR-11 A, with W3 = A's pairs) and of the second sitting (C3-D-H B with N1 (b) and N2 (b); OUTCOME_LINES A; POINTER
 * (b)), byte for byte; where a form carries a count, the count is the site's (`countInWords`). `asked` is gone: the
 * step card has no line under its heading (C3-D-H B).
 */
export const CONSENT_STEP_TEXT = {
  /** S146 (N1 (b)): while the hold is open and unanswered, in the prompt, the step card and the row card. Only the name is bold. */
  waiting: HEADING_WAITING,
  /** S147 (N2 (b)): the step card's and the row card's heading in every closed state. */
  closed: HEADING_CLOSED,
  /** The heading's text, without the bold: the group's accessible name. */
  heading: (name: string, waiting = true) => {
    const parts = waiting ? HEADING_WAITING : HEADING_CLOSED;
    return `${parts.before}${name}${parts.after}`;
  },
  cannotAsk: 'This question cannot stop to ask you, so it was not used.',
  nextQuestion: 'You can turn it On in Data source settings for your next question.',
  /** S104 (C3-D = C): the prompt's short line, in view, at every size. */
  short: "Enable sends it the AI's searches, now and for later questions. Don't enable sends it nothing and disables it.",
  /** S105 (C3-D = C): the prompt's closed disclosure, which holds the choices sentence. */
  whatEachAnswerDoes: 'What each answer does',
  /** S98: the choices sentence at twelve or fewer configured sources, where the third answer is S96. */
  choices: "Enable: the AI's searches for this question are sent to it, and it is enabled for later questions. Don't enable: nothing is sent to it, and it is disabled for later questions. Enable all data sources: every data source is enabled, including any you disabled, and this question goes on without asking again.",
  /** S79: above twelve, for a source alone in its class (the pair only). */
  choicesAlone: "Enable: the AI's searches for this question are sent to it, and it is enabled for later questions. Don't enable: nothing is sent to it, and it is disabled for later questions.",
  /** S14 (C6 = B): above twelve, for a source in a class of two or more. */
  choicesClass: (n: number, phrase: string) =>
    "Enable: the AI's searches for this question are sent to it, and it is enabled for later questions. Don't enable: nothing is sent to it, and it is disabled for later questions. "
    + `Enable all ${countInWords(n)} ${phrase}: each is enabled, unless you set it on its own. Don't enable any of the ${countInWords(n)}: each is disabled, unless you set it on its own. `
    + `After either answer for all ${countInWords(n)}, this question goes on without asking again about the sources it set.`,
  /** S100: the pair, equal in size and style. */
  enable: 'Enable',
  dontEnable: "Don't enable",
  /** S12 (C6 = B) and S13: the third and fourth answers above twelve, for a class of two or more. */
  enableClass: (n: number, phrase: string) => `Enable all ${countInWords(n)} ${phrase}`,
  dontEnableClass: (n: number) => `Don't enable any of the ${countInWords(n)}`,
  change: 'You can change this in Data source settings at any time.',
  wait: 'The question waits up to a minute for your answer.',
  reach: (hosts: readonly string[]) => `It would reach: ${hosts.join(', ')}.`,
  /** S112: after Enable, while the question waited. */
  allowed: 'You chose Enable. It is enabled now.',
  /** S113: Enable was saved, and the question uses the source, but its setting could not be moved, for any reason but a full cookie. */
  allowedNotMoved: "You chose Enable. The AI's searches for this question are sent to it. It could not be enabled for later questions. You can enable it in Data source settings.",
  /** S29 (C4 = A): the same, because the cookie is full. */
  allowedFull: `You chose Enable. The AI's searches for this question are sent to it. It could not be enabled for later questions, ${COOKIE_IS_FULL}`,
  /**
   * After Don't enable while the question waited. Drafted in S4 W2b fix round 1 (the seat's ruling 7239440759) by the
   * ruled pairs (Don't allow → Don't enable, Off → disabled), for the words check; no taken form (S101, these words,
   * was dropped with C3 · C).
   */
  declined: "You chose Don't enable. Nothing is sent to it, and it is disabled now.",
  /** S30 (C4 = A): after Don't enable while the question waited, because the cookie is full. */
  declinedFull: `You chose Don't enable. Nothing is sent to it for this question. It could not be disabled for later questions, ${COOKIE_IS_FULL}`,
  /** S102 (C3-ALL = A): after "Enable all data sources". */
  allowedAll: 'You chose Enable all data sources. Every data source is enabled now. A source added later is not enabled until you enable it.',
  /** S16 and S17: after S12, the class enabled but for `left` set on their own. */
  classAllowed: (n: number, phrase: string, left: number) =>
    left === 0
      ? `You chose Enable all ${countInWords(n)} ${phrase}. They are enabled now.`
      : `You chose Enable all ${countInWords(n)} ${phrase}. ${capital(countInWords(n - left))} ${n - left === 1 ? 'is' : 'are'} enabled now. ${leftAsIs(left)}`,
  /** S18 and S19: after S13. */
  classDeclined: (n: number, phrase: string, left: number) =>
    left === 0
      ? `You chose Don't enable any of the ${countInWords(n)}. The ${countInWords(n)} ${phrase} are disabled now, and nothing is sent to them.`
      : `You chose Don't enable any of the ${countInWords(n)}. ${capital(countInWords(n - left))} of the ${countInWords(n)} ${phrase} are disabled now, and nothing is sent to them. ${leftAsIs(left)}`,
  /** S27 (C4 = A): after S12, because the cookie is full. */
  classAllowedFull: (n: number, phrase: string, left: number) =>
    `You chose Enable all ${countInWords(n)} ${phrase}. The AI's searches for this question can go to ${left === 0 ? 'them' : `${countInWords(n - left)} of them`}. `
    + `${left === 0 ? '' : `${leftAsIs(left)} `}They could not be enabled for later questions, ${COOKIE_IS_FULL}`,
  /** S28 (C4 = A): after S13, because the cookie is full. */
  classDeclinedFull: (n: number, phrase: string, left: number) =>
    `You chose Don't enable any of the ${countInWords(n)}. Nothing is sent to ${left === 0 ? `the ${countInWords(n)}` : `${countInWords(n - left)} of the ${countInWords(n)}`} ${phrase} for this question. `
    + `${left === 0 ? '' : `${leftAsIs(left)} `}They could not be disabled for later questions, ${COOKIE_IS_FULL}`,
  /**
   * Drafted in S4 W2b fix round 1 (7239440759), for the words check, built as S126 and S158 are: a class answer, or
   * "Enable all data sources", whose move threw; and "Enable all data sources" refused at the cookie's bound. A class
   * answer refused at the bound reads S27 or S28. No pointer follows any of them.
   */
  classAllowedNotMoved: (n: number, phrase: string) =>
    `You chose Enable all ${countInWords(n)} ${phrase}, but they could not be enabled. You can enable them in Data source settings.`,
  classDeclinedNotMoved: (n: number) =>
    `You chose Don't enable any of the ${countInWords(n)}, but they could not be disabled. You can disable them in Data source settings.`,
  allowedAllNotMoved: 'You chose Enable all data sources, but they could not be enabled. You can enable them in Data source settings.',
  allowedAllFull: `You chose Enable all data sources, but they could not be enabled, ${COOKIE_IS_FULL}`,
  /** Item 13: the one pointer, added to an outcome once `change` no longer renders. */
  pointer: 'You can change this in Data source settings.',
  ended: 'The question went on without your answer, so it did not use this source.',
  gone: 'This question is no longer waiting for an answer.',
  decided: 'An answer was already given for this question.',
  failed: 'Your answer could not be saved. You can set this source in Data source settings.',
  // After the hold (R9 P1, #669 D2): as the research check and the seat ruled them; renamed by OUTCOME_LINES A.
  stillAnswer: 'You can still answer for later questions.',
  /** S154. */
  afterChoices: "Enable: it is enabled for later questions. Don't enable: it is disabled for later questions.",
  /** S156; the pointer follows it (POINTER (b)). */
  allowedAfter: 'You chose Enable. It is enabled for later questions.',
  /** S126[1] and S126[2]: Enable after the hold did not move the setting. */
  allowedAfterNotMoved: 'You chose Enable, but it could not be enabled. You can enable it in Data source settings.',
  allowedAfterFull: `You chose Enable, but it could not be enabled, ${COOKIE_IS_FULL}`,
  /** S157; the pointer follows it only when the setting moved (POINTER (b)). */
  declinedAfter: "You chose Don't enable. It is disabled for later questions.",
  /** S158[1] and S158[2]: Don't enable did not move the setting (the move threw, or the cookie is full); no pointer. */
  declinedNotMoved: "You chose Don't enable, but it could not be disabled. You can disable it in Data source settings.",
  declinedNotMovedFull: `You chose Don't enable, but it could not be disabled, ${COOKIE_IS_FULL}`,
} as const;

/**
 * The outcome after an answer the route accepted, by its decision, whether it came after the hold, and whether the
 * setting moved (and why not), with S25 after S27 to S30 on a site that keeps consents on accounts (C4 = A). The
 * readings where two taken forms meet are stated in the phase report: S30 (C4 = A) while the question waits and S158[2]
 * after the hold for a full cookie; S158[1] on both for a move that threw.
 */
export function pauseOutcome(slot: Pick<PendingPause, 'decision' | 'moved' | 'code' | 'group' | 'afterHold'>, accounts: boolean): string | null {
  const T = CONSENT_STEP_TEXT;
  const after = slot.afterHold === true;
  const notMoved = slot.moved === false;
  const full = notMoved && slot.code === 'consent_cookie_full';
  const signIn = (text: string) => (accounts ? `${text} ${COOKIE_FULL_TEXT.signIn}` : text);
  const g = slot.group;
  switch (slot.decision) {
    case 'allow':
      if (!notMoved) return after ? T.allowedAfter : T.allowed;
      if (full) return after ? T.allowedAfterFull : signIn(T.allowedFull);
      return after ? T.allowedAfterNotMoved : T.allowedNotMoved;
    case 'off':
      if (!notMoved) return after ? T.declinedAfter : T.declined;
      if (full) return after ? T.declinedNotMovedFull : signIn(T.declinedFull);
      return T.declinedNotMoved;
    case 'allow-all':
      if (!notMoved) return T.allowedAll;
      return full ? T.allowedAllFull : T.allowedAllNotMoved;
    case 'allow-class':
      if (!g) return T.allowed;
      if (!notMoved) return T.classAllowed(g.n, g.phrase, g.left);
      return full ? signIn(T.classAllowedFull(g.n, g.phrase, g.left)) : T.classAllowedNotMoved(g.n, g.phrase);
    case 'off-class':
      if (!g) return T.declined;
      if (!notMoved) return T.classDeclined(g.n, g.phrase, g.left);
      return full ? signIn(T.classDeclinedFull(g.n, g.phrase, g.left)) : T.classDeclinedNotMoved(g.n);
    default:
      return null;
  }
}

/**
 * Whether the pointer follows the outcome (item 13, B4b; POINTER (b)): while the question waited, after Don't enable,
 * "Enable all data sources" and either class answer; after the hold, after Enable (S156) and Don't enable (S157); in
 * each case only when the setting moved, so it never follows S113, S126, S158 or a cookie-full outcome.
 */
export function pauseOutcomePointed(slot: Pick<PendingPause, 'decision' | 'moved' | 'afterHold'>): boolean {
  if (slot.moved === false || slot.decision === undefined) return false;
  if (slot.afterHold === true) return slot.decision === 'allow' || slot.decision === 'off';
  return slot.decision === 'off' || slot.decision === 'allow-all' || slot.decision === 'allow-class' || slot.decision === 'off-class';
}

/** How every scroll the question surface makes moves: at once when the reader asked for reduced motion. */
export function preferredScrollBehavior(): ScrollBehavior {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'smooth';
  }
}

/** The docked composer's bar (UX-2 P3b-1): sticky at the window's bottom from the send that starts a run. */
const DOCKED_BAR = '.composer--docked > .composer-bar';
/** Space kept between the prompt's bottom and the docked bar's top when the prompt is brought out from under it. */
const BAR_GAP = 12;

/**
 * The prompt's place in the viewport: nothing moves when all of it is visible between the sticky header and the
 * visible bottom; else it is brought in. The visible bottom is the window's, or, while the composer is docked (leg H:
 * from the send, so for the whole run), the docked bar's top, since the bar covers the window below it. A prompt that
 * is above the header is brought in by its own scroll (its top margin clears the header). A prompt whose lower part is
 * under the docked bar, or below the window, is brought up by a scroll of the window that puts its bottom just above
 * the bar: `scrollIntoView` would align it with the window's bottom, under the bar.
 */
function bringPromptIntoView(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const prompt = document.querySelector?.('[data-part="consent-pause-prompt"]');
  if (!prompt) return;
  const box = prompt.getBoundingClientRect?.();
  const header = document.querySelector?.('header')?.getBoundingClientRect?.();
  const top = header && header.bottom > 0 ? header.bottom : 0;
  const bar = document.querySelector?.(DOCKED_BAR)?.getBoundingClientRect?.();
  const bottom = bar && bar.top > top && bar.top < window.innerHeight ? bar.top : window.innerHeight;
  if (box && box.top >= top && box.bottom <= bottom) return;
  if (box && bottom < window.innerHeight && box.top >= top && typeof window.scrollBy === 'function') {
    // Under the docked bar, or below the window: up by as much as clears the bar, and never past the header.
    const clear = box.bottom - bottom + BAR_GAP;
    const room = box.top - top - BAR_GAP;
    window.scrollBy({ top: Math.max(0, Math.min(clear, room)), behavior: preferredScrollBehavior() });
    return;
  }
  prompt.scrollIntoView({ block: 'nearest', behavior: preferredScrollBehavior() });
}

const CARD: CSSProperties = {
  border: '1px solid var(--accent)',
  borderRadius: '6px',
  padding: '10px 14px',
  margin: '8px 0',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
  backgroundColor: 'var(--card-background)',
};

const BUTTON: CSSProperties = {
  flex: '1 1 0',
  minWidth: '120px',
  padding: '8px 14px',
  fontSize: '14px',
  fontWeight: 600,
  borderRadius: '6px',
  border: '1px solid var(--accent)',
  backgroundColor: 'var(--white)',
  color: 'var(--accent)',
  cursor: 'pointer',
};

/** While the prompt asks (UX-2 HG): the steps' own frame (`AnswerView`'s step rows), not the accent frame that marks where to answer. */
const STEP_FRAME: CSSProperties = { ...CARD, border: '1px solid var(--border-color)' };

const PROMPT: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px 12px',
  border: '1px solid var(--accent)',
  borderRadius: '6px',
  padding: '8px 12px',
  margin: '0 0 12px',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
  backgroundColor: 'var(--card-background)',
  // A scroll that brings the prompt in stops below the sticky site header (64-65 px, measured).
  scrollMarginTop: '80px',
};

const PROMPT_BUTTON: CSSProperties = { ...BUTTON, flex: '0 0 auto', minWidth: '96px', padding: '6px 12px', fontSize: '13px' };

/**
 * "Allow all data sources" (ASK2 = B, M5): below the pair and the full width
 * of the card, and lighter than the pair (a neutral border and a regular
 * weight against the pair's accent border and 600), never filled.
 */
const ALL_BUTTON: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 14px',
  fontSize: '14px',
  fontWeight: 400,
  borderRadius: '6px',
  border: '1px solid var(--border-color)',
  backgroundColor: 'var(--white)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};
const PROMPT_ALL_BUTTON: CSSProperties = { ...ALL_BUTTON, padding: '6px 12px', fontSize: '13px' };

/**
 * The class answers above twelve (C3 = A): S12 and S13 under the pair, in the third button's lighter style, equal in
 * size, side by side where the width allows and stacked, each the full width, where it does not.
 */
const CLASS_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' };
const CLASS_BUTTON: CSSProperties = { ...ALL_BUTTON, display: 'inline-block', flex: '1 1 240px', width: 'auto' };
const PROMPT_CLASS_BUTTON: CSSProperties = { ...CLASS_BUTTON, padding: '6px 12px', fontSize: '13px' };

/** The choices sentence for the pause's scope: S98 at twelve or fewer, S14 for a class above twelve, S79 for a source alone. */
function choicesFor(scope: PauseScope): string {
  if (scope.kind === 'all') return CONSENT_STEP_TEXT.choices;
  if (scope.kind === 'class') return CONSENT_STEP_TEXT.choicesClass(scope.n, scope.phrase);
  return CONSENT_STEP_TEXT.choicesAlone;
}

/**
 * The heading (C3-D-H B): S146 while the hold is open and unanswered, S147 in every closed state, the source's name the
 * only bold run. The group around it is named by the same words without the bold (`CONSENT_STEP_TEXT.heading`).
 */
function Heading({ name, waiting, style }: { name: string; waiting: boolean; style: CSSProperties }) {
  const parts = waiting ? CONSENT_STEP_TEXT.waiting : CONSENT_STEP_TEXT.closed;
  return (
    <p data-part="consent-heading" style={style}>
      {parts.before}
      <strong style={{ fontWeight: 600 }}>{name}</strong>
      {parts.after}
    </p>
  );
}

/**
 * The wider answers while the pause asks (G0-4 = A, C3 = A, C3-ALL = A): "Enable all data sources" (S96) at twelve or
 * fewer, full width; S12 and S13 for a class above twelve; none for a source alone above twelve.
 */
function WiderAnswers({ scope, disabled, onAnswer, compact }: { scope: PauseScope; disabled: boolean; onAnswer: (answer: PauseAnswer) => void; compact: boolean }) {
  if (scope.kind === 'all') {
    return (
      <button type="button" style={compact ? PROMPT_ALL_BUTTON : { ...ALL_BUTTON, margin: '0 0 10px' }} disabled={disabled} onClick={() => onAnswer('allow-all')}>
        {ALLOW_ALL_SOURCES}
      </button>
    );
  }
  if (scope.kind === 'class') {
    const button = compact ? PROMPT_CLASS_BUTTON : CLASS_BUTTON;
    return (
      <div data-part="consent-class-answers" style={compact ? CLASS_ROW : { ...CLASS_ROW, margin: '0 0 10px' }}>
        <button type="button" style={button} disabled={disabled} onClick={() => onAnswer('allow-class')}>
          {CONSENT_STEP_TEXT.enableClass(scope.n, scope.phrase)}
        </button>
        <button type="button" style={button} disabled={disabled} onClick={() => onAnswer('off-class')}>
          {CONSENT_STEP_TEXT.dontEnableClass(scope.n)}
        </button>
      </div>
    );
  }
  return null;
}

/**
 * The pause's wider answers depend on how many sources are configured and on the asking source's group (S4 W2b), which
 * the page's statement says. A page whose consent was not read yet reads it once, as a surface that loads does; until
 * then, and if it cannot be read, no wider answer is offered (`pauseScope`).
 */
function useConfiguredSources(consent: { loaded: boolean; refresh: () => Promise<void> }): void {
  const { loaded, refresh } = consent;
  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
}

/** A closed disclosure (C3-D = C; design principle 8), in the style of a Settings row's drawer. */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details style={{ margin: '4px 0 0' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>{summary}</summary>
      {children}
    </details>
  );
}

/** "You can change this in Data source settings…", the pointer's link a client-side one (the page beneath stays mounted). */
function Pointer({ sentence }: { sentence: string }) {
  const at = sentence.indexOf(SETTINGS_TEXT.link);
  if (at === -1) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <Link href={SETTINGS_HREF}>{SETTINGS_TEXT.link}</Link>
      {sentence.slice(at + SETTINGS_TEXT.link.length)}
    </>
  );
}

/**
 * The compact prompt (R9 P1, #672): while a hold is open and unanswered, the
 * card's heading, what each choice sends, that the choice can be changed (with
 * its link to Data source settings), and the page's only answer buttons, posting
 * with the pause's own key. Nothing once the hold ends, an answer is given,
 * or no pause is open. Brought into view once per pause, only if it is not.
 */
export function ConsentPausePrompt() {
  const consent = useSourceConsent({ load: false });
  useConfiguredSources(consent);
  const open = promptPause(consent.pauses);
  const key = open?.[0];
  const entry = open?.[1];
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (key === undefined || scrolled.current === key) return;
    // After the prompt has rendered, as the results scroll waits for the loading state (QuerySurface).
    const timer = setTimeout(() => {
      scrolled.current = key;
      bringPromptIntoView();
    }, 100);
    return () => clearTimeout(timer);
  }, [key]);
  if (key === undefined || entry === undefined) return null;
  const name = readerSourceName(entry.payload.source);
  const scope = pauseScope(consent.statement?.sources, entry.payload.source.sourceId);
  // The prompt shows only while the hold is open and unanswered, so it always heads with S146 (C3-D-H B).
  return (
    <div data-part="consent-pause-prompt" role="group" aria-label={CONSENT_STEP_TEXT.heading(name, true)} style={PROMPT}>
      <div style={{ margin: 0, flex: '1 1 260px' }}>
        <Heading name={name} waiting style={{ margin: 0, color: 'var(--text-primary)' }} />
        {/* C3-D = C: a short line in view, and what each answer does behind a closed disclosure. */}
        <p style={{ margin: '2px 0 0' }}>{CONSENT_STEP_TEXT.short}</p>
        <Disclosure summary={CONSENT_STEP_TEXT.whatEachAnswerDoes}>
          <p style={{ margin: '2px 0 0' }}>{choicesFor(scope)}</p>
        </Disclosure>
        <p style={{ margin: '2px 0 0' }}><Pointer sentence={CONSENT_STEP_TEXT.change} /></p>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" style={PROMPT_BUTTON} disabled={entry.deciding} onClick={() => { void decideConsentPause(key, 'allow'); }}>
          {CONSENT_STEP_TEXT.enable}
        </button>
        <button type="button" style={PROMPT_BUTTON} disabled={entry.deciding} onClick={() => { void decideConsentPause(key, 'off'); }}>
          {CONSENT_STEP_TEXT.dontEnable}
        </button>
      </div>
      <WiderAnswers scope={scope} compact disabled={entry.deciding} onAnswer={(answer) => { void decideConsentPause(key, answer); }} />
    </div>
  );
}

export default function ConsentStep({ pause, runMovedOn = false, place = 'steps' }: {
  pause: ConsentPausePayload;
  /** The run has moved past this step (the step's `isComplete`): the words change, never the buttons (note 4). */
  runMovedOn?: boolean;
  /** Where the card sits: the run's steps, or a Sources panel row. */
  place?: 'steps' | 'row';
}) {
  const consent = useSourceConsent({ load: false });
  useConfiguredSources(consent);
  // This card's own entry on the bus, by its key: a later pause in the run never takes its answer (fix round 2, item 1).
  const slot = pauseEntry(consent.pauses, pause.key);
  const source = pause.source;
  const name = readerSourceName(source);
  const lines = sourceRowLines(source);
  // LocalOnlyOffer reads the statement's links alone.
  const linksOnly: FlowsStatement = { version: '', date: '', recipients: [], sources: [], links: pause.links };

  const answered = slot?.decision !== undefined || slot?.failure !== undefined;
  const afterHold = slot?.afterHold === true;
  // The prompt asks about this pause (UX-2 HG): it holds the answers, and the card in the steps states the step.
  const promptHolds = place === 'steps' && pause.key !== undefined && promptPause(consent.pauses)?.[0] === pause.key;
  // The hold is over: the bus says so, or the run has moved past this step; never while the prompt asks about it.
  const holdEnded = !promptHolds && pause.holds && (runMovedOn || slot?.holdEnded === true);
  const expired = slot?.expired === true;
  // The run's step has closed while the prompt still asks (W4 = b): the card reads as a cancelled card reads.
  const runEnded = promptHolds && runMovedOn;
  // An answer given while the run waited reads as it always has.
  const answeredInHold = answered && !afterHold;
  const accounts = consent.status?.accounts === true;
  const outcome = runEnded
    ? CONSENT_STEP_TEXT.gone
    : slot?.decision !== undefined
      ? pauseOutcome(slot, accounts)
      : slot?.failure === 'gone'
        ? CONSENT_STEP_TEXT.gone
        : slot?.failure === 'decided'
          ? CONSENT_STEP_TEXT.decided
          : slot?.failure === 'other'
            ? CONSENT_STEP_TEXT.failed
            : pause.holds && expired
              ? CONSENT_STEP_TEXT.gone
              : null;
  // Item 13, B4b and POINTER (b): the pointer follows an outcome whose setting moved (`pauseOutcomePointed`).
  const pointed = !runEnded && slot !== null && pauseOutcomePointed(slot);
  // The buttons stay while the entry takes an answer. With no entry on the bus (none was reported to this
  // page), the run's own state is all the card has, and they go with the hold, as before R9.
  const waiting = pause.holds && pause.key !== undefined && !answered && !expired && (slot !== null || !holdEnded);
  // C3-D-H B: S146 only while the hold is open and unanswered; S147 in every closed state.
  const headingWaits = pause.holds && !runEnded && !holdEnded && !expired && !answered;
  const scope = pauseScope(consent.statement?.sources, source.sourceId);
  const key = pause.key;

  return (
    <div data-part="consent-step" data-consent-source={source.sourceId} data-consent-place={place} role="group" aria-label={CONSENT_STEP_TEXT.heading(name, headingWaits)} style={promptHolds ? STEP_FRAME : CARD}>
      <Heading name={name} waiting={headingWaits} style={{ margin: '0 0 4px', color: 'var(--text-primary)' }} />
      {!pause.holds && <p style={{ margin: '0 0 6px' }}>{CONSENT_STEP_TEXT.cannotAsk}</p>}
      {pause.holds && holdEnded && !answeredInHold && <p data-part="consent-hold-ended" style={{ margin: '0 0 6px' }}>{CONSENT_STEP_TEXT.ended}</p>}
      {!pause.holds && <p style={{ margin: '0 0 6px' }}>{CONSENT_STEP_TEXT.nextQuestion}</p>}
      {promptHolds && !runEnded && <p style={{ margin: '0 0 6px' }}>{CONSENT_STEP_TEXT.wait}</p>}
      {waiting && key !== undefined && !promptHolds && (
        <>
          {holdEnded ? (
            <>
              <p style={{ margin: '0' }}>{CONSENT_STEP_TEXT.stillAnswer}</p>
              <p style={{ margin: '2px 0 0' }}>{CONSENT_STEP_TEXT.afterChoices}</p>
            </>
          ) : (
            <p style={{ margin: '0' }}>{choicesFor(scope)}</p>
          )}
          <p style={{ margin: '2px 0 0' }}><Pointer sentence={CONSENT_STEP_TEXT.change} /></p>
          {!holdEnded && <p style={{ margin: '2px 0 0' }}>{CONSENT_STEP_TEXT.wait}</p>}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '8px 0 8px' }}>
            <button type="button" style={BUTTON} disabled={slot?.deciding === true} onClick={() => { void decideConsentPause(key, 'allow'); }}>
              {CONSENT_STEP_TEXT.enable}
            </button>
            <button type="button" style={BUTTON} disabled={slot?.deciding === true} onClick={() => { void decideConsentPause(key, 'off'); }}>
              {CONSENT_STEP_TEXT.dontEnable}
            </button>
          </div>
          {/* While the pause asks only (ruled W2): after the hold the run has moved on, and there is no class answer (C3). */}
          {!holdEnded && <WiderAnswers scope={scope} compact={false} disabled={slot?.deciding === true} onAnswer={(answer) => { void decideConsentPause(key, answer); }} />}
        </>
      )}
      {/* C3-D = C: the source's facts behind one closed disclosure, S103. In a Settings or picker row the row's own
          "More about this source" holds them, so the row's card carries none (fix round 1, 7239440759). */}
      {place !== 'row' && <Disclosure summary={PANEL_ROW_MORE}>
        {lines.what !== null && <div>{lines.what.charAt(0).toUpperCase() + lines.what.slice(1)}</div>}
        <div>
          {lines.reach.map((part, i) =>
            typeof part === 'string' ? (
              part
            ) : (
              <a key={i} href={part.link} target="_blank" rel="noopener noreferrer">
                {part.text}
              </a>
            ),
          )}
        </div>
        <div>
          Who holds its logs: <KeptByLines keptBy={source.recipients.flatMap((r) => r.keptBy)} retention />.
        </div>
        {/* An addressed source's address is the "running at" line above; this line names only the hosts beyond it. */}
        {pause.outbound.length > 0 && <div>{CONSENT_STEP_TEXT.reach(pause.outbound)}</div>}
        <div>
          <a href={pause.links.privacy}>{PANEL_PRIVACY_LINK}</a>
        </div>
        <div>
          <LocalOnlyOffer statement={linksOnly} />
        </div>
      </Disclosure>}
      {outcome !== null && (
        <p data-part="consent-outcome" style={{ margin: '6px 0 0', fontWeight: 600, color: 'var(--text-primary)' }}>
          {outcome}
          {/* Item 13: the one pointer, since `change` renders only while the card waits. */}
          {pointed ? <> <Pointer sentence={CONSENT_STEP_TEXT.pointer} /></> : null}
        </p>
      )}
    </div>
  );
}
