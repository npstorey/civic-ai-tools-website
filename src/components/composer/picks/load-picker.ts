'use client';

/**
 * The picker's code, loaded on its own (S3-B W1; the ORCH's A1; contract task 3 and fix round 1, item 2):
 * `PickerPanel` is a separate chunk, so the first page's code carries only this loader. The load starts when the panel
 * first opens (`LoadedPickerPanel` mounts only then: the option chosen, "Change", or the option re-chosen), and never
 * before, so a reader who never picks never fetches it. The router the search reads is in the first page's code
 * already (`src/lib/streaming.ts` imports it), so it adds nothing here.
 */

import { createElement, useEffect, useSyncExternalStore, type ComponentType } from 'react';

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

/** The picker's panel: rendered by the mount only while the panel is open, it starts the load on its first open and
 *  shows the panel once the code has arrived. */
export function LoadedPickerPanel({ docked }: { docked: boolean }) {
  const Loaded = usePickerPanel();
  useEffect(() => {
    void loadPicker();
  }, []);
  return Loaded ? createElement(Loaded, { docked }) : null;
}
