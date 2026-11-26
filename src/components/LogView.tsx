import React, { useMemo, useRef, useState } from 'react';
import { AuditCategory, AuditLogEntry, DirectoryEntry } from '../types';
import { dayOffset, fmtTimestamp } from '../utils/crypto';

interface LogViewProps {
  me: DirectoryEntry;
  auditLogs: AuditLogEntry[];
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
];

export const LogView: React.FC<LogViewProps> = ({ me, auditLogs }) => {
  const [fromDate, setFromDate] = useState(() => dayOffset(30));
  const [toDate, setToDate] = useState(() => dayOffset(0));
  const [userFilter, setUserFilter] = useState('All');
  const [catFilter, setCatFilter] = useState('All');
  const [grepText, setGrepText] = useState('');
  const [limit, setLimit] = useState(200);
  const [csvText, setCsvText] = useState<string | null>(null);
  const csvRef = useRef<HTMLTextAreaElement>(null);

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
          <div>
            <button className="tbtn" id="lgex" type="button" onClick={handleExportCsv}>
              export csv
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
    </div>
  );
};
