/**
 * What a record can disclose about the composed skill prompt (#411, D3).
 *
 * WHY THIS IS A FUNCTION AND NOT TWO CONDITIONS IN A PAGE. The record detail
 * page decides twice whether to render `SkillSection` — once for the datHere
 * layout ("B · System prompts") and once for the legacy one ("Skill
 * Guidance") — and both decisions were the same expression written out
 * longhand. Wave N11 P4 removed the producer that fills the field
 * (`api/compare-stream/route.ts` no longer writes the whole composed prompt
 * onto the `skill_fetch` span, per ruling D3), so what those two conditions
 * answer changed for every record published after it. A condition that lives
 * in a page cannot be driven by a test, and "the section quietly disappears"
 * is exactly the kind of reader-facing consequence a span-level assertion
 * cannot see. It lives here so a package built by this repository can be run
 * through the page's own decision.
 *
 * WHAT THE FOUR STATES MEAN, and what a reader gets in each:
 *
 *   - `inline` — the package carries the composed prompt verbatim. The
 *     section renders it. Only records published BEFORE P4 reach this state
 *     from this repository's own publish flow; their bytes are signed and
 *     unchanged, so they keep it.
 *   - `blob`  — the package carries a `BlobRef` to it. The section renders
 *     the reference and fetches the bytes on demand.
 *   - `hash-only` — no text, but `systemPromptHash` identifies the prompt
 *     that was used. This is what a record published after P4 carries. The
 *     hash is still disclosed to the reader by `ProvenanceChain`, under
 *     "Skill guidance"; the section itself has nothing to render and renders
 *     nothing, rather than a heading over an empty body.
 *   - `none` — the package records neither. Absence stated as absence.
 *
 * The hash travels on the first three states as well, so a caller that wants
 * to show it never has to reach back into `skillMetadata` for it.
 */
import { isBlobRef, type BlobRef } from './blob-ref.ts';

/** The `skillMetadata` fields this reads; any richer package fits. */
export interface SkillDisclosureInput {
  skillText?: string | BlobRef;
  systemPromptHash?: string;
}

export type SkillDisclosure =
  | { kind: 'inline'; text: string; hash?: string }
  | { kind: 'blob'; ref: BlobRef; hash?: string }
  | { kind: 'hash-only'; hash: string }
  | { kind: 'none' };

export function describeSkillDisclosure(
  skillMetadata: SkillDisclosureInput | undefined,
): SkillDisclosure {
  const hash = skillMetadata?.systemPromptHash || undefined;
  const skillText = skillMetadata?.skillText;
  if (isBlobRef(skillText)) return { kind: 'blob', ref: skillText, hash };
  // An empty string is not a prompt. It reached the same place a missing one
  // did before this function existed (both are falsy), and it still does.
  if (typeof skillText === 'string' && skillText.length > 0) {
    return { kind: 'inline', text: skillText, hash };
  }
  return hash ? { kind: 'hash-only', hash } : { kind: 'none' };
}

/**
 * Whether the record carries prompt text for `SkillSection` to render. The
 * page's two render sites ask this and nothing else, so they cannot answer it
 * differently from each other or from the test that drives it.
 */
export function carriesSkillText(disclosure: SkillDisclosure): boolean {
  return disclosure.kind === 'inline' || disclosure.kind === 'blob';
}
