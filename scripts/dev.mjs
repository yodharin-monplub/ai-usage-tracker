import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveElectronBinary } from './launch-electron.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const electronBinary = resolveElectronBinary(rootDir);

function runNodeScript(scriptRelPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, scriptRelPath)], {
      cwd: rootDir,
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptRelPath} exited with code ${code}`));
    });
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

await runNodeScript('scripts/generate-icons.mjs');
await runNodeScript('scripts/build-main.mjs');

const viteBin = path.join(rootDir, 'node_modules/vite/bin/vite.js');
const viteProc = spawn(process.execPath, [viteBin, '--port', '5173', '--strictPort'], {
  cwd: rootDir,
  stdio: 'inherit'
});

const devUrl = 'http://127.0.0.1:5173';
try {
  await waitForServer(devUrl);
} catch (err) {
  viteProc.kill();
  throw err;
}

const electronProc = spawn(electronBinary, ['.'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devUrl
  }
});

const cleanup = () => {
  if (!viteProc.killed) viteProc.kill();
};

electronProc.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  cleanup();
  if (!electronProc.killed) electronProc.kill();
  process.exit(0);
});
