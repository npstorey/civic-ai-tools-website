'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { BUILT_IN_INSTANCE_LAYOUTS, type InstanceLayouts } from '@/lib/answer-layout';

/**
 * Carries this instance's answer layouts (LAYOUT-WEB W4 P1), as the server
 * resolved its setting (`instanceAnswerLayouts()` in
 * src/lib/answer-layout/reading.ts), to every answer view.
 *
 * WHY A CONTEXT, AND WHY ITS OWN MODULE. The view renders inside client trees
 * on every surface (the comparison and the executed run on `/` and `/ask`, the
 * record page), so the root layout wraps every page in this provider, as it
 * wraps every page in `NotebookModeProvider`. It is a module of its own so the
 * root layout imports this file and not the view: every page's client bundle
 * then carries a context, not the answer view.
 *
 * Outside the provider it reads the built-ins: `answer-first` the default,
 * whose order is the order every surface rendered before layouts existed.
 * The home page is prerendered, so it follows the setting `next build` saw;
 * request-time pages follow the running server's (docs/deploy.md).
 */
const AnswerLayoutsContext = createContext<InstanceLayouts>(BUILT_IN_INSTANCE_LAYOUTS);

export function AnswerLayoutsProvider({ value, children }: { value: InstanceLayouts; children?: ReactNode }) {
  return <AnswerLayoutsContext.Provider value={value}>{children}</AnswerLayoutsContext.Provider>;
}

/** This instance's layouts. Safe outside the provider (the built-ins). */
export function useAnswerLayouts(): InstanceLayouts {
  return useContext(AnswerLayoutsContext);
}
