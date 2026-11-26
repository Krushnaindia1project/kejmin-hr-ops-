import React, { useEffect, useMemo, useState } from 'react';
import {
  AttendanceRecord,
  AttendanceSettings,
  DAY_NAMES,
  DirectoryEntry,
  Holiday,
} from '../types';
import {
  calcAttendanceStats,
  calcBreakMins,
  calcDayStatus,
  calcLiveWorkedHours,
  calcWorkedHours,
  findHoliday,
  fmtHours,
  isOnActiveBreak,
  isWorkingDay,
  localDateStr,
  pad,
  todayStr,
  toMins,
} from '../utils/crypto';

interface AttendanceViewProps {
  me: DirectoryEntry;
  canSeeTeam: boolean;
  canCorrectAttendance: boolean;
  isAdmin: boolean;
  directory: DirectoryEntry[];
  attendance: AttendanceRecord[];
  holidays: Holiday[];
  settings: AttendanceSettings;
  locations: string[];
  onClockIn: () => Promise<void>;
  onToggleBreak: (rec: AttendanceRecord) => Promise<void>;
  onClockOut: (rec: AttendanceRecord, workedLabel: string) => Promise<void>;
  onCorrectAttendance: (params: {
    targetEmployee: DirectoryEntry;
    date: string;
    inTime: string;
    outTime: string;
    reason: string;
    existingRec?: AttendanceRecord;
  }) => Promise<void>;
  onSaveSettings: (next: Omit<AttendanceSettings, 'updatedAt'>) => Promise<void>;
  onAddHoliday: (date: string, name: string, location: string) => Promise<void>;
  onRemoveHoliday: (holiday: Holiday) => Promise<void>;
}

type AttTab = 'lk' | 'ak' | 'tm' | 'st';

