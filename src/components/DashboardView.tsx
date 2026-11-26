import React from 'react';
import { DirectoryEntry, TaskDoc, ViewId } from '../types';
import { todayStr } from '../utils/crypto';
import { StrataArt } from './StrataArt';

interface DashboardViewProps {
  me: DirectoryEntry;
  myTasks: TaskDoc[];
  branches: string[];
  onNavigate: (v: ViewId) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  me,
  myTasks,
  branches,
  onNavigate,
}) => {
  const td = todayStr();
  const open = myTasks.filter((t) => t.stage < t.path.length);
  const done = myTasks.length - open.length;
  const highOpen = open.filter((t) => t.priority === 'High').length;
  const overdueCount = open.filter((t) => t.dueAt < td).length;
  const myTurnCount = open.filter((t) => t.path[t.stage] === me.name).length;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = me.name.split(' ')[0];

  const plural = (n: number) => `${n} task${n > 1 ? 's' : ''}`;
  const subtitle = myTurnCount
    ? `${myTurnCount > 1 ? `${myTurnCount} tasks are` : '1 task is'} waiting on you${
        overdueCount ? `, ${overdueCount} overdue on your list` : ''
      }.`
    : open.length
    ? `${plural(open.length)} in progress${
        overdueCount ? `, ${overdueCount} overdue` : ''
      }. Nothing is waiting on you.`
    : 'Every task is signed off.';

  const dateLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const statCards: Array<[string, number, string]> = [
    ['Total tasks', myTasks.length, ''],
    ['In progress', open.length, 'o'],
    ['Completed', done, ''],
    ['High priority open', highOpen, 'r'],
  ];

  return (
    <div className="view on" id="v-dash">
      <div className="dhero">
        <StrataArt />
        <div className="dcopy">
          <h2 id="dht">
            {greeting}, {firstName}
          </h2>
          <p id="dhs">{subtitle}</p>
          <div className="dd" id="dhd">
            {dateLabel}
          </div>
        </div>
      </div>

      <div className="grid" id="stats" onClick={() => onNavigate('tasks')}>
        {statCards.map(([label, val, cls], idx) => (
          <div
            key={label}
            className="glass card"
            style={{ animationDelay: `${idx * 0.08}s` }}
          >
            <div className="sub">{label}</div>
            <div className={`big ${cls}`}>{val}</div>
          </div>
        ))}
      </div>

      <div className="glass sec">
        <h3>Branch workload</h3>
        <div id="br">
          {branches.map((b) => {
            const count = myTasks.filter((t) => t.branch === b).length;
            const pct = myTasks.length ? (count / myTasks.length) * 100 : 0;
            return (
              <div
                key={b}
                style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0' }}
              >
                <span style={{ width: 150 }}>{b}</span>
                <div className="bar" style={{ flex: 1 }}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <b>{count}</b>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
