import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuditCategory, AuditLogEntry, DirectoryEntry } from '../types';
import { ResetDataResult, ResetDataScope } from '../services/firestoreService';
import { dayOffset, fmtTimestamp } from '../utils/crypto';

interface LogViewProps {
  me: DirectoryEntry;
  auditLogs: AuditLogEntry[];
  counts: {
    tasks: number;
    kpi: number;
    attendance: number;
    logs: number;
  };
  onResetData: (scope: ResetDataScope) => Promise<ResetDataResult>;
}

const LOG_CATEGORIES: AuditCategory[] = [
  'Sign-in',
  'Task',
  'User',
  'Delete',
  'Attendance',
  'Role',
  'Security',
  'Export',
  'Upload',
  'Ticket',
];

export const LogView: React.FC<LogViewProps> = ({ me, auditLogs, counts, onResetData }) => {
  const [fromDate, setFromDate] = useState(() => dayOffset(30));
  const [toDate, setToDate] = useState(() => dayOffset(0));
  const [userFilter, setUserFilter] = useState('All');
  const [catFilter, setCatFilter] = useState('All');
  const [grepText, setGrepText] = useState('');
  const [limit, setLimit] = useState(200);
  const [csvText, setCsvText] = useState<string | null>(null);
  const csvRef = useRef<HTMLTextAreaElement>(null);

  // Reset modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTasks, setResetTasks] = useState(true);
  const [resetKpi, setResetKpi] = useState(true);
  const [resetAttendance, setResetAttendance] = useState(false);
  const [resetLogs, setResetLogs] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState('');

  const isDev = me.role === 'Developer';

  const normalized = useMemo(
    () =>
      auditLogs.map((l) => ({
        ...l,
        tsMs: l.at ? l.at.toMillis() : Date.now(),
      })),
    [auditLogs]
  );

  const userOptions = useMemo(
    () => ['All', ...Array.from(new Set(normalized.map((e) => e.actor)))],
    [normalized]
  );

  const filtered = useMemo(() => {
    const a = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : 0;
    const b = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity;
    const q = grepText.trim().toLowerCase();

    return normalized
      .filter(
        (e) =>
          e.tsMs >= a &&
          e.tsMs <= b &&
          (userFilter === 'All' || e.actor === userFilter) &&
          (catFilter === 'All' || e.category === catFilter) &&
          (!q || `${e.actor} ${e.actorUserId} ${e.category} ${e.action}`.toLowerCase().includes(q))
      )
      .sort((x, y) => y.tsMs - x.tsMs);
  }, [normalized, fromDate, toDate, userFilter, catFilter, grepText]);

  if (!isDev) return null;

  const shown = filtered.slice(0, limit);
  const who = `${me.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@${me.empId}`;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const uniqueUsers = new Set(filtered.map((e) => e.actor)).size;
  const todayCount = filtered.filter((e) => e.tsMs >= todayStart.getTime()).length;
  const deletedCount = filtered.filter((e) => e.category === 'Delete').length;

  const handleExportCsv = () => {
    const q = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [
      'Time,User,User ID,Type,What happened',
      ...filtered.map((e) =>
        [fmtTimestamp(e.tsMs), e.actor, e.actorUserId, e.category, e.action].map(q).join(',')
      ),
    ].join('\n');
    setCsvText(csv);
    setTimeout(() => {
      csvRef.current?.select();
      try {
        navigator.clipboard?.writeText(csv).catch(() => {});
      } catch {
        // ignore
      }
    }, 50);
  };

  const openResetModal = () => {
    setResetTasks(true);
    setResetKpi(true);
    setResetAttendance(false);
    setResetLogs(false);
    setResetConfirmed(false);
    setResetErr('');
    setShowResetModal(true);
  };

  const applyResetPreset = (preset: 'tasks_kpi' | 'reports' | 'all') => {
    setResetErr('');
    setResetConfirmed(false);
    if (preset === 'tasks_kpi') {
      setResetTasks(true);
      setResetKpi(true);
      setResetAttendance(false);
      setResetLogs(false);
    } else if (preset === 'reports') {
      setResetTasks(true);
      setResetKpi(true);
      setResetAttendance(true);
      setResetLogs(false);
    } else {
      setResetTasks(true);
      setResetKpi(true);
      setResetAttendance(true);
      setResetLogs(true);
    }
  };

  const hasAnyResetSelected = resetTasks || resetKpi || resetAttendance || resetLogs;

  const handleExecuteReset = async () => {
    if (!hasAnyResetSelected) {
      setResetErr('Please select at least one item to reset.');
      return;
    }
    if (!resetConfirmed) {
      setResetErr('Please check the confirmation box before resetting.');
      return;
    }
    setResetBusy(true);
    setResetErr('');
    try {
      await onResetData({
        resetTasks,
        resetKpi,
        resetAttendance,
        resetLogs,
      });
      setShowResetModal(false);
      setResetConfirmed(false);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Unable to reset selected data.';
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        setResetErr(parsed.error || raw);
      } catch {
        setResetErr(raw);
      }
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="view on" id="v-log">
      <div className="term">
        <div className="tbar">
          <span>kejmin-ops: activity log · developer only · read only</span>
          <span id="lgk">
            {filtered.length} line{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="tfl">
          <div>
            <label htmlFor="lgf1">--from</label>
            <input
              type="date"
              id="lgf1"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setLimit(200);
              }}
            />
          </div>
          <div>
            <label htmlFor="lgf2">--to</label>
            <input
              type="date"
              id="lgf2"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setLimit(200);
              }}
            />
          </div>
          <div>
            <label htmlFor="lgfu">--user</label>
            <select
              id="lgfu"
              value={userFilter}
              onChange={(e) => {
                setUserFilter(e.target.value);
                setLimit(200);
              }}
            >
              {userOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lgfc">--type</label>
            <select
              id="lgfc"
              value={catFilter}
              onChange={(e) => {
                setCatFilter(e.target.value);
                setLimit(200);
              }}
            >
              <option value="All">All</option>
              {LOG_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lgfq">grep</label>
            <input
              id="lgfq"
              placeholder="task, user, action"
              value={grepText}
              onChange={(e) => {
                setGrepText(e.target.value);
                setLimit(200);
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="tbtn" id="lgex" type="button" onClick={handleExportCsv}>
              export csv
            </button>
            <button
              className="tbtn danger"
              id="lgrst"
              type="button"
              onClick={openResetModal}
              title="Reset Tasks, KPI points, Reports, or Activity Log from scratch"
            >
              reset data
            </button>
          </div>
        </div>

        <div className="tbody">
          <div className="pr" id="lgp">
            <span>{who}</span>:<i>~</i>$ sort -r activity.log | head -n{' '}
            {Math.min(limit, filtered.length)}
          </div>
          <div className="sm" id="lgs">
            # {filtered.length} event{filtered.length === 1 ? '' : 's'} · {uniqueUsers} user
            {uniqueUsers === 1 ? '' : 's'} · {todayCount} today · {deletedCount} deleted · newest
            first
          </div>

          <div id="lgt">
            {shown.length === 0 ? (
              <div className="sm">
                No events match these filters. Actions people take from now on will appear here.
              </div>
            ) : (
              shown.map((e) => (
                <div key={e.logId} className="ln">
                  <span className="tm">{fmtTimestamp(e.tsMs)}</span>
                  <span className="us">
                    {e.actor}
                    {e.actorUserId ? <span className="tm"> @{e.actorUserId}</span> : null}
                  </span>
                  <span className={`ty c-${e.category}`}>{e.category.toUpperCase()}</span>
                  <span className="tx">{e.action}</span>
                </div>
              ))
            )}
          </div>

          {filtered.length > limit && (
            <div style={{ marginTop: 8 }}>
              <button
                className="tbtn"
                id="lgmore"
                type="button"
                onClick={() => setLimit((n) => n + 200)}
              >
                load more ({filtered.length - limit} lines left)
              </button>
            </div>
          )}

          {csvText !== null && (
            <textarea
              ref={csvRef}
              id="lgcsv"
              style={{
                display: 'block',
                marginTop: 12,
                width: '100%',
                minHeight: 120,
                background: '#010409',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: 6,
                font: 'inherit',
                padding: 8,
              }}
              readOnly
              value={csvText}
            />
          )}

          <div className="pr" style={{ marginTop: 12 }} id="lgp2">
            <span>{who}</span>:<i>~</i>$ <span className="cur" />
          </div>
        </div>
      </div>

      {showResetModal &&
        createPortal(
          <div
            className="ov"
            onClick={(e) => {
              if (e.target === e.currentTarget && !resetBusy) {
                setShowResetModal(false);
              }
            }}
          >
            <div className="md" style={{ width: 'min(540px, 100%)' }}>
              <h3 style={{ marginBottom: 4 }}>Reset Data &amp; Start Fresh</h3>
              <div className="sub">
                Choose what to reset back to <b>0</b> and delete permanently so the organization can
                start newly from scratch.
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginTop: 14,
                  marginBottom: 12,
                }}
              >
                <button
                  type="button"
                  className="btn g"
                  style={{ padding: '6px 10px', fontSize: 12 }}
                  disabled={resetBusy}
                  onClick={() => applyResetPreset('tasks_kpi')}
                >
                  Tasks + KPI
                </button>
                <button
                  type="button"
                  className="btn g"
                  style={{ padding: '6px 10px', fontSize: 12 }}
                  disabled={resetBusy}
                  onClick={() => applyResetPreset('reports')}
                >
                  Full Report Reset (Tasks + KPI + Attendance)
                </button>
                <button
                  type="button"
                  className="btn g"
                  style={{ padding: '6px 10px', fontSize: 12 }}
                  disabled={resetBusy}
                  onClick={() => applyResetPreset('all')}
                >
                  Select All
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    margin: 0,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--bd)',
                    background: 'var(--glass)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginTop: 3 }}
                    checked={resetTasks}
                    disabled={resetBusy}
                    onChange={(e) => {
                      setResetTasks(e.target.checked);
                      setResetErr('');
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--tx)', fontSize: 13.5 }}>
                      Reset Tasks ({counts.tasks} record{counts.tasks === 1 ? '' : 's'})
                    </div>
                    <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>
                      Deletes all open and completed tasks along with task alert notifications.
                    </div>
                  </div>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    margin: 0,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--bd)',
                    background: 'var(--glass)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginTop: 3 }}
                    checked={resetKpi}
                    disabled={resetBusy}
                    onChange={(e) => {
                      setResetKpi(e.target.checked);
                      setResetErr('');
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--tx)', fontSize: 13.5 }}>
                      Reset KPI &amp; Score Points ({counts.kpi} event{counts.kpi === 1 ? '' : 's'})
                    </div>
                    <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>
                      Deletes all KPI score history and resets every employee&apos;s KPI points back
                      to <b>0</b>.
                    </div>
                  </div>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    margin: 0,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--bd)',
                    background: 'var(--glass)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginTop: 3 }}
                    checked={resetAttendance}
                    disabled={resetBusy}
                    onChange={(e) => {
                      setResetAttendance(e.target.checked);
                      setResetErr('');
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--tx)', fontSize: 13.5 }}>
                      Reset Reports Attendance Records ({counts.attendance} record
                      {counts.attendance === 1 ? '' : 's'})
                    </div>
                    <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>
                      Clears all daily attendance logs. Combine with Tasks &amp; KPI above to reset
                      the entire Reports &amp; Analytics page to <b>0</b>.
                    </div>
                  </div>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    margin: 0,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--bd)',
                    background: 'var(--glass)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginTop: 3 }}
                    checked={resetLogs}
                    disabled={resetBusy}
                    onChange={(e) => {
                      setResetLogs(e.target.checked);
                      setResetErr('');
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--tx)', fontSize: 13.5 }}>
                      Reset Activity Log ({counts.logs} line{counts.logs === 1 ? '' : 's'})
                    </div>
                    <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>
                      Clears past activity log history and records only this reset action going
                      forward.
                    </div>
                  </div>
                </label>
              </div>

              <div
                className="sub"
                style={{
                  marginTop: 12,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--bd)',
                  fontSize: 12,
                }}
              >
                <b>Preserved safely:</b> Users, Roles &amp; Access, Branches, Locations, Workflow
                Templates, Holidays, Attendance Settings, and Share Folder files are not deleted.
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 14,
                  marginBottom: 0,
                  color: 'var(--red)',
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={resetConfirmed}
                  disabled={resetBusy}
                  onChange={(e) => {
                    setResetConfirmed(e.target.checked);
                    setResetErr('');
                  }}
                />
                I confirm I want to permanently delete the selected records and start from 0.
              </label>

              {resetErr && <div className="er">{resetErr}</div>}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                <button
                  className="btn g"
                  type="button"
                  disabled={resetBusy}
                  onClick={() => setShowResetModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn r"
                  type="button"
                  disabled={resetBusy || !hasAnyResetSelected || !resetConfirmed}
                  onClick={() => void handleExecuteReset()}
                >
                  {resetBusy ? 'Resetting...' : 'Reset Selected Data'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
