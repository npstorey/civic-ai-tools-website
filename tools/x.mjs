// THROWAWAY — cold-read probe for N8 criterion 5. Not merged.
// A tool-calling model call under a top-level directory the repository did not
// have. If the registry guard's universe is derived from `git ls-files`, this
// file reds the suite on the runner. Deleted with its branch.
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.NOT_A_REAL_KEY });

export async function probe() {
  return client.chat.completions.create({
    model: 'probe',
    messages: [{ role: 'user', content: 'probe' }],
    tools: [{ type: 'function', function: { name: 'probe', parameters: {} } }],
  });
}
