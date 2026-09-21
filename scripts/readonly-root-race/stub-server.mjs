// A stand-in for the application image, for driving one CI step against write
// timings the real image does not produce (#508). It serves the two routes the
// step probes and makes the image optimiser's cache write at the path
// docs/deploy.md documents — before it answers, after it, or never — logging a
// refused write the way Next.js does. See drive.sh beside it.
//
//   before        write, then answer: the order Next.js 16 uses (measured, #508)
//   late <ms>     answer, then write <ms> later
//   never         answer and never write
//   second <ms>   write, answer, then <ms> later write to a SECOND path, which
//                 only the no-mount run and a missing mount can tell apart
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const [mode = 'before', delayArg = '0'] = process.argv.slice(2);
const delayMs = Number(delayArg);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);

async function cacheWrite(key) {
  try {
    await mkdir(`/app/.next/cache/images/${key}`, { recursive: true });
    await writeFile(`/app/.next/cache/images/${key}/0.png`, PNG);
  } catch (err) {
    console.error(`⨯ Failed to write image to cache ${key}`, err);
  }
}

async function secondPathWrite() {
  try {
    await writeFile('/app/.next/second-writable-path', 'x');
  } catch (err) {
    console.error('⨯ Failed to write to a second path', err);
  }
}

const later = (fn) => setTimeout(fn, delayMs);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://stub');
  if (url.pathname === '/api/health') {
    res.writeHead(200).end('ok');
    return;
  }
  if (url.pathname === '/_next/image') {
    const key = createHash('sha256').update(url.search).digest('base64url');
    if (mode === 'before' || mode === 'second') await cacheWrite(key);
    res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    if (mode === 'late') later(() => cacheWrite(key));
    if (mode === 'second') later(secondPathWrite);
    return;
  }
  res.writeHead(404).end();
}).listen(3000, '0.0.0.0', () => {
  console.log(`readonly-root stub (${mode}${delayMs ? ` ${delayMs} ms` : ''}) on :3000`);
});
