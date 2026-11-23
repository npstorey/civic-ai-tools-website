/**
 * Images in answers are shown as links.
 *
 * The one override every markdown render site of text a model, a publisher or
 * a reviewer wrote passes its components through: a markdown image renders as
 * a link to its address, in the answer's own link style (a new tab,
 * `noopener noreferrer`). Its text is the image's alt text, or the address
 * when the alt text is empty. An image whose address react-markdown dropped
 * renders its alt text alone.
 *
 * `withImageLinks(components)` returns the caller's components with `img`
 * replaced, so the override wins whatever the caller passed.
 * `markdown-image-links-guard.test.ts` fails on a render site that does not
 * use it; its one exception is the roadmap, the instance's own document.
 */
import type { Components } from 'react-markdown';

/** react-markdown hands every override its hast `node`; it is not spread onto the element. */
type ImageProps = React.ComponentPropsWithoutRef<'img'> & { node?: unknown };

export function MarkdownImageLink({ src, alt }: ImageProps) {
  const address = typeof src === 'string' ? src : '';
  const text = alt && alt.trim() !== '' ? alt : address;
  if (address === '') return text ? <>{text}</> : null;
  return (
    <a href={address} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
      {text}
    </a>
  );
}

export function withImageLinks(components: Components = {}): Components {
  return { ...components, img: MarkdownImageLink };
}
