import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Standalone talk decks, served FROM the `(marketing)` route group (#259 P4).
 *
 * WHY THIS ROUTE EXISTS AT ALL. The decks used to sit in `public/talks/`.
 * Files under `public/` are not routes, so `classifyPath()` answered
 * `'other'` for them — and `'other'` is served under EVERY host role. A deck
 * that only makes sense as part of the reference project's own website was
 * therefore reachable on an operator instance's app host, verified live at
 * 200 during #259. Moving the bytes under `src/app/(marketing)/` puts them
 * behind a real route, and a real route classifies: with `/talks` in
 * `MARKETING_PATHS`, the deck now serves on a marketing-role host and 404s
 * on an app-role one, by the same mechanism as `/about` and `/learn`.
 *
 * THE ALTERNATIVE WAS REJECTED DELIBERATELY. Teaching `classifyPath()` about
 * asset path prefixes would have kept the bytes in `public/` at the cost of
 * a second hand-maintained mirror of the filesystem — the exact drift
 * `host-routing.paths.test.ts` exists to prevent, and the reverse of the
 * position `src/proxy.ts` records ("the matcher is an optimization, the
 * function is the authority"). A route is the mechanism the repo already
 * has for "this URL belongs to that group".
 *
 * THE URL IS PRESERVED EXACTLY. `/talks/ctfg-vibe-code-2026-07.html` is a
 * link people already hold; the filename is the `[deck]` segment, and the
 * response body is the file's bytes verbatim with no layout, no wrapper and
 * no transformation, so a marketing-role host serves what it always served.
 *
 * NOTHING IS READ AT REQUEST TIME. `dynamicParams = false` plus
 * `generateStaticParams()` enumerating the deck directory means every deck
 * is prerendered at build; `next build` emits the bodies and the runtime
 * serves them as static output. That is why this needs no
 * `outputFileTracingIncludes` entry (and no `check-standalone-assets.mjs`
 * entry): the standalone server never touches `_decks/` at all. Unknown deck
 * names 404 without executing this handler.
 *
 * ADDING A DECK is dropping an `.html` file into `_decks/`. The underscore
 * prefix keeps the directory out of routing (a Next private folder), the
 * scan below picks the file up at build, and no code change is required —
 * which matters because these files are produced by an authoring workflow
 * that lives outside this repo.
 */

/** Where the deck bytes live, beside this route rather than in `public/`. */
const DECK_DIR = path.join(process.cwd(), 'src', 'app', '(marketing)', 'talks', '_decks');

/** Only `.html` decks are served; anything else in the directory is ignored. */
const DECK_EXTENSION = '.html';

function deckFiles(): string[] {
  return readdirSync(DECK_DIR).filter((name) => name.endsWith(DECK_EXTENSION));
}

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams(): { deck: string }[] {
  return deckFiles().map((deck) => ({ deck }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deck: string }> },
): Promise<Response> {
  const { deck } = await params;

  // Defence in depth. `dynamicParams = false` already restricts this handler
  // to the generated set, so this can only fire if that guarantee changes —
  // and a path-traversal read out of an asset directory is not a failure
  // mode worth leaving to one framework flag.
  if (!deckFiles().includes(deck)) {
    return new Response('Not found', { status: 404 });
  }

  const body = readFileSync(path.join(DECK_DIR, deck));
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
