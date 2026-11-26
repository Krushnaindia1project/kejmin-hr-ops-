import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  auth,
  clearDriveAccessToken,
  googleProvider,
  setDriveAccessToken,
  trySilentGoogleDriveToken,
} from './firebase';
import {
  AttendanceRecord,
  AttendanceSettings,
  AuditLogEntry,
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_BRANCHES,
  DEFAULT_LOCATIONS,
  DirectoryEntry,
  Holiday,
  isDeveloperRole,
  NotificationDoc,
  OrgUnit,
  PERMISSIONS,
  Priority,
  RoleDefinition,
  ScoreEvent,
  SharedFileDoc,
  SharedFolderDoc,
  TaskDoc,
  UserPrivate,
  ViewId,
  WorkflowPath,
} from './types';
import {
  addHolidayRecord,
  adminCreateUser,
  adminDeleteUser,
  adminResetPassword,
  adminUpdateUser,
  advanceTaskStage,
  attachTaskProof,
  changeOwnPassword,
  clockInToday,
  clockOutToday,
  correctAttendanceRecord,
  createCustomRole,
  createSharedFileRecord,
  createSharedFolderRecord,
  createTask,
  deleteSharedFileRecord,
  deleteSharedFolderRecord,
  deleteTaskRecord,
  findDirectoryByAuthUid,
  getDirectoryList,
  getUserPrivateRecord,
  logAuditEvent,
  markNotificationRead,
  removeHolidayRecord,
  saveAttendanceSettings,
  saveWorkflowPathTemplate,
  seedOrganizationDataIfNeeded,
  sendBackTask,
  subscribeAuditLog,
  subscribeOrgData,
  syncDailyRecurringTasks,
  toggleBreakToday,
  updateOwnPhoto,
  updateOwnProfile,
  updateRoleRecord,
  updateSharedFileRecord,
  updateSharedFolderRecord,
  updateTaskDetails,
  verifyUserCredentials,
} from './services/firestoreService';
import { connectCompanyDriveOnServer, fetchCompanyDriveStatus } from './services/driveService';
import { todayStr } from './utils/crypto';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView } from './components/LoginView';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { DashboardView } from './components/DashboardView';
import { TasksView } from './components/TasksView';
import { ShareFolderView } from './components/ShareFolderView';
import { WorkflowBuilderView } from './components/WorkflowBuilderView';
import { KpiView } from './components/KpiView';
import { AttendanceView } from './components/AttendanceView';
import { ReportsView } from './components/ReportsView';
import { RolesView } from './components/RolesView';
import { UsersView } from './components/UsersView';
import { ProfileView } from './components/ProfileView';
import { LogView } from './components/LogView';
import { BlueprintView } from './components/BlueprintView';

const DEFAULT_SETTINGS: AttendanceSettings = {
  settingId: 'attendance',
  wd: [1, 2, 3, 4, 5, 6],
  st: '09:30',
  en: '18:30',
  gr: 15,
  orgId: 'kejmin',
};

