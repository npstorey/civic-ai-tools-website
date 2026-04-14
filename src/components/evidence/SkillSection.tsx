'use client';

import { useState } from 'react';

interface SkillSectionProps {
  skillText: string;
  skillHash?: string;
}

export default function SkillSection({ skillText, skillHash }: SkillSectionProps) {
  const [open, setOpen] = useState(false);

  const lineCount = skillText.split('\n').length;
  const charCount = skillText.length;

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
          onClick={() => setOpen(!open)}
          style={{
            background: 'none', border: '1px solid var(--nyc-blue)', borderRadius: '4px',
            padding: '6px 14px', fontSize: '13px', cursor: 'pointer',
            color: 'var(--nyc-blue)', fontWeight: 500,
          }}
        >
          {open ? 'Hide skill guidance' : `View skill guidance (${lineCount} lines, ${charCount.toLocaleString()} chars)`}
        </button>
      </div>

      {open && (
        <pre style={{
          padding: '12px 14px', backgroundColor: '#f5f5f5', borderRadius: '4px',
          fontSize: '12px', lineHeight: 1.5, overflow: 'auto', maxHeight: '500px',
          whiteSpace: 'pre-wrap', margin: 0,
        }}>
          {skillText}
        </pre>
      )}
    </div>
  );
}
