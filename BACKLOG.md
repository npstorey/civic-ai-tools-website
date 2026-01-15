# Backlog

## To Do (High Priority)

- [x] **Fix layout: results below fold on laptops** (2025-01-15)
  - Reduced hero, form padding, margins throughout
  - Shortened examples to fit one line
  - Added scroll-to-results on Compare click

- [x] **Model audit** (2025-01-15)
  - Updated to 4 models with reliable tool support
  - GPT-4o Mini (default), GPT-4o, Claude Sonnet 4, Gemini 2.0 Flash
  - Removed Llama 3.1 (inconsistent tool calling)

- [ ] **Update About page with educational content**
  - Explain factors that affect AI response quality:
    - Model selection
    - System prompts / Skills
    - Orchestration framework (browser vs IDE vs CLI)
    - Tool calls / MCPs
  - Position civic-ai-tools as educational resource, not just demo
  - Keep concise but informative

## To Do (Medium Priority)

- [ ] **Add token cost safeguards**
  - Track cumulative tokens across all iterations (current display only shows last call)
  - Add total token limit per request (e.g., abort if > 50K tokens)
  - Truncate large Socrata API responses to limit input token growth
  - Worst case with 10 iterations could cost $0.50-$2.00 per query

## To Consider (Future Features)

- [ ] **Fairer comparison: "No MCP + web search" option**
  - Current "Without MCP" shows model with NO tools (just training data)
  - Add option to compare: MCP vs web search vs no tools
  - Could be "Advanced" toggle or third column
  - The point: show value of *structured* data access vs general web search

- [ ] **Streaming response animation**
  - Show tokens as they generate (like ChatGPT)
  - Requires refactoring API to use SSE
  - Would significantly improve perceived performance

- [ ] **Progress indicator for tool calls**
  - Show which tool is being called during MCP execution
  - Visual feedback during the 10+ second waits

- [ ] **Model vs model comparison**
  - Compare two different models, both using MCP
  - Demonstrate how model choice affects quality
  - UI: third column? toggle? separate mode?

- [ ] **Welcome page / landing redesign**
  - Hero with clearer value prop:
    "Civic AI Tools is a curated collection of system prompts and tools (MCP servers) to help users get better results using agentic AI to explore civic data."
  - Multiple CTAs: "Try the Demo", "View on GitHub", "Set up in Claude/ChatGPT"
  - Consider moving demo to `/demo` route
  - Long-term: position as educational resource + demo

- [ ] **Embedded video demo**
  - Show complex multi-step analysis in IDE/CLI
  - Demonstrates what's possible beyond web demo limits
  - Need to create the video first

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
