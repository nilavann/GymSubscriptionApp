import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * Reads application source straight from disk for the guard tests (design-tokens.test.ts).
 *
 * Why not `import.meta.glob(..., { query: '?raw' })`? vitest.config.ts sets `css: false`, which makes
 * Vitest replace every CSS module with an empty string — INCLUDING `?raw` imports. A guard built on
 * that would silently scan nothing and pass. Reading the files with node:fs can't be blanked, and the
 * `expectScanned` check below turns "found nothing" into a failure instead of a false pass.
 */

// Vitest always runs with `frontend/` as its root (vitest.config.ts lives there; `npm run test` runs from
// there). `import.meta.url` is not a file: URL inside the jsdom environment, so anchor on the cwd instead —
// `expectScanned` fails the suite if this ever points somewhere that isn't the source tree.
const SRC_DIR = join(process.cwd(), 'src');

/** Map of `/src/<path>` (forward slashes) -> file contents, for every .css/.ts/.tsx under src/. */
export function readSourceFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(SRC_DIR, { recursive: true })) {
    const relative = String(entry);
    if (!/\.(css|ts|tsx)$/.test(relative)) continue;
    files[`/src/${relative.split(sep).join('/')}`] = readFileSync(join(SRC_DIR, relative), 'utf8');
  }
  return files;
}

/** Fails loudly if a scan came back (nearly) empty, so a broken glob can never read as "all clear". */
export function expectScanned(files: Record<string, string>, minimum = 40): void {
  const count = Object.keys(files).length;
  if (count < minimum) throw new Error(`source scan found only ${count} files (expected >= ${minimum}) — the guard is not scanning`);
  const emptyCss = Object.entries(files).filter(([path, code]) => path.endsWith('.css') && code.trim() === '');
  if (emptyCss.length > 0) throw new Error(`empty CSS read from disk: ${emptyCss.map(([p]) => p).join(', ')}`);
}
