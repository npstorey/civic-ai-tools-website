/**
 * POC MCP-LIVE-SOURCE — prove the model credential with a call whose failure
 * you can see, before anything is created or billed.
 *
 * WHY THIS IS A MODULE AND NOT A FUNCTION IN EACH RUNNER. It is a real
 * `chat.completions.create`, so every file that carries one is a call site
 * `src/lib/model-loop/model-call-registry.test.ts` derives from `git ls-files`
 * and holds to an allowlist. Two runners needing the same probe is exactly the
 * shape that produces two entries describing one behaviour — the thing that
 * list exists to prevent. One implementation, one entry.
 *
 * WHY IT EXISTS AT ALL. The first questions run booted a sandbox and drove ten
 * loops the endpoint answered "401 Missing Authentication header", because step
 * 0 had only asked whether a key was PRESENT. A non-empty string passes that
 * test whatever it is, and the value was an `op://` reference — a pointer to a
 * credential, not one.
 *
 * One turn, `max_tokens: 1`, no `tools`: the allow-listed non-loop class.
 */

/**
 * Probe every model the run intends to use. Returns the per-model timings on
 * success; throws the endpoint's own error on the first failure, for the caller
 * to classify and report.
 *
 * EVERY model, not just the first: a key good for the server default and not
 * for the picker default would otherwise be found eight loops and one sandbox
 * later.
 */
export async function probeCredential(client, models) {
  const results = [];
  for (const model of models) {
    const t0 = Date.now();
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
    results.push({ model, ms: Date.now() - t0, totalTokens: r?.usage?.total_tokens ?? null });
  }
  return results;
}

export const PROBE_COMMAND = (model) =>
  `client.chat.completions.create({ model: '${model}', max_tokens: 1 })  — one turn, no tools`;
