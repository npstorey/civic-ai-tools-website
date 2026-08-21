/**
 * Dev-only preview surface for the Phase 2a notebook UI.
 *
 * Routes:
 *   /dev/notebook-preview            → renderer with the sample executed notebook
 *   /dev/notebook-preview?state=A    → progress UI stuck on phase A
 *   /dev/notebook-preview?state=B    → phase B
 *   /dev/notebook-preview?state=C    → phase C
 *   /dev/notebook-preview?state=D    → phase D
 *   /dev/notebook-preview?state=error → error state
 *
 * Server entry — `buildSampleExecutedNotebook` reads helper .py files via
 * `node:fs`, so the fixture is generated server-side and handed to a
 * client wrapper.
 *
 * Not linked from anywhere; reachable only by direct URL. Gated explicitly
 * below via `notFound()` when `NODE_ENV === 'production'` (civic-ai-tools#155
 * P1 E15) — route placement under `/dev/*` gates nothing on its own: there is
 * no `middleware.ts` in this repo and `next.config.ts` has no `/dev`
 * handling, and this page opts into dynamic rendering (`force-dynamic`
 * below), so absent this check it is a live, reachable production route.
 */
import { notFound } from 'next/navigation';
import { buildSampleExecutedNotebook } from '@/components/notebook/__dev__/sampleExecutedNotebook';
import NotebookPreviewClient from './NotebookPreviewClient';
import { isNotebookPreviewGated } from './gate';

// Opt out of static prerendering — the client component reads `?state=` via
// `useSearchParams`, which requires a dynamic page or a Suspense boundary.
// Dev-only route, so the perf hit of dynamic rendering is irrelevant.
export const dynamic = 'force-dynamic';

export default function NotebookPreviewPage() {
  if (isNotebookPreviewGated()) {
    notFound();
  }
  const { notebook, validation } = buildSampleExecutedNotebook();
  return <NotebookPreviewClient notebook={notebook} validation={validation} />;
}
