import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { queryWithoutMcpStreaming, queryWithMcpStreaming, type StreamCallbacks, type ProgressOpts } from '@/lib/openrouter-streaming';
import { mcpToolsFor, offeredMcpTools } from '@/lib/mcp/tools';
import { callMcpTool } from '@/lib/mcp/client';
import { composeSystemPrompt, withPortalLockGuidance } from '@/lib/mcp/socrata-skill';
import { consentInForce } from '@/lib/sources/consent-gate';
import { createInLoopRouting, directorySet, entersInLoop, sourceRoutingMode } from '@/lib/mcp/routing-mode';
import { checkRateLimit, getMissingRateLimitSecretError, incrementRateLimit, isRateLimited } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { encodeSSE, errorLogFacts, panelsForRun, startSseKeepAlive, streamErrorPayload, type StreamErrorCode, type PanelType, type StreamEvent } from '@/lib/streaming';
import { getMissingModelCredentialError, ModelConfigurationError } from '@/lib/model-client';
import { resolveModelIdentity, ModelNotOfferedError } from '@/lib/model-resolver';
import type { ModelIdentity } from '@/lib/model-catalog';
import { configuredMcpServers, getMissingMcpRoutingError, readMcpEnvFromProcess, routedSourceId, skillRoutingTraceAttributes } from '@/lib/mcp/registry';
import { resolveRunPortal } from '@/lib/site-config';
import { PORTAL_LOCK_NOT_CONFIGURED_MESSAGE } from '@/lib/portal-lock';
import { TraceBuilder, hash, CIVICAITOOLS_TRACE_CONFIG, runRecordAttributes } from '@/lib/evidence/trace';
import { startUsageCount, type UsageOutcome } from '@/lib/usage/count';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
} as const;

interface CompareRequest {
  query: string;
  model: string;
  portal?: string;
  mcpOnly?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: CompareRequest = await request.json();
    const { query, model: modelId, portal: rawPortal, mcpOnly = false } = body;
    // The caller's portal, else this instance's configured default, else NONE
    // (#407). It used to be a literal at both halves of this line, so a caller
    // that named no portal ran against one deployment's city and `analysis.portal`
    // below recorded that city in a trace a publish carries into a signed
    // package. An empty string on the wire means "no portal" — it is what the
    // form's "All portals" entry sends — so it collapses to undefined here.
    // Under SITE_PORTAL_LOCKED the configured portal is the ONLY one (#436):
    // the resolver refuses a request naming another, and refuses every request
    // when none is configured.
    const portalResolution = resolveRunPortal(rawPortal);

