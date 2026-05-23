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
 * Not linked from anywhere; reachable only by direct URL. Excluded from
 * production by route placement under /dev/*.
 */
import { buildSampleExecutedNotebook } from '@/components/notebook/__dev__/sampleExecutedNotebook';
import NotebookPreviewClient from './NotebookPreviewClient';

export default function NotebookPreviewPage() {
  const { notebook, validation } = buildSampleExecutedNotebook();
  return <NotebookPreviewClient notebook={notebook} validation={validation} />;
}
