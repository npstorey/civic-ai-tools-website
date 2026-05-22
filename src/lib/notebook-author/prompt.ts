/**
 * Text scaffolding for executed notebooks (Phase B, ADR-0005 §1).
 *
 * The "prompt" name is from §5.1 of the project plan (N2 — LLM prompt
 * template for notebook authoring). In practice, Phase B is mostly
 * deterministic assembly: cells 0..4 + the footer are templated here, the
 * step-pair cells are translated from Phase A's tool calls in
 * `./tool-to-cell.ts`, and the synthesis-cell body reuses the chat-flow's
 * final answer text. No additional LLM call is required in Phase B for v1.
 *
 * The helper-functions cell (cell 3) is populated by reading the .py
 * source files in `./helpers/*.py` per ADR-0005 §3 (inline-embedded
 * source-of-truth).
 */

/** Pinned scientific-stack versions; MUST match `scripts/build-sandbox-snapshot.ts`.
 *  All four pins target releases with prebuilt CPython 3.13 wheels so pip
 *  install on the Vercel Sandbox python3.13 runtime never needs a C
 *  compiler (which the runtime image does not ship). */
export const PINNED_LIBRARIES = {
  pandas: '2.2.3',
  requests: '2.32.3',
  numpy: '2.1.3',
  matplotlib: '3.9.2',
} as const;

/** Default Python runtime version baked into the Vercel Sandbox snapshot. */
export const PYTHON_RUNTIME_VERSION = '3.13';

/** Reverse-DNS extension keys per OES §9.1.4. */
export const NOTEBOOK_EXTENSION_KEY = 'org.civicaitools.notebook';
export const EXECUTION_EXTENSION_KEY = 'org.civicaitools.execution';

export function pinnedLibrariesPipList(): string {
  return Object.entries(PINNED_LIBRARIES)
    .map(([name, version]) => `${name}==${version}`)
    .join(' ');
}

export function buildCell0Source(args: {
  query: string;
  generatedAt: string;
  portals: readonly string[];
}): string {
  const portalLine = args.portals.length === 0
    ? ''
    : `**Portal${args.portals.length > 1 ? 's' : ''}:** ${args.portals.join(', ')}  \n`;
  return [
    '# Civic AI Data Analysis',
    '',
    `**Query:** ${args.query}  `,
    portalLine.trimEnd(),
    `**Generated:** ${args.generatedAt} via [civicaitools.org](https://civicaitools.org)`,
    '',
    '## How to use this notebook',
    '',
    'This notebook contains a complete, reproducible analysis of the query above.',
    'Every code cell that fetches data uses the helper functions defined below,',
    'so the same numbers can be reproduced against live data by re-running cells',
    'top-to-bottom. The final "Synthesis" cell explains what the data shows.',
    '',
    '## Notebook structure',
    '',
    '- **Environment setup** — Python version check + pip install of pinned versions.',
    '- **Imports** — `requests`, `pandas`, `numpy`, `matplotlib`.',
    '- **Helper functions** — `fetch_socrata`, `fetch_data_commons`, `fetch_opencontext`',
    '  (only the helpers this analysis actually uses are included).',
    '- **Data analysis pipeline** — one step per discovery call.',
    '- **Synthesis** — narrative answer derived from the data above.',
    '- **Comparison: original vs. current** — appended at publish time; shows',
    '  whether the numbers have drifted since the notebook was first executed.',
    '- **Citations & reproducibility** — datasets, runtime, and re-run guidance.',
  ].filter(line => line !== '').join('\n');
}

export function buildCell1Source(): string {
  return [
    '# Environment setup',
    '#',
    '# Check the Python runtime and install pinned scientific-stack versions.',
    '# Re-execute this cell on a fresh kernel; subsequent runs are no-ops.',
    '',
    'import sys',
    `print(f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")`,
    '',
    '# !pip install --quiet ' + pinnedLibrariesPipList(),
  ].join('\n');
}

export function buildCell2Source(): string {
  return [
    '# Imports',
    'import os',
    'import json',
    'import requests',
    'import pandas as pd',
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    '',
    'pd.set_option("display.max_columns", 80)',
    'pd.set_option("display.width", 200)',
  ].join('\n');
}

export const CELL_4_HEADER = '## Data Analysis Pipeline\n\nEach step below corresponds to one discovery call from the original analysis. The same helper functions and arguments are used so the analysis is fully reproducible.';

export function buildFooterCellSource(args: {
  citations: readonly { id: string; label: string; url: string }[];
  generatedAt: string;
  modelName: string;
}): string {
  const lines = [
    '---',
    '',
    '## Citations',
    '',
  ];
  if (args.citations.length === 0) {
    lines.push('*(No external dataset citations were captured for this analysis.)*');
  } else {
    for (const c of args.citations) {
      lines.push(`- [${c.label || c.id}](${c.url})`);
    }
  }
  lines.push(
    '',
    '## Reproducibility',
    '',
    `- **Runtime:** Python ${PYTHON_RUNTIME_VERSION} with pinned libraries (\`${pinnedLibrariesPipList()}\`).`,
    `- **Author model:** ${args.modelName} via OpenRouter.`,
    `- **Generated:** ${args.generatedAt}.`,
    '',
    'To re-execute: open in any Jupyter environment with the pinned versions installed and run all cells top-to-bottom. Compare original-vs-current values via the comparison cell appended at publish time.',
    '',
    'Generated by [Civic AI Tools](https://civicaitools.org).',
  );
  return lines.join('\n');
}
