// The record page's Producer Profile label (R10 P5, civic-ai-tools#289, hub
// ADR-0038). A record declaring the subtype this site declares,
// `ai-assisted-analysis/civicaitools-v1`, reads the subtype's display name,
// linked to its guidance bundle. The bundle's url is the one in verify-core's
// subtype table row, never written here: a later revision of the bundle moves
// the row's pin, and this link follows it. Any other value, and a row with no
// bundle, returns null, and the page prints the value as before.

import { CIVICAITOOLS_V1_PRODUCER_PROFILE } from '@typedstandards/civic-typed-harness';
import { PRODUCER_PROFILE_SUBTYPES } from './profiles.ts';
import { PRODUCER_PROFILE_LABEL } from '../sources/copy.ts';

export interface ProducerProfileLink {
  /** The label's whole text. */
  text: string;
  /** The subtype's guidance bundle, from verify-core's table row. */
  href: string;
}

/** The linked label for `producerProfile`, or null to print the value as before. */
export function producerProfileLink(producerProfile: string): ProducerProfileLink | null {
  if (producerProfile !== CIVICAITOOLS_V1_PRODUCER_PROFILE) return null;
  const row = Object.hasOwn(PRODUCER_PROFILE_SUBTYPES, producerProfile) ? PRODUCER_PROFILE_SUBTYPES[producerProfile] : undefined;
  const href = row?.bundle?.url;
  return href ? { text: PRODUCER_PROFILE_LABEL.civicaitoolsV1, href } : null;
}
