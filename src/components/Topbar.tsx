import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DirectoryEntry, NotificationDoc, ViewId } from '../types';

interface TopbarProps {
  me: DirectoryEntry;
  activeView: ViewId;
  mobileOpen: boolean;
  notifications: NotificationDoc[];
  onToggleMobile: () => void;
  onNavigate: (v: ViewId) => void;
  onMarkRead: (notifId: string) => Promise<void> | void;
  onMarkAllRead: (notifIds: string[]) => Promise<void> | void;
}

const VIEW_TITLES: Record<ViewId, string> = {
  dash: 'KEJMIN OPS',
  tasks: 'Tasks',
  share: 'Share Folder',
  att: 'Attendance',
  flow: 'Workflow Builder',
  kpi: 'KPI & Scores',
  tickets: 'Tickets',
  rep: 'Reports',
  roles: 'Roles & Access',
  usr: 'User Management',
  prof: 'My Profile',
  log: 'Activity Log',
  blue: 'Blueprint',
};

type AlertTab = 'all' | 'unread' | 'read';

const TYPE_META: Record<NotificationDoc['type'], { label: string; cls: string }> = {
  assigned: { label: 'Assigned', cls: 't-assigned' },
  sendback: { label: 'Sent back', cls: 't-sendback' },
  reminder: { label: 'Reminder', cls: 't-reminder' },
  overdue: { label: 'Overdue', cls: 't-overdue' },
  escalation: { label: 'Escalation', cls: 't-escalation' },
};

function formatAlertTime(ts?: NotificationDoc['createdAt']): string {
  if (!ts) return 'Just now';
  try {
    const d = ts.toDate();
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const datePart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
  } catch {
    return '';
  }
}

