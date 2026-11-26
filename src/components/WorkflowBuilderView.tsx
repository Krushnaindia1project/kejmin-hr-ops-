import React, { useMemo, useState } from 'react';
import { DirectoryEntry, Holiday, Priority, RepeatMode, WorkflowPath } from '../types';
import {
  dayOffset,
  findHoliday,
  isSundayDate,
  nextDailyRunDate,
  todayStr,
  upcomingDailyRunDates,
} from '../utils/crypto';

interface WorkflowBuilderViewProps {
  directory: DirectoryEntry[];
  branches: string[];
  locations: string[];
  holidays: Holiday[];
  paths: WorkflowPath[];
  isAdmin: boolean;
  onCreateTask: (params: {
    title: string;
    branch: string;
    location: string;
    priority: Priority;
    dueAt: string;
    dueTime: string;
    repeatMode: RepeatMode;
    path: string[];
    pathId: string;
  }) => Promise<void>;
  onSaveTemplate: (name: string, stages: string[]) => Promise<void>;
}

export const WorkflowBuilderView: React.FC<WorkflowBuilderViewProps> = ({
  directory,
  branches,
  locations,
  holidays,
  paths,
  isAdmin,
  onCreateTask,
  onSaveTemplate,
}) => {
  const [title, setTitle] = useState('');
  const [branch, setBranch] = useState(branches[0] || 'MIS');
  const [location, setLocation] = useState(locations[0] || 'Bengaluru Office');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [dueAt, setDueAt] = useState(() => dayOffset(-5));
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [dueTime, setDueTime] = useState('18:00');
  const [selectedTemplate, setSelectedTemplate] = useState('Blank');
  const [stages, setStages] = useState<string[]>(['', '']);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName, setTplName] = useState('');

  const employeeNames = useMemo(
    () => Array.from(new Set(directory.filter((d) => d.active).map((d) => d.name))),
    [directory]
  );

  const dailySchedulePreview = useMemo(() => {
    if (repeatMode !== 'daily' || !dueAt) return null;
    const isSun = isSundayDate(dueAt);
    const hol = findHoliday(dueAt, location, holidays);
    const firstRun = nextDailyRunDate(dueAt, location, holidays, true);
    const upcoming = upcomingDailyRunDates(firstRun, location, holidays, 3);
    let skippedNotice = '';
    if (isSun) {
      skippedNotice = `${dueAt} is a Sunday — automatically moved to ${firstRun}.`;
    } else if (hol) {
      skippedNotice = `${dueAt} is a holiday (${hol.name}) — automatically moved to ${firstRun}.`;
    }
    return { firstRun, upcoming, skippedNotice };
  }, [repeatMode, dueAt, location, holidays]);

  const handleTemplateChange = (val: string) => {
    setSelectedTemplate(val);
    if (val === 'Blank') {
      setStages(['', '']);
      return;
    }
    const found = paths.find((p) => p.pathId === val);
    if (found && found.stages.length) {
      setStages([...found.stages]);
    } else {
      setStages(['', '']);
    }
  };

  const handleSubmit = async () => {
    setErr('');
    const cleanStages = stages.filter(Boolean);
    if (!title.trim() || !cleanStages.length) {
      setErr('Add a title and at least one stage.');
      return;
    }
    if (!dueAt) {
      setErr('Choose a due date.');
      return;
    }
    if (repeatMode === 'daily' && !dueTime) {
      setErr('Set a due time for daily repeated tasks.');
      return;
    }
    setBusy(true);
    try {
      await onCreateTask({
        title: title.trim(),
        branch,
        location,
        priority,
        dueAt,
        dueTime: repeatMode === 'daily' ? dueTime : dueTime || '',
        repeatMode,
        path: cleanStages,
        pathId: selectedTemplate === 'Blank' ? '' : selectedTemplate,
      });
      setTitle('');
      setStages(['', '']);
      setSelectedTemplate('Blank');
      setDueAt(dayOffset(-5));
      setRepeatMode('none');
      setDueTime('18:00');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTemplate = async () => {
    const cleanStages = stages.filter(Boolean);
    if (!tplName.trim() || !cleanStages.length) {
      setErr('Enter a template name and select at least one stage.');
      return;
    }
    setBusy(true);
    try {
      await onSaveTemplate(tplName.trim(), cleanStages);
      setTplName('');
      setShowSaveTpl(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view on" id="v-flow">
      <div className="glass sec" style={{ marginTop: 0 }}>
        <h3>Create task &amp; process path</h3>
        <div className="row">
          <div>
            <label htmlFor="ft">Title</label>
            <input
              id="ft"
              placeholder="e.g. Dispatch report – Plant 1"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErr('');
              }}
            />
          </div>
          <div>
            <label htmlFor="fb">Branch</label>
            <select id="fb" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fl">Location</label>
            <select id="fl" value={location} onChange={(e) => setLocation(e.target.value)}>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fp">Importance</label>
            <select
              id="fp"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
          <div>
            <label htmlFor="fdue">Due date</label>
            <input
              id="fdue"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="frep">Repeated due date</label>
            <select
              id="frep"
              value={repeatMode}
              onChange={(e) => {
                const mode = e.target.value as RepeatMode;
                setRepeatMode(mode);
                if (mode === 'daily') {
                  setDueAt(nextDailyRunDate(todayStr(), location, holidays, true));
                  if (!dueTime) setDueTime('18:00');
                }
                setErr('');
              }}
            >
              <option value="none">One-time (does not repeat)</option>
              <option value="daily">Daily (except Sunday &amp; holidays)</option>
            </select>
          </div>
          <div>
            <label htmlFor="ftime">
              Due time{repeatMode === 'daily' ? ' (daily cutoff)' : ' (optional)'}
            </label>
            <input
              id="ftime"
              type="time"
              value={dueTime}
              onChange={(e) => {
                setDueTime(e.target.value);
                setErr('');
              }}
            />
          </div>
        </div>

        {dailySchedulePreview && (
          <div
            className="sub"
            style={{
              marginTop: 8,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--bd)',
              background: 'rgba(255,255,255,.45)',
            }}
          >
            <b>Daily schedule active:</b> Runs every working day at{' '}
            <b>{dueTime || '18:00'}</b>, automatically skipping <b>Sundays</b> and any date on
            the <b>Holiday calendar</b> for {location}.
            {dailySchedulePreview.skippedNotice && (
              <div style={{ color: 'var(--org)', marginTop: 3 }}>
                {dailySchedulePreview.skippedNotice}
              </div>
            )}
            <div style={{ marginTop: 3 }}>
              Upcoming runs: <b>{dailySchedulePreview.upcoming.join(' · ')}</b>
            </div>
          </div>
        )}

        <label htmlFor="tp">Start from a template</label>
        <select
          id="tp"
          value={selectedTemplate}
          onChange={(e) => handleTemplateChange(e.target.value)}
        >
          <option value="Blank">Blank</option>
          {paths.map((p) => (
            <option key={p.pathId} value={p.pathId}>
              {p.name}
            </option>
          ))}
        </select>

        <label>
          Process path (stages in order — each stage hands over to the next when marked done)
        </label>
        <div className="row" id="stg">
          {stages.map((st, idx) => (
            <div key={idx}>
              <label>Level {idx + 1}</label>
              <select
                value={st}
                onChange={(e) => {
                  const next = [...stages];
                  next[idx] = e.target.value;
                  setStages(next);
                  setErr('');
                }}
              >
                <option value="" />
                {employeeNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {err && <div className="er">{err}</div>}

        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn g"
            id="as"
            type="button"
            disabled={stages.length >= 12}
            onClick={() => setStages([...stages, ''])}
          >
            + Add stage
          </button>
          {isAdmin && (
            <button
              className="btn g"
              type="button"
              onClick={() => setShowSaveTpl((v) => !v)}
            >
              Save path as template
            </button>
          )}
          <button
            className="btn o"
            id="ct"
            type="button"
            disabled={busy}
            onClick={handleSubmit}
          >
            {busy ? 'Creating...' : 'Create task'}
          </button>
        </div>

        {showSaveTpl && isAdmin && (
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>Template name</label>
              <input
                placeholder="e.g. Monthly stock audit"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
              />
            </div>
            <div style={{ flex: 0 }}>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={handleSaveTemplate}
              >
                Save template
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
