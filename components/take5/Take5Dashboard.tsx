import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  Inbox,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Trophy,
  XCircle,
} from 'lucide-react';
import { ThemeType } from '../../types';
import { api, ServiceOffline, type IssueDetail, type IssueSummary, type Status } from './api';

interface Take5DashboardProps {
  theme: ThemeType;
}

const palette = {
  dark: { card: 'bg-zinc-900/40', border: 'border-zinc-800', muted: 'text-zinc-400' },
  amoled: { card: 'bg-zinc-900/10', border: 'border-zinc-900', muted: 'text-zinc-600' },
  sepia: { card: 'bg-[#e8dfc4]/40', border: 'border-[#d3cbb3]', muted: 'text-[#7a6a55]' },
  light: { card: 'bg-zinc-100/60', border: 'border-zinc-200', muted: 'text-zinc-500' },
};

const confidenceTone = (value: number, floor: number): string =>
  value >= floor ? 'text-emerald-400' : value > 0 ? 'text-amber-400' : 'text-zinc-500';

const statusTone: Record<string, string> = {
  submitted: 'text-emerald-400',
  'dry-run': 'text-cyan-400',
  skipped: 'text-zinc-500',
  failed: 'text-red-400',
};

const Take5Dashboard: React.FC<Take5DashboardProps> = ({ theme }) => {
  const colours = palette[theme];

  const [status, setStatus] = useState<Status | null>(null);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const handle = (err: unknown) => {
    if (err instanceof ServiceOffline) {
      setOffline(true);
      setError(err.message);
    } else {
      setError((err as Error).message);
    }
  };

  const refresh = useCallback(async () => {
    setBusy('refresh');
    setError(null);
    try {
      const [nextStatus, nextIssues] = await Promise.all([api.status(), api.issues()]);
      setStatus(nextStatus);
      setIssues(nextIssues);
      setOffline(false);
    } catch (err) {
      handle(err);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setBusy('detail');
    api
      .issue(selected)
      .then(setDetail)
      .catch(handle)
      .finally(() => setBusy(null));
  }, [selected]);

  const reloadDetail = async () => {
    if (selected) setDetail(await api.issue(selected));
  };

  const onSolve = async () => {
    if (!selected) return;
    setBusy('solve');
    setError(null);
    try {
      await api.solve(selected);
      await reloadDetail();
    } catch (err) {
      handle(err);
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async (live: boolean) => {
    if (!selected) return;
    // Live submission is irreversible and these comps are one entry per person,
    // so it always asks — even though the scheduler runs unattended.
    if (live && !window.confirm('Submit these entries for real? Entries cannot be withdrawn.')) return;

    setBusy(live ? 'submit-live' : 'submit-dry');
    setError(null);
    try {
      await api.submit(selected, live);
      await reloadDetail();
      await refresh();
    } catch (err) {
      handle(err);
    } finally {
      setBusy(null);
    }
  };

  const solutionFor = (puzzleId: string) => detail?.solutions.find((s) => s.puzzleId === puzzleId);
  const receiptFor = (puzzleId: string) =>
    detail?.receipts.filter((r) => r.puzzleId === puzzleId).slice(-1)[0];

  const button =
    'flex items-center gap-2 px-6 py-3 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Take 5 entries</h2>
          <p className={`${colours.muted} mt-1`}>
            Imports each issue, solves the puzzles and lodges the entries.
          </p>
        </div>
        <button onClick={refresh} disabled={busy !== null} className={`${button} bg-zinc-800/40 hover:bg-zinc-800/70`}>
          {busy === 'refresh' ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 p-5 rounded-2xl border border-red-900/60 bg-red-950/30 flex gap-3">
          <AlertTriangle className="text-red-400 shrink-0" size={22} />
          <div>
            <p className="text-red-200">{error}</p>
            {offline && (
              <p className={`${colours.muted} text-sm mt-2 font-mono`}>cd take5 &amp;&amp; npm run serve</p>
            )}
          </div>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { icon: Inbox, label: 'In the inbox', value: String(status.inbox) },
            { icon: Trophy, label: 'Entries lodged', value: String(status.entries) },
            { icon: Clock, label: 'Schedule', value: `${status.cron}` },
            {
              icon: status.dryRun ? ShieldCheck : Send,
              label: status.dryRun ? 'Dry run' : 'Live',
              value: status.dryRun ? 'nothing submitted' : 'submitting',
            },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className={`${colours.card} border ${colours.border} rounded-2xl p-5`}>
              <div className={`flex items-center gap-2 ${colours.muted} text-sm mb-2`}>
                <Icon size={16} />
                {label}
              </div>
              <div className="text-lg font-semibold truncate" title={value}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-[280px_1fr] gap-8">
        <aside>
          <h3 className={`${colours.muted} text-sm uppercase tracking-wide mb-3`}>Issues</h3>
          {issues.length === 0 && !offline && (
            <p className={colours.muted}>
              No issues yet — drop a PDF into <span className="font-mono">take5/data/inbox</span>.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {issues.map((issue) => (
              <button
                key={issue.id}
                onClick={() => setSelected(issue.id)}
                className={`text-left px-5 py-4 rounded-xl border transition-all ${
                  selected === issue.id
                    ? 'border-cyan-600 bg-cyan-950/20'
                    : `${colours.border} ${colours.card} hover:border-cyan-800`
                }`}
              >
                <div className="font-medium truncate">{issue.title}</div>
                <div className={`${colours.muted} text-sm flex items-center gap-2 mt-1`}>
                  {issue.puzzles} puzzles
                  {issue.warnings > 0 && (
                    <span className="text-amber-400 flex items-center gap-1">
                      <FileWarning size={13} />
                      {issue.warnings}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section>
          {!detail && <p className={colours.muted}>Select an issue to see its puzzles.</p>}

          {detail && (
            <>
              <div className="flex flex-wrap gap-3 mb-6">
                <button onClick={onSolve} disabled={busy !== null} className={`${button} bg-cyan-700 hover:bg-cyan-600 text-white`}>
                  {busy === 'solve' ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                  Solve all
                </button>
                <button
                  onClick={() => onSubmit(false)}
                  disabled={busy !== null || detail.solutions.length === 0}
                  className={`${button} bg-zinc-800/40 hover:bg-zinc-800/70`}
                >
                  {busy === 'submit-dry' ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                  Dry run
                </button>
                <button
                  onClick={() => onSubmit(true)}
                  disabled={busy !== null || detail.solutions.length === 0}
                  className={`${button} bg-emerald-700 hover:bg-emerald-600 text-white`}
                >
                  {busy === 'submit-live' ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  Submit for real
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {detail.issue.puzzles.map((puzzle) => {
                  const solution = solutionFor(puzzle.id);
                  const receipt = receiptFor(puzzle.id);
                  return (
                    <div key={puzzle.id} className={`${colours.card} border ${colours.border} rounded-2xl p-5`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {solution?.solved ? (
                              <CheckCircle2 className="text-emerald-400 shrink-0" size={18} />
                            ) : solution ? (
                              <XCircle className="text-red-400 shrink-0" size={18} />
                            ) : (
                              <Clock className={`${colours.muted} shrink-0`} size={18} />
                            )}
                            <span className="font-medium truncate">{puzzle.title}</span>
                            <span className={`${colours.muted} text-sm`}>
                              {puzzle.kind} · p{puzzle.page}
                              {puzzle.prize ? ` · ${puzzle.prize}` : ''}
                            </span>
                          </div>

                          {solution?.answer && (
                            <div className="mt-2 font-mono text-lg tracking-wider break-all">{solution.answer}</div>
                          )}

                          {puzzle.warnings.map((warning) => (
                            <div key={warning} className="mt-2 text-amber-400 text-sm flex items-start gap-2">
                              <FileWarning size={14} className="mt-0.5 shrink-0" />
                              {warning}
                            </div>
                          ))}
                          {solution?.notes.map((note) => (
                            <div key={note} className={`${colours.muted} text-sm mt-1`}>
                              · {note}
                            </div>
                          ))}
                        </div>

                        <div className="text-right shrink-0">
                          {solution && (
                            <div
                              className={`font-mono ${confidenceTone(solution.confidence, status?.minConfidence ?? 0.9)}`}
                              title="confidence"
                            >
                              {solution.confidence.toFixed(2)}
                            </div>
                          )}
                          {receipt && (
                            <div className={`text-sm mt-1 ${statusTone[receipt.status] ?? colours.muted}`}>
                              {receipt.status}
                            </div>
                          )}
                        </div>
                      </div>

                      {receipt?.message && (
                        <div className={`${colours.muted} text-sm mt-3 border-t ${colours.border} pt-3`}>
                          {receipt.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default Take5Dashboard;
