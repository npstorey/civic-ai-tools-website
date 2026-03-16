import McpFlowDiagramWrapper from '@/components/explore/McpFlowDiagramWrapper';

export const metadata = {
  title: 'Data Flow | Civic AI Tools',
  description: 'Watch how AI connects to live civic data. Replay example traces or run your own query to see the process in real time.',
};

export default function ExplorePage() {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ marginBottom: '8px' }}>Data Flow</h1>
      <p style={{
        fontSize: '16px',
        lineHeight: '150%',
        color: 'var(--text-secondary)',
        marginBottom: '24px',
      }}>
        Watch how AI connects to live civic data. Replay example traces
        or run your own query to see the process in real time.
      </p>

      <McpFlowDiagramWrapper />
    </div>
  );
}
