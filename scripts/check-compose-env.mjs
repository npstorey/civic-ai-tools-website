#!/usr/bin/env node
/**
 * Compose environment-coverage guard.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. `docker-compose.yml` hands the app
 * service an explicit `environment` map, so a variable not named there never
 * reaches the container — no error, no warning, no log line. Twenty-three
 * documented variables had accumulated in that gap: the whole branding seam,
 * the content-source seam, host topology, the rate-limit and token knobs.
 * An operator could set `SITE_BRAND_NAME`, restart, watch nothing change, and
 * have nothing to debug against. Each of those features shipped with its own
 * deploy-guide section and none of them touched the compose file; per-feature
 * review cannot see a gap that is defined by absence.
 *
 * WHAT IT CHECKS. `scripts/preflight-env.mjs` ENV_SPEC already enumerates
 * every variable the app reads, and is the authority here. This script reads
 * the compose file, resolves the profile the compose file itself pins (its
 * literal DB_DRIVER / BLOB_DRIVER / EXECUTOR_DRIVER values), and demands that
 * every variable that profile actually reads is deliverable:
 *
 *   1. COVERAGE — a variable the app reads at run time must appear in the app
 *      service's `environment`; a variable read at build time must appear in
 *      its `build.args`; one read at both must appear in both (see `readBy`
 *      in ENV_SPEC). Not-applicable variables (a driver this profile does not
 *      select) and `external-tool` variables are excluded — an instance must
 *      not be asked to deliver what it will never read. Coverage is satisfied
 *      by EITHER accepted name for the publisher-identity set: since the
 *      2026-08-19 vocabulary settlement each of those has a canonical
 *      `PUBLISHER_*` spelling and a prior-era `EVIDENCE_*` one, and the app
 *      reads both (Appendix J; civic-ai-tools#160). Since the cutover the
 *      compose file names the canonical spellings, and lists the prior-era
 *      twin beside each BARE pass-through so an env file written before the
 *      settlement still delivers its values (a bare entry sets the variable
 *      only when the caller has it, so the pair is safe). A NOTE lists every
 *      prior-era name found: with a canonical twin present it is that
 *      deliberate pair; alone, the entry still names the prior-era spelling
 *      and the canonical one is the entry to move to. The NOTE says which
 *      spelling is canonical and stops there (website#30 P6 F8): the two
 *      renames sharing this mechanism have different lifetimes — the
 *      publisher-identity set has a documented removal at a future major
 *      version, MODEL_API_KEY's prior-era name has no removal scheduled — and
 *      neither is the compose file's business.
 *   2. FORM — an `environment` entry written `${NAME:-}` is rejected. That
 *      form does NOT pass a variable through: it always sets the variable, to
 *      the empty string when the caller's environment has none. Empty is not
 *      absent. `PUBLISHER_TRUST_REGISTRY_LEGACY_URL` is the proof — unset means
 *      "emit the legacy registry URL in the signed sidecar", empty means "omit
 *      it" (src/lib/site-config.ts) — and `SIGN_IN_ALLOWLIST`, `ROADMAP_RAW_URL`
 *      and the host-topology trio all carry meaning in their absence too. Bare
 *      `NAME:` is the form that leaves an unset variable unset.
 *   3. DRIFT, the other way — a variable in the app service's `environment`
 *      that ENV_SPEC does not declare under EITHER of its accepted names.
 *      Either the app stopped reading it, or the inventory is stale; both are
 *      worth knowing.
 *   4. THE IMAGE BUILD (#434). A build argument reaches `next build` only if
 *      the Dockerfile stage that runs the build declares a matching `ARG`:
 *      Docker hands a build arg to no stage that does not, and says nothing.
 *      So every name in the app service's `build.args`, and every ENV_SPEC
 *      variable read at build time, must have an `ARG` in that stage, above
 *      the `RUN` that builds. The stage is DERIVED, never named: from the
 *      service's `build.target` (Docker's default, the last stage, when it
 *      names none), follow `FROM <stage>`, `COPY --from=<stage>` and
 *      `RUN --mount=…from=<stage>` to every stage the target needs, and take
 *      each `RUN` among them whose command reaches `next build` — directly,
 *      or through `npm run` scripts resolved in the build context's
 *      `package.json`. Finding no such `RUN` is a failure, not a pass: a check
 *      that cannot find the build cannot say that anything reaches it. When
 *      this was added, six build args had no `ARG` — the four footer
 *      variables, SITE_DEFAULT_PORTAL and SITE_NOINDEX — so every
 *      compose-built image prerendered its pages with them unset.
 *
 * It reads NO values from the environment and prints none: it compares
 * checked-in files — the compose file, the Dockerfile and `package.json` in
 * the app service's build context, and ENV_SPEC. Exit 0 clean, 1 on any
 * failure.
 *
 *   node scripts/check-compose-env.mjs        # or: npm run check:compose-env
 *
 * The pure functions are exported and covered by
 * scripts/check-compose-env.test.mjs, which `npm test` globs — so the guard
 * gates locally and in CI even if the dedicated CI step is ever dropped.
 */

