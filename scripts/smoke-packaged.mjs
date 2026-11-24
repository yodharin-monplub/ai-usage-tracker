import { cpSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const srcDir = path.resolve('release', 'win-unpacked');
const targetDir = path.join(os.tmpdir(), `ai-tracker-smoke-pkg-${Date.now()}`);

if (!existsSync(srcDir)) {
  console.error('Source directory does not exist:', srcDir);
  process.exit(1);
}

try {
  console.log(`Staging packaged build to local drive: ${targetDir}`);
  cpSync(srcDir, targetDir, { recursive: true });

  const exePath = path.join(targetDir, 'AI Tracker.exe');
  console.log(`Running: ${exePath} --smoke`);

  const res = spawnSync(exePath, ['--smoke'], {
    encoding: 'utf8',
    timeout: 30000,
    stdio: 'inherit'
  });

  console.log(`Smoke test finished with exit code: ${res.status}`);
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
} finally {
  try {
    rmSync(targetDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
