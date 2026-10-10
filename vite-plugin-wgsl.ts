import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const INCLUDE_RE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*;?[ \t]*$/gm;

function resolveIncludes(filePath: string, addWatch: (f: string) => void): string {
  const src = fs.readFileSync(filePath, 'utf-8');
  const dir = path.dirname(filePath);

  return src.replace(INCLUDE_RE, (_match, relPath: string) => {
    const resolved = path.resolve(dir, relPath);
    addWatch(resolved); // чтобы HMR знал о зависимости
    return resolveIncludes(resolved, addWatch);
  });
}

export function wgsl(): Plugin {
  return {
    name: 'wgsl-include',
    enforce: 'pre',

    load(id) {
      const cleanId = id.split('?')[0].split('#')[0];
      if (!cleanId.endsWith('.wgsl')) return null;

      const code = resolveIncludes(cleanId, (f) => this.addWatchFile(f));
      return `export default ${JSON.stringify(code)};`;
    },

    transform(_code, id) {
      const cleanId = id.split('?')[0].split('#')[0];
      if (!cleanId.endsWith('.wgsl')) return null;

      const code = resolveIncludes(cleanId, (f) => this.addWatchFile(f));
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: null,
      };
    },
  };
}