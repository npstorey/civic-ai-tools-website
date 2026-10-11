/**
 * The talks `/talks` lists, one entry per deck in `_decks/` (website #165).
 *
 * The deck route serves any `.html` file dropped into `_decks/` with no code
 * change; this list is what gives a deck its title, event and date on the
 * index. `talks.test.ts` fails when a deck has no entry here or an entry
 * names a deck that is not there, so a new deck cannot be served unlisted.
 */
export interface Talk {
  /** The file name in `_decks/`, which is also the URL segment under `/talks/`. */
  deck: string;
  title: string;
  event: string;
  /** ISO date the talk was given. */
  date: string;
}

export const TALKS: readonly Talk[] = [
  {
    deck: 'ctfg-vibe-code-2026-07.html',
    title: 'How Civic AI Tools ships',
    event: 'Civic Tech Field Guide, Vibe Code Show & Tell',
    date: '2026-07-10',
  },
];
