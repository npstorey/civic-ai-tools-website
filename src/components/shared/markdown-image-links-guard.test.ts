// The rule: images in answers are shown as links, at every markdown render site.
//
// THE PROPERTY. Every render site of `react-markdown` in a tracked file of the
// JavaScript/TypeScript family (tests excluded) passes its `components` through
// `withImageLinks` from `src/components/shared/markdown-image-links.tsx`, the
// one shared override. A render site is a JSX element, or a call, naming a
// component `react-markdown` exports (its default, `MarkdownAsync` or
// `MarkdownHooks`) under the name the file imported it as.
//
// THE ONE EXCEPTION. `src/components/roadmap/RoadmapBody.tsx`, which renders
// the instance's own roadmap document. The guard fails both ways: a site
// without the override, and an exception that no longer holds a site.
//
// THE UNIVERSE is `git ls-files`, so a new file is seen once it is added
// (`git add`), wherever it sits.
//
// BLIND SPOTS, stated. A component reached through `require('react-markdown')`,
// through a re-export from another module, or passed on as a value; and a
// spread attribute on the element (refused here, since it could replace
// `components` after it).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const OVERRIDE_MODULE = 'src/components/shared/markdown-image-links.tsx';
const OVERRIDE_NAME = 'withImageLinks';
const EXCEPTIONS = ['src/components/roadmap/RoadmapBody.tsx'];
const RENDERING_EXPORTS = new Set(['default', 'MarkdownAsync', 'MarkdownHooks']);

interface Site { file: string; line: number; ok: boolean; why: string }

/** True when `specifier`, written in `file`, names the shared override's module. */
function namesOverrideModule(file: string, specifier: string): boolean {
  const target = OVERRIDE_MODULE.replace(/\.tsx$/, '');
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`.replace(/\.tsx$/, '') === target;
  if (specifier.startsWith('.')) return path.posix.join(path.posix.dirname(file), specifier).replace(/\.tsx$/, '') === target;
  return false;
}

/** Every `react-markdown` render site in one file's source, and whether it uses the override. */
function renderSites(file: string, source: string): Site[] {
  if (!source.includes('react-markdown')) return [];
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const components = new Set<string>();
  let override: string | null = null;
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (from === 'react-markdown') {
      if (clause.name) components.add(clause.name.text);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if (!el.isTypeOnly && RENDERING_EXPORTS.has((el.propertyName ?? el.name).text)) components.add(el.name.text);
        }
      }
    } else if (namesOverrideModule(file, from) && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) if ((el.propertyName ?? el.name).text === OVERRIDE_NAME) override = el.name.text;
    }
  }
  const usesOverride = (expr: ts.Expression | undefined): boolean =>
    override !== null && expr !== undefined && ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === override;
  const sites: Site[] = [];
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && components.has(node.tagName.text)) {
      const props = node.attributes.properties;
      const spread = props.some((p) => ts.isJsxSpreadAttribute(p));
      const attr = props.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'components');
      const value = attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
      const ok = !spread && usesOverride(value);
      sites.push({ file, line: at(node), ok, why: ok ? '' : spread ? 'a spread attribute' : attr ? 'components is not the override' : 'no components' });
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && components.has(node.expression.text)) {
      const arg = node.arguments[0];
      let ok = false;
      let why = 'no components';
      if (arg && ts.isObjectLiteralExpression(arg)) {
        if (arg.properties.some((p) => ts.isSpreadAssignment(p))) why = 'a spread property';
        else {
          const prop = arg.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'components');
          const value = prop && ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
          ok = usesOverride(value);
          if (!ok && prop) why = 'components is not the override';
        }
      }
      sites.push({ file, line: at(node), ok, why: ok ? '' : why });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

/** The guard's findings over a set of files: sites without the override, and exceptions with no site. */
function findings(files: Map<string, string>, exceptions: string[]): { missing: Site[]; staleExceptions: string[]; sites: Site[] } {
  const sites = [...files].flatMap(([file, source]) => renderSites(file, source));
  return {
    sites,
    missing: sites.filter((s) => !s.ok && !exceptions.includes(s.file)),
    staleExceptions: exceptions.filter((e) => !sites.some((s) => s.file === e)),
  };
}

function trackedFiles(): Map<string, string> {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  const out = new Map<string, string>();
  for (const file of listed) {
    if (!/\.(c|m)?[jt]sx?$/.test(file) || /\.test\.(c|m)?[jt]sx?$/.test(file)) continue;
    const full = path.join(REPO, file);
    if (fs.existsSync(full)) out.set(file, fs.readFileSync(full, 'utf8'));
  }
  return out;
}

test('images in answers are shown as links: every react-markdown render site in a tracked file uses the shared override', (t) => {
  const { sites, missing, staleExceptions } = findings(trackedFiles(), EXCEPTIONS);
  t.diagnostic(`render sites: ${sites.map((s) => `${s.file}:${s.line} ${s.ok ? 'override' : s.why}`).join('; ')}`);
  assert.ok(sites.length > 0, 'premise: the scan found no render site');
  assert.deepEqual(missing.map((s) => `${s.file}:${s.line} (${s.why})`), [], 'a render site does not use the shared override');
  assert.deepEqual(staleExceptions, [], 'an exception no longer holds a render site');
});

test('the guard fails on a render site without the override, and on an exception with no site', () => {
  const plant = new Map([
    ['src/components/Planted.tsx', `import ReactMarkdown from 'react-markdown';\nexport const A = ({ t }: { t: string }) => <ReactMarkdown>{t}</ReactMarkdown>;\n`],
    ['src/components/PlantedNamed.tsx', `import { MarkdownHooks as M } from 'react-markdown';\nimport { withImageLinks } from '@/components/shared/markdown-image-links';\nexport const B = ({ t, p }: { t: string; p: object }) => <M components={withImageLinks()} {...p}>{t}</M>;\n`],
    ['src/components/PlantedCall.tsx', `import ReactMarkdown from 'react-markdown';\nexport const C = (t: string) => ReactMarkdown({ children: t, components: {} });\n`],
    ['src/components/Kept.tsx', `import ReactMarkdown from 'react-markdown';\nimport { withImageLinks } from './shared/markdown-image-links';\nexport const D = ({ t }: { t: string }) => <ReactMarkdown components={withImageLinks({})}>{t}</ReactMarkdown>;\n`],
  ]);
  const { missing, staleExceptions } = findings(plant, ['src/components/Gone.tsx']);
  assert.deepEqual(missing.map((s) => `${s.file} ${s.why}`), [
    'src/components/Planted.tsx no components',
    'src/components/PlantedNamed.tsx a spread attribute',
    'src/components/PlantedCall.tsx components is not the override',
  ]);
  assert.deepEqual(staleExceptions, ['src/components/Gone.tsx']);
});
