import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId?: string;
}

const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(
  fs.readFileSync(firebaseConfigPath, 'utf8')
) as FirebaseAppletConfig;

const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
const FIREBASE_API_KEY = firebaseConfig.apiKey;
const FIRESTORE_DATABASE_ID =
  firebaseConfig.firestoreDatabaseId || 'ai-studio-864da643-fbf0-4e48-b140-7c8b27d53828';
const BOOTSTRAP_ADMIN_EMAIL = 'krushna.hka2@gmail.com';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const ROOT_FOLDER_NAME = 'KEJMIN OPS Shared Folder';
const RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MiB per chunk (multiple of 256 KiB for Google Drive resumable API)
const MAX_CHUNK_BODY_BYTES = 16 * 1024 * 1024; // Safety bound per single HTTP chunk request
const LEGACY_SINGLE_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours for huge multi-GB / TB uploads

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{5,128}$/;
const SAFE_DOC_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_SESSION_ID_RE = /^[a-f0-9]{16,96}$/;

function inferMimeFromFileName(fileName: string): string {
  const clean = (fileName || '').trim();
  const ext = clean.includes('.') ? clean.split('.').pop()?.toLowerCase() || '' : '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'jfif':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'pdf':
      return 'application/pdf';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xlsm':
      return 'application/vnd.ms-excel.sheet.macroEnabled.12';
    case 'xlsb':
      return 'application/vnd.ms-excel.sheet.binary.macroEnabled.12';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'csv':
      return 'text/csv';
    case 'txt':
    case 'log':
    case 'md':
    case 'ini':
    case 'sql':
    case 'yml':
    case 'yaml':
      return 'text/plain';
    case 'json':
      return 'application/json';
    case 'xml':
      return 'application/xml';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
      return 'audio/mp4';
    case 'zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

interface ResumableUploadSession {
  uploadUrl: string;
  uid: string;
  mode: 'create' | 'replace';
  fileName: string;
  mimeType: string;
  totalSize: number;
  driveFileId?: string;
  createdAt: number;
  lastActivityAt: number;
}

const resumableUploadSessions = new Map<string, ResumableUploadSession>();

function pruneStaleUploadSessions(): void {
  const cutoff = Date.now() - UPLOAD_SESSION_TTL_MS;
  for (const [sid, session] of resumableUploadSessions.entries()) {
    if (session.lastActivityAt < cutoff) {
      resumableUploadSessions.delete(sid);
    }
  }
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}

interface AuthedRequest extends Request {
  fbUser?: VerifiedFirebaseUser;
  fbIdToken?: string;
}

interface CompanyDriveSession {
  accessToken: string;
  expiresAt: number;
  connectedByEmail: string;
  connectedByName: string;
  connectedAt: string;
  rootFolderId: string;
  rootFolderUrl: string;
}

interface EnvTokenCache {
  accessToken: string;
  expiresAt: number;
  rootFolderId: string;
  rootFolderUrl: string;
  accountEmail: string;
}

interface PersistedDriveState {
  session: CompanyDriveSession | null;
  manuallyDisconnected: boolean;
  lastConnectedEmail: string | null;
}

const DRIVE_STATE_DIR = path.resolve(__dirname, '.data');
const DRIVE_STATE_FILE = path.join(DRIVE_STATE_DIR, 'company-drive-session.enc');
const LOGIN_VERSIONS_FILE = path.join(DRIVE_STATE_DIR, 'login-versions.enc');
const DRIVE_STATE_KEY = crypto.scryptSync(
  `${FIREBASE_PROJECT_ID}:${FIREBASE_API_KEY}:${FIRESTORE_DATABASE_ID}`,
  'kejmin-company-drive-v1',
  32
);

const SAFE_EMP_ID_RE = /^[a-z0-9._]{3,20}$/;

function toSafeDocId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\./g, '__')
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 120);
}

// Tracks latest active loginVersion per employee docId (persisted encrypted on disk & synced by Admins)
const loginVersions = new Map<string, number>();

// Lightweight IP rate limiter for /api/auth/login-slot (60 requests per 60s per IP)
const loginSlotRateLimit = new Map<string, { count: number; resetAt: number }>();

function checkLoginSlotRateLimit(ip: string): boolean {
  const now = Date.now();
  if (loginSlotRateLimit.size > 2000) {
    for (const [k, v] of loginSlotRateLimit.entries()) {
      if (v.resetAt <= now) loginSlotRateLimit.delete(k);
    }
  }
  const entry = loginSlotRateLimit.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginSlotRateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 60) return false;
  entry.count += 1;
  return true;
}

function saveLoginVersions(): void {
  try {
    fs.mkdirSync(DRIVE_STATE_DIR, { recursive: true, mode: 0o700 });
    const obj: Record<string, number> = {};
    for (const [k, v] of loginVersions.entries()) {
      obj[k] = v;
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', DRIVE_STATE_KEY, iv);
    const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    fs.writeFileSync(LOGIN_VERSIONS_FILE, Buffer.concat([iv, tag, encrypted]), { mode: 0o600 });
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

function loadLoginVersions(): void {
  try {
    if (!fs.existsSync(LOGIN_VERSIONS_FILE)) return;
    const raw = fs.readFileSync(LOGIN_VERSIONS_FILE);
    if (raw.length < 29) return;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', DRIVE_STATE_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [docId, version] of Object.entries(parsed)) {
        if (
          SAFE_DOC_ID_RE.test(docId) &&
          typeof version === 'number' &&
          Number.isInteger(version) &&
          version >= 1 &&
          version <= 9999
        ) {
          loginVersions.set(docId, version);
        }
      }
    }
  } catch {
    // Ignore corrupt state file
  }
}

loadLoginVersions();

// Shared company Google Drive state (encrypted on server disk so it survives server restarts; never sent to browsers)
let companyDriveSession: CompanyDriveSession | null = null;
let driveManuallyDisconnected = false;
let lastConnectedDriveEmail: string | null = null;
let envDriveTokenCache: EnvTokenCache | null = null;

function savePersistedDriveState(): void {
  try {
    fs.mkdirSync(DRIVE_STATE_DIR, { recursive: true, mode: 0o700 });
    const payload: PersistedDriveState = {
      session: companyDriveSession,
      manuallyDisconnected: driveManuallyDisconnected,
      lastConnectedEmail: lastConnectedDriveEmail,
    };
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', DRIVE_STATE_KEY, iv);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const out = Buffer.concat([iv, tag, encrypted]);
    fs.writeFileSync(DRIVE_STATE_FILE, out, { mode: 0o600 });
  } catch {
    // Non-fatal if filesystem is read-only; in-memory session continues to work
  }
}

function loadPersistedDriveState(): void {
  try {
    if (!fs.existsSync(DRIVE_STATE_FILE)) return;
    const raw = fs.readFileSync(DRIVE_STATE_FILE);
    if (raw.length < 29) return;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', DRIVE_STATE_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      'utf8'
    );
    const parsed = JSON.parse(decrypted) as Partial<PersistedDriveState>;
    driveManuallyDisconnected = Boolean(parsed.manuallyDisconnected);
    lastConnectedDriveEmail =
      typeof parsed.lastConnectedEmail === 'string' && parsed.lastConnectedEmail.trim()
        ? parsed.lastConnectedEmail.trim()
        : null;
    if (
      !driveManuallyDisconnected &&
      parsed.session &&
      typeof parsed.session.accessToken === 'string' &&
      typeof parsed.session.expiresAt === 'number' &&
      parsed.session.expiresAt > Date.now() + 10_000
    ) {
      companyDriveSession = parsed.session;
    }
  } catch {
    // Ignore corrupt or incompatible state file
  }
}

loadPersistedDriveState();

// Short-lived cache for verified Firebase ID tokens (30s max, keyed by SHA-256 hash)
const verifiedTokenCache = new Map<
  string,
  { user: VerifiedFirebaseUser; cachedUntil: number }
>();

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 20 ? token : null;
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  const tokenHash = crypto.createHash('sha256').update(idToken).digest('hex');
  const now = Date.now();
  const cached = verifiedTokenCache.get(tokenHash);
  if (cached && cached.cachedUntil > now) {
    return cached.user;
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        FIREBASE_API_KEY
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
      }>;
    };
    const u = data.users?.[0];
    if (!u?.localId || !u.email) return null;

    const verified: VerifiedFirebaseUser = {
      uid: u.localId,
      email: u.email,
      emailVerified: Boolean(u.emailVerified),
      displayName: u.displayName || u.email,
    };

    if (verifiedTokenCache.size > 500) {
      verifiedTokenCache.clear();
    }
    verifiedTokenCache.set(tokenHash, { user: verified, cachedUntil: now + 30_000 });
    return verified;
  } catch {
    return null;
  }
}

async function checkIsBoundEmployee(user: VerifiedFirebaseUser, idToken: string): Promise<boolean> {
  if (!SAFE_DOC_ID_RE.test(user.uid)) return false;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      FIREBASE_PROJECT_ID
    )}/databases/${encodeURIComponent(
      FIRESTORE_DATABASE_ID
    )}/documents/authBindings/${encodeURIComponent(user.uid)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return false;
    const docData = (await res.json()) as {
      fields?: {
        active?: { booleanValue?: boolean };
        orgId?: { stringValue?: string };
      };
    };
    return (
      docData.fields?.active?.booleanValue === true &&
      docData.fields?.orgId?.stringValue === 'kejmin'
    );
  } catch {
    return false;
  }
}

