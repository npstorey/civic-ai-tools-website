#!/usr/bin/env node

/**
 * DO NOT RUN — the verbatim-paste model this script implements is UNSOUND
 * post-#258 and post-posture-split (sprint 154 P4, portability charter 4).
 *
 * What it does: fetches the composed skill guidance from the configured MCP
 * server's prompt endpoint and pastes it verbatim over the entire body of the
 * SOCRATA_SKILL_FALLBACK template literal in src/lib/mcp/socrata-skill.ts.
 *
 * Why that is now destructive:
 *
 *   1. POSTURE RE-IMPORT: the fallback is generic-only by owner-ratified
 *      decision — it must never carry deployment posture. The MCP server's
 *      prompts/get response is composed at serve time and includes whatever
 *      posture overlay the fetched server has configured (SKILL_POSTURE).
 *      Pasting it verbatim re-imports that posture into every instance's
 *      fallback — exactly the defect the portability program removed.
 *   2. STRUCTURE CLOBBER: the fallback constant is hand-shaped (markdown
 *      links flattened to plain URLs, no reproducible-notebook section, one
 *      combined base+overlay body). A verbatim paste clobbers those
 *      adaptations.
 *   3. BACKTICK BREAKAGE: the fetched markdown contains raw backticks (code
 *      fences, inline code). The constant is a template literal whose
 *      backticks are escaped by hand; pasting unescaped content very likely
 *      breaks the file syntactically.
 *
 * Fallback updates are HAND-SHAPED under test coverage instead — see the
 * governance notes in src/lib/mcp/socrata-skill.ts and the source-of-truth
 * skill docs at
 * https://github.com/npstorey/civic-ai-tools/blob/main/docs/skills/README.md
 * (tests: src/lib/evidence/instance-config.test.ts,
 * src/lib/mcp/skill-instance-config.test.ts).
 *
 * The script refuses to run unless --force-clobber is passed. Kept only so
 * its fetch plumbing remains inspectable; if you think you need to force it,
 * you almost certainly want a hand-shaped edit instead.
 *
 * Usage: node scripts/sync-fallback.mjs --force-clobber   (discouraged)
 *        npm run sync-fallback                             (prints this refusal)
 */

const REFUSAL = `
sync-fallback: REFUSING to run.

This script's verbatim-paste model is unsound post-#258 / post-posture-split:
  - it would re-import whatever posture overlay the fetched MCP server has
    configured into the generic-only SOCRATA_SKILL_FALLBACK,
  - it would clobber the fallback's hand-shaped structural adaptations, and
  - the fetched markdown's raw backticks would likely break the template
    literal syntactically.

Fallback updates are hand-shaped under test coverage per the skill-guidance
governance (https://github.com/npstorey/civic-ai-tools/blob/main/docs/skills/README.md);
see the header of this script and of src/lib/mcp/socrata-skill.ts.

To override anyway (discouraged), pass --force-clobber.
`;

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// civic-ai-tools#155 P1 E4 (premise-checked): this script refuses to run at
// all unless --force-clobber overrides the REFUSAL below, and that path is
// itself discouraged (see the header) — so stripping this default is
// cosmetic, not a live-defect fix; the script is inert on every normal
// invocation regardless. Stripped anyway for consistency with the rest of
// this repo's reference-host-default removal (civic-ai-tools#155 P1 E4):
// no fallback to the hosted MCP endpoint, even on the discouraged path.
const MCP_URL = process.env.SOCRATA_MCP_URL;

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
  if (!process.argv.includes('--force-clobber')) {
    console.error(REFUSAL);
    process.exit(1);
  }
  if (!MCP_URL) {
    console.error(
      'sync-fallback: SOCRATA_MCP_URL environment variable is required (no reference-host default). ' +
        'Even on this discouraged --force-clobber path, this script will not guess which MCP server to fetch from.',
    );
    process.exit(1);
  }
  console.warn(
    'sync-fallback: --force-clobber passed — proceeding with the unsound verbatim paste. ' +
      'Review the result by hand and expect test failures (posture/backtick hazards; see header).',
  );
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
