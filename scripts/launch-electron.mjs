import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, '..');

function isRemoteWindowsPath(targetPath) {
  if (process.platform !== 'win32') return false;
  if (targetPath.startsWith('\\\\')) return true;
  const driveMatch = targetPath.match(/^([A-Za-z]:)/);
  if (!driveMatch) return false;
  try {
    const out = execFileSync('fsutil', ['fsinfo', 'drivetype', driveMatch[1]], {
      encoding: 'utf8'
    });
    return out.includes('Remote/Network');
  } catch {
    return false;
  }
}

export function resolveElectronBinary(rootDir = defaultRootDir) {
  const require = createRequire(path.join(rootDir, 'package.json'));
  const electronBinary = require('electron');

  if (!isRemoteWindowsPath(electronBinary)) {
    return electronBinary;
  }

  const electronPkg = JSON.parse(
    readFileSync(path.join(rootDir, 'node_modules/electron/package.json'), 'utf8')
  );
  const version = String(electronPkg.version || 'unknown');
  const localBase = process.env.LOCALAPPDATA || os.tmpdir();
  const cacheDir = path.join(localBase, 'ai-tracker-runtime', `electron-${version}`);
  const markerPath = path.join(cacheDir, '.ready');
  const cachedExe = path.join(cacheDir, 'electron.exe');

  const ready =
    existsSync(cachedExe) &&
    existsSync(markerPath) &&
    readFileSync(markerPath, 'utf8').trim() === version;

  if (!ready) {
    console.log(`Staging Electron ${version} runtime to local NTFS cache: ${cacheDir}`);
    mkdirSync(cacheDir, { recursive: true });
    cpSync(path.dirname(electronBinary), cacheDir, { recursive: true, force: true });
    writeFileSync(markerPath, version, 'utf8');
  }

  return cachedExe;
}

const isCliEntry =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCliEntry) {
  const binary = resolveElectronBinary(defaultRootDir);
  const child = spawn(binary, [defaultRootDir, ...process.argv.slice(2)], {
    cwd: defaultRootDir,
    stdio: 'inherit'
  });
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
  process.on('SIGINT', () => {
    if (!child.killed) child.kill();
    process.exit(0);
  });
}
