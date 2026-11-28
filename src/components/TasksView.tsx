import React, { useMemo, useRef, useState } from 'react';
import { DirectoryEntry, Holiday, Priority, RepeatMode, TaskDoc, ViewId, WEIGHTS } from '../types';
import { findHoliday, initialsOf, isSundayDate, nextDailyRunDate, nowTimeStr, todayStr } from '../utils/crypto';

interface TasksViewProps {
  me: DirectoryEntry;
  canCreateTasks: boolean;
  canSeeAll: boolean;
  canSendBack: boolean;
  canDeleteTasks: boolean;
  isAdmin: boolean;
  myTasks: TaskDoc[];
  directory: DirectoryEntry[];
  branches: string[];
  locations: string[];
  holidays: Holiday[];
  onNavigate: (v: ViewId) => void;
  onAdvance: (task: TaskDoc) => Promise<void>;
  onSendBack: (task: TaskDoc, reason: string) => Promise<void>;
  onEditTask: (params: {
    task: TaskDoc;
    title: string;
    branch: string;
    location: string;
    priority: Priority;
    dueAt: string;
    dueTime: string;
    repeatMode: RepeatMode;
    path: string[];
  }) => Promise<void>;
  onDeleteTask: (task: TaskDoc) => Promise<void>;
  onAttachProof: (task: TaskDoc, file: File) => Promise<void>;
}

type TabFilter = 'all' | 'mine' | 'prog' | 'over' | 'done';
type SortMode = 'due' | 'imp' | 'new';