async function checkIsVerifiedOrBound(user: VerifiedFirebaseUser, idToken: string): Promise<boolean> {
  if (user.emailVerified) return true;
  return checkIsBoundEmployee(user, idToken);
}

async function checkIsAdmin(user: VerifiedFirebaseUser, idToken: string): Promise<boolean> {
  if (
    user.emailVerified &&
    user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
  ) {
    return true;
  }
  if (!(await checkIsVerifiedOrBound(user, idToken))) return false;
  if (!SAFE_DOC_ID_RE.test(user.uid)) return false;

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      FIREBASE_PROJECT_ID
    )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/admins/${encodeURIComponent(
      user.uid
    )}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkIsDeveloper(user: VerifiedFirebaseUser, idToken: string): Promise<boolean> {
  if (
    user.emailVerified &&
    user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
  ) {
    return true;
  }
  if (!(await checkIsVerifiedOrBound(user, idToken))) return false;
  if (!SAFE_DOC_ID_RE.test(user.uid)) return false;

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      FIREBASE_PROJECT_ID
    )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/admins/${encodeURIComponent(
      user.uid
    )}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return false;
    const docData = (await res.json()) as {
      fields?: { role?: { stringValue?: string } };
    };
    return docData.fields?.role?.stringValue === 'Developer';
  } catch {
    return false;
  }
}

async function verifyDriveItemPermission(params: {
  user: VerifiedFirebaseUser;
  idToken: string;
  itemKind: 'file' | 'folder';
  firestoreDocId: string;
  driveFileId: string;
}): Promise<boolean> {
  const { user, idToken, itemKind, firestoreDocId, driveFileId } = params;
  if (await checkIsAdmin(user, idToken)) {
    return true;
  }
  if (!SAFE_DOC_ID_RE.test(firestoreDocId)) return false;

  const col = itemKind === 'folder' ? 'sharedFolders' : 'sharedFiles';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_PROJECT_ID
  )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/${col}/${encodeURIComponent(
    firestoreDocId
  )}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return false;
    const docData = (await res.json()) as {
      fields?: Record<string, { stringValue?: string }>;
    };
    const fields = docData.fields || {};
    const ownerUid =
      itemKind === 'folder'
        ? fields.createdByUid?.stringValue
        : fields.uploadedByUid?.stringValue;
    const storedDriveId =
      itemKind === 'folder'
        ? fields.driveFolderId?.stringValue
        : fields.driveFileId?.stringValue;

    return ownerUid === user.uid && storedDriveId === driveFileId;
  } catch {
    return false;
  }
}

async function verifyDriveFileReadAccess(params: {
  user: VerifiedFirebaseUser;
  idToken: string;
  firestoreDocId: string;
  driveFileId: string;
  requireDownloadAllowed: boolean;
}): Promise<{ allowed: boolean; fileName?: string; mimeType?: string; reason?: string }> {
  const { user, idToken, firestoreDocId, driveFileId, requireDownloadAllowed } = params;
  if (!SAFE_DOC_ID_RE.test(firestoreDocId)) {
    return { allowed: false, reason: 'Invalid file record ID.' };
  }

  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_PROJECT_ID
  )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/sharedFiles/${encodeURIComponent(
    firestoreDocId
  )}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      return { allowed: false, reason: 'File record not found or inaccessible.' };
    }
    const docData = (await res.json()) as {
      fields?: Record<string, { stringValue?: string; booleanValue?: boolean }>;
    };
    const fields = docData.fields || {};
    if (fields.orgId?.stringValue !== 'kejmin') {
      return { allowed: false, reason: 'File does not belong to this organization.' };
    }
    if (fields.driveFileId?.stringValue !== driveFileId) {
      return { allowed: false, reason: 'Drive file ID does not match the record.' };
    }

    const isAdmin = await checkIsAdmin(user, idToken);
    const isOwner = fields.uploadedByUid?.stringValue === user.uid;
    const allowDownload = fields.allowDownload?.booleanValue !== false;

    if (requireDownloadAllowed && !allowDownload && !isAdmin && !isOwner) {
      return { allowed: false, reason: 'Direct downloads are disabled for this file.' };
    }

    return {
      allowed: true,
      fileName: fields.name?.stringValue || 'download',
      mimeType: fields.mimeType?.stringValue || 'application/octet-stream',
    };
  } catch {
    return { allowed: false, reason: 'Could not verify file permissions.' };
  }
}

async function requireVerifiedUser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const idToken = getBearerToken(req);
  if (!idToken) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const user = await verifyFirebaseIdToken(idToken);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
    return;
  }
  const verified = await checkIsVerifiedOrBound(user, idToken);
  if (!verified) {
    res.status(403).json({ error: 'Authorized KEJMIN OPS account required.' });
    return;
  }
  req.fbUser = user;
  req.fbIdToken = idToken;
  next();
}

// ===== Google Drive Server Token Resolution (Permanent Env OR Shared Admin Session) =====

interface ParsedServiceAccount {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

function extractDriveFolderId(rawValue?: string): string | null {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) return null;
  // Support pasting either the bare folder ID OR the full Google Drive folder URL
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{5,128})/);
  if (urlMatch?.[1] && SAFE_ID_RE.test(urlMatch[1])) {
    return urlMatch[1];
  }
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{5,128})/);
  if (idParamMatch?.[1] && SAFE_ID_RE.test(idParamMatch[1])) {
    return idParamMatch[1];
  }
  if (SAFE_ID_RE.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function parseServiceAccountConfig(): {
  config: ParsedServiceAccount | null;
  warning: string | null;
} {
  const rawOriginal = (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || '').replace(/^\uFEFF/, '');
  const raw = rawOriginal.trim();
  if (!raw) return { config: null, warning: null };

  const tryParseJson = (input: string): unknown => {
    const first = JSON.parse(input) as unknown;
    if (typeof first === 'string') {
      return JSON.parse(first) as unknown;
    }
    return first;
  };

  // Repair JSON where literal line breaks were pasted inside quoted strings (e.g. private_key)
  const escapeLiteralNewlinesInJsonStrings = (input: string): string => {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (inString) {
        if (escaped) {
          out += ch;
          escaped = false;
        } else if (ch === '\\') {
          out += ch;
          escaped = true;
        } else if (ch === '"') {
          out += ch;
          inString = false;
        } else if (ch === '\n') {
          out += '\\n';
        } else if (ch === '\r') {
          // drop CR
        } else {
          out += ch;
        }
      } else {
        if (ch === '"') inString = true;
        out += ch;
      }
    }
    return out;
  };

  let parsed: unknown = null;
  const candidates: string[] = [raw, escapeLiteralNewlinesInJsonStrings(raw)];
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    const unwrapped = raw.slice(1, -1).trim();
    candidates.push(unwrapped, escapeLiteralNewlinesInJsonStrings(unwrapped));
  }

  for (const candidate of candidates) {
    try {
      parsed = tryParseJson(candidate);
      if (parsed && typeof parsed === 'object') break;
    } catch {
      // try next candidate
    }
  }

  // Also support base64-encoded Service Account JSON
  if (!parsed || typeof parsed !== 'object') {
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
      if (decoded.startsWith('{')) {
        parsed = tryParseJson(escapeLiteralNewlinesInJsonStrings(decoded));
      }
    } catch {
      // ignore
    }
  }

  // Last-resort regex extraction if someone pasted a partially broken JSON snippet with client_email + PEM
  if (!parsed || typeof parsed !== 'object') {
    const emailMatch = raw.match(/"client_email"\s*:\s*"([^"]+)"/);
    const keyMatch = raw.match(/"private_key"\s*:\s*"([\s\S]*?-----END [A-Z ]*PRIVATE KEY-----[\\n\r\n]*)"/);
    if (emailMatch?.[1] && keyMatch?.[1]) {
      parsed = {
        client_email: emailMatch[1],
        private_key: keyMatch[1],
      };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      config: null,
      warning: null,
    };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.web || obj.installed) {
    return {
      config: null,
      warning:
        'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON contains an OAuth Client JSON instead of a Service Account key JSON. Connect Company Drive below or paste a Service Account key JSON.',
    };
  }

  const clientEmail = typeof obj.client_email === 'string' ? obj.client_email.trim() : '';
  const rawKey = typeof obj.private_key === 'string' ? obj.private_key : '';
  const privateKey = rawKey.replace(/\\n/g, '\n').trim();
  const tokenUri =
    typeof obj.token_uri === 'string' && obj.token_uri.startsWith('https://')
      ? obj.token_uri.trim()
      : 'https://oauth2.googleapis.com/token';

  if (!clientEmail || !clientEmail.includes('@') || !privateKey.includes('PRIVATE KEY')) {
    return {
      config: null,
      warning:
        'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is missing a valid client_email or private_key. Connect Company Drive below or update the secret with the downloaded Service Account JSON key.',
    };
  }

  return {
    config: { clientEmail, privateKey, tokenUri },
    warning: null,
  };
}

