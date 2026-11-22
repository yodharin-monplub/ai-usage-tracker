import { useMemo, useState, type FormEvent } from 'react';
import { ClipboardPaste, X } from 'lucide-react';
import { formatCountdown } from '../../shared/formatters';
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
    'Gemini Models: 75% remaining (resets in 3h 20m)\nClaude / GPT Models: 40% used (resets in 1h 50m)',
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

  const parsed = useMemo(() => parseUsageSnapshotText(rawText), [rawText]);
  const meta = PROVIDER_META[account.provider];

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed) {
      onApply(toManualQuotaSnapshot(parsed, rawText));
      return;
    }

    const h = Math.max(0, Number(resetInHours) || 0);
    const m = Math.max(0, Number(resetInMins) || 0);
    const totalMs = (h * 60 + m) * 60_000;
    const resetAtIso =
      totalMs > 0 ? new Date(Date.now() + totalMs).toISOString() : undefined;
    const secNum = Number(secondaryUsed);

    onApply({
      usedPercent: manualUsed,
      label: manualLabel.trim() || 'Manual Quota',
      resetAtIso,
      secondaryUsedPercent:
        secondaryUsed.trim() && Number.isFinite(secNum) ? secNum : undefined,
      secondaryLabel: secondaryUsed.trim() ? 'Weekly Quota' : undefined,
      updatedAtIso: new Date().toISOString()
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
              <label>Paste CLI /usage, /quota, or /status output</label>
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
                {parsed.resetAtIso ? ` · resets in ${formatCountdown(parsed.resetAtIso)}` : ''}
              </div>
              {typeof parsed.secondaryUsedPercent === 'number' && (
                <div>
                  Secondary ({parsed.secondaryLabel ?? 'Weekly'}):{' '}
                  <strong className="tabular">{parsed.secondaryUsedPercent}% used</strong>
                  {parsed.secondaryResetAtIso
                    ? ` · resets in ${formatCountdown(parsed.secondaryResetAtIso)}`
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
                  <label>Resets in (Hours / Mins)</label>
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
                  <label>Secondary / Weekly % Used (Optional)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input"
                    value={secondaryUsed}
                    onChange={(e) => setSecondaryUsed(e.target.value)}
                    placeholder="e.g. 22"
                  />
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
