#!/usr/bin/env node

/**
 * Fetches the current skill guidance from the MCP server's prompt endpoint
 * and updates the SOCRATA_SKILL_FALLBACK constant in socrata-skill.ts.
 *
 * Usage: node scripts/sync-fallback.mjs
 *        npm run sync-fallback
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_URL = process.env.SOCRATA_MCP_URL || 'https://opengov-mcp-server.onrender.com';

async function fetchGuidance() {
  // 1. Initialize MCP session
  console.log('Initializing MCP session...');
  const initRes = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'sync-fallback', version: '1.0.0' },
      },
    }),
  });

  if (!initRes.ok) {
    throw new Error(`Init failed: ${initRes.status} ${initRes.statusText}`);
  }

  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('No session ID returned');

  // 2. Fetch skill guidance prompt
  console.log('Fetching skill-guidance prompt (modality: web)...');
  const promptRes = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'prompts/get',
      params: { name: 'skill-guidance', arguments: { modality: 'web' } },
    }),
  });

  if (!promptRes.ok) {
    throw new Error(`Prompt fetch failed: ${promptRes.status} ${promptRes.statusText}`);
  }

  const text = await promptRes.text();

  // Parse SSE or JSON response
  let jsonData = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      jsonData = line.slice(5).trim();
      break;
    }
  }

  const parsed = JSON.parse(jsonData || text);
  const result = parsed.result;

  if (!result?.messages) throw new Error('No messages in prompt response');

  return result.messages
    .map((msg) => {
      const content = msg.content;
      if (Array.isArray(content)) {
        return content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n');
      }
      if (typeof content === 'object' && content.type === 'text') return content.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const guidance = await fetchGuidance();
  console.log(`Fetched ${guidance.length} chars of guidance.`);

  // Read and update the source file
  const filePath = resolve(__dirname, '../src/lib/mcp/socrata-skill.ts');
  const source = readFileSync(filePath, 'utf-8');

  // Replace the content between the backticks after SOCRATA_SKILL_FALLBACK = `
  const startMarker = "export const SOCRATA_SKILL_FALLBACK = `";
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) throw new Error('Could not find SOCRATA_SKILL_FALLBACK marker');

  const contentStart = startIdx + startMarker.length;
  // Find the closing backtick followed by ;
  const endIdx = source.indexOf('`;', contentStart);
  if (endIdx === -1) throw new Error('Could not find closing backtick');

  const updated = source.slice(0, contentStart) + '\n' + guidance + '\n' + source.slice(endIdx);
  writeFileSync(filePath, updated);
  console.log(`Updated ${filePath}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
