/**
 * A scripted mock model endpoint, for driving the real tool-calling loop in a
 * test with no live endpoint, no credential and no MCP server.
 *
 * It lived in `openrouter-streaming.test.ts` until the loop became shared
 * (#345). It moves here because every caller of `runToolLoop` needs the same
 * instrument, and because the assertions that matter most in this family are
 * about WHAT THE MODEL WAS SENT — this server records every request body it
 * received, so a test can read the transcript off the wire instead of
 * inferring it from a return value.
 *
 * Every key, model id and hostname a test hands this server is an obviously
 * fake fixture; the address is loopback.
 *
 * Not a `.test.ts` file on purpose: it holds no tests, and naming it one would
 * make the runner execute it as an empty suite.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ScriptedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Sent verbatim as `function.arguments` instead of `JSON.stringify(args)`.
   * The endpoint chooses those bytes in production and is not obliged to make
   * them parseable — which is the case #349 is about.
   */
  rawArguments?: string;
}

export interface ScriptedReply {
  content?: string | null;
  toolCalls?: ScriptedToolCall[];
  totalTokens?: number;
}

export interface ScriptedModelServer {
  server: Server;
  url: string;
  /** Every request body the server received, in order. */
  requests: Record<string, unknown>[];
}

/**
 * A model server that answers from a script. Reply N serves request N; the
 * LAST reply repeats for every request beyond the script, which is what makes
 * an unbounded re-ask observable — a loop would keep drawing the same
 * unsatisfying answer and the request count would climb past the bound.
 *
 * It reads the request body, so it can answer `stream: true` with real SSE
 * (the answering turn streams) and record what was actually sent (tools
 * omitted, contract restated, transcript intact).
 */
export function startScriptedModelServer(replies: ScriptedReply[]): Promise<ScriptedModelServer> {
  const requests: Record<string, unknown>[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        requests.push(body);
        const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
        const usage = {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: reply.totalTokens ?? 15,
        };

        if (body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const frame = (payload: Record<string, unknown>) =>
            `data: ${JSON.stringify({
              id: 'chatcmpl-test-scripted',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'fake/model',
              ...payload,
            })}\n\n`;
          res.write(frame({
            choices: [{ index: 0, delta: { content: reply.content ?? '' }, finish_reason: null }],
          }));
          res.write(frame({ choices: [], usage }));
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-test-scripted',
          object: 'chat.completion',
          created: 1,
          model: 'fake/model',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: reply.content ?? null,
              ...(reply.toolCalls
                ? {
                    tool_calls: reply.toolCalls.map((tc) => ({
                      id: tc.id,
                      type: 'function',
                      function: {
                        name: tc.name,
                        arguments: tc.rawArguments ?? JSON.stringify(tc.args),
                      },
                    })),
                  }
                : {}),
            },
            finish_reason: reply.toolCalls ? 'tool_calls' : 'stop',
          }],
          usage,
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/v1`, requests });
    });
  });
}
