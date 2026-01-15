# Civic AI Tools Website

A demo website showcasing the value of [Model Context Protocol (MCP)](https://modelcontextprotocol.io) by displaying side-by-side LLM responses with and without MCP integration for civic data queries.

**Live demo:** [civic-ai-tools-website.vercel.app](https://civic-ai-tools-website.vercel.app/)

## What it does

Users enter a question about civic data (e.g., "What are the most common 311 complaints in Brooklyn?") and see two responses:

- **Without MCP:** LLM responds using only training data (often outdated or vague)
- **With MCP:** LLM connects to live Socrata open data portals via [opengov-mcp-server](https://github.com/npstorey/civic-ai-tools) and returns real, current data

## Tech Stack

- **Frontend:** Next.js 16+ (App Router), Tailwind CSS
- **LLM API:** OpenRouter (supports GPT-4o, Claude, etc.)
- **MCP Server:** opengov-mcp-server (Socrata data access)
- **Auth:** NextAuth.js with GitHub OAuth
- **Rate Limiting:** Upstash Redis via @vercel/kv
- **Hosting:** Vercel

## Local Development

```bash
# Install dependencies
npm install

# Set up environment variables (see .env.example or CLAUDE.md)
cp .env.example .env.local

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

Required:
```
OPENROUTER_API_KEY=sk-or-...
OPENGOV_MCP_URL=https://opengov-mcp-server.onrender.com
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NEXTAUTH_SECRET=        # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
```

For persistent rate limiting (optional locally, required in production):
```
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

## Rate Limits

- Anonymous users: 5 requests/day
- Signed-in users (GitHub): 25 requests/day

## Related

- [civic-ai-tools](https://github.com/npstorey/civic-ai-tools) - The opengov-mcp-server and related tools
- [Model Context Protocol](https://modelcontextprotocol.io) - Official MCP documentation