import { readFileSync } from 'node:fs';
import { dirname, posix, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_SPEC, resolveDrivers, resolveSpec } from './preflight-env.mjs';

/** The service the app runs in. */
export const APP_SERVICE = 'app';

/** A scalar as written, without one pair of surrounding quotes. */
const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, '$2');

/**
 * Minimal reader for the one compose shape this repo uses: a top-level
 * `services:` map, service keys at 2 spaces, service fields at 4, and
 * `environment` / `build.args` as mappings (`KEY: value` or bare `KEY:`).
 *
 * Deliberately NOT a general YAML parser — the repo has no YAML dependency
 * and a guard that silently mis-parses is worse than no guard. Every shape it
 * does not understand (sequence-form `environment`, tabs, a missing service)
 * throws rather than returning an empty result that would pass the check.
 *
 * @param {string} text
 * @param {string} service
 * `build` is the service's `build:` section's scalars — `context`,
 * `dockerfile`, `target` — or null when the service builds no image.
 *
 * @returns {{ environment: Map<string, string|null>, buildArgs: Map<string, string|null>, envFiles: string[], build: { context?: string, dockerfile?: string, target?: string } | null }}
 */
export function parseComposeService(text, service = APP_SERVICE) {
  if (/^\t| \t/m.test(text)) throw new Error('compose file contains tab indentation; this reader assumes spaces');

  const lines = text.split('\n');
  const environment = new Map();
  const buildArgs = new Map();
  const envFiles = [];
  let build = null;

  /** Indentation of a line, or null for blank/comment lines (which are skipped). */
  const indentOf = (line) => {
    if (!line.trim() || line.trim().startsWith('#')) return null;
    return line.length - line.trimStart().length;
  };

  let inServices = false;
  let inTarget = false; // inside the requested service
  /** @type {null | 'environment' | 'args' | 'env_file'} */
  let block = null;
  let blockIndent = 0;
  let inBuild = false;
  let seenService = false;

  for (const line of lines) {
    const indent = indentOf(line);
    if (indent === null) continue;
    const body = line.trim();

    if (indent === 0) {
      inServices = body === 'services:';
      inTarget = false;
      block = null;
      inBuild = false;
      continue;
    }
    if (!inServices) continue;

    if (indent === 2) {
      const m = /^([A-Za-z0-9_.-]+):$/.exec(body);
      if (!m) throw new Error(`unexpected service-level line: ${body}`);
      inTarget = m[1] === service;
      if (inTarget) seenService = true;
      block = null;
      inBuild = false;
      continue;
    }
    if (!inTarget) continue;

    if (indent === 4) {
      block = null;
      inBuild = body === 'build:';
      if (inBuild) build = {};
      // The short form, `build: <context>`, names only a context.
      const shortForm = /^build:\s+(\S.*)$/.exec(body);
      if (shortForm) build = { context: unquote(shortForm[1]) };
      if (body === 'environment:') {
        block = 'environment';
        blockIndent = 6;
      } else if (body === 'env_file:') {
        block = 'env_file';
        blockIndent = 6;
      }
      continue;
    }

    // Inside `build:` — its `args:` sub-mapping, and the scalars that say
    // which Dockerfile, and which stage of it, the image is built from.
    if (inBuild && indent === 6) {
      if (body === 'args:') {
        block = 'args';
        blockIndent = 8;
      } else {
        block = null;
        const scalar = /^(context|dockerfile|target):\s*(\S.*)$/.exec(body);
        if (scalar) build[scalar[1]] = unquote(scalar[2]);
      }
      continue;
    }

    if (!block || indent !== blockIndent) {
      // Deeper nesting inside a block we track would mean a shape this reader
      // does not model (e.g. a mapping value). Fail loudly rather than skip.
      if (block && indent > blockIndent) throw new Error(`unsupported nesting under ${block}: ${body}`);
      continue;
    }

    if (block === 'env_file') {
      if (!body.startsWith('- ')) throw new Error(`unsupported env_file entry: ${body}`);
      envFiles.push(body.slice(2).trim());
      continue;
    }

    if (body.startsWith('- ')) {
      throw new Error(
        `sequence-form \`${block}\` is not supported by this guard (found: ${body}). ` +
          'Use the mapping form (`KEY: value`, or bare `KEY:` for pass-through).',
      );
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/.exec(body);
    if (!m) throw new Error(`unparsable ${block} entry: ${body}`);
    const value = m[2].trim();
    (block === 'args' ? buildArgs : environment).set(m[1], value === '' ? null : value);
  }

  if (!seenService) throw new Error(`compose file declares no \`${service}\` service`);
  return { environment, buildArgs, envFiles, build };
}

/**
 * The `${NAME:-}` form — interpolation with an EMPTY default. Always sets the
 * variable; sets it to '' when the caller has none. `${NAME:-something}` is
 * fine (a real default) and `${NAME}` is not (blank when unset, with a compose
 * warning), so both no-value forms are matched.
 */
const EMPTY_DEFAULT_FORM = /^\$\{[A-Za-z_][A-Za-z0-9_]*(:-)?\}$/;

/**
 * Compare the compose file against the app's own environment inventory.
 * Pure: takes text and a spec, returns findings. Reads no environment.
 *
 * `image`, when given, turns on check 4 (the image build): `readFile` reads a
 * path relative to the compose file — the Dockerfile and `package.json` in
 * the service's build context. Without it the image build is not checked and
 * the result says so (`imageBuild.checked === false`); the CLI and the gate
 * test always pass it, through `checkRepository`.
 *
 * @param {string} composeText
 * @param {typeof ENV_SPEC} [spec]
 * @param {string} [service]
 * @param {{ readFile: (path: string) => string }} [image]
 */
export function checkComposeEnvCoverage(composeText, spec = ENV_SPEC, service = APP_SERVICE, image = undefined) {
  const { environment, buildArgs, envFiles, build } = parseComposeService(composeText, service);

  // The compose file pins its own profile. Resolve the spec against THOSE
  // drivers so the check demands exactly what this deployment shape reads:
  // no Vercel Blob token under BLOB_DRIVER=s3, no sandbox knobs under the
  // container executor. A driver written as an interpolation rather than a
  // literal leaves the seam unpinned, and resolveDrivers takes its default.
  const driverEnv = {};
  for (const [name, value] of environment) {
    if (typeof value === 'string' && !value.includes('$')) driverEnv[name] = value;
  }
  const { drivers } = resolveDrivers(driverEnv);
  const { applicable, notApplicable } = resolveSpec(drivers, spec, {});

  // An `env_file:` on the service delivers whatever the operator's file holds,
  // which no static check can enumerate — so coverage becomes unprovable.
  const coverageProvable = envFiles.length === 0;

  const missingRuntime = [];
  const missingBuildArg = [];
  const emptyDefaultForm = [];
  const runtimeInert = [];
  const priorEraNamesInUse = [];

  /** Every name a spec entry answers to — canonical first. */
  const acceptedNames = (entry) =>
    typeof entry.priorEraName === 'string' ? [entry.name, entry.priorEraName] : [entry.name];
  /** Whether ANY accepted name of `entry` appears in `map`. */
  const covered = (map, entry) => acceptedNames(entry).some((n) => map.has(n));

  for (const entry of applicable) {
    const readBy = entry.readBy ?? 'runtime';
    if (readBy === 'external-tool') continue;

    const needsRuntime = readBy === 'runtime' || readBy === 'build-and-runtime';
    const needsBuildArg = readBy === 'build' || readBy === 'build-and-runtime';

    if (needsRuntime && coverageProvable && !covered(environment, entry)) {
      missingRuntime.push(entry);
    }
    if (needsBuildArg && !covered(buildArgs, entry)) {
      missingBuildArg.push(entry);
    }
    // A build-only value in `environment` reads as though setting it at run
    // time would do something. It cannot: the value is already inlined.
    if (readBy === 'build' && covered(environment, entry)) {
      runtimeInert.push(entry);
    }
    // Delivered under the retiring spelling — reported, never failed. The
    // compose file is the flip phase's surface, not this phase's.
    if (typeof entry.priorEraName === 'string' && environment.has(entry.priorEraName)) {
      priorEraNamesInUse.push(entry);
    }
  }

  for (const [name, value] of environment) {
    if (typeof value === 'string' && EMPTY_DEFAULT_FORM.test(value)) emptyDefaultForm.push(name);
  }

  // Both accepted names count as declared: the compose file naming the
  // prior-era spelling is the CURRENT state of that file, not inventory drift.
  const declared = new Set(spec.flatMap(acceptedNames));
  const notApplicableNames = new Set(notApplicable.map((s) => s.name));
  const undeclared = [...environment.keys()].filter((n) => !declared.has(n));
  // Present but inert under this profile: not a failure (an operator may be
  // keeping a lane open), but worth naming — it is dead configuration.
  const inapplicablePresent = [...environment.keys()].filter((n) => notApplicableNames.has(n));

  const imageBuild = image ? checkImageBuild(build, buildArgs, applicable, image.readFile) : { checked: false };

  const ok =
    missingRuntime.length === 0 &&
    missingBuildArg.length === 0 &&
    emptyDefaultForm.length === 0 &&
    runtimeInert.length === 0 &&
    undeclared.length === 0 &&
    (!imageBuild.checked || (imageBuild.error === null && imageBuild.missingArg.length === 0));

  return {
    ok,
    drivers,
    coverageProvable,
    envFiles,
    missingRuntime,
    missingBuildArg,
    emptyDefaultForm,
    runtimeInert,
    priorEraNamesInUse,
    undeclared,
    inapplicablePresent,
    imageBuild,
    counts: { environment: environment.size, buildArgs: buildArgs.size, applicable: applicable.length },
  };
}

// --- the image build (check 4) ------------------------------------------------

/**
 * Minimal Dockerfile reader: its stages, the ARGs each declares (and the
 * global ones ahead of the first FROM, which no RUN sees), each RUN's command,
 * each CMD / ENTRYPOINT command, and the stages each stage needs (`FROM
 * <stage>`, `COPY --from=`, `RUN --mount=…from=`). Continuation lines are
 * joined and comment lines dropped, as Docker does.
 *
 * Deliberately NOT general, like the compose reader above: a heredoc, an
 * escape directive, or an instruction other than ARG ahead of the first FROM
 * throws rather than being read into a passing result.
 *
 * @param {string} text
 */
export function parseDockerfile(text) {
  if (/^#\s*escape\s*=/im.test(text)) {
    throw new Error('Dockerfile sets an escape directive; this reader assumes the default backslash');
  }
  const logical = [];
  let current = null;
  let startLine = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const continues = trimmed.endsWith('\\');
    const piece = continues ? trimmed.slice(0, -1).trimEnd() : trimmed;
    if (current === null) {
      current = piece;
      startLine = i + 1;
    } else {
      current += ` ${piece}`;
    }
    if (!continues) {
      logical.push({ line: startLine, text: current });
      current = null;
    }
  }
  if (current !== null) logical.push({ line: startLine, text: current });

  const globalArgs = [];
  const stages = [];
  for (const { line, text: instruction } of logical) {
    const m = /^([A-Za-z]+)(?:\s+([\s\S]*))?$/.exec(instruction);
    if (!m) throw new Error(`unparsable Dockerfile instruction at line ${line}: ${instruction}`);
    const op = m[1].toUpperCase();
    const rest = (m[2] ?? '').trim();
    if ((op === 'RUN' || op === 'COPY') && /<<-?\s*["']?[A-Za-z_]/.test(rest)) {
      throw new Error(`Dockerfile line ${line}: a heredoc is not supported by this reader`);
    }
    if (op === 'FROM') {
      const tokens = rest.split(/\s+/).filter((t) => !t.startsWith('--'));
      const asAt = tokens.findIndex((t) => t.toUpperCase() === 'AS');
      stages.push({
        index: stages.length,
        name: asAt >= 0 && tokens[asAt + 1] ? tokens[asAt + 1].toLowerCase() : null,
        from: tokens[0],
        line,
        args: [],
        runs: [],
        commands: [],
        needs: [],
      });
      continue;
    }
    const stage = stages.at(-1);
    if (op === 'ARG') {
      for (const a of rest.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)(?==|\s|$)/g)) {
        (stage ? stage.args : globalArgs).push({ name: a[1], line });
      }
      continue;
    }
    if (!stage) throw new Error(`Dockerfile line ${line}: ${op} ahead of the first FROM (only ARG may precede it)`);
    if (op === 'RUN') {
      for (const f of rest.matchAll(/(?:^|\s)--mount=\S*?\bfrom=([^\s,]+)/g)) stage.needs.push(f[1].toLowerCase());
      stage.runs.push({ line, command: commandText(rest.replace(/^(?:--\S+\s+)+/, '')) });
    } else if (op === 'COPY' || op === 'ADD') {
      const from = /(?:^|\s)--from=(\S+)/.exec(rest);
      if (from) stage.needs.push(from[1].toLowerCase());
    } else if (op === 'CMD' || op === 'ENTRYPOINT') {
      stage.commands.push({ line, op, command: commandText(rest) });
    }
  }
  if (stages.length === 0) throw new Error('Dockerfile declares no FROM');
  return { globalArgs, stages };
}

