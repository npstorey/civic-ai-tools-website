'use client';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ResponsePanelProps {
  title: string;
  subtitle: string;
  content: string;
  duration_ms?: number;
  tokens_used?: number;
  tools_called?: ToolCall[];
  isLoading?: boolean;
  variant: 'without-mcp' | 'with-mcp';
}

export default function ResponsePanel({
  title,
  subtitle,
  content,
  duration_ms,
  tokens_used,
  tools_called,
  isLoading,
  variant,
}: ResponsePanelProps) {
  const isMcp = variant === 'with-mcp';

  return (
    <div
      style={{
        border: `2px solid ${isMcp ? 'var(--nyc-success)' : 'var(--border-color)'}`,
        borderRadius: '4px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          backgroundColor: isMcp ? 'rgba(0, 183, 3, 0.1)' : 'var(--nyc-gray-90)',
          borderBottom: `1px solid ${isMcp ? 'var(--nyc-success)' : 'var(--border-color)'}`,
        }}
      >
        <h3
          style={{
            fontSize: '20px',
            fontWeight: 600,
            margin: 0,
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-muted)',
            margin: '4px 0 0 0',
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          padding: '24px',
          overflow: 'auto',
        }}
      >
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div
              style={{
                height: '16px',
                backgroundColor: 'var(--nyc-gray-80)',
                borderRadius: '4px',
                animation: 'pulse 2s infinite',
              }}
            />
            <div
              style={{
                height: '16px',
                backgroundColor: 'var(--nyc-gray-80)',
                borderRadius: '4px',
                width: '85%',
                animation: 'pulse 2s infinite',
              }}
            />
            <div
              style={{
                height: '16px',
                backgroundColor: 'var(--nyc-gray-80)',
                borderRadius: '4px',
                width: '70%',
                animation: 'pulse 2s infinite',
              }}
            />
          </div>
        ) : (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: '16px',
              lineHeight: '160%',
              color: 'var(--text-secondary)',
            }}
          >
            {content}
          </div>
        )}
      </div>

      {/* Footer with metadata */}
      {!isLoading && (duration_ms || tokens_used || tools_called) && (
        <div
          style={{
            borderTop: `1px solid ${isMcp ? 'var(--nyc-success)' : 'var(--border-color)'}`,
            padding: '16px 24px',
            backgroundColor: isMcp ? 'rgba(0, 183, 3, 0.05)' : 'var(--nyc-gray-90)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              fontSize: '14px',
              color: 'var(--text-muted)',
            }}
          >
            {duration_ms && (
              <span>
                <strong>Time:</strong> {(duration_ms / 1000).toFixed(2)}s
              </span>
            )}
            {tokens_used && (
              <span>
                <strong>Tokens:</strong> {tokens_used}
              </span>
            )}
          </div>

          {tools_called && tools_called.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h4
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  marginBottom: '8px',
                }}
              >
                MCP tools used:
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {tools_called.map((tool, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: 'rgba(0, 183, 3, 0.15)',
                      borderRadius: '4px',
                      padding: '8px 12px',
                    }}
                  >
                    <code
                      style={{
                        fontSize: '14px',
                        fontFamily: 'monospace',
                        color: 'var(--nyc-success)',
                        fontWeight: 600,
                      }}
                    >
                      {tool.name}
                    </code>
                    <div
                      style={{
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color: 'var(--text-muted)',
                        marginTop: '4px',
                        overflowX: 'auto',
                      }}
                    >
                      {JSON.stringify(tool.args, null, 2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
