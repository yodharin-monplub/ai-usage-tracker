import { useMemo, useState, type FormEvent } from 'react';
import { ClipboardPaste, X } from 'lucide-react';
import { formatResetLabel } from '../../shared/formatters';
import {
  PROVIDER_META,
  type AccountConfig,
  type ManualQuotaSnapshot
} from '../../shared/types';
import {
  parseUsageSnapshotText,
  toManualQuotaSnapshot
} from '../../shared/usageSnapshotParser';

interface SnapshotModalProps {
  account: AccountConfig;
  onClose: () => void;
  onApply: (snapshot: ManualQuotaSnapshot) => void;
}

const SAMPLE_BY_PROVIDER: Record<AccountConfig['provider'], string> = {
  'claude-code':
    'Current session: 42% used (Resets in 2h 15m)\nCurrent week (all models): 18% used (Resets in 4d 3h)',
  antigravity:
    'Gemini Models\nWeekly Limit Remaining\nIt will fully refresh in 6 days, 19 hours.\n79%\nFive Hour Limit Remaining\nIt will fully refresh in 4 hours, 12 minutes.\n85%\nClaude and GPT models\nWeekly Limit Remaining\n100%',
  gemini: 'Daily quota: 28% used (resets in 11h 40m)',
  codex:
    '5h limit: 64% remaining (resets in 3h 10m)\nWeekly limit: 82% left (resets in 5d 12h)'
};

export function SnapshotModal({ account, onClose, onApply }: SnapshotModalProps) {
  const existing = account.manualSnapshot;
  const [rawText, setRawText] = useState(existing?.rawText ?? '');
  const [manualUsed, setManualUsed] = useState<number>(existing?.usedPercent ?? 25);
  const [manualLabel, setManualLabel] = useState(
    existing?.label ?? `${account.limits.rollingWindowHours}h Quota`
  );
  const [resetInHours, setResetInHours] = useState<string>('3');
  const [resetInMins, setResetInMins] = useState<string>('0');
  const [secondaryUsed, setSecondaryUsed] = useState<string>(
    typeof existing?.secondaryUsedPercent === 'number'
      ? String(existing.secondaryUsedPercent)
      : ''
  );
  const [secResetDays, setSecResetDays] = useState<string>('6');
  const [secResetHours, setSecResetHours] = useState<string>('0');

  const parsed = useMemo(() => parseUsageSnapshotText(rawText), [rawText]);
  const meta = PROVIDER_META[account.provider];

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed) {
      onApply(toManualQuotaSnapshot(parsed, rawText));
      return;
    }

    const nowMs = Date.now();
    const h = Math.max(0, Number(resetInHours) || 0);
    const m = Math.max(0, Number(resetInMins) || 0);
    const totalMs = (h * 60 + m) * 60_000;
    const resetAtIso =
      totalMs > 0 ? new Date(nowMs + totalMs).toISOString() : undefined;

    const secNum = Number(secondaryUsed);
    const hasSecondary = secondaryUsed.trim() && Number.isFinite(secNum);
    const sd = Math.max(0, Number(secResetDays) || 0);
    const sh = Math.max(0, Number(secResetHours) || 0);
    const secMs = (sd * 24 + sh) * 3_600_000;
    const secResetAtIso =
      hasSecondary && secMs > 0 ? new Date(nowMs + secMs).toISOString() : undefined;

    onApply({
      usedPercent: manualUsed,
      label: manualLabel.trim() || `${account.limits.rollingWindowHours}h Manual Quota`,
      resetAtIso,
      secondaryUsedPercent: hasSecondary ? secNum : undefined,
      secondaryLabel: hasSecondary ? '7d Weekly Quota' : undefined,
      secondaryResetAtIso: secResetAtIso,
      updatedAtIso: new Date(nowMs).toISOString()
    });
  };

  return (
    <div className="modal-backdrop no-drag" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <div className="row-center">
            <ClipboardPaste size={15} color={meta.accentColor} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              Update Quota — {account.label}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field">
            <div className="row-between">
              <label>Paste CLI /usage, /quota, /status, or Antigravity Quota text</label>
              <button
                type="button"
                className="icon-btn tiny"
                onClick={() => setRawText(SAMPLE_BY_PROVIDER[account.provider])}
              >
                Insert sample
              </button>
            </div>
            <textarea
              className="textarea"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={SAMPLE_BY_PROVIDER[account.provider]}
            />
          </div>

          {parsed ? (
            <div className="hint-box">
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Parsed Preview</div>
              <div>
                Primary ({parsed.label}):{' '}
                <strong className="tabular">{parsed.usedPercent}% used</strong>
                {parsed.resetAtIso ? ` · ${formatResetLabel(parsed.resetAtIso)}` : ''}
              </div>
              {typeof parsed.secondaryUsedPercent === 'number' && (
                <div>
                  7d Weekly ({parsed.secondaryLabel ?? 'Weekly'}):{' '}
                  <strong className="tabular">{parsed.secondaryUsedPercent}% used</strong>
                  {parsed.secondaryResetAtIso
                    ? ` · ${formatResetLabel(parsed.secondaryResetAtIso)}`
                    : ''}
                </div>
              )}
              {parsed.pools.length > 0 && (
                <div className="tiny" style={{ marginTop: 4 }}>
                  Pools:{' '}
                  {parsed.pools
                    .map((p) => `${p.name} (${p.usedPercent}% used)`)
                    .join(' · ')}
                </div>
              )}
            </div>
          ) : (
            <div className="card" style={{ padding: 10 }}>
              <div className="tiny muted" style={{ marginBottom: 4 }}>
                Or set quota manually:
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Primary Label</label>
                  <input
                    className="input"
                    value={manualLabel}
                    onChange={(e) => setManualLabel(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Primary Used ({manualUsed}%)</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={manualUsed}
                    onChange={(e) => setManualUsed(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>Primary Resets in (H / M)</label>
                  <div className="row-center">
                    <input
                      type="number"
                      min={0}
                      max={720}
                      className="input"
                      value={resetInHours}
                      onChange={(e) => setResetInHours(e.target.value)}
                    />
                    <span className="muted">h</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      className="input"
                      value={resetInMins}
                      onChange={(e) => setResetInMins(e.target.value)}
                    />
                    <span className="muted">m</span>
                  </div>
                </div>
                <div className="field">
                  <label>7d Weekly % Used (Optional)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input"
                    value={secondaryUsed}
                    onChange={(e) => setSecondaryUsed(e.target.value)}
                    placeholder="e.g. 21"
                  />
                </div>
                <div className="field full">
                  <label>7d Weekly Resets in (Days / Hours)</label>
                  <div className="row-center">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      className="input"
                      value={secResetDays}
                      onChange={(e) => setSecResetDays(e.target.value)}
                    />
                    <span className="muted">d</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      className="input"
                      value={secResetHours}
                      onChange={(e) => setSecResetHours(e.target.value)}
                    />
                    <span className="muted">h</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="row-between">
            <span className="tiny muted">
              Stored locally; expires automatically once reset timestamp passes.
            </span>
            <div className="row-center">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Apply Quota Snapshot
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
