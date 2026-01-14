import Link from 'next/link';

export const metadata = {
  title: 'About MCP - Civic AI Tools',
  description: 'Learn how Model Context Protocol (MCP) enables LLMs to access live civic data.',
};

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-8">
        What is MCP?
      </h1>

      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p className="text-lg text-zinc-600 dark:text-zinc-400 mb-8">
          Model Context Protocol (MCP) is an open standard that allows Large Language
          Models to securely connect to external data sources and tools. Think of it
          as giving AI assistants the ability to &quot;see&quot; and interact with real-world
          data instead of relying solely on their training data.
        </p>

        <h2 className="text-2xl font-semibold mt-12 mb-4">
          The Problem MCP Solves
        </h2>

        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <div className="bg-zinc-100 dark:bg-zinc-900 rounded-lg p-6">
            <h3 className="font-semibold text-lg mb-2 text-red-600 dark:text-red-400">
              Without MCP
            </h3>
            <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              <li>- Limited to training data (outdated)</li>
              <li>- Can&apos;t access current information</li>
              <li>- May hallucinate statistics</li>
              <li>- No way to verify claims</li>
            </ul>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-6">
            <h3 className="font-semibold text-lg mb-2 text-green-600 dark:text-green-400">
              With MCP
            </h3>
            <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              <li>- Access to live, real-time data</li>
              <li>- Can query actual databases</li>
              <li>- Provides sourced, accurate info</li>
              <li>- Cites specific datasets</li>
            </ul>
          </div>
        </div>

        <h2 className="text-2xl font-semibold mt-12 mb-4">
          How It Works
        </h2>

        <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-6 mb-8">
          <pre className="text-sm overflow-x-auto text-zinc-700 dark:text-zinc-300">
{`User Question
     │
     ▼
┌─────────────────┐
│  LLM (Claude,   │
│  GPT-4, etc.)   │
└────────┬────────┘
         │ "I need current 311 data..."
         ▼
┌─────────────────┐
│   MCP Server    │──────► Socrata API
│  (opengov-mcp)  │◄────── Live Data
└────────┬────────┘
         │ Real data returned
         ▼
┌─────────────────┐
│  LLM Response   │
│  with citations │
└─────────────────┘`}
          </pre>
        </div>

        <h2 className="text-2xl font-semibold mt-12 mb-4">
          About This Demo
        </h2>

        <p className="text-zinc-600 dark:text-zinc-400 mb-4">
          This website demonstrates the value of MCP by showing side-by-side
          comparisons of the same question answered:
        </p>

        <ol className="list-decimal list-inside space-y-2 text-zinc-600 dark:text-zinc-400 mb-8">
          <li>
            <strong>Without MCP:</strong> The LLM can only use its training data,
            which may be outdated or incomplete for specific civic datasets.
          </li>
          <li>
            <strong>With MCP:</strong> The LLM connects to the{' '}
            <a
              href="https://github.com/npstorey/civic-ai-tools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              opengov-mcp-server
            </a>
            , which provides access to Socrata open data portals from cities
            like San Francisco, Chicago, and New York.
          </li>
        </ol>

        <h2 className="text-2xl font-semibold mt-12 mb-4">
          Use MCP Locally
        </h2>

        <p className="text-zinc-600 dark:text-zinc-400 mb-4">
          This demo has rate limits to manage costs. For unlimited access,
          set up MCP locally with your favorite AI tool:
        </p>

        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Claude Code</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Add opengov-mcp to your ~/.claude/settings.json
            </p>
          </div>
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Cursor</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Configure MCP servers in Cursor settings
            </p>
          </div>
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Other Tools</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Any MCP-compatible client works
            </p>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6">
          <h3 className="font-semibold text-lg mb-2">Get Started</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            Check out the civic-ai-tools repository for setup instructions
            and documentation.
          </p>
          <a
            href="https://github.com/npstorey/civic-ai-tools"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-sm hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
          >
            View on GitHub
          </a>
        </div>

        <h2 className="text-2xl font-semibold mt-12 mb-4">
          Learn More About MCP
        </h2>

        <ul className="space-y-2 text-zinc-600 dark:text-zinc-400">
          <li>
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              modelcontextprotocol.io
            </a>
            {' '}- Official MCP documentation
          </li>
          <li>
            <a
              href="https://github.com/modelcontextprotocol"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              MCP GitHub
            </a>
            {' '}- SDKs and specifications
          </li>
        </ul>
      </div>

      <div className="mt-12 pt-8 border-t border-zinc-200 dark:border-zinc-800">
        <Link
          href="/"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          &larr; Back to Demo
        </Link>
      </div>
    </div>
  );
}
