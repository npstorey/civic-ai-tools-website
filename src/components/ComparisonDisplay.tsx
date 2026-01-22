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

interface ProgressLogEntry {
  message: string;
  timestamp: number;
  isComplete?: boolean;
}

interface StreamingPanelState {
  content: string;
  progress: string | null;
  progressLog: ProgressLogEntry[];
  isComplete: boolean;
  duration_ms?: number;
  tokens_used?: number;
  tools_called?: ToolCall[];
}

interface ComparisonDisplayProps {
  withoutMcp: ResponseData | null;
  withMcp: ResponseData | null;
  isLoading: boolean;
  modelName?: string;
  // Streaming props
  isStreaming?: boolean;
  streamingWithoutMcp?: StreamingPanelState;
  streamingWithMcp?: StreamingPanelState;
}

export default function ComparisonDisplay({
  withoutMcp,
  withMcp,
  isLoading,
  modelName = 'LLM',
  isStreaming,
  streamingWithoutMcp,
  streamingWithMcp,
}: ComparisonDisplayProps) {
  // Use streaming data if available, otherwise fall back to static data
  const withoutMcpContent = isStreaming && streamingWithoutMcp
    ? streamingWithoutMcp.content
    : withoutMcp?.content || '';
  const withMcpContent = isStreaming && streamingWithMcp
    ? streamingWithMcp.content
    : withMcp?.content || '';

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
        subtitle={`${modelName} using only training data`}
        content={withoutMcpContent}
        duration_ms={isStreaming ? streamingWithoutMcp?.duration_ms : withoutMcp?.duration_ms}
        tokens_used={isStreaming ? streamingWithoutMcp?.tokens_used : withoutMcp?.tokens_used}
        isLoading={isLoading && !isStreaming}
        variant="without-mcp"
        isStreaming={isStreaming}
        progressLog={streamingWithoutMcp?.progressLog}
      />
      <ResponsePanel
        title="With MCP"
        subtitle={`${modelName} + live Socrata data access`}
        content={withMcpContent}
        duration_ms={isStreaming ? streamingWithMcp?.duration_ms : withMcp?.duration_ms}
        tokens_used={isStreaming ? streamingWithMcp?.tokens_used : withMcp?.tokens_used}
        tools_called={isStreaming ? streamingWithMcp?.tools_called : withMcp?.tools_called}
        isLoading={isLoading && !isStreaming}
        variant="with-mcp"
        isStreaming={isStreaming}
        progressLog={streamingWithMcp?.progressLog}
      />
    </div>
  );
}
