'use client';

import dynamic from 'next/dynamic';

const McpFlowDiagram = dynamic(
  () => import('./McpFlowDiagram'),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: '500px', background: 'var(--card-background)', borderRadius: '4px' }} />
    ),
  }
);

export default function McpFlowDiagramWrapper() {
  return <McpFlowDiagram />;
}
