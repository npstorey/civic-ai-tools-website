/**
 * The two root-span attributes a format run writes (OF2, OF3a; website #810), by name only. Defined here, with no
 * import, so a client component can read a run's trace for them (`map-part.ts`) without loading the trace builder the
 * harness exports through `src/lib/evidence/trace.ts`, which re-exports both and documents what each holds.
 */

/** The format a run was asked for: JSON `{ id, version }` (OF2). */
export const OUTPUT_FORMAT_ATTRIBUTE = 'analysis.output_format';
/** What a map-format run presented: JSON `{ outcome, counts?, map? }` (OF3a). */
export const OUTPUT_FORMAT_RESULT_ATTRIBUTE = 'analysis.output_format_result';

/** The map format's step: its tool name and operation type (S7), the site's own, never a source's. */
export const PRESENT_STEP_NAME = 'present_result';
