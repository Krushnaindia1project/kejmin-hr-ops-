import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AttendanceRecord,
  AttendanceSettings,
  DirectoryEntry,
  Holiday,
  ScoreEvent,
  UserPrivate,
} from '../types';
import { calcAttendanceStats, round1, todayStr } from '../utils/crypto';

interface ProfileViewProps {
  me: DirectoryEntry;
  myPrivate: UserPrivate | null;
  directory: DirectoryEntry[];
  scoreEvents: ScoreEvent[];
  attendance: AttendanceRecord[];
  holidays: Holiday[];
  settings: AttendanceSettings;
  activityFeed: Array<{ date: string; text: string }>;
  onSaveProfile: (name: string, phone: string, designation: string) => Promise<void>;
  onUploadPhoto: (dataUrl: string) => Promise<void>;
  onRemovePhoto: () => Promise<void>;
  onChangePassword: (currentPw: string, newPw: string) => Promise<{ ok: boolean; error?: string }>;
  onToast: (m: string) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  me,
  myPrivate,
  directory,
  scoreEvents,
  attendance,
  holidays,
  settings,
  activityFeed,
  onSaveProfile,
  onUploadPhoto,
  onRemovePhoto,
  onChangePassword,
  onToast,
}) => {
  const [tab, setTab] = useState<'d' | 's' | 'a'>('d');
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(myPrivate?.phone || '');
  const [designation, setDesignation] = useState(me.designation || '');
  const [busy, setBusy] = useState(false);

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwErr, setPwErr] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(me.name);
    setDesignation(me.designation || '');
  }, [me.name, me.designation]);

  useEffect(() => {
    setPhone(myPrivate?.phone || '');
  }, [myPrivate?.phone]);

  const myScores = useMemo(
    () => scoreEvents.filter((ev) => ev.employeeName === me.name),
    [scoreEvents, me.name]
  );

  const myAttPct = useMemo(() => {
    const td = todayStr();
    const map: Record<string, AttendanceRecord> = {};
    attendance
      .filter((r) => r.employeeName === me.name)
      .forEach((r) => {
        map[r.date] = r;
      });
    return calcAttendanceStats(
      map,
      me.joinedAt,
      me.location,
      `${td.slice(0, 7)}-01`,
      td,
      settings,
      holidays
    ).pct;
  }, [attendance, me, settings, holidays]);

  const recentItems = useMemo(() => {
    const items: Array<[string, string]> = [
      ...activityFeed
        .filter((a) => a.text.includes(me.name))
        .map((a): [string, string] => [a.date, a.text]),
      ...myScores.map((ev): [string, string] => [
        ev.date,
        ev.points >= 0 ? `Earned ${ev.points} points` : `Reversed ${ev.points} points`,
      ]),
    ];
    return items.sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8);
  }, [activityFeed, myScores, me.name]);

  const pwStrength =
    Number(newPw.length >= 6) +
    Number(newPw.length >= 10) +
    Number(/[a-z]/.test(newPw) && /[A-Z]/.test(newPw)) +
    Number(/\d/.test(newPw) && /[^\w]/.test(newPw));

  const pwBarColor =
    pwStrength < 2 ? 'var(--red)' : pwStrength < 3 ? 'var(--org)' : 'var(--blue)';

  const handleSaveDetails = async () => {
    const clean = name.trim();
    const taken = directory.some(
      (d) => d.name.toLowerCase() === clean.toLowerCase() && d.empId !== me.empId
    );
    if (!clean || taken) {
      onToast('Enter a unique name');
      return;
    }
    setBusy(true);
    try {
      await onSaveProfile(clean, phone, designation);
      onToast('Profile saved');
    } finally {
      setBusy(false);
    }
  };

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      onToast('Please choose an image file');
      return;
    }
    if (f.size > 5 * 1048576) {
      onToast('That image is larger than 5 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = async () => {
        const S = 256;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const g = c.getContext('2d');
        if (!g) return;
        const m = Math.min(im.width, im.height);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, S, S);
        g.drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, S, S);
        const dataUrl = c.toDataURL('image/jpeg', 0.85);
        await onUploadPhoto(dataUrl);
        onToast('Profile picture updated');
      };
      im.onerror = () => onToast('That image could not be read');
      im.src = String(reader.result || '');
    };
    reader.onerror = () => onToast('That image could not be read');
    reader.readAsDataURL(f);
  };

  const handlePasswordSubmit = async () => {
    setPwErr('');
    if (newPw.length < 6) return setPwErr('New password needs 6 or more characters.');
    if (newPw !== confPw) return setPwErr('New passwords do not match.');
    setBusy(true);
    try {
      const res = await onChangePassword(curPw, newPw);
      if (!res.ok) {
        setPwErr(res.error || 'Could not update password.');
        return;
      }
      setCurPw('');
      setNewPw('');
      setConfPw('');
      onToast('Password updated');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view on" id="v-prof">
      <div className="pban">
        <div className="pcov" />
        <div className="phd">
          <div
            className={`av pav2${me.photoUrl ? ' ph' : ''}`}
            id="pav"
            style={{
              backgroundImage: me.photoUrl ? `url("${me.photoUrl}")` : undefined,
            }}
          >
            {me.name[0]}
          </div>
          <div>
            <div className="pnm" id="pnm">
              {me.name}
            </div>
            <div className="sub" id="prl">
              {me.role} · {me.location}
              {me.branch && me.branch !== 'All' ? ` · ${me.branch}` : ''}
              {me.designation ? ` · ${me.designation}` : ''}
            </div>
            <div className="pph-act">
              <button
                className="btn g"
                id="pphb"
                type="button"
                onClick={() => fileRef.current?.click()}
              >
                Upload photo
              </button>
              <button
                className="btn g"
                id="pphr"
                type="button"
                disabled={!me.photoUrl}
                onClick={async () => {
                  await onRemovePhoto();
                  onToast('Profile picture removed');
                }}
              >
                Remove
              </button>
            </div>
            <div className="sub" style={{ marginTop: 6, fontSize: 12 }}>
              JPG or PNG up to 5 MB. It is cropped to a square.
            </div>
            <input
              ref={fileRef}
              type="file"
              id="pphf"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhotoFile}
            />
          </div>
        </div>
      </div>

      <div className="grid pst" id="pst">
        {(
          [
            ['Stages completed', myScores.filter((e) => e.points > 0).length],
            ['Total points', round1(myScores.reduce((s, e) => s + e.points, 0))],
            ['Attendance this month', `${myAttPct}%`],
            ['Member since', me.joinedAt || '-'],
          ] as Array<[string, string | number]>
        ).map(([label, val], idx) => (
          <div key={label} className="glass card" style={{ animationDelay: `${idx * 0.07}s` }}>
            <div className="sub">{label}</div>
            <div
              className="big"
              style={idx === 3 ? { fontSize: 20, paddingTop: 6 } : undefined}
            >
              {val}
            </div>
          </div>
        ))}
      </div>

      <div className="tabs" id="ptabs">
        <span className={tab === 'd' ? 'on' : ''} onClick={() => setTab('d')}>
          Details
        </span>
        <span className={tab === 's' ? 'on' : ''} onClick={() => setTab('s')}>
          Security
        </span>
        <span className={tab === 'a' ? 'on' : ''} onClick={() => setTab('a')}>
          Activity
        </span>
      </div>

      <div className="g2 pg" style={{ marginTop: 0 }}>
        {tab === 'd' && (
          <div className="glass sec" id="pt-d">
            <h3>Personal details</h3>
            <div className="fg">
              <div>
                <label htmlFor="pid">User ID (locked)</label>
                <input id="pid" disabled value={me.empId} />
              </div>
              <div>
                <label htmlFor="pn">Full name</label>
                <input id="pn" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pph">Phone</label>
                <input id="pph" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pds">Designation</label>
                <input
                  id="pds"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="pbr">Branch (set by admin)</label>
                <input id="pbr" disabled value={me.branch || 'All'} />
              </div>
              <div>
                <label htmlFor="plo">Location (set by admin)</label>
                <input id="plo" disabled value={me.location} />
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                className="btn"
                id="psv"
                type="button"
                disabled={busy}
                onClick={handleSaveDetails}
              >
                Save changes
              </button>
            </div>
          </div>
        )}

        {tab === 's' && (
          <div className="glass sec" id="pt-s">
            <h3>Change password</h3>
            <div className="sub" style={{ marginBottom: 6 }}>
              Use at least 6 characters. Mix upper and lower case, numbers and symbols for a
              stronger password.
            </div>
            <label htmlFor="pc0">Current password</label>
            <input
              type="password"
              id="pc0"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
            />
            <label htmlFor="pc1">New password</label>
            <input
              type="password"
              id="pc1"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
            <div className="bar" style={{ marginTop: 8 }}>
              <i
                style={{
                  animation: 'none',
                  width: `${pwStrength * 25}%`,
                  background: pwBarColor,
                }}
              />
            </div>
            <label htmlFor="pc2">Confirm new password</label>
            <input
              type="password"
              id="pc2"
              value={confPw}
              onChange={(e) => setConfPw(e.target.value)}
            />
            <div id="pmsg">{pwErr && <div className="er">{pwErr}</div>}</div>
            <div style={{ marginTop: 14 }}>
              <button
                className="btn"
                id="ppw"
                type="button"
                disabled={busy}
                onClick={handlePasswordSubmit}
              >
                Update password
              </button>
            </div>
          </div>
        )}

        {tab === 'a' && (
          <div className="glass sec" id="pt-a">
            <h3>Recent activity</h3>
            <div id="pact">
              {recentItems.length ? (
                <div className="tl">
                  {recentItems.map(([d, text], idx) => (
                    <div key={idx} className="d">
                      <b>{text}</b>
                      <div className="sub">{d}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sub">No activity yet.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
