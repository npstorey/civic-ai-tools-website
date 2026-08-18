import type { Metadata } from 'next';
import { getBrandName } from '@/lib/brand-config';

/**
 * Marketing-group metadata (#259 P4, D6).
 *
 * This copy used to sit in the ROOT layout, where both route groups
 * inherited it — so an operator instance's gated `/ask` page advertised
 * itself with "- MCP Demo" and the with-and-without-MCP comparison pitch.
 * The copy is not wrong, it was in the wrong place: it describes the
 * reference project's own website, which is exactly what the `(marketing)`
 * group is since #259.
 *
 * Placement, not deletion, and it earns its keep three ways. The root layout
 * keeps nothing that names one deployment; the marketing home page — a
 * client component, so it cannot export `metadata` itself — keeps the exact
 * title and description it has always rendered; and a later extraction of
 * the marketing site into its own repo carries this file with the pages it
 * describes, which is the liftability property #259 is holding open.
 *
 * Per-page metadata still wins over this: `/about`, `/learn` and the rest
 * set their own titles and inherit only the description and cards. The
 * default title below is therefore the HOME page's title.
 */
const brandName = getBrandName();

const DEMO_DESCRIPTION =
  'See the difference MCP makes when querying civic data. Compare AI responses with and without live data access.';

export const metadata: Metadata = {
  title: brandName !== null ? `${brandName} - MCP Demo` : 'MCP Demo',
  description:
    'See the difference MCP (Model Context Protocol) makes when querying civic data. Compare AI responses with and without live data access.',
  openGraph: {
    title: brandName !== null ? `${brandName} - MCP Demo` : 'MCP Demo',
    description: DEMO_DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: brandName !== null ? `${brandName} - MCP Demo` : 'MCP Demo',
    description: DEMO_DESCRIPTION,
  },
};

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
