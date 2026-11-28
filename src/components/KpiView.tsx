import React, { useMemo, useState } from 'react';
import { DirectoryEntry, ScoreEvent } from '../types';
import { dayOffset, pad, round1 } from '../utils/crypto';

interface KpiViewProps {
  me: DirectoryEntry;
  canSeeAll: boolean;
  scoreEvents: ScoreEvent[];
}

export const KpiView: React.FC<KpiViewProps> = ({ me, canSeeAll, scoreEvents }) => {
  const [fromDate, setFromDate] = useState(() => dayOffset(30));
  const [toDate, setToDate] = useState(() => dayOffset(0));

  const setPreset = (mode: 'm' | 'fy') => {
    const now = new Date();
    setToDate(dayOffset(0));
    if (mode === 'm') {
      setFromDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
    } else {
      const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      setFromDate(`${fyYear}-04-01`);
    }
  };

  const rankings = useMemo(() => {
    const totals: Record<string, number> = {};
    scoreEvents
      .filter(
        (ev) =>
          ev.date >= fromDate &&
          ev.date <= toDate &&
          (canSeeAll || ev.employeeName === me.name)
      )
      .forEach((ev) => {
        totals[ev.employeeName] = round1((totals[ev.employeeName] || 0) + ev.points);
      });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [scoreEvents, fromDate, toDate, canSeeAll, me.name]);

  const maxPts = Math.max(1, rankings[0]?.[1] || 1);

  return (
    <div className="view on" id="v-kpi">
      <div className="glass sec" style={{ marginTop: 0 }}>
        <h3>Performance scores</h3>
        <div className="row">
          <div>
            <label htmlFor="d1">From</label>
            <input
              type="date"
              id="d1"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="d2">To</label>
            <input
              type="date"
              id="d2"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 0 }}>
            <button className="btn g" type="button" onClick={() => setPreset('m')}>
              This month
            </button>
          </div>
          <div style={{ flex: 0 }}>
            <button className="btn g" type="button" onClick={() => setPreset('fy')}>
              Financial year
            </button>
          </div>
        </div>

        <div className="sub" style={{ margin: '10px 0' }}>
          Points per completed stage: Low = 1 · Medium = 3 · High = 5 (×1.5 bonus if on time)
        </div>

        <div className="tbl m-card-tbl">
          <table id="kt">
            <thead>
              <tr>
                <th>#</th>
                <th>Employee</th>
                <th>Score</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {rankings.length === 0 ? (
                <tr>
                  <td colSpan={4}>No scores in this range.</td>
                </tr>
              ) : (
                rankings.map(([name, pts], idx) => (
                  <tr key={name}>
                    <td data-label="Rank">#{idx + 1}</td>
                    <td data-label="Employee">
                      <b>{name}</b>
                    </td>
                    <td data-label="Score">{pts}</td>
                    <td data-label="Progress">
                      <div className="bar">
                        <i style={{ width: `${Math.max(0, (pts / maxPts) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
