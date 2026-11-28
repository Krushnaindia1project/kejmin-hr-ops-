import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  provisionEmployeeAuthAccount,
  updateOwnFirebasePassword,
} from '../firebase';
import {
  AttendanceRecord,
  AttendanceSettings,
  AuditCategory,
  AuditLogEntry,
  BOOTSTRAP_ADMIN_EMAIL,
  CalendarTodo,
  canManageTargetRole,
  canManageUser,
  DirectoryEntry,
  Holiday,
  isDeveloperRole,
  NotificationDoc,
  OrgUnit,
  PERMISSIONS,
  Priority,
  RepeatMode,
  RoleDefinition,
  ScoreEvent,
  ShareAccessScope,
  SharedFileDoc,
  SharedFolderDoc,
  SupportTicketDoc,
  TaskDoc,
  TicketAttachmentCategory,
  TicketAttachmentDoc,
  TicketComment,
  TicketLogEntry,
  TicketStatus,
  TicketSubtask,
  TodoNoteColor,
  UserPrivate,
  WEIGHTS,
  WorkflowPath,
} from '../types';
import {
  generateSalt,
  hashPassword,
  isDailyRunDate,
  nextDailyRunDate,
  nowTimeStr,
  randomId,
  round1,
  safeDocId,
  todayStr,
  verifyPassword,
} from '../utils/crypto';

export interface OrgSubscriptions {
  onDirectory: (items: DirectoryEntry[]) => void;
  onRoles: (items: RoleDefinition[]) => void;
  onBranches: (items: OrgUnit[]) => void;
  onLocations: (items: OrgUnit[]) => void;
  onPaths: (items: WorkflowPath[]) => void;
  onTasks: (items: TaskDoc[]) => void;
  onScoreEvents: (items: ScoreEvent[]) => void;
  onAttendance: (items: AttendanceRecord[]) => void;
  onHolidays: (items: Holiday[]) => void;
  onSettings: (settings: AttendanceSettings | null) => void;
  onNotifications: (items: NotificationDoc[]) => void;
  onSharedFolders?: (items: SharedFolderDoc[]) => void;
  onSharedFiles?: (items: SharedFileDoc[]) => void;
  onCalendarTodos?: (items: CalendarTodo[]) => void;
  onSupportTickets?: (items: SupportTicketDoc[]) => void;
  onAuditLog?: (items: AuditLogEntry[]) => void;
}

const ORG_ID = 'kejmin' as const;

export function subscribeOrgData(
  subs: OrgSubscriptions,
  canReadAuditLog: boolean
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];

  const subCol = <T,>(
    name: string,
    cb: (items: T[]) => void
  ) => {
    const q = query(collection(db, name), where('orgId', '==', ORG_ID));
    const u = onSnapshot(
      q,
      (snap) => {
        cb(snap.docs.map((d) => d.data() as T));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, name);
      }
    );
    unsubs.push(u);
  };

  subCol<DirectoryEntry>('directory', subs.onDirectory);
  subCol<RoleDefinition>('roles', subs.onRoles);
  subCol<OrgUnit>('branches', subs.onBranches);
  subCol<OrgUnit>('locations', subs.onLocations);
  subCol<WorkflowPath>('paths', subs.onPaths);
  subCol<TaskDoc>('tasks', subs.onTasks);
  subCol<ScoreEvent>('scoreEvents', subs.onScoreEvents);
  subCol<AttendanceRecord>('attendance', subs.onAttendance);
  subCol<Holiday>('holidays', subs.onHolidays);
  subCol<NotificationDoc>('notifications', subs.onNotifications);
  if (subs.onSharedFolders) {
    subCol<SharedFolderDoc>('sharedFolders', subs.onSharedFolders);
  }
  if (subs.onSharedFiles) {
    subCol<SharedFileDoc>('sharedFiles', subs.onSharedFiles);
  }
  if (subs.onCalendarTodos) {
    subCol<CalendarTodo>('calendarTodos', subs.onCalendarTodos);
  }
  if (subs.onSupportTickets) {
    subCol<SupportTicketDoc>('supportTickets', subs.onSupportTickets);
  }

  const settingsRef = doc(db, 'settings', 'attendance');
  unsubs.push(
    onSnapshot(
      settingsRef,
      (snap) => {
        subs.onSettings(snap.exists() ? (snap.data() as AttendanceSettings) : null);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, 'settings/attendance');
      }
    )
  );

  if (canReadAuditLog && subs.onAuditLog) {
    subCol<AuditLogEntry>('auditLog', subs.onAuditLog);
  }

  return () => {
    unsubs.forEach((u) => u());
  };
}

export function subscribeAuditLog(
  onAuditLog: (items: AuditLogEntry[]) => void
): Unsubscribe {
  const q = query(collection(db, 'auditLog'), where('orgId', '==', ORG_ID));
  return onSnapshot(
    q,
    (snap) => {
      onAuditLog(snap.docs.map((d) => d.data() as AuditLogEntry));
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'auditLog');
    }
  );
}

