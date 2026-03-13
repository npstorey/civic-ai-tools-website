import type { CSSProperties } from 'react';

export const sectionHeading: CSSProperties = {
  marginBottom: '16px',
  marginTop: 0,
};

export const sectionSpacing: CSSProperties = {
  marginBottom: '64px',
};

export const prose: CSSProperties = {
  fontSize: '16px',
  lineHeight: '170%',
  color: 'var(--text-secondary)',
  marginBottom: '16px',
};

export const calloutBox: CSSProperties = {
  backgroundColor: 'rgba(112, 186, 255, 0.12)',
  border: '1px solid rgba(112, 186, 255, 0.3)',
  borderRadius: '4px',
  padding: '12px 16px',
  fontSize: '14px',
  color: 'var(--text-secondary)',
  lineHeight: '1.5',
};

export const excerptBlock: CSSProperties = {
  backgroundColor: 'var(--card-background)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '12px 16px',
  fontFamily: 'monospace',
  fontSize: '13px',
  lineHeight: '1.5',
  color: 'var(--text-secondary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: '8px 0 0 0',
  overflow: 'auto',
};

export const card: CSSProperties = {
  backgroundColor: 'var(--card-background)',
  borderRadius: '4px',
  padding: '24px',
  border: '1px solid var(--border-color)',
};
