/** Filesystem-backed ProjectView confined to a root. Reads small files only; never writes. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectView } from './select.js';

const MAX_READ_BYTES = 256 * 1024;

export function fileProjectView(root: string): ProjectView {
  const base = fs.realpathSync(root);
  const resolve = (relative: string): string | undefined => {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return undefined;
    return path.join(base, relative);
  };
  const cache = new Map<string, boolean>();
  return {
    exists(relative) {
      const full = resolve(relative); if (!full) return false;
      let hit = cache.get(full);
      if (hit === undefined) { try { hit = fs.statSync(full).isFile(); } catch { hit = false; } cache.set(full, hit); }
      return hit;
    },
    read(relative) {
      const full = resolve(relative); if (!full) return undefined;
      try {
        const info = fs.statSync(full);
        if (!info.isFile() || info.size > MAX_READ_BYTES) return undefined;
        return fs.readFileSync(full, 'utf8');
      } catch { return undefined; }
    },
  };
}