    if (!query || !modelId) {
      return new Response(
        JSON.stringify({ error: 'Query and model are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // The one-portal switch (#436), refused before the rate limiter and before
    // the skill fetch, so a refused request costs the reader nothing. A request
    // naming another portal is the caller's failure: a 400 whose text names
    // both portals (ruling D1). A lock with no portal configured is the
    // operator's: the log names the variable and the reader gets the generic
    // copy on the channel this route's other configuration refusals use —
    // there is no reader-copy kind for it, because copy naming a variable the
    // reader cannot set would send them the wrong way (#30 P6 F3's lesson).
    if (!portalResolution.ok) {
      const { refusal: portalRefusal } = portalResolution;
      if (portalRefusal.reason === 'foreign_portal') {
        return new Response(
          JSON.stringify({ error: portalRefusal.message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      console.error('[compare-stream]', PORTAL_LOCK_NOT_CONFIGURED_MESSAGE);
      const encoder = new TextEncoder();
      const body = panelsForRun(mcpOnly)
        .map((panel) =>
          encodeSSE({
            type: 'error',
            panel,
            ...streamErrorPayload('generic'),
          } as StreamEvent & { message: string; code: StreamErrorCode })
        )
        .join('');
      return new Response(encoder.encode(body), { headers: SSE_HEADERS });
    }
    const { portal, lockedPortal } = portalResolution;

    // Fail fast when the instance has no model credential (#178). Checked
    // before rate limiting (a misconfigured instance must not burn quota) and
    // before any upstream work (skill fetch, MCP init). Surfaced as typed SSE
    // error events — the channel the client already renders — plus a server
    // log line for the operator.
    const credentialError = getMissingModelCredentialError();
    if (credentialError) {
      console.error('[compare-stream]', credentialError.message);
      const encoder = new TextEncoder();
      const body = panelsForRun(mcpOnly)
        .map((panel) =>
          encodeSSE({
            type: 'error',
            panel,
            message: credentialError.message,
            code: credentialError.code,
          } as StreamEvent & { message: string; code: StreamErrorCode })
        )
        .join('');
      return new Response(encoder.encode(body), { headers: SSE_HEADERS });
    }

    // The stored counter key is derived from RATE_LIMIT_SECRET (#516 P1), and
    // there is no default to derive it from. Refused here, beside the model
    // credential and for the same two reasons: the operator is told the
    // variable, and no reader's allowance is spent on a request that cannot be
    // counted. Same channel as the credential refusal: an error event per
    // panel.
    const rateLimitSecretError = getMissingRateLimitSecretError();
    if (rateLimitSecretError) {
      console.error('[compare-stream]', rateLimitSecretError.message);
      const encoder = new TextEncoder();
      const body = panelsForRun(mcpOnly)
        .map((panel) =>
          encodeSSE({
            type: 'error',
            panel,
            message: rateLimitSecretError.message,
            code: rateLimitSecretError.code,
          } as StreamEvent & { message: string; code: typeof rateLimitSecretError.code })
        )
        .join('');
      return new Response(encoder.encode(body), { headers: SSE_HEADERS });
    }

    // website#30 P3: the wire string and the recorded identity separate here.
    // P6 F1: resolved STRICTLY. Until this phase an unknown id was carried
    // through on both sides, on the premise that this route records no
    // identity. It does: `analysis.model` on the root span below, and
    // `gen_ai.request.model` on every inference span — and the publish dialog
    // carries this trace into a signed package. So a caller-supplied
    // deployment alias became its own "declared identity" and was signed.
    //
    // The refusal is the one the notebook route already raises, in the same
    // shape and with the same reader copy: a caller failure is 400, an
    // operator's unreadable catalog is 503, and both are raised before any
    // upstream call — before the skill fetch, before MCP init, before the
    // model.
    //
    // WHAT THE UI SENDS, checked rather than assumed. `QueryForm` offers only
    // ids from /api/models, which is this same catalog. `/explore` did NOT:
    // it sent a module constant naming a historical, unresolvable id, and
    // tolerant resolution was the only thing keeping that page working
    // (#314). It now reads the offered list too, so "the UI sends an id this
    // instance offers" is true by construction on both surfaces.
    let model: ModelIdentity;
    try {
      model = resolveModelIdentity(modelId);
    } catch (error) {
      if (error instanceof ModelNotOfferedError) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (error instanceof ModelConfigurationError) {
        console.error('[compare-stream]', error.message);
        return new Response(
          JSON.stringify({ error: error.message, code: error.code }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw error;
    }

    // Fail fast when the instance names no MCP endpoint for the primary data
    // source (#258 C4). SOCRATA_MCP_URL has no coded fallback — an
    // unconfigured instance refuses the query rather than routing it through
    // another deployment's infrastructure. Same shape and ordering rationale
    // as the model-credential guard above.
    const mcpRoutingError = getMissingMcpRoutingError();
    if (mcpRoutingError) {
      console.error('[compare-stream]', mcpRoutingError.message);
      const encoder = new TextEncoder();
      const body = panelsForRun(mcpOnly)
        .map((panel) =>
          encodeSSE({
            type: 'error',
            panel,
            message: mcpRoutingError.message,
            code: mcpRoutingError.code,
          } as StreamEvent & { message: string; code: StreamErrorCode })
        )
        .join('');
      return new Response(encoder.encode(body), { headers: SSE_HEADERS });
    }

    // Get session and identifier for rate limiting
    const session = await getServerSession(authOptions);
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0] || 'unknown';
    const identifier = session?.user?.id || ip;
    const isAuthenticated = !!session?.user?.id;

    // The consent in force (R6 W2, #632 D3, D12; design §4.4): nothing is
    // sent anywhere before it, the model endpoint included. Read after the
    // configuration refusals above and the session (whose `dbId` chooses the
    // row over the cookie), and before the rate limiter reads or spends
    // anything. None in force, or the re-ask rule says re-ask: the typed
    // `consent_required` on the channel this route's configuration refusals
    // use, an error event per panel, carrying the flows version to show.
    // DORMANT until W3 ships the consent card (`CONSENT_GATE_ENFORCED`,
    // `src/lib/sources/consent-enforced.ts`): the gate then refuses nothing, and
    // the selection, the reasons and the record are what they were before W2.
    const consent = await consentInForce(request, session);
    if (!consent.ok) {
      const encoder = new TextEncoder();
      const body = panelsForRun(mcpOnly)
        .map((panel) =>
          encodeSSE({
            type: 'error',
            panel,
            message: consent.payload.error,
            code: consent.payload.code,
            flowsVersion: consent.payload.flowsVersion,
            reask: consent.payload.reask,
          } as StreamEvent & { message: string; code: StreamErrorCode })
        )
        .join('');
      return new Response(encoder.encode(body), { headers: SSE_HEADERS });
    }

    // Check rate limit
    const rateLimitInfo = await checkRateLimit(identifier, isAuthenticated);
    if (isRateLimited(rateLimitInfo)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', rateLimit: rateLimitInfo }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Increment rate limit
    await incrementRateLimit(identifier, isAuthenticated);

    // --- Evidence trace: initialize ---
    const trace = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
    trace.startRoot('analysis', {
      'analysis.prompt_hash': hash(query),
      'analysis.model': model.declared,
      // Only when the run HAS one (#407, the `skillRoutingTraceAttributes`
      // disposition at #258 A9): a root span that names a portal is a claim
      // about where this analysis went, and this trace is carried into a
      // signed package. With no portal configured and none supplied, the key
      // is absent rather than filled with a default the instance never set.
      ...(portal ? { 'analysis.portal': portal } : {}),
    });

    // Fetch skill guidance (with trace span). The composed prompt spans both
    // MCP sources (Socrata + Data Commons), so record both server URLs — as
    // CONFIGURED, never defaulted (#258 A9): the signed trace records only
    // routing this instance explicitly set, and honestly omits the Socrata
    // field when unset (the guard above refused the query in that state).
    const skillFetchSpanId = trace.startSpan('skill_fetch');
    // The run's configuration, read once, so the prompt, the tools and what
    // the record states about them describe one configuration (#599 W4). The
    // selection is the reader's: configured ∩ On, from the consent store
    // (R6 W2, D3 = A), never from the request.
    const configured = readMcpEnvFromProcess();
    const selection = consent.selection;
    // How the sources reach the model (#644 W1, D9), read once per request. In
    // loop, the first request carries the directory and `load_source` only, and
    // no source's guidance is fetched until the model loads it; otherwise the
    // composition below, exactly as before the setting existed.
    const routingMode = sourceRoutingMode();
    const directory = routingMode === 'in-loop' ? directorySet(configured, consent) : [];
    const inLoop = entersInLoop(routingMode, directory)
      ? await createInLoopRouting({ portal, lockedPortal, configured, directory, selection })
      : undefined;
    const composition = inLoop
      ? { prompt: inLoop.firstSystemPrompt, assertedDate: inLoop.assertedDate, sourcesOffered: inLoop.sourcesOffered, components: inLoop.components() }
      : await composeSystemPrompt({ portal, configured, selection });
    // Under the lock, one section is appended saying the portal-general
    // guidance does not apply here (#436, D7); unlocked, the prompt is
    // unchanged. In loop, the session's first prompt already carries it.
    const systemPromptWithMcp = inLoop ? inLoop.firstSystemPrompt : withPortalLockGuidance(composition.prompt, lockedPortal, configured, selection);
    const systemPromptHash = hash(systemPromptWithMcp);
    // #411, ruling D3: the HASH, not the text. This span goes inline into the
    // bytes an instance signs, and `skill.text` put the whole composed prompt
    // there — every source's skill file, every instruction, on every package
    // — which is not something a record needs to assert to be scrutinised.
    // The hash identifies the prompt exactly: a reader who has the composed
    // prompt can prove it is the one this run used, and a reader who does not
    // learns that one was recorded and what it hashes to, which is the whole
    // of what the record was ever able to establish. `skill.text_hash` stays,
    // the routing attributes stay (they name the servers, not the prose), and
    // nothing else here carries the text. Records published before this keep
    // theirs: their bytes are signed and this changes no byte of them.
    trace.endSpan(skillFetchSpanId, {
      'skill.text_hash': systemPromptHash,
      ...skillRoutingTraceAttributes(configured),
    });

    // `mcpTools` itself when unlocked; under the lock the same schemas with
    // text that stops inviting other portals (#436, D7). Only the sources this
    // instance configures (sprint 238, D2), narrowed by the selection.
    const offeredTools = inLoop ? inLoop.firstTools : offeredMcpTools(mcpToolsFor(lockedPortal), configured, selection);

    // What this run states about itself (#599 W4, ADR-0033): the date its
    // prompt asserted (#475), the servers its configuration had (#495), the
    // tools it offered, each source's offered-reason and the prompt's
    // components. Written onto the root span when it ends; the packager reads
    // them back from the trace at publish, in preference to its own state.
    const runRecord = runRecordAttributes({
      assertedDate: composition.assertedDate,
      mcpServers: configuredMcpServers(configured),
      toolDefinitions: offeredTools,
      // The router's `not-selected` is recorded as the reader's own state:
      // `reader-off` or `not-consented` (D2 = A).
      sourcesOffered: consent.recordReasons(composition.sourcesOffered),
      components: composition.components,
      // The flows statement in force: its url, hash and date (D2 = A).
      flowsStatement: consent.reference,
    });

    const systemPromptWithoutMcp = `You are a helpful assistant.
When answering questions about civic data, government statistics, or local information,
do your best to provide helpful information based on your training data.
Be honest if you don't have access to current or real-time data.`;

    // Create a TransformStream for SSE
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Helper to write SSE events. A write after the reader has cancelled the
    // stream fails, and that is not the run's failure: the callbacks below do
    // not await their writes, so a rejection here was unhandled, eight of them
    // on one cancelled run (measured at 641a82f, R6 W5), and the final `trace`
    // write threw before `writer.close()` was reached. It resolves either way.
    const writeEvent = async (event: StreamEvent) => {
      try {
        await writer.write(encoder.encode(encodeSSE(event)));
      } catch {
        // The reader cancelled the stream; there is no one left to send to.
      }
    };
    // A model turn that picks a tool is not streamed, and a tool call can run
    // 45 s; a comment line every interval keeps a load balancer from closing
    // the connection as idle (see SSE_KEEPALIVE_INTERVAL_MS). Stopped before close.
    const stopKeepAlive = startSseKeepAlive(writer);

    // What the usage count reads when the run ends (R6 W5, D9): the withMcp
    // panel's last callback, `error` until one says `complete`; and each call
    // that panel's loop reported ended, with whether it failed.
    let usageOutcome: UsageOutcome = 'error';
    const usageCalls: Array<{ name: string; failed?: boolean }> = [];

    // Create callbacks for streaming
    const callbacks: StreamCallbacks = {
      onProgress: (panel: PanelType, message: string, opts?: ProgressOpts) => {
        if (panel === 'withMcp' && opts?.phase === 'tool_complete' && opts.toolName) {
          usageCalls.push({ name: opts.toolName, failed: opts.failed });
        }
        writeEvent({ type: 'progress', panel, message, ...opts } as StreamEvent & { message: string });
      },
      onToken: (panel: PanelType, content: string) => {
        writeEvent({ type: 'token', panel, content } as StreamEvent & { content: string });
      },
      onComplete: (panel: PanelType, result) => {
        if (panel === 'withMcp') usageOutcome = 'complete';
        writeEvent({ type: 'complete', panel, data: result });
      },
      onError: (panel: PanelType, message: string, code?: StreamErrorCode) => {
        if (panel === 'withMcp') usageOutcome = 'error';
        writeEvent({
          type: 'error',
          panel,
          message,
          ...(code ? { code } : {}),
        } as StreamEvent & { message: string; code?: StreamErrorCode });
      },
    };

    // The run starts here: every refusal is behind it. Its count is registered
    // with `after()` now, while the request is open, and written once the
    // stream has closed (`src/lib/usage/count.ts`).
    const usage = startUsageCount();

    // Run queries (both in parallel, or MCP-only when mcpOnly flag is set)
    const runQueries = async () => {
      try {
        // 45s per individual tool call. The route states the value; the race
        // and the timer's disposal live in the loop core (#352) — this file
        // used to arm a timer inside the tool closure and never clear it, so a
        // call that answered in 200 ms left one pending for the rest of the
        // bound.
        const MCP_TOOL_TIMEOUT_MS = 45_000;

        const mcpQuery = queryWithMcpStreaming(
          query,
          model,
          // The tools the record states it offered, as offered.
          offeredTools,
          // Just the transport. Portal injection moved into the core (#359):
          // done here, it ran after the core had recorded the call and
          // stringified its arguments onto the span, so the span reported no
          // portal on exactly the calls that had just been given one. Told the
          // run's selection (R6 W1), so a call to a source it leaves out is
          // refused before any request, as the prompt and the tools left it out.
          // In loop (#644 W1), the session: its transport, bound to the loaded
          // set, and its load step.
          inLoop ?? ((name, args) => callMcpTool(name, args, { selection })),
          systemPromptWithMcp,
          callbacks,
          // Non-throwing: a call to a tool no configured server hosts is refused
          // by the transport as one failed call, not thrown out of the loop here.
          // The same configuration and selection as the transport, so a refused
          // call's span names no source.
          { builder: trace, parentSpanId: trace.rootSpanId, systemPromptHash, resolveToolSource: inLoop ? inLoop.resolveToolSource : (name) => routedSourceId(name, configured, selection) },
          { portal, toolTimeoutMs: MCP_TOOL_TIMEOUT_MS },
          // The loop core refuses a call naming another portal as a rejected
          // call (#436, D7); undefined on an unlocked instance.
          lockedPortal,
        );

        if (mcpOnly) {
          await mcpQuery;
        } else {
          await Promise.all([
            queryWithoutMcpStreaming(query, model, systemPromptWithoutMcp, callbacks),
            mcpQuery,
          ]);
        }
      } catch (error) {
        console.error('Stream error:', errorLogFacts(error));
      } finally {
        try {
          // Finalize trace and send as final SSE event
          trace.endRoot(runRecord);
          const traceJson = trace.finalize();
          stopKeepAlive();
          await writeEvent({ type: 'trace' as StreamEvent['type'], panel: 'withMcp', data: traceJson });
          // A stream the reader cancelled rejects its close; there is nothing
          // left to close it for, and the count is written either way.
          await writer.close().catch(() => {});
        } finally {
          // The response has ended: only now does the count's write start.
          usage.end({
            surface: 'compare-stream',
            session,
            model,
            outcome: usageOutcome,
            sourcesOffered: composition.sourcesOffered,
            toolCalls: usageCalls,
            resolveSource: (name) => routedSourceId(name, configured, selection),
          });
        }
      }
    };

    // Start the queries (non-blocking)
    runQueries();

    // Return the readable stream as SSE
    return new Response(stream.readable, { headers: SSE_HEADERS });
  } catch (error) {
    console.error('Compare stream API error:', errorLogFacts(error));
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
