# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A demo website showcasing MCP (Model Context Protocol) value by displaying side-by-side LLM responses with and without MCP integration for civic data queries. Built with Next.js 14+ on Vercel, it connects to OpenRouter for LLM access and opengov-mcp-server for live Socrata civic data.

## Commands

```bash
# Development
npm run dev          # Start dev server at localhost:3000
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint

# Project initialization (if not yet set up)
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
npm install next-auth @vercel/kv openai
```

## Architecture

```
Frontend (Next.js App Router + Tailwind)
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
    └── Vercel KV (Rate limiting)
```

## Key Implementation Patterns

### OpenRouter Integration
- Uses `openai` npm package with `baseURL: 'https://openrouter.ai/api/v1'`
- Tool calling follows OpenAI function calling format
- Same model used for both with/without MCP comparisons

### MCP Tool Execution Flow
1. OpenRouter returns `tool_calls` in response
2. Backend intercepts and calls opengov-mcp-server via HTTP POST to `/mcp`
3. Server uses JSON-RPC format with SSE response
4. Tool results returned to model for final response

### MCP Server Communication
```typescript
// POST to ${OPENGOV_MCP_URL}/mcp with JSON-RPC:
{
  jsonrpc: '2.0',
  id: Date.now(),
  method: 'tools/call',
  params: { name: toolName, arguments: args }
}
// Response is SSE format: "event: message\ndata: {...}\n\n"
```

### Rate Limiting
- Anonymous: 5 requests/day (tracked by IP)
- Authenticated: 25 requests/day (tracked by GitHub user ID)
- Key format in Vercel KV: `rate:{user_id_or_ip}:{YYYY-MM-DD}`

## Environment Variables

Required in `.env.local`:
```
OPENROUTER_API_KEY=sk-or-...
OPENGOV_MCP_URL=https://opengov-mcp-server.onrender.com
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NEXTAUTH_SECRET=        # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
```

Optional (Vercel KV for rate limiting):
```
KV_URL=
KV_REST_API_URL=
KV_REST_API_TOKEN=
KV_REST_API_READ_ONLY_TOKEN=
```

## Directory Structure

- `app/` - Next.js App Router pages and API routes
- `components/` - React components (QueryForm, ComparisonDisplay, ResponsePanel, etc.)
- `lib/` - Utilities (openrouter.ts, mcp/client.ts, mcp/tools.ts, rate-limit.ts, auth.ts)
- `public/` - Static assets

## Implementation Notes

- The opengov-mcp-server only supports HTTP transport (not stdio)
- Tool definitions in `lib/mcp/tools.ts` map to OpenRouter function schemas
- Alternative MCP SDK approach available using `@modelcontextprotocol/sdk` with SSEClientTransport
- Budget cap should be set in OpenRouter dashboard (~$30/month)
