# Backlog

## To Do

- [ ] **Set up Vercel KV for persistent rate limiting**
  - Currently using in-memory fallback which resets on each deploy
  - Go to Vercel dashboard → Project → Storage → Create KV Database
  - This will auto-add KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN env vars
  - Rate limits will then persist across deploys

## To Consider

- [ ] **Is the comparison fair?**
  - Current "Without MCP" shows model with NO tools (just training data)
  - A model with web search + general SQL knowledge might perform better
  - Options to consider:
    - Add disclaimer: "Without MCP = no external tools, just training data"
    - Add a third column: "With Web Search" to show MCP is still better
    - Keep as-is but clarify the comparison is "training data vs live data access"
  - The point of the demo is showing value of structured data access, not raw capability

- [ ] **Add setup instructions for Claude/ChatGPT browser**
  - Show how to enable MCP in Claude Desktop app
  - Note: ChatGPT doesn't support MCP natively (only via plugins/actions)
  - Could add to About page or create dedicated "Get Started" page
  - Link to modelcontextprotocol.io for official docs

- [ ] **Add complexity guidance + advanced use cases**
  - Web demo has limits: rate limits, 10 tool iterations, simple queries
  - For complex multi-step analysis, direct users to:
    - Claude Code CLI
    - Cursor IDE
    - Other MCP-compatible tools
  - Could add:
    - Video demo of complex query in Claude Code
    - Link to civic-ai-tools repo with examples
    - "This query is complex - try it locally" messaging
  - Maybe detect query complexity and show a hint?

## Done

