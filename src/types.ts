import { Timestamp } from 'firebase/firestore';

export type ViewId =
  | 'dash'
  | 'tasks'
  | 'share'
  | 'att'
  | 'flow'
  | 'kpi'
  | 'tickets'
  | 'rep'
  | 'roles'
  | 'blue'
  | 'usr'
  | 'log'
  | 'prof';

export type Priority = 'Low' | 'Medium' | 'High';
export type RepeatMode = 'none' | 'daily';

export type AuditCategory =
  | 'Sign-in'
  | 'Task'
  | 'User'
  | 'Delete'
  | 'Attendance'
  | 'Role'
  | 'Security'
  | 'Export'
  | 'Upload'
  | 'Ticket';

export interface DirectoryEntry {
  empId: string;
  docId: string;
  name: string;
  role: string;
  branch: string;
  location: string;
  designation: string;
  joinedAt: string;
  photoUrl: string;
  active: boolean;
  authUid: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface UserPrivate {
  empId: string;
  docId: string;
  authUid: string;
  email: string;
  phone: string;
  passwordHash: string;
  passwordSalt: string;
  twoStepEnabled: boolean;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RoleDefinition {
  roleId: string;
  name: string;
  branchScope: string;
  locationScope: string;
  permissions: number[];
  builtin: boolean;
  orgId: 'kejmin';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface OrgUnit {
  id: string;
  name: string;
  code: string;
  active: boolean;
  orgId: 'kejmin';
  createdAt?: Timestamp;
}

export interface WorkflowPath {
  pathId: string;
  name: string;
  stages: string[];
  orgId: 'kejmin';
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TaskDoc {
  taskId: string;
  title: string;
  branch: string;
  location: string;
  priority: Priority;
  pathId: string;
  path: string[];
  stage: number;
  dueAt: string;
  dueTime?: string;
  repeatMode?: RepeatMode;
  repeatSeriesId?: string;
  status: 'open' | 'closed';
  proofs: string[];
  lastSendBackReason: string;
  createdBy: string;
  createdByUid: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ScoreEvent {
  eventId: string;
  uid: string;
  employeeName: string;
  taskId: string;
  points: number;
  reason: string;
  date: string;
  actorUid: string;
  orgId: 'kejmin';
  at?: Timestamp;
}

export interface AttendanceRecord {
  recordId: string;
  uid: string;
  employeeName: string;
  date: string;
  in: string;
  out: string;
  breaks: string[];
  location: string;
  note: string;
  correctedBy: string;
  actorUid: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type TodoNoteColor = 'yellow' | 'blue' | 'green' | 'pink';

export interface CalendarTodo {
  todoId: string;
  empId: string;
  employeeName: string;
  date: string;
  text: string;
  done: boolean;
  color: TodoNoteColor;
  actorUid: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Holiday {
  holidayId: string;
  date: string;
  location: string;
  name: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
}

export interface AttendanceSettings {
  settingId: 'attendance';
  wd: number[];
  st: string;
  en: string;
  gr: number;
  orgId: 'kejmin';
  updatedAt?: Timestamp;
}

export interface AuditLogEntry {
  logId: string;
  actor: string;
  actorUserId: string;
  actorUid: string;
  category: AuditCategory;
  action: string;
  target: string;
  before: string;
  after: string;
  orgId: 'kejmin';
  at?: Timestamp;
}

export interface NotificationDoc {
  notifId: string;
  recipientName: string;
  title: string;
  message: string;
  type: 'assigned' | 'sendback' | 'reminder' | 'overdue' | 'escalation';
  taskId: string;
  read: boolean;
  actorUid: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
}

export type ShareAccessScope = 'all' | 'branch' | 'location' | 'selected';

export const SHARED_FILE_CATEGORIES = [
  'General',
  'Reports',
  'SOP / Policy',
  'Lab / Quality',
  'Finance',
  'Plant Ops',
  'HR & Admin',
] as const;

export interface SharedFolderDoc {
  folderId: string;
  name: string;
  parentId: string;
  driveFolderId: string;
  driveUrl: string;
  branch: string;
  location: string;
  accessScope: ShareAccessScope;
  allowedEmpIds: string[];
  description: string;
  createdBy: string;
  createdByEmpId: string;
  createdByUid: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SharedFileDoc {
  fileId: string;
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
  uploadedBy: string;
  uploadedByEmpId: string;
  uploadedByUid: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type TicketStatus = 'created' | 'review' | 'resp' | 'closed' | 'reopen';
export type TicketAttachmentCategory = 'Inspection' | 'Proof' | 'Reference';

export interface TicketSubtask {
  id: string;
  t: string;
  d: boolean;
}

export interface TicketComment {
  id: string;
  u: string;
  empId: string;
  t: string;
  at: string;
}

export interface TicketLogEntry {
  t: string;
  at: string;
}

export interface SupportTicketDoc {
  ticketId: string;
  ticketNumber: number;
  title: string;
  desc: string;
  type: string;
  pri: Priority;
  status: TicketStatus;
  assignee: string;
  reporter: string;
  reporterEmpId: string;
  reporterUid: string;
  incident: string;
  labels: string[];
  subs: TicketSubtask[];
  comments: TicketComment[];
  log: TicketLogEntry[];
  attachmentCount: number;
  orgId: 'kejmin';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TicketAttachmentDoc {
  attachmentId: string;
  ticketId: string;
  name: string;
  type: string;
  size: number;
  cat: TicketAttachmentCategory;
  by: string;
  byUid: string;
  at: string;
  data: string;
  orgId: 'kejmin';
  createdAt?: Timestamp;
}

export const WEIGHTS: Record<Priority, number> = {
  Low: 1,
  Medium: 3,
  High: 5,
};

export const PERMISSIONS = [
  'Create tasks',
  'Design paths',
  'Approve / send back',
  'View all KPI',
  'Export reports',
  'Manage roles',
  'Manage users',
  'Correct attendance',
  'Delete tasks',
  'Share Folder',
] as const;

export const BUILTIN_ROLES = [
  'Developer',
  'Company Owner',
  'Finalizer',
  'Auditor',
  'Process Coordinator',
  'Plant Staff',
] as const;

export const DEFAULT_BRANCHES = [
  'MIS',
  'Operations',
  'Sales',
  'Accounts & Finance',
  'Plant Coordination',
  'HR',
];

export const DEFAULT_LOCATIONS = [
  'Bengaluru Office',
  'Plant 1',
  'Plant 2',
];

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const BOOTSTRAP_ADMIN_EMAIL = 'krushna.hka2@gmail.com';

export const ROLE_RANK: Record<string, number> = {
  Developer: 100,
  'Company Owner': 80,
  Finalizer: 60,
  Auditor: 50,
  'Process Coordinator': 30,
  'Plant Staff': 10,
};

export function getRoleRank(roleName: string): number {
  if (!roleName) return 0;
  return ROLE_RANK[roleName] ?? 20;
}

export function isDeveloperRole(roleName: string): boolean {
  return roleName === 'Developer';
}

/**
 * Strict role hierarchy rule:
 * - Developer has unrestricted access across the entire app.
 * - Any other role can ONLY manage or assign roles strictly lower than their own rank.
 */
export function canManageTargetRole(actorRole: string, targetRole: string): boolean {
  if (isDeveloperRole(actorRole)) return true;
  return getRoleRank(actorRole) > getRoleRank(targetRole);
}

/**
 * Strict user management rule (edit, change role, reset password, delete):
 * - Developer has full unrestricted access across the entire app.
 * - Any other user CANNOT modify/edit/delete themselves, peers (same rank), or upper roles.
 * - They can ONLY modify/edit/delete users whose role is strictly lower than their own.
 */
export function canManageUser(actor: DirectoryEntry, target: DirectoryEntry): boolean {
  if (isDeveloperRole(actor.role)) return true;
  if (actor.empId === target.empId) return false;
  return getRoleRank(actor.role) > getRoleRank(target.role);
}

