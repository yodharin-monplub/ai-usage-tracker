export type ProviderId = 'claude-code' | 'antigravity' | 'gemini' | 'codex';

export type TrackingMode = 'hybrid' | 'local-only' | 'live-api' | 'manual';

export type LimitMetric = 'tokens' | 'cost_usd' | 'requests' | 'steps';

export type WidgetMode = 'mini' | 'expanded';

export type UsageStatus = 'ok' | 'stale' | 'rate-limited' | 'error' | 'no-data';

export type UsageSource = 'live' | 'local' | 'manual' | 'hybrid';

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  shortName: string;
  accentColor: string;
  defaultRollingHours: number;
  defaultLimitMetric: LimitMetric;
  defaultLimitValue: number;
  defaultWeeklyLimitValue: number;
  envVarHint: string;
  defaultPathHint: string;
  description: string;
}

export const PROVIDER_ORDER: ProviderId[] = [
  'claude-code',
  'antigravity',
  'gemini',
  'codex'
];

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    shortName: 'Claude',
    accentColor: '#d97757',
    defaultRollingHours: 5,
    defaultLimitMetric: 'cost_usd',
    defaultLimitValue: 20,
    defaultWeeklyLimitValue: 140,
    envVarHint: 'CLAUDE_CONFIG_DIR (e.g. ~/.claude-personal, ~/.claude-work)',
    defaultPathHint: '~/.claude',
    description: 'Reads local JSONL project logs and optional OAuth 5h/7d quotas.'
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    shortName: 'AGY',
    accentColor: '#38bdf8',
    defaultRollingHours: 5,
    defaultLimitMetric: 'steps',
    defaultLimitValue: 25_000,
    defaultWeeklyLimitValue: 100_000,
    envVarHint: 'Separate Antigravity profile folders under ~/.gemini/antigravity*',
    defaultPathHint: '~/.gemini/antigravity-cli',
    description: 'Reads conversation_summaries.db & history.jsonl read-only plus /usage snapshots.'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    shortName: 'Gemini',
    accentColor: '#4285f4',
    defaultRollingHours: 24,
    defaultLimitMetric: 'requests',
    defaultLimitValue: 1000,
    defaultWeeklyLimitValue: 5000,
    envVarHint: 'GEMINI_CLI_HOME or GEMINI_DATA_DIR per account',
    defaultPathHint: '~/.gemini',
    description: 'Reads local tmp/*/chats logs and optional OAuth retrieveUserQuota buckets.'
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    shortName: 'Codex',
    accentColor: '#10b981',
    defaultRollingHours: 5,
    defaultLimitMetric: 'tokens',
    defaultLimitValue: 2_000_000,
    defaultWeeklyLimitValue: 15_000_000,
    envVarHint: 'CODEX_HOME (e.g. ~/.codex-personal, ~/.codex-work)',
    defaultPathHint: '~/.codex',
    description: 'Reads sessions/*.jsonl & session_index.jsonl plus optional wham/usage sync.'
  }
};

export interface AccountLimits {
  rollingWindowHours: number;
  rollingLimitMetric: LimitMetric;
  rollingLimitValue: number;
  weeklyLimitValue?: number;
}

export interface ManualQuotaPool {
  name: string;
  usedPercent: number;
  resetAtIso?: string;
}

export interface ManualQuotaSnapshot {
  usedPercent: number;
  resetAtIso?: string;
  label?: string;
  secondaryUsedPercent?: number;
  secondaryResetAtIso?: string;
  secondaryLabel?: string;
  pools?: ManualQuotaPool[];
  updatedAtIso: string;
  rawText?: string;
}

export type AuthType = 'direct-signin' | 'api-key' | 'cli-profile' | 'manual';

export type DirectAuthStatus = 'signed-in' | 'expired' | 'signed-out';

export interface DirectAuthResult {
  success: boolean;
  token?: string;
  email?: string;
  accountHint?: string;
  provider: ProviderId;
  message: string;
}

export interface CredentialVerifyResult {
  valid: boolean;
  email?: string;
  message: string;
  primaryQuota?: QuotaWindow;
  secondaryQuota?: QuotaWindow;
}

export interface AccountConfig {
  id: string;
  provider: ProviderId;
  label: string;
  accountHint?: string;
  mode: TrackingMode;
  profileDir: string;
  liveSyncEnabled: boolean;
  hasSecretToken?: boolean;
  authType?: AuthType;
  directAuthEmail?: string;
  directAuthStatus?: DirectAuthStatus;
  directAuthAt?: string;
  partitionId?: string;
  limits: AccountLimits;
  manualSnapshot?: ManualQuotaSnapshot;
  pinnedToWidget: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetAtIso?: string;
  windowHours?: number;
}

export interface ModelUsageItem {
  model: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  costUsd: number;
}

export interface UsageMetrics {
  rollingTokens: number;
  todayTokens: number;
  weekTokens: number;
  rollingRequests: number;
  todayRequests: number;
  weekRequests: number;
  rollingSteps: number;
  todaySteps: number;
  weekSteps: number;
  rollingCostUsd: number;
  todayCostUsd: number;
  weekCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AccountUsageSnapshot {
  accountId: string;
  provider: ProviderId;
  fetchedAt: string;
  sourceUsed: UsageSource;
  primaryQuota: QuotaWindow;
  secondaryQuota?: QuotaWindow;
  pools?: ManualQuotaPool[];
  metrics: UsageMetrics;
  modelBreakdown: ModelUsageItem[];
  status: UsageStatus;
  statusMessage?: string;
}

export interface AppSettings {
  pollIntervalSeconds: number;
  alwaysOnTop: boolean;
  opacity: number;
  startMode: WidgetMode;
  minimizeToTray: boolean;
  compactCards: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  pollIntervalSeconds: 60,
  alwaysOnTop: true,
  opacity: 0.96,
  startMode: 'mini',
  minimizeToTray: true,
  compactCards: false
};

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface DiscoveredProfile {
  provider: ProviderId;
  suggestedLabel: string;
  profileDir: string;
  details: string;
  alreadyAdded: boolean;
}

export interface AiTrackerApi {
  accountsList: () => Promise<AccountConfig[]>;
  accountsSave: (account: AccountConfig) => Promise<AccountConfig>;
  accountsDelete: (id: string) => Promise<void>;
  accountsSetSecret: (id: string, secret: string) => Promise<void>;
  accountsClearSecret: (id: string) => Promise<void>;
  accountsStartDirectLogin: (accountId: string, provider: ProviderId) => Promise<DirectAuthResult>;
  accountsCancelDirectLogin: (accountId: string) => Promise<void>;
  accountsVerifyCredentials: (provider: ProviderId, token: string) => Promise<CredentialVerifyResult>;
  accountsSignOut: (accountId: string) => Promise<void>;
  accountsDiscover: () => Promise<DiscoveredProfile[]>;
  accountsSeedDiscovered: (profiles: DiscoveredProfile[]) => Promise<AccountConfig[]>;
  accountsApplySnapshot: (id: string, snapshot: ManualQuotaSnapshot) => Promise<AccountConfig>;
  usageGetAll: () => Promise<Record<string, AccountUsageSnapshot>>;
  usageRefreshAll: () => Promise<Record<string, AccountUsageSnapshot>>;
  usageRefreshOne: (id: string) => Promise<AccountUsageSnapshot | null>;
  settingsGet: () => Promise<AppSettings>;
  settingsUpdate: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  settingsExportJson: () => Promise<string>;
  settingsImportJson: (rawJson: string) => Promise<{ importedAccounts: number; settings: AppSettings }>;
  windowGetMode: () => Promise<WidgetMode>;
  windowSetMode: (mode: WidgetMode) => Promise<WidgetMode>;
  windowSetAlwaysOnTop: (value: boolean) => Promise<boolean>;
  windowHide: () => Promise<void>;
  windowPickDirectory: (defaultPath?: string) => Promise<string | null>;
  onUsageUpdated: (callback: (snapshots: Record<string, AccountUsageSnapshot>) => void) => () => void;
  onWindowModeChanged: (callback: (mode: WidgetMode) => void) => () => void;
}
