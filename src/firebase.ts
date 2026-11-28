import { getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const PROVISIONER_APP_NAME = 'kejmin-provisioner';

const firestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-864da643-fbf0-4e48-b140-7c8b27d53828';

export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export const googleProvider = new GoogleAuthProvider();
SCOPES.forEach((scope) => googleProvider.addScope(scope));
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function buildEmployeeAuthEmail(empId: string, version = 1): string {
  const clean = empId.trim().toLowerCase();
  const v = Number.isInteger(version) && version > 1 ? version : 1;
  return v === 1 ? `${clean}@kejmin.in` : `${clean}.v${v}@kejmin.in`;
}

function getProvisionerAuth() {
  const existing = getApps().find((a) => a.name === PROVISIONER_APP_NAME);
  const provApp = existing || initializeApp(firebaseConfig, PROVISIONER_APP_NAME);
  return getAuth(provApp);
}

/**
 * Provisions a Firebase Email/Password account for an employee using an isolated
 * secondary Firebase App instance so the Admin's own session is never disturbed.
 */
export async function provisionEmployeeAuthAccount(
  empId: string,
  password: string,
  startVersion = 1
): Promise<{ uid: string; email: string; loginVersion: number }> {
  const provAuth = getProvisionerAuth();
  const baseVersion = Math.max(1, Math.floor(startVersion));
  let lastError: unknown = null;

  for (let offset = 0; offset < 15; offset++) {
    const version = baseVersion + offset;
    const email = buildEmployeeAuthEmail(empId, version);
    try {
      const cred = await createUserWithEmailAndPassword(provAuth, email, password);
      const uid = cred.user.uid;
      await signOut(provAuth).catch(() => {});
      return { uid, email, loginVersion: version };
    } catch (err: unknown) {
      lastError = err;
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/email-already-in-use') {
        continue;
      }
      await signOut(provAuth).catch(() => {});
      if (code === 'auth/operation-not-allowed') {
        throw new Error(
          'Email/Password sign-in is not enabled in Firebase Authentication yet. Enable the Email/Password provider in Firebase Console (Authentication -> Sign-in method) and try again.'
        );
      }
      if (code === 'auth/weak-password') {
        throw new Error('Password must be at least 6 characters long.');
      }
      throw err;
    }
  }

  await signOut(provAuth).catch(() => {});
  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to provision login credentials for this user ID.');
}

/**
 * Signs an employee directly into Firebase Auth with their User ID & password
 * (no Google popup or AI Studio tester whitelist required).
 */
export async function signInEmployeeWithPassword(
  empId: string,
  password: string,
  version = 1
): Promise<User> {
  const email = buildEmployeeAuthEmail(empId, version);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * Keeps Firebase Email/Password credentials in sync when an employee changes their own password.
 */
export async function updateOwnFirebasePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) return;
  const usesPasswordProvider = user.providerData.some((p) => p.providerId === 'password');
  if (!usesPasswordProvider) return;

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

// In-memory Google Drive OAuth access token cache (never persisted to localStorage/sessionStorage)
let cachedDriveAccessToken: string | null = null;
let cachedDriveAccountEmail: string | null = null;
let isDriveSigningIn = false;
const driveTokenListeners = new Set<() => void>();

function notifyDriveTokenListeners() {
  driveTokenListeners.forEach((fn) => fn());
}

export function subscribeDriveTokenState(listener: () => void): () => void {
  driveTokenListeners.add(listener);
  return () => {
    driveTokenListeners.delete(listener);
  };
}

export function setDriveAccessToken(token: string | null, email?: string | null) {
  cachedDriveAccessToken = token;
  cachedDriveAccountEmail = token ? (email ?? auth.currentUser?.email ?? null) : null;
  notifyDriveTokenListeners();
}

export function getDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export function getDriveAccountEmail(): string | null {
  return cachedDriveAccountEmail;
}

export function clearDriveAccessToken() {
  cachedDriveAccessToken = null;
  cachedDriveAccountEmail = null;
  notifyDriveTokenListeners();
}

// Clear cached access token automatically when Firebase Auth user signs out
onAuthStateChanged(auth, (user) => {
  if (!user && !isDriveSigningIn) {
    clearDriveAccessToken();
  }
});

/**
 * Prompts Google Sign-In with Drive scope via Firebase Auth to obtain a fresh access token.
 * Must be called directly from a user interaction (button click) so the popup is never blocked.
 */
export async function connectGoogleDrive(
  loginHint?: string | null
): Promise<{ user: User; accessToken: string }> {
  try {
    isDriveSigningIn = true;
    const provider = new GoogleAuthProvider();
    SCOPES.forEach((scope) => provider.addScope(scope));
    const customParams: Record<string, string> = {
      prompt: 'consent select_account',
    };
    const cleanHint = (loginHint || auth.currentUser?.email || '').trim();
    if (cleanHint) {
      customParams.login_hint = cleanHint;
    }
    provider.setCustomParameters(customParams);

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Drive access permission. Please try again.');
    }
    setDriveAccessToken(credential.accessToken, result.user.email);
    return { user: result.user, accessToken: credential.accessToken };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/popup-blocked') {
      throw new Error('Browser blocked the Google sign-in popup. Please allow popups for this site and try again.');
    }
    throw err;
  } finally {
    isDriveSigningIn = false;
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
