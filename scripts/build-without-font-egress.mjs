#!/usr/bin/env node
/**
 * Build with Google Fonts unreachable (#225).
 *
 * The app self-hosts its typefaces (`src/fonts/`, loaded by
 * `next/font/local` in `src/app/layout.tsx`) precisely so that `next build`
 * needs no egress to `fonts.googleapis.com` — the container path in
 * docs/deploy.md is built by operators in restricted-egress environments,
 * and since Next.js 16.2.11 an unreachable font host HARD-FAILS the build
 * rather than warning and falling back.
 *
 * A machine with open egress cannot observe that property: a build that
 * quietly re-acquires a `next/font/google` import still passes there. This
 * script reproduces the restricted environment on any machine by making the
 * two Google Fonts hosts unresolvable for the build and every process it
 * spawns, then running `next build`. A green run means the build's font
 * story is genuinely local.
 *
 * Usage:
 *   node scripts/build-without-font-egress.mjs             # default builder
 *   node scripts/build-without-font-egress.mjs --webpack   # args pass through
 *
 * Exit code is the build's own.
 *
 * How it works: run directly, it re-invokes `next build` with itself in
 * `NODE_OPTIONS=--import`, so every Node process in the build tree loads it
 * again — that second time it takes the preload branch below and patches
 * DNS resolution for the blocked hosts to ENOTFOUND, exactly what a build
 * host with no route to them reports. Nothing else is intercepted: an
 * unrelated network failure still looks like itself.
 */

import { spawn } from 'node:child_process';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BLOCKED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const isBlocked = (hostname) =>
  typeof hostname === 'string' &&
  BLOCKED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));

function notFound(hostname) {
  const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
  error.code = 'ENOTFOUND';
  error.errno = -3008;
  error.syscall = 'getaddrinfo';
  error.hostname = hostname;
  return error;
}

/** Preload branch: make the blocked hosts unresolvable in this process. */
function blockFontEgress() {
  const realLookup = dns.lookup;
  dns.lookup = function lookup(hostname, ...rest) {
    if (!isBlocked(hostname)) return realLookup.call(this, hostname, ...rest);
    const callback = rest[rest.length - 1];
    if (typeof callback === 'function') {
      process.nextTick(callback, notFound(hostname));
      return undefined;
    }
    throw notFound(hostname);
  };

  const realLookupAsync = dns.promises.lookup;
  dns.promises.lookup = function lookup(hostname, ...rest) {
    if (isBlocked(hostname)) return Promise.reject(notFound(hostname));
    return realLookupAsync.call(this, hostname, ...rest);
  };
}

/** Runner branch: build with the preload installed everywhere. */
function runBuild(args) {
  const nextBin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${import.meta.url}`]
    .filter(Boolean)
    .join(' ');

  console.log(`[font-egress] blocking ${BLOCKED_HOSTS.join(', ')} for the build\n`);

  const child = spawn(process.execPath, [nextBin, 'build', ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) runBuild(process.argv.slice(2));
else blockFontEgress();
