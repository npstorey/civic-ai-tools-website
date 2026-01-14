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
  const borderColor =
    variant === 'with-mcp'
      ? 'border-green-500 dark:border-green-400'
      : 'border-zinc-300 dark:border-zinc-700';
  const headerBg =
    variant === 'with-mcp'
      ? 'bg-green-50 dark:bg-green-900/20'
      : 'bg-zinc-50 dark:bg-zinc-800/50';

  return (
    <div
      className={`border-2 rounded-lg overflow-hidden ${borderColor} flex flex-col h-full`}
    >
      <div className={`px-4 py-3 ${headerBg}`}>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>
      </div>

      <div className="flex-1 p-4 overflow-auto">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
            <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse w-5/6" />
            <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse w-4/6" />
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <div className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
              {content}
            </div>
          </div>
        )}
      </div>

      {!isLoading && (duration_ms || tokens_used || tools_called) && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
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
            <div className="mt-3">
              <h4 className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                MCP Tools Used:
              </h4>
              <div className="space-y-2">
                {tools_called.map((tool, idx) => (
                  <div
                    key={idx}
                    className="bg-green-100 dark:bg-green-900/30 rounded px-2 py-1.5"
                  >
                    <code className="text-xs font-mono text-green-800 dark:text-green-300">
                      {tool.name}
                    </code>
                    <div className="text-xs text-green-700 dark:text-green-400 mt-1 font-mono overflow-x-auto">
                      {JSON.stringify(tool.args, null, 2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