export async function logAuditEvent(params: {
  actor: string;
  actorUserId: string;
  category: AuditCategory;
  action: string;
  target?: string;
  before?: string;
  after?: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const logId = randomId('log');
  const path = `auditLog/${logId}`;
  try {
    await setDoc(doc(db, 'auditLog', logId), {
      logId,
      actor: params.actor.slice(0, 100) || '-',
      actorUserId: (params.actorUserId || '').slice(0, 40),
      actorUid: uid,
      category: params.category,
      action: params.action.slice(0, 500),
      target: (params.target || '').slice(0, 160),
      before: (params.before || '').slice(0, 500),
      after: (params.after || '').slice(0, 500),
      orgId: ORG_ID,
      at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

async function createNotification(params: {
  recipientName: string;
  title: string;
  message: string;
  type: NotificationDoc['type'];
  taskId: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const notifId = randomId('ntf');
  const path = `notifications/${notifId}`;
  try {
    await setDoc(doc(db, 'notifications', notifId), {
      notifId,
      recipientName: params.recipientName.slice(0, 100),
      title: params.title.slice(0, 160),
      message: params.message.slice(0, 400),
      type: params.type,
      taskId: params.taskId.slice(0, 64),
      read: false,
      actorUid: uid,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function markNotificationRead(notifId: string): Promise<void> {
  const path = `notifications/${notifId}`;
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markAllNotificationsRead(notifIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(notifIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((id) => {
      batch.update(doc(db, 'notifications', id), { read: true });
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'notifications');
    }
  }
}

const LEGACY_DEMO_USER_MAP: Record<string, string> = {
  owner: 'Mr. Kej',
  finalizer: 'Rohit Rao',
  auditor: 'Meera Nair',
  asha: 'Asha K',
  kiran: 'Kiran P',
  suresh: 'Suresh M',
};

const LEGACY_DEMO_TASK_IDS = [
  'tsk_mis_report',
  'tsk_p1_dispatch',
  'tsk_vendor_inv',
  'tsk_p2_safety',
  'tsk_sales_lead',
  'tsk_gst_filing',
  'tsk_new_joiner',
];

const LEGACY_DEMO_PATH_IDS = [
  'path_onboarding',
  'path_plant_daily',
  'path_invoice',
  'path_payroll',
];

const LEGACY_DEMO_SCORE_IDS = Array.from({ length: 10 }, (_, i) => `scr_seed_${i + 1}`);
const LEGACY_DEMO_LOG_IDS = ['log_seed_1', 'log_seed_2', 'log_seed_3'];

async function commitDeletesInChunks(refs: Array<ReturnType<typeof doc>>): Promise<void> {
  const CHUNK = 400;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    if (!slice.length) continue;
    const batch = writeBatch(db);
    slice.forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/**
 * Purges previously seeded demo records (dummy staff, sample tasks, sample templates,
 * sample scores, sample audit entries, and synthetic attendance history) while preserving
 * all real user-created data and core org configuration.
 */
async function purgeLegacyDemoDataIfNeeded(): Promise<void> {
  try {
    if (localStorage.getItem('kj_demo_purged_v2') === '1') return;
  } catch {
    // proceed
  }

  const toDelete: Array<ReturnType<typeof doc>> = [];
  const today = todayStr();

  try {
    // 1. Untouched demo users (never deletes real or edited accounts, or the only Developer account)
    const dirSnap = await getDocs(query(collection(db, 'directory'), where('orgId', '==', ORG_ID)));
    const allDirs = dirSnap.docs.map((d) => ({ id: d.id, data: d.data() as DirectoryEntry }));
    const hasOtherActiveDev = allDirs.some(
      ({ data }) => data.active && data.role === 'Developer' && data.empId !== 'developer'
    );
    allDirs.forEach(({ id, data: entry }) => {
      const expectedDemoName = LEGACY_DEMO_USER_MAP[entry.empId];
      const isUntouchedDummy = Boolean(expectedDemoName && !entry.authUid && entry.name === expectedDemoName);
      const isUnusedDemoDev =
        entry.empId === 'developer' && entry.name === 'Dev Admin' && hasOtherActiveDev;
      if (isUntouchedDummy || isUnusedDemoDev) {
        toDelete.push(doc(db, 'directory', id));
        toDelete.push(doc(db, 'users', id));
      }
    });

    // 2. Seeded demo tasks
    const taskSnap = await getDocs(query(collection(db, 'tasks'), where('orgId', '==', ORG_ID)));
    const demoTaskSet = new Set(LEGACY_DEMO_TASK_IDS);
    taskSnap.docs.forEach((d) => {
      if (demoTaskSet.has(d.id)) {
        toDelete.push(doc(db, 'tasks', d.id));
      }
    });

    // 3. Seeded demo workflow templates
    const pathSnap = await getDocs(query(collection(db, 'paths'), where('orgId', '==', ORG_ID)));
    const demoPathSet = new Set(LEGACY_DEMO_PATH_IDS);
    pathSnap.docs.forEach((d) => {
      if (demoPathSet.has(d.id)) {
        toDelete.push(doc(db, 'paths', d.id));
      }
    });

    // 4. Seeded demo score events
    const scoreSnap = await getDocs(query(collection(db, 'scoreEvents'), where('orgId', '==', ORG_ID)));
    const demoScoreSet = new Set(LEGACY_DEMO_SCORE_IDS);
    scoreSnap.docs.forEach((d) => {
      if (demoScoreSet.has(d.id)) {
        toDelete.push(doc(db, 'scoreEvents', d.id));
      }
    });

    // 5. Seeded demo audit logs
    const logSnap = await getDocs(query(collection(db, 'auditLog'), where('orgId', '==', ORG_ID)));
    const demoLogSet = new Set(LEGACY_DEMO_LOG_IDS);
    logSnap.docs.forEach((d) => {
      if (demoLogSet.has(d.id)) {
        toDelete.push(doc(db, 'auditLog', d.id));
      }
    });

    // 6. Seeded synthetic attendance history
    const attSnap = await getDocs(query(collection(db, 'attendance'), where('orgId', '==', ORG_ID)));
    attSnap.docs.forEach((d) => {
      const rec = d.data() as AttendanceRecord;
      const isDummyStaff = Boolean(LEGACY_DEMO_USER_MAP[rec.uid]);
      const isSyntheticPastDev =
        rec.uid === 'developer' &&
        rec.date < today &&
        !rec.note &&
        !rec.correctedBy &&
        (!rec.breaks || rec.breaks.length === 0);
      if (isDummyStaff || isSyntheticPastDev) {
        toDelete.push(doc(db, 'attendance', d.id));
      }
    });

    if (toDelete.length) {
      await commitDeletesInChunks(toDelete);
    }

    try {
      localStorage.setItem('kj_demo_purged_v2', '1');
    } catch {
      // ignore
    }
  } catch (error) {
    console.error('Demo data cleanup skipped:', error);
  }
}

/**
 * Initializes core KEJMIN OPS organization configuration (settings, branches, locations,
 * built-in roles, holiday calendar, and the bootstrap administrator account) on first launch.
 * No demo tasks, demo staff, demo scores, or demo attendance are created.
 */
export async function seedOrganizationDataIfNeeded(firebaseUser: User): Promise<boolean> {
  const isBootstrapAdmin =
    firebaseUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
    firebaseUser.emailVerified;

  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'attendance'));
    if (settingsSnap.exists()) {
      // Ensure bootstrap admin record exists & purge any legacy demo data once
      if (isBootstrapAdmin) {
        const admSnap = await getDoc(doc(db, 'admins', firebaseUser.uid));
        if (!admSnap.exists()) {
          await setDoc(doc(db, 'admins', firebaseUser.uid), {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            role: 'Developer',
            createdAt: serverTimestamp(),
          });
        }
        await purgeLegacyDemoDataIfNeeded();
      }
      return false;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'settings/attendance');
  }

  if (!isBootstrapAdmin) {
    return false;
  }

  const uid = firebaseUser.uid;
  const batch1 = writeBatch(db);

  // 1. Admin record
  batch1.set(doc(db, 'admins', uid), {
    uid,
    email: firebaseUser.email,
    role: 'Developer',
    createdAt: serverTimestamp(),
  });

  // 2. Settings
  batch1.set(doc(db, 'settings', 'attendance'), {
    settingId: 'attendance',
    wd: [1, 2, 3, 4, 5, 6],
    st: '09:30',
    en: '18:30',
    gr: 15,
    orgId: ORG_ID,
    updatedAt: serverTimestamp(),
  });

  // 3. Branches
  const branches = [
    { id: 'br_mis', name: 'MIS', code: 'MIS' },
    { id: 'br_ops', name: 'Operations', code: 'OPS' },
    { id: 'br_sales', name: 'Sales', code: 'SLS' },
    { id: 'br_acc', name: 'Accounts & Finance', code: 'ACC' },
    { id: 'br_plant', name: 'Plant Coordination', code: 'PLT' },
    { id: 'br_hr', name: 'HR', code: 'HR' },
  ];
  branches.forEach((b) => {
    batch1.set(doc(db, 'branches', b.id), {
      id: b.id,
      name: b.name,
      code: b.code,
      active: true,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
    });
  });

  // 4. Locations
  const locations = [
    { id: 'loc_blr', name: 'Bengaluru Office', code: 'BLR' },
    { id: 'loc_p1', name: 'Plant 1', code: 'P1' },
    { id: 'loc_p2', name: 'Plant 2', code: 'P2' },
  ];
  locations.forEach((l) => {
    batch1.set(doc(db, 'locations', l.id), {
      id: l.id,
      name: l.name,
      code: l.code,
      active: true,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
    });
  });

  // 5. Built-in Roles
  const rolesData = [
    { roleId: 'role_developer', name: 'Developer', branchScope: 'All', locationScope: 'All', permissions: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], builtin: true },
    { roleId: 'role_owner', name: 'Company Owner', branchScope: 'All', locationScope: 'All', permissions: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], builtin: true },
    { roleId: 'role_finalizer', name: 'Finalizer', branchScope: 'All', locationScope: 'Bengaluru Office', permissions: [0, 2, 3, 4, 9], builtin: true },
    { roleId: 'role_auditor', name: 'Auditor', branchScope: 'All', locationScope: 'Bengaluru Office', permissions: [2, 3, 4, 9], builtin: true },
    { roleId: 'role_coordinator', name: 'Process Coordinator', branchScope: 'Own branch', locationScope: 'Bengaluru Office', permissions: [0, 9], builtin: true },
    { roleId: 'role_plant', name: 'Plant Staff', branchScope: 'Plant Coordination', locationScope: 'Plant 1, Plant 2', permissions: [0, 9], builtin: true },
  ];
  rolesData.forEach((r) => {
    batch1.set(doc(db, 'roles', r.roleId), {
      ...r,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  // 6. Standard Company Holidays
  const holidays = [
    { holidayId: 'hol_2026_10_02', date: '2026-10-02', location: 'All', name: 'Gandhi Jayanti' },
    { holidayId: 'hol_2026_11_01', date: '2026-11-01', location: 'All', name: 'Kannada Rajyotsava' },
    { holidayId: 'hol_2026_11_08', date: '2026-11-08', location: 'All', name: 'Diwali' },
    { holidayId: 'hol_2026_12_25', date: '2026-12-25', location: 'All', name: 'Christmas' },
    { holidayId: 'hol_2027_01_26', date: '2027-01-26', location: 'All', name: 'Republic Day' },
  ];
  holidays.forEach((h) => {
    batch1.set(doc(db, 'holidays', h.holidayId), {
      ...h,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
    });
  });

  // 7. Bootstrap Administrator account only (no demo staff, tasks, scores, or attendance)
  const adminDocId = safeDocId('developer');
  const adminDisplayName = (firebaseUser.displayName || 'Administrator').trim().slice(0, 100);
  const salt = generateSalt();
  const passwordHash = await hashPassword(randomId('init'), salt);

  batch1.set(doc(db, 'directory', adminDocId), {
    empId: 'developer',
    docId: adminDocId,
    name: adminDisplayName,
    role: 'Developer',
    branch: 'All',
    location: 'All',
    designation: 'System Administrator',
    joinedAt: todayStr(),
    photoUrl: '',
    active: true,
    authUid: uid,
    orgId: ORG_ID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch1.set(doc(db, 'users', adminDocId), {
    empId: 'developer',
    docId: adminDocId,
    authUid: uid,
    email: (firebaseUser.email || '').slice(0, 200),
    phone: '',
    passwordHash,
    passwordSalt: salt,
    twoStepEnabled: true,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch1.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seed_core_config');
  }

  return true;
}

export async function getUserPrivateRecord(empId: string): Promise<UserPrivate | null> {
  const docId = safeDocId(empId);
  const path = `users/${docId}`;
  try {
    const snap = await getDoc(doc(db, 'users', docId));
    return snap.exists() ? (snap.data() as UserPrivate) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function findDirectoryByAuthUid(authUid: string): Promise<DirectoryEntry | null> {
  try {
    const q = query(collection(db, 'directory'), where('orgId', '==', ORG_ID));
    const snap = await getDocs(q);
    const found = snap.docs
      .map((d) => d.data() as DirectoryEntry)
      .find((entry) => entry.authUid === authUid && entry.active);
    return found || null;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'directory');
  }
}

export async function getDirectoryList(): Promise<DirectoryEntry[]> {
  try {
    const q = query(collection(db, 'directory'), where('orgId', '==', ORG_ID));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as DirectoryEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'directory');
  }
}

export async function getDirectoryEntryByEmpId(empId: string): Promise<DirectoryEntry | null> {
  const docId = safeDocId(empId);
  try {
    const snap = await getDoc(doc(db, 'directory', docId));
    return snap.exists() ? (snap.data() as DirectoryEntry) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `directory/${docId}`);
  }
}

export async function fetchLoginSlotVersion(empId: string): Promise<number> {
  try {
    const res = await fetch('/api/auth/login-slot', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ empId: empId.trim().toLowerCase() }),
    });
    if (!res.ok) return 1;
    const data = (await res.json()) as { version?: number };
    return typeof data.version === 'number' && Number.isInteger(data.version) && data.version >= 1
      ? data.version
      : 1;
  } catch {
    return 1;
  }
}

export async function syncLoginSlotsToServer(
  slots: Record<string, number>,
  replaceAll = false
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const idToken = await user.getIdToken();
    await fetch('/api/auth/sync-slots', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ slots, replaceAll }),
    });
  } catch {
    // Non-fatal; next admin session will re-sync
  }
}

export async function syncAllAuthBindingSlots(): Promise<string[]> {
  if (!auth.currentUser) return [];
  try {
    const q = query(collection(db, 'authBindings'), where('orgId', '==', ORG_ID));
    const snap = await getDocs(q);
    const slots: Record<string, number> = {};
    const boundEmpIds = new Set<string>();
    snap.docs.forEach((d) => {
      const data = d.data() as {
        empId?: string;
        docId?: string;
        active?: boolean;
        loginVersion?: number;
      };
      if (
        data.active &&
        typeof data.docId === 'string' &&
        typeof data.loginVersion === 'number' &&
        Number.isInteger(data.loginVersion) &&
        data.loginVersion >= 1
      ) {
        if (typeof data.empId === 'string' && data.empId) {
          boundEmpIds.add(data.empId);
        }
        const prev = slots[data.docId] || 0;
        if (data.loginVersion > prev) {
          slots[data.docId] = data.loginVersion;
        }
      }
    });
    await syncLoginSlotsToServer(slots, true);
    return Array.from(boundEmpIds);
  } catch {
    // Non-admins do not have list permission on authBindings; silently ignore
    return [];
  }
}

export async function verifyUserCredentials(
  empId: string,
  password: string
): Promise<{ ok: boolean; directory?: DirectoryEntry; privateUser?: UserPrivate; reason?: string }> {
  const cleanId = empId.trim().toLowerCase();
  const docId = safeDocId(cleanId);
  try {
    const dirSnap = await getDoc(doc(db, 'directory', docId));
    if (!dirSnap.exists()) {
      return { ok: false, reason: 'Incorrect user ID or password.' };
    }
    const dir = dirSnap.data() as DirectoryEntry;
    if (!dir.active) {
      return { ok: false, reason: 'This account has been deactivated.' };
    }
    let privSnap;
    try {
      privSnap = await getDoc(doc(db, 'users', docId));
    } catch {
      return { ok: false, reason: 'You do not have permission to sign in as this account.' };
    }
    if (!privSnap.exists()) {
      return { ok: false, reason: 'Incorrect user ID or password.' };
    }
    const priv = privSnap.data() as UserPrivate;
    const matched = await verifyPassword(password, priv.passwordSalt, priv.passwordHash);
    if (!matched) {
      return { ok: false, reason: 'Incorrect user ID or password.' };
    }
    return { ok: true, directory: dir, privateUser: priv };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${docId}`);
  }
}

export async function registerNewAccount(params: {
  empId: string;
  name: string;
  password: string;
  branch: string;
  location: string;
  role: string;
  firebaseUser: User;
}): Promise<DirectoryEntry> {
  const empId = params.empId.trim().toLowerCase();
  const docId = safeDocId(empId);
  const role =
    params.role.trim().slice(0, 60) ||
    (params.location === 'Bengaluru Office' ? 'Process Coordinator' : 'Plant Staff');
  const isAdminRole = role === 'Developer' || role === 'Company Owner';
  const salt = generateSalt();
  const passwordHash = await hashPassword(params.password, salt);
  const joinedAt = todayStr();

  const dirData: DirectoryEntry = {
    empId,
    docId,
    name: params.name.trim().slice(0, 100),
    role,
    branch: params.branch.slice(0, 60),
    location: params.location.slice(0, 60),
    designation: '',
    joinedAt,
    photoUrl: '',
    active: true,
    authUid: params.firebaseUser.uid,
    orgId: ORG_ID,
  };

  let existingAdminRole: string | null = null;
  if (isAdminRole) {
    try {
      const admSnap = await getDoc(doc(db, 'admins', params.firebaseUser.uid));
      if (admSnap.exists()) {
        existingAdminRole = String(admSnap.data()?.role || '');
      }
    } catch {
      existingAdminRole = null;
    }
  }

  const batch = writeBatch(db);
  batch.set(doc(db, 'directory', docId), {
    ...dirData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users', docId), {
    empId,
    docId,
    authUid: params.firebaseUser.uid,
    email: (params.firebaseUser.email || '').slice(0, 200),
    phone: '',
    passwordHash,
    passwordSalt: salt,
    twoStepEnabled: isAdminRole,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (isAdminRole) {
    const admRef = doc(db, 'admins', params.firebaseUser.uid);
    if (!existingAdminRole) {
      batch.set(admRef, {
        uid: params.firebaseUser.uid,
        email: (params.firebaseUser.email || '').slice(0, 200),
        role,
        createdAt: serverTimestamp(),
      });
    } else if (existingAdminRole !== 'Developer' && role === 'Developer') {
      batch.update(admRef, { role: 'Developer' });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `directory/${docId}`);
  }

  await logAuditEvent({
    actor: dirData.name,
    actorUserId: empId,
    category: 'User',
    action: `registered a new account @${empId} · ${role} · ${params.branch} · ${params.location}`,
    target: empId,
  });

  return dirData;
}

// ===== TASKS =====

export async function createTask(params: {
  title: string;
  branch: string;
  location: string;
  priority: Priority;
  dueAt: string;
  dueTime?: string;
  repeatMode?: RepeatMode;
  holidays?: Holiday[];
  path: string[];
  pathId?: string;
  actor: DirectoryEntry;
}): Promise<{ taskId: string; effectiveDueAt: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const cleanPath = params.path.filter(Boolean).slice(0, 12);
  const repeatMode: RepeatMode = params.repeatMode === 'daily' ? 'daily' : 'none';
  const cleanDueTime = (params.dueTime || '').trim().slice(0, 5);
  const holidays = params.holidays || [];
  const effectiveDueAt =
    repeatMode === 'daily'
      ? nextDailyRunDate(params.dueAt, params.location, holidays, true)
      : params.dueAt;
  const repeatSeriesId = repeatMode === 'daily' ? randomId('rep').slice(0, 32) : '';
  const taskId =
    repeatMode === 'daily'
      ? safeDocId(`${repeatSeriesId}_${effectiveDueAt}`).slice(0, 64)
      : randomId('tsk');

  try {
    await setDoc(doc(db, 'tasks', taskId), {
      taskId,
      title: params.title.trim().slice(0, 160),
      branch: params.branch.slice(0, 60),
      location: params.location.slice(0, 60),
      priority: params.priority,
      pathId: (params.pathId || '').slice(0, 64),
      path: cleanPath,
      stage: 0,
      dueAt: effectiveDueAt,
      dueTime: cleanDueTime,
      repeatMode,
      repeatSeriesId,
      status: 'open',
      proofs: [],
      lastSendBackReason: '',
      createdBy: params.actor.name.slice(0, 100),
      createdByUid: uid,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${taskId}`);
  }

  const schedNote =
    repeatMode === 'daily'
      ? ` · Daily (excl. Sun & holidays)${cleanDueTime ? ` at ${cleanDueTime}` : ''}`
      : cleanDueTime
      ? ` at ${cleanDueTime}`
      : '';

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Task',
    action: `created task "${params.title.trim()}" · ${params.branch} · ${params.location} · ${params.priority} importance · due ${effectiveDueAt}${schedNote} · path: ${cleanPath.join(' › ')}`,
    target: taskId,
  });

  if (cleanPath[0]) {
    await createNotification({
      recipientName: cleanPath[0],
      title: `Task assigned: ${params.title.trim()}`,
      message: `${params.actor.name} assigned you stage 1 (${params.priority} priority, due ${effectiveDueAt}${cleanDueTime ? ` ${cleanDueTime}` : ''}).`,
      type: 'assigned',
      taskId,
    });
  }

  return { taskId, effectiveDueAt };
}

async function spawnDailyOccurrenceIfMissing(params: {
  sourceTask: TaskDoc;
  targetDate: string;
  actor: DirectoryEntry;
}): Promise<string | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const { sourceTask, targetDate, actor } = params;
  const seriesId = sourceTask.repeatSeriesId || safeDocId(`rep_${sourceTask.taskId}`).slice(0, 32);
  const nextTaskId = safeDocId(`${seriesId}_${targetDate}`).slice(0, 64);

  try {
    const existingSnap = await getDoc(doc(db, 'tasks', nextTaskId));
    if (existingSnap.exists()) return null;

    await setDoc(doc(db, 'tasks', nextTaskId), {
      taskId: nextTaskId,
      title: sourceTask.title.slice(0, 160),
      branch: sourceTask.branch.slice(0, 60),
      location: sourceTask.location.slice(0, 60),
      priority: sourceTask.priority,
      pathId: (sourceTask.pathId || '').slice(0, 64),
      path: sourceTask.path.slice(0, 12),
      stage: 0,
      dueAt: targetDate,
      dueTime: (sourceTask.dueTime || '').slice(0, 5),
      repeatMode: 'daily',
      repeatSeriesId: seriesId,
      status: 'open',
      proofs: [],
      lastSendBackReason: '',
      createdBy: sourceTask.createdBy.slice(0, 100),
      createdByUid: uid,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${nextTaskId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Task',
    action: `scheduled next daily run of "${sourceTask.title}" for ${targetDate}${sourceTask.dueTime ? ` at ${sourceTask.dueTime}` : ''} (skipped Sundays & holidays)`,
    target: nextTaskId,
  });

  if (sourceTask.path[0]) {
    await createNotification({
      recipientName: sourceTask.path[0],
      title: `Daily task ready: ${sourceTask.title}`,
      message: `Scheduled for ${targetDate}${sourceTask.dueTime ? ` at ${sourceTask.dueTime}` : ''} (${sourceTask.priority} priority).`,
      type: 'assigned',
      taskId: nextTaskId,
    });
  }

  return nextTaskId;
}

export async function syncDailyRecurringTasks(params: {
  tasks: TaskDoc[];
  holidays: Holiday[];
  actor: DirectoryEntry;
}): Promise<number> {
  const today = todayStr();
  const dailyTasks = params.tasks.filter((t) => t.repeatMode === 'daily');
  if (!dailyTasks.length) return 0;

  const bySeries = new Map<string, TaskDoc[]>();
  dailyTasks.forEach((t) => {
    const key = t.repeatSeriesId || t.taskId;
    const arr = bySeries.get(key) || [];
    arr.push(t);
    bySeries.set(key, arr);
  });

  let spawned = 0;
  for (const [, list] of bySeries.entries()) {
    const sorted = [...list].sort((a, b) => (b.dueAt > a.dueAt ? 1 : b.dueAt < a.dueAt ? -1 : 0));
    const latest = sorted[0];
    if (!latest) continue;
    // Only auto-spawn today's run if today is a valid daily run date (not Sunday, not a holiday)
    // and no occurrence already exists for today or a future date.
    if (latest.dueAt >= today) continue;
    if (!isDailyRunDate(today, latest.location, params.holidays)) continue;

    const createdId = await spawnDailyOccurrenceIfMissing({
      sourceTask: latest,
      targetDate: today,
      actor: params.actor,
    });
    if (createdId) spawned++;
  }

  return spawned;
}

export async function advanceTaskStage(params: {
  task: TaskDoc;
  actor: DirectoryEntry;
  directory: DirectoryEntry[];
  holidays?: Holiday[];
}): Promise<{ pts: number; nextScheduledDate: string | null }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const { task, actor, directory, holidays = [] } = params;
  const stageIdx = task.stage;
  if (stageIdx >= task.path.length) return { pts: 0, nextScheduledDate: null };

  const assigneeName = task.path[stageIdx];
  const assigneeDir = directory.find((d) => d.name === assigneeName);
  const today = todayStr();
  if (task.repeatMode === 'daily' && task.dueAt > today) {
    throw new Error(`This daily task is scheduled for ${task.dueAt} and opens on that day.`);
  }
  const early =
    task.dueAt > today ||
    (task.dueAt === today && (!task.dueTime || nowTimeStr() <= task.dueTime));
  const pts = round1(WEIGHTS[task.priority] * (early ? 1.5 : 1));
  const nextStage = stageIdx + 1;
  const nextStatus: 'open' | 'closed' = nextStage >= task.path.length ? 'closed' : 'open';

  const eventId = randomId('scr');
  const logId = randomId('log');
  const batch = writeBatch(db);

  batch.update(doc(db, 'tasks', task.taskId), {
    stage: nextStage,
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'scoreEvents', eventId), {
    eventId,
    uid: assigneeDir?.empId || safeDocId(assigneeName),
    employeeName: assigneeName.slice(0, 100),
    taskId: task.taskId,
    points: pts,
    reason: `Stage ${stageIdx + 1} completed${early ? ' (on-time 1.5x)' : ''}: ${task.title}`.slice(0, 240),
    date: today,
    actorUid: uid,
    orgId: ORG_ID,
    at: serverTimestamp(),
  });

  batch.set(doc(db, 'auditLog', logId), {
    logId,
    actor: actor.name.slice(0, 100),
    actorUserId: actor.empId.slice(0, 40),
    actorUid: uid,
    category: 'Task',
    action: `completed stage ${stageIdx + 1} of ${task.path.length} on "${task.title}"${assigneeName !== actor.name ? ` on behalf of ${assigneeName}` : ''} · +${pts} pts${nextStatus === 'closed' ? ' · task fully completed' : ''}`.slice(0, 500),
    target: task.taskId,
    before: `stage ${stageIdx}`,
    after: `stage ${nextStage} (${nextStatus})`,
    orgId: ORG_ID,
    at: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.taskId}`);
  }

  let nextScheduledDate: string | null = null;
  if (nextStatus === 'open' && task.path[nextStage]) {
    await createNotification({
      recipientName: task.path[nextStage],
      title: `Your turn: ${task.title}`,
      message: `${assigneeName} completed stage ${stageIdx + 1}. Stage ${nextStage + 1} is now waiting on you.`,
      type: 'assigned',
      taskId: task.taskId,
    });
  } else if (nextStatus === 'closed' && task.repeatMode === 'daily') {
    const anchor = task.dueAt >= today ? task.dueAt : today;
    const nextDate = nextDailyRunDate(anchor, task.location, holidays, false);
    // Do NOT create a future day's daily task on the same day — syncDailyRecurringTasks
    // will automatically create the next occurrence when that calendar day arrives.
    if (task.dueAt < today && isDailyRunDate(today, task.location, holidays)) {
      await spawnDailyOccurrenceIfMissing({
        sourceTask: task,
        targetDate: today,
        actor,
      });
    }
    nextScheduledDate = nextDate;
  }

  return { pts, nextScheduledDate };
}

export async function sendBackTask(params: {
  task: TaskDoc;
  reason: string;
  actor: DirectoryEntry;
  directory: DirectoryEntry[];
  scoreEvents: ScoreEvent[];
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const { task, reason, actor, directory, scoreEvents } = params;
  if (task.stage <= 0) return;

  const cleanReason = reason.trim().slice(0, 500);
  const fromName = task.path[task.stage] || 'Completed';
  const prevStage = task.stage - 1;
  const prevAssignee = task.path[prevStage];
  const prevDir = directory.find((d) => d.name === prevAssignee);

  // Blueprint rule: A send-back removes the points for that stage (append-only negative scoreEvent)
  const matchingAward = scoreEvents
    .filter((ev) => ev.taskId === task.taskId && ev.employeeName === prevAssignee && ev.points > 0)
    .sort((a, b) => (b.at?.toMillis() || 0) - (a.at?.toMillis() || 0))[0];
  const reversePoints = matchingAward ? -Math.abs(matchingAward.points) : -WEIGHTS[task.priority];

  const eventId = randomId('scr');
  const logId = randomId('log');
  const batch = writeBatch(db);

  batch.update(doc(db, 'tasks', task.taskId), {
    stage: prevStage,
    status: 'open',
    lastSendBackReason: cleanReason,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'scoreEvents', eventId), {
    eventId,
    uid: prevDir?.empId || safeDocId(prevAssignee),
    employeeName: prevAssignee.slice(0, 100),
    taskId: task.taskId,
    points: reversePoints,
    reason: `Send-back reversal (stage ${prevStage + 1}): ${cleanReason}`.slice(0, 240),
    date: todayStr(),
    actorUid: uid,
    orgId: ORG_ID,
    at: serverTimestamp(),
  });

  batch.set(doc(db, 'auditLog', logId), {
    logId,
    actor: actor.name.slice(0, 100),
    actorUserId: actor.empId.slice(0, 40),
    actorUid: uid,
    category: 'Task',
    action: `sent back "${task.title}" from ${fromName} to ${prevAssignee} · reason: ${cleanReason} · ${reversePoints} pts reversed`.slice(0, 500),
    target: task.taskId,
    before: `stage ${task.stage} (${fromName})`,
    after: `stage ${prevStage} (${prevAssignee})`,
    orgId: ORG_ID,
    at: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.taskId}`);
  }

  await createNotification({
    recipientName: prevAssignee,
    title: `Sent back: ${task.title}`,
    message: `${actor.name} sent this task back to stage ${prevStage + 1}. Reason: ${cleanReason}`,
    type: 'sendback',
    taskId: task.taskId,
  });
}

export async function updateTaskDetails(params: {
  task: TaskDoc;
  title: string;
  branch: string;
  location: string;
  priority: Priority;
  dueAt: string;
  dueTime?: string;
  repeatMode?: RepeatMode;
  holidays?: Holiday[];
  path: string[];
  actor: DirectoryEntry;
}): Promise<void> {
  const { task, title, branch, location, priority, dueAt, path, actor, holidays = [] } = params;
  const cleanTitle = title.trim().slice(0, 160);
  if (!cleanTitle) throw new Error('Task title is required.');
  const cleanPath = path.filter(Boolean).slice(0, 12);
  if (!cleanPath.length) throw new Error('At least one stage is required.');
  const repeatMode: RepeatMode = params.repeatMode === 'daily' ? 'daily' : 'none';
  const cleanDueTime = (params.dueTime ?? task.dueTime ?? '').trim().slice(0, 5);
  const effectiveDueAt =
    repeatMode === 'daily'
      ? nextDailyRunDate(dueAt, location, holidays, true)
      : dueAt;
  const repeatSeriesId =
    repeatMode === 'daily'
      ? task.repeatSeriesId || randomId('rep').slice(0, 32)
      : '';
  const safeStage = Math.min(task.stage, cleanPath.length);
  const nextStatus: 'open' | 'closed' = safeStage >= cleanPath.length ? 'closed' : 'open';

  try {
    await updateDoc(doc(db, 'tasks', task.taskId), {
      title: cleanTitle,
      branch: branch.slice(0, 60),
      location: location.slice(0, 60),
      priority,
      dueAt: effectiveDueAt,
      dueTime: cleanDueTime,
      repeatMode,
      repeatSeriesId,
      path: cleanPath,
      stage: safeStage,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.taskId}`);
  }

  const changes: string[] = [];
  if (task.title !== cleanTitle) changes.push(`title "${task.title}" to "${cleanTitle}"`);
  if (task.branch !== branch) changes.push(`branch ${task.branch} to ${branch}`);
  if (task.location !== location) changes.push(`location ${task.location} to ${location}`);
  if (task.priority !== priority) changes.push(`importance ${task.priority} to ${priority}`);
  if (task.dueAt !== effectiveDueAt) changes.push(`due ${task.dueAt} to ${effectiveDueAt}`);
  if ((task.dueTime || '') !== cleanDueTime) changes.push(`due time ${task.dueTime || '-'} to ${cleanDueTime || '-'}`);
  if ((task.repeatMode || 'none') !== repeatMode) changes.push(`repeat ${task.repeatMode || 'none'} to ${repeatMode}`);
  if (task.path.join(' › ') !== cleanPath.join(' › ')) {
    changes.push(`path ${task.path.join(' › ')} to ${cleanPath.join(' › ')}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Task',
    action: `edited task "${cleanTitle}"${changes.length ? ` · ${changes.join('; ')}` : ''}`,
    target: task.taskId,
    before: `${task.title} | ${task.branch} | ${task.location} | ${task.priority} | ${task.dueAt} ${task.dueTime || ''} | ${task.repeatMode || 'none'}`,
    after: `${cleanTitle} | ${branch} | ${location} | ${priority} | ${effectiveDueAt} ${cleanDueTime} | ${repeatMode}`,
  });
}

export async function deleteTaskRecord(params: {
  task: TaskDoc;
  actor: DirectoryEntry;
}): Promise<void> {
  const { task, actor } = params;
  try {
    await deleteDoc(doc(db, 'tasks', task.taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `tasks/${task.taskId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Delete',
    action: `deleted task "${task.title}" · ${task.branch} · ${task.location} · due ${task.dueAt}`,
    target: task.taskId,
    before: `${task.title} (${task.status}, stage ${task.stage}/${task.path.length})`,
    after: 'deleted',
  });
}

export async function attachTaskProof(params: {
  task: TaskDoc;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  actor: DirectoryEntry;
}): Promise<void> {
  const { task, fileName, fileType, fileSizeBytes, actor } = params;
  const sizeKb = Math.max(1, Math.round(fileSizeBytes / 1024));
  const descriptor = `${fileName.slice(0, 80)} (${fileType.includes('pdf') ? 'PDF' : 'Image'}, ${sizeKb} KB, uploaded ${todayStr()} by ${actor.name})`.slice(0, 200);
  const updatedProofs = [...(task.proofs || []), descriptor].slice(0, 10);

  try {
    await updateDoc(doc(db, 'tasks', task.taskId), {
      proofs: updatedProofs,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.taskId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Upload',
    action: `attached proof "${fileName}" (${sizeKb} KB) to task "${task.title}"`,
    target: task.taskId,
  });
}

export async function saveWorkflowPathTemplate(params: {
  name: string;
  stages: string[];
  actor: DirectoryEntry;
}): Promise<void> {
  const pathId = randomId('path');
  const cleanStages = params.stages.filter(Boolean).slice(0, 12);
  try {
    await setDoc(doc(db, 'paths', pathId), {
      pathId,
      name: params.name.trim().slice(0, 100),
      stages: cleanStages,
      orgId: ORG_ID,
      createdBy: params.actor.name.slice(0, 100),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `paths/${pathId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Task',
    action: `saved workflow path template "${params.name.trim()}" (${cleanStages.join(' › ')})`,
    target: pathId,
  });
}

// ===== ATTENDANCE =====

export async function clockInToday(actor: DirectoryEntry): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const date = todayStr();
  const time = nowTimeStr();
  const recordId = safeDocId(`${actor.empId}_${date}`);

  try {
    await setDoc(doc(db, 'attendance', recordId), {
      recordId,
      uid: actor.empId,
      employeeName: actor.name.slice(0, 100),
      date,
      in: time,
      out: '',
      breaks: [],
      location: actor.location.slice(0, 60),
      note: '',
      correctedBy: '',
      actorUid: uid,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `attendance/${recordId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Attendance',
    action: `clocked in at ${time}`,
    target: recordId,
  });

  return time;
}

export async function toggleBreakToday(
  rec: AttendanceRecord,
  actor: DirectoryEntry
): Promise<{ started: boolean; time: string }> {
  const time = nowTimeStr();
  const breaks = [...(rec.breaks || [])];
  const last = breaks[breaks.length - 1];
  let started = false;

  if (last && last.endsWith('-')) {
    breaks[breaks.length - 1] = `${last}${time}`;
    started = false;
  } else {
    if (breaks.length >= 10) throw new Error('Maximum 10 breaks per day reached.');
    breaks.push(`${time}-`);
    started = true;
  }

  try {
    await updateDoc(doc(db, 'attendance', rec.recordId), {
      breaks,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `attendance/${rec.recordId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Attendance',
    action: started ? `started break at ${time}` : `ended break at ${time}`,
    target: rec.recordId,
  });

  return { started, time };
}

export async function clockOutToday(
  rec: AttendanceRecord,
  actor: DirectoryEntry,
  workedLabel: string
): Promise<string> {
  const time = nowTimeStr();
  // Auto-close any open break on clock out
  const breaks = (rec.breaks || []).map((b) => (b.endsWith('-') ? `${b}${time}` : b));

  try {
    await updateDoc(doc(db, 'attendance', rec.recordId), {
      out: time,
      breaks,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `attendance/${rec.recordId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Attendance',
    action: `clocked out at ${time} · ${workedLabel} worked`,
    target: rec.recordId,
  });

  return time;
}

export async function correctAttendanceRecord(params: {
  targetEmployee: DirectoryEntry;
  date: string;
  inTime: string;
  outTime: string;
  reason: string;
  existingRec?: AttendanceRecord;
  actor: DirectoryEntry;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const recordId = safeDocId(`${params.targetEmployee.empId}_${params.date}`);

  try {
    if (params.existingRec) {
      await updateDoc(doc(db, 'attendance', recordId), {
        in: params.inTime,
        out: params.outTime,
        note: params.reason.trim().slice(0, 300),
        correctedBy: params.actor.name.slice(0, 100),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'attendance', recordId), {
        recordId,
        uid: params.targetEmployee.empId,
        employeeName: params.targetEmployee.name.slice(0, 100),
        date: params.date,
        in: params.inTime,
        out: params.outTime,
        breaks: [],
        location: params.targetEmployee.location.slice(0, 60),
        note: params.reason.trim().slice(0, 300),
        correctedBy: params.actor.name.slice(0, 100),
        actorUid: uid,
        orgId: ORG_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendance/${recordId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Attendance',
    action: `corrected attendance for ${params.targetEmployee.name} on ${params.date} (${params.inTime || '-'} to ${params.outTime || '-'}) · reason: ${params.reason.trim()}`,
    target: recordId,
    before: params.existingRec ? `${params.existingRec.in}-${params.existingRec.out}` : 'none',
    after: `${params.inTime}-${params.outTime}`,
  });
}

export async function saveAttendanceSettings(
  next: Omit<AttendanceSettings, 'updatedAt'>,
  prev: AttendanceSettings,
  actor: DirectoryEntry
): Promise<void> {
  try {
    await setDoc(doc(db, 'settings', 'attendance'), {
      ...next,
      orgId: ORG_ID,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'settings/attendance');
  }

  const changes: string[] = [];
  if ([...prev.wd].sort().join() !== [...next.wd].sort().join()) {
    changes.push(`working days updated`);
  }
  if (prev.st !== next.st || prev.en !== next.en) {
    changes.push(`shift ${prev.st}-${prev.en} to ${next.st}-${next.en}`);
  }
  if (prev.gr !== next.gr) {
    changes.push(`grace ${prev.gr} to ${next.gr} min`);
  }
  if (changes.length) {
    await logAuditEvent({
      actor: actor.name,
      actorUserId: actor.empId,
      category: 'Attendance',
      action: `changed attendance settings: ${changes.join('; ')}`,
      target: 'settings/attendance',
    });
  }
}

export async function addHolidayRecord(params: {
  date: string;
  name: string;
  location: string;
  actor: DirectoryEntry;
}): Promise<void> {
  const holidayId = randomId('hol');
  try {
    await setDoc(doc(db, 'holidays', holidayId), {
      holidayId,
      date: params.date,
      location: params.location || 'All',
      name: params.name.trim().slice(0, 100),
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `holidays/${holidayId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Attendance',
    action: `added holiday ${params.date} · ${params.name.trim()} (${params.location || 'All'})`,
    target: holidayId,
  });
}

export async function removeHolidayRecord(
  holiday: Holiday,
  actor: DirectoryEntry
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'holidays', holiday.holidayId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `holidays/${holiday.holidayId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Delete',
    action: `removed holiday ${holiday.date} · ${holiday.name}`,
    target: holiday.holidayId,
  });
}

// ===== ROLES =====

export async function createCustomRole(params: {
  name: string;
  branchScope: string;
  locationScope: string;
  permissions: number[];
  permNames: string[];
  actor: DirectoryEntry;
  actorPermissions?: number[];
}): Promise<void> {
  const cleanName = params.name.trim().slice(0, 60);
  if (!isDeveloperRole(params.actor.role)) {
    if (!canManageTargetRole(params.actor.role, cleanName)) {
      throw new Error('You can only create roles strictly lower than your own role.');
    }
    if (params.permissions.includes(6)) {
      throw new Error('Only a Developer can grant Manage users permission.');
    }
    if (
      params.actorPermissions &&
      params.permissions.some((p) => !params.actorPermissions!.includes(p))
    ) {
      throw new Error('You cannot grant permissions that your own role does not have.');
    }
  }

  const cleanPerms = Array.from(
    new Set(
      params.permissions.filter(
        (p) => Number.isInteger(p) && p >= 0 && p < PERMISSIONS.length
      )
    )
  ).sort((a, b) => a - b);

  const roleId = randomId('role');
  try {
    await setDoc(doc(db, 'roles', roleId), {
      roleId,
      name: cleanName,
      branchScope: params.branchScope.slice(0, 80),
      locationScope: params.locationScope.slice(0, 80),
      permissions: cleanPerms,
      builtin: false,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `roles/${roleId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Role',
    action: `created role "${cleanName}" · ${params.branchScope} / ${params.locationScope} · permissions: ${params.permNames.join(', ') || 'none'}`,
    target: roleId,
  });
}

export async function updateRoleRecord(params: {
  role: RoleDefinition;
  newName: string;
  branchScope: string;
  locationScope: string;
  permissions: number[];
  directory: DirectoryEntry[];
  summary: string;
  actor: DirectoryEntry;
  actorPermissions?: number[];
}): Promise<void> {
  const { role, newName, branchScope, locationScope, permissions, directory, summary, actor, actorPermissions } =
    params;

  if (!isDeveloperRole(actor.role)) {
    if (!canManageTargetRole(actor.role, role.name) || !canManageTargetRole(actor.role, newName)) {
      throw new Error('You cannot edit your own role or any upper role.');
    }
    if (permissions.includes(6)) {
      throw new Error('Only a Developer can grant Manage users permission.');
    }
    if (actorPermissions && permissions.some((p) => !actorPermissions.includes(p))) {
      throw new Error('You cannot grant permissions that your own role does not have.');
    }
  }

  const cleanPerms = Array.from(
    new Set(
      permissions.filter((p) => Number.isInteger(p) && p >= 0 && p < PERMISSIONS.length)
    )
  ).sort((a, b) => a - b);

  const batch = writeBatch(db);
  batch.update(doc(db, 'roles', role.roleId), {
    name: newName.slice(0, 60),
    branchScope: branchScope.slice(0, 80),
    locationScope: locationScope.slice(0, 80),
    permissions: cleanPerms,
    updatedAt: serverTimestamp(),
  });

  if (newName !== role.name) {
    directory
      .filter((d) => d.role === role.name)
      .forEach((d) => {
        batch.update(doc(db, 'directory', d.docId), {
          role: newName.slice(0, 60),
          updatedAt: serverTimestamp(),
        });
      });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `roles/${role.roleId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Role',
    action: `updated role "${newName}": ${summary}`,
    target: role.roleId,
  });
}

// ===== USER MANAGEMENT & PROFILE =====

export async function adminCreateUser(params: {
  empId: string;
  name: string;
  password: string;
  role: string;
  branch: string;
  location: string;
  actor: DirectoryEntry;
}): Promise<void> {
  if (!canManageTargetRole(params.actor.role, params.role)) {
    throw new Error('You can only assign roles strictly lower than your own role.');
  }

  const empId = params.empId.trim().toLowerCase();
  const docId = safeDocId(empId);
  const provisioned = await provisionEmployeeAuthAccount(empId, params.password, 1);

  const salt = generateSalt();
  const passwordHash = await hashPassword(params.password, salt);
  const batch = writeBatch(db);

  batch.set(doc(db, 'directory', docId), {
    empId,
    docId,
    name: params.name.trim().slice(0, 100),
    role: params.role.slice(0, 60),
    branch: params.branch.slice(0, 60),
    location: params.location.slice(0, 60),
    designation: '',
    joinedAt: todayStr(),
    photoUrl: '',
    active: true,
    authUid: provisioned.uid,
    orgId: ORG_ID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'users', docId), {
    empId,
    docId,
    authUid: provisioned.uid,
    email: provisioned.email,
    phone: '',
    passwordHash,
    passwordSalt: salt,
    twoStepEnabled: ['Developer', 'Company Owner'].includes(params.role),
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'authBindings', provisioned.uid), {
    uid: provisioned.uid,
    empId,
    docId,
    role: params.role.slice(0, 60),
    active: true,
    loginVersion: provisioned.loginVersion,
    orgId: ORG_ID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (
    isDeveloperRole(params.actor.role) &&
    (params.role === 'Developer' || params.role === 'Company Owner')
  ) {
    batch.set(doc(db, 'admins', provisioned.uid), {
      uid: provisioned.uid,
      email: provisioned.email.slice(0, 200),
      role: params.role,
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `directory/${docId}`);
  }

  await syncLoginSlotsToServer({ [docId]: provisioned.loginVersion });

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'User',
    action: `created user @${empId} · ${params.name.trim()} · ${params.role} · ${params.branch} · ${params.location}`,
    target: empId,
  });
}

export async function adminUpdateUser(params: {
  target: DirectoryEntry;
  name: string;
  role: string;
  branch: string;
  location: string;
  tasks: TaskDoc[];
  directory: DirectoryEntry[];
  actor: DirectoryEntry;
}): Promise<void> {
  const { target, name, role, branch, location, tasks, directory, actor } = params;

  if (!canManageUser(actor, target)) {
    throw new Error('You can only edit users with a role strictly lower than your own.');
  }
  if (!canManageTargetRole(actor.role, role)) {
    throw new Error('You cannot assign your own role or an upper role.');
  }
  if (
    target.role === 'Developer' &&
    role !== 'Developer' &&
    directory.filter((d) => d.active && d.role === 'Developer').length < 2
  ) {
    throw new Error('At least one Developer account must remain.');
  }

  const cleanName = name.trim().slice(0, 100);
  const batch = writeBatch(db);

  batch.update(doc(db, 'directory', target.docId), {
    name: cleanName,
    role: role.slice(0, 60),
    branch: branch.slice(0, 60),
    location: location.slice(0, 60),
    updatedAt: serverTimestamp(),
  });

  // Keep /authBindings/{authUid} role in sync if this user has a bound password login
  if (target.authUid && role !== target.role) {
    const bindingRef = doc(db, 'authBindings', target.authUid);
    const bindingSnap = await getDoc(bindingRef).catch(() => null);
    if (bindingSnap?.exists()) {
      batch.update(bindingRef, {
        role: role.slice(0, 60),
        updatedAt: serverTimestamp(),
      });
    }
  }

  // Keep /admins/{authUid} in sync when Developer promotes/demotes a linked user
  if (isDeveloperRole(actor.role) && target.authUid && role !== target.role) {
    const isNextAdmin = role === 'Developer' || role === 'Company Owner';
    const wasAdmin = target.role === 'Developer' || target.role === 'Company Owner';
    if (isNextAdmin) {
      const admRef = doc(db, 'admins', target.authUid);
      const admSnap = await getDoc(admRef).catch(() => null);
      if (admSnap?.exists()) {
        batch.update(admRef, { role });
      } else {
        const priv = await getUserPrivateRecord(target.empId).catch(() => null);
        batch.set(admRef, {
          uid: target.authUid,
          email: (priv?.email || `${target.empId}@kejmin.in`).slice(0, 200),
          role,
          createdAt: serverTimestamp(),
        });
      }
    } else if (wasAdmin && target.authUid !== auth.currentUser?.uid) {
      batch.delete(doc(db, 'admins', target.authUid));
    }
  }

  // Propagate employee rename to open task paths
  if (cleanName !== target.name) {
    tasks
      .filter((t) => t.path.includes(target.name))
      .forEach((t) => {
        batch.update(doc(db, 'tasks', t.taskId), {
          path: t.path.map((p) => (p === target.name ? cleanName : p)),
          updatedAt: serverTimestamp(),
        });
      });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `directory/${target.docId}`);
  }

  const ch: string[] = [];
  if (target.name !== cleanName) ch.push(`name "${target.name}" to "${cleanName}"`);
  if (target.role !== role) ch.push(`role ${target.role} to ${role}`);
  if (target.branch !== branch) ch.push(`branch ${target.branch} to ${branch}`);
  if (target.location !== location) ch.push(`location ${target.location} to ${location}`);

  if (ch.length) {
    await logAuditEvent({
      actor: actor.name,
      actorUserId: actor.empId,
      category: 'User',
      action: `updated @${target.empId}: ${ch.join('; ')}`,
      target: target.empId,
    });
  }
}

export async function adminResetPassword(params: {
  target: DirectoryEntry;
  newPassword: string;
  actor: DirectoryEntry;
}): Promise<void> {
  if (!canManageUser(params.actor, params.target)) {
    throw new Error('You can only reset passwords for users strictly lower than your own role.');
  }

  const oldUid = params.target.authUid || '';
  let currentVersion = 0;
  let hadOldBinding = false;
  if (oldUid) {
    const oldBindSnap = await getDoc(doc(db, 'authBindings', oldUid)).catch(() => null);
    if (oldBindSnap?.exists()) {
      hadOldBinding = true;
      const v = Number(oldBindSnap.data()?.loginVersion);
      if (Number.isInteger(v) && v >= 1) {
        currentVersion = v;
      }
    }
  }

  const provisioned = await provisionEmployeeAuthAccount(
    params.target.empId,
    params.newPassword,
    currentVersion + 1
  );

  const salt = generateSalt();
  const passwordHash = await hashPassword(params.newPassword, salt);
  const batch = writeBatch(db);

  batch.update(doc(db, 'directory', params.target.docId), {
    authUid: provisioned.uid,
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'users', params.target.docId), {
    authUid: provisioned.uid,
    email: provisioned.email,
    passwordHash,
    passwordSalt: salt,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'authBindings', provisioned.uid), {
    uid: provisioned.uid,
    empId: params.target.empId,
    docId: params.target.docId,
    role: params.target.role.slice(0, 60),
    active: params.target.active,
    loginVersion: provisioned.loginVersion,
    orgId: ORG_ID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (hadOldBinding && oldUid && oldUid !== provisioned.uid) {
    batch.delete(doc(db, 'authBindings', oldUid));
  }

  if (
    isDeveloperRole(params.actor.role) &&
    (params.target.role === 'Developer' || params.target.role === 'Company Owner')
  ) {
    batch.set(doc(db, 'admins', provisioned.uid), {
      uid: provisioned.uid,
      email: provisioned.email.slice(0, 200),
      role: params.target.role,
      createdAt: serverTimestamp(),
    });
    if (oldUid && oldUid !== provisioned.uid && oldUid !== auth.currentUser?.uid) {
      const oldAdmSnap = await getDoc(doc(db, 'admins', oldUid)).catch(() => null);
      if (oldAdmSnap?.exists()) {
        batch.delete(doc(db, 'admins', oldUid));
      }
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${params.target.docId}`);
  }

  await syncLoginSlotsToServer({ [params.target.docId]: provisioned.loginVersion });

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Security',
    action: `reset password for @${params.target.empId} (${params.target.name})`,
    target: params.target.empId,
  });
}

export async function adminDeleteUser(params: {
  target: DirectoryEntry;
  directory: DirectoryEntry[];
  actor: DirectoryEntry;
}): Promise<void> {
  if (params.target.empId === params.actor.empId) {
    throw new Error('You cannot delete the account you are signed in with.');
  }
  if (!canManageUser(params.actor, params.target)) {
    throw new Error('You can only delete users with a role strictly lower than your own.');
  }
  if (
    params.target.role === 'Developer' &&
    params.directory.filter((d) => d.active && d.role === 'Developer').length < 2
  ) {
    throw new Error('At least one Developer account must remain.');
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, 'directory', params.target.docId));
  batch.delete(doc(db, 'users', params.target.docId));
  if (params.target.authUid && params.target.authUid !== auth.currentUser?.uid) {
    const bindingSnap = await getDoc(doc(db, 'authBindings', params.target.authUid)).catch(
      () => null
    );
    if (bindingSnap?.exists()) {
      batch.delete(doc(db, 'authBindings', params.target.authUid));
    }
  }
  if (
    isDeveloperRole(params.actor.role) &&
    params.target.authUid &&
    params.target.authUid !== auth.currentUser?.uid
  ) {
    const admSnap = await getDoc(doc(db, 'admins', params.target.authUid)).catch(() => null);
    if (admSnap?.exists()) {
      batch.delete(doc(db, 'admins', params.target.authUid));
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `directory/${params.target.docId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Delete',
    action: `deleted user @${params.target.empId} · ${params.target.name} · ${params.target.role} · ${params.target.location}`,
    target: params.target.empId,
  });
}

export async function updateOwnProfile(params: {
  me: DirectoryEntry;
  name: string;
  phone: string;
  designation: string;
}): Promise<void> {
  const cleanName = params.name.trim().slice(0, 100);
  const batch = writeBatch(db);

  batch.update(doc(db, 'directory', params.me.docId), {
    name: cleanName,
    designation: params.designation.trim().slice(0, 100),
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'users', params.me.docId), {
    phone: params.phone.trim().slice(0, 30),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `directory/${params.me.docId}`);
  }

  await logAuditEvent({
    actor: cleanName,
    actorUserId: params.me.empId,
    category: 'User',
    action: `updated @${params.me.empId}: profile details`,
    target: params.me.empId,
  });
}

export async function updateOwnPhoto(me: DirectoryEntry, photoUrl: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'directory', me.docId), {
      photoUrl: photoUrl.slice(0, 300000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `directory/${me.docId}`);
  }

  await logAuditEvent({
    actor: me.name,
    actorUserId: me.empId,
    category: 'User',
    action: `updated @${me.empId}: ${photoUrl ? 'profile picture changed' : 'profile picture removed'}`,
    target: me.empId,
  });
}

export async function changeOwnPassword(params: {
  me: DirectoryEntry;
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  const priv = await getUserPrivateRecord(params.me.empId);
  if (!priv) return { ok: false, error: 'Account credentials record not found.' };
  const matched = await verifyPassword(
    params.currentPassword,
    priv.passwordSalt,
    priv.passwordHash
  );
  if (!matched) {
    return { ok: false, error: 'Current password is incorrect.' };
  }

  const fbUser = auth.currentUser;
  const usesPasswordProvider = !!fbUser?.providerData.some((p) => p.providerId === 'password');

  if (usesPasswordProvider) {
    try {
      await updateOwnFirebasePassword(params.currentPassword, params.newPassword);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        return { ok: false, error: 'Current password is incorrect.' };
      }
      if (code === 'auth/weak-password') {
        return { ok: false, error: 'New password must be at least 6 characters.' };
      }
      if (code === 'auth/requires-recent-login') {
        return {
          ok: false,
          error: 'Please sign out and sign in again before changing your password.',
        };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to update login password.',
      };
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(params.newPassword, salt);
    try {
      await updateDoc(doc(db, 'users', params.me.docId), {
        passwordHash,
        passwordSalt: salt,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${params.me.docId}`);
    }
  } else if (isDeveloperRole(params.me.role) || params.me.role === 'Company Owner') {
    // Signed in via Google as Admin/Developer: provision/rotate the Email/Password binding so User ID + Password stays in sync
    const oldUid = params.me.authUid || '';
    let currentVersion = 0;
    let hadOldBinding = false;
    if (oldUid) {
      const oldBindSnap = await getDoc(doc(db, 'authBindings', oldUid)).catch(() => null);
      if (oldBindSnap?.exists()) {
        hadOldBinding = true;
        const v = Number(oldBindSnap.data()?.loginVersion);
        if (Number.isInteger(v) && v >= 1) {
          currentVersion = v;
        }
      }
    }

    let provisioned: { uid: string; email: string; loginVersion: number };
    try {
      provisioned = await provisionEmployeeAuthAccount(
        params.me.empId,
        params.newPassword,
        currentVersion + 1
      );
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to update login password.',
      };
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(params.newPassword, salt);
    const batch = writeBatch(db);

    batch.update(doc(db, 'directory', params.me.docId), {
      authUid: provisioned.uid,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', params.me.docId), {
      authUid: provisioned.uid,
      email: provisioned.email,
      passwordHash,
      passwordSalt: salt,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'authBindings', provisioned.uid), {
      uid: provisioned.uid,
      empId: params.me.empId,
      docId: params.me.docId,
      role: params.me.role.slice(0, 60),
      active: params.me.active,
      loginVersion: provisioned.loginVersion,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (hadOldBinding && oldUid && oldUid !== provisioned.uid) {
      batch.delete(doc(db, 'authBindings', oldUid));
    }
    if (isDeveloperRole(params.me.role)) {
      batch.set(doc(db, 'admins', provisioned.uid), {
        uid: provisioned.uid,
        email: provisioned.email.slice(0, 200),
        role: params.me.role,
        createdAt: serverTimestamp(),
      });
      if (oldUid && oldUid !== provisioned.uid && oldUid !== fbUser?.uid) {
        const oldAdmSnap = await getDoc(doc(db, 'admins', oldUid)).catch(() => null);
        if (oldAdmSnap?.exists()) {
          batch.delete(doc(db, 'admins', oldUid));
        }
      }
    }

    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${params.me.docId}`);
    }

    await syncLoginSlotsToServer({ [params.me.docId]: provisioned.loginVersion });
  } else {
    const salt = generateSalt();
    const passwordHash = await hashPassword(params.newPassword, salt);
    try {
      await updateDoc(doc(db, 'users', params.me.docId), {
        passwordHash,
        passwordSalt: salt,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${params.me.docId}`);
    }
  }

  await logAuditEvent({
    actor: params.me.name,
    actorUserId: params.me.empId,
    category: 'Security',
    action: 'changed own password',
    target: params.me.empId,
  });

  return { ok: true };
}

// ===== SHARED FOLDER & GOOGLE DRIVE INDEX =====

export async function createSharedFolderRecord(params: {
  name: string;
  parentId: string;
  driveFolderId: string;
  driveUrl: string;
  branch: string;
  location: string;
  accessScope: ShareAccessScope;
  allowedEmpIds: string[];
  description: string;
  actor: DirectoryEntry;
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const folderId = randomId('fld');
  const cleanName = params.name.trim().slice(0, 100);
  if (!cleanName) throw new Error('Folder name is required.');
  const allowedEmpIds =
    params.accessScope === 'selected'
      ? Array.from(new Set(params.allowedEmpIds.filter(Boolean))).slice(0, 50)
      : [];

  try {
    await setDoc(doc(db, 'sharedFolders', folderId), {
      folderId,
      name: cleanName,
      parentId: (params.parentId || '').slice(0, 64),
      driveFolderId: (params.driveFolderId || '').slice(0, 128),
      driveUrl: (params.driveUrl || '').slice(0, 500),
      branch: (params.branch || 'All').slice(0, 60),
      location: (params.location || 'All').slice(0, 60),
      accessScope: params.accessScope,
      allowedEmpIds,
      description: (params.description || '').trim().slice(0, 300),
      createdBy: params.actor.name.slice(0, 100),
      createdByEmpId: params.actor.empId.slice(0, 32),
      createdByUid: uid,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `sharedFolders/${folderId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Upload',
    action: `created shared folder "${cleanName}" (${params.accessScope} access${params.driveFolderId ? ', synced to Google Drive' : ''})`,
    target: folderId,
  });

  return folderId;
}

export async function updateSharedFolderRecord(params: {
  folder: SharedFolderDoc;
  name: string;
  parentId?: string;
  branch: string;
  location: string;
  accessScope: ShareAccessScope;
  allowedEmpIds: string[];
  description: string;
  actor: DirectoryEntry;
}): Promise<void> {
  const cleanName = params.name.trim().slice(0, 100);
  if (!cleanName) throw new Error('Folder name is required.');
  const allowedEmpIds =
    params.accessScope === 'selected'
      ? Array.from(new Set(params.allowedEmpIds.filter(Boolean))).slice(0, 50)
      : [];

  const nextParentId =
    typeof params.parentId === 'string'
      ? params.parentId.slice(0, 64)
      : params.folder.parentId;

  try {
    await updateDoc(doc(db, 'sharedFolders', params.folder.folderId), {
      name: cleanName,
      parentId: nextParentId,
      branch: (params.branch || 'All').slice(0, 60),
      location: (params.location || 'All').slice(0, 60),
      accessScope: params.accessScope,
      allowedEmpIds,
      description: (params.description || '').trim().slice(0, 300),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sharedFolders/${params.folder.folderId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Upload',
    action: `updated shared folder "${cleanName}" (access: ${params.accessScope})`,
    target: params.folder.folderId,
    before: `${params.folder.name} (${params.folder.accessScope})`,
    after: `${cleanName} (${params.accessScope})`,
  });
}

export async function deleteSharedFolderRecord(params: {
  folder: SharedFolderDoc;
  actor: DirectoryEntry;
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'sharedFolders', params.folder.folderId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `sharedFolders/${params.folder.folderId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Delete',
    action: `deleted shared folder "${params.folder.name}"`,
    target: params.folder.folderId,
    before: params.folder.name,
    after: 'deleted',
  });
}

export async function createSharedFileRecord(params: {
  folderId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  driveFileId: string;
  webViewLink: string;
  webContentLink: string;
  branch: string;
  location: string;
  category: string;
  description: string;
  accessScope: ShareAccessScope;
  allowedEmpIds: string[];
  allowDownload: boolean;
  actor: DirectoryEntry;
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const fileId = randomId('shf');
  const cleanName = String(params.name ?? '').trim().slice(0, 200);
  if (!cleanName) throw new Error('Uploaded file name is missing.');
  const cleanDriveFileId = String(params.driveFileId ?? '').trim().slice(0, 128);
  if (!cleanDriveFileId) throw new Error('Google Drive file ID is missing from upload response.');
  const cleanWebView =
    String(params.webViewLink ?? '').trim().slice(0, 600) ||
    `https://drive.google.com/file/d/${cleanDriveFileId}/view`;
  const cleanWebContent =
    String(params.webContentLink ?? '').trim().slice(0, 600) ||
    `https://drive.google.com/uc?id=${cleanDriveFileId}&export=download`;
  const allowedEmpIds =
    params.accessScope === 'selected'
      ? Array.from(new Set((params.allowedEmpIds || []).filter(Boolean))).slice(0, 50)
      : [];

  try {
    await setDoc(doc(db, 'sharedFiles', fileId), {
      fileId,
      folderId: String(params.folderId ?? '').slice(0, 64),
      name: cleanName,
      mimeType: (String(params.mimeType ?? '').trim() || 'application/octet-stream').slice(0, 120),
      sizeBytes: Math.max(0, Math.round(Number(params.sizeBytes) || 0)),
      driveFileId: cleanDriveFileId,
      webViewLink: cleanWebView,
      webContentLink: cleanWebContent,
      branch: (String(params.branch ?? '').trim() || 'All').slice(0, 60),
      location: (String(params.location ?? '').trim() || 'All').slice(0, 60),
      category: (String(params.category ?? '').trim() || 'General').slice(0, 60),
      description: String(params.description ?? '').trim().slice(0, 400),
      accessScope: params.accessScope,
      allowedEmpIds,
      allowDownload: Boolean(params.allowDownload),
      uploadedBy: (String(params.actor?.name ?? '').trim() || 'User').slice(0, 100),
      uploadedByEmpId: (String(params.actor?.empId ?? '').trim() || 'user').slice(0, 32),
      uploadedByUid: uid,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `sharedFiles/${fileId}`);
  }

  await logAuditEvent({
    actor: String(params.actor?.name ?? 'User'),
    actorUserId: String(params.actor?.empId ?? ''),
    category: 'Upload',
    action: `uploaded "${cleanName}" to Google Drive Share Folder (${params.category} · ${params.accessScope} access)`,
    target: fileId,
  });

  return fileId;
}

export async function updateSharedFileRecord(params: {
  file: SharedFileDoc;
  name: string;
  folderId: string;
  branch: string;
  location: string;
  category: string;
  description: string;
  accessScope: ShareAccessScope;
  allowedEmpIds: string[];
  allowDownload: boolean;
  sizeBytes?: number;
  mimeType?: string;
  actor: DirectoryEntry;
}): Promise<void> {
  const cleanName = params.name.trim().slice(0, 200);
  if (!cleanName) throw new Error('File name is required.');
  const allowedEmpIds =
    params.accessScope === 'selected'
      ? Array.from(new Set(params.allowedEmpIds.filter(Boolean))).slice(0, 50)
      : [];

  const updatePayload: Record<string, unknown> = {
    name: cleanName,
    folderId: (params.folderId || '').slice(0, 64),
    branch: (params.branch || 'All').slice(0, 60),
    location: (params.location || 'All').slice(0, 60),
    category: (params.category || 'General').slice(0, 60),
    description: (params.description || '').trim().slice(0, 400),
    accessScope: params.accessScope,
    allowedEmpIds,
    allowDownload: Boolean(params.allowDownload),
    updatedAt: serverTimestamp(),
  };
  if (typeof params.sizeBytes === 'number' && Number.isFinite(params.sizeBytes) && params.sizeBytes >= 0) {
    updatePayload.sizeBytes = Math.round(params.sizeBytes);
  }
  if (typeof params.mimeType === 'string' && params.mimeType.trim()) {
    updatePayload.mimeType = params.mimeType.trim().slice(0, 120);
  }

  try {
    await updateDoc(doc(db, 'sharedFiles', params.file.fileId), updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sharedFiles/${params.file.fileId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Upload',
    action: `updated shared file "${cleanName}" (${params.category} · access: ${params.accessScope})`,
    target: params.file.fileId,
    before: `${params.file.name} (${params.file.accessScope})`,
    after: `${cleanName} (${params.accessScope})`,
  });
}

export async function deleteSharedFileRecord(params: {
  file: SharedFileDoc;
  removedFromDrive: boolean;
  actor: DirectoryEntry;
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'sharedFiles', params.file.fileId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `sharedFiles/${params.file.fileId}`);
  }

  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Delete',
    action: `deleted shared file "${params.file.name}"${params.removedFromDrive ? ' (also removed from Google Drive)' : ' (removed from Share Folder index)'}`,
    target: params.file.fileId,
    before: params.file.name,
    after: 'deleted',
  });
}

// ===== DEVELOPER DATA RESET (START FRESH FROM SCRATCH) =====

export interface ResetDataScope {
  resetTasks: boolean;
  resetKpi: boolean;
  resetAttendance: boolean;
  resetLogs: boolean;
}

export interface ResetDataResult {
  deletedTasks: number;
  deletedNotifications: number;
  deletedKpi: number;
  deletedAttendance: number;
  deletedLogs: number;
}

async function deleteCollectionRecords(collectionName: string): Promise<number> {
  let snap;
  try {
    snap = await getDocs(query(collection(db, collectionName), where('orgId', '==', ORG_ID)));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, collectionName);
    return 0;
  }

  const docs = snap.docs;
  if (docs.length === 0) return 0;

  const CHUNK_SIZE = 400;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((d) => batch.delete(d.ref));
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, collectionName);
    }
  }
  return docs.length;
}

