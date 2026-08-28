// THROWAWAY — wave N8 P3, acceptance criterion 3 (#356).
//
// A tool-calling model call under a top-level directory this repository does
// not have. At `cecc959` the registry guard walked
// `SCAN_DIRECTORIES = ['src', 'scripts']` plus a one-level read of the
// repository root, so this file was invisible to it and the suite stayed green.
// With the scan derived from `git ls-files` it is seen the moment it is
// tracked, and both assertions in
// src/lib/model-loop/model-call-registry.test.ts report it by name.
//
// This file exists only to be shown red on a runner. The pull request carrying
// it is closed unmerged, and it does not survive on the phase branch.

export async function fifthLoop(client, prompt, tools) {
  return client.chat.completions.create({
    model: 'some/model',
    messages: [{ role: 'user', content: prompt }],
    tools,
    tool_choice: 'auto',
  });
}
