'use client';

import ResponsePanel from './ResponsePanel';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ResponseData {
  content: string;
  duration_ms: number;
  tokens_used: number;
  tools_called?: ToolCall[];
}

interface ComparisonDisplayProps {
  withoutMcp: ResponseData | null;
  withMcp: ResponseData | null;
  isLoading: boolean;
}

export default function ComparisonDisplay({
  withoutMcp,
  withMcp,
  isLoading,
}: ComparisonDisplayProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '24px',
      }}
    >
      <ResponsePanel
        title="Without MCP"
        subtitle="LLM using only training data"
        content={withoutMcp?.content || ''}
        duration_ms={withoutMcp?.duration_ms}
        tokens_used={withoutMcp?.tokens_used}
        isLoading={isLoading}
        variant="without-mcp"
      />
      <ResponsePanel
        title="With MCP"
        subtitle="LLM + live Socrata data access"
        content={withMcp?.content || ''}
        duration_ms={withMcp?.duration_ms}
        tokens_used={withMcp?.tokens_used}
        tools_called={withMcp?.tools_called}
        isLoading={isLoading}
        variant="with-mcp"
      />
    </div>
  );
}
