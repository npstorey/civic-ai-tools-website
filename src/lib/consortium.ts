// Consortium membership data for the /project page.
//
// PLACEHOLDERS ONLY until membership is cleared for publication: real member
// names, blurbs, and logos must NOT appear anywhere in this repo (code,
// comments, commits, PR text) before that clearance. When cleared, real
// members land as a pure data swap in this array — the page renders whatever
// is here and needs no other changes.

export interface ConsortiumMember {
  /** Organization or program name. */
  name: string;
  /** One-to-two sentence description of the member and its role. */
  blurb: string;
  /** Path to a logo image under /public, or null to render a neutral block. */
  logoSrc: string | null;
  /** Member's own site, or null if none should be linked. */
  url: string | null;
  /** Short role label, e.g. "Founding member". */
  role: string;
}

export const CONSORTIUM_MEMBERS: ConsortiumMember[] = [
  {
    name: 'Member One — placeholder',
    blurb:
      'Placeholder entry. A real member description will replace this text when membership is cleared for publication.',
    logoSrc: null,
    url: null,
    role: 'Placeholder',
  },
  {
    name: 'Member Two — placeholder',
    blurb:
      'Placeholder entry. A real member description will replace this text when membership is cleared for publication.',
    logoSrc: null,
    url: null,
    role: 'Placeholder',
  },
  {
    name: 'Member Three — placeholder',
    blurb:
      'Placeholder entry. A real member description will replace this text when membership is cleared for publication.',
    logoSrc: null,
    url: null,
    role: 'Placeholder',
  },
];