/** A RUN / CMD / ENTRYPOINT command as text: exec form joined, shell form as written. */
function commandText(rest) {
  if (rest.startsWith('[')) {
    try {
      const parsed = JSON.parse(rest);
      if (Array.isArray(parsed)) return parsed.join(' ');
    } catch {
      // Not valid JSON, so Docker reads it as shell form too.
    }
  }
  return rest;
}

/**
 * Every stage the build target needs: the target itself (the last stage when
 * compose names none — Docker's default), then, transitively, each stage it is
 * built FROM or copies or mounts from. A reference that names no stage is an
 * image, and ends that branch.
 */
export function stagesTheTargetNeeds(dockerfile, target) {
  const byName = new Map(dockerfile.stages.filter((s) => s.name).map((s) => [s.name, s]));
  const stageFor = (ref) =>
    byName.get(String(ref).toLowerCase()) ?? (/^\d+$/.test(ref) ? dockerfile.stages[Number(ref)] : undefined);
  const start = target ? byName.get(target.toLowerCase()) : dockerfile.stages.at(-1);
  if (!start) throw new Error(`compose builds target "${target}", which the Dockerfile does not declare`);
  const needed = [];
  const queue = [start];
  while (queue.length > 0) {
    const stage = queue.shift();
    if (needed.includes(stage)) continue;
    needed.push(stage);
    for (const ref of [stage.from, ...stage.needs]) {
      const dependency = stageFor(ref);
      if (dependency) queue.push(dependency);
    }
  }
  return needed;
}