export const Topbar: React.FC<TopbarProps> = ({
  me,
  activeView,
  mobileOpen,
  notifications,
  onToggleMobile,
  onNavigate,
  onMarkRead,
  onMarkAllRead,
}) => {
  const [showNotifs, setShowNotifs] = useState(false);
  const [activeTab, setActiveTab] = useState<AlertTab>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const myNotifs = useMemo(
    () =>
      notifications
        .filter((n) => n.recipientName === me.name)
        .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)),
    [notifications, me.name]
  );

  const unreadNotifs = useMemo(() => myNotifs.filter((n) => !n.read), [myNotifs]);
  const unreadCount = unreadNotifs.length;
  const readCount = myNotifs.length - unreadCount;

  const filteredNotifs = useMemo(() => {
    if (activeTab === 'unread') return unreadNotifs;
    if (activeTab === 'read') return myNotifs.filter((n) => n.read);
    return myNotifs;
  }, [activeTab, myNotifs, unreadNotifs]);

  // Close popup on Escape key
  useEffect(() => {
    if (!showNotifs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotifs(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNotifs]);

  const openAlerts = () => {
    setActiveTab(unreadCount > 0 ? 'unread' : 'all');
    setShowNotifs(true);
  };

  const handleMarkSingle = async (notifId: string) => {
    setBusyId(notifId);
    try {
      await onMarkRead(notifId);
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkAll = async () => {
    if (unreadCount === 0) return;
    setMarkingAll(true);
    try {
      await onMarkAllRead(unreadNotifs.map((n) => n.notifId));
    } finally {
      setMarkingAll(false);
    }
  };

  const handleOpenTaskFromAlert = async (n: NotificationDoc) => {
    if (!n.read) {
      await handleMarkSingle(n.notifId);
    }
    setShowNotifs(false);
    onNavigate(n.taskId.startsWith('tkt_') ? 'tickets' : 'tasks');
  };

  const countLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <>
      <div className="top glass">
        <div className="top-l" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            className="btn g"
            id="mnu"
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="sidenav"
            onClick={onToggleMobile}
          >
            <svg className="mnu-ic" viewBox="0 0 24 24" aria-hidden="true">
              {mobileOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
            <span className="mnu-lbl">Menu</span>
          </button>
          <div className="top-d-title">
            <b id="wl">Welcome, {me.name}</b>
            <div className="sub" id="wr">
              {me.role} · {me.location}
            </div>
          </div>
          <div className="top-m-title m-only">
            <b>{VIEW_TITLES[activeView]}</b>
            <div className="sub">
              {me.name} · {me.location}
            </div>
          </div>
        </div>

        <div className="top-r" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            className={`al-btn${unreadCount > 0 ? ' unread' : ''}`}
            aria-label={
              unreadCount > 0
                ? `Alerts, ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
                : 'Alerts, no unread notifications'
            }
            title={
              unreadCount > 0
                ? `${unreadCount} unread alert${unreadCount === 1 ? '' : 's'}`
                : 'Alerts'
            }
            onClick={openAlerts}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            <span className="al-lbl">Alerts</span>
            {unreadCount > 0 && <span className="al-count">{countLabel}</span>}
          </button>

          <span className="tag Low" id="loc">
            {me.location}
          </span>
          <div
            className={`av${me.photoUrl ? ' ph' : ''}`}
            id="av"
            style={{
              cursor: 'pointer',
              backgroundImage: me.photoUrl ? `url("${me.photoUrl}")` : undefined,
            }}
            onClick={() => onNavigate('prof')}
          >
            {me.name[0]}
          </div>
        </div>
      </div>

      {showNotifs &&
        createPortal(
          <div
            className="ov"
            role="dialog"
            aria-modal="true"
            aria-labelledby="al-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowNotifs(false);
            }}
          >
            <div className="md al-modal">
              <div className="al-hd">
                <div className="al-hd-copy">
                  <h3 className="al-title" id="al-modal-title">
                    Alerts &amp; Notifications
                  </h3>
                  <div className="al-sub">
                    {unreadCount > 0
                      ? `${unreadCount} unread · ${myNotifs.length} total`
                      : myNotifs.length > 0
                      ? `All caught up · ${myNotifs.length} total`
                      : 'No alerts yet'}
                  </div>
                </div>
                <div className="al-hd-acts">
                  <button
                    type="button"
                    className="al-icon-close"
                    aria-label="Close alerts"
                    onClick={() => setShowNotifs(false)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="al-bar">
                <div className="al-seg" role="tablist" aria-label="Filter alerts">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'all'}
                    className={activeTab === 'all' ? 'on' : ''}
                    onClick={() => setActiveTab('all')}
                  >
                    All ({myNotifs.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'unread'}
                    className={activeTab === 'unread' ? 'on' : ''}
                    onClick={() => setActiveTab('unread')}
                  >
                    Unread ({unreadCount})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'read'}
                    className={activeTab === 'read' ? 'on' : ''}
                    onClick={() => setActiveTab('read')}
                  >
                    Read ({readCount})
                  </button>
                </div>

                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="al-markall"
                    disabled={markingAll}
                    onClick={() => void handleMarkAll()}
                  >
                    {markingAll ? 'Marking...' : 'Mark all read'}
                  </button>
                )}
              </div>

              <div className="al-body">
                {filteredNotifs.length === 0 ? (
                  <div className="al-empty">
                    <div className="al-empty-ic" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 01-3.46 0" />
                      </svg>
                    </div>
                    <div className="al-empty-t">
                      {activeTab === 'unread'
                        ? 'No unread alerts'
                        : activeTab === 'read'
                        ? 'No read alerts yet'
                        : 'No notifications yet'}
                    </div>
                    <div className="al-empty-s">
                      {activeTab === 'unread'
                        ? 'Everything is read and your Alerts button has returned to normal.'
                        : 'Task assignments, send-backs, and due reminders will appear here.'}
                    </div>
                  </div>
                ) : (
                  filteredNotifs.slice(0, 40).map((n) => {
                    const meta = TYPE_META[n.type] || TYPE_META.assigned;
                    const isBusy = busyId === n.notifId || markingAll;
                    return (
                      <div key={n.notifId} className={`al-row ${n.read ? 'read' : 'unread'}`}>
                        <div className="al-row-main">
                          <div className="al-row-top">
                            <span className="al-row-title">{n.title}</span>
                          </div>
                          <div className="al-meta">
                            <span className={`al-type ${meta.cls}`}>{meta.label}</span>
                            <span aria-hidden="true">&middot;</span>
                            <span>{formatAlertTime(n.createdAt)}</span>
                          </div>
                          <div className="al-msg">{n.message}</div>
                        </div>
                        <div className="al-row-acts">
                          {n.taskId && (
                            <button
                              type="button"
                              className="al-act"
                              disabled={isBusy}
                              onClick={() => void handleOpenTaskFromAlert(n)}
                            >
                              {n.taskId.startsWith('tkt_') ? 'Open ticket' : 'Open task'}
                            </button>
                          )}
                          {!n.read ? (
                            <button
                              type="button"
                              className="al-act primary"
                              disabled={isBusy}
                              onClick={() => void handleMarkSingle(n.notifId)}
                            >
                              {busyId === n.notifId ? 'Saving...' : 'Mark read'}
                            </button>
                          ) : (
                            <span className="al-read-lbl">Read</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="al-foot">
                <span>Showing {Math.min(filteredNotifs.length, 40)} of {filteredNotifs.length}</span>
                <button
                  type="button"
                  className="btn g"
                  style={{ padding: '7px 14px', fontSize: 12.5 }}
                  onClick={() => setShowNotifs(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
