import React, { useEffect, useRef, useState } from 'react';
import { DirectoryEntry, ViewId } from '../types';

interface SidebarProps {
  me: DirectoryEntry;
  canManageUsers: boolean;
  activeView: ViewId;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onNavigate: (view: ViewId) => void;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  me,
  canManageUsers,
  activeView,
  mobileOpen,
  onCloseMobile,
  onNavigate,
  onLogout,
}) => {
  const [retracted, setRetracted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kjsb') === '1';
    } catch {
      return false;
    }
  });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.body.classList.toggle('sb-c', retracted);
    try {
      localStorage.setItem('kjsb', retracted ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [retracted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    const onResize = () => {
      if (window.innerWidth > 980) onCloseMobile();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [onCloseMobile]);

  const isDev = me.role === 'Developer';
  const isCollapsedVisual = retracted && !hovered && !focused;

  const handleToggleRetract = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    setHovered(false);
    setFocused(false);
    setRetracted((r) => !r);
  };

  const clickNav = (v: ViewId) => {
    onNavigate(v);
    onCloseMobile();
  };

  return (
    <>
      <div id="scrim" className={mobileOpen ? 'on' : ''} onClick={onCloseMobile} />
      <aside
        ref={navRef}
        className={`glass${isCollapsedVisual ? ' cl' : ''}${mobileOpen ? ' open' : ''}`}
        id="sidenav"
        onMouseEnter={() => {
          if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
          setHovered(true);
        }}
        onMouseLeave={() => {
          if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
          leaveTimer.current = window.setTimeout(() => setHovered(false), 150);
        }}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!navRef.current?.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
          }
        }}
      >
        <div className="logo sbl" style={{ padding: '4px 8px 14px' }}>
          <div
            className={`lg${me.photoUrl ? ' ph' : ''}`}
            style={{
              width: 38,
              height: 38,
              backgroundImage: me.photoUrl ? `url("${me.photoUrl}")` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            KM
          </div>
          <div className="sbb">
            <b>KEJMIN OPS</b>
            <div className="sub">KEJ Mineral</div>
          </div>
          <button
            className="sbt"
            id="sbt"
            type="button"
            aria-label={retracted ? 'Keep menu open' : 'Retract menu'}
            aria-pressed={retracted}
            title={retracted ? 'Keep menu open' : 'Retract menu'}
            onClick={handleToggleRetract}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        </div>

        <div className={`nav${activeView === 'dash' ? ' on' : ''}`} data-v="dash" onClick={() => clickNav('dash')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span className="nt">Dashboard</span>
        </div>

        <div className={`nav${activeView === 'rep' ? ' on' : ''}`} data-v="rep" onClick={() => clickNav('rep')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h8l4 4v14H6z" />
            <path d="M14 3v4h4M9 13h6M9 17h6" />
          </svg>
          <span className="nt">Reports</span>
        </div>

        <div className={`nav${activeView === 'att' ? ' on' : ''}`} data-v="att" onClick={() => clickNav('att')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span className="nt">Attendance</span>
        </div>

        <div className={`nav${activeView === 'tasks' ? ' on' : ''}`} data-v="tasks" onClick={() => clickNav('tasks')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <path d="M3.5 6l1.5 1.5L7 5M3.5 12l1.5 1.5L7 11M3.5 18l1.5 1.5L7 17" />
          </svg>
          <span className="nt">Tasks</span>
        </div>

        <div className={`nav${activeView === 'share' ? ' on' : ''}`} data-v="share" onClick={() => clickNav('share')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            <path d="M12 11v5M9.5 13.5L12 11l2.5 2.5" />
          </svg>
          <span className="nt">Share Folder</span>
        </div>

        <div className={`nav${activeView === 'flow' ? ' on' : ''}`} data-v="flow" onClick={() => clickNav('flow')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="6" height="6" rx="1" />
            <rect x="15" y="15" width="6" height="6" rx="1" />
            <path d="M6 9v3a3 3 0 003 3h6" />
          </svg>
          <span className="nt">Workflow builder</span>
        </div>

        <div className={`nav${activeView === 'kpi' ? ' on' : ''}`} data-v="kpi" onClick={() => clickNav('kpi')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 20V11M12 20V4M19 20v-6" />
          </svg>
          <span className="nt">KPI &amp; scores</span>
        </div>

        <div className={`nav${activeView === 'roles' ? ' on' : ''}`} data-v="roles" onClick={() => clickNav('roles')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          </svg>
          <span className="nt">Roles &amp; access</span>
        </div>

        <div className={`nav${activeView === 'blue' ? ' on' : ''}`} data-v="blue" onClick={() => clickNav('blue')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l9 5-9 5-9-5z" />
            <path d="M3 13l9 5 9-5" />
          </svg>
          <span className="nt">Blueprint</span>
        </div>

        {canManageUsers && (
          <div className={`nav${activeView === 'usr' ? ' on' : ''}`} data-v="usr" id="nusr" onClick={() => clickNav('usr')}>
            <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
              <path d="M16 4.5a3.5 3.5 0 010 7M18 14c2 .7 3.5 2.6 3.5 6" />
            </svg>
            <span className="nt">User management</span>
          </div>
        )}

        {isDev && (
          <div className={`nav${activeView === 'log' ? ' on' : ''}`} data-v="log" id="nlog" onClick={() => clickNav('log')}>
            <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 9l3 3-3 3M12 16h5" />
            </svg>
            <span className="nt">Log</span>
          </div>
        )}

        <div className={`nav${activeView === 'prof' ? ' on' : ''}`} data-v="prof" onClick={() => clickNav('prof')}>
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
          </svg>
          <span className="nt">My profile</span>
        </div>

        <div style={{ flex: 1 }} />
        <button
          className="btn r"
          id="out"
          type="button"
          onClick={() => {
            onCloseMobile();
            onLogout();
          }}
        >
          <svg className="ni" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 4H5v16h5M16 8l4 4-4 4M20 12H9" />
          </svg>
          <span className="nt">Log out</span>
        </button>
      </aside>
    </>
  );
};
