'use client';

import { useState } from 'react';
import type { BlobRef } from '@/lib/evidence/blob-ref';
import { carriesSkillText, type SkillDisclosure } from '@/lib/evidence/skill-disclosure';
// R10 P1b (#694): a blob is fetched once and its bytes checked against the
// reference before any of them is rendered (the record page's own check for
// `output`, shared).
import { resolveBlobText } from '@/lib/evidence/blob-text';
import { SYSTEM_PROMPT_TEXT } from '@/lib/sources/copy';
import type { RecordInstructionsSection, RecordPromptComponent } from '@/components/answer-view/view-model';
import PromptHistory from './PromptHistory';

interface SkillSectionProps {
  /** The record's section B as its adapter built it (R10 P1b): the
   *  disclosure, the earlier prompts by hash, the composition's components.
   *  When given, it is what the section renders, and the three props below
   *  are not read. */
  section?: RecordInstructionsSection;
  /** Inline skill text from the package JSON. Mutually exclusive with
   *  `skillTextRef`. */
  skillText?: string;
  /** Blob reference pointing at the skill text. Fetched on first expand so
   *  the detail page doesn't pay the download cost up front for a section
   *  most viewers never open. */
  skillTextRef?: BlobRef;
  skillHash?: string;
}

interface FetchState {
  status: 'idle' | 'loading' | 'verified' | 'mismatch' | 'unavailable';
  text: string;
}

/** The disclosure the three props describe, for a caller that passes no `section`. */
function disclosureOfProps({ skillText, skillTextRef, skillHash }: SkillSectionProps): SkillDisclosure {
  if (skillTextRef !== undefined) return { kind: 'blob', ref: skillTextRef, hash: skillHash };
  if (skillText) return { kind: 'inline', text: skillText, hash: skillHash };
  return skillHash ? { kind: 'hash-only', hash: skillHash } : { kind: 'none' };
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', wordBreak: 'break-all' } as const;

/** P1b-e: a record that carries no text says so, with its hash and its composition's parts where it has them. */
function SkillTextNotCarried({ hash, components, earlier }: {
  hash: string | undefined;
  components: readonly RecordPromptComponent[];
  earlier: readonly string[];
}) {
  const T = SYSTEM_PROMPT_TEXT;
  return (
    <div data-part="system-prompt-not-carried" style={{
      padding: '16px 20px', border: '1px solid var(--border-color)', borderRadius: '6px',
    }}>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{T.notCarried}</p>
      {hash && (
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
          {T.hashLabel}: <code style={MONO}>{hash}</code>
        </p>
      )}
      {components.length > 0 && (
        <>
          <p style={{ margin: '12px 0 4px', fontSize: '13px', color: 'var(--text-secondary)' }}>{T.componentsIntro}</p>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {components.map((c, i) => (
              <li key={`${c.id}-${i}`}>
                <code style={MONO}>{c.id}</code>
                {c.version ? ` ${c.version}` : null}
                {c.guidanceHash ? <>{' · '}{T.guidanceHashLabel} <code style={MONO}>{c.guidanceHash}</code></> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      <PromptHistory earlierHashes={earlier} />
    </div>
  );
}

export default function SkillSection(props: SkillSectionProps) {
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<FetchState>({ status: 'idle', text: '' });

  const disclosure = props.section?.disclosure ?? disclosureOfProps(props);
  const earlier = props.section?.earlierPromptHashes ?? [];
  if (!carriesSkillText(disclosure)) {
    return (
      <SkillTextNotCarried
        hash={disclosure.kind === 'hash-only' ? disclosure.hash : undefined}
        components={props.section?.components ?? []}
        earlier={earlier}
      />
    );
  }
  const skillText = disclosure.kind === 'inline' ? disclosure.text : undefined;
  const skillTextRef = disclosure.kind === 'blob' ? disclosure.ref : undefined;
  const skillHash = disclosure.kind === 'inline' || disclosure.kind === 'blob' ? disclosure.hash : undefined;

  const usingRef = skillTextRef !== undefined;
  const resolvedText = usingRef ? (fetched.status === 'verified' ? fetched.text : '') : (skillText ?? '');
  const lineCount = resolvedText ? resolvedText.split('\n').length : 0;
  const charCount = usingRef ? skillTextRef.size : resolvedText.length;

  async function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && usingRef && fetched.status === 'idle') {
      setFetched({ status: 'loading', text: '' });
      // Never throws; a fetch failure and a hash mismatch each have their own sentence.
      const blob = await resolveBlobText(skillTextRef);
      setFetched(blob.state === 'verified' ? { status: 'verified', text: blob.text } : { status: blob.state, text: '' });
    }
  }

  const buttonLabel = open
    ? 'Hide skill guidance'
    : usingRef
      ? `View skill guidance (${charCount.toLocaleString()} bytes, stored as blob)`
      : `View skill guidance (${lineCount} lines, ${charCount.toLocaleString()} chars)`;

  return (
    <div style={{
      padding: '16px 20px', border: '1px solid var(--border-color)',
      borderRadius: '6px', backgroundColor: 'white',
    }}>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
        The exact skill guidance text sent to the model as the system prompt for this analysis.
        {skillHash ? ' This is the source of the skill hash recorded in the package.' : ''}
      </p>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: open ? '16px' : 0, flexWrap: 'wrap' }}>
        <button
          onClick={handleToggle}
          style={{
            background: 'none', border: '1px solid var(--accent)', borderRadius: '4px',
            padding: '6px 14px', fontSize: '13px', cursor: 'pointer',
            color: 'var(--accent)', fontWeight: 500,
          }}
        >
          {buttonLabel}
        </button>
        {usingRef && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {skillTextRef.ref.slice(0, 'blob:sha256:'.length + 12)}…
          </span>
        )}
      </div>

      {open && (
        <>
          {usingRef && fetched.status === 'loading' && (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Fetching skill content…
            </div>
          )}
          {usingRef && (fetched.status === 'unavailable' || fetched.status === 'mismatch') && (
            <div style={{ fontSize: '13px', color: 'var(--error)' }}>
              {fetched.status === 'mismatch' ? SYSTEM_PROMPT_TEXT.mismatch : SYSTEM_PROMPT_TEXT.unavailable}
            </div>
          )}
          {(!usingRef || fetched.status === 'verified') && (
            <pre style={{
              padding: '12px 14px', backgroundColor: '#f5f5f5', borderRadius: '4px',
              fontSize: '12px', lineHeight: 1.5, overflow: 'auto', maxHeight: '500px',
              whiteSpace: 'pre-wrap', margin: 0,
            }}>
              {resolvedText}
            </pre>
          )}
        </>
      )}
      {earlier.length > 0 && <PromptHistory earlierHashes={earlier} />}
    </div>
  );
}
