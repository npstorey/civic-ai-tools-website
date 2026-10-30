import { SYSTEM_PROMPT_TEXT } from '@/lib/sources/copy';

/**
 * The prompts a model was given before the last one, by hash (R10 P1b, #694):
 * an in-loop run's prompt grows as the model loads sources, and its record
 * carries the last one. The count includes the last. Renders nothing for one
 * prompt. Section B renders it on a record (`SkillSection`) and on a run.
 * `textNotShown`: the caller's view shows no text of the last prompt, and the
 * sentence says so (fix round 1, S6).
 */
export default function PromptHistory({ earlierHashes, textNotShown = false }: {
  earlierHashes: readonly string[];
  textNotShown?: boolean;
}) {
  if (earlierHashes.length === 0) return null;
  const T = SYSTEM_PROMPT_TEXT;
  const sentence = `${T.manyPrompts(earlierHashes.length + 1)}${textNotShown ? ` ${T.textNotShown}` : ''} ${T.earlierByHash}`;
  return (
    <div data-part="system-prompt-history" style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      <p style={{ margin: '0 0 4px' }}>{sentence}</p>
      <ol style={{ margin: 0, paddingLeft: '20px' }}>
        {earlierHashes.map((hash) => (
          <li key={hash}>
            <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', wordBreak: 'break-all' }}>{hash}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}
