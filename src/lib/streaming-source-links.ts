/**
 * UX-2 P6 + P10 (#729; contract p6p10.md item 27, 0d item 7): where the site links the three narration functions'
 * source. One commit permalink and one anchor per function, read by `/learn` and by the narration explainer, so the
 * two never part. A link at a commit lands on the lines it names forever; `blob/main` drifts as `streaming.ts` moves.
 *
 * Checked by hand, not in CI (CI's checkout is shallow, `ci.yml:29`): at `08dfa4c` each anchor's first line declares its
 * function (`formatToolProgress` :585, `formatToolResult` :950, `generateToolReason` :1000).
 */
export const STREAMING_SOURCE_BASE = 'https://github.com/npstorey/civic-ai-tools-website/blob/08dfa4c/src/lib/streaming.ts';

export const STREAMING_SOURCE_LINES = {
  formatToolProgress: '#L585-L623',
  formatToolResult: '#L950-L993',
  generateToolReason: '#L1000-L1035',
} as const;

export type NarrationFunction = keyof typeof STREAMING_SOURCE_LINES;

/** The permalink to one function's lines. */
export const streamingSourceLink = (name: NarrationFunction): string => `${STREAMING_SOURCE_BASE}${STREAMING_SOURCE_LINES[name]}`;
