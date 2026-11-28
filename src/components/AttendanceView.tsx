import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import {
  AttendanceRecord,
  AttendanceSettings,
  CalendarTodo,
  DAY_NAMES,
  DirectoryEntry,
  Holiday,
  isDeveloperRole,
  TodoNoteColor,
} from '../types';
import {
  addDaysToDateStr,
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
  nowTimeStr,
  pad,
  round1,
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
  calendarTodos: CalendarTodo[];
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
  onAddCalendarTodo: (params: {
    date: string;
    text: string;
    color: TodoNoteColor;
  }) => Promise<void>;
  onUpdateCalendarTodo: (params: {
    todo: CalendarTodo;
    text?: string;
    done?: boolean;
    color?: TodoNoteColor;
    date?: string;
  }) => Promise<void>;
  onDeleteCalendarTodo: (todoId: string) => Promise<void>;
  onExportAttendance?: (meta: string) => void;
}

type AttTab = 'lk' | 'ak' | 'tm' | 'st';

const STICKY_COLORS: Array<{ id: TodoNoteColor; label: string }> = [
  { id: 'yellow', label: 'Amber note' },
  { id: 'blue', label: 'Sky note' },
  { id: 'green', label: 'Mint note' },
  { id: 'pink', label: 'Rose note' },
];

