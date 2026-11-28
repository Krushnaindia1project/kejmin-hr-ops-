import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AttendanceRecord,
  AttendanceSettings,
  AuditLogEntry,
  DirectoryEntry,
  Holiday,
  ScoreEvent,
  TaskDoc,
} from '../types';
import {
  calcAttendanceStats,
  calcBreakMins,
  calcDayStatus,
  calcWorkedHours,
  dayOffset,
  localDateStr,
  nowTimeStr,
  pad,
  round1,
  todayStr,
} from '../utils/crypto';

interface ReportsViewProps {
  me: DirectoryEntry;
  canSeeAll: boolean;
  canExportReports: boolean;
  directory: DirectoryEntry[];
  branches: string[];
  locations: string[];
  myTasks: TaskDoc[];
  scoreEvents: ScoreEvent[];
  attendance: AttendanceRecord[];
  holidays: Holiday[];
  settings: AttendanceSettings;
  auditLogs: AuditLogEntry[];
  onExportCsv: (meta: string) => void;
  onPrint: () => void;
}

const CHART_COLORS = ['#1d4f9f', '#c9772a', '#b83a2e'];

export const ReportsView: React.FC<ReportsViewProps> = ({
  me,
  canSeeAll,
  canExportReports,
  directory,
  branches,
  locations,
  myTasks,
  scoreEvents,
  attendance,
  holidays,
  settings,
  onExportCsv,
  onPrint,
}) => {
  const [fromDate, setFromDate] = useState(() => dayOffset(90));
  const [toDate, setToDate] = useState(() => dayOffset(0));
  const [branchFilter, setBranchFilter] = useState('All');
  const [locFilter, setLocFilter] = useState('All');
  const [empFilter, setEmpFilter] = useState('All');
  const [viewBy, setViewBy] = useState<'Overall' | 'Employee wise' | 'Team wise' | 'Role wise'>('Overall');
  const [selectVal, setSelectVal] = useState('All');

  const td = todayStr();

  const empNames = useMemo(
    () =>
      canSeeAll
        ? Array.from(new Set(directory.map((d) => d.name)))
        : [me.name],
    [directory, canSeeAll, me.name]
  );
  const roleNames = useMemo(() => Array.from(new Set(directory.map((d) => d.role))), [directory]);
  const dirByName = useMemo(() => {
    const m: Record<string, DirectoryEntry> = {};
    directory.forEach((d) => (m[d.name] = d));
    return m;
  }, [directory]);
  const locByName = useMemo(() => {
    const m: Record<string, string> = {};
    directory.forEach((d) => (m[d.name] = d.location));
    return m;
  }, [directory]);
  const roleByName = useMemo(() => {
    const m: Record<string, string> = {};
    directory.forEach((d) => (m[d.name] = d.role));
    return m;
  }, [directory]);
  const branchByName = useMemo(() => {
    const m: Record<string, string> = {};
    directory.forEach((d) => (m[d.name] = d.branch));
    return m;
  }, [directory]);
  const taskById = useMemo(() => {
    const m: Record<string, TaskDoc> = {};
    myTasks.forEach((t) => (m[t.taskId] = t));
    return m;
  }, [myTasks]);

  const attByEmp = useMemo(() => {
    const map: Record<string, Record<string, AttendanceRecord>> = {};
    attendance.forEach((r) => {
      if (!map[r.employeeName]) map[r.employeeName] = {};
      map[r.employeeName][r.date] = r;
    });
    return map;
  }, [attendance]);

  const selectOptions = useMemo(() => {
    if (viewBy === 'Overall') return ['All'];
    if (viewBy === 'Employee wise') return ['All', ...empNames];
    if (viewBy === 'Team wise') return ['All', ...locations];
    return ['All', ...roleNames];
  }, [viewBy, empNames, locations, roleNames]);

  const inView = (name: string) => {
    if (viewBy === 'Overall' || selectVal === 'All') return true;
    if (viewBy === 'Employee wise') return name === selectVal;
    if (viewBy === 'Team wise') return locByName[name] === selectVal;
    return roleByName[name] === selectVal;
  };

  const reportData = useMemo(() => {
    const isTaskInDateRange = (t: TaskDoc) => {
      const dueInRange = t.dueAt >= fromDate && t.dueAt <= toDate;
      const createdDate = t.createdAt ? localDateStr(t.createdAt.toDate()) : '';
      const createdInRange = Boolean(createdDate) && createdDate >= fromDate && createdDate <= toDate;
      return dueInRange || createdInRange;
    };

    const tk = myTasks.filter(
      (t) =>
        isTaskInDateRange(t) &&
        (branchFilter === 'All' || t.branch === branchFilter) &&
        (locFilter === 'All' || t.location === locFilter) &&
        (empFilter === 'All' || t.path.includes(empFilter)) &&
        (viewBy === 'Overall' || selectVal === 'All' || t.path.some(inView))
    );

    const baseScores = scoreEvents.filter((ev) => {
      if (!canSeeAll && ev.employeeName !== me.name) return false;
      if (locFilter !== 'All' && locByName[ev.employeeName] !== locFilter) return false;
      if (empFilter !== 'All' && ev.employeeName !== empFilter) return false;
      if (!inView(ev.employeeName)) return false;
      if (branchFilter !== 'All') {
        const linkedTaskBranch = ev.taskId ? taskById[ev.taskId]?.branch : undefined;
        const empBranch = branchByName[ev.employeeName];
        if (linkedTaskBranch) {
          if (linkedTaskBranch !== branchFilter) return false;
        } else if (empBranch !== branchFilter && empBranch !== 'All') {
          return false;
        }
      }
      return true;
    });
    const filteredScores = baseScores.filter((ev) => ev.date >= fromDate && ev.date <= toDate);

    const isTaskClosed = (t: TaskDoc) => t.stage >= t.path.length || t.status === 'closed';
    const isTaskOverdue = (t: TaskDoc) => !isTaskClosed(t) && t.dueAt < td;

    const doneCount = tk.filter(isTaskClosed).length;
    const overdueCount = tk.filter(isTaskOverdue).length;
    const inProgCount = tk.length - doneCount - overdueCount;

    const byEmp: Record<string, number> = {};
    const byLoc: Record<string, number> = {};
    filteredScores.forEach((ev) => {
      byEmp[ev.employeeName] = (byEmp[ev.employeeName] || 0) + ev.points;
      const loc = locByName[ev.employeeName] || 'Other';
      byLoc[loc] = (byLoc[loc] || 0) + ev.points;
    });

    const empRows: Array<[string, number]> = Object.entries(byEmp)
      .map(([n, pts]): [string, number] => [n, round1(pts)])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const locRows: Array<[string, number]> = Object.entries(byLoc)
      .map(([l, pts]): [string, number] => [l, round1(pts)])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    const months = Array.from({ length: 6 }, (_, k) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - k));
      return d;
    });
    const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const trendVals = months.map((d) =>
      round1(
        baseScores
          .filter((ev) => ev.date.slice(0, 7) === monthKey(d))
          .reduce((s, ev) => s + ev.points, 0)
      )
    );
    const trendLabels = months.map((d) => d.toLocaleString('en', { month: 'short' }));
    const totalPts = round1(filteredScores.reduce((s, ev) => s + ev.points, 0));

    const branchDetails = branches
      .filter((b) => branchFilter === 'All' || b === branchFilter)
      .map((b) => {
        const list = tk.filter((t) => t.branch === b);
        const dn = list.filter(isTaskClosed).length;
        const ov = list.filter(isTaskOverdue).length;
        const ip = list.length - dn - ov;
        const pct = list.length ? Math.round((dn / list.length) * 100) : 0;
        return { branch: b, total: list.length, done: dn, inProg: ip, overdue: ov, pct };
      })
      .filter((b) => b.total > 0)
      .sort((a, b) => b.pct - a.pct || b.total - a.total || a.branch.localeCompare(b.branch));

    const branchRows: Array<[string, number]> = branchDetails.map((b) => [b.branch, b.pct]);

    const taskParticipantNames = new Set(tk.flatMap((t) => t.path));
    const scoredEmpNames = new Set(filteredScores.map((ev) => ev.employeeName));

    const visibleEmps = directory.filter(
      (d) =>
        inView(d.name) &&
        (locFilter === 'All' || d.location === locFilter) &&
        (empFilter === 'All' || d.name === empFilter) &&
        (canSeeAll || d.name === me.name) &&
        (branchFilter === 'All' ||
          d.branch === branchFilter ||
          taskParticipantNames.has(d.name) ||
          scoredEmpNames.has(d.name))
    );

    const visibleEmpSet = new Set(visibleEmps.map((d) => d.name));

    const employeeDetails = visibleEmps
      .map((d) => {
        const st = calcAttendanceStats(
          attByEmp[d.name] || {},
          d.joinedAt,
          d.location,
          fromDate,
          toDate,
          settings,
          holidays
        );
        const empTasks = tk.filter((t) => t.path.includes(d.name));
        const empDone = empTasks.filter(isTaskClosed).length;
        const empOverdue = empTasks.filter(isTaskOverdue).length;
        const empOpen = empTasks.length - empDone;
        return {
          emp: d,
          pts: round1(byEmp[d.name] || 0),
          tasksAssigned: empTasks.length,
          tasksDone: empDone,
          tasksOpen: empOpen,
          tasksOverdue: empOverdue,
          stats: st,
        };
      })
      .sort(
        (a, b) =>
          b.pts - a.pts ||
          b.stats.pct - a.stats.pct ||
          a.emp.name.localeCompare(b.emp.name)
      );

    const attRows: Array<[string, number]> = employeeDetails.map((row) => [
      row.emp.name,
      row.stats.pct,
    ]);

    const groupKey = (d: DirectoryEntry) =>
      viewBy === 'Employee wise' ? d.name : viewBy === 'Team wise' ? d.location : d.role;
    const groups = Array.from(new Set(visibleEmps.map(groupKey)));
    const breakdownRows = groups
      .map((g) => {
        const members = visibleEmps.filter((d) => groupKey(d) === g);
        if (!members.length) return null;
        const mNames = new Set(members.map((m) => m.name));
        const pts = round1(
          filteredScores
            .filter((ev) => mNames.has(ev.employeeName))
            .reduce((s, ev) => s + ev.points, 0)
        );
        const tt = tk.filter((t) => t.path.some((p) => mNames.has(p)));
        const dd = tt.filter(isTaskClosed).length;
        const sts = members.map((m) =>
          calcAttendanceStats(
            attByEmp[m.name] || {},
            m.joinedAt,
            m.location,
            fromDate,
            toDate,
            settings,
            holidays
          )
        );
        return {
          group: g,
          members: members.length,
          pts,
          tasks: tt.length,
          done: dd,
          attPct: Math.round(sts.reduce((s, x) => s + x.pct, 0) / members.length),
          hours: round1(sts.reduce((s, x) => s + x.h, 0)),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b!.pts - a!.pts || a!.group.localeCompare(b!.group)) as Array<{
      group: string;
      members: number;
      pts: number;
      tasks: number;
      done: number;
      attPct: number;
      hours: number;
    }>;

    // Properly ordered task details: Overdue -> In Progress -> Completed, then Due Date asc, then High -> Medium -> Low
    const statusOrder = (t: TaskDoc) => (isTaskOverdue(t) ? 0 : !isTaskClosed(t) ? 1 : 2);
    const priorityOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    const orderedTasks = [...tk].sort(
      (a, b) =>
        statusOrder(a) - statusOrder(b) ||
        a.dueAt.localeCompare(b.dueAt) ||
        (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2) ||
        a.title.localeCompare(b.title)
    );

    // Strictly filtered & properly ordered daily attendance records (Date desc, Employee A-Z)
    const orderedAttendance = attendance
      .filter(
        (rec) =>
          rec.date >= fromDate &&
          rec.date <= toDate &&
          visibleEmpSet.has(rec.employeeName)
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName)
      );

    // Strictly filtered & properly ordered score history (Date desc, Employee A-Z)
    const orderedScores = [...filteredScores].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.at?.toMillis() || 0) - (a.at?.toMillis() || 0) ||
        a.employeeName.localeCompare(b.employeeName)
    );

    // Location summary for Excel Sheet 1
    const locSummary = Array.from(new Set(employeeDetails.map((e) => e.emp.location)))
      .map((loc) => {
        const emps = employeeDetails.filter((e) => e.emp.location === loc);
        const pts = round1(emps.reduce((s, e) => s + e.pts, 0));
        const avgAtt = emps.length
          ? Math.round(emps.reduce((s, e) => s + e.stats.pct, 0) / emps.length)
          : 0;
        const hrs = round1(emps.reduce((s, e) => s + e.stats.h, 0));
        return { location: loc, employees: emps.length, pts, avgAtt, hours: hrs };
      })
      .sort((a, b) => b.pts - a.pts || a.location.localeCompare(b.location));

    return {
      totalPts,
      completionRate: tk.length ? Math.round((doneCount / tk.length) * 100) : 0,
      overdueCount,
      inProgCount,
      doneCount,
      topPerformer: empRows[0]?.[0] || '-',
      empRows,
      locRows,
      trendVals,
      trendLabels,
      branchRows,
      branchDetails,
      locSummary,
      attRows,
      breakdownRows,
      tk,
      employeeDetails,
      orderedTasks,
      orderedAttendance,
      orderedScores,
    };
  }, [
    scoreEvents,
    canSeeAll,
    me.name,
    locFilter,
    empFilter,
    locByName,
    branchByName,
    taskById,
    viewBy,
    selectVal,
    fromDate,
    toDate,
    myTasks,
    branchFilter,
    td,
    branches,
    directory,
    attByEmp,
    attendance,
    settings,
    holidays,
    roleByName,
  ]);

  const renderHBars = (rows: Array<[string, number]>, mx: number, suf = '') => {
    if (!rows.length) return <div className="sub">No data for these filters.</div>;
    return rows.map(([label, val]) => (
      <div key={label} className="rep-hbar">
        <span className="rep-hbar-lbl">{label}</span>
        <div className="bar rep-hbar-track">
          <i style={{ width: `${mx ? Math.max(0, (val / mx) * 100) : 0}%` }} />
        </div>
        <b className="rep-hbar-val">
          {val}
          {suf}
        </b>
      </div>
    ));
  };

  const renderDonut = (slices: Array<[string, number, string]>) => {
    const total = slices.reduce((s, p) => s + p[1], 0);
    const denom = total || 1;
    let offset = 25;
    return (
      <div className="rep-donut-wrap">
        <svg viewBox="0 0 42 42" width="140">
          <circle
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            stroke="rgba(120,140,170,.2)"
            strokeWidth="6"
          />
          {slices.map(([label, val, color]) => {
            const pct = (val / denom) * 100;
            const el = (
              <circle
                key={label}
                cx="21"
                cy="21"
                r="15.9155"
                fill="none"
                stroke={color}
                strokeWidth="6"
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset={offset}
              />
            );
            offset -= pct;
            return el;
          })}
          <text x="21" y="23" textAnchor="middle" style={{ fontSize: 8 }}>
            {total}
          </text>
        </svg>
        <div className="lgd" style={{ flexDirection: 'column', gap: 6 }}>
          {slices.map(([label, val, color]) => (
            <span key={label}>
              <i style={{ background: color }} />
              {label} · {val}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderTrendLine = (vals: number[], labels: string[]) => {
    const w = 360;
    const h = 150;
    const m = Math.max(...vals, 1);
    const x = (i: number) => 30 + (i * (w - 50)) / Math.max(1, vals.length - 1);
    const y = (q: number) => h - 26 - (Math.max(0, q) / m) * (h - 50);
    const pts = vals.map((q, i) => `${x(i)},${y(q)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%">
        <line
          x1="30"
          y1={h - 26}
          x2={w - 20}
          y2={h - 26}
          stroke="rgba(120,140,170,.4)"
        />
        <polyline points={pts} fill="none" stroke="#1d4f9f" strokeWidth="2.5" />
        {vals.map((q, i) => (
          <g key={labels[i]}>
            <circle cx={x(i)} cy={y(q)} r="4" fill="#c9772a" />
            <text
              x={x(i)}
              y={y(q) - 9}
              textAnchor="middle"
              style={{ fontSize: 10 }}
            >
              {q}
            </text>
            <text
              x={x(i)}
              y={h - 8}
              textAnchor="middle"
              style={{ fontSize: 10, fontWeight: 400 }}
            >
              {labels[i]}
            </text>
          </g>
        ))}
      </svg>
    );
  };

  const defaultFrom = useMemo(() => dayOffset(90), []);
  const defaultTo = useMemo(() => dayOffset(0), []);
  const monthStart = useMemo(() => `${td.slice(0, 7)}-01`, [td]);

  const activePreset = useMemo(() => {
    if (toDate !== td) return '';
    if (fromDate === dayOffset(7)) return '7d';
    if (fromDate === dayOffset(30)) return '30d';
    if (fromDate === dayOffset(90)) return '90d';
    if (fromDate === monthStart) return 'mtd';
    return '';
  }, [fromDate, toDate, td, monthStart]);

  const applyPreset = (preset: '7d' | '30d' | '90d' | 'mtd') => {
    setToDate(td);
    if (preset === '7d') setFromDate(dayOffset(7));
    else if (preset === '30d') setFromDate(dayOffset(30));
    else if (preset === '90d') setFromDate(dayOffset(90));
    else setFromDate(monthStart);
  };

  const hasCustomFilters =
    fromDate !== defaultFrom ||
    toDate !== defaultTo ||
    branchFilter !== 'All' ||
    locFilter !== 'All' ||
    empFilter !== 'All' ||
    viewBy !== 'Overall' ||
    selectVal !== 'All';

  const handleResetFilters = () => {
    setFromDate(defaultFrom);
    setToDate(defaultTo);
    setBranchFilter('All');
    setLocFilter('All');
    setEmpFilter('All');
    setViewBy('Overall');
    setSelectVal('All');
  };

  const selectLabel =
    viewBy === 'Employee wise'
      ? 'Select employee'
      : viewBy === 'Team wise'
        ? 'Select location'
        : viewBy === 'Role wise'
          ? 'Select role'
          : 'Detail filter';

  const handleExport = () => {
    if (!canExportReports) return;
    const wb = XLSX.utils.book_new();
    const generatedAt = `${td} ${nowTimeStr()}`;
    const filterSummary = [
      `Date: ${fromDate} to ${toDate}`,
      `Branch: ${branchFilter}`,
      `Location: ${locFilter}`,
      `Employee: ${empFilter}`,
      `View: ${viewBy}${viewBy !== 'Overall' ? ` (${selectVal})` : ''}`,
    ].join('  |  ');

    const autoSizeSheet = (ws: XLSX.WorkSheet, aoa: Array<Array<string | number>>) => {
      const colWidths: number[] = [];
      aoa.forEach((row, rIdx) => {
        if (rIdx <= 1) return; // skip banner title & filter line when sizing narrow columns
        row.forEach((cell, cIdx) => {
          const len = String(cell ?? '').length;
          colWidths[cIdx] = Math.max(colWidths[cIdx] || 10, Math.min(len + 3, 44));
        });
      });
      ws['!cols'] = colWidths.map((wch) => ({ wch }));
    };

    const buildDataSheet = (
      bannerTitle: string,
      headers: string[],
      dataRows: Array<Array<string | number>>,
      totalRow?: Array<string | number>
    ) => {
      const aoa: Array<Array<string | number>> = [
        [bannerTitle],
        [`Filters Applied: ${filterSummary}`],
        [],
        headers,
        ...(dataRows.length ? dataRows : [['No matching records for the selected filters']]),
        ...(totalRow && dataRows.length ? [totalRow] : []),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      autoSizeSheet(ws, aoa);
      if (dataRows.length) {
        const lastCol = XLSX.utils.encode_col(headers.length - 1);
        const lastDataRow = 4 + dataRows.length;
        ws['!autofilter'] = { ref: `A4:${lastCol}${lastDataRow}` };
      }
      return ws;
    };

    // ===== 1. Report Summary (Executive Overview + Filter Selection + Branch & Location Summaries) =====
    const empCount = reportData.employeeDetails.length;
    const avgAttPct = empCount
      ? Math.round(
          reportData.employeeDetails.reduce((s, r) => s + r.stats.pct, 0) / empCount
        )
      : 0;
    const totalHours = round1(
      reportData.employeeDetails.reduce((s, r) => s + r.stats.h, 0)
    );
    const totalOvertime = round1(
      reportData.employeeDetails.reduce((s, r) => s + r.stats.ot, 0)
    );

    const summaryAoa: Array<Array<string | number>> = [
      ['KEJMIN OPS — REPORTS & ANALYTICS SUMMARY'],
      [`Generated On: ${generatedAt}  |  Generated By: ${me.name} (${me.role})`],
      [],
      ['1. APPLIED FILTER SELECTION', 'SELECTED VALUE'],
      ['From Date', fromDate],
      ['To Date', toDate],
      ['Branch', branchFilter],
      ['Location', locFilter],
      ['Employee', empFilter],
      ['View By', viewBy],
      ['Detail Filter', viewBy === 'Overall' ? 'All' : selectVal],
      [],
      ['2. KEY PERFORMANCE METRICS', 'VALUE'],
      ['Employees Included', empCount],
      ['Total Points Earned', reportData.totalPts],
      ['Top Performer', reportData.topPerformer],
      ['Total Tasks', reportData.tk.length],
      ['Completed Tasks', reportData.doneCount],
      ['In Progress Tasks', reportData.inProgCount],
      ['Overdue Tasks', reportData.overdueCount],
      ['Task Completion Rate', `${reportData.completionRate}%`],
      ['Average Attendance Rate', `${avgAttPct}%`],
      ['Total Hours Worked', totalHours],
      ['Total Overtime Hours', totalOvertime],
      [],
      ['3. BRANCH COMPLETION SUMMARY', 'Total Tasks', 'Completed', 'In Progress', 'Overdue', 'Completion %'],
      ...(reportData.branchDetails.length
        ? reportData.branchDetails.map((b) => [
            b.branch,
            b.total,
            b.done,
            b.inProg,
            b.overdue,
            `${b.pct}%`,
          ])
        : [['No branch tasks in selected filters', 0, 0, 0, 0, '0%']]),
      [],
      ['4. LOCATION PERFORMANCE SUMMARY', 'Employees', 'Total Points', 'Avg Attendance %', 'Hours Worked'],
      ...(reportData.locSummary.length
        ? reportData.locSummary.map((l) => [
            l.location,
            l.employees,
            l.pts,
            `${l.avgAtt}%`,
            l.hours,
          ])
        : [['No location records in selected filters', 0, 0, '0%', 0]]),
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoa);
    summarySheet['!cols'] = [
      { wch: 34 },
      { wch: 24 },
      { wch: 15 },
      { wch: 18 },
      { wch: 15 },
      { wch: 15 },
    ];
    XLSX.utils.book_append_sheet(wb, summarySheet, '1. Report Summary');

    // ===== 2. Employee Report (Ordered by Points desc, Attendance % desc, Name A-Z) =====
    const empHeaders = [
      'Sr. No.',
      'Employee Name',
      'User ID',
      'Role',
      'Branch',
      'Location',
      'Joined Date',
      'Points Earned',
      'Tasks Assigned',
      'Tasks Completed',
      'Tasks Open',
      'Tasks Overdue',
      'Working Days',
      'Present Days',
      'Late Days',
      'Absent Days',
      'Attendance %',
      'Hours Worked',
      'Overtime Hours',
    ];
    const empDataRows = reportData.employeeDetails.map((r, idx) => [
      idx + 1,
      r.emp.name,
      `@${r.emp.empId}`,
      r.emp.role,
      r.emp.branch || '-',
      r.emp.location,
      r.emp.joinedAt || '-',
      r.pts,
      r.tasksAssigned,
      r.tasksDone,
      r.tasksOpen,
      r.tasksOverdue,
      r.stats.w,
      r.stats.p,
      r.stats.l,
      r.stats.ab,
      `${r.stats.pct}%`,
      r.stats.h,
      r.stats.ot,
    ]);
    const empTotalRow = [
      '',
      'TOTAL / AVERAGE',
      '',
      '',
      '',
      '',
      '',
      round1(reportData.employeeDetails.reduce((s, r) => s + r.pts, 0)),
      reportData.employeeDetails.reduce((s, r) => s + r.tasksAssigned, 0),
      reportData.employeeDetails.reduce((s, r) => s + r.tasksDone, 0),
      reportData.employeeDetails.reduce((s, r) => s + r.tasksOpen, 0),
      reportData.employeeDetails.reduce((s, r) => s + r.tasksOverdue, 0),
      reportData.employeeDetails.reduce((s, r) => s + r.stats.w, 0),
      round1(reportData.employeeDetails.reduce((s, r) => s + r.stats.p, 0)),
      reportData.employeeDetails.reduce((s, r) => s + r.stats.l, 0),
      reportData.employeeDetails.reduce((s, r) => s + r.stats.ab, 0),
      `${avgAttPct}%`,
      totalHours,
      totalOvertime,
    ];
    XLSX.utils.book_append_sheet(
      wb,
      buildDataSheet('KEJMIN OPS — EMPLOYEE PERFORMANCE & ATTENDANCE REPORT', empHeaders, empDataRows, empTotalRow),
      '2. Employee Report'
    );

    // ===== 3. Task Details (Ordered: Overdue -> In Progress -> Completed, Due Date asc, Importance High -> Low) =====
    const taskHeaders = [
      'Sr. No.',
      'Task Title',
      'Status',
      'Importance',
      'Branch',
      'Location',
      'Due Date',
      'Due Time',
      'Schedule Type',
      'Stage Progress',
      'Current Assignee',
      'Approval Path',
      'Proofs Attached',
      'Created By',
      'Last Send-Back Reason',
    ];
    const taskDataRows = reportData.orderedTasks.map((t, idx) => {
      const closed = t.stage >= t.path.length || t.status === 'closed';
      const status = closed ? 'Completed' : t.dueAt < td ? 'Overdue' : 'In Progress';
      const assignee = closed ? 'Completed' : t.path[t.stage] || '-';
      return [
        idx + 1,
        t.title,
        status,
        t.priority,
        t.branch,
        t.location,
        t.dueAt,
        t.dueTime || '-',
        t.repeatMode === 'daily' ? 'Daily (excl. Sun & holidays)' : 'One-time',
        `${Math.min(t.stage + (closed ? 0 : 1), t.path.length)}/${t.path.length}`,
        assignee,
        t.path.join(' > '),
        t.proofs?.length || 0,
        t.createdBy || '-',
        t.lastSendBackReason || '-',
      ];
    });
    XLSX.utils.book_append_sheet(
      wb,
      buildDataSheet('KEJMIN OPS — TASK DETAILS REPORT', taskHeaders, taskDataRows),
      '3. Task Details'
    );

    // ===== 4. Attendance Log (Ordered: Date desc, Employee Name A-Z) =====
    const attHeaders = [
      'Sr. No.',
      'Date',
      'Employee Name',
      'Role',
      'Branch',
      'Location',
      'Day Status',
      'Clock In',
      'Clock Out',
      'Break (mins)',
      'Hours Worked',
      'Corrected By',
      'Notes',
    ];
    const attDataRows = reportData.orderedAttendance.map((rec, idx) => {
      const emp = dirByName[rec.employeeName];
      const dayStatus = calcDayStatus(
        rec,
        rec.date,
        emp?.joinedAt || '',
        rec.location || emp?.location || '',
        settings,
        holidays
      );
      return [
        idx + 1,
        rec.date,
        rec.employeeName,
        emp?.role || '-',
        emp?.branch || '-',
        rec.location || emp?.location || '-',
        dayStatus || '-',
        rec.in || '-',
        rec.out || '-',
        calcBreakMins(rec.breaks || []),
        round1(calcWorkedHours(rec)),
        rec.correctedBy || '-',
        rec.note || '-',
      ];
    });
    XLSX.utils.book_append_sheet(
      wb,
      buildDataSheet('KEJMIN OPS — DAILY ATTENDANCE LOG', attHeaders, attDataRows),
      '4. Attendance Log'
    );

    // ===== 5. Score History (Ordered: Date desc, Employee Name A-Z) =====
    const scoreHeaders = [
      'Sr. No.',
      'Date',
      'Employee Name',
      'Role',
      'Branch',
      'Location',
      'Task',
      'Points',
      'Reason',
    ];
    const scoreDataRows = reportData.orderedScores.map((ev, idx) => {
      const emp = dirByName[ev.employeeName];
      const linkedTask = ev.taskId ? taskById[ev.taskId] : undefined;
      return [
        idx + 1,
        ev.date,
        ev.employeeName,
        emp?.role || '-',
        linkedTask?.branch || emp?.branch || '-',
        emp?.location || '-',
        linkedTask?.title || ev.taskId || '-',
        round1(ev.points),
        ev.reason,
      ];
    });
    const scoreTotalRow = [
      '',
      '',
      'TOTAL POINTS',
      '',
      '',
      '',
      '',
      reportData.totalPts,
      '',
    ];
    XLSX.utils.book_append_sheet(
      wb,
      buildDataSheet('KEJMIN OPS — KPI SCORE LEDGER', scoreHeaders, scoreDataRows, scoreTotalRow),
      '5. Score History'
    );

    // ===== 6. Grouped Breakdown Sheet (included when View by != Overall) =====
    if (viewBy !== 'Overall') {
      const groupLabel = viewBy.replace(' wise', '');
      const bdHeaders = [
        'Sr. No.',
        groupLabel,
        'Members',
        'Points Earned',
        'Total Tasks',
        'Completed Tasks',
        'Completion %',
        'Avg Attendance %',
        'Hours Worked',
      ];
      const bdRows = reportData.breakdownRows.map((row, idx) => [
        idx + 1,
        row.group,
        row.members,
        row.pts,
        row.tasks,
        row.done,
        `${row.tasks ? Math.round((row.done / row.tasks) * 100) : 0}%`,
        `${row.attPct}%`,
        row.hours,
      ]);
      const bdTotalRow = [
        '',
        'TOTAL / AVERAGE',
        reportData.breakdownRows.reduce((s, r) => s + r.members, 0),
        round1(reportData.breakdownRows.reduce((s, r) => s + r.pts, 0)),
        reportData.breakdownRows.reduce((s, r) => s + r.tasks, 0),
        reportData.breakdownRows.reduce((s, r) => s + r.done, 0),
        `${reportData.completionRate}%`,
        `${avgAttPct}%`,
        round1(reportData.breakdownRows.reduce((s, r) => s + r.hours, 0)),
      ];
      XLSX.utils.book_append_sheet(
        wb,
        buildDataSheet(`KEJMIN OPS — ${viewBy.toUpperCase()} BREAKDOWN`, bdHeaders, bdRows, bdTotalRow),
        `6. ${viewBy}`
      );
    }

    // Build descriptive filename matching active filter selection
    const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
    const fileParts = [`KEJMIN_Report`, `${fromDate}_to_${toDate}`];
    if (branchFilter !== 'All') fileParts.push(slug(branchFilter));
    if (locFilter !== 'All') fileParts.push(slug(locFilter));
    if (empFilter !== 'All') fileParts.push(slug(empFilter));
    if (viewBy !== 'Overall') {
      fileParts.push(slug(viewBy));
      if (selectVal !== 'All') fileParts.push(slug(selectVal));
    }

    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileParts.join('_')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    onExportCsv(
      `${fromDate} to ${toDate} · branch ${branchFilter} · location ${locFilter} · employee ${empFilter} · ${viewBy}${viewBy !== 'Overall' ? ` (${selectVal})` : ''}`
    );
  };

  return (
    <div className="view on" id="v-rep">
      <section className="rep-panel" aria-label="Reports and analytics filters">
        <div className="rep-hd">
          <div className="rep-title-wrap">
            <h3 className="rep-title">Reports and analytics</h3>
            <div className="rep-seg" role="group" aria-label="Quick date range">
              {(
                [
                  ['7d', '7D'],
                  ['30d', '30D'],
                  ['90d', '90D'],
                  ['mtd', 'MTD'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={activePreset === key ? 'on' : ''}
                  onClick={() => applyPreset(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rep-actions">
            {hasCustomFilters && (
              <button
                className="rep-btn rep-btn-ghost"
                type="button"
                onClick={handleResetFilters}
              >
                Reset
              </button>
            )}
            {canExportReports && (
              <>
                <button
                  className="rep-btn rep-btn-secondary"
                  type="button"
                  onClick={() => {
                    onPrint();
                    try {
                      window.print();
                    } catch {
                      // ignore
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 9V4h12v5" />
                    <rect x="6" y="14" width="12" height="6" rx="1" />
                    <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
                  </svg>
                  Print
                </button>
                <button
                  className="rep-btn rep-btn-primary"
                  id="ex"
                  type="button"
                  onClick={handleExport}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
                    <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                  </svg>
                  Export Excel
                </button>
              </>
            )}
          </div>
        </div>

        <div className="rep-body">
          <div className={`rep-filters${viewBy !== 'Overall' ? ' has-detail' : ''}`}>
            <div className="rep-field">
              <label htmlFor="r1">From</label>
              <input
                type="date"
                id="r1"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div className="rep-field">
              <label htmlFor="r2">To</label>
              <input
                type="date"
                id="r2"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <div className="rep-field">
              <label htmlFor="rb">Branch</label>
              <select
                id="rb"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              >
                <option value="All">All</option>
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="rep-field">
              <label htmlFor="rl">Location</label>
              <select
                id="rl"
                value={locFilter}
                onChange={(e) => setLocFilter(e.target.value)}
              >
                <option value="All">All</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div className="rep-field">
              <label htmlFor="re">Employee</label>
              <select
                id="re"
                value={empFilter}
                onChange={(e) => setEmpFilter(e.target.value)}
              >
                <option value="All">All</option>
                {empNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="rep-field">
              <label htmlFor="rv">View by</label>
              <select
                id="rv"
                value={viewBy}
                onChange={(e) => {
                  setViewBy(e.target.value as typeof viewBy);
                  setSelectVal('All');
                }}
              >
                <option value="Overall">Overall</option>
                <option value="Employee wise">Employee wise</option>
                <option value="Team wise">Team wise</option>
                <option value="Role wise">Role wise</option>
              </select>
            </div>

            {viewBy !== 'Overall' && (
              <div className="rep-field">
                <label htmlFor="rs">{selectLabel}</label>
                <select
                  id="rs"
                  value={selectVal}
                  onChange={(e) => setSelectVal(e.target.value)}
                >
                  {selectOptions.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid" id="rk" style={{ marginTop: 16 }}>
        {(
          [
            ['Total points', reportData.totalPts, '', 'Selected date range'],
            [
              'Completion rate',
              `${reportData.completionRate}%`,
              '',
              `${reportData.doneCount} of ${reportData.tk.length} tasks completed`,
            ],
            [
              'Overdue tasks',
              reportData.overdueCount,
              'r',
              reportData.overdueCount === 0 ? 'All open tasks on track' : 'Requires attention',
            ],
            [
              'Top performer',
              reportData.topPerformer,
              'o',
              reportData.empRows[0] ? `${reportData.empRows[0][1]} pts in range` : 'No scores yet',
            ],
          ] as Array<[string, string | number, string, string]>
        ).map(([label, val, cls, note], idx) => (
          <div
            key={label}
            className="glass card"
            style={{ animationDelay: `${idx * 0.08}s` }}
          >
            <div className="sub">{label}</div>
            <div
              className={`big ${cls}`}
              style={label === 'Top performer' ? { fontSize: 22, paddingTop: 6 } : undefined}
            >
              {val}
            </div>
            <div className="rep-kpi-sub">{note}</div>
          </div>
        ))}
      </div>

      <div className="g2" id="rcx">
        <div className="glass sec">
          <h3>Employee scores (selected dates)</h3>
          {renderHBars(reportData.empRows, reportData.empRows[0]?.[1] || 0)}
        </div>
        <div className="glass sec">
          <h3>Task status</h3>
          {renderDonut([
            ['Completed', reportData.doneCount, CHART_COLORS[0]],
            ['In progress', reportData.inProgCount, CHART_COLORS[1]],
            ['Overdue', reportData.overdueCount, CHART_COLORS[2]],
          ])}
        </div>
        <div className="glass sec">
          <h3>Importance mix</h3>
          {renderDonut([
            ['Low', reportData.tk.filter((t) => t.priority === 'Low').length, CHART_COLORS[0]],
            ['Medium', reportData.tk.filter((t) => t.priority === 'Medium').length, CHART_COLORS[1]],
            ['High', reportData.tk.filter((t) => t.priority === 'High').length, CHART_COLORS[2]],
          ])}
        </div>
        <div className="glass sec">
          <h3>Points trend, last 6 months</h3>
          {renderTrendLine(reportData.trendVals, reportData.trendLabels)}
        </div>
        <div className="glass sec">
          <h3>Branch completion</h3>
          {renderHBars(reportData.branchRows, 100, '%')}
        </div>
        <div className="glass sec">
          <h3>Team score by location</h3>
          {renderHBars(reportData.locRows, reportData.locRows[0]?.[1] || 0)}
        </div>
        <div className="glass sec">
          <h3>Attendance rate</h3>
          {renderHBars(reportData.attRows, 100, '%')}
        </div>
        {viewBy !== 'Overall' && (
          <div className="glass sec">
            <h3>{viewBy} breakdown</h3>
            <div className="tbl m-card-tbl">
              <table>
                <thead>
                  <tr>
                    <th>{viewBy.replace(' wise', '')}</th>
                    <th>Points</th>
                    <th>Tasks</th>
                    <th>Done</th>
                    <th>Attendance</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.breakdownRows.map((row) => (
                    <tr key={row.group}>
                      <td data-label={viewBy.replace(' wise', '')}>
                        <b>{row.group}</b>
                      </td>
                      <td data-label="Points">{row.pts}</td>
                      <td data-label="Tasks">{row.tasks}</td>
                      <td data-label="Done">{row.done}</td>
                      <td data-label="Attendance">{row.attPct}%</td>
                      <td data-label="Hours">{row.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