/**
 * Whether a command builds the app: it runs `next build` itself, or reaches it
 * through `npm run` — each script resolved in `package.json`, npm's `pre` hook
 * for it included, followed transitively.
 */
export function commandBuildsTheApp(command, scripts = {}) {
  const visited = new Set();
  const reaches = (text) => {
    if (/(?:^|[\s;&|(/])next\s+build\b/.test(text)) return true;
    for (const m of text.matchAll(/\bnpm\s+run(?:-script)?\s+([\w:.-]+)/g)) {
      for (const name of [`pre${m[1]}`, m[1]]) {
        if (visited.has(name) || typeof scripts[name] !== 'string') continue;
        visited.add(name);
        if (reaches(scripts[name])) return true;
      }
    }
    return false;
  };
  return reaches(command);
}

/**
 * Check 4 (see the header): every name in `build.args`, and every applicable
 * ENV_SPEC variable read at build time, has an `ARG` above each RUN that
 * builds, in that RUN's own stage — ARGs are not inherited by a later stage,
 * and a global ARG ahead of the first FROM is visible to no RUN.
 */
export function checkImageBuild(build, buildArgs, applicable, readFile) {
  if (!build) return { checked: false };
  const context = build.context ?? '.';
  const dockerfilePath = posix.join(context, build.dockerfile ?? 'Dockerfile');
  const target = build.target ?? null;
  const base = { checked: true, dockerfile: dockerfilePath, target, buildRuns: [], missingArg: [], error: null };
  const dockerfile = parseDockerfile(readFile(dockerfilePath));
  let needed;
  try {
    needed = stagesTheTargetNeeds(dockerfile, target);
  } catch (error) {
    return { ...base, error: error.message };
  }
  const scripts = JSON.parse(readFile(posix.join(context, 'package.json'))).scripts ?? {};
  const runs = [];
  for (const stage of needed) {
    for (const run of stage.runs) if (commandBuildsTheApp(run.command, scripts)) runs.push({ stage, run });
  }
  if (runs.length === 0) {
    return {
      ...base,
      error: `no RUN in the stages target "${target ?? '(the last stage)'}" needs reaches \`next build\``,
    };
  }
  const sources = new Map();
  const want = (name, source) => {
    if (!sources.has(name)) sources.set(name, []);
    sources.get(name).push(source);
  };
  for (const name of buildArgs.keys()) want(name, 'compose build.args');
  for (const entry of applicable) {
    if (entry.readBy === 'build' || entry.readBy === 'build-and-runtime') want(entry.name, `ENV_SPEC readBy: ${entry.readBy}`);
  }
  const missingArg = [];
  for (const [name, from] of sources) {
    const unseen = runs.filter(({ stage, run }) => !stage.args.some((a) => a.name === name && a.line < run.line));
    if (unseen.length > 0) missingArg.push({ name, sources: from });
  }
  const buildRuns = runs.map(({ stage, run }) => ({ stage: stage.name ?? `#${stage.index}`, line: run.line }));
  return { ...base, buildRuns, missingArg };
}

/**
 * The check as the CLI and the gate test run it: the repository's compose
 * file, and the Dockerfile and `package.json` in its app service's build
 * context, each resolved relative to the compose file.
 */
export function checkRepository(composePath = fileURLToPath(new URL('../docker-compose.yml', import.meta.url))) {
  const dir = dirname(composePath);
  return checkComposeEnvCoverage(readFileSync(composePath, 'utf8'), ENV_SPEC, APP_SERVICE, {
    readFile: (path) => readFileSync(resolvePath(dir, path), 'utf8'),
  });
}

/** Where the build runs, for the report: `stage "builder" (Dockerfile:63)`. */
function describeBuildRuns(imageBuild) {
  return imageBuild.buildRuns.map((r) => `stage "${r.stage}" (${imageBuild.dockerfile}:${r.line})`).join(', ');
}

/** Render findings as text. Pure; names only, never values. */
export function renderComposeReport(result, service = APP_SERVICE) {
  const lines = [''];
  lines.push('  docker-compose.yml — environment coverage');
  lines.push(`  (service "${service}"; compared against scripts/preflight-env.mjs ENV_SPEC)`);
  lines.push('');
  const pairs = Object.entries(result.drivers).map(([seam, d]) => `${seam}=${d}`);
  lines.push(`  PROFILE: ${pairs.join('  ')}`);
  lines.push(
    `  ${result.counts.environment} environment entr${result.counts.environment === 1 ? 'y' : 'ies'}, ` +
      `${result.counts.buildArgs} build arg(s), ${result.counts.applicable} applicable spec entr(ies)`,
  );
  if (result.imageBuild?.checked && result.imageBuild.error === null) {
    lines.push(
      `  IMAGE: target "${result.imageBuild.target ?? '(the last stage)'}" — next build runs in ${describeBuildRuns(result.imageBuild)}`,
    );
  }
  lines.push('');

  if (!result.coverageProvable) {
    lines.push(`  NOTE: the service declares env_file (${result.envFiles.join(', ')}); run-time`);
    lines.push('        coverage cannot be proven statically and was not checked.');
    lines.push('');
  }

  if (result.missingRuntime.length > 0) {
    lines.push(`  FAIL: ${result.missingRuntime.length} variable(s) the app reads at run time are absent from`);
    lines.push('        the service environment — set them and nothing reaches the container:');
    for (const e of result.missingRuntime) lines.push(`          - ${e.name} (${e.tier}) — ${e.purpose}`);
    lines.push('        Fix: add each as a bare `NAME:` pass-through under `environment:`.');
    lines.push('');
  }
  if (result.missingBuildArg.length > 0) {
    lines.push(`  FAIL: ${result.missingBuildArg.length} variable(s) are read at BUILD time and absent from build.args:`);
    for (const e of result.missingBuildArg) lines.push(`          - ${e.name} (readBy: ${e.readBy}) — ${e.purpose}`);
    lines.push('        Fix: add each under the service\'s `build.args`, and declare a');
    lines.push('        matching `ARG` in the Dockerfile stage that runs the build.');
    lines.push('');
  }
  if (result.imageBuild?.checked && result.imageBuild.error !== null) {
    lines.push(`  FAIL: the image build cannot be checked — ${result.imageBuild.error} (${result.imageBuild.dockerfile}).`);
    lines.push('        A build argument reaches `next build` only through an ARG in the stage that');
    lines.push('        runs it; with no such stage found, nothing can be said to arrive.');
    lines.push('');
  }
  if (result.imageBuild?.checked && result.imageBuild.missingArg.length > 0) {
    lines.push(`  FAIL: ${result.imageBuild.missingArg.length} build-time variable(s) have no ARG in the stage that runs the build`);
    lines.push(`        (${describeBuildRuns(result.imageBuild)}), so the image build never sees them —`);
    lines.push('        Docker hands a build argument only to a stage that declares it, and says nothing:');
    for (const m of result.imageBuild.missingArg) lines.push(`          - ${m.name} (${m.sources.join('; ')})`);
    lines.push('        Fix: add `ARG NAME` to that stage, above the RUN that builds.');
    lines.push('');
  }
  if (result.runtimeInert.length > 0) {
    lines.push(`  FAIL: ${result.runtimeInert.length} build-time variable(s) also listed under environment, where`);
    lines.push('        they do nothing — the value was inlined at build and nothing reads it:');
    for (const e of result.runtimeInert) lines.push(`          - ${e.name}`);
    lines.push('');
  }
  if (result.emptyDefaultForm.length > 0) {
    lines.push(`  FAIL: ${result.emptyDefaultForm.length} entr(ies) use an empty-default interpolation, which sets the`);
    lines.push('        variable to "" rather than leaving it unset. Empty is not absent —');
    lines.push('        EVIDENCE_TRUST_REGISTRY_LEGACY_URL="" omits a URL from signed output:');
    for (const n of result.emptyDefaultForm) lines.push(`          - ${n}`);
    lines.push('        Fix: write the bare `NAME:` form, or give a real default.');
    lines.push('');
  }
  if (result.undeclared.length > 0) {
    lines.push(`  FAIL: ${result.undeclared.length} variable(s) passed to the container that ENV_SPEC does not`);
    lines.push('        declare — either the app stopped reading them, or the inventory is stale:');
    for (const n of result.undeclared) lines.push(`          - ${n}`);
    lines.push('');
  }
  if (result.priorEraNamesInUse && result.priorEraNamesInUse.length > 0) {
    lines.push(
      `  NOTE: ${result.priorEraNamesInUse.length} variable(s) passed through under a prior-era`,
    );
    lines.push('        name. Both spellings reach the app, so this is not a failure. Where');
    lines.push('        the canonical twin is listed beside it, the pair is the deliberate');
    lines.push('        dual pass-through that keeps a pre-settlement env file working;');
    lines.push('        where it stands alone, the canonical spelling is the one to move to:');
    for (const e of result.priorEraNamesInUse) {
      lines.push(`          - ${e.priorEraName} → ${e.name}`);
    }
    lines.push('');
  }
  if (result.inapplicablePresent.length > 0) {
    lines.push(`  NOTE: ${result.inapplicablePresent.length} variable(s) present but not read under this profile:`);
    for (const n of result.inapplicablePresent) lines.push(`          - ${n}`);
    lines.push('');
  }

  lines.push(
    result.ok
      ? '  RESULT: PASS — every variable this profile reads can reach the container.'
      : '  RESULT: FAIL — the compose path cannot deliver part of the documented environment.',
  );
  lines.push('');
  return lines.join('\n');
}

/** Entry point when run directly. */
function main() {
  const result = checkRepository();
  process.stdout.write(renderComposeReport(result));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