function KejminOpsApp() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [activeEmpId, setActiveEmpId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('kj');
    } catch {
      return null;
    }
  });
  const [signedOutBanner, setSignedOutBanner] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  // Firestore synced collections
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [branchesDocs, setBranchesDocs] = useState<OrgUnit[]>([]);
  const [locationsDocs, setLocationsDocs] = useState<OrgUnit[]>([]);
  const [paths, setPaths] = useState<WorkflowPath[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [scoreEvents, setScoreEvents] = useState<ScoreEvent[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [settings, setSettings] = useState<AttendanceSettings>(DEFAULT_SETTINGS);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [sharedFolders, setSharedFolders] = useState<SharedFolderDoc[]>([]);
  const [sharedFiles, setSharedFiles] = useState<SharedFileDoc[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [myPrivate, setMyPrivate] = useState<UserPrivate | null>(null);

  const [activeView, setActiveView] = useState<ViewId>('dash');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(null), 2400);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          await seedOrganizationDataIfNeeded(user);
        } catch (e) {
          console.error('Seeding check failed:', e);
        }
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const isBootstrapAdmin =
    !!firebaseUser &&
    firebaseUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
    firebaseUser.emailVerified;

  // Attach Firestore real-time listeners once Firebase Auth is ready & signed in
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setDirectory([]);
      setRoles([]);
      setTasks([]);
      setScoreEvents([]);
      setAttendance([]);
      setHolidays([]);
      setNotifications([]);
      setSharedFolders([]);
      setSharedFiles([]);
      setAuditLogs([]);
      return;
    }

    const unsub = subscribeOrgData(
      {
        onDirectory: setDirectory,
        onRoles: setRoles,
        onBranches: setBranchesDocs,
        onLocations: setLocationsDocs,
        onPaths: setPaths,
        onTasks: setTasks,
        onScoreEvents: setScoreEvents,
        onAttendance: setAttendance,
        onHolidays: setHolidays,
        onSettings: (s) => {
          if (s) setSettings(s);
        },
        onNotifications: setNotifications,
        onSharedFolders: setSharedFolders,
        onSharedFiles: setSharedFiles,
      },
      false
    );
    return () => unsub();
  }, [authReady, firebaseUser]);

  // Active KEJMIN OPS employee profile
  const me = useMemo(() => {
    if (!firebaseUser || !activeEmpId) return null;
    return directory.find((d) => d.empId === activeEmpId && d.active) || null;
  }, [firebaseUser, activeEmpId, directory]);

  // Load private record (phone/2FA) for active user when available
  useEffect(() => {
    if (!firebaseUser || !me) {
      setMyPrivate(null);
      return;
    }
    getUserPrivateRecord(me.empId)
      .then(setMyPrivate)
      .catch(() => setMyPrivate(null));
  }, [firebaseUser, me]);

  // Ensure Firebase Auth popup session before Firestore access
  const ensureFirebaseAuth = async (): Promise<User | null> => {
    if (auth.currentUser) {
      await seedOrganizationDataIfNeeded(auth.currentUser);
      return auth.currentUser;
    }
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      setDriveAccessToken(credential.accessToken, result.user.email);
      // If signed-in user is Developer and Company Drive was not explicitly disconnected, share session automatically
      const accessToken = credential.accessToken;
      const actorName = result.user.displayName || result.user.email || '';
      fetchCompanyDriveStatus()
        .then((status) => {
          if (!status.permanent && !status.manuallyDisconnected) {
            return connectCompanyDriveOnServer(accessToken, actorName).then(() => {
              window.dispatchEvent(new Event('kejmin-drive-status-updated'));
            });
          }
          return undefined;
        })
        .catch(() => {
          // Non-developer users receive 403 here, which is expected and silently ignored
        });
    }
    setFirebaseUser(result.user);
    await seedOrganizationDataIfNeeded(result.user);
    return result.user;
  };

  const handleSignIn = async (empId: string, password: string): Promise<string | null> => {
    setAuthBusy(true);
    try {
      const fbUser = await ensureFirebaseAuth();
      if (!fbUser) return 'Firebase authentication was cancelled.';

      const cleanId = empId.trim().toLowerCase();
      const res = await verifyUserCredentials(cleanId, password);
      if (!res.ok || !res.directory) {
        await logAuditEvent({
          actor: '(not signed in)',
          actorUserId: cleanId,
          category: 'Security',
          action: `failed sign-in attempt with user ID "${cleanId}"`,
          target: cleanId,
        }).catch(() => {});
        return res.reason || 'Incorrect user ID or password.';
      }

      try {
        localStorage.setItem('kj', res.directory.empId);
      } catch {
        // ignore
      }
      setActiveEmpId(res.directory.empId);
      setSignedOutBanner(false);
      setActiveView('dash');
      await logAuditEvent({
        actor: res.directory.name,
        actorUserId: res.directory.empId,
        category: 'Sign-in',
        action: 'signed in',
        target: res.directory.empId,
      });
      return null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('popup-closed-by-user') || msg.includes('cancelled-popup-request')) {
        return 'Google sign-in popup was closed before completing.';
      }
      return msg || 'Sign-in failed.';
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleQuickSignIn = async (): Promise<string | null> => {
    setAuthBusy(true);
    try {
      const fbUser = await ensureFirebaseAuth();
      if (!fbUser) return 'Firebase authentication was cancelled.';

      let match = await findDirectoryByAuthUid(fbUser.uid);
      if (!match && fbUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
        const list = await getDirectoryList();
        match = list.find((d) => d.empId === 'developer') || null;
      }

      if (!match) {
        return 'No KEJMIN OPS profile linked to this Google account yet. Ask an administrator to create your account.';
      }

      try {
        localStorage.setItem('kj', match.empId);
      } catch {
        // ignore
      }
      setActiveEmpId(match.empId);
      setSignedOutBanner(false);
      setActiveView('dash');
      await logAuditEvent({
        actor: match.name,
        actorUserId: match.empId,
        category: 'Sign-in',
        action: 'signed in with Google',
        target: match.empId,
      });
      return null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('popup-closed-by-user') || msg.includes('cancelled-popup-request')) {
        return 'Google sign-in popup was closed before completing.';
      }
      return msg || 'Google sign-in failed.';
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (me) {
      await logAuditEvent({
        actor: me.name,
        actorUserId: me.empId,
        category: 'Sign-in',
        action: 'signed out',
        target: me.empId,
      }).catch(() => {});
    }
    try {
      localStorage.removeItem('kj');
    } catch {
      // ignore
    }
    setActiveEmpId(null);
    setSignedOutBanner(true);
    clearDriveAccessToken();
    // Keep or clear Firebase auth session cleanly; if non-admin, sign out of Google too
    if (!isBootstrapAdmin) {
      await signOut(auth).catch(() => {});
    }
  };

  // Derived permissions & lists
  const branches = useMemo(
    () => (branchesDocs.length ? branchesDocs.filter((b) => b.active).map((b) => b.name) : DEFAULT_BRANCHES),
    [branchesDocs]
  );
  const locations = useMemo(
    () => (locationsDocs.length ? locationsDocs.filter((l) => l.active).map((l) => l.name) : DEFAULT_LOCATIONS),
    [locationsDocs]
  );

  const myRoleObj = useMemo(
    () => (me ? roles.find((r) => r.name === me.role) || null : null),
    [me, roles]
  );

  const isDev = !!me && isDeveloperRole(me.role);
  const isAdmin = !!me && (isDev || me.role === 'Company Owner');
  const myRolePermissions = useMemo(
    () => (isDev ? PERMISSIONS.map((_, idx) => idx) : myRoleObj?.permissions || []),
    [isDev, myRoleObj]
  );

  // Dedicated auditLog subscription for Developers (bootstrapped or assigned)
  useEffect(() => {
    if (!authReady || !firebaseUser || (!isBootstrapAdmin && !isDev)) {
      setAuditLogs([]);
      return;
    }
    const unsub = subscribeAuditLog(setAuditLogs);
    return () => unsub();
  }, [authReady, firebaseUser, isBootstrapAdmin, isDev]);

  // Keep Company Google Drive connected silently in the background for Developer sessions
  // until the Developer explicitly clicks Disconnect.
  useEffect(() => {
    if (!authReady || !firebaseUser || (!isBootstrapAdmin && !isDev)) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const ensureCompanyDriveSession = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const status = await fetchCompanyDriveStatus();
        if (cancelled || status.permanent || status.manuallyDisconnected) {
          return;
        }
        const expiresSoon =
          typeof status.expiresAt === 'number' &&
          status.expiresAt - Date.now() < 15 * 60 * 1000;
        if (status.connected && !expiresSoon) {
          return;
        }

        const hint = status.hintEmail || status.accountLabel || firebaseUser.email;
        const silentToken = await trySilentGoogleDriveToken(hint);
        if (!silentToken || cancelled) {
          return;
        }

        await connectCompanyDriveOnServer(
          silentToken,
          me?.name || firebaseUser.displayName || firebaseUser.email || 'Developer'
        );
        if (!cancelled) {
          window.dispatchEvent(new Event('kejmin-drive-status-updated'));
        }
      } catch {
        // Silent renewal failed quietly; user can still click Connect Company Drive manually
      } finally {
        inFlight = false;
      }
    };

    void ensureCompanyDriveSession();
    const interval = window.setInterval(() => {
      void ensureCompanyDriveSession();
    }, 3 * 60 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void ensureCompanyDriveSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [authReady, firebaseUser, isBootstrapAdmin, isDev, me?.name]);

  const canSeeAll =
    !!me &&
    (isDev ||
      ['Company Owner', 'Finalizer', 'Auditor'].includes(me.role) ||
      myRolePermissions.includes(3));
  const canSendBack =
    !!me &&
    (isDev ||
      ['Company Owner', 'Finalizer', 'Auditor'].includes(me.role) ||
      myRolePermissions.includes(2));
  const canManageRoles =
    !!me && (isDev || me.role === 'Company Owner' || myRolePermissions.includes(5));
  const canManageUsers =
    !!me && (isDev || me.role === 'Company Owner' || myRolePermissions.includes(6));
  const canCorrectAttendance = !!me && (isDev || myRolePermissions.includes(7));
  const canDeleteTasks = !!me && (isDev || myRolePermissions.includes(8));

  // Auto-run daily recurring tasks for today if today is not Sunday or a Holiday
  const lastDailySyncKeyRef = useRef('');
  useEffect(() => {
    if (!authReady || !firebaseUser || !me || tasks.length === 0) return;
    const dailySignature = tasks
      .filter((t) => t.repeatMode === 'daily')
      .map((t) => `${t.repeatSeriesId || t.taskId}:${t.dueAt}`)
      .sort()
      .join('|');
    if (!dailySignature) return;
    const syncKey = `${todayStr()}|${me.empId}|${holidays.length}|${dailySignature}`;
    if (lastDailySyncKeyRef.current === syncKey) return;
    lastDailySyncKeyRef.current = syncKey;
    syncDailyRecurringTasks({ tasks, holidays, actor: me }).catch((err) => {
      console.error('Daily recurring task sync failed:', err);
    });
  }, [authReady, firebaseUser, me, tasks, holidays]);

  const myTasks = useMemo(() => {
    if (!me) return [];
    const sorted = [...tasks].sort(
      (a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
    );
    return canSeeAll ? sorted : sorted.filter((t) => t.path.includes(me.name));
  }, [me, tasks, canSeeAll]);

  // Activity feed for Reports & Profile derived from real auditLog or recent scoreEvents
  const activityFeed = useMemo(() => {
    if (auditLogs.length) {
      return [...auditLogs]
        .sort((a, b) => (b.at?.toMillis() || 0) - (a.at?.toMillis() || 0))
        .slice(0, 30)
        .map((l) => ({
          date: l.at
            ? `${l.at.toDate().getFullYear()}-${String(l.at.toDate().getMonth() + 1).padStart(
                2,
                '0'
              )}-${String(l.at.toDate().getDate()).padStart(2, '0')}`
            : todayStr(),
          text: `${l.actor} ${l.action}`,
        }));
    }
    return [...scoreEvents]
      .sort((a, b) => (b.at?.toMillis() || 0) - (a.at?.toMillis() || 0))
      .slice(0, 20)
      .map((s) => ({
        date: s.date,
        text: `${s.employeeName}: ${s.reason} (${s.points >= 0 ? '+' : ''}${s.points} pts)`,
      }));
  }, [auditLogs, scoreEvents]);

  const handleNavigate = (v: ViewId) => {
    if (v === 'log' && !isDev) {
      setActiveView('dash');
      return;
    }
    if (v === 'usr' && !canManageUsers) {
      setActiveView('dash');
      return;
    }
    setActiveView(v);
  };

  // Loading state while checking auth / syncing directory for remembered session
  if (!authReady || (firebaseUser && activeEmpId && !me && directory.length === 0)) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div className="glass sec" style={{ margin: 0, textAlign: 'center', minWidth: 260 }}>
          <div className="logo" style={{ justifyContent: 'center' }}>
            <div className="lg">KM</div>
            <h1>
              KEJMIN <b>OPS</b>
            </h1>
          </div>
          <div className="sub" style={{ marginTop: 10 }}>
            Connecting to Firebase Firestore...
          </div>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !me) {
    return (
      <LoginView
        signedOutMessage={signedOutBanner}
        busy={authBusy}
        onSignIn={handleSignIn}
        onGoogleQuickSignIn={handleGoogleQuickSignIn}
      />
    );
  }

  return (
    <section id="app" style={{ display: 'block' }}>
      <Sidebar
        me={me}
        canManageUsers={canManageUsers}
        activeView={activeView}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />

      <main>
        <Topbar
          me={me}
          mobileOpen={mobileOpen}
          notifications={notifications}
          onToggleMobile={() => setMobileOpen((o) => !o)}
          onNavigate={handleNavigate}
          onMarkRead={(id) => {
            markNotificationRead(id).catch(() => {});
          }}
        />

        {activeView === 'dash' && (
          <DashboardView
            me={me}
            myTasks={myTasks}
            branches={branches}
            onNavigate={handleNavigate}
          />
        )}

        {activeView === 'tasks' && (
          <TasksView
            me={me}
            canSeeAll={canSeeAll}
            canSendBack={canSendBack}
            canDeleteTasks={canDeleteTasks}
            isAdmin={isAdmin}
            myTasks={myTasks}
            directory={directory}
            branches={branches}
            locations={locations}
            holidays={holidays}
            onNavigate={handleNavigate}
            onAdvance={async (task) => {
              const res = await advanceTaskStage({ task, actor: me, directory, holidays });
              showToast(
                res.nextScheduledDate
                  ? `Stage completed, +${res.pts} pts · Next daily run: ${res.nextScheduledDate}`
                  : `Stage completed, +${res.pts} points awarded`
              );
            }}
            onSendBack={async (task, reason) => {
              await sendBackTask({ task, reason, actor: me, directory, scoreEvents });
              showToast('Task sent back to the previous level');
            }}
            onEditTask={async (params) => {
              await updateTaskDetails({
                ...params,
                holidays,
                actor: me,
              });
              showToast('Task updated');
            }}
            onDeleteTask={async (task) => {
              await deleteTaskRecord({ task, actor: me });
              showToast('Task deleted');
            }}
            onAttachProof={async (task, file) => {
              await attachTaskProof({
                task,
                fileName: file.name,
                fileType: file.type,
                fileSizeBytes: file.size,
                actor: me,
              });
              showToast('Proof attached to task');
            }}
          />
        )}

        {activeView === 'share' && (
          <ShareFolderView
            me={me}
            firebaseUid={firebaseUser.uid}
            isAdmin={isAdmin}
            directory={directory}
            branches={branches}
            locations={locations}
            sharedFolders={sharedFolders}
            sharedFiles={sharedFiles}
            onCreateFolderRecord={(params) =>
              createSharedFolderRecord({ ...params, actor: me })
            }
            onUpdateFolderRecord={(params) =>
              updateSharedFolderRecord({ ...params, actor: me })
            }
            onDeleteFolderRecord={(folder) =>
              deleteSharedFolderRecord({ folder, actor: me })
            }
            onCreateFileRecord={(params) =>
              createSharedFileRecord({ ...params, actor: me })
            }
            onUpdateFileRecord={(params) =>
              updateSharedFileRecord({ ...params, actor: me })
            }
            onDeleteFileRecord={(file, removedFromDrive) =>
              deleteSharedFileRecord({ file, removedFromDrive, actor: me })
            }
            onToast={showToast}
          />
        )}

        {activeView === 'flow' && (
          <WorkflowBuilderView
            directory={directory}
            branches={branches}
            locations={locations}
            holidays={holidays}
            paths={paths}
            isAdmin={isAdmin}
            onCreateTask={async (params) => {
              const created = await createTask({ ...params, holidays, actor: me });
              showToast(
                params.repeatMode === 'daily'
                  ? `Daily task scheduled for ${created.effectiveDueAt}${params.dueTime ? ` at ${params.dueTime}` : ''} (excl. Sun & holidays)`
                  : 'Task created'
              );
              setActiveView('tasks');
            }}
            onSaveTemplate={async (name, stages) => {
              await saveWorkflowPathTemplate({ name, stages, actor: me });
              showToast('Workflow template saved');
            }}
          />
        )}

        {activeView === 'kpi' && (
          <KpiView me={me} canSeeAll={canSeeAll} scoreEvents={scoreEvents} />
        )}

        {activeView === 'att' && (
          <AttendanceView
            me={me}
            canSeeTeam={canSeeAll}
            canCorrectAttendance={canCorrectAttendance}
            isAdmin={isAdmin}
            directory={directory}
            attendance={attendance}
            holidays={holidays}
            settings={settings}
            locations={locations}
            onClockIn={async () => {
              const t = await clockInToday(me);
              showToast(`Clocked in at ${t}`);
            }}
            onToggleBreak={async (rec) => {
              const res = await toggleBreakToday(rec, me);
              showToast(res.started ? `Break started at ${res.time}` : `Break ended at ${res.time}`);
            }}
            onClockOut={async (rec, workedLabel) => {
              const t = await clockOutToday(rec, me, workedLabel);
              showToast(`Clocked out at ${t}`);
            }}
            onCorrectAttendance={async (params) => {
              await correctAttendanceRecord({ ...params, actor: me });
              showToast('Attendance correction saved');
            }}
            onSaveSettings={async (next) => {
              await saveAttendanceSettings(next, settings, me);
              showToast('Attendance settings saved');
            }}
            onAddHoliday={async (date, name, location) => {
              await addHolidayRecord({ date, name, location, actor: me });
              showToast('Holiday added');
            }}
            onRemoveHoliday={async (holiday) => {
              await removeHolidayRecord(holiday, me);
              showToast('Holiday removed');
            }}
          />
        )}

        {activeView === 'rep' && (
          <ReportsView
            me={me}
            canSeeAll={canSeeAll}
            directory={directory}
            branches={branches}
            locations={locations}
            myTasks={myTasks}
            scoreEvents={scoreEvents}
            attendance={attendance}
            holidays={holidays}
            settings={settings}
            auditLogs={auditLogs}
            onExportCsv={(meta) => {
              logAuditEvent({
                actor: me.name,
                actorUserId: me.empId,
                category: 'Export',
                action: `exported Excel report · ${meta}`,
              }).catch(() => {});
              showToast('Excel report downloaded');
            }}
            onPrint={() => {
              logAuditEvent({
                actor: me.name,
                actorUserId: me.empId,
                category: 'Export',
                action: 'printed a report',
              }).catch(() => {});
            }}
          />
        )}

        {activeView === 'roles' && (
          <RolesView
            me={me}
            canManageRoles={canManageRoles}
            myRolePermissions={myRolePermissions}
            roles={roles}
            branches={branches}
            locations={locations}
            onCreateRole={async (params) => {
              await createCustomRole({
                ...params,
                permNames: params.permissions.map((i) => PERMISSIONS[i]),
                actor: me,
                actorPermissions: myRolePermissions,
              });
            }}
            onUpdateRole={async (params) => {
              await updateRoleRecord({
                ...params,
                directory,
                actor: me,
                actorPermissions: myRolePermissions,
              });
            }}
            onToast={showToast}
          />
        )}

        {activeView === 'usr' && canManageUsers && (
          <UsersView
            me={me}
            directory={directory}
            roles={roles}
            branches={branches}
            locations={locations}
            tasks={tasks}
            onCreateUser={async (params) => {
              await adminCreateUser({ ...params, actor: me });
              showToast(`User @${params.empId} created`);
            }}
            onUpdateUser={async (params) => {
              await adminUpdateUser({ ...params, tasks, directory, actor: me });
              showToast('User updated');
            }}
            onResetPassword={async (target, newPassword) => {
              await adminResetPassword({ target, newPassword, actor: me });
              showToast(`Password reset for ${target.name}`);
            }}
            onDeleteUser={async (target) => {
              await adminDeleteUser({ target, directory, actor: me });
              showToast('User deleted');
            }}
          />
        )}

        {activeView === 'prof' && (
          <ProfileView
            me={me}
            myPrivate={myPrivate}
            directory={directory}
            scoreEvents={scoreEvents}
            attendance={attendance}
            holidays={holidays}
            settings={settings}
            activityFeed={activityFeed}
            onSaveProfile={async (name, phone, designation) => {
              await updateOwnProfile({ me, name, phone, designation });
              const refreshed = await getUserPrivateRecord(me.empId).catch(() => null);
              setMyPrivate(refreshed);
            }}
            onUploadPhoto={async (dataUrl) => {
              await updateOwnPhoto(me, dataUrl);
            }}
            onRemovePhoto={async () => {
              await updateOwnPhoto(me, '');
            }}
            onChangePassword={async (currentPassword, newPassword) =>
              changeOwnPassword({ me, currentPassword, newPassword })
            }
            onToast={showToast}
          />
        )}

        {activeView === 'log' && isDev && <LogView me={me} auditLogs={auditLogs} />}

        {activeView === 'blue' && <BlueprintView />}
      </main>

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </section>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <KejminOpsApp />
    </ErrorBoundary>
  );
}
