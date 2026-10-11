import { prose, sectionSpacing } from '@/styles/page-styles';
import { pageTitle } from '@/lib/brand-config';
import { TALKS } from './talks';

export const metadata = {
  title: pageTitle('Talks'),
  description: 'Talks about the project, with their slides.',
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function TalksPage() {
  const talks = [...TALKS].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>
      <section style={sectionSpacing}>
        <h1 style={{ marginBottom: '16px' }}>Talks</h1>
        <p style={prose}>
          Talks about the project, newest first. Each deck is published as it was given, so its
          figures are as of the talk&apos;s date.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {talks.map((talk) => (
            <li key={talk.deck} style={{ marginBottom: '24px' }}>
              <a href={`/talks/${talk.deck}`} style={{ fontSize: '18px', fontWeight: 600 }}>
                {talk.title}
              </a>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                {talk.event} &middot; {formatDate(talk.date)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
