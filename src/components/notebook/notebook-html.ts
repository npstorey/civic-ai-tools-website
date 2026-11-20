/**
 * Notebook HTML output is sanitized before display.
 *
 * `sanitizeNotebookHtml` rebuilds an output's `text/html` from an allowlist:
 * table elements and plain formatting, each with only the numeric attributes
 * a table needs (`border`, `colspan`, `rowspan`, `span`). Everything else is
 * left out:
 *   - an element outside the allowlist is dropped and its text kept, except
 *     the elements whose content is not text (`script`, `style`, `iframe`,
 *     `noscript`, `template` and the others in `DROPPED_WITH_CONTENT`), which
 *     are dropped with their content;
 *   - every other attribute is dropped;
 *   - comments, doctypes and processing instructions are dropped.
 *
 * The result is written from tokens, never copied from the input: text is
 * escaped (`<` and `>` always; `&` unless it starts a well-formed character
 * reference), attribute values are digits, and every element left open is
 * closed. However a browser re-parses it, it can only find the elements and
 * attributes written here.
 *
 * The record's stored package is not changed: this runs at render, on the
 * value the component is handed.
 */

const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'div', 'span', 'p', 'br', 'hr', 'b', 'i', 'u', 's', 'strong', 'em', 'small', 'sub', 'sup',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

const VOID_ELEMENTS: ReadonlySet<string> = new Set(['br', 'hr', 'col']);

const NUMERIC_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  table: new Set(['border']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
};

/** Elements whose content is dropped with them: a browser does not read it as text. */
const DROPPED_WITH_CONTENT: ReadonlySet<string> = new Set([
  'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template',
  'object', 'select',
]);

const CHARACTER_REFERENCE = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
const NAME_END = /[\s/>]/;

function escapeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '&') {
      const m = CHARACTER_REFERENCE.exec(text.slice(i, i + 40));
      if (m) {
        out += m[0];
        i += m[0].length - 1;
      } else {
        out += '&amp;';
      }
    } else {
      out += c;
    }
  }
  return out;
}

interface Tag { name: string; end: boolean; attributes: Map<string, string>; next: number }

const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);

/** Read a start or end tag whose name begins at `at`; `next` is past its `>`, or -1 when the input ends inside it. */
function readTag(html: string, at: number, end: boolean): Tag {
  let i = at;
  while (i < html.length && !NAME_END.test(html[i])) i++;
  const name = html.slice(at, i).toLowerCase();
  const attributes = new Map<string, string>();
  while (i < html.length) {
    const c = html[i];
    if (c === '>') return { name, end, attributes, next: i + 1 };
    if (/\s/.test(c) || c === '/') { i++; continue; }
    const nameStart = i;
    i++;
    while (i < html.length && !/[\s/>=]/.test(html[i])) i++;
    const attribute = html.slice(nameStart, i).toLowerCase();
    while (i < html.length && /\s/.test(html[i])) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < html.length && /\s/.test(html[i])) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return { name, end, attributes, next: -1 };
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < html.length && !/[\s>]/.test(html[i])) i++;
        value = html.slice(valueStart, i);
      }
    }
    if (!attributes.has(attribute)) attributes.set(attribute, value);
  }
  return { name, end, attributes, next: -1 };
}

/** Past the end tag that closes a dropped element's content, or the input's end. */
function skipContent(html: string, from: number, name: string): number {
  const close = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
  close.lastIndex = from;
  const m = close.exec(html);
  if (!m) return html.length;
  const tag = readTag(html, m.index + 2, true);
  return tag.next < 0 ? html.length : tag.next;
}

/** Past a comment, a doctype, or a processing instruction starting at `at`. */
function skipMarkupDeclaration(html: string, at: number): number {
  if (html.startsWith('<!--', at)) {
    if (html.startsWith('>', at + 4)) return at + 5;
    if (html.startsWith('->', at + 4)) return at + 6;
    const m = /--!?>/g;
    m.lastIndex = at + 4;
    const found = m.exec(html);
    return found ? found.index + found[0].length : html.length;
  }
  const close = html.indexOf('>', at);
  return close < 0 ? html.length : close + 1;
}

function allowedAttributes(name: string, attributes: Map<string, string>): string {
  const allowed = NUMERIC_ATTRIBUTES[name];
  if (!allowed) return '';
  let out = '';
  for (const [attribute, value] of attributes) {
    const digits = value.trim();
    if (allowed.has(attribute) && /^[0-9]{1,4}$/.test(digits)) out += ` ${attribute}="${digits}"`;
  }
  return out;
}

export function sanitizeNotebookHtml(html: string): string {
  let out = '';
  const open: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += escapeText(html.slice(i));
      break;
    }
    out += escapeText(html.slice(i, lt));
    const next = html[lt + 1];
    if (next === '!' || next === '?') {
      i = skipMarkupDeclaration(html, lt);
      continue;
    }
    if (next === '/' && isLetter(html[lt + 2])) {
      const tag = readTag(html, lt + 2, true);
      if (tag.next < 0) break;
      i = tag.next;
      const at = open.lastIndexOf(tag.name);
      if (at >= 0) {
        while (open.length > at) out += `</${open.pop()}>`;
      }
      continue;
    }
    if (next === '/') {
      i = skipMarkupDeclaration(html, lt);
      continue;
    }
    if (!isLetter(next)) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    const tag = readTag(html, lt + 1, false);
    if (tag.next < 0) break;
    i = tag.next;
    if (tag.name === 'plaintext') break;
    if (DROPPED_WITH_CONTENT.has(tag.name)) {
      i = skipContent(html, i, tag.name);
      continue;
    }
    if (!ALLOWED_ELEMENTS.has(tag.name)) continue;
    out += `<${tag.name}${allowedAttributes(tag.name, tag.attributes)}>`;
    if (!VOID_ELEMENTS.has(tag.name)) open.push(tag.name);
  }
  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}
