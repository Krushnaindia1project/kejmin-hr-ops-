import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

const firestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-864da643-fbf0-4e48-b140-7c8b27d53828';

export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export const googleProvider = new GoogleAuthProvider();
SCOPES.forEach((scope) => googleProvider.addScope(scope));
googleProvider.setCustomParameters({ prompt: 'select_account' });

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

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

interface GisWindow extends Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          hint?: string;
          prompt?: string;
          callback: (resp: GisTokenResponse) => void;
          error_callback?: (err: { type?: string; message?: string }) => void;
        }) => GisTokenClient;
      };
    };
  };
}

const GOOGLE_OAUTH_CLIENT_ID =
  (firebaseConfig as { oAuthClientId?: string }).oAuthClientId || '';

function waitForGisOAuth(timeoutMs = 4000): Promise<NonNullable<NonNullable<GisWindow['google']>['accounts']>['oauth2'] | null> {
  return new Promise((resolve) => {
    const win = window as GisWindow;
    if (win.google?.accounts?.oauth2) {
      resolve(win.google.accounts.oauth2);
      return;
    }
    const start = Date.now();
    const timer = window.setInterval(() => {
      if (win.google?.accounts?.oauth2) {
        window.clearInterval(timer);
        resolve(win.google.accounts.oauth2);
      } else if (Date.now() - start >= timeoutMs) {
        window.clearInterval(timer);
        resolve(null);
      }
    }, 120);
  });
}

let silentRefreshInFlight: Promise<string | null> | null = null;

/**
 * Attempts to silently obtain a fresh Google Drive access token using Google Identity Services
 * (`prompt: ''`) WITHOUT showing any popup or interrupting the user.
 * Returns null quietly if silent consent is unavailable.
 */
export async function trySilentGoogleDriveToken(loginHint?: string | null): Promise<string | null> {
  if (!GOOGLE_OAUTH_CLIENT_ID) return null;
  if (silentRefreshInFlight) return silentRefreshInFlight;

  silentRefreshInFlight = (async () => {
    const oauth2 = await waitForGisOAuth(4000);
    if (!oauth2) return null;

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (val: string | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(val);
      };

      const timer = window.setTimeout(() => done(null), 10_000);

      try {
        const hint = (loginHint || auth.currentUser?.email || '').trim() || undefined;
        const client = oauth2.initTokenClient({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          scope: SCOPES.join(' '),
          hint,
          prompt: '',
          callback: (resp) => {
            if (resp && !resp.error && resp.access_token) {
              setDriveAccessToken(resp.access_token, hint || auth.currentUser?.email);
              done(resp.access_token);
            } else {
              done(null);
            }
          },
          error_callback: () => {
            done(null);
          },
        });
        client.requestAccessToken({ prompt: '', hint });
      } catch {
        done(null);
      }
    });
  })().finally(() => {
    silentRefreshInFlight = null;
  });

  return silentRefreshInFlight;
}

/**
 * Prompts Google Sign-In with Drive scope to obtain a fresh access token.
 * Uses GIS OAuth Token Client when available (so subsequent silent renewals work seamlessly),
 * with automatic fallback to Firebase GoogleAuthProvider popup.
 * Must be called from a direct user interaction (button click).
 */
export async function connectGoogleDrive(
  loginHint?: string | null
): Promise<{ user: User; accessToken: string }> {
  const currentUser = auth.currentUser;
  const win = window as GisWindow;

  if (currentUser && GOOGLE_OAUTH_CLIENT_ID && win.google?.accounts?.oauth2) {
    try {
      const accessToken = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const client = win.google!.accounts!.oauth2!.initTokenClient({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          scope: SCOPES.join(' '),
          hint: (loginHint || currentUser.email || '').trim() || undefined,
          prompt: 'select_account',
          callback: (resp) => {
            if (settled) return;
            settled = true;
            if (resp && !resp.error && resp.access_token) {
              resolve(resp.access_token);
            } else {
              reject(
                new Error(
                  resp?.error_description ||
                    resp?.error ||
                    'Could not obtain Google Drive access permission.'
                )
              );
            }
          },
          error_callback: (err) => {
            if (settled) return;
            settled = true;
            reject(new Error(err?.message || 'Google Drive sign-in was cancelled.'));
          },
        });
        client.requestAccessToken({ prompt: 'select_account' });
      });

      setDriveAccessToken(accessToken, loginHint || currentUser.email);
      return { user: currentUser, accessToken };
    } catch (gisErr) {
      const msg = gisErr instanceof Error ? gisErr.message.toLowerCase() : '';
      if (msg.includes('cancel') || msg.includes('popup_closed') || msg.includes('access_denied')) {
        throw gisErr;
      }
      // Otherwise fall back to Firebase popup below
    }
  }

  try {
    isDriveSigningIn = true;
    const provider = new GoogleAuthProvider();
    SCOPES.forEach((scope) => provider.addScope(scope));
    provider.setCustomParameters({ prompt: 'consent select_account' });
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Drive access permission. Please try again.');
    }
    setDriveAccessToken(credential.accessToken, result.user.email);
    return { user: result.user, accessToken: credential.accessToken };
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
