import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  auth,
  clearDriveAccessToken,
  googleProvider,
  setDriveAccessToken,
  signInEmployeeWithPassword,
} from './firebase';
import {
  AttendanceRecord,
  AttendanceSettings,
  AuditLogEntry,
  BOOTSTRAP_ADMIN_EMAIL,
  CalendarTodo,
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
  SupportTicketDoc,
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
  createCalendarTodo,
  createCustomRole,
  createSharedFileRecord,
  createSharedFolderRecord,
  createTask,
  deleteCalendarTodo,
  deleteSharedFileRecord,
  deleteSharedFolderRecord,
  deleteTaskRecord,
  fetchLoginSlotVersion,
  findDirectoryByAuthUid,
  getDirectoryEntryByEmpId,
  getDirectoryList,
  getUserPrivateRecord,
  logAuditEvent,
  markAllNotificationsRead,
  markNotificationRead,
  removeHolidayRecord,
  resetOrganizationData,
  saveAttendanceSettings,
  saveWorkflowPathTemplate,
  seedOrganizationDataIfNeeded,
  sendBackTask,
  subscribeAuditLog,
  subscribeOrgData,
  syncAllAuthBindingSlots,
  syncDailyRecurringTasks,
  toggleBreakToday,
  updateCalendarTodo,
  updateOwnPhoto,
  updateOwnProfile,
  updateRoleRecord,
  updateSharedFileRecord,
  updateSharedFolderRecord,
  updateTaskDetails,
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
import { LoadingScreen } from './components/LoadingScreen';
import { TicketsView } from './components/TicketsView';

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
  const [calendarTodos, setCalendarTodos] = useState<CalendarTodo[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicketDoc[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [myPrivate, setMyPrivate] = useState<UserPrivate | null>(null);
  const [boundEmpIds, setBoundEmpIds] = useState<string[] | null>(null);

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
      if (user) {
        try {
          await seedOrganizationDataIfNeeded(user);
          setFirebaseUser(user);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions')) {
            await signOut(auth).catch(() => {});
            try {
              localStorage.removeItem('kj');
            } catch {
              // ignore
            }
            setActiveEmpId(null);
            setFirebaseUser(null);
          } else {
            console.error('Seeding check failed:', e);
            setFirebaseUser(user);
          }
        }
      } else {
        setFirebaseUser(null);
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
    if (!authReady || !firebaseUser || authBusy) {
      if (!firebaseUser) {
        setDirectory([]);
        setRoles([]);
        setTasks([]);
        setScoreEvents([]);
        setAttendance([]);
        setHolidays([]);
        setNotifications([]);
        setSharedFolders([]);
        setSharedFiles([]);
        setCalendarTodos([]);
        setSupportTickets([]);
        setAuditLogs([]);
      }
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
        onCalendarTodos: setCalendarTodos,
        onSupportTickets: setSupportTickets,
      },
      false
    );
    return () => unsub();
  }, [authReady, firebaseUser, authBusy]);

  // Active KEJMIN OPS employee profile (falls back to matching authUid if localStorage was cleared)
  const me = useMemo(() => {
    if (!firebaseUser) return null;
    if (activeEmpId) {
      const byId = directory.find((d) => d.empId === activeEmpId && d.active);
      if (byId) return byId;
    }
    return directory.find((d) => d.authUid === firebaseUser.uid && d.active) || null;
  }, [firebaseUser, activeEmpId, directory]);

  useEffect(() => {
    if (me && activeEmpId !== me.empId) {
      setActiveEmpId(me.empId);
      try {
        localStorage.setItem('kj', me.empId);
      } catch {
        // ignore
      }
    }
  }, [me, activeEmpId]);

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
    const cleanId = empId.trim().toLowerCase();
    if (!cleanId || !password) {
      return 'Please enter your User ID and password.';
    }
    if (!/^[a-z0-9._]{3,20}$/.test(cleanId)) {
      return 'Incorrect user ID or password.';
    }

    setAuthBusy(true);
    try {
      const serverVersion = await fetchLoginSlotVersion(cleanId);
      const versionsToTry =
        serverVersion === 1 ? [1, 2, 3] : [serverVersion, serverVersion + 1];

      let fbUser: User | null = null;
      let lastAuthErr: unknown = null;
      for (const v of versionsToTry) {
        try {
          fbUser = await signInEmployeeWithPassword(cleanId, password, v);
          break;
        } catch (err: unknown) {
          lastAuthErr = err;
          const code = (err as { code?: string })?.code || '';
          if (
            code === 'auth/invalid-credential' ||
            code === 'auth/wrong-password' ||
            code === 'auth/user-not-found'
          ) {
            continue;
          }
          throw err;
        }
      }

      if (!fbUser) {
        throw lastAuthErr || new Error('Incorrect user ID or password.');
      }

      setFirebaseUser(fbUser);

      // Confirm the signed-in Firebase UID matches an active KEJMIN OPS directory profile
      let dir: DirectoryEntry | null = null;
      try {
        dir = await getDirectoryEntryByEmpId(cleanId);
      } catch {
        dir = null;
      }

      if (!dir || !dir.active || (dir.authUid && dir.authUid !== fbUser.uid)) {
        await signOut(auth).catch(() => {});
        setFirebaseUser(null);
        return !dir
          ? 'This account is no longer active. Contact an administrator.'
          : !dir.active
            ? 'This account has been deactivated.'
            : 'Your password was recently reset. Please ask your administrator for the latest password.';
      }

      try {
        localStorage.setItem('kj', dir.empId);
      } catch {
        // ignore
      }
      setActiveEmpId(dir.empId);
      setSignedOutBanner(false);
      setActiveView('dash');
      await logAuditEvent({
        actor: dir.name,
        actorUserId: dir.empId,
        category: 'Sign-in',
        action: 'signed in',
        target: dir.empId,
      }).catch(() => {});
      return null;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        return 'Direct User ID sign-in is not enabled in Firebase Authentication yet. Ask the administrator to enable Email/Password sign-in in Firebase Console.';
      }
      if (code === 'auth/too-many-requests') {
        return 'Too many failed sign-in attempts. Please wait a few minutes and try again.';
      }
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found' ||
        code === 'auth/invalid-email'
      ) {
        return 'Incorrect user ID or password. Passwords are case-sensitive — check the exact password or reset it once in Users (after signing in with Google as Admin).';
      }
      const msg = err instanceof Error ? err.message : String(err);
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
        match =
          list.find((d) => d.empId === 'developer' && d.active) ||
          list.find((d) => isDeveloperRole(d.role) && d.active) ||
          list.find((d) => d.active) ||
          null;
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
    await signOut(auth).catch(() => {});
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

  const myRoleObj = useMemo(() => {
    if (!me) return null;
    const target = me.role.trim().toLowerCase();
    return roles.find((r) => r.name.trim().toLowerCase() === target) || null;
  }, [me, roles]);

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

  // Keep server login-slot version cache synced whenever an Admin/Developer signs in
  useEffect(() => {
    if (!authReady || !firebaseUser || (!isBootstrapAdmin && !isAdmin)) {
      setBoundEmpIds(null);
      return;
    }
    syncAllAuthBindingSlots()
      .then(setBoundEmpIds)
      .catch(() => {});
  }, [authReady, firebaseUser, isBootstrapAdmin, isAdmin]);

  const canCreateTasks = !!me && (isDev || myRolePermissions.includes(0));
  const canDesignPaths = !!me && (isDev || myRolePermissions.includes(1));
  const canSendBack = !!me && (isDev || myRolePermissions.includes(2));
  const canSeeAll = !!me && (isDev || myRolePermissions.includes(3));
  const canExportReports = !!me && (isDev || myRolePermissions.includes(4));
  const canManageRoles = !!me && (isDev || myRolePermissions.includes(5));
  const canManageUsers = !!me && (isDev || myRolePermissions.includes(6));
  const canCorrectAttendance = !!me && (isDev || myRolePermissions.includes(7));
  const canDeleteTasks = !!me && (isDev || myRolePermissions.includes(8));
  const canAccessShareFolder = !!me && (isDev || myRolePermissions.includes(9));

  // If live role permissions are updated and revoke access to the active view, return to dashboard immediately
  useEffect(() => {
    if (!me || (!isDev && roles.length === 0)) return;
    if (activeView === 'log' && !isDev) {
      setActiveView('dash');
    } else if (activeView === 'usr' && !canManageUsers) {
      setActiveView('dash');
    } else if (activeView === 'flow' && !canCreateTasks && !canDesignPaths) {
      setActiveView('dash');
    } else if (activeView === 'share' && !canAccessShareFolder) {
      setActiveView('dash');
    }
  }, [
    me,
    isDev,
    roles.length,
    activeView,
    canManageUsers,
    canCreateTasks,
    canDesignPaths,
    canAccessShareFolder,
  ]);

  // Track calendar date rollover so daily tasks auto-open when a new day starts
  const [todayKey, setTodayKey] = useState(() => todayStr());
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = todayStr();
      setTodayKey((prev) => (prev === next ? prev : next));
    }, 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

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
    const syncKey = `${todayKey}|${me.empId}|${holidays.length}|${dailySignature}`;
    if (lastDailySyncKeyRef.current === syncKey) return;
    lastDailySyncKeyRef.current = syncKey;
    syncDailyRecurringTasks({ tasks, holidays, actor: me }).catch((err) => {
      console.error('Daily recurring task sync failed:', err);
    });
  }, [authReady, firebaseUser, me, tasks, holidays, todayKey]);

  const myTasks = useMemo(() => {
    if (!me) return [];
    const seriesKeyOf = (t: TaskDoc) =>
      t.repeatSeriesId || `${t.title.trim().toLowerCase()}|${t.branch}|${t.location}`;
    const dailySeriesWithTodayRun = new Set(
      tasks
        .filter((t) => t.repeatMode === 'daily' && t.dueAt === todayKey)
        .map(seriesKeyOf)
    );
    const visible = tasks.filter((t) => {
      if (
        t.repeatMode === 'daily' &&
        t.status === 'open' &&
        t.dueAt > todayKey &&
        dailySeriesWithTodayRun.has(seriesKeyOf(t))
      ) {
        return false;
      }
      return true;
    });
    const sorted = [...visible].sort(
      (a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
    );
    return canSeeAll ? sorted : sorted.filter((t) => t.path.includes(me.name));
  }, [me, tasks, canSeeAll, todayKey]);

  const waitingOnMeCount = useMemo(() => {
    if (!me) return 0;
    return myTasks.filter(
      (t) =>
        t.stage < t.path.length &&
        t.status !== 'closed' &&
        !(t.repeatMode === 'daily' && t.dueAt > todayKey) &&
        t.path[t.stage] === me.name
    ).length;
  }, [me, myTasks, todayKey]);

  const openTicketsCount = useMemo(
    () => supportTickets.filter((t) => t.status !== 'closed').length,
    [supportTickets]
  );

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
    if (v === 'flow' && !canCreateTasks && !canDesignPaths) {
      showToast('Your role does not have permission to create tasks or design paths');
      setActiveView('dash');
      return;
    }
    if (v === 'share' && !canAccessShareFolder) {
      showToast('Your role does not have access to Share Folder');
      setActiveView('dash');
      return;
    }
    setActiveView(v);
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch {
      // ignore scroll errors
    }
  };

  // Loading state while checking auth / syncing directory for remembered session
  if (!authReady || (firebaseUser && activeEmpId && !me && directory.length === 0)) {
    return (
      <LoadingScreen
        message={!authReady ? 'Starting KEJMIN OPS...' : 'Loading your workspace...'}
      />
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
        canCreateTasks={canCreateTasks}
        canDesignPaths={canDesignPaths}
        canAccessShareFolder={canAccessShareFolder}
        activeView={activeView}
        waitingOnMeCount={waitingOnMeCount}
        openTicketsCount={openTicketsCount}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />

      <main>
        <Topbar
          me={me}
          activeView={activeView}
          mobileOpen={mobileOpen}
          notifications={notifications}
          onToggleMobile={() => setMobileOpen((o) => !o)}
          onNavigate={handleNavigate}
          onMarkRead={async (id) => {
            await markNotificationRead(id).catch(() => {});
          }}
          onMarkAllRead={async (ids) => {
            await markAllNotificationsRead(ids).catch(() => {});
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
            canCreateTasks={canCreateTasks}
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
                  ? `Stage completed, +${res.pts} pts · Next daily run opens on ${res.nextScheduledDate}`
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

        {activeView === 'share' && canAccessShareFolder && (
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

        {activeView === 'flow' && (canCreateTasks || canDesignPaths) && (
          <WorkflowBuilderView
            directory={directory}
            branches={branches}
            locations={locations}
            holidays={holidays}
            paths={paths}
            canCreateTasks={canCreateTasks}
            canDesignPaths={canDesignPaths}
            onCreateTask={async (params) => {
              if (!canCreateTasks) {
                showToast('Your role does not have permission to create tasks');
                return;
              }
              const created = await createTask({ ...params, holidays, actor: me });
              showToast(
                params.repeatMode === 'daily'
                  ? `Daily task scheduled for ${created.effectiveDueAt}${params.dueTime ? ` at ${params.dueTime}` : ''} (excl. Sun & holidays)`
                  : 'Task created'
              );
              setActiveView('tasks');
            }}
            onSaveTemplate={async (name, stages) => {
              if (!canDesignPaths) {
                showToast('Your role does not have permission to design workflow paths');
                return;
              }
              await saveWorkflowPathTemplate({ name, stages, actor: me });
              showToast('Workflow template saved');
            }}
          />
        )}

        {activeView === 'kpi' && (
          <KpiView me={me} canSeeAll={canSeeAll} scoreEvents={scoreEvents} />
        )}

        {activeView === 'tickets' && (
          <TicketsView
            me={me}
            currentUid={firebaseUser.uid}
            isDev={isDev}
            isAdmin={isAdmin}
            directory={directory}
            tickets={supportTickets}
            onToast={showToast}
          />
        )}

        {activeView === 'att' && (
          <AttendanceView
            me={me}
            canSeeTeam={canSeeAll}
            canCorrectAttendance={canCorrectAttendance}
            isAdmin={isAdmin}
            directory={directory}
            attendance={attendance}
            calendarTodos={calendarTodos}
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
            onAddCalendarTodo={async (params) => {
              await createCalendarTodo({ ...params, actor: me });
              showToast('Sticky note to-do added');
            }}
            onUpdateCalendarTodo={async (params) => {
              await updateCalendarTodo(params);
            }}
            onDeleteCalendarTodo={async (todoId) => {
              await deleteCalendarTodo(todoId);
              showToast('To-do removed');
            }}
            onExportAttendance={(meta) => {
              logAuditEvent({
                actor: me.name,
                actorUserId: me.empId,
                category: 'Export',
                action: `exported attendance Excel · ${meta}`,
              }).catch(() => {});
              showToast('Attendance Excel downloaded');
            }}
          />
        )}

        {activeView === 'rep' && (
          <ReportsView
            me={me}
            canSeeAll={canSeeAll}
            canExportReports={canExportReports}
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
            boundEmpIds={boundEmpIds}
            onCreateUser={async (params) => {
              await adminCreateUser({ ...params, actor: me });
              syncAllAuthBindingSlots().then(setBoundEmpIds).catch(() => {});
              showToast(`User @${params.empId} created and direct login activated`);
            }}
            onUpdateUser={async (params) => {
              await adminUpdateUser({ ...params, tasks, directory, actor: me });
              showToast('User updated');
            }}
            onResetPassword={async (target, newPassword) => {
              await adminResetPassword({ target, newPassword, actor: me });
              syncAllAuthBindingSlots().then(setBoundEmpIds).catch(() => {});
              showToast(`Direct login activated / password saved for ${target.name}`);
            }}
            onDeleteUser={async (target) => {
              await adminDeleteUser({ target, directory, actor: me });
              syncAllAuthBindingSlots().then(setBoundEmpIds).catch(() => {});
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
            onChangePassword={async (currentPassword, newPassword) => {
              const res = await changeOwnPassword({ me, currentPassword, newPassword });
              if (res.ok && (isBootstrapAdmin || isAdmin)) {
                syncAllAuthBindingSlots().then(setBoundEmpIds).catch(() => {});
              }
              return res;
            }}
            onToast={showToast}
          />
        )}

        {activeView === 'log' && isDev && (
          <LogView
            me={me}
            auditLogs={auditLogs}
            counts={{
              tasks: tasks.length,
              kpi: scoreEvents.length,
              attendance: attendance.length,
              logs: auditLogs.length,
            }}
            onResetData={async (scope) => {
              const res = await resetOrganizationData({ scope, actor: me });
              const doneParts: string[] = [];
              if (scope.resetTasks) doneParts.push(`Tasks (${res.deletedTasks})`);
              if (scope.resetKpi) doneParts.push(`KPI (${res.deletedKpi})`);
              if (scope.resetAttendance) doneParts.push(`Attendance (${res.deletedAttendance})`);
              if (scope.resetLogs) doneParts.push(`Log (${res.deletedLogs})`);
              showToast(`Reset complete: ${doneParts.join(', ')} cleared to 0`);
              return res;
            }}
          />
        )}

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
