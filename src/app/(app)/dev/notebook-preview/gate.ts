// civic-ai-tools#155 P1 E15 (R5, owner-ruled at G0): `/dev/notebook-preview`
// is a live, reachable production route today — there is no `middleware.ts`
// in this repo, `next.config.ts` has no `/dev` handling, and the page opts
// into dynamic rendering. Gate it with `notFound()` unless NODE_ENV is not
// 'production'. No new env knob: NODE_ENV is Next.js's own existing signal.
//
// Extracted from page.tsx so the gate condition has a colocated test —
// page.tsx is JSX and this repo's test runner (`node --test
// --experimental-strip-types`) cannot import .tsx modules directly (Node's
// type-stripping does not transform JSX syntax).
export function isNotebookPreviewGated(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}