export async function resetOrganizationData(params: {
  scope: ResetDataScope;
  actor: DirectoryEntry;
}): Promise<ResetDataResult> {
  const { scope, actor } = params;
  if (!isDeveloperRole(actor.role)) {
    throw new Error('Only a Developer can reset organization data.');
  }
  if (!scope.resetTasks && !scope.resetKpi && !scope.resetAttendance && !scope.resetLogs) {
    throw new Error('Select at least one data section to reset.');
  }

  const result: ResetDataResult = {
    deletedTasks: 0,
    deletedNotifications: 0,
    deletedKpi: 0,
    deletedAttendance: 0,
    deletedLogs: 0,
  };

  const parts: string[] = [];

  if (scope.resetTasks) {
    result.deletedTasks = await deleteCollectionRecords('tasks');
    result.deletedNotifications = await deleteCollectionRecords('notifications');
    parts.push(`Tasks (${result.deletedTasks} tasks, ${result.deletedNotifications} alerts)`);
  }

  if (scope.resetKpi) {
    result.deletedKpi = await deleteCollectionRecords('scoreEvents');
    parts.push(`KPI points (${result.deletedKpi} score events → reset to 0)`);
  }

  if (scope.resetAttendance) {
    result.deletedAttendance = await deleteCollectionRecords('attendance');
    parts.push(`Attendance & report records (${result.deletedAttendance} records)`);
  }

  if (scope.resetLogs) {
    result.deletedLogs = await deleteCollectionRecords('auditLog');
    parts.push(`Activity log (${result.deletedLogs} previous entries)`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Delete',
    action: `reset data from scratch: ${parts.join(' · ')}`,
    target: 'org_reset',
    before: parts.join(', '),
    after: 'reset to 0',
  });

  return result;
}

