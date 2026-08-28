// THROWAWAY — Wave N7 (#345) anchor criterion 2, demonstrated on a runner.
//
// This file exists to make the model-call registry test go red in CI, proving
// the guard fails on a runner and not only on a developer's machine. It is
// pushed on a disposable branch, never merged, and the branch is deleted as
// soon as the run is recorded.
//
// It is deliberately NOT on the allowlist in
// src/lib/model-loop/model-call-registry.test.ts.
import OpenAI from 'openai';

export async function unregisteredModelCall(client = new OpenAI()) {
  return client.chat.completions.create({
    model: 'fake/model',
    messages: [{ role: 'user', content: 'this call site is not on the registry' }],
    max_tokens: 16,
  });
}