export const AttendanceView: React.FC<AttendanceViewProps> = ({
  me,
  canSeeTeam,
  canCorrectAttendance,
  isAdmin,
  directory,
  attendance,
  holidays,
  settings,
  locations,
  onClockIn,
  onToggleBreak,
  onClockOut,
  onCorrectAttendance,
  onSaveSettings,
  onAddHoliday,
  onRemoveHoliday,
}) => {
  const td = todayStr();
  const [tab, setTab] = useState<AttTab>('lk');
  const [month, setMonth] = useState(() => td.slice(0, 7));
  const [selectedEmpName, setSelectedEmpName] = useState(me.name);
  const [selectedDay, setSelectedDay] = useState(td);
  const [clockText, setClockText] = useState(() => new Date().toLocaleTimeString('en-IN'));
  const [busy, setBusy] = useState(false);

  // Holiday form
  const [holDate, setHolDate] = useState('');
  const [holName, setHolName] = useState('');
  const [holLoc, setHolLoc] = useState('All');

  // Correction modal
  const [showCorrect, setShowCorrect] = useState(false);
  const [corrIn, setCorrIn] = useState('09:30');
  const [corrOut, setCorrOut] = useState('18:30');
  const [corrReason, setCorrReason] = useState('');
  const [corrErr, setCorrErr] = useState('');

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockText(new Date().toLocaleTimeString('en-IN'));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const canBrowseEmployees = canSeeTeam || canCorrectAttendance;

  useEffect(() => {
    if (!canBrowseEmployees && tab === 'tm') setTab('lk');
    if (!isAdmin && tab === 'st') setTab('lk');
  }, [canBrowseEmployees, isAdmin, tab]);

  useEffect(() => {
    if (!canBrowseEmployees) setSelectedEmpName(me.name);
  }, [canBrowseEmployees, me.name]);

  const recordsByEmpAndDate = useMemo(() => {
    const map: Record<string, Record<string, AttendanceRecord>> = {};
    attendance.forEach((r) => {
      if (!map[r.employeeName]) map[r.employeeName] = {};
      map[r.employeeName][r.date] = r;
    });
    return map;
  }, [attendance]);

  const activeEmp = useMemo(() => {
    const targetName = canBrowseEmployees ? selectedEmpName : me.name;
    return directory.find((d) => d.name === targetName) || me;
  }, [canBrowseEmployees, selectedEmpName, directory, me]);

  const myTodayRec = (recordsByEmpAndDate[me.name] || {})[td];
  const onBreakNow = isOnActiveBreak(myTodayRec);
  const liveHours = calcLiveWorkedHours(myTodayRec);
  const shiftHours = Math.max(1, (toMins(settings.en) - toMins(settings.st)) / 60);
  const ringDash = `${Math.min(1, liveHours / shiftHours) * 314} 314`;

  const todayStatusLine = !myTodayRec
    ? 'You have not clocked in today'
    : myTodayRec.out
    ? `In ${myTodayRec.in} · Out ${myTodayRec.out} · ${fmtHours(calcWorkedHours(myTodayRec))}`
    : onBreakNow
    ? `Clocked in at ${myTodayRec.in} · On break`
    : `Clocked in at ${myTodayRec.in}`;

  const weekCircles = useMemo(() => {
    const map = recordsByEmpAndDate[me.name] || {};
    return [6, 5, 4, 3, 2, 1, 0].map((k) => {
      const d = new Date();
      d.setDate(d.getDate() - k);
      const s = localDateStr(d);
      const st = calcDayStatus(map[s], s, me.joinedAt, me.location, settings, holidays);
      return {
        date: s,
        status: st,
        cls: st.replace(/[ -]/g, ''),
        letter: DAY_NAMES[d.getDay()][0],
      };
    });
  }, [recordsByEmpAndDate, me, settings, holidays]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const next = new Date(y, m - 1 + delta, 1);
    const nextMo = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
    setMonth(nextMo);
    setSelectedDay(td.slice(0, 7) === nextMo ? td : `${nextMo}-01`);
  };

  const monthData = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const firstDow = new Date(y, m - 1, 1).getDay();
    const numDays = new Date(y, m, 0).getDate();
    const from = `${month}-01`;
    const lastDate = localDateStr(new Date(y, m, 0));
    const to = lastDate < td ? lastDate : td;
    const empMap = recordsByEmpAndDate[activeEmp.name] || {};
    const stats = calcAttendanceStats(
      empMap,
      activeEmp.joinedAt,
      activeEmp.location,
      from,
      to,
      settings,
      holidays
    );
    const cells: Array<{
      day: number;
      date: string;
      status: string;
      rec?: AttendanceRecord;
      hol?: Holiday;
    }> = [];
    for (let q = 1; q <= numDays; q++) {
      const date = `${month}-${pad(q)}`;
      const rec = empMap[date];
      const status = calcDayStatus(
        rec,
        date,
        activeEmp.joinedAt,
        activeEmp.location,
        settings,
        holidays
      );
      const hol = findHoliday(date, activeEmp.location, holidays);
      cells.push({ day: q, date, status, rec, hol });
    }
    return { firstDow, stats, cells, empMap };
  }, [month, td, recordsByEmpAndDate, activeEmp, settings, holidays]);

  const activeDay =
    selectedDay && selectedDay.slice(0, 7) === month
      ? selectedDay
      : td.slice(0, 7) === month
      ? td
      : `${month}-01`;
  const activeDayRec = monthData.empMap[activeDay];
  const activeDayStatus = calcDayStatus(
    activeDayRec,
    activeDay,
    activeEmp.joinedAt,
    activeEmp.location,
    settings,
    holidays
  );
  const activeDayHol = findHoliday(activeDay, activeEmp.location, holidays);
  const activeDayOt =
    activeDayRec && activeDayRec.out && isWorkingDay(activeDay, activeEmp.location, settings, holidays)
      ? Math.max(0, calcWorkedHours(activeDayRec) - shiftHours)
      : 0;
  const activeDayBreaks = activeDayRec ? calcBreakMins(activeDayRec.breaks || []) : 0;

  const sortedHolidays = useMemo(
    () => [...holidays].sort((a, b) => (a.date < b.date ? -1 : 1)),
    [holidays]
  );

  const openCorrectionModal = () => {
    if (!canCorrectAttendance) return;
    setCorrIn(activeDayRec?.in || settings.st);
    setCorrOut(activeDayRec?.out || settings.en);
    setCorrReason(activeDayRec?.note || '');
    setCorrErr('');
    setShowCorrect(true);
  };

  const handleSaveCorrection = async () => {
    if (!canCorrectAttendance) return;
    if (corrReason.trim().length < 3) {
      setCorrErr('A reason is required for attendance corrections.');
      return;
    }
    setBusy(true);
    try {
      await onCorrectAttendance({
        targetEmployee: activeEmp,
        date: activeDay,
        inTime: corrIn,
        outTime: corrOut,
        reason: corrReason.trim(),
        existingRec: activeDayRec,
      });
      setShowCorrect(false);
    } finally {
      setBusy(false);
    }
  };

  const toggleWorkDay = async (dayIdx: number, checked: boolean) => {
    const wd = checked
      ? Array.from(new Set([...settings.wd, dayIdx])).sort((a, b) => a - b)
      : settings.wd.filter((x) => x !== dayIdx);
    await onSaveSettings({
      settingId: 'attendance',
      wd,
      st: settings.st,
      en: settings.en,
      gr: settings.gr,
      orgId: 'kejmin',
    });
  };

  return (
    <div className="view on" id="v-att">
      <div className="tabs" id="atabs">
        <span className={tab === 'lk' ? 'on' : ''} onClick={() => setTab('lk')}>
          Today
        </span>
        <span className={tab === 'ak' ? 'on' : ''} onClick={() => setTab('ak')}>
          My month
        </span>
        {canBrowseEmployees && (
          <span className={tab === 'tm' ? 'on' : ''} onClick={() => setTab('tm')}>
            Team
          </span>
        )}
        {isAdmin && (
          <span className={tab === 'st' ? 'on' : ''} onClick={() => setTab('st')}>
            Settings
          </span>
        )}
      </div>

      {/* Today Tab */}
      {tab === 'lk' && (
        <div className="glass sec" id="ck" style={{ marginTop: 0 }}>
          <h3>Time clock</h3>
          <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
            <svg viewBox="0 0 120 120" width="130">
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="rgba(120,140,170,.2)"
                strokeWidth="9"
              />
              <circle
                id="rgc"
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="#1d4f9f"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={ringDash}
                transform="rotate(-90 60 60)"
                style={{ transition: 'stroke-dasharray 1s ease' }}
              />
              <text id="rgt" x="60" y="58" textAnchor="middle" style={{ fontSize: 15 }}>
                {fmtHours(liveHours)}
              </text>
              <text x="60" y="76" textAnchor="middle" style={{ fontSize: 9, fontWeight: 400 }}>
                worked today
              </text>
            </svg>

            <div>
              <div className="big" id="clk" style={{ fontSize: 34 }}>
                {clockText}
              </div>
              <div className="sub" id="cs">
                {todayStatusLine}
              </div>
              {myTodayRec && (myTodayRec.breaks || []).length > 0 && (
                <div className="sub" style={{ marginTop: 2 }}>
                  Breaks: {(myTodayRec.breaks || []).join(', ')}
                </div>
              )}
              <div className="wk" id="wk">
                {weekCircles.map((wc, idx) => (
                  <span
                    key={wc.date}
                    className={`wc s-${wc.cls}`}
                    title={`${wc.date}: ${wc.status}`}
                    style={{ animationDelay: `${idx * 60}ms` }}
                  >
                    {wc.letter}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="btn"
                id="ci"
                type="button"
                disabled={busy || !!myTodayRec}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onClockIn();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Clock in
              </button>
              {myTodayRec && !myTodayRec.out && (
                <button
                  className="btn g"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onToggleBreak(myTodayRec);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {onBreakNow ? 'End break' : 'Start break'}
                </button>
              )}
              <button
                className="btn r"
                id="co"
                type="button"
                disabled={busy || !myTodayRec || !!myTodayRec.out}
                onClick={async () => {
                  if (!myTodayRec) return;
                  setBusy(true);
                  try {
                    await onClockOut(myTodayRec, fmtHours(liveHours));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Clock out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* My Month Tab */}
      {tab === 'ak' && (
        <div className="glass sec" id="rc3">
          <h3>Attendance record</h3>
          <div className="row">
            <div>
              <label htmlFor="am">Month</label>
              <input
                type="month"
                id="am"
                value={month}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    setMonth(val);
                    setSelectedDay(td.slice(0, 7) === val ? td : `${val}-01`);
                  }
                }}
              />
            </div>
            <div style={{ flex: 0, minWidth: 0 }}>
              <button className="btn g" id="mp" type="button" onClick={() => shiftMonth(-1)}>
                ‹
              </button>
            </div>
            <div style={{ flex: 0, minWidth: 0 }}>
              <button className="btn g" id="mn" type="button" onClick={() => shiftMonth(1)}>
                ›
              </button>
            </div>
            {canBrowseEmployees && (
              <div id="aew">
                <label htmlFor="ae">Employee</label>
                <select
                  id="ae"
                  value={activeEmp.name}
                  onChange={(e) => setSelectedEmpName(e.target.value)}
                >
                  {directory.map((d) => (
                    <option key={d.docId} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid" id="ak" style={{ marginTop: 14 }}>
            {(
              [
                ['Working days', monthData.stats.w, ''],
                ['Present', monthData.stats.p, ''],
                ['Late marks', monthData.stats.l, 'o'],
                ['Absent', monthData.stats.ab, 'r'],
                ['Hours worked', monthData.stats.h, ''],
                ['Overtime (h)', monthData.stats.ot, 'o'],
                ['Attendance', `${monthData.stats.pct}%`, ''],
              ] as Array<[string, string | number, string]>
            ).map(([label, val, cls], idx) => (
              <div
                key={label}
                className="glass card"
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                <div className="sub">{label}</div>
                <div className={`big ${cls}`}>{val}</div>
              </div>
            ))}
          </div>

          <div className="cal" id="cal" style={{ marginTop: 14 }}>
            {DAY_NAMES.map((d) => (
              <div key={d} className="ch">
                {d}
              </div>
            ))}
            {Array.from({ length: monthData.firstDow }).map((_, idx) => (
              <div key={`e-${idx}`} className="cd e" />
            ))}
            {monthData.cells.map((c) => (
              <div
                key={c.date}
                className={`cd ${c.status ? `s-${c.status.replace(/[ -]/g, '')}` : ''} ${
                  c.date === td ? 'td' : ''
                } ${c.date === activeDay ? 'sel' : ''}`}
                onClick={() => setSelectedDay(c.date)}
              >
                <b>{c.day}</b>
                <span style={{ fontSize: 10, color: 'var(--mut)' }}>
                  {c.rec?.in ? c.rec.in : c.hol ? 'Holiday' : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="lgd">
            <span>
              <i style={{ background: 'var(--blue)' }} />
              Present
            </span>
            <span>
              <i style={{ background: 'var(--org)' }} />
              Late / half day
            </span>
            <span>
              <i style={{ background: 'var(--red)' }} />
              Absent
            </span>
            <span>
              <i style={{ background: '#6b7a90' }} />
              Holiday
            </span>
          </div>

          <div className="glass card" id="dd" style={{ marginTop: 14 }}>
            <div className="sub">
              {activeDay} · {DAY_NAMES[new Date(`${activeDay}T00:00:00`).getDay()]}
              {activeDayHol ? ` · ${activeDayHol.name}` : ''}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
                marginTop: 6,
              }}
            >
              <b style={{ fontSize: 20 }}>{activeDayStatus || 'Upcoming'}</b>
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div className="sub">In</div>
                  <b>{activeDayRec?.in || '-'}</b>
                </div>
                <div>
                  <div className="sub">Out</div>
                  <b>{activeDayRec?.out || '-'}</b>
                </div>
                <div>
                  <div className="sub">Breaks</div>
                  <b>{activeDayBreaks ? `${activeDayBreaks}m` : '-'}</b>
                </div>
                <div>
                  <div className="sub">Hours</div>
                  <b>{activeDayRec?.out ? fmtHours(calcWorkedHours(activeDayRec)) : '-'}</b>
                </div>
                <div>
                  <div className="sub">Overtime</div>
                  <b>{activeDayOt ? fmtHours(activeDayOt) : '-'}</b>
                </div>
                {canCorrectAttendance && activeDay <= td && (
                  <button
                    className="btn g"
                    type="button"
                    style={{ padding: '6px 10px', fontSize: 12 }}
                    onClick={openCorrectionModal}
                  >
                    Correct
                  </button>
                )}
              </div>
            </div>
            {activeDayRec?.note && (
              <div className="sub" style={{ marginTop: 8 }}>
                Correction note: {activeDayRec.note}
                {activeDayRec.correctedBy ? ` (approved by ${activeDayRec.correctedBy})` : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Team Tab */}
      {tab === 'tm' && canBrowseEmployees && (
        <div className="glass sec" id="lb">
          <h3>Today across the company</h3>
          <div className="tbl">
            <table id="lt">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {directory.map((emp) => {
                  const rec = (recordsByEmpAndDate[emp.name] || {})[td];
                  const st = calcDayStatus(rec, td, emp.joinedAt, emp.location, settings, holidays);
                  return (
                    <tr
                      key={emp.docId}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedEmpName(emp.name);
                        setTab('ak');
                      }}
                    >
                      <td>
                        <b>{emp.name}</b>
                      </td>
                      <td>{emp.role}</td>
                      <td>{emp.location}</td>
                      <td>
                        <span className={`tag ${st.replace(/[ -]/g, '')}`}>{st}</span>
                      </td>
                      <td>{rec?.in || '-'}</td>
                      <td>{rec?.out || '-'}</td>
                      <td>{rec?.out ? fmtHours(calcWorkedHours(rec)) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'st' && isAdmin && (
        <div className="glass sec" id="asx">
          <h3>Working days, shift and holidays</h3>
          <label>Working days</label>
          <div className="pc" id="wdc">
            {DAY_NAMES.map((d, i) => (
              <label key={d}>
                <input
                  type="checkbox"
                  checked={settings.wd.includes(i)}
                  onChange={(e) => toggleWorkDay(i, e.target.checked)}
                />
                {d}
              </label>
            ))}
          </div>

          <div className="row">
            <div>
              <label htmlFor="ss">Shift start</label>
              <input
                type="time"
                id="ss"
                value={settings.st}
                onChange={(e) =>
                  onSaveSettings({
                    settingId: 'attendance',
                    wd: settings.wd,
                    st: e.target.value || settings.st,
                    en: settings.en,
                    gr: settings.gr,
                    orgId: 'kejmin',
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="se">Shift end</label>
              <input
                type="time"
                id="se"
                value={settings.en}
                onChange={(e) =>
                  onSaveSettings({
                    settingId: 'attendance',
                    wd: settings.wd,
                    st: settings.st,
                    en: e.target.value || settings.en,
                    gr: settings.gr,
                    orgId: 'kejmin',
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="sg">Grace (minutes)</label>
              <input
                type="number"
                id="sg"
                min={0}
                max={240}
                value={settings.gr}
                onChange={(e) =>
                  onSaveSettings({
                    settingId: 'attendance',
                    wd: settings.wd,
                    st: settings.st,
                    en: settings.en,
                    gr: Math.max(0, Math.min(240, Number(e.target.value) || 0)),
                    orgId: 'kejmin',
                  })
                }
              />
            </div>
          </div>

          <label>Holiday calendar</label>
          <div className="row">
            <div>
              <label htmlFor="hd">Date</label>
              <input
                type="date"
                id="hd"
                value={holDate}
                onChange={(e) => setHolDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="hn">Holiday name</label>
              <input
                id="hn"
                placeholder="e.g. Diwali"
                value={holName}
                onChange={(e) => setHolName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="hlc">Location</label>
              <select id="hlc" value={holLoc} onChange={(e) => setHolLoc(e.target.value)}>
                <option value="All">All</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 0 }}>
              <button
                className="btn"
                id="hadd"
                type="button"
                onClick={async () => {
                  if (!holDate || !holName.trim()) return;
                  await onAddHoliday(holDate, holName.trim(), holLoc);
                  setHolDate('');
                  setHolName('');
                }}
              >
                Add holiday
              </button>
            </div>
          </div>

          <div id="hl" style={{ marginTop: 10 }}>
            {sortedHolidays.map((h) => (
              <div
                key={h.holidayId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '7px 0',
                  borderTop: '1px solid var(--bd)',
                }}
              >
                <span>
                  {h.date} · {h.name}
                  {h.location && h.location !== 'All' ? ` (${h.location})` : ''}
                </span>
                <button
                  className="btn g"
                  type="button"
                  onClick={() => onRemoveHoliday(h)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attendance Correction Modal (Blueprint: requires reason & logs approver) */}
      {showCorrect && canCorrectAttendance && (
        <div
          className="ov"
          onClick={(e) => e.target === e.currentTarget && setShowCorrect(false)}
        >
          <div className="md">
            <h3>Correct attendance</h3>
            <div className="sub">
              {activeEmp.name} · {activeDay}
            </div>
            <div className="row">
              <div>
                <label>Clock in</label>
                <input
                  type="time"
                  value={corrIn}
                  onChange={(e) => setCorrIn(e.target.value)}
                />
              </div>
              <div>
                <label>Clock out</label>
                <input
                  type="time"
                  value={corrOut}
                  onChange={(e) => setCorrOut(e.target.value)}
                />
              </div>
            </div>
            <label>Reason (required, logged with approver)</label>
            <input
              placeholder="e.g. Forgot to clock out after Plant 1 shift"
              value={corrReason}
              onChange={(e) => {
                setCorrReason(e.target.value);
                setCorrErr('');
              }}
            />
            {corrErr && <div className="er">{corrErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                className="btn g"
                type="button"
                onClick={() => setShowCorrect(false)}
              >
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={handleSaveCorrection}
              >
                Save correction
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
