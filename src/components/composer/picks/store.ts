'use client';

/**
 * The reader's picks for the next question (S3-B W1, npstorey/civic-ai-tools#318; G0-2 = A, R3): held in the page's
 * memory only. No cookie, no browser storage, no server state: a reload starts at Auto with nothing picked. The picks
 * stay for the page's next question until the reader changes them, and the line under the box names them before
 * each send (S7).
 *
 *   mode     `auto` ("Auto - …") or `pick` ("Only the ones I pick"), as the harness menu's Data sources item reads.
 *   picked   the picked source ids, in the order picked; a mount names them in the statement's order.
 *   open     the picker's panel is shown (D1 = B).
 *   query    the panel's search field.
 *   refused  the last send was held because nothing was picked: S9's after-send form shows (D4 = B).
 *
 * Choosing Auto keeps the picks in memory, so choosing "Only the ones I pick" again brings them back (A16). A picked
 * source set to Off loses its pick (B10): `dropPicks`, called by the mount that reads the states.
 */

import { useSyncExternalStore } from 'react';

export interface PicksState {
  mode: 'auto' | 'pick';
  picked: readonly string[];
  open: boolean;
  query: string;
  refused: boolean;
}

const INITIAL: PicksState = { mode: 'auto', picked: [], open: false, query: '', refused: false };

let state: PicksState = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<PicksState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPicks(): PicksState {
  return state;
}

export function usePicks(): PicksState {
  return useSyncExternalStore(subscribe, getPicks, () => INITIAL);
}

/** "Only the ones I pick" chosen, whether or not it already was: the panel opens (R6). */
export function choosePicking(): void {
  set({ mode: 'pick', open: true, refused: false });
}

/** "Auto" chosen: the panel closes; the picks stay in memory (A16). */
export function chooseAuto(): void {
  set({ mode: 'auto', open: false, refused: false });
}

/** "Change" (S8): the panel opens again. */
export function openPicker(): void {
  set({ open: true });
}

/** The panel's × "Close", Escape, or a send (R4): the panel closes; nothing else changes. */
export function closePicker(): void {
  if (state.open) set({ open: false });
}

export function setPickerQuery(query: string): void {
  set({ query });
}

export function togglePick(sourceId: string): void {
  const picked = state.picked.includes(sourceId) ? state.picked.filter((id) => id !== sourceId) : [...state.picked, sourceId];
  set({ picked, refused: false });
}

/** Picked sources that are now Off lose their pick (B10). A no-op when none of `ids` is picked. */
export function dropPicks(ids: readonly string[]): void {
  if (!ids.some((id) => state.picked.includes(id))) return;
  set({ picked: state.picked.filter((id) => !ids.includes(id)) });
}

/** A send with "Only the ones I pick" chosen and nothing picked: held, and S9 says so (D4 = B). */
export function markRefused(refused: boolean): void {
  if (state.refused !== refused) set({ refused });
}

/** For tests: back to a fresh page. */
export function resetPicksForTests(): void {
  state = INITIAL;
  for (const listener of listeners) listener();
}
