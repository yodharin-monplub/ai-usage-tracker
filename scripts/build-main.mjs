import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-electron');

mkdirSync(outDir, { recursive: true });

const sharedOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info'
};

await Promise.all([
  build({
    ...sharedOptions,
    entryPoints: [path.join(rootDir, 'src/main/index.ts')],
    outfile: path.join(outDir, 'main.cjs')
  }),
  build({
    ...sharedOptions,
    entryPoints: [path.join(rootDir, 'src/preload/index.ts')],
    outfile: path.join(outDir, 'preload.cjs')
  })
]);

const wasmSrc = path.join(rootDir, 'node_modules/sql.js/dist/sql-wasm.wasm');
const wasmDest = path.join(outDir, 'sql-wasm.wasm');
if (!existsSync(wasmSrc)) {
  throw new Error(`Missing sql.js WASM binary at ${wasmSrc}`);
}
copyFileSync(wasmSrc, wasmDest);
console.log('Copied sql-wasm.wasm to dist-electron/sql-wasm.wasm');
