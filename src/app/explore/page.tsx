import McpFlowDiagramWrapper from '@/components/explore/McpFlowDiagramWrapper';

export const metadata = {
  title: 'Explore | Civic AI Tools',
  description: 'Watch MCP queries flow through the system in real time. Replay example traces or run your own live query against civic data.',
};

export default function ExplorePage() {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ marginBottom: '8px' }}>Explore the MCP Query Flow</h1>
      <p style={{
        fontSize: '16px',
        lineHeight: '150%',
        color: 'var(--text-secondary)',
        marginBottom: '24px',
      }}>
        Watch how AI connects to live civic data through MCP. Replay example traces
        or run your own query to see the process in real time.
      </p>

      <McpFlowDiagramWrapper />
    </div>
  );
}
