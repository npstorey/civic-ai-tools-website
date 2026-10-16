/**
 * The dispatch rule's refusal (#599 W3; design §6 as confirmed by D6, plus the
 * rule D6 added).
 *
 * Since W3 the model is offered every tool as `<alias>__<upstream name>`. A
 * model can still call a bare upstream name: one it read in a tool result
 * (the hosted Socrata server's results name `get_data` and `search` in prose,
 * and the app does not rewrite tool results), or one at a position the
 * guidance rewrite does not reach. The rule (ADR-0032): a bare name is
 * accepted when exactly one offered source has it, and refused, naming every
 * aliased form, when two or more do. This class is that refusal. It is thrown
 * by the registry's dispatch (`routeToolCall` in `./registry.ts`) before any
 * request is made, so no source saw the call.
 *
 * How it reaches each reader, and nothing else does (CLAUDE.md: never a raw
 * `err.message` in a streaming path):
 *
 *   - the model, through `describeToolFailureForLlm` (`../streaming.ts`), which
 *     recognises it by its marker, not its words, and names the aliased forms
 *     so the model can call one of them;
 *   - the reader, through `friendlyStreamError`: `code` is `generic`, which
 *     `classifyStreamError` returns before it reads any message;
 *   - the record, as `failureKind: 'unknown'` (the loop's `toolFailureKindOf`):
 *     the call was made and returned no data, which is true, and the closed
 *     vocabulary has no more specific kind for it.
 *
 * Pure and dependency-free, like `./tool-call-failure.ts`: `streaming.ts`
 * imports it and reaches client bundles.
 */

/** The marker `describeToolFailureForLlm` reads, so it does not depend on
 *  there being one instance of this module. */
export const AMBIGUOUS_TOOL_NAME = 'ambiguous-tool-name' as const;

export class AmbiguousToolNameError extends Error {
  readonly toolNameRefusal = AMBIGUOUS_TOOL_NAME;
  /** Read by `classifyStreamError` before any message: `generic`, so the loop
   *  records `unknown` and the reader gets the generic copy. */
  readonly code = 'generic';
  /** The bare name the model called. */
  readonly calledName: string;
  /** The aliased forms it could have meant, each a name the model can call. */
  readonly candidates: readonly string[];

  constructor(calledName: string, candidates: readonly string[]) {
    super(
      `Tool "${calledName}" is offered by more than one source, so the call was not sent; ` +
        `call it by its full name: ${candidates.map((c) => `"${c}"`).join(' or ')}.`,
    );
    this.name = 'AmbiguousToolNameError';
    this.calledName = calledName;
    this.candidates = [...candidates];
  }
}

/** The refusal, when `error` is one: read by its marker, never its words. */
export function ambiguousToolNameOf(error: unknown): { calledName: string; candidates: readonly string[] } | null {
  if (error === null || typeof error !== 'object') return null;
  const marked = error as { toolNameRefusal?: unknown; calledName?: unknown; candidates?: unknown };
  if (marked.toolNameRefusal !== AMBIGUOUS_TOOL_NAME) return null;
  if (typeof marked.calledName !== 'string' || !Array.isArray(marked.candidates)) return null;
  return { calledName: marked.calledName, candidates: marked.candidates.filter((c): c is string => typeof c === 'string') };
}
