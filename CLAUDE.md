# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A demo website showcasing MCP (Model Context Protocol) value by displaying side-by-side LLM responses with and without MCP integration for civic data queries. Built with Next.js 16+ on Vercel, it connects to OpenRouter for LLM access and opengov-mcp-server for live Socrata civic data.

**Production URL:** https://civic-ai-tools-website.vercel.app/

## Commands

```bash
# Development
npm run dev          # Start dev server at localhost:3000
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
```

## Architecture

```
Frontend (Next.js App Router + Tailwind CSS)
    │
    ├── / (home)           → Query form + side-by-side results
    └── /about             → About MCP page
    │
API Routes (Serverless)
    ├── POST /api/compare     → Runs parallel LLM calls (with/without MCP)
    ├── GET  /api/models      → Available models list
    ├── GET  /api/rate-limit  → User quota status
    └── /api/auth/[...nextauth] → GitHub OAuth
    │
External Services
    ├── OpenRouter (LLM API, OpenAI-compatible)
    ├── opengov-mcp-server (Socrata data via HTTP/SSE at /mcp endpoint)
    └── Upstash Redis via @vercel/kv (Rate limiting)
```

## Key Implementation Details

### OpenRouter Integration (`lib/openrouter.ts`)
- Uses `openai` npm package with `baseURL: 'https://openrouter.ai/api/v1'`
- Tool calling follows OpenAI function calling format
- Same model used for both with/without MCP comparisons
- **Max 10 tool iterations** to prevent infinite loops
- **Force final response**: If iteration limit hit with no content, makes one more call without tools to get a summary

### MCP Tool Execution Flow
1. OpenRouter returns `tool_calls` in response
2. Backend intercepts and calls opengov-mcp-server via HTTP POST to `/mcp`
3. Server uses JSON-RPC format with SSE response
4. Tool results returned to model for final response

### MCP Server Communication (`lib/mcp/client.ts`)
```typescript
// 1. Initialize session first:
POST ${OPENGOV_MCP_URL}/mcp
Headers: { 'Accept': 'application/json, text/event-stream' }
Body: {
  jsonrpc: '2.0',
  id: Date.now(),
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {...} }
}
// Response header contains: mcp-session-id

// 2. Make tool calls with session ID:
POST ${OPENGOV_MCP_URL}/mcp
Headers: { 'mcp-session-id': sessionId }
Body: {
  jsonrpc: '2.0',
  id: Date.now(),
  method: 'tools/call',
  params: { name: 'get_data', arguments: { type: 'query', portal: '...', ... } }
}
```

### MCP Tool Types (`lib/mcp/tools.ts`)
The `get_data` tool supports these operation types:
- `catalog`: Search for datasets matching a query
- `metadata`: Get metadata about a specific dataset (pass dataset_id in `query` param)
- `query`: Execute a SoQL query against a dataset
- `metrics`: Get metrics/statistics about a dataset

### OpenGov Skill Module (`lib/mcp/opengov-skill.ts`)
Domain knowledge injected into the LLM system prompt:
- Known dataset IDs and key fields for NYC, Chicago, SF
- SoQL query patterns and syntax
- **SoQL date functions** (NOT standard SQL!): `date_trunc_ym()`, `date_extract_m()`, etc.
- Anti-hallucination guidelines
- Portal-specific guidance

### Rate Limiting (`lib/rate-limit.ts`)
- Anonymous: 5 requests/day (tracked by IP)
- Authenticated: 25 requests/day (tracked by GitHub user ID)
- Key format in Upstash: `rate:{user_id_or_ip}:{YYYY-MM-DD}`
- Falls back to in-memory store if KV not configured (resets on deploy)

## Environment Variables

Required in `.env.local`:
```
OPENROUTER_API_KEY=sk-or-...
OPENGOV_MCP_URL=https://opengov-mcp-server.onrender.com
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NEXTAUTH_SECRET=        # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000  # or production URL
```

Required in production (Upstash via Vercel KV):
```
KV_URL=
KV_REST_API_URL=
KV_REST_API_TOKEN=
KV_REST_API_READ_ONLY_TOKEN=
```

## Directory Structure

```
src/
├── app/
│   ├── page.tsx              # Home page with query form
│   ├── about/page.tsx        # About MCP page
│   ├── layout.tsx            # Root layout with header/footer
│   ├── globals.css           # NYC Design System styles (light mode only)
│   └── api/
│       ├── compare/route.ts  # Main comparison endpoint
│       ├── models/route.ts   # Available models
│       ├── rate-limit/route.ts
│       └── auth/[...nextauth]/route.ts
├── components/
│   ├── Header.tsx
│   ├── QueryForm.tsx         # Query input + model/portal selectors
│   ├── ComparisonDisplay.tsx # Side-by-side results wrapper
│   ├── ResponsePanel.tsx     # Individual result panel
│   ├── RateLimitBanner.tsx   # Inline rate limit display
│   └── Providers.tsx         # NextAuth SessionProvider
└── lib/
    ├── openrouter.ts         # LLM API client
    ├── rate-limit.ts         # Rate limiting logic
    ├── auth.ts               # NextAuth config
    └── mcp/
        ├── client.ts         # MCP server HTTP client
        ├── tools.ts          # Tool definitions for OpenRouter
        └── opengov-skill.ts  # Domain knowledge for Socrata queries
```

## Key Datasets

| Portal | Dataset | ID | Key Fields |
|--------|---------|-----|------------|
| NYC | 311 Service Requests | erm2-nwe9 | complaint_type, borough, created_date |
| NYC | Restaurant Inspections | 43nn-pn8j | boro, grade, inspection_date |
| NYC | Housing Violations | wvxf-dwi5 | boro, violationid, inspectiondate |
| Chicago | 311 Service Requests | v6vf-nfxy | sr_type, created_date |
| SF | 311 Cases | vw6y-z8j6 | service_name, opened, neighborhood |

## Design Notes

- **Light mode only** - Simplified styling, no dark mode
- **NYC Design System colors** - Blue (#103FEF), grays, semantic colors
- **Compact layout** - Form and button visible above fold on laptop screens
- **Not indexed** - robots.txt blocks crawlers during demo phase
