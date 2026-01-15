# Backlog

## To Do

_(Empty - add new items here)_

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
  - **Note:** Already added basic hint below results linking to repo

## Done

- [x] **Set up Vercel KV for persistent rate limiting** (2025-01-15)
  - Using Upstash Redis via Vercel Marketplace
  - Rate limits now persist across deploys

- [x] **Fix empty MCP responses when hitting tool iteration limit**
  - Added logic to force a final text response if model keeps requesting tools
  - Increased max iterations from 5 to 10

- [x] **Add SoQL date function guidance to skill module**
  - Socrata uses `date_trunc_ym()`, `date_extract_m()` etc., NOT standard SQL
  - LLM now uses correct syntax for monthly/yearly aggregations

- [x] **Make layout compact - button visible above fold**
  - Reduced hero size, form padding, moved rate limit inline
  - Model/Portal/Compare button on same row

- [x] **Remove dark mode - light mode only**
  - Simplified styling for demo purposes

- [x] **Add hint below results for complex queries**
  - Links to civic-ai-tools repo, suggests Claude Code or Cursor

- [x] **Simplify header navigation**
  - Removed "Demo" link (redundant with homepage)
  - Renamed "About MCP" to "About"

- [x] **Rate limit banner refresh after queries**
  - Counter now updates immediately after each query

- [x] **NYC as default portal with updated examples**