export const TasksView: React.FC<TasksViewProps> = ({
  me,
  canCreateTasks,
  canSeeAll,
  canSendBack,
  canDeleteTasks,
  isAdmin,
  myTasks,
  directory,
  branches,
  locations,
  holidays,
  onNavigate,
  onAdvance,
  onSendBack,
  onEditTask,
  onDeleteTask,
  onAttachProof,
}) => {
  const [filterTab, setFilterTab] = useState<TabFilter>('all');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('All');
  const [locFilter, setLocFilter] = useState('All');
  const [impFilter, setImpFilter] = useState('All');
  const [sortBy, setSortBy] = useState<SortMode>('due');
  const [viewMode, setViewMode] = useState<'list' | 'board'>(() => {
    try {
      return localStorage.getItem('kjtv') === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });

  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [sendBackTarget, setSendBackTarget] = useState<TaskDoc | null>(null);
  const [sendBackReason, setSendBackReason] = useState('');
  const [sendBackErr, setSendBackErr] = useState('');
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // Edit task modal state
  const [editTarget, setEditTarget] = useState<TaskDoc | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBranch, setEditBranch] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editDueAt, setEditDueAt] = useState('');
  const [editDueTime, setEditDueTime] = useState('');
  const [editRepeatMode, setEditRepeatMode] = useState<RepeatMode>('none');
  const [editPriority, setEditPriority] = useState<Priority>('Medium');
  const [editStages, setEditStages] = useState<string[]>([]);
  const [editErr, setEditErr] = useState('');

  // Delete task confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<TaskDoc | null>(null);

  const [proofError, setProofError] = useState('');
  const proofInputRef = useRef<HTMLInputElement>(null);

  const td = todayStr();
  const nowHm = nowTimeStr();

  const dirByName = useMemo(() => {
    const map: Record<string, DirectoryEntry> = {};
    directory.forEach((d) => {
      map[d.name] = d;
    });
    return map;
  }, [directory]);

  const allEmployeeNames = useMemo(
    () => Array.from(new Set(directory.map((d) => d.name))),
    [directory]
  );

  const isOpen = (t: TaskDoc) => t.stage < t.path.length && t.status !== 'closed';
  const isFutureDaily = (t: TaskDoc) => isOpen(t) && t.repeatMode === 'daily' && t.dueAt > td;
  const isOver = (t: TaskDoc) =>
    isOpen(t) && (t.dueAt < td || (t.dueAt === td && Boolean(t.dueTime) && nowHm > (t.dueTime || '')));
  const isMineTurn = (t: TaskDoc) => isOpen(t) && !isFutureDaily(t) && t.path[t.stage] === me.name;
  const canEditTask = (t: TaskDoc) => isAdmin || (isOpen(t) && t.createdBy === me.name);
  const canDeleteTask = () => canDeleteTasks;

  const counts = useMemo(
    () => ({
      all: myTasks.length,
      mine: myTasks.filter(isMineTurn).length,
      prog: myTasks.filter(isOpen).length,
      over: myTasks.filter(isOver).length,
      done: myTasks.filter((t) => !isOpen(t)).length,
    }),
    [myTasks, td, me.name]
  );

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = myTasks.filter((t) => {
      if (filterTab === 'mine' && !isMineTurn(t)) return false;
      if (filterTab === 'prog' && !isOpen(t)) return false;
      if (filterTab === 'over' && !isOver(t)) return false;
      if (filterTab === 'done' && isOpen(t)) return false;
      if (branchFilter !== 'All' && t.branch !== branchFilter) return false;
      if (locFilter !== 'All' && t.location !== locFilter) return false;
      if (impFilter !== 'All' && t.priority !== impFilter) return false;
      if (q) {
        const hay = `${t.title} ${t.path.join(' ')} ${t.branch} ${t.location}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const cmpDate = (a: TaskDoc, b: TaskDoc) =>
      a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;

    return [...list].sort((a, b) => {
      if (sortBy === 'due') {
        const openDiff = Number(isOpen(b)) - Number(isOpen(a));
        return openDiff || cmpDate(a, b);
      }
      if (sortBy === 'imp') {
        return WEIGHTS[b.priority] - WEIGHTS[a.priority] || cmpDate(a, b);
      }
      const at = a.createdAt?.toMillis() || 0;
      const bt = b.createdAt?.toMillis() || 0;
      return bt - at;
    });
  }, [myTasks, filterTab, search, branchFilter, locFilter, impFilter, sortBy, td, me.name]);

  const detailTask = useMemo(
    () => (detailTaskId ? myTasks.find((t) => t.taskId === detailTaskId) || null : null),
    [detailTaskId, myTasks]
  );

  const dueDaysDelta = (t: TaskDoc) =>
    Math.round(
      (new Date(`${t.dueAt}T00:00:00Z`).getTime() - new Date(`${td}T00:00:00Z`).getTime()) /
        864e5
    );

  const renderDueBadge = (t: TaskDoc) => {
    if (!isOpen(t)) return <span className="tk-due ok">Completed</span>;
    const d = dueDaysDelta(t);
    const timeSuffix = t.dueTime ? ` · ${t.dueTime}` : '';
    if (d < 0) {
      return (
        <span className="tk-due late">
          Overdue by {-d} day{d === -1 ? '' : 's'}
          {timeSuffix}
        </span>
      );
    }
    if (d === 0) {
      if (t.dueTime && nowHm > t.dueTime) {
        return <span className="tk-due late">Overdue (due {t.dueTime})</span>;
      }
      return <span className="tk-due warn">Due today{timeSuffix}</span>;
    }
    if (t.repeatMode === 'daily' && d > 0) {
      return (
        <span className="tk-due">
          Scheduled for {t.dueAt}
          {timeSuffix}
        </span>
      );
    }
    return (
      <span className="tk-due">
        Due in {d} day{d === 1 ? '' : 's'}
        {timeSuffix}
      </span>
    );
  };

  const escalationText = (t: TaskDoc): string | null => {
    if (!isOpen(t)) return null;
    const d = dueDaysDelta(t);
    if (d <= -3) return 'Escalation: 3+ days overdue — Company Owner notified';
    if (d <= -1) return 'Escalation: 1+ day overdue — Finalizer notified';
    if (d === 0) return 'Alert: Due today — Process Coordinator notified';
    return null;
  };

  const handleAdvance = async (t: TaskDoc) => {
    setBusyTaskId(t.taskId);
    try {
      await onAdvance(t);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleConfirmSendBack = async () => {
    if (!sendBackTarget) return;
    const trimmed = sendBackReason.trim();
    if (trimmed.length < 3) {
      setSendBackErr('Please enter a reason (at least 3 characters) to send this task back.');
      return;
    }
    setBusyTaskId(sendBackTarget.taskId);
    try {
      await onSendBack(sendBackTarget, trimmed);
      setSendBackTarget(null);
      setSendBackReason('');
      setSendBackErr('');
    } finally {
      setBusyTaskId(null);
    }
  };

  const openDetailModal = (t: TaskDoc) => {
    setDetailTaskId(t.taskId);
    setProofError('');
  };

  const openEditModal = (t: TaskDoc) => {
    setEditTarget(t);
    setEditTitle(t.title);
    setEditBranch(t.branch);
    setEditLocation(t.location);
    setEditDueAt(t.dueAt);
    setEditDueTime(t.dueTime || (t.repeatMode === 'daily' ? '18:00' : ''));
    setEditRepeatMode(t.repeatMode === 'daily' ? 'daily' : 'none');
    setEditPriority(t.priority);
    setEditStages([...t.path]);
    setEditErr('');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    const cleanTitle = editTitle.trim();
    const cleanStages = editStages.filter(Boolean);
    if (!cleanTitle) {
      setEditErr('Please enter a task title.');
      return;
    }
    if (!editDueAt) {
      setEditErr('Please select a due date.');
      return;
    }
    if (editRepeatMode === 'daily' && !editDueTime) {
      setEditErr('Please set a due time for daily repeated tasks.');
      return;
    }
    if (!cleanStages.length) {
      setEditErr('Add at least one person to the approval path.');
      return;
    }
    setEditErr('');
    setBusyTaskId(editTarget.taskId);
    try {
      await onEditTask({
        task: editTarget,
        title: cleanTitle,
        branch: editBranch,
        location: editLocation,
        priority: editPriority,
        dueAt: editDueAt,
        dueTime: editDueTime,
        repeatMode: editRepeatMode,
        path: cleanStages,
      });
      setEditTarget(null);
    } catch (err: unknown) {
      setEditErr(err instanceof Error ? err.message : 'Could not save task changes.');
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canDeleteTasks) return;
    setBusyTaskId(deleteTarget.taskId);
    try {
      const deletedId = deleteTarget.taskId;
      await onDeleteTask(deleteTarget);
      setDeleteTarget(null);
      if (detailTaskId === deletedId) {
        setDetailTaskId(null);
      }
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleProofFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !detailTask) return;
    setProofError('');
    const validType = /^image\//.test(file.type) || file.type === 'application/pdf';
    if (!validType) {
      setProofError('Uploaded proofs must be images or PDFs only.');
      return;
    }
    if (file.size > 10 * 1048576) {
      setProofError('Proof file exceeds the 10 MB limit.');
      return;
    }
    setBusyTaskId(detailTask.taskId);
    try {
      await onAttachProof(detailTask, file);
    } finally {
      setBusyTaskId(null);
    }
  };

  const renderCard = (t: TaskDoc, board: boolean) => {
    const open = isOpen(t);
    const futureDaily = isFutureDaily(t);
    const mineTurn = isMineTurn(t);
    const over = isOver(t);
    const pct = Math.round((Math.min(t.stage, t.path.length) / t.path.length) * 100);
    const canMarkDone = open && !futureDaily && (t.path[t.stage] === me.name || canSeeAll);
    const showSendBack = open && !futureDaily && t.stage > 0 && canSendBack;
    const editable = canEditTask(t);
    const deletable = canDeleteTask();
    const isBusy = busyTaskId === t.taskId;

    return (
      <article
        key={t.taskId}
        className={`glass tk-card p-${t.priority}${over ? ' late' : ''}${mineTurn ? ' mine' : ''}`}
      >
        <div>
          <div>
            <button
              className="tk-title"
              type="button"
              onClick={() => openDetailModal(t)}
            >
              {t.title}
            </button>
            {mineTurn && <span className="tk-me">Your turn</span>}
          </div>
          <div className="tk-meta">
            <span>{t.branch}</span>
            <span>&middot;</span>
            <span>{t.location}</span>
            <span className={`tag ${t.priority}`}>
              {t.priority} &middot; {WEIGHTS[t.priority]}pt
            </span>
            {t.repeatMode === 'daily' && (
              <span className="tag Low" title="Runs daily except Sunday & holidays">
                Daily{t.dueTime ? ` · ${t.dueTime}` : ''}
              </span>
            )}
          </div>
        </div>

        {board ? (
          <div>
            <div className="bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="tk-wait" style={{ marginTop: 6 }}>
              {open ? (
                <>
                  Stage {t.stage + 1} of {t.path.length} &middot; waiting on{' '}
                  <b>{t.path[t.stage]}</b>
                </>
              ) : (
                <>All {t.path.length} stages signed off</>
              )}
            </div>
          </div>
        ) : (
          <div className="tk-st">
            {t.path.map((p, j) => (
              <div
                key={`${t.taskId}-${j}-${p}`}
                className={`tk-s ${j < t.stage ? 'd' : j === t.stage && open ? 'c' : ''}`}
                title={p}
              >
                <span className="tk-dot">{j < t.stage ? '\u2713' : initialsOf(p)}</span>
                <span className="tk-nm">{p}</span>
              </div>
            ))}
          </div>
        )}

        <div className="tk-side">
          {renderDueBadge(t)}
          {!board && (
            <div className="tk-wait">
              {open ? (
                <>
                  Stage {t.stage + 1} of {t.path.length} &middot; waiting on{' '}
                  <b>{t.path[t.stage]}</b>
                </>
              ) : (
                <>All {t.path.length} stages signed off</>
              )}
            </div>
          )}
          <div className="tk-act">
            {canMarkDone && (
              <button
                className="btn"
                type="button"
                disabled={isBusy}
                onClick={() => handleAdvance(t)}
              >
                Mark done
              </button>
            )}
            {showSendBack && (
              <button
                className="btn g"
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setSendBackTarget(t);
                  setSendBackReason('');
                  setSendBackErr('');
                }}
              >
                Send back
              </button>
            )}
            {editable && (
              <button
                className="btn g"
                type="button"
                disabled={isBusy}
                onClick={() => openEditModal(t)}
              >
                Edit
              </button>
            )}
            {deletable && (
              <button
                className="btn r"
                type="button"
                disabled={isBusy}
                onClick={() => setDeleteTarget(t)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </article>
    );
  };

  const tabsList: Array<[TabFilter, string, string]> = [
    ['all', 'All tasks', ''],
    ['mine', 'Waiting on you', 'o'],
    ['prog', 'In progress', ''],
    ['over', 'Overdue', 'r'],
    ['done', 'Completed', ''],
  ];

  const switchView = (mode: 'list' | 'board') => {
    setViewMode(mode);
    try {
      localStorage.setItem('kjtv', mode);
    } catch {
      // ignore
    }
  };

  const editBranchOptions = useMemo(
    () =>
      editBranch && !branches.includes(editBranch)
        ? [editBranch, ...branches]
        : branches,
    [editBranch, branches]
  );

  const editLocationOptions = useMemo(
    () =>
      editLocation && !locations.includes(editLocation)
        ? [editLocation, ...locations]
        : locations,
    [editLocation, locations]
  );

  return (
    <div className="view on" id="v-tasks">
      <div className="tk-head">
        <div>
          <h2>Tasks</h2>
          <div className="sub" id="tk-sub">
            {filteredTasks.length} of {myTasks.length} task{myTasks.length === 1 ? '' : 's'} shown
            {canSeeAll ? ' · all branches' : ' · tasks you are on the path for'}
          </div>
        </div>
        {canCreateTasks && (
          <button className="btn" id="tk-new" type="button" onClick={() => onNavigate('flow')}>
            + New task
          </button>
        )}
      </div>

      <div className="tk-tabs" id="tk-tabs">
        {tabsList.map(([key, label, cls]) => (
          <button
            key={key}
            type="button"
            className={`tk-tab ${cls} ${filterTab === key ? 'on' : ''}`}
            data-f={key}
            onClick={() => setFilterTab(key)}
          >
            <b>{counts[key]}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="glass tk-bar">
        <div className="tk-sq">
          <label htmlFor="tks">Search</label>
          <input
            id="tks"
            type="search"
            placeholder="Task, person, branch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="tkb">Branch</label>
          <select id="tkb" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="All">All</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tkl">Location</label>
          <select id="tkl" value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
            <option value="All">All</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tkp">Importance</label>
          <select id="tkp" value={impFilter} onChange={(e) => setImpFilter(e.target.value)}>
            <option value="All">All</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </div>
        <div>
          <label htmlFor="tkso">Sort by</label>
          <select
            id="tkso"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortMode)}
          >
            <option value="due">Due date</option>
            <option value="imp">Importance</option>
            <option value="new">Newest first</option>
          </select>
        </div>
        <div className="tk-vt" role="group" aria-label="View">
          <button
            type="button"
            className={viewMode === 'list' ? 'on' : ''}
            onClick={() => switchView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={viewMode === 'board' ? 'on' : ''}
            onClick={() => switchView('board')}
          >
            Board
          </button>
        </div>
      </div>

      <div id="tk-body">
        {filteredTasks.length === 0 ? (
          <div className="glass tk-empty">
            <b>{myTasks.length ? 'No tasks match these filters.' : 'No tasks yet.'}</b>
            <div className="sub" style={{ marginTop: 6 }}>
              {myTasks.length
                ? 'Clear the search or choose another tab.'
                : canCreateTasks
                ? 'Create one from the Workflow builder.'
                : 'Tasks assigned to you will appear here.'}
            </div>
          </div>
        ) : viewMode === 'board' ? (
          <div className="tk-board">
            {(
              [
                ['Not started', filteredTasks.filter((t) => t.stage === 0 && isOpen(t))],
                ['In progress', filteredTasks.filter((t) => t.stage > 0 && isOpen(t))],
                ['Completed', filteredTasks.filter((t) => !isOpen(t))],
              ] as Array<[string, TaskDoc[]]>
            ).map(([colTitle, items]) => (
              <div key={colTitle} className="tk-col">
                <h4>
                  {colTitle}
                  <span className="tag Low">{items.length}</span>
                </h4>
                {items.length ? (
                  items.map((t) => renderCard(t, true))
                ) : (
                  <div className="tk-empty" style={{ padding: 18 }}>
                    Nothing here
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="tk-list">{filteredTasks.map((t) => renderCard(t, false))}</div>
        )}
      </div>

      {/* Send Back Modal (Requires Reason per Blueprint) */}
      {sendBackTarget && (
        <div
          className="ov"
          onClick={(e) => e.target === e.currentTarget && setSendBackTarget(null)}
        >
          <div className="md">
            <h3>Send back task</h3>
            <div className="sub">
              Return <b>{sendBackTarget.title}</b> one stage to{' '}
              <b>{sendBackTarget.path[sendBackTarget.stage - 1]}</b>. Points earned for the
              reversed stage will be removed via an append-only reversal event.
            </div>
            <label htmlFor="sb-reason">Reason for send-back (required)</label>
            <textarea
              id="sb-reason"
              style={{ minHeight: 80, fontFamily: 'inherit', fontSize: 14 }}
              placeholder="Explain what needs correction..."
              value={sendBackReason}
              onChange={(e) => {
                setSendBackReason(e.target.value);
                setSendBackErr('');
              }}
            />
            {sendBackErr && <div className="er">{sendBackErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                className="btn g"
                type="button"
                onClick={() => setSendBackTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn r"
                type="button"
                disabled={busyTaskId === sendBackTarget.taskId}
                onClick={handleConfirmSendBack}
              >
                Confirm send back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Task Modal */}
      {editTarget && (
        <div
          className="ov"
          onClick={(e) => e.target === e.currentTarget && setEditTarget(null)}
        >
          <div className="md">
            <h3>Edit task</h3>
            <label htmlFor="et-title">Task title</label>
            <input
              id="et-title"
              value={editTitle}
              maxLength={160}
              onChange={(e) => setEditTitle(e.target.value)}
            />
            <div className="row">
              <div>
                <label htmlFor="et-branch">Branch</label>
                <select
                  id="et-branch"
                  value={editBranch}
                  onChange={(e) => setEditBranch(e.target.value)}
                >
                  {editBranchOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="et-loc">Location</label>
                <select
                  id="et-loc"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                >
                  {editLocationOptions.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="et-due">Due date</label>
                <input
                  id="et-due"
                  type="date"
                  value={editDueAt}
                  onChange={(e) => setEditDueAt(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="et-imp">Importance</label>
                <select
                  id="et-imp"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as Priority)}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="et-rep">Repeated due date</label>
                <select
                  id="et-rep"
                  value={editRepeatMode}
                  onChange={(e) => {
                    const m = e.target.value as RepeatMode;
                    setEditRepeatMode(m);
                    if (m === 'daily') {
                      if (!editDueTime) setEditDueTime('18:00');
                      if (editDueAt) {
                        setEditDueAt(nextDailyRunDate(editDueAt, editLocation, holidays, true));
                      }
                    }
                  }}
                >
                  <option value="none">One-time (does not repeat)</option>
                  <option value="daily">Daily (except Sunday &amp; holidays)</option>
                </select>
              </div>
              <div>
                <label htmlFor="et-time">Due time</label>
                <input
                  id="et-time"
                  type="time"
                  value={editDueTime}
                  onChange={(e) => setEditDueTime(e.target.value)}
                />
              </div>
            </div>
            {editRepeatMode === 'daily' && editDueAt && (isSundayDate(editDueAt) || findHoliday(editDueAt, editLocation, holidays)) && (
              <div className="sub" style={{ color: 'var(--org)', marginTop: 6 }}>
                Selected date is a Sunday or holiday — it will shift to{' '}
                <b>{nextDailyRunDate(editDueAt, editLocation, holidays, true)}</b> on save.
              </div>
            )}
            <label>Approval path stages</label>
            {editStages.map((st, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <select
                  value={st}
                  onChange={(e) => {
                    const copy = [...editStages];
                    copy[idx] = e.target.value;
                    setEditStages(copy);
                  }}
                >
                  <option value="">-- Remove stage --</option>
                  {allEmployeeNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {editStages.length < 12 && (
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn g"
                  type="button"
                  onClick={() => setEditStages([...editStages, allEmployeeNames[0] || ''])}
                >
                  + Add stage
                </button>
              </div>
            )}
            {editErr && <div className="er">{editErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                className="btn g"
                type="button"
                onClick={() => setEditTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                disabled={busyTaskId === editTarget.taskId}
                onClick={handleSaveEdit}
              >
                {busyTaskId === editTarget.taskId ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Task Confirmation Modal */}
      {deleteTarget && canDeleteTasks && (
        <div
          className="ov"
          onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}
        >
          <div className="md">
            <h3>Delete task</h3>
            <div className="sub" style={{ marginTop: 6 }}>
              Are you sure you want to permanently delete <b>{deleteTarget.title}</b> (
              {deleteTarget.branch} &middot; {deleteTarget.location})? This action will be
              recorded in the audit log and cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                className="btn g"
                type="button"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn r"
                type="button"
                disabled={busyTaskId === deleteTarget.taskId}
                onClick={handleConfirmDelete}
              >
                {busyTaskId === deleteTarget.taskId ? 'Deleting...' : 'Delete task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {detailTask && (
        <div
          className="ov"
          onClick={(e) => e.target === e.currentTarget && setDetailTaskId(null)}
        >
          <div className="md">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <h3 style={{ margin: 0 }}>{detailTask.title}</h3>
              <span className={`tag ${detailTask.priority}`}>
                {detailTask.priority} · {WEIGHTS[detailTask.priority]}pt
              </span>
            </div>
            <div className="sub" style={{ margin: '6px 0 14px' }}>
              {detailTask.branch} · {detailTask.location} · Due {detailTask.dueAt}
              {detailTask.dueTime ? ` at ${detailTask.dueTime}` : ''}
              {detailTask.repeatMode === 'daily' ? ' · Daily (excl. Sun & holidays)' : ''} ·{' '}
              {detailTask.status === 'closed' ? 'Locked (Closed)' : 'Open'}
            </div>

            {escalationText(detailTask) && (
              <div className="er" style={{ marginTop: 0, marginBottom: 14 }}>
                {escalationText(detailTask)}
              </div>
            )}

            {detailTask.lastSendBackReason && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--org)',
                  marginBottom: 14,
                  fontSize: 13,
                }}
              >
                <b>Last send-back note:</b> {detailTask.lastSendBackReason}
              </div>
            )}

            <div className="tl">
              {detailTask.path.map((p, j) => {
                const info = dirByName[p];
                const cls =
                  j < detailTask.stage
                    ? 'd'
                    : j === detailTask.stage && isOpen(detailTask)
                    ? 'c'
                    : '';
                return (
                  <div key={`${p}-${j}`} className={cls}>
                    <b>
                      Level {j + 1} · {p}
                    </b>
                    <div className="sub">
                      {info?.location || ''} · {info?.role || ''} ·{' '}
                      {j < detailTask.stage
                        ? 'Completed'
                        : j === detailTask.stage && isOpen(detailTask)
                        ? 'Waiting on this level'
                        : 'Queued'}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Proofs Archive Section (Blueprint) */}
            <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ fontSize: 13 }}>Proofs &amp; attachments</b>
                {isOpen(detailTask) && (
                  <>
                    <button
                      className="btn g"
                      type="button"
                      style={{ padding: '5px 10px', fontSize: 12 }}
                      onClick={() => proofInputRef.current?.click()}
                    >
                      + Attach proof
                    </button>
                    <input
                      ref={proofInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      style={{ display: 'none' }}
                      onChange={handleProofFile}
                    />
                  </>
                )}
              </div>
              {proofError && <div className="er">{proofError}</div>}
              {(detailTask.proofs || []).length === 0 ? (
                <div className="sub" style={{ marginTop: 4 }}>
                  No proofs attached yet (images or PDFs up to 10 MB).
                </div>
              ) : (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                  {detailTask.proofs.map((pr, idx) => (
                    <li key={idx}>{pr}</li>
                  ))}
                </ul>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                marginTop: 18,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                {canEditTask(detailTask) && (
                  <button
                    className="btn g"
                    type="button"
                    onClick={() => {
                      setDetailTaskId(null);
                      openEditModal(detailTask);
                    }}
                  >
                    Edit task
                  </button>
                )}
                {canDeleteTask() && (
                  <button
                    className="btn r"
                    type="button"
                    onClick={() => setDeleteTarget(detailTask)}
                  >
                    Delete
                  </button>
                )}
              </div>
              <button
                className="btn"
                id="mc"
                type="button"
                onClick={() => setDetailTaskId(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
