# Sprint 001: MCP Messaging UX

**Goal:** Make the "With MCP" panel clearly narrate what the agent is doing — so users understand *why* MCP-backed answers are better, not just that they are.

**Key files:** `src/components/ComparisonDisplay.tsx`, `src/components/ResponsePanel.tsx`, `src/lib/openrouter.ts`, `src/app/api/compare/route.ts`

## Tasks

### Must-have (MVP)

- [ ] **1. Real-time step narration** — Stream a timeline of what the agent is doing during tool calls (e.g., "Searching for dataset...", "Running SoQL query...", "Analyzing results..."). Gives users a sense of progress instead of a blank wait.
- [ ] **2. "What just happened?" summary** — After the MCP response completes, display a short recap of the steps taken (datasets queried, records examined, tools used). Makes the process legible at a glance.
- [ ] **3. Tool call cards** — Show each MCP tool call as a collapsible card with inputs, outputs, and timing. Lets curious users inspect exactly what happened without cluttering the default view.

### High Value

- [ ] **4. Annotated SoQL query display** — When a SoQL query is executed, display it with inline annotations explaining key clauses (WHERE, GROUP BY, etc.). Helps users understand the query logic without needing to know SoQL.
- [ ] **5. Educational tooltips** — Add contextual tooltips for technical terms (MCP, SoQL, dataset IDs, Socrata) so non-technical users can follow along.

### Nice-to-have

- [ ] **6. Visual diff highlighting** — Visually distinguish hedged/uncertain language (LLM-only side) from grounded, data-backed statements (MCP side). Makes the quality difference immediately obvious.
- [ ] **7. Timing breakdown bar** — Show a horizontal bar breaking down where time was spent (LLM thinking, API calls, data processing). Helps users understand the cost of grounded answers.

## Acceptance Criteria

- A user watching the "With MCP" panel can understand what the agent is doing at each step without prior technical knowledge.
- Tool calls are visible but not overwhelming — collapsed by default, expandable on demand.
- The comparison between the two panels makes a compelling case for MCP-backed queries.

## Notes

- Overlaps with backlog items "Streaming response animation" and "Progress indicator for tool calls" — this sprint supersedes those.
- Parent repo for MCP server config and skill docs: [civic-ai-tools](https://github.com/npstorey/civic-ai-tools)
