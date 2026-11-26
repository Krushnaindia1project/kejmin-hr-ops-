import React, { useState } from 'react';
import { DirectoryEntry, NotificationDoc, ViewId } from '../types';

interface TopbarProps {
  me: DirectoryEntry;
  mobileOpen: boolean;
  notifications: NotificationDoc[];
  onToggleMobile: () => void;
  onNavigate: (v: ViewId) => void;
  onMarkRead: (notifId: string) => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  me,
  mobileOpen,
  notifications,
  onToggleMobile,
  onNavigate,
  onMarkRead,
}) => {
  const [showNotifs, setShowNotifs] = useState(false);

  const myNotifs = notifications
    .filter((n) => n.recipientName === me.name)
    .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
  const unreadCount = myNotifs.filter((n) => !n.read).length;

  return (
    <>
      <div className="top glass">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            className="btn g"
            id="mnu"
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="sidenav"
            onClick={onToggleMobile}
          >
            Menu
          </button>
          <div>
            <b id="wl">Welcome, {me.name}</b>
            <div className="sub" id="wr">
              {me.role} · {me.location}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {myNotifs.length > 0 && (
            <button
              className="btn g"
              type="button"
              style={{ padding: '6px 10px', fontSize: 12 }}
              onClick={() => setShowNotifs(true)}
              title="Notifications"
            >
              Alerts{unreadCount > 0 ? ` (${unreadCount})` : ''}
            </button>
          )}
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

      {showNotifs && (
        <div className="ov" onClick={(e) => e.target === e.currentTarget && setShowNotifs(false)}>
          <div className="md">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Notifications</h3>
              <button className="btn g" type="button" onClick={() => setShowNotifs(false)}>
                Close
              </button>
            </div>
            {myNotifs.length === 0 ? (
              <div className="sub">No notifications yet.</div>
            ) : (
              myNotifs.slice(0, 15).map((n) => (
                <div
                  key={n.notifId}
                  style={{
                    padding: '10px 0',
                    borderTop: '1px solid var(--bd)',
                    opacity: n.read ? 0.65 : 1,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <b>{n.title}</b>
                    {!n.read && (
                      <button
                        className="btn g"
                        type="button"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => onMarkRead(n.notifId)}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                  <div className="sub" style={{ marginTop: 4 }}>
                    {n.message}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
};
