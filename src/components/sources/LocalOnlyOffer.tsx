'use client';

/**
 * Text 3, the local-only offer (R6 W3, #632; D10 = A): the offer, then the
 * deployment guide linked when this instance names one
 * (`SITE_DEPLOYMENT_GUIDE_URL`, carried by `/api/flows` as
 * `links.deploymentGuide`), or the sentence that says it names none. The
 * card, the Sources panel and the dashboard's Sources tab show it.
 */

import type { FlowsStatement } from '@/lib/flows/statement';
import { GUIDE_LINK_TEXT, GUIDE_SENTENCE, LOCAL_ONLY_OFFER, NO_GUIDE_SENTENCE } from '@/lib/sources/copy';

export default function LocalOnlyOffer({ statement }: { statement: FlowsStatement | null }) {
  const guide = statement?.links.deploymentGuide;
  const [before, after] = GUIDE_SENTENCE.split(GUIDE_LINK_TEXT);
  return (
    <>
      {LOCAL_ONLY_OFFER}{' '}
      {guide ? (
        <>
          {before}
          <a href={guide} target="_blank" rel="noopener noreferrer">
            {GUIDE_LINK_TEXT}
          </a>
          {after}
        </>
      ) : (
        NO_GUIDE_SENTENCE
      )}
    </>
  );
}
