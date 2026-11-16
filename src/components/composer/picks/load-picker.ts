'use client';

/**
 * The picker's code, loaded on its own (S3-B W1; the ORCH's A1): `PickerPanel` is a separate chunk, so the first
 * page's code carries only this loader and the call that starts it. The mount starts the load once it knows the site
 * offers picking (the routing read says in loop, with the decision store), before the reader opens the panel, so the
 * panel's open sends no request of its own. The router the search reads is in the first page's code already
 * (`src/lib/streaming.ts` imports it), so it adds nothing here.
 */

import { createElement, useSyncExternalStore, type ComponentType } from 'react';

type Panel = ComponentType<{ docked: boolean }>;

let panel: Panel | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Start loading the picker's code, once; a later call does nothing. */
export function loadPicker(): Promise<void> {
  loading ??= import('./PickerPanel').then((module) => {
    panel = module.default;
    for (const listener of listeners) listener();
  });
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The picker's component once loaded; null until then. */
export function usePickerPanel(): Panel | null {
  return useSyncExternalStore(subscribe, () => panel, () => null);
}

/** The picker's panel, once its code has loaded; nothing until then. One component the mount renders. */
export function LoadedPickerPanel({ docked }: { docked: boolean }) {
  const Loaded = usePickerPanel();
  return Loaded ? createElement(Loaded, { docked }) : null;
}