export const AttendanceView: React.FC<AttendanceViewProps> = ({
  me,
  canSeeTeam,
  canCorrectAttendance,
  isAdmin,
  directory,
  attendance,
  calendarTodos,
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
  onAddCalendarTodo,
  onUpdateCalendarTodo,
  onDeleteCalendarTodo,
  onExportAttendance,
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

  // Calendar sticky-note to-do modal
  const [todoModalDate, setTodoModalDate] = useState<string | null>(null);
  const [todoDraft, setTodoDraft] = useState('');
  const [todoColor, setTodoColor] = useState<TodoNoteColor>('yellow');
  const [todoBusy, setTodoBusy] = useState(false);
  const [todoErr, setTodoErr] = useState('');
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState('');
  const todoInputRef = useRef<HTMLInputElement | null>(null);

  // Team date-range viewer & Excel export filters
  const [teamFrom, setTeamFrom] = useState(() => `${td.slice(0, 7)}-01`);
  const [teamTo, setTeamTo] = useState(() => td);
  const [teamUserEmpId, setTeamUserEmpId] = useState<string>('ALL');
  const [teamViewMode, setTeamViewMode] = useState<'summary' | 'daily'>('summary');

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockText(new Date().toLocaleTimeString('en-IN'));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const isDeveloper = isDeveloperRole(me.role);
  const canBrowseEmployees = canSeeTeam || canCorrectAttendance;

  useEffect(() => {
    if (!canBrowseEmployees && tab === 'tm') setTab('lk');
    if (!isAdmin && tab === 'st') setTab('lk');
  }, [canBrowseEmployees, isAdmin, tab]);

  useEffect(() => {
    if (!isDeveloper) setSelectedEmpName(me.name);
  }, [isDeveloper, me.name]);

  const recordsByEmpAndDate = useMemo(() => {
    const map: Record<string, Record<string, AttendanceRecord>> = {};
    attendance.forEach((r) => {
      if (!map[r.employeeName]) map[r.employeeName] = {};
      map[r.employeeName][r.date] = r;
    });
    return map;
  }, [attendance]);

  const activeEmp = useMemo(() => {
    const targetName = isDeveloper ? selectedEmpName : me.name;
    return directory.find((d) => d.name === targetName) || me;
  }, [isDeveloper, selectedEmpName, directory, me]);

  const isViewingOwnCalendar = activeEmp.empId === me.empId;

  const myTodosByDate = useMemo(() => {
    const map: Record<string, CalendarTodo[]> = {};
    const mine = calendarTodos
      .filter((t) => t.empId === me.empId)
      .sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
    mine.forEach((t) => {
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push(t);
    });
    return map;
  }, [calendarTodos, me.empId]);

  const monthTodoStats = useMemo(() => {
    let open = 0;
    let done = 0;
    Object.entries(myTodosByDate).forEach(([dateKey, items]) => {
      if (dateKey.slice(0, 7) !== month) return;
      items.forEach((item) => {
        if (item.done) done++;
        else open++;
      });
    });
    return { open, done, total: open + done };
  }, [myTodosByDate, month]);

  useEffect(() => {
    if (!todoModalDate) return;
    const focusTimer = window.setTimeout(() => {
      todoInputRef.current?.focus();
    }, 30);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTodoModalDate(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [todoModalDate]);

  const openTodoModal = (dateStr: string) => {
    if (!isViewingOwnCalendar) return;
    setSelectedDay(dateStr);
    if (dateStr.slice(0, 7) !== month) {
      setMonth(dateStr.slice(0, 7));
    }
    const existing = myTodosByDate[dateStr] || [];
    const defaultColor = existing.find((t) => !t.done)?.color || existing[0]?.color || 'yellow';
    setTodoColor(defaultColor);
    setTodoDraft('');
    setTodoErr('');
    setEditingTodoId(null);
    setEditingTodoText('');
    setTodoModalDate(dateStr);
  };

  const handleAddTodo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!todoModalDate) return;
    const clean = todoDraft.trim();
    if (!clean) {
      setTodoErr('Write a to-do item first.');
      todoInputRef.current?.focus();
      return;
    }
    setTodoBusy(true);
    setTodoErr('');
    try {
      await onAddCalendarTodo({
        date: todoModalDate,
        text: clean,
        color: todoColor,
      });
      setTodoDraft('');
      window.setTimeout(() => todoInputRef.current?.focus(), 20);
    } catch (err) {
      setTodoErr(err instanceof Error ? err.message : 'Could not save to-do.');
    } finally {
      setTodoBusy(false);
    }
  };

  const handleToggleTodo = async (todo: CalendarTodo) => {
    setTodoBusy(true);
    try {
      await onUpdateCalendarTodo({ todo, done: !todo.done });
    } finally {
      setTodoBusy(false);
    }
  };

  const handleSaveEditTodo = async (todo: CalendarTodo) => {
    const clean = editingTodoText.trim();
    if (!clean) {
      setTodoErr('To-do text cannot be empty.');
      return;
    }
    setTodoBusy(true);
    setTodoErr('');
    try {
      await onUpdateCalendarTodo({ todo, text: clean });
      setEditingTodoId(null);
      setEditingTodoText('');
    } catch (err) {
      setTodoErr(err instanceof Error ? err.message : 'Could not update to-do.');
    } finally {
      setTodoBusy(false);
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    setTodoBusy(true);
    try {
      await onDeleteCalendarTodo(todoId);
      if (editingTodoId === todoId) {
        setEditingTodoId(null);
        setEditingTodoText('');
      }
    } finally {
      setTodoBusy(false);
    }
  };

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
  const activeDayTodos = isViewingOwnCalendar ? myTodosByDate[activeDay] || [] : [];
  const modalDayTodos = todoModalDate ? myTodosByDate[todoModalDate] || [] : [];

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

  const sortedDirectory = useMemo(
    () => [...directory].sort((a, b) => a.name.localeCompare(b.name)),
    [directory]
  );

  const teamDateList = useMemo(() => {
    if (!teamFrom || !teamTo || teamFrom > teamTo) {
      return { dates: [] as string[], error: 'From date cannot be after To date.' };
    }
    const dates: string[] = [];
    let cursor = teamFrom;
    for (let i = 0; i < 366; i++) {
      dates.push(cursor);
      if (cursor === teamTo) {
        return { dates, error: '' };
      }
      cursor = addDaysToDateStr(cursor, 1);
    }
    return {
      dates,
      error: 'Showing the first 366 days. Narrow the date range if you need a longer span.',
    };
  }, [teamFrom, teamTo]);

  const teamExportData = useMemo(() => {
    const selectedEmployees =
      teamUserEmpId === 'ALL'
        ? sortedDirectory
        : sortedDirectory.filter((e) => e.empId === teamUserEmpId);

    const summaries = selectedEmployees.map((emp) => {
      const empMap = recordsByEmpAndDate[emp.name] || {};
      const stats = calcAttendanceStats(
        empMap,
        emp.joinedAt,
        emp.location,
        teamFrom,
        teamTo,
        settings,
        holidays
      );
      let halfDays = 0;
      let offDays = 0;
      teamDateList.dates.forEach((date) => {
        const rec = empMap[date];
        const st = calcDayStatus(rec, date, emp.joinedAt, emp.location, settings, holidays);
        if (st === 'Half day') halfDays++;
        else if (st === 'Holiday' || st === 'Weekly off') offDays++;
      });
      return {
        emp,
        ...stats,
        halfDays,
        offDays,
      };
    });

    const dailyRows: Array<{
      date: string;
      dayName: string;
      emp: DirectoryEntry;
      rec?: AttendanceRecord;
      status: string;
      inTime: string;
      outTime: string;
      breaksText: string;
      breakMins: number;
      workedHours: number;
      overtimeHours: number;
      note: string;
      approvedBy: string;
    }> = [];

    teamDateList.dates.forEach((date) => {
      const dayName = DAY_NAMES[new Date(`${date}T00:00:00`).getDay()] || '';
      selectedEmployees.forEach((emp) => {
        const rec = (recordsByEmpAndDate[emp.name] || {})[date];
        const rawStatus = calcDayStatus(rec, date, emp.joinedAt, emp.location, settings, holidays);
        const hol = findHoliday(date, emp.location, holidays);
        const status =
          rawStatus ||
          (date > td ? 'Upcoming' : emp.joinedAt && date < emp.joinedAt ? 'Before joining' : '-');

        const breaks = rec?.breaks || [];
        const breakMins = rec ? calcBreakMins(breaks) : 0;
        const workedHours = rec?.out ? round1(calcWorkedHours(rec)) : 0;
        const workingDay = isWorkingDay(date, emp.location, settings, holidays);
        const overtimeHours =
          rec?.out
            ? round1(workingDay ? Math.max(0, calcWorkedHours(rec) - shiftHours) : calcWorkedHours(rec))
            : 0;

        const noteParts: string[] = [];
        if (hol) noteParts.push(`Holiday: ${hol.name}`);
        if (rec?.note) noteParts.push(rec.note);

        dailyRows.push({
          date,
          dayName,
          emp,
          rec,
          status,
          inTime: rec?.in || '-',
          outTime: rec?.out || '-',
          breaksText: breaks.length ? breaks.join(', ') : '-',
          breakMins,
          workedHours,
          overtimeHours,
          note: noteParts.join(' · ') || '-',
          approvedBy: rec?.correctedBy || '-',
        });
      });
    });

    const totals = summaries.reduce(
      (acc, s) => {
        acc.workingDays += s.w;
        acc.presentDays += s.p;
        acc.lateMarks += s.l;
        acc.halfDays += s.halfDays;
        acc.absentDays += s.ab;
        acc.offDays += s.offDays;
        acc.totalHours += s.h;
        acc.overtimeHours += s.ot;
        return acc;
      },
      {
        workingDays: 0,
        presentDays: 0,
        lateMarks: 0,
        halfDays: 0,
        absentDays: 0,
        offDays: 0,
        totalHours: 0,
        overtimeHours: 0,
      }
    );

    return {
      selectedEmployees,
      summaries,
      dailyRows,
      totals: {
        ...totals,
        presentDays: round1(totals.presentDays),
        totalHours: round1(totals.totalHours),
        overtimeHours: round1(totals.overtimeHours),
      },
    };
  }, [
    teamUserEmpId,
    sortedDirectory,
    recordsByEmpAndDate,
    teamFrom,
    teamTo,
    settings,
    holidays,
    teamDateList.dates,
    td,
    shiftHours,
  ]);

  const handleExportTeamExcel = () => {
    if (!teamDateList.dates.length || teamFrom > teamTo) return;

    const selectedEmp =
      teamUserEmpId === 'ALL'
        ? null
        : sortedDirectory.find((e) => e.empId === teamUserEmpId) || null;
    const empFilterLabel = selectedEmp ? `${selectedEmp.name} (${selectedEmp.empId})` : 'All Employees';
    const generatedAt = `${td} ${nowTimeStr()}`;
    const filterLine = `Period: ${teamFrom} to ${teamTo}  |  Employee: ${empFilterLabel}  |  Generated: ${generatedAt}  |  By: ${me.name}`;

    const wb = XLSX.utils.book_new();

    const autoSizeSheet = (ws: XLSX.WorkSheet, aoa: Array<Array<string | number>>) => {
      const colWidths: number[] = [];
      aoa.forEach((row, rIdx) => {
        if (rIdx <= 1) return;
        row.forEach((cell, cIdx) => {
          const len = String(cell ?? '').length;
          colWidths[cIdx] = Math.max(colWidths[cIdx] || 10, Math.min(len + 3, 40));
        });
      });
      ws['!cols'] = colWidths.map((wch) => ({ wch }));
    };

    const buildSheet = (
      title: string,
      headers: string[],
      rows: Array<Array<string | number>>,
      totalRow?: Array<string | number>
    ) => {
      const aoa: Array<Array<string | number>> = [
        [title],
        [filterLine],
        [],
        headers,
        ...(rows.length ? rows : [['No attendance records for the selected filters']]),
        ...(totalRow && rows.length ? [totalRow] : []),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      autoSizeSheet(ws, aoa);
      if (rows.length) {
        const lastCol = XLSX.utils.encode_col(headers.length - 1);
        const lastRow = 4 + rows.length;
        ws['!autofilter'] = { ref: `A4:${lastCol}${lastRow}` };
      }
      return ws;
    };

    const summaryHeaders = [
      'Sr. No.',
      'Employee Name',
      'User ID',
      'Role',
      'Branch',
      'Location',
      'Joined Date',
      'Working Days',
      'Present Days',
      'Late Marks',
      'Half Days',
      'Absent Days',
      'Holidays / Off',
      'Attendance %',
      'Worked Hours',
      'Overtime Hours',
    ];
    const summaryRows = teamExportData.summaries.map((s, idx) => [
      idx + 1,
      s.emp.name,
      s.emp.empId,
      s.emp.role,
      s.emp.branch,
      s.emp.location,
      s.emp.joinedAt || '-',
      s.w,
      s.p,
      s.l,
      s.halfDays,
      s.ab,
      s.offDays,
      `${s.pct}%`,
      s.h,
      s.ot,
    ]);
    const avgPct = teamExportData.summaries.length
      ? Math.round(
          teamExportData.summaries.reduce((acc, s) => acc + s.pct, 0) /
            teamExportData.summaries.length
        )
      : 0;
    const summaryTotalRow =
      teamExportData.summaries.length > 1
        ? [
            '',
            'TOTAL / AVERAGE',
            '',
            `${teamExportData.summaries.length} employees`,
            '',
            '',
            '',
            teamExportData.totals.workingDays,
            teamExportData.totals.presentDays,
            teamExportData.totals.lateMarks,
            teamExportData.totals.halfDays,
            teamExportData.totals.absentDays,
            teamExportData.totals.offDays,
            `${avgPct}%`,
            teamExportData.totals.totalHours,
            teamExportData.totals.overtimeHours,
          ]
        : undefined;

    XLSX.utils.book_append_sheet(
      wb,
      buildSheet(
        'KEJMIN OPS — TEAM ATTENDANCE SUMMARY',
        summaryHeaders,
        summaryRows,
        summaryTotalRow
      ),
      'Attendance Summary'
    );

    const dailyHeaders = [
      'Date',
      'Day',
      'Employee Name',
      'User ID',
      'Role',
      'Branch',
      'Location',
      'Status',
      'Clock In',
      'Clock Out',
      'Breaks',
      'Break (mins)',
      'Worked Hours',
      'Overtime Hours',
      'Holiday / Note',
      'Approved By',
    ];
    const dailySheetRows = teamExportData.dailyRows.map((r) => [
      r.date,
      r.dayName,
      r.emp.name,
      r.emp.empId,
      r.emp.role,
      r.emp.branch,
      r.emp.location,
      r.status,
      r.inTime,
      r.outTime,
      r.breaksText,
      r.breakMins,
      r.rec?.out ? r.workedHours : 0,
      r.rec?.out ? r.overtimeHours : 0,
      r.note,
      r.approvedBy,
    ]);

    XLSX.utils.book_append_sheet(
      wb,
      buildSheet('KEJMIN OPS — COMPLETE DAILY ATTENDANCE LOG', dailyHeaders, dailySheetRows),
      'Daily Attendance'
    );

    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeEmpSlug = selectedEmp
      ? selectedEmp.name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || selectedEmp.empId
      : 'All';
    link.href = url;
    link.download = `KEJMIN_Attendance_${safeEmpSlug}_${teamFrom}_to_${teamTo}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);

    onExportAttendance?.(`${empFilterLabel} (${teamFrom} to ${teamTo})`);
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
          <div className="att-clock-wrap">
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

            <div className="att-clock-info">
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

            <div className="att-clock-acts">
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
            <div style={{ flex: '0 0 auto', minWidth: 'auto' }}>
              <button className="btn g" id="mp" type="button" onClick={() => shiftMonth(-1)}>
                ‹
              </button>
            </div>
            <div style={{ flex: '0 0 auto', minWidth: 'auto' }}>
              <button className="btn g" id="mn" type="button" onClick={() => shiftMonth(1)}>
                ›
              </button>
            </div>
            {isDeveloper && (
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
            {isViewingOwnCalendar && (
              <div style={{ flex: '0 0 auto', minWidth: 'auto' }}>
                <button
                  className="btn td-add-btn"
                  id="att-add-todo"
                  type="button"
                  onClick={() => openTodoModal(activeDay)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>Add to-do</span>
                </button>
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

          {isViewingOwnCalendar && (
            <div className="cal-bar">
              <span className="cal-hint">
                Double-click any date card to add or edit a sticky-note to-do list.
              </span>
              {monthTodoStats.total > 0 && (
                <span className="cal-todo-sum">
                  {monthTodoStats.open} open · {monthTodoStats.done} done this month
                </span>
              )}
            </div>
          )}

          <div className="cal" id="cal" style={{ marginTop: 10 }}>
            {DAY_NAMES.map((d) => (
              <div key={d} className="ch">
                {d}
              </div>
            ))}
            {Array.from({ length: monthData.firstDow }).map((_, idx) => (
              <div key={`e-${idx}`} className="cd e" />
            ))}
            {monthData.cells.map((c) => {
              const dayTodos = isViewingOwnCalendar ? myTodosByDate[c.date] || [] : [];
              const noteColor: TodoNoteColor =
                dayTodos.find((t) => !t.done)?.color || dayTodos[0]?.color || 'yellow';
              const allDone = dayTodos.length > 0 && dayTodos.every((t) => t.done);
              const visibleTodos = dayTodos.slice(0, 2);
              const extraCount = dayTodos.length - visibleTodos.length;

              return (
                <div
                  key={c.date}
                  className={`cd ${c.status ? `s-${c.status.replace(/[ -]/g, '')}` : ''} ${
                    c.date === td ? 'td' : ''
                  } ${c.date === activeDay ? 'sel' : ''} ${dayTodos.length > 0 ? 'has-note' : ''}`}
                  title={
                    isViewingOwnCalendar
                      ? 'Click to select · Double-click to add or edit sticky-note to-do'
                      : undefined
                  }
                  onClick={() => setSelectedDay(c.date)}
                  onDoubleClick={() => {
                    if (isViewingOwnCalendar) {
                      openTodoModal(c.date);
                    }
                  }}
                >
                  <div className="cd-top">
                    <b className="cd-num">{c.day}</b>
                    <div className="cd-top-r">
                      {(c.rec?.in || c.hol) && (
                        <span className="cd-time">
                          {c.rec?.in ? c.rec.in : c.hol ? 'Holiday' : ''}
                        </span>
                      )}
                      {isViewingOwnCalendar && (
                        <button
                          type="button"
                          className="cd-add"
                          aria-label={`Add to-do for ${c.date}`}
                          title="Add to-do"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTodoModal(c.date);
                          }}
                        >
                          +
                        </button>
                      )}
                    </div>
                  </div>

                  {dayTodos.length > 0 && (
                    <div className={`cd-sticky st-${noteColor}${allDone ? ' all-done' : ''}`}>
                      {visibleTodos.map((item) => (
                        <div
                          key={item.todoId}
                          className={`cd-sticky-ln${item.done ? ' done' : ''}`}
                        >
                          <span className="cd-sticky-chk" aria-hidden="true">
                            {item.done ? '✓' : '·'}
                          </span>
                          <span className="cd-sticky-tx">{item.text}</span>
                        </div>
                      ))}
                      {extraCount > 0 && (
                        <div className="cd-sticky-more">+{extraCount} more</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
            {isViewingOwnCalendar && (
              <span>
                <i style={{ background: '#f5d76e', border: '1px solid #d4a72c' }} />
                Sticky-note to-do
              </span>
            )}
          </div>

          <div className="glass card" id="dd" style={{ marginTop: 14 }}>
            <div className="sub">
              {activeDay} · {DAY_NAMES[new Date(`${activeDay}T00:00:00`).getDay()]}
              {activeDayHol ? ` · ${activeDayHol.name}` : ''}
            </div>
            <div className="att-day-head">
              <b style={{ fontSize: 20 }}>{activeDayStatus || 'Upcoming'}</b>
              <div className="att-day-metrics">
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
                    className="btn g att-corr-btn"
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

            {isViewingOwnCalendar && (
              <div className="dd-todo">
                <div className="dd-todo-hd">
                  <div className="dd-todo-title">
                    <b>To-do sticky note</b>
                    <span className="sub">
                      {activeDayTodos.length > 0
                        ? `${activeDayTodos.filter((t) => t.done).length}/${activeDayTodos.length} completed`
                        : 'No items for this date'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn g"
                    style={{ padding: '6px 11px', fontSize: 12 }}
                    onClick={() => openTodoModal(activeDay)}
                  >
                    {activeDayTodos.length > 0 ? 'Manage note' : '+ Add to-do'}
                  </button>
                </div>

                {activeDayTodos.length > 0 && (
                  <div className="dd-todo-list">
                    {activeDayTodos.map((item) => (
                      <div
                        key={item.todoId}
                        className={`dd-todo-row st-${item.color}${item.done ? ' done' : ''}`}
                      >
                        <label className="dd-todo-lbl">
                          <input
                            type="checkbox"
                            checked={item.done}
                            disabled={todoBusy}
                            onChange={() => handleToggleTodo(item)}
                          />
                          <span>{item.text}</span>
                        </label>
                        <div className="dd-todo-acts">
                          <button
                            type="button"
                            className="td-mini-btn"
                            onClick={() => {
                              openTodoModal(activeDay);
                              setEditingTodoId(item.todoId);
                              setEditingTodoText(item.text);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="td-mini-btn danger"
                            disabled={todoBusy}
                            onClick={() => handleDeleteTodo(item.todoId)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Team Tab */}
      {tab === 'tm' && canBrowseEmployees && (
        <div className="tm-stack">
          {/* Date-Range Team Attendance Register & Excel Export */}
          <div className="glass sec" id="tm-export">
            <div className="tm-exp-hd">
              <div>
                <h3>Team attendance &amp; Excel export</h3>
                <div className="sub">
                  Select From date, To date, and employee filter to preview attendance or export to Excel (.xlsx).
                </div>
              </div>
              <button
                type="button"
                className="btn tm-exp-btn"
                disabled={!teamDateList.dates.length || teamFrom > teamTo || !teamExportData.selectedEmployees.length}
                onClick={handleExportTeamExcel}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                <span>Export Excel (.xlsx)</span>
              </button>
            </div>

            <div className="row tm-filters" style={{ marginTop: 12 }}>
              <div>
                <label htmlFor="tm-from">From date</label>
                <input
                  id="tm-from"
                  type="date"
                  value={teamFrom}
                  onChange={(e) => {
                    if (e.target.value) setTeamFrom(e.target.value);
                  }}
                />
              </div>
              <div>
                <label htmlFor="tm-to">To date</label>
                <input
                  id="tm-to"
                  type="date"
                  value={teamTo}
                  onChange={(e) => {
                    if (e.target.value) setTeamTo(e.target.value);
                  }}
                />
              </div>
              <div>
                <label htmlFor="tm-user">Employee filter</label>
                <select
                  id="tm-user"
                  value={teamUserEmpId}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setTeamUserEmpId(nextVal);
                    if (nextVal !== 'ALL') {
                      setTeamViewMode('daily');
                    }
                  }}
                >
                  <option value="ALL">All employees ({sortedDirectory.length})</option>
                  {sortedDirectory.map((emp) => (
                    <option key={emp.docId} value={emp.empId}>
                      {emp.name} ({emp.empId})
                    </option>
                  ))}
                </select>
              </div>
              <div className="tm-preset-wrap">
                <label>Quick range</label>
                <div className="tm-presets">
                  <button
                    type="button"
                    className={`tm-chip${teamFrom === td && teamTo === td ? ' on' : ''}`}
                    onClick={() => {
                      setTeamFrom(td);
                      setTeamTo(td);
                    }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className={`tm-chip${teamFrom === addDaysToDateStr(td, -6) && teamTo === td ? ' on' : ''}`}
                    onClick={() => {
                      setTeamFrom(addDaysToDateStr(td, -6));
                      setTeamTo(td);
                    }}
                  >
                    Last 7 days
                  </button>
                  <button
                    type="button"
                    className={`tm-chip${teamFrom === `${td.slice(0, 7)}-01` && teamTo === td ? ' on' : ''}`}
                    onClick={() => {
                      setTeamFrom(`${td.slice(0, 7)}-01`);
                      setTeamTo(td);
                    }}
                  >
                    This month
                  </button>
                </div>
              </div>
              <div className="tm-mode-wrap">
                <label>Table view</label>
                <div className="tm-vt" role="group" aria-label="Attendance preview view">
                  <button
                    type="button"
                    className={teamViewMode === 'summary' ? 'on' : ''}
                    onClick={() => setTeamViewMode('summary')}
                  >
                    Summary
                  </button>
                  <button
                    type="button"
                    className={teamViewMode === 'daily' ? 'on' : ''}
                    onClick={() => setTeamViewMode('daily')}
                  >
                    Daily log
                  </button>
                </div>
              </div>
            </div>

            {teamDateList.error && (
              <div className="er" style={{ marginTop: 10 }}>
                {teamDateList.error}
              </div>
            )}

            {/* Range Summary KPI Strip */}
            <div className="grid tm-kpis" style={{ marginTop: 14 }}>
              <div className="glass card">
                <div className="sub">{teamUserEmpId === 'ALL' ? 'Employees' : 'Working days'}</div>
                <div className="big">
                  {teamUserEmpId === 'ALL'
                    ? teamExportData.summaries.length
                    : teamExportData.totals.workingDays}
                </div>
              </div>
              <div className="glass card">
                <div className="sub">Present days</div>
                <div className="big">{teamExportData.totals.presentDays}</div>
              </div>
              <div className="glass card">
                <div className="sub">Late marks</div>
                <div className="big o">{teamExportData.totals.lateMarks}</div>
              </div>
              <div className="glass card">
                <div className="sub">Half days</div>
                <div className="big o">{teamExportData.totals.halfDays}</div>
              </div>
              <div className="glass card">
                <div className="sub">Absent</div>
                <div className="big r">{teamExportData.totals.absentDays}</div>
              </div>
              <div className="glass card">
                <div className="sub">Hours (OT {teamExportData.totals.overtimeHours}h)</div>
                <div className="big">{teamExportData.totals.totalHours}h</div>
              </div>
            </div>

            {/* Preview Table: Employee Summary OR Day-by-Day Attendance */}
            {teamViewMode === 'summary' ? (
              <div className="tbl m-card-tbl tm-tbl-scroll" style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Role</th>
                      <th>Location</th>
                      <th>Working</th>
                      <th>Present</th>
                      <th>Late</th>
                      <th>Half day</th>
                      <th>Absent</th>
                      <th>Attendance</th>
                      <th>Hours</th>
                      <th>Overtime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamExportData.summaries.map((s) => (
                      <tr
                        key={s.emp.docId}
                        style={{ cursor: 'pointer' }}
                        title={`View ${s.emp.name}'s daily attendance`}
                        onClick={() => {
                          setTeamUserEmpId(s.emp.empId);
                          setTeamViewMode('daily');
                        }}
                      >
                        <td data-label="Employee">
                          <b>{s.emp.name}</b>
                        </td>
                        <td data-label="Role">{s.emp.role}</td>
                        <td data-label="Location">{s.emp.location}</td>
                        <td data-label="Working">{s.w}</td>
                        <td data-label="Present">{s.p}</td>
                        <td data-label="Late">{s.l}</td>
                        <td data-label="Half day">{s.halfDays}</td>
                        <td data-label="Absent">{s.ab}</td>
                        <td data-label="Attendance">
                          <span
                            className={`tag ${
                              s.pct >= 90 ? 'Present' : s.pct >= 75 ? 'Late' : 'Absent'
                            }`}
                          >
                            {s.pct}%
                          </span>
                        </td>
                        <td data-label="Hours">{s.h}h</td>
                        <td data-label="Overtime">{s.ot}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                {teamExportData.dailyRows.length > 500 && (
                  <div className="sub" style={{ marginTop: 10 }}>
                    Showing first 500 of {teamExportData.dailyRows.length} rows in preview — Export Excel downloads all {teamExportData.dailyRows.length} rows.
                  </div>
                )}
                <div className="tbl m-card-tbl tm-tbl-scroll" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Day</th>
                        <th>Employee</th>
                        <th>Location</th>
                        <th>Status</th>
                        <th>In</th>
                        <th>Out</th>
                        <th>Breaks</th>
                        <th>Hours</th>
                        <th>Overtime</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamExportData.dailyRows.slice(0, 500).map((r) => (
                        <tr key={`${r.date}_${r.emp.empId}`}>
                          <td data-label="Date">{r.date}</td>
                          <td data-label="Day">{r.dayName}</td>
                          <td data-label="Employee">
                            <b>{r.emp.name}</b>
                          </td>
                          <td data-label="Location">{r.emp.location}</td>
                          <td data-label="Status">
                            <span className={`tag ${r.status.replace(/[ -]/g, '')}`}>{r.status}</span>
                          </td>
                          <td data-label="In">{r.inTime}</td>
                          <td data-label="Out">{r.outTime}</td>
                          <td data-label="Breaks">{r.breakMins ? `${r.breakMins}m` : '-'}</td>
                          <td data-label="Hours">{r.rec?.out ? fmtHours(calcWorkedHours(r.rec)) : '-'}</td>
                          <td data-label="Overtime">{r.overtimeHours ? `${r.overtimeHours}h` : '-'}</td>
                          <td data-label="Note">{r.note}</td>
                        </tr>
                      ))}
                      {teamExportData.dailyRows.length === 0 && (
                        <tr>
                          <td colSpan={11} style={{ textAlign: 'center', color: 'var(--mut)', padding: 18 }}>
                            Select a valid From and To date range to view attendance.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Live Today Snapshot */}
          <div className="glass sec" id="lb">
            <h3>Today across the company</h3>
            <div className="tbl m-card-tbl">
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
                  {sortedDirectory.map((emp) => {
                    const rec = (recordsByEmpAndDate[emp.name] || {})[td];
                    const st = calcDayStatus(rec, td, emp.joinedAt, emp.location, settings, holidays);
                    return (
                      <tr
                        key={emp.docId}
                        style={isDeveloper ? { cursor: 'pointer' } : undefined}
                        onClick={
                          isDeveloper
                            ? () => {
                                setSelectedEmpName(emp.name);
                                setTab('ak');
                              }
                            : undefined
                        }
                      >
                        <td data-label="Employee">
                          <b>{emp.name}</b>
                        </td>
                        <td data-label="Role">{emp.role}</td>
                        <td data-label="Location">{emp.location}</td>
                        <td data-label="Status">
                          <span className={`tag ${st.replace(/[ -]/g, '')}`}>{st}</span>
                        </td>
                        <td data-label="In">{rec?.in || '-'}</td>
                        <td data-label="Out">{rec?.out || '-'}</td>
                        <td data-label="Hours">{rec?.out ? fmtHours(calcWorkedHours(rec)) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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

      {/* Calendar Sticky-Note To-Do Modal (Portaled so sidebar never overlaps) */}
      {todoModalDate &&
        isViewingOwnCalendar &&
        createPortal(
          <div
            className="ov"
            style={{ zIndex: 130 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="td-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setTodoModalDate(null);
            }}
          >
            <div className="md td-modal">
              <div className="td-hd">
                <div>
                  <h3 id="td-modal-title" className="td-title">
                    Sticky-note to-do list
                  </h3>
                  <div className="td-sub">
                    {todoModalDate} · {DAY_NAMES[new Date(`${todoModalDate}T00:00:00`).getDay()]}
                  </div>
                </div>
                <button
                  type="button"
                  className="al-icon-close"
                  aria-label="Close to-do list"
                  onClick={() => setTodoModalDate(null)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="td-controls">
                <div className="td-date-wrap">
                  <label htmlFor="td-date-input">Date</label>
                  <input
                    id="td-date-input"
                    type="date"
                    value={todoModalDate}
                    onChange={(e) => {
                      const nextDate = e.target.value;
                      if (nextDate) {
                        setTodoModalDate(nextDate);
                        setSelectedDay(nextDate);
                        if (nextDate.slice(0, 7) !== month) {
                          setMonth(nextDate.slice(0, 7));
                        }
                        setEditingTodoId(null);
                      }
                    }}
                  />
                </div>
                <div className="td-color-wrap">
                  <label>Sticky-note color</label>
                  <div className="td-swatches" role="radiogroup" aria-label="Sticky-note color">
                    {STICKY_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`td-swatch st-${c.id}${todoColor === c.id ? ' on' : ''}`}
                        aria-label={c.label}
                        aria-checked={todoColor === c.id}
                        role="radio"
                        title={c.label}
                        onClick={() => setTodoColor(c.id)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <form className="td-form" onSubmit={handleAddTodo}>
                <input
                  ref={todoInputRef}
                  type="text"
                  maxLength={240}
                  placeholder="Write a to-do item and press Enter..."
                  value={todoDraft}
                  onChange={(e) => {
                    setTodoDraft(e.target.value);
                    if (todoErr) setTodoErr('');
                  }}
                />
                <button className="btn" type="submit" disabled={todoBusy}>
                  Add
                </button>
              </form>
              {todoErr && <div className="er" style={{ marginTop: 8 }}>{todoErr}</div>}

              <div className={`td-pad st-${todoColor}`}>
                {modalDayTodos.length === 0 ? (
                  <div className="td-empty">
                    No to-do items pinned to {todoModalDate} yet. Add one above to place a sticky note on this date card.
                  </div>
                ) : (
                  <div className="td-list">
                    {modalDayTodos.map((item) => {
                      const isEditing = editingTodoId === item.todoId;
                      return (
                        <div
                          key={item.todoId}
                          className={`td-item${item.done ? ' done' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="td-chk"
                            checked={item.done}
                            disabled={todoBusy}
                            aria-label={`Mark "${item.text}" as ${item.done ? 'incomplete' : 'complete'}`}
                            onChange={() => handleToggleTodo(item)}
                          />
                          {isEditing ? (
                            <div className="td-edit-row">
                              <input
                                type="text"
                                maxLength={240}
                                value={editingTodoText}
                                autoFocus
                                onChange={(e) => setEditingTodoText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleSaveEditTodo(item);
                                  } else if (e.key === 'Escape') {
                                    setEditingTodoId(null);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                className="td-mini-btn save"
                                disabled={todoBusy}
                                onClick={() => handleSaveEditTodo(item)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="td-mini-btn"
                                onClick={() => setEditingTodoId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <span
                                className="td-item-text"
                                onDoubleClick={() => {
                                  setEditingTodoId(item.todoId);
                                  setEditingTodoText(item.text);
                                }}
                              >
                                {item.text}
                              </span>
                              <div className="td-item-acts">
                                <button
                                  type="button"
                                  className="td-mini-btn"
                                  onClick={() => {
                                    setEditingTodoId(item.todoId);
                                    setEditingTodoText(item.text);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="td-mini-btn danger"
                                  disabled={todoBusy}
                                  onClick={() => handleDeleteTodo(item.todoId)}
                                >
                                  Delete
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="td-foot">
                <span>
                  {modalDayTodos.length > 0
                    ? `${modalDayTodos.filter((t) => t.done).length} of ${modalDayTodos.length} completed`
                    : 'Tip: double-click any date card anytime'}
                </span>
                <button
                  type="button"
                  className="btn g"
                  style={{ padding: '7px 14px', fontSize: 13 }}
                  onClick={() => setTodoModalDate(null)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