let lastEnvDriveError: string | null = null;

function cleanEnvSecret(raw?: string): string {
  const trimmed = (raw || '').replace(/^\uFEFF/, '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

async function mintServiceAccountAccessToken(): Promise<{
  accessToken: string;
  expiresAt: number;
  accountEmail: string;
} | null> {
  const { config } = parseServiceAccountConfig();
  if (!config) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: config.clientEmail,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: config.tokenUri,
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = base64UrlEncode(signer.sign(config.privateKey));
  const assertion = `${header}.${claim}.${signature}`;

  const tokenRes = await fetch(config.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!tokenRes.ok) {
    let detail = '';
    try {
      const errJson = (await tokenRes.json()) as { error?: string; error_description?: string };
      detail = [errJson.error, errJson.error_description].filter(Boolean).join(': ');
    } catch {
      // ignore non-JSON error
    }
    throw new Error(
      `Service account token request failed (${tokenRes.status})${detail ? ` — ${detail}` : ''}.`
    );
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tokenJson.access_token) {
    throw new Error('Service account did not return an access token.');
  }
  return {
    accessToken: tokenJson.access_token,
    expiresAt: Date.now() + Math.max(300, (tokenJson.expires_in || 3600) - 120) * 1000,
    accountEmail: config.clientEmail,
  };
}

async function mintRefreshTokenAccessToken(): Promise<{
  accessToken: string;
  expiresAt: number;
  accountEmail: string;
} | null> {
  const refreshToken = cleanEnvSecret(process.env.GOOGLE_DRIVE_REFRESH_TOKEN);
  const clientId = cleanEnvSecret(process.env.GOOGLE_DRIVE_CLIENT_ID);
  const clientSecret = cleanEnvSecret(process.env.GOOGLE_DRIVE_CLIENT_SECRET);
  if (!refreshToken || !clientId || !clientSecret) return null;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) {
    let detail = '';
    try {
      const errJson = (await tokenRes.json()) as { error?: string; error_description?: string };
      if (errJson.error === 'invalid_client') {
        detail =
          'GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET in Settings -> Secrets was not found or mismatched in Google Cloud';
      } else {
        detail = [errJson.error, errJson.error_description].filter(Boolean).join(': ');
      }
    } catch {
      // ignore non-JSON error
    }
    throw new Error(
      `Permanent Drive secret error (${tokenRes.status})${detail ? ` — ${detail}` : ''}.`
    );
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tokenJson.access_token) {
    throw new Error('Refresh token exchange did not return an access token.');
  }
  return {
    accessToken: tokenJson.access_token,
    expiresAt: Date.now() + Math.max(300, (tokenJson.expires_in || 3600) - 120) * 1000,
    accountEmail: cleanEnvSecret(process.env.GOOGLE_DRIVE_ACCOUNT_LABEL) || 'Company Google Drive',
  };
}

function getEnvDriveChecklist() {
  const hasRefreshToken = Boolean(cleanEnvSecret(process.env.GOOGLE_DRIVE_REFRESH_TOKEN));
  const hasClientId = Boolean(cleanEnvSecret(process.env.GOOGLE_DRIVE_CLIENT_ID));
  const hasClientSecret = Boolean(cleanEnvSecret(process.env.GOOGLE_DRIVE_CLIENT_SECRET));
  const hasServiceAccount = Boolean(parseServiceAccountConfig().config);
  const hasSharedFolderId = Boolean(extractDriveFolderId(process.env.GOOGLE_DRIVE_SHARED_FOLDER_ID));
  return {
    hasRefreshToken,
    hasClientId,
    hasClientSecret,
    hasServiceAccount,
    hasSharedFolderId,
  };
}

function hasPermanentEnvDriveConfig(): 'service_account' | 'refresh_token' | null {
  // Prefer OAuth Refresh Token when configured because it supports both personal Gmail Drive and Workspace Shared Drives
  if (
    cleanEnvSecret(process.env.GOOGLE_DRIVE_REFRESH_TOKEN) &&
    cleanEnvSecret(process.env.GOOGLE_DRIVE_CLIENT_ID) &&
    cleanEnvSecret(process.env.GOOGLE_DRIVE_CLIENT_SECRET)
  ) {
    return 'refresh_token';
  }
  if (parseServiceAccountConfig().config) return 'service_account';
  return null;
}

async function grantLinkReaderPermission(
  accessToken: string,
  driveFileId: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(driveFileId)}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function createDriveFolderWithToken(
  accessToken: string,
  folderName: string,
  parentDriveFolderId?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const cleanName = folderName.trim().slice(0, 100);
  const metadata: Record<string, unknown> = {
    name: cleanName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentDriveFolderId && SAFE_ID_RE.test(parentDriveFolderId)) {
    metadata.parents = [parentDriveFolderId];
  }

  const res = await fetch(
    `${DRIVE_API_BASE}/files?supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!res.ok) {
    let msg = `Google Drive folder creation failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody?.error?.message) msg = errBody.error.message;
    } catch {
      // ignore
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const created = (await res.json()) as { id: string; name: string; webViewLink?: string };
  await grantLinkReaderPermission(accessToken, created.id);
  return {
    id: created.id,
    name: created.name,
    webViewLink: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
  };
}

async function ensureRootDriveFolderWithToken(
  accessToken: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const configuredFolderId = extractDriveFolderId(process.env.GOOGLE_DRIVE_SHARED_FOLDER_ID);
  if (configuredFolderId) {
    return {
      id: configuredFolderId,
      name: ROOT_FOLDER_NAME,
      webViewLink: `https://drive.google.com/drive/folders/${configuredFolderId}`,
    };
  }

  const q = `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(
      q
    )}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,webViewLink)&pageSize=5`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!searchRes.ok) {
    let msg = `Google Drive lookup failed (${searchRes.status})`;
    try {
      const errBody = (await searchRes.json()) as { error?: { message?: string } };
      if (errBody?.error?.message) msg = errBody.error.message;
    } catch {
      // ignore
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = searchRes.status;
    throw err;
  }
  const data = (await searchRes.json()) as {
    files?: Array<{ id: string; name: string; webViewLink?: string }>;
  };
  const existing = data.files?.[0];
  if (existing?.id) {
    return {
      id: existing.id,
      name: existing.name,
      webViewLink:
        existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`,
    };
  }
  return createDriveFolderWithToken(accessToken, ROOT_FOLDER_NAME);
}

interface ActiveDriveAuth {
  accessToken: string;
  rootFolderId: string;
  rootFolderUrl: string;
  mode: 'service_account' | 'refresh_token' | 'session';
}

let lastEnvWarmAttemptAt = 0;

async function getActiveCompanyDriveAuth(options?: {
  forceRefresh?: boolean;
}): Promise<ActiveDriveAuth | null> {
  if (driveManuallyDisconnected) {
    return null;
  }

  const now = Date.now();
  const envMode = hasPermanentEnvDriveConfig();

  if (envMode) {
    if (!options?.forceRefresh && envDriveTokenCache && envDriveTokenCache.expiresAt > now + 30_000) {
      return {
        accessToken: envDriveTokenCache.accessToken,
        rootFolderId: envDriveTokenCache.rootFolderId,
        rootFolderUrl: envDriveTokenCache.rootFolderUrl,
        mode: envMode,
      };
    }
    try {
      const minted =
        envMode === 'service_account'
          ? await mintServiceAccountAccessToken()
          : await mintRefreshTokenAccessToken();
      if (minted) {
        const root = await ensureRootDriveFolderWithToken(minted.accessToken);
        lastEnvDriveError = null;
        envDriveTokenCache = {
          accessToken: minted.accessToken,
          expiresAt: minted.expiresAt,
          rootFolderId: root.id,
          rootFolderUrl: root.webViewLink,
          accountEmail: minted.accountEmail,
        };
        return {
          accessToken: minted.accessToken,
          rootFolderId: root.id,
          rootFolderUrl: root.webViewLink,
          mode: envMode,
        };
      }
    } catch (err: unknown) {
      lastEnvDriveError =
        err instanceof Error ? err.message : 'Permanent Company Drive credentials failed.';
      envDriveTokenCache = null;
      // Gracefully fall through to an active Admin Company Drive session if connected
    }
  }

  if (companyDriveSession) {
    if (companyDriveSession.expiresAt <= now) {
      companyDriveSession = null;
      savePersistedDriveState();
      return null;
    }
    return {
      accessToken: companyDriveSession.accessToken,
      rootFolderId: companyDriveSession.rootFolderId,
      rootFolderUrl: companyDriveSession.rootFolderUrl,
      mode: 'session',
    };
  }

  return null;
}

/**
 * Runs a Drive operation and, if Google returns 401 while permanent credentials are active,
 * automatically mints a fresh access token and retries once transparently so the user is never disconnected.
 */
async function refreshDriveAuthOn401(prevMode: ActiveDriveAuth['mode']): Promise<ActiveDriveAuth | null> {
  if (prevMode === 'refresh_token' || prevMode === 'service_account') {
    envDriveTokenCache = null;
    return getActiveCompanyDriveAuth({ forceRefresh: true });
  }
  companyDriveSession = null;
  savePersistedDriveState();
  return null;
}

// Proactively warm permanent Drive credentials on boot if configured and not manually disconnected
if (hasPermanentEnvDriveConfig() && !driveManuallyDisconnected) {
  lastEnvWarmAttemptAt = Date.now();
  void getActiveCompanyDriveAuth().catch(() => {
    // Error captured in lastEnvDriveError for Developer diagnostics
  });
}

function getSafeDriveStatus(includeDevDetails = false) {
  const now = Date.now();
  const saCheck = parseServiceAccountConfig();
  const envMode = hasPermanentEnvDriveConfig();
  const envChecklist = includeDevDetails ? getEnvDriveChecklist() : null;
  let partialEnvWarning: string | null = null;
  if (
    includeDevDetails &&
    !envMode &&
    envChecklist &&
    (envChecklist.hasRefreshToken || envChecklist.hasClientId || envChecklist.hasClientSecret)
  ) {
    const missing: string[] = [];
    if (!envChecklist.hasRefreshToken) missing.push('GOOGLE_DRIVE_REFRESH_TOKEN');
    if (!envChecklist.hasClientId) missing.push('GOOGLE_DRIVE_CLIENT_ID');
    if (!envChecklist.hasClientSecret) missing.push('GOOGLE_DRIVE_CLIENT_SECRET');
    if (missing.length > 0) {
      partialEnvWarning = `Permanent Drive OAuth setup is incomplete. Missing secret(s): ${missing.join(', ')}.`;
    }
  }
  const configWarning = includeDevDetails
    ? saCheck.warning || lastEnvDriveError || partialEnvWarning
    : null;

  // If Developer explicitly connected a live session and permanent env is absent or failed, prefer the working session
  if (
    !driveManuallyDisconnected &&
    companyDriveSession &&
    companyDriveSession.expiresAt > now &&
    (!envMode || lastEnvDriveError)
  ) {
    return {
      connected: true,
      mode: 'session' as const,
      permanent: false,
      permanentConfigured: Boolean(envMode),
      permanentMode: envMode,
      connectedBy: companyDriveSession.connectedByName,
      accountLabel: includeDevDetails ? companyDriveSession.connectedByEmail : null,
      connectedAt: companyDriveSession.connectedAt,
      expiresAt: companyDriveSession.expiresAt,
      rootFolderId: companyDriveSession.rootFolderId,
      rootFolderUrl: companyDriveSession.rootFolderUrl,
      configWarning,
      manuallyDisconnected: false,
      hintEmail: includeDevDetails
        ? companyDriveSession.connectedByEmail || lastConnectedDriveEmail
        : null,
      envChecklist,
    };
  }

  if (envMode && !lastEnvDriveError && !driveManuallyDisconnected) {
    const validConfiguredFolder = extractDriveFolderId(process.env.GOOGLE_DRIVE_SHARED_FOLDER_ID);
    return {
      connected: true,
      mode: envMode,
      permanent: true,
      permanentConfigured: true,
      permanentMode: envMode,
      connectedBy: 'Organization Drive (Permanent)',
      accountLabel: includeDevDetails
        ? envDriveTokenCache?.accountEmail ||
          process.env.GOOGLE_DRIVE_ACCOUNT_LABEL?.trim() ||
          saCheck.config?.clientEmail ||
          'Company Google Drive'
        : null,
      connectedAt: null,
      expiresAt: null,
      rootFolderId: envDriveTokenCache?.rootFolderId || validConfiguredFolder,
      rootFolderUrl:
        envDriveTokenCache?.rootFolderUrl ||
        (validConfiguredFolder
          ? `https://drive.google.com/drive/folders/${validConfiguredFolder}`
          : null),
      configWarning: null,
      manuallyDisconnected: false,
      hintEmail: null,
      envChecklist,
    };
  }

  if (companyDriveSession && companyDriveSession.expiresAt <= now) {
    companyDriveSession = null;
    savePersistedDriveState();
  }

  return {
    connected: false,
    mode: 'none' as const,
    permanent: false,
    permanentConfigured: Boolean(envMode),
    permanentMode: envMode,
    connectedBy: null,
    accountLabel: null,
    connectedAt: null,
    expiresAt: null,
    rootFolderId: null,
    rootFolderUrl: null,
    configWarning,
    manuallyDisconnected: driveManuallyDisconnected,
    hintEmail: includeDevDetails ? lastConnectedDriveEmail : null,
    envChecklist,
  };
}