// ===== CALENDAR STICKY-NOTE TO-DO LIST =====

export async function createCalendarTodo(params: {
  date: string;
  text: string;
  color: TodoNoteColor;
  actor: DirectoryEntry;
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const cleanText = params.text.trim().slice(0, 240);
  if (!cleanText) throw new Error('Please enter a to-do item.');
  const todoId = randomId('td');
  const path = `calendarTodos/${todoId}`;
  try {
    await setDoc(doc(db, 'calendarTodos', todoId), {
      todoId,
      empId: params.actor.empId.slice(0, 32),
      employeeName: params.actor.name.slice(0, 100),
      date: params.date.slice(0, 10),
      text: cleanText,
      done: false,
      color: params.color,
      actorUid: uid,
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
  return todoId;
}

export async function updateCalendarTodo(params: {
  todo: CalendarTodo;
  text?: string;
  done?: boolean;
  color?: TodoNoteColor;
  date?: string;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (typeof params.text === 'string') {
    const clean = params.text.trim().slice(0, 240);
    if (!clean) throw new Error('To-do text cannot be empty.');
    payload.text = clean;
  }
  if (typeof params.done === 'boolean') {
    payload.done = params.done;
  }
  if (params.color) {
    payload.color = params.color;
  }
  if (params.date) {
    payload.date = params.date.slice(0, 10);
  }
  const path = `calendarTodos/${params.todo.todoId}`;
  try {
    await updateDoc(doc(db, 'calendarTodos', params.todo.todoId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCalendarTodo(todoId: string): Promise<void> {
  const path = `calendarTodos/${todoId}`;
  try {
    await deleteDoc(doc(db, 'calendarTodos', todoId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ===== SUPPORT TICKETS =====

export interface PendingTicketAttachment {
  name: string;
  type: string;
  size: number;
  cat: TicketAttachmentCategory;
  data: string;
}

function nowTicketTimestamp(): string {
  return new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function subscribeTicketAttachments(
  ticketId: string,
  onChange: (items: TicketAttachmentDoc[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'ticketAttachments'),
    where('orgId', '==', ORG_ID),
    where('ticketId', '==', ticketId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => d.data() as TicketAttachmentDoc)
        .sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
      onChange(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, `ticketAttachments?ticketId=${ticketId}`);
    }
  );
}

export async function fetchAllTicketAttachments(): Promise<TicketAttachmentDoc[]> {
  try {
    const q = query(collection(db, 'ticketAttachments'), where('orgId', '==', ORG_ID));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as TicketAttachmentDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'ticketAttachments');
    return [];
  }
}

export async function createSupportTicket(params: {
  title: string;
  desc: string;
  type: string;
  pri: Priority;
  assignee: string;
  incident: string;
  labels: string[];
  pendingAttachments: PendingTicketAttachment[];
  nextTicketNumber: number;
  actor: DirectoryEntry;
}): Promise<{ ticketId: string; ticketNumber: number }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');

  const cleanTitle = params.title.trim().slice(0, 160);
  if (!cleanTitle) throw new Error('Summary is required.');
  const cleanType = params.type.trim().slice(0, 30) || 'task';
  const cleanLabels = params.labels
    .map((l) => l.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 20);
  const cleanAttachments = params.pendingAttachments.slice(0, 20);
  const ticketId = randomId('tkt');
  const ticketNumber = Math.max(1, Math.min(999999, Math.floor(params.nextTicketNumber)));
  const atStr = nowTicketTimestamp();

  const batch = writeBatch(db);
  batch.set(doc(db, 'supportTickets', ticketId), {
    ticketId,
    ticketNumber,
    title: cleanTitle,
    desc: params.desc.slice(0, 4000),
    type: cleanType,
    pri: params.pri,
    status: 'created' as TicketStatus,
    assignee: params.assignee.trim().slice(0, 100),
    reporter: params.actor.name.slice(0, 100),
    reporterEmpId: params.actor.empId.slice(0, 32),
    reporterUid: uid,
    incident: params.incident.trim().slice(0, 25),
    labels: cleanLabels,
    subs: [] as TicketSubtask[],
    comments: [] as TicketComment[],
    log: [{ t: 'Ticket created', at: atStr }] as TicketLogEntry[],
    attachmentCount: cleanAttachments.length,
    orgId: ORG_ID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  cleanAttachments.forEach((att) => {
    const attachmentId = randomId('att');
    batch.set(doc(db, 'ticketAttachments', attachmentId), {
      attachmentId,
      ticketId,
      name: att.name.trim().slice(0, 200) || 'attachment',
      type: att.type.trim().slice(0, 100) || 'application/octet-stream',
      size: Math.max(0, Math.min(2097152, Math.round(att.size))),
      cat: att.cat,
      by: params.actor.name.slice(0, 100),
      byUid: uid,
      at: atStr.slice(0, 40),
      data: att.data.slice(0, 800000),
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
    });
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `supportTickets/${ticketId}`);
  }

  const key = `KEJ-${ticketNumber}`;
  await logAuditEvent({
    actor: params.actor.name,
    actorUserId: params.actor.empId,
    category: 'Ticket',
    action: `created support ticket ${key} "${cleanTitle}" · ${cleanType} · ${params.pri} priority${params.assignee ? ` · assigned to ${params.assignee}` : ''}`,
    target: ticketId,
  }).catch(() => {});

  if (params.assignee && params.assignee !== params.actor.name) {
    await createNotification({
      recipientName: params.assignee,
      title: `Ticket assigned: ${key}`,
      message: `${params.actor.name} assigned you ${key}: "${cleanTitle}" (${params.pri} priority).`,
      type: 'assigned',
      taskId: ticketId,
    }).catch(() => {});
  }

  return { ticketId, ticketNumber };
}

export async function updateSupportTicket(params: {
  ticket: SupportTicketDoc;
  patch: Partial<
    Pick<
      SupportTicketDoc,
      'title' | 'desc' | 'type' | 'pri' | 'status' | 'assignee' | 'incident' | 'labels' | 'subs' | 'comments' | 'attachmentCount'
    >
  >;
  logMessage?: string;
  actor: DirectoryEntry;
}): Promise<void> {
  const { ticket, patch, logMessage, actor } = params;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof patch.title === 'string') {
    const clean = patch.title.trim().slice(0, 160);
    if (!clean) throw new Error('Summary cannot be empty.');
    payload.title = clean;
  }
  if (typeof patch.desc === 'string') {
    payload.desc = patch.desc.slice(0, 4000);
  }
  if (typeof patch.type === 'string') {
    payload.type = patch.type.trim().slice(0, 30) || 'task';
  }
  if (patch.pri) {
    payload.pri = patch.pri;
  }
  if (patch.status) {
    payload.status = patch.status;
  }
  if (typeof patch.assignee === 'string') {
    payload.assignee = patch.assignee.trim().slice(0, 100);
  }
  if (typeof patch.incident === 'string') {
    payload.incident = patch.incident.trim().slice(0, 25);
  }
  if (Array.isArray(patch.labels)) {
    payload.labels = patch.labels.map((l) => l.trim().slice(0, 40)).filter(Boolean).slice(0, 20);
  }
  if (Array.isArray(patch.subs)) {
    payload.subs = patch.subs.slice(0, 50);
  }
  if (Array.isArray(patch.comments)) {
    payload.comments = patch.comments.slice(0, 100);
  }
  if (typeof patch.attachmentCount === 'number') {
    payload.attachmentCount = Math.max(0, Math.min(50, Math.floor(patch.attachmentCount)));
  }

  if (logMessage) {
    const nextLog: TicketLogEntry[] = [
      { t: logMessage.slice(0, 300), at: nowTicketTimestamp() },
      ...(ticket.log || []),
    ].slice(0, 100);
    payload.log = nextLog;
  }

  const path = `supportTickets/${ticket.ticketId}`;
  try {
    await updateDoc(doc(db, 'supportTickets', ticket.ticketId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  const key = `KEJ-${ticket.ticketNumber}`;
  if (logMessage) {
    await logAuditEvent({
      actor: actor.name,
      actorUserId: actor.empId,
      category: 'Ticket',
      action: `updated ${key} "${ticket.title}" · ${logMessage}`,
      target: ticket.ticketId,
    }).catch(() => {});
  }

  if (
    typeof patch.assignee === 'string' &&
    patch.assignee &&
    patch.assignee !== ticket.assignee &&
    patch.assignee !== actor.name
  ) {
    await createNotification({
      recipientName: patch.assignee,
      title: `Ticket assigned: ${key}`,
      message: `${actor.name} assigned you ${key}: "${patch.title || ticket.title}".`,
      type: 'assigned',
      taskId: ticket.ticketId,
    }).catch(() => {});
  }
}

export async function addTicketAttachments(params: {
  ticket: SupportTicketDoc;
  files: PendingTicketAttachment[];
  actor: DirectoryEntry;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const { ticket, files, actor } = params;
  if (!files.length) return;

  const atStr = nowTicketTimestamp();
  const availableSlots = Math.max(0, 50 - (ticket.attachmentCount || 0));
  const toSave = files.slice(0, availableSlots);
  if (!toSave.length) {
    throw new Error('Maximum of 50 attachments per ticket reached.');
  }

  const cat = toSave[0].cat;
  const logMsg = `${toSave.length} file(s) added to ${cat}: ${toSave.map((x) => x.name).join(', ')}`.slice(0, 300);
  const nextLog: TicketLogEntry[] = [{ t: logMsg, at: atStr }, ...(ticket.log || [])].slice(0, 100);

  const batch = writeBatch(db);
  toSave.forEach((att) => {
    const attachmentId = randomId('att');
    batch.set(doc(db, 'ticketAttachments', attachmentId), {
      attachmentId,
      ticketId: ticket.ticketId,
      name: att.name.trim().slice(0, 200) || 'attachment',
      type: att.type.trim().slice(0, 100) || 'application/octet-stream',
      size: Math.max(0, Math.min(2097152, Math.round(att.size))),
      cat: att.cat,
      by: actor.name.slice(0, 100),
      byUid: uid,
      at: atStr.slice(0, 40),
      data: att.data.slice(0, 800000),
      orgId: ORG_ID,
      createdAt: serverTimestamp(),
    });
  });

  batch.update(doc(db, 'supportTickets', ticket.ticketId), {
    attachmentCount: Math.min(50, (ticket.attachmentCount || 0) + toSave.length),
    log: nextLog,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `ticketAttachments/${ticket.ticketId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Upload',
    action: `attached ${toSave.length} file(s) to KEJ-${ticket.ticketNumber} (${cat}): ${toSave.map((x) => x.name).join(', ')}`,
    target: ticket.ticketId,
  }).catch(() => {});
}

export async function removeTicketAttachment(params: {
  ticket: SupportTicketDoc;
  attachment: TicketAttachmentDoc;
  actor: DirectoryEntry;
}): Promise<void> {
  const { ticket, attachment, actor } = params;
  const atStr = nowTicketTimestamp();
  const logMsg = `File removed from ${attachment.cat}: ${attachment.name}`.slice(0, 300);
  const nextLog: TicketLogEntry[] = [{ t: logMsg, at: atStr }, ...(ticket.log || [])].slice(0, 100);

  const batch = writeBatch(db);
  batch.delete(doc(db, 'ticketAttachments', attachment.attachmentId));
  batch.update(doc(db, 'supportTickets', ticket.ticketId), {
    attachmentCount: Math.max(0, (ticket.attachmentCount || 1) - 1),
    log: nextLog,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `ticketAttachments/${attachment.attachmentId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Delete',
    action: `removed attachment "${attachment.name}" from KEJ-${ticket.ticketNumber}`,
    target: ticket.ticketId,
  }).catch(() => {});
}

export async function deleteSupportTicket(params: {
  ticket: SupportTicketDoc;
  actor: DirectoryEntry;
}): Promise<void> {
  const { ticket, actor } = params;
  // Delete linked attachments first while ticket still exists (for creator delete permission rule)
  try {
    const attSnap = await getDocs(
      query(
        collection(db, 'ticketAttachments'),
        where('orgId', '==', ORG_ID),
        where('ticketId', '==', ticket.ticketId)
      )
    );
    if (attSnap.docs.length > 0) {
      await commitDeletesInChunks(attSnap.docs.map((d) => d.ref));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `ticketAttachments/${ticket.ticketId}`);
  }

  try {
    await deleteDoc(doc(db, 'supportTickets', ticket.ticketId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `supportTickets/${ticket.ticketId}`);
  }

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Delete',
    action: `deleted support ticket KEJ-${ticket.ticketNumber} "${ticket.title}"`,
    target: ticket.ticketId,
    before: `KEJ-${ticket.ticketNumber} (${ticket.status})`,
    after: 'deleted',
  }).catch(() => {});
}

export async function clearAllSupportTickets(actor: DirectoryEntry): Promise<{
  deletedTickets: number;
  deletedAttachments: number;
}> {
  if (!isDeveloperRole(actor.role)) {
    throw new Error('Only a Developer can clear all support tickets.');
  }
  const deletedAttachments = await deleteCollectionRecords('ticketAttachments');
  const deletedTickets = await deleteCollectionRecords('supportTickets');

  await logAuditEvent({
    actor: actor.name,
    actorUserId: actor.empId,
    category: 'Delete',
    action: `cleared all support tickets (${deletedTickets} tickets, ${deletedAttachments} attachments)`,
    target: 'support_tickets_clear_all',
    before: `${deletedTickets} tickets`,
    after: '0 tickets',
  }).catch(() => {});

  return { deletedTickets, deletedAttachments };
}



