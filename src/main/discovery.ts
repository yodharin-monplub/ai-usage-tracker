import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  type AccountConfig,
  type DiscoveredProfile,
  type ProviderId
} from '../shared/types';

function normalizePathKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function existsDir(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function existsFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function suffixToLabel(dirName: string, prefix: string, defaultLabel: string): string {
  if (dirName === prefix) return `${defaultLabel} (Default)`;
  const rawSuffix = dirName.slice(prefix.length).replace(/^[-_]+/, '');
  if (!rawSuffix) return defaultLabel;
  const formatted = rawSuffix
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return `${defaultLabel} (${formatted})`;
}

export async function discoverLocalProfiles(
  homeDir = os.homedir(),
  existingAccounts: AccountConfig[] = []
): Promise<DiscoveredProfile[]> {
  const existingKeys = new Set(
    existingAccounts
      .filter((a) => a.profileDir)
      .map((a) => `${a.provider}::${normalizePathKey(a.profileDir)}`)
  );

  const results: DiscoveredProfile[] = [];
  const pushIfValid = (provider: ProviderId, suggestedLabel: string, profileDir: string, details: string) => {
    const key = `${provider}::${normalizePathKey(profileDir)}`;
    results.push({
      provider,
      suggestedLabel,
      profileDir,
      details,
      alreadyAdded: existingKeys.has(key)
    });
  };

  let homeEntries: string[] = [];
  try {
    homeEntries = await fs.readdir(homeDir);
  } catch {
    return [];
  }

  for (const name of homeEntries) {
    const fullPath = path.join(homeDir, name);
    if (!(await existsDir(fullPath))) continue;

    // 1. Claude Code (~/.claude or ~/.claude-*)
    if (name === '.claude' || name.startsWith('.claude-')) {
      const projectsDir = path.join(fullPath, 'projects');
      const hasProjects = await existsDir(projectsDir);
      const hasCreds = await existsFile(path.join(fullPath, '.credentials.json'));
      let projectCount = 0;
      if (hasProjects) {
        try {
          projectCount = (await fs.readdir(projectsDir)).length;
        } catch {
          projectCount = 0;
        }
      }
      if (hasProjects || hasCreds) {
        const parts: string[] = [];
        if (hasProjects) parts.push(`${projectCount} project folders`);
        if (hasCreds) parts.push('OAuth credentials detected');
        pushIfValid(
          'claude-code',
          suffixToLabel(name, '.claude', 'Claude Code'),
          fullPath,
          parts.join(' · ')
        );
      }
      continue;
    }

    // 2. Codex (~/.codex or ~/.codex-*)
    if (name === '.codex' || name.startsWith('.codex-')) {
      const hasSessions = await existsDir(path.join(fullPath, 'sessions'));
      const hasIndex = await existsFile(path.join(fullPath, 'session_index.jsonl'));
      const hasAuth = await existsFile(path.join(fullPath, 'auth.json'));
      if (hasSessions || hasIndex || hasAuth) {
        const parts: string[] = [];
        if (hasSessions) parts.push('sessions dir');
        if (hasIndex) parts.push('session index');
        if (hasAuth) parts.push('auth.json detected');
        pushIfValid(
          'codex',
          suffixToLabel(name, '.codex', 'Codex'),
          fullPath,
          parts.join(' · ')
        );
      }
      continue;
    }

    // 3. Gemini (~/.gemini or ~/.gemini-*) and Antigravity (~/.gemini/antigravity*)
    if (name === '.gemini' || name.startsWith('.gemini-')) {
      const hasTmp = await existsDir(path.join(fullPath, 'tmp'));
      const hasOAuth = await existsFile(path.join(fullPath, 'oauth_creds.json'));
      const hasSettings = await existsFile(path.join(fullPath, 'settings.json'));
      if (hasTmp || hasOAuth || hasSettings || name.startsWith('.gemini-')) {
        const parts: string[] = [];
        if (hasTmp) parts.push('chat logs');
        if (hasOAuth) parts.push('OAuth credentials');
        if (hasSettings) parts.push('settings.json');
        pushIfValid(
          'gemini',
          suffixToLabel(name, '.gemini', 'Gemini CLI'),
          fullPath,
          parts.length > 0 ? parts.join(' · ') : 'Custom Gemini profile'
        );
      }

      // Inspect Antigravity subdirectories inside ~/.gemini
      let subEntries: string[] = [];
      try {
        subEntries = await fs.readdir(fullPath);
      } catch {
        subEntries = [];
      }
      for (const sub of subEntries) {
        if (!sub.startsWith('antigravity')) continue;
        const agyPath = path.join(fullPath, sub);
        if (!(await existsDir(agyPath))) continue;
        const hasDb = await existsFile(path.join(agyPath, 'conversation_summaries.db'));
        const hasHist = await existsFile(path.join(agyPath, 'history.jsonl'));
        const hasConvs = await existsDir(path.join(agyPath, 'conversations'));
        if (hasDb || hasHist || hasConvs) {
          const parts: string[] = [];
          if (hasDb) parts.push('conversation_summaries.db');
          if (hasHist) parts.push('history.jsonl');
          if (hasConvs && !hasDb) parts.push('conversations dir');
          const label =
            sub === 'antigravity-cli'
              ? 'Antigravity CLI'
              : sub === 'antigravity'
                ? 'Antigravity IDE'
                : suffixToLabel(sub, 'antigravity', 'Antigravity');
          pushIfValid('antigravity', label, agyPath, parts.join(' · '));
        }
      }
    }

    // 4. Standalone ~/.antigravity* profile directories
    if (name === '.antigravity' || name.startsWith('.antigravity-')) {
      const hasDb = await existsFile(path.join(fullPath, 'conversation_summaries.db'));
      const hasHist = await existsFile(path.join(fullPath, 'history.jsonl'));
      if (hasDb || hasHist) {
        pushIfValid(
          'antigravity',
          suffixToLabel(name, '.antigravity', 'Antigravity'),
          fullPath,
          [hasDb ? 'conversation_summaries.db' : '', hasHist ? 'history.jsonl' : '']
            .filter(Boolean)
            .join(' · ')
        );
      }
    }
  }

  results.sort((a, b) => {
    const orderDiff = PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider);
    if (orderDiff !== 0) return orderDiff;
    return a.suggestedLabel.localeCompare(b.suggestedLabel);
  });

  return results;
}

export function createAccountFromDiscovered(
  profile: DiscoveredProfile,
  nowIso = new Date().toISOString()
): AccountConfig {
  const meta = PROVIDER_META[profile.provider];
  return {
    id: randomUUID(),
    provider: profile.provider,
    label: profile.suggestedLabel,
    accountHint: profile.details,
    mode: 'hybrid',
    profileDir: profile.profileDir,
    liveSyncEnabled: false,
    hasSecretToken: false,
    limits: {
      rollingWindowHours: meta.defaultRollingHours,
      rollingLimitMetric: meta.defaultLimitMetric,
      rollingLimitValue: meta.defaultLimitValue
    },
    pinnedToWidget: true,
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}