// ===== Express App =====

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const jsonParser = express.json({ limit: '1mb' });

  // 0. Direct User ID + Password login slot lookup (returns integer version only; zero PII / zero user enumeration)
  app.post('/api/auth/login-slot', jsonParser, (req: Request, res: Response) => {
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.socket.remoteAddress) || 'unknown';
    if (!checkLoginSlotRateLimit(ip)) {
      res.status(429).json({ error: 'Too many sign-in attempts. Please wait a minute and try again.' });
      return;
    }
    const rawEmpId = typeof req.body?.empId === 'string' ? req.body.empId.trim().toLowerCase() : '';
    if (!SAFE_EMP_ID_RE.test(rawEmpId)) {
      res.json({ version: 1 });
      return;
    }
    const docId = toSafeDocId(rawEmpId);
    res.json({ version: loginVersions.get(docId) || 1 });
  });

  // 0B. Sync active loginVersion map from Firestore authBindings (Admin/Developer only)
  app.post(
    '/api/auth/sync-slots',
    requireVerifiedUser,
    jsonParser,
    async (req: AuthedRequest, res: Response) => {
      const isAdm = await checkIsAdmin(req.fbUser!, req.fbIdToken!);
      if (!isAdm) {
        res.status(403).json({ error: 'Administrator access required.' });
        return;
      }
      const rawSlots = req.body?.slots;
      if (!rawSlots || typeof rawSlots !== 'object' || Array.isArray(rawSlots)) {
        res.status(400).json({ error: 'Valid slots map is required.' });
        return;
      }
      const entries = Object.entries(rawSlots as Record<string, unknown>);
      if (entries.length > 1000) {
        res.status(400).json({ error: 'Too many slot entries.' });
        return;
      }
      const replaceAll = req.body?.replaceAll === true;
      if (replaceAll) {
        loginVersions.clear();
      }
      for (const [docId, version] of entries) {
        if (
          SAFE_DOC_ID_RE.test(docId) &&
          typeof version === 'number' &&
          Number.isInteger(version) &&
          version >= 1 &&
          version <= 9999
        ) {
          loginVersions.set(docId, version);
        }
      }
      saveLoginVersions();
      res.json({ ok: true, count: loginVersions.size });
    }
  );

  // 1. Shared Company Drive Status (readable by any signed-in verified employee)
  app.get('/api/drive/status', requireVerifiedUser, async (req: AuthedRequest, res: Response) => {
    const isDev = await checkIsDeveloper(req.fbUser!, req.fbIdToken!);
    // Lazily warm permanent credentials once (with 30s cooldown) so status & rootFolderId stay accurate
    if (
      hasPermanentEnvDriveConfig() &&
      !driveManuallyDisconnected &&
      (!envDriveTokenCache || envDriveTokenCache.expiresAt <= Date.now() + 30_000) &&
      Date.now() - lastEnvWarmAttemptAt > 30_000
    ) {
      lastEnvWarmAttemptAt = Date.now();
      await getActiveCompanyDriveAuth().catch(() => {});
    }
    const status = getSafeDriveStatus(isDev);
    res.json(
      isDev
        ? status
        : { ...status, accountLabel: null, configWarning: null, envChecklist: null, hintEmail: null }
    );
  });

  // 2. Connect Company Google Drive (Developer only)
  app.post(
    '/api/drive/connect',
    requireVerifiedUser,
    jsonParser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const user = req.fbUser!;
        const idToken = req.fbIdToken!;
        const isDev = await checkIsDeveloper(user, idToken);
        if (!isDev) {
          res
            .status(403)
            .json({ error: 'Only Developers can connect or switch the Company Google Drive.' });
          return;
        }

        // Fast-path: Re-enable permanent server-configured Company Drive without any Google popup
        if (req.body?.usePermanent === true) {
          if (!hasPermanentEnvDriveConfig()) {
            res.status(400).json({
              error:
                'Permanent Company Drive secrets are not configured on the server yet. Add them in Settings -> Secrets first.',
            });
            return;
          }
          driveManuallyDisconnected = false;
          envDriveTokenCache = null;
          lastEnvDriveError = null;
          savePersistedDriveState();

          const active = await getActiveCompanyDriveAuth({ forceRefresh: true });
          if (!active || active.mode === 'session') {
            res.status(502).json({
              error:
                lastEnvDriveError ||
                'Could not connect using the configured permanent Company Drive secrets. Verify the secret values and try again.',
            });
            return;
          }
          res.json(getSafeDriveStatus(true));
          return;
        }

        const driveToken = String(req.headers['x-drive-access-token'] || '').trim();
        if (!driveToken || driveToken.length < 20) {
          res.status(400).json({ error: 'Missing Google Drive access permission token.' });
          return;
        }

        // Verify token validity and expiry via Google tokeninfo
        let expiresInSec = 3300;
        let driveAccountEmail = user.email;
        try {
          const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo', {
            headers: { Authorization: `Bearer ${driveToken}` },
          });
          if (!infoRes.ok) {
            res.status(401).json({ error: 'Google Drive token is invalid or expired.' });
            return;
          }
          const info = (await infoRes.json()) as {
            expires_in?: string;
            email?: string;
            scope?: string;
          };
          if (info.scope && !info.scope.includes('drive')) {
            res.status(403).json({
              error: 'Google Drive permission was not granted. Please approve Google Drive access.',
            });
            return;
          }
          if (info.expires_in) {
            const parsed = Number(info.expires_in);
            if (Number.isFinite(parsed) && parsed > 60) {
              expiresInSec = parsed - 60;
            }
          }
          if (info.email) {
            driveAccountEmail = info.email;
          }
        } catch {
          // fallback to Drive API call below to validate token
        }

        const root = await ensureRootDriveFolderWithToken(driveToken);
        const connectedByName =
          typeof req.body?.connectedByName === 'string' && req.body.connectedByName.trim()
            ? req.body.connectedByName.trim().slice(0, 100)
            : user.displayName;

        companyDriveSession = {
          accessToken: driveToken,
          expiresAt: Date.now() + expiresInSec * 1000,
          connectedByEmail: driveAccountEmail,
          connectedByName,
          connectedAt: new Date().toISOString(),
          rootFolderId: root.id,
          rootFolderUrl: root.webViewLink,
        };
        driveManuallyDisconnected = false;
        lastConnectedDriveEmail = driveAccountEmail || lastConnectedDriveEmail;
        savePersistedDriveState();

        res.json(getSafeDriveStatus(true));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to connect Company Google Drive.';
        const status = (err as { status?: number })?.status === 401 ? 401 : 500;
        res.status(status).json({ error: msg });
      }
    }
  );

  // 3. Disconnect Company Google Drive (Developer only)
  app.post(
    '/api/drive/disconnect',
    requireVerifiedUser,
    async (req: AuthedRequest, res: Response) => {
      const user = req.fbUser!;
      const idToken = req.fbIdToken!;
      const isDev = await checkIsDeveloper(user, idToken);
      if (!isDev) {
        res
          .status(403)
          .json({ error: 'Only Developers can disconnect Company Google Drive.' });
        return;
      }
      companyDriveSession = null;
      envDriveTokenCache = null;
      driveManuallyDisconnected = true;
      savePersistedDriveState();
      res.json(getSafeDriveStatus(true));
    }
  );

  // 4. Create Folder inside the Shared Company Google Drive (any verified employee)
  app.post(
    '/api/drive/folders',
    requireVerifiedUser,
    jsonParser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const driveAuth = await getActiveCompanyDriveAuth();
        if (!driveAuth) {
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive is not connected yet. Please ask an Administrator to connect Company Drive.',
          });
          return;
        }

        const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
        if (!name) {
          res.status(400).json({ error: 'Folder name is required.' });
          return;
        }

        const requestedParent =
          typeof req.body?.parentDriveFolderId === 'string'
            ? req.body.parentDriveFolderId.trim()
            : '';
        const parentId =
          requestedParent && SAFE_ID_RE.test(requestedParent)
            ? requestedParent
            : driveAuth.rootFolderId;

        try {
          const created = await createDriveFolderWithToken(driveAuth.accessToken, name, parentId);
          res.json(created);
        } catch (firstErr: unknown) {
          if ((firstErr as { status?: number })?.status === 401) {
            const refreshed = await refreshDriveAuthOn401(driveAuth.mode);
            if (refreshed) {
              const created = await createDriveFolderWithToken(
                refreshed.accessToken,
                name,
                requestedParent && SAFE_ID_RE.test(requestedParent)
                  ? requestedParent
                  : refreshed.rootFolderId
              );
              res.json(created);
              return;
            }
          }
          throw firstErr;
        }
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          companyDriveSession = null;
          envDriveTokenCache = null;
          savePersistedDriveState();
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive session expired. Please ask an Administrator to reconnect Company Drive.',
          });
          return;
        }
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to create Google Drive folder.',
        });
      }
    }
  );

  // 5. Upload File directly into the Shared Company Google Drive (any verified employee)
  // 5A. Initialize Chunked Resumable Upload (Supports UNLIMITED file sizes up to 5 TB Google Drive storage)
  app.post(
    '/api/drive/upload/init',
    requireVerifiedUser,
    jsonParser,
    async (req: AuthedRequest, res: Response) => {
      try {
        pruneStaleUploadSessions();

        const driveAuth = await getActiveCompanyDriveAuth();
        if (!driveAuth) {
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive is not connected yet. Please ask an Administrator to connect Company Drive.',
          });
          return;
        }

        const mode = req.body?.mode === 'replace' ? 'replace' : 'create';
        const rawFileName =
          typeof req.body?.fileName === 'string' ? req.body.fileName.trim().slice(0, 200) : '';
        const fileName = rawFileName || 'uploaded-file';

        const rawMime =
          typeof req.body?.mimeType === 'string'
            ? req.body.mimeType.replace(/[\r\n]/g, '').trim().slice(0, 120)
            : '';
        const mimeType =
          /^[a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+$/.test(rawMime) &&
          rawMime !== 'application/octet-stream'
            ? rawMime
            : inferMimeFromFileName(fileName);

        const totalSize = Number(req.body?.totalSize);
        if (!Number.isFinite(totalSize) || totalSize < 0) {
          res.status(400).json({ error: 'Valid file size is required.' });
          return;
        }

        const description =
          typeof req.body?.description === 'string'
            ? req.body.description.trim().slice(0, 400)
            : '';

        let driveFileId: string | undefined;
        if (mode === 'replace') {
          const targetDriveId =
            typeof req.body?.driveFileId === 'string' ? req.body.driveFileId.trim() : '';
          const firestoreDocId =
            typeof req.body?.firestoreDocId === 'string' ? req.body.firestoreDocId.trim() : '';
          if (!SAFE_ID_RE.test(targetDriveId)) {
            res.status(400).json({ error: 'Invalid Google Drive file ID.' });
            return;
          }
          if (!SAFE_DOC_ID_RE.test(firestoreDocId)) {
            res.status(400).json({ error: 'Valid file record ID is required.' });
            return;
          }
          const allowed = await verifyDriveItemPermission({
            user: req.fbUser!,
            idToken: req.fbIdToken!,
            itemKind: 'file',
            firestoreDocId,
            driveFileId: targetDriveId,
          });
          if (!allowed) {
            res.status(403).json({ error: 'You do not have permission to modify this file.' });
            return;
          }
          driveFileId = targetDriveId;
        }

        const rawParent =
          typeof req.body?.parentFolderId === 'string' ? req.body.parentFolderId.trim() : '';
        const parentDriveId =
          rawParent && SAFE_ID_RE.test(rawParent) ? rawParent : driveAuth.rootFolderId;

        if (mode === 'create' && parentDriveId === driveAuth.rootFolderId) {
          const isDev = await checkIsDeveloper(req.fbUser!, req.fbIdToken!);
          if (!isDev) {
            res.status(403).json({
              error:
                'Only Developers can upload directly to Company Drive root. Please upload inside a folder.',
            });
            return;
          }
        }

        const initSession = async (targetParentId: string, token: string) => {
          if (mode === 'replace' && driveFileId) {
            return fetch(
              `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(
                driveFileId
              )}?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size`,
              {
                method: 'PATCH',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json; charset=UTF-8',
                  'X-Upload-Content-Type': mimeType,
                  'X-Upload-Content-Length': String(Math.round(totalSize)),
                },
                body: JSON.stringify({ mimeType }),
              }
            );
          }

          const metadata: Record<string, unknown> = {
            name: fileName,
            mimeType,
            parents: [targetParentId],
          };
          if (description) metadata.description = description;

          return fetch(
            `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': mimeType,
                'X-Upload-Content-Length': String(Math.round(totalSize)),
              },
              body: JSON.stringify(metadata),
            }
          );
        };

        let activeAuth = driveAuth;
        let initRes = await initSession(parentDriveId, activeAuth.accessToken);
        if (initRes.status === 401) {
          const refreshed = await refreshDriveAuthOn401(activeAuth.mode);
          if (refreshed) {
            activeAuth = refreshed;
            initRes = await initSession(
              rawParent && SAFE_ID_RE.test(rawParent) ? rawParent : activeAuth.rootFolderId,
              activeAuth.accessToken
            );
          }
        }
        if (
          mode === 'create' &&
          initRes.status === 404 &&
          parentDriveId !== activeAuth.rootFolderId
        ) {
          initRes = await initSession(activeAuth.rootFolderId, activeAuth.accessToken);
        }

        if (initRes.status === 401) {
          companyDriveSession = null;
          envDriveTokenCache = null;
          savePersistedDriveState();
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive session expired. Please ask an Administrator to reconnect Company Drive.',
          });
          return;
        }

        if (!initRes.ok) {
          let msg = `Google Drive upload init failed (${initRes.status})`;
          try {
            const errBody = (await initRes.json()) as { error?: { message?: string } };
            if (errBody?.error?.message) msg = errBody.error.message;
          } catch {
            // ignore
          }
          res.status(502).json({ error: msg });
          return;
        }

        const uploadUrl = initRes.headers.get('location') || '';
        if (!uploadUrl || !uploadUrl.startsWith('https://')) {
          res.status(502).json({
            error: 'Google Drive did not return a resumable upload session URL.',
          });
          return;
        }

        // Handle 0-byte empty files immediately in one step
        if (totalSize === 0) {
          const emptyRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': mimeType,
              'Content-Length': '0',
            },
            body: new Uint8Array(0),
          });
          if (!emptyRes.ok) {
            res.status(502).json({
              error: `Google Drive empty-file upload failed (${emptyRes.status}).`,
            });
            return;
          }
          const uploaded = (await emptyRes.json()) as {
            id?: string;
            name?: string;
            mimeType?: string;
            size?: string;
            webViewLink?: string;
            webContentLink?: string;
          };
          const resolvedId = (uploaded?.id || driveFileId || '').trim();
          if (!resolvedId) {
            res.status(502).json({ error: 'Google Drive did not return a valid file ID.' });
            return;
          }
          const sharedPublicLink =
            mode === 'create'
              ? await grantLinkReaderPermission(driveAuth.accessToken, resolvedId)
              : false;
          res.json({
            status: 'complete',
            file: {
              id: resolvedId,
              name:
                typeof uploaded.name === 'string' && uploaded.name.trim()
                  ? uploaded.name.trim()
                  : fileName,
              mimeType:
                typeof uploaded.mimeType === 'string' && uploaded.mimeType.trim()
                  ? uploaded.mimeType.trim()
                  : mimeType,
              sizeBytes: 0,
              webViewLink:
                uploaded.webViewLink || `https://drive.google.com/file/d/${resolvedId}/view`,
              webContentLink:
                uploaded.webContentLink ||
                `https://drive.google.com/uc?id=${resolvedId}&export=download`,
              sharedPublicLink,
            },
          });
          return;
        }

        const sessionId = crypto.randomBytes(20).toString('hex');
        const now = Date.now();
        resumableUploadSessions.set(sessionId, {
          uploadUrl,
          uid: req.fbUser!.uid,
          mode,
          fileName,
          mimeType,
          totalSize: Math.round(totalSize),
          driveFileId,
          createdAt: now,
          lastActivityAt: now,
        });

        res.json({
          status: 'ready',
          sessionId,
          chunkSize: RESUMABLE_CHUNK_BYTES,
        });
      } catch (err: unknown) {
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Could not initialize upload to Company Google Drive.',
        });
      }
    }
  );

  // 5B. Upload a Binary Chunk to an Active Resumable Session
  app.put(
    '/api/drive/upload/chunk/:sessionId',
    requireVerifiedUser,
    express.raw({ type: '*/*', limit: MAX_CHUNK_BODY_BYTES }),
    async (req: AuthedRequest, res: Response) => {
      try {
        const sessionId = String(req.params.sessionId || '').trim();
        if (!SAFE_SESSION_ID_RE.test(sessionId)) {
          res.status(400).json({ error: 'Invalid upload session ID.' });
          return;
        }
        const session = resumableUploadSessions.get(sessionId);
        if (!session) {
          res.status(404).json({
            error: 'Upload session expired or not found. Please retry the upload.',
          });
          return;
        }
        if (session.uid !== req.fbUser!.uid) {
          res.status(403).json({ error: 'Upload session belongs to another user.' });
          return;
        }

        const chunkBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const start = Number(req.headers['x-chunk-start']);
        const end = Number(req.headers['x-chunk-end']);
        const totalSize = Number(req.headers['x-total-size'] || session.totalSize);

        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          !Number.isFinite(totalSize) ||
          start < 0 ||
          end < start ||
          end >= totalSize ||
          chunkBuffer.length !== end - start + 1
        ) {
          res.status(400).json({ error: 'Invalid chunk byte range.' });
          return;
        }

        session.lastActivityAt = Date.now();

        const driveRes = await fetch(session.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': session.mimeType,
            'Content-Length': String(chunkBuffer.length),
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          },
          body: new Uint8Array(chunkBuffer),
        });

        // 308 Resume Incomplete means Google Drive accepted this chunk and awaits the next chunk
        if (driveRes.status === 308) {
          res.json({
            status: 'incomplete',
            uploadedBytes: end + 1,
          });
          return;
        }

        if (driveRes.status === 401) {
          resumableUploadSessions.delete(sessionId);
          companyDriveSession = null;
          envDriveTokenCache = null;
          savePersistedDriveState();
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive session expired. Please ask an Administrator to reconnect Company Drive.',
          });
          return;
        }

        if (driveRes.status === 404 || driveRes.status === 410) {
          resumableUploadSessions.delete(sessionId);
          res.status(410).json({
            error: 'Google Drive upload session expired. Please retry uploading this file.',
          });
          return;
        }

        if (!driveRes.ok) {
          let msg = `Google Drive chunk upload failed (${driveRes.status})`;
          try {
            const errBody = (await driveRes.json()) as { error?: { message?: string } };
            if (errBody?.error?.message) msg = errBody.error.message;
          } catch {
            // ignore
          }
          res.status(502).json({ error: msg });
          return;
        }

        // 200 or 201: Final chunk completed!
        resumableUploadSessions.delete(sessionId);

        const uploaded = (await driveRes.json()) as {
          id?: string;
          name?: string;
          mimeType?: string;
          size?: string;
          webViewLink?: string;
          webContentLink?: string;
        };

        const resolvedId = (uploaded?.id || session.driveFileId || '').trim();
        if (!resolvedId) {
          res.status(502).json({
            error: 'Google Drive did not return a valid file ID after upload.',
          });
          return;
        }

        let sharedPublicLink = false;
        if (session.mode === 'create') {
          const driveAuth = await getActiveCompanyDriveAuth();
          if (driveAuth) {
            sharedPublicLink = await grantLinkReaderPermission(driveAuth.accessToken, resolvedId);
          }
        }

        const resolvedName =
          typeof uploaded.name === 'string' && uploaded.name.trim()
            ? uploaded.name.trim()
            : session.fileName;

        res.json({
          status: 'complete',
          file: {
            id: resolvedId,
            name: resolvedName,
            mimeType:
              typeof uploaded.mimeType === 'string' && uploaded.mimeType.trim()
                ? uploaded.mimeType.trim()
                : session.mimeType,
            sizeBytes: Number(uploaded.size || session.totalSize || 0),
            webViewLink:
              uploaded.webViewLink || `https://drive.google.com/file/d/${resolvedId}/view`,
            webContentLink:
              uploaded.webContentLink ||
              `https://drive.google.com/uc?id=${resolvedId}&export=download`,
            sharedPublicLink,
          },
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Chunk upload to Company Google Drive failed.',
        });
      }
    }
  );

  // 5C. Cancel / Cleanup an Active Resumable Upload Session
  app.delete(
    '/api/drive/upload/session/:sessionId',
    requireVerifiedUser,
    (req: AuthedRequest, res: Response) => {
      const sessionId = String(req.params.sessionId || '').trim();
      const session = resumableUploadSessions.get(sessionId);
      if (session && session.uid === req.fbUser!.uid) {
        resumableUploadSessions.delete(sessionId);
      }
      res.json({ ok: true });
    }
  );

  // 5D. Legacy Single-Request Upload (kept for compatibility with small direct uploads)
  app.post(
    '/api/drive/upload',
    requireVerifiedUser,
    express.raw({ type: '*/*', limit: LEGACY_SINGLE_UPLOAD_BYTES }),
    async (req: AuthedRequest, res: Response) => {
      try {
        const driveAuth = await getActiveCompanyDriveAuth();
        if (!driveAuth) {
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive is not connected yet. Please ask an Administrator to connect Company Drive.',
          });
          return;
        }

        const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (fileBuffer.length === 0) {
          res.status(400).json({ error: 'Uploaded file is empty.' });
          return;
        }

        const rawNameHeader = String(req.headers['x-file-name'] || 'uploaded-file');
        let fileName = 'uploaded-file';
        try {
          fileName = decodeURIComponent(rawNameHeader).trim().slice(0, 200) || 'uploaded-file';
        } catch {
          fileName = rawNameHeader.trim().slice(0, 200) || 'uploaded-file';
        }

        const rawMime = String(req.headers['x-file-mime'] || 'application/octet-stream')
          .replace(/[\r\n]/g, '')
          .trim()
          .slice(0, 120);
        const mimeType =
          /^[a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+$/.test(rawMime) &&
          rawMime !== 'application/octet-stream'
            ? rawMime
            : inferMimeFromFileName(fileName);

        let description = '';
        const rawDesc = String(req.headers['x-file-description'] || '');
        if (rawDesc) {
          try {
            description = decodeURIComponent(rawDesc).trim().slice(0, 400);
          } catch {
            description = rawDesc.trim().slice(0, 400);
          }
        }

        const rawParent = String(req.headers['x-parent-folder-id'] || '').trim();
        const parentDriveId =
          rawParent && SAFE_ID_RE.test(rawParent) ? rawParent : driveAuth.rootFolderId;

        if (parentDriveId === driveAuth.rootFolderId) {
          const isDev = await checkIsDeveloper(req.fbUser!, req.fbIdToken!);
          if (!isDev) {
            res.status(403).json({
              error:
                'Only Developers can upload directly to Company Drive root. Please upload inside a folder.',
            });
            return;
          }
        }

        const uploadOnce = async (targetParentId: string) => {
          const metadata: Record<string, unknown> = {
            name: fileName,
            mimeType,
            parents: [targetParentId],
          };
          if (description) metadata.description = description;

          const boundary = `kejmin_srv_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
          const headPart = Buffer.from(
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
              metadata
            )}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
            'utf8'
          );
          const tailPart = Buffer.from(`\r\n--${boundary}--`, 'utf8');
          const multipartPayload = Buffer.concat([headPart, fileBuffer, tailPart]);

          return fetch(
            `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${driveAuth.accessToken}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
                'Content-Length': String(multipartPayload.length),
              },
              body: new Uint8Array(multipartPayload),
            }
          );
        };

        let driveRes = await uploadOnce(parentDriveId);
        if (driveRes.status === 404 && parentDriveId !== driveAuth.rootFolderId) {
          driveRes = await uploadOnce(driveAuth.rootFolderId);
        }

        if (driveRes.status === 401) {
          companyDriveSession = null;
          envDriveTokenCache = null;
          savePersistedDriveState();
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive session expired. Please ask an Administrator to reconnect Company Drive.',
          });
          return;
        }

        if (!driveRes.ok) {
          let msg = `Google Drive upload failed (${driveRes.status})`;
          try {
            const errBody = (await driveRes.json()) as { error?: { message?: string } };
            if (errBody?.error?.message) msg = errBody.error.message;
          } catch {
            // ignore
          }
          res.status(502).json({ error: msg });
          return;
        }

        const uploaded = (await driveRes.json()) as {
          id?: string;
          name?: string;
          mimeType?: string;
          size?: string;
          webViewLink?: string;
          webContentLink?: string;
        };

        if (!uploaded?.id || typeof uploaded.id !== 'string') {
          res.status(502).json({
            error: 'Google Drive did not return a valid file ID after upload. Please try again.',
          });
          return;
        }

        const sharedPublicLink = await grantLinkReaderPermission(
          driveAuth.accessToken,
          uploaded.id
        );

        const resolvedName =
          typeof uploaded.name === 'string' && uploaded.name.trim()
            ? uploaded.name.trim()
            : fileName;

        res.json({
          id: uploaded.id,
          name: resolvedName,
          mimeType:
            typeof uploaded.mimeType === 'string' && uploaded.mimeType.trim()
              ? uploaded.mimeType.trim()
              : mimeType,
          sizeBytes: Number(uploaded.size || fileBuffer.length || 0),
          webViewLink:
            uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
          webContentLink:
            uploaded.webContentLink ||
            `https://drive.google.com/uc?id=${uploaded.id}&export=download`,
          sharedPublicLink,
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Upload to Company Google Drive failed.',
        });
      }
    }
  );

  // 6. Stream / Download File Content from Shared Company Google Drive (100% In-App, Streaming for Any Size)
  app.get(
    '/api/drive/items/:driveFileId/content',
    requireVerifiedUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const driveFileId = String(req.params.driveFileId || '').trim();
        if (!SAFE_ID_RE.test(driveFileId)) {
          res.status(400).json({ error: 'Invalid Google Drive file ID.' });
          return;
        }
        const firestoreDocId = String(req.query.docId || '').trim();
        const isDownload = String(req.query.download || '') === '1';

        const access = await verifyDriveFileReadAccess({
          user: req.fbUser!,
          idToken: req.fbIdToken!,
          firestoreDocId,
          driveFileId,
          requireDownloadAllowed: isDownload,
        });
        if (!access.allowed) {
          res.status(403).json({ error: access.reason || 'Access denied.' });
          return;
        }

        const driveAuth = await getActiveCompanyDriveAuth();
        if (!driveAuth) {
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive is not connected right now. Please ask an Administrator to connect Company Drive.',
          });
          return;
        }

        const upstreamHeaders: Record<string, string> = {
          Authorization: `Bearer ${driveAuth.accessToken}`,
        };
        if (typeof req.headers.range === 'string' && req.headers.range.startsWith('bytes=')) {
          upstreamHeaders.Range = req.headers.range;
        }

        let activeAuth = driveAuth;
        const fetchContent = (token: string) =>
          fetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(
              driveFileId
            )}?alt=media&supportsAllDrives=true`,
            {
              headers: {
                ...upstreamHeaders,
                Authorization: `Bearer ${token}`,
              },
            }
          );

        let driveRes = await fetchContent(activeAuth.accessToken);
        if (driveRes.status === 401) {
          const refreshed = await refreshDriveAuthOn401(activeAuth.mode);
          if (refreshed) {
            activeAuth = refreshed;
            driveRes = await fetchContent(activeAuth.accessToken);
          }
        }

        // If the item is a native Google Doc/Sheet/Slide, export as PDF/XLSX cleanly
        if (driveRes.status === 403 || driveRes.status === 400) {
          const mt = (access.mimeType || '').toLowerCase();
          if (mt.startsWith('application/vnd.google-apps.')) {
            const exportMime = mt.includes('spreadsheet')
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'application/pdf';
            driveRes = await fetch(
              `${DRIVE_API_BASE}/files/${encodeURIComponent(
                driveFileId
              )}/export?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`,
              {
                headers: { Authorization: `Bearer ${activeAuth.accessToken}` },
              }
            );
          }
        }

        if (driveRes.status === 401) {
          companyDriveSession = null;
          envDriveTokenCache = null;
          savePersistedDriveState();
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive session expired. Please ask an Administrator to reconnect Company Drive.',
          });
          return;
        }
        if (driveRes.status === 404) {
          res.status(404).json({ error: 'File was not found in Company Google Drive.' });
          return;
        }
        if (!driveRes.ok && driveRes.status !== 206) {
          res
            .status(502)
            .json({ error: `Could not load file from Company Drive (${driveRes.status}).` });
          return;
        }

        const safeAsciiName =
          (access.fileName || 'file')
            .replace(/[\r\n"\\]/g, '_')
            .replace(/[^\x20-\x7E]/g, '_')
            .slice(0, 180) || 'file';

        const rawUpstreamMime = (driveRes.headers.get('content-type') || '').split(';')[0].trim();
        const inferredMime = inferMimeFromFileName(access.fileName || '');
        const isHtmlExpected = inferredMime === 'text/html' || access.mimeType === 'text/html';

        // Guard: if Google Drive returned an HTML error/login page for a non-HTML file, fail clearly
        if (rawUpstreamMime === 'text/html' && !isHtmlExpected) {
          res.status(502).json({
            error:
              'Company Google Drive returned an unexpected HTML page instead of file bytes. Please reconnect Company Drive and retry.',
          });
          return;
        }

        const resolvedMime =
          rawUpstreamMime && rawUpstreamMime !== 'application/octet-stream'
            ? rawUpstreamMime
            : access.mimeType && access.mimeType !== 'application/octet-stream'
            ? access.mimeType
            : inferredMime;

        res.status(driveRes.status === 206 ? 206 : 200);
        res.setHeader('Content-Type', resolvedMime || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader(
          'Content-Disposition',
          `${isDownload ? 'attachment' : 'inline'}; filename="${safeAsciiName}"`
        );

        const contentLength = driveRes.headers.get('content-length');
        if (contentLength) {
          res.setHeader('Content-Length', contentLength);
        }
        const contentRange = driveRes.headers.get('content-range');
        if (contentRange) {
          res.setHeader('Content-Range', contentRange);
        }
        const acceptRanges = driveRes.headers.get('accept-ranges');
        if (acceptRanges) {
          res.setHeader('Accept-Ranges', acceptRanges);
        }

        if (driveRes.body) {
          const nodeStream = Readable.fromWeb(
            driveRes.body as unknown as import('node:stream/web').ReadableStream
          );
          nodeStream.on('error', () => {
            if (!res.headersSent) {
              res.status(502).json({ error: 'Stream interrupted while reading file from Company Drive.' });
            } else {
              res.end();
            }
          });
          nodeStream.pipe(res);
        } else {
          const buf = Buffer.from(await driveRes.arrayBuffer());
          res.setHeader('Content-Length', String(buf.length));
          res.send(buf);
        }
      } catch (err: unknown) {
        if (!res.headersSent) {
          res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to load file content.',
          });
        } else {
          res.end();
        }
      }
    }
  );

  // 7. Legacy Single-Request Replace Content (for small inline edits; large files use /api/drive/upload/init + chunk)
  app.put(
    '/api/drive/items/:driveFileId/content',
    requireVerifiedUser,
    express.raw({ type: '*/*', limit: LEGACY_SINGLE_UPLOAD_BYTES }),
    async (req: AuthedRequest, res: Response) => {
      try {
        const driveFileId = String(req.params.driveFileId || '').trim();
        if (!SAFE_ID_RE.test(driveFileId)) {
          res.status(400).json({ error: 'Invalid Google Drive file ID.' });
          return;
        }
        const firestoreDocId = String(req.headers['x-firestore-doc-id'] || '').trim();
        if (!SAFE_DOC_ID_RE.test(firestoreDocId)) {
          res.status(400).json({ error: 'Valid file record ID is required.' });
          return;
        }

        const allowed = await verifyDriveItemPermission({
          user: req.fbUser!,
          idToken: req.fbIdToken!,
          itemKind: 'file',
          firestoreDocId,
          driveFileId,
        });
        if (!allowed) {
          res.status(403).json({ error: 'You do not have permission to modify this file.' });
          return;
        }

        const driveAuth = await getActiveCompanyDriveAuth();
        if (!driveAuth) {
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error:
              'Company Google Drive is not connected. Please ask an Administrator to connect Company Drive.',
          });
          return;
        }

        const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const rawMime = String(req.headers['x-file-mime'] || 'application/octet-stream')
          .replace(/[\r\n]/g, '')
          .trim()
          .slice(0, 120);
        const mimeType = /^[a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+$/.test(rawMime)
          ? rawMime
          : 'application/octet-stream';

        const patchContent = (token: string) =>
          fetch(
            `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(
              driveFileId
            )}?uploadType=media&supportsAllDrives=true&fields=id,name,mimeType,size`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': mimeType,
                'Content-Length': String(fileBuffer.length),
              },
              body: new Uint8Array(fileBuffer),
            }
          );

        let driveRes = await patchContent(driveAuth.accessToken);
        if (driveRes.status === 401) {
          const refreshed = await refreshDriveAuthOn401(driveAuth.mode);
          if (refreshed) {
            driveRes = await patchContent(refreshed.accessToken);
          }
        }

        if (driveRes.status === 401) {
          companyDriveSession = null;
          envDriveTokenCache = null;
          savePersistedDriveState();
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error: 'Company Google Drive session expired.',
          });
          return;
        }
        if (!driveRes.ok) {
          let msg = `Google Drive content update failed (${driveRes.status})`;
          try {
            const errBody = (await driveRes.json()) as { error?: { message?: string } };
            if (errBody?.error?.message) msg = errBody.error.message;
          } catch {
            // ignore
          }
          res.status(502).json({ error: msg });
          return;
        }

        const updated = (await driveRes.json()) as {
          id: string;
          name?: string;
          mimeType?: string;
          size?: string;
        };

        res.json({
          id: updated.id || driveFileId,
          name: updated.name || '',
          mimeType: updated.mimeType || mimeType,
          sizeBytes: Number(updated.size ?? fileBuffer.length ?? 0),
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to update file content.',
        });
      }
    }
  );

  // 8. Rename and/or Move File or Folder in the Shared Company Google Drive (Uploader or Admin/Developer)
  app.patch(
    '/api/drive/items/:driveFileId',
    requireVerifiedUser,
    jsonParser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const driveFileId = String(req.params.driveFileId || '').trim();
        if (!SAFE_ID_RE.test(driveFileId)) {
          res.status(400).json({ error: 'Invalid Google Drive item ID.' });
          return;
        }

        const newName =
          typeof req.body?.newName === 'string' ? req.body.newName.trim().slice(0, 200) : '';
        const itemKind = req.body?.itemKind === 'folder' ? 'folder' : 'file';
        const firestoreDocId =
          typeof req.body?.firestoreDocId === 'string' ? req.body.firestoreDocId.trim() : '';
        const rawNewParent =
          typeof req.body?.newParentDriveFolderId === 'string'
            ? req.body.newParentDriveFolderId.trim()
            : '';

        if (!newName || !SAFE_DOC_ID_RE.test(firestoreDocId)) {
          res.status(400).json({ error: 'Valid item name and record ID are required.' });
          return;
        }

        const allowed = await verifyDriveItemPermission({
          user: req.fbUser!,
          idToken: req.fbIdToken!,
          itemKind,
          firestoreDocId,
          driveFileId,
        });
        if (!allowed) {
          res.status(403).json({ error: 'You do not have permission to update this Drive item.' });
          return;
        }

        const driveAuth = await getActiveCompanyDriveAuth();
        if (!driveAuth) {
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error: 'Company Google Drive is not connected.',
          });
          return;
        }

        const queryParams = new URLSearchParams({
          supportsAllDrives: 'true',
          fields: 'id,name,parents',
        });

        // If a folder move was requested, resolve current parents and update them atomically
        if (rawNewParent) {
          const targetParentId =
            rawNewParent === 'ROOT'
              ? driveAuth.rootFolderId
              : SAFE_ID_RE.test(rawNewParent)
              ? rawNewParent
              : '';
          if (itemKind === 'file' && targetParentId === driveAuth.rootFolderId) {
            const isDev = await checkIsDeveloper(req.fbUser!, req.fbIdToken!);
            if (!isDev) {
              res.status(403).json({
                error: 'Only Developers can move files to Company Drive root.',
              });
              return;
            }
          }
          if (targetParentId && targetParentId !== driveFileId) {
            try {
              const metaRes = await fetch(
                `${DRIVE_API_BASE}/files/${encodeURIComponent(
                  driveFileId
                )}?supportsAllDrives=true&fields=parents`,
                {
                  headers: { Authorization: `Bearer ${driveAuth.accessToken}` },
                }
              );
              if (metaRes.ok) {
                const meta = (await metaRes.json()) as { parents?: string[] };
                const existingParents = (meta.parents || []).filter((p) => p !== targetParentId);
                queryParams.set('addParents', targetParentId);
                if (existingParents.length > 0) {
                  queryParams.set('removeParents', existingParents.join(','));
                }
              }
            } catch {
              // continue with rename even if parent lookup failed
            }
          }
        }

        const patchMeta = (token: string) =>
          fetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(driveFileId)}?${queryParams.toString()}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ name: newName }),
            }
          );

        let driveRes = await patchMeta(driveAuth.accessToken);
        if (driveRes.status === 401) {
          const refreshed = await refreshDriveAuthOn401(driveAuth.mode);
          if (refreshed) {
            driveRes = await patchMeta(refreshed.accessToken);
          }
        }

        if (driveRes.status === 401) {
          companyDriveSession = null;
          envDriveTokenCache = null;
          savePersistedDriveState();
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error: 'Company Google Drive session expired.',
          });
          return;
        }
        if (driveRes.status === 404) {
          res.json({ ok: true, skipped: true });
          return;
        }
        if (!driveRes.ok) {
          res.status(502).json({ error: `Google Drive update failed (${driveRes.status}).` });
          return;
        }
        res.json({ ok: true });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Update failed.',
        });
      }
    }
  );

  // 7. Delete File or Folder from the Shared Company Google Drive (Uploader or Admin/Developer)
  app.delete(
    '/api/drive/items/:driveFileId',
    requireVerifiedUser,
    jsonParser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const driveFileId = String(req.params.driveFileId || '').trim();
        if (!SAFE_ID_RE.test(driveFileId)) {
          res.status(400).json({ error: 'Invalid Google Drive item ID.' });
          return;
        }

        const itemKind = req.body?.itemKind === 'folder' ? 'folder' : 'file';
        const firestoreDocId =
          typeof req.body?.firestoreDocId === 'string' ? req.body.firestoreDocId.trim() : '';
        if (!SAFE_DOC_ID_RE.test(firestoreDocId)) {
          res.status(400).json({ error: 'Valid record ID is required.' });
          return;
        }

        const allowed = await verifyDriveItemPermission({
          user: req.fbUser!,
          idToken: req.fbIdToken!,
          itemKind,
          firestoreDocId,
          driveFileId,
        });
        if (!allowed) {
          res.status(403).json({ error: 'You do not have permission to delete this Drive item.' });
          return;
        }

        const driveAuth = await getActiveCompanyDriveAuth();
        if (!driveAuth) {
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error: 'Company Google Drive is not connected.',
          });
          return;
        }

        const deleteItem = (token: string) =>
          fetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(driveFileId)}?supportsAllDrives=true`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }
          );

        let driveRes = await deleteItem(driveAuth.accessToken);
        if (driveRes.status === 401) {
          const refreshed = await refreshDriveAuthOn401(driveAuth.mode);
          if (refreshed) {
            driveRes = await deleteItem(refreshed.accessToken);
          }
        }

        if (driveRes.status === 401) {
          companyDriveSession = null;
          envDriveTokenCache = null;
          savePersistedDriveState();
          res.status(503).json({
            code: 'DRIVE_NOT_CONNECTED',
            error: 'Company Google Drive session expired.',
          });
          return;
        }
        if (driveRes.status === 404 || driveRes.ok) {
          res.json({ ok: true });
          return;
        }
        res.status(502).json({ error: `Google Drive delete failed (${driveRes.status}).` });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Delete failed.',
        });
      }
    }
  );

  // Ensure /api/* never falls through to Vite or index.html (always returns JSON)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof (err as { status?: number })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
    const message = err instanceof Error ? err.message : 'Server API error.';
    res.status(status).json({ error: message });
  });

  // Mount Vite middleware in development or static dist/ in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KEJMIN OPS server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
