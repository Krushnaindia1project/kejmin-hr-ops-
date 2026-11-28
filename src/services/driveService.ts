import { auth } from '../firebase';

export class DriveConnectionRequiredError extends Error {
  constructor(
    message = 'Company Google Drive is not connected yet. Please ask an Administrator to connect Company Drive.'
  ) {
    super(message);
    this.name = 'DriveConnectionRequiredError';
  }
}

export interface DriveEnvChecklist {
  hasRefreshToken: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasServiceAccount: boolean;
  hasSharedFolderId: boolean;
}

export interface CompanyDriveStatus {
  connected: boolean;
  mode: 'service_account' | 'refresh_token' | 'session' | 'none';
  permanent: boolean;
  permanentConfigured?: boolean;
  permanentMode?: 'service_account' | 'refresh_token' | null;
  connectedBy: string | null;
  accountLabel: string | null;
  connectedAt: string | null;
  expiresAt: number | null;
  rootFolderId: string | null;
  rootFolderUrl: string | null;
  configWarning?: string | null;
  manuallyDisconnected?: boolean;
  hintEmail?: string | null;
  envChecklist?: DriveEnvChecklist | null;
}

export interface DriveFolderResult {
  id: string;
  name: string;
  webViewLink: string;
}

export interface DriveUploadedFileResult {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  webViewLink: string;
  webContentLink: string;
  sharedPublicLink: boolean;
}

async function getFirebaseIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in first.');
  }
  return user.getIdToken();
}

async function parseApiJson<T>(res: Response): Promise<T> {
  const rawText = await res.text();
  let body: Record<string, unknown> | null = null;
  if (rawText.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const msg =
      typeof body?.error === 'string'
        ? body.error
        : `Server request failed (${res.status})`;
    if (res.status === 503 || body?.code === 'DRIVE_NOT_CONNECTED') {
      throw new DriveConnectionRequiredError(msg);
    }
    throw new Error(msg);
  }
  if (!body) {
    throw new Error(
      `The app server returned a non-JSON response (${res.status}). Wait a moment for the server to finish restarting or refresh the page and try again.`
    );
  }
  return body as T;
}

/**
 * Fetches an authenticated `/api/drive/*` JSON endpoint with `credentials: 'include'` and
 * `cache: 'no-store'` (required behind Cloud Run / AI Studio auth proxies) and retries once
 * if a transient HTML interstitial / restart page is returned.
 */
async function fetchDriveApiJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const idToken = await getFirebaseIdToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${idToken}`);
    headers.set('Accept', 'application/json');

    const res = await fetch(url, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers,
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && !contentType.includes('application/json') && attempt === 0) {
      // Transient proxy interstitial or dev-server restart HTML — retry once cleanly
      await new Promise((r) => window.setTimeout(r, 700));
      continue;
    }
    try {
      return await parseApiJson<T>(res);
    } catch (err: unknown) {
      lastErr = err;
      if (
        attempt === 0 &&
        err instanceof Error &&
        err.message.includes('non-JSON response')
      ) {
        await new Promise((r) => window.setTimeout(r, 700));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Server request failed. Please try again.');
}

/**
 * Checks whether the shared Company Google Drive is currently connected on the server.
 */
export async function fetchCompanyDriveStatus(): Promise<CompanyDriveStatus> {
  return fetchDriveApiJson<CompanyDriveStatus>('/api/drive/status', {
    method: 'GET',
  });
}

/**
 * Registers the Administrator's Google Drive OAuth access token on the server so ALL
 * verified KEJMIN OPS users upload into the exact same Company Google Drive.
 */
export async function connectCompanyDriveOnServer(
  driveAccessToken: string,
  connectedByName?: string
): Promise<CompanyDriveStatus> {
  return fetchDriveApiJson<CompanyDriveStatus>('/api/drive/connect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Drive-Access-Token': driveAccessToken,
    },
    body: JSON.stringify({ connectedByName: connectedByName || '' }),
  });
}

/**
 * Re-enables the permanent server-configured Company Google Drive connection without any browser popup.
 */
export async function reconnectPermanentCompanyDriveOnServer(): Promise<CompanyDriveStatus> {
  return fetchDriveApiJson<CompanyDriveStatus>('/api/drive/connect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ usePermanent: true }),
  });
}

/**
 * Disconnects the shared Company Google Drive session on the server (Admin/Developer only).
 */
export async function disconnectCompanyDriveOnServer(): Promise<CompanyDriveStatus> {
  return fetchDriveApiJson<CompanyDriveStatus>('/api/drive/disconnect', {
    method: 'POST',
  });
}

/**
 * Creates a subfolder inside the shared Company Google Drive.
 */
export async function createCompanyDriveFolder(
  folderName: string,
  parentDriveFolderId?: string
): Promise<DriveFolderResult> {
  return fetchDriveApiJson<DriveFolderResult>('/api/drive/folders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName.trim().slice(0, 100),
      parentDriveFolderId: parentDriveFolderId || '',
    }),
  });
}

interface ResumableInitResponse {
  status: 'ready' | 'complete';
  sessionId?: string;
  chunkSize?: number;
  file?: Partial<DriveUploadedFileResult>;
}

interface ResumableChunkResponse {
  status: 'incomplete' | 'complete';
  uploadedBytes?: number;
  file?: Partial<DriveUploadedFileResult>;
}

function normalizeUploadedFileResult(
  raw: Partial<DriveUploadedFileResult> | undefined,
  fallback: { id?: string; name: string; mimeType: string; sizeBytes: number }
): DriveUploadedFileResult {
  const resolvedId =
    (typeof raw?.id === 'string' && raw.id.trim()) ||
    (typeof fallback.id === 'string' && fallback.id.trim()) ||
    '';
  if (!resolvedId) {
    throw new Error(
      'Upload server did not return a valid file response. Please refresh the page and try uploading again.'
    );
  }
  const resolvedName =
    typeof raw?.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : (fallback.name || 'uploaded-file').trim() || 'uploaded-file';
  const resolvedMime =
    typeof raw?.mimeType === 'string' && raw.mimeType.trim()
      ? raw.mimeType.trim()
      : fallback.mimeType || inferMimeTypeFromFileName(resolvedName);
  const resolvedSize =
    typeof raw?.sizeBytes === 'number' && Number.isFinite(raw.sizeBytes) && raw.sizeBytes >= 0
      ? raw.sizeBytes
      : fallback.sizeBytes || 0;
  const resolvedView =
    typeof raw?.webViewLink === 'string' && raw.webViewLink.trim()
      ? raw.webViewLink.trim()
      : `https://drive.google.com/file/d/${resolvedId}/view`;
  const resolvedDownload =
    typeof raw?.webContentLink === 'string' && raw.webContentLink.trim()
      ? raw.webContentLink.trim()
      : `https://drive.google.com/uc?id=${resolvedId}&export=download`;

  return {
    id: resolvedId,
    name: resolvedName,
    mimeType: resolvedMime,
    sizeBytes: resolvedSize,
    webViewLink: resolvedView,
    webContentLink: resolvedDownload,
    sharedPublicLink: Boolean(raw?.sharedPublicLink),
  };
}

function sendSingleUploadChunk(params: {
  sessionId: string;
  idToken: string;
  chunk: Blob;
  start: number;
  end: number;
  totalSize: number;
  onChunkProgress?: (loadedInChunk: number) => void;
}): Promise<ResumableChunkResponse> {
  const { sessionId, idToken, chunk, start, end, totalSize, onChunkProgress } = params;

  return new Promise<ResumableChunkResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/drive/upload/chunk/${encodeURIComponent(sessionId)}`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Chunk-Start', String(start));
    xhr.setRequestHeader('X-Chunk-End', String(end));
    xhr.setRequestHeader('X-Total-Size', String(totalSize));

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onChunkProgress) {
        onChunkProgress(Math.min(chunk.size, ev.loaded));
      }
    };

    xhr.onload = () => {
      const rawText = xhr.responseText || '';
      let body: Record<string, unknown> | null = null;
      if (rawText.trim()) {
        try {
          const parsed: unknown = JSON.parse(rawText);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            body = parsed as Record<string, unknown>;
          }
        } catch {
          body = null;
        }
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (!body || (body.status !== 'incomplete' && body.status !== 'complete')) {
          reject(
            new Error(
              'Upload server returned an unexpected response for this chunk. Please retry.'
            )
          );
          return;
        }
        resolve(body as unknown as ResumableChunkResponse);
        return;
      }

      const msg =
        typeof body?.error === 'string'
          ? body.error
          : `Upload chunk failed (${xhr.status})`;
      if (xhr.status === 503 || body?.code === 'DRIVE_NOT_CONNECTED') {
        reject(new DriveConnectionRequiredError(msg));
        return;
      }
      const err = new Error(msg) as Error & { status?: number };
      err.status = xhr.status;
      reject(err);
    };

    xhr.onerror = () => {
      const err = new Error('Network error while uploading chunk to Company Google Drive.') as Error & {
        retryable?: boolean;
      };
      err.retryable = true;
      reject(err);
    };

    xhr.send(chunk);
  });
}

async function runChunkedResumableUpload(params: {
  mode: 'create' | 'replace';
  blob: Blob;
  fileName: string;
  mimeType: string;
  parentDriveFolderId?: string;
  description?: string;
  driveFileId?: string;
  firestoreDocId?: string;
  onProgress?: (percent: number) => void;
}): Promise<DriveUploadedFileResult> {
  const {
    mode,
    blob,
    fileName,
    mimeType,
    parentDriveFolderId,
    description,
    driveFileId,
    firestoreDocId,
    onProgress,
  } = params;

  const totalSize = blob.size;
  const resolvedMime =
    mimeType && mimeType !== 'application/octet-stream'
      ? mimeType
      : inferMimeTypeFromFileName(fileName);

  const initToken = await getFirebaseIdToken();
  const initRes = await fetch('/api/drive/upload/init', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${initToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode,
      fileName: (fileName || 'uploaded-file').slice(0, 200),
      mimeType: resolvedMime,
      totalSize,
      parentFolderId: parentDriveFolderId || '',
      description: description?.trim().slice(0, 400) || '',
      driveFileId: driveFileId || '',
      firestoreDocId: firestoreDocId || '',
    }),
  });

  const initData = await parseApiJson<ResumableInitResponse>(initRes);

  if (initData.status === 'complete' && initData.file) {
    if (onProgress) onProgress(100);
    return normalizeUploadedFileResult(initData.file, {
      id: driveFileId,
      name: fileName,
      mimeType: resolvedMime,
      sizeBytes: totalSize,
    });
  }

  const sessionId = typeof initData.sessionId === 'string' ? initData.sessionId.trim() : '';
  const chunkSize =
    typeof initData.chunkSize === 'number' && initData.chunkSize >= 256 * 1024
      ? initData.chunkSize
      : 8 * 1024 * 1024;

  if (!sessionId) {
    throw new Error('Company Drive did not initialize an upload session. Please try again.');
  }

  let offset = 0;
  let completedFile: Partial<DriveUploadedFileResult> | undefined;

  try {
    while (offset < totalSize) {
      const endExclusive = Math.min(offset + chunkSize, totalSize);
      const endInclusive = endExclusive - 1;
      const chunkBlob = blob.slice(offset, endExclusive);

      let chunkResult: ResumableChunkResponse | null = null;
      let lastErr: unknown = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Refreshes Firebase ID token automatically during long multi-GB uploads
          const chunkToken = await getFirebaseIdToken();
          chunkResult = await sendSingleUploadChunk({
            sessionId,
            idToken: chunkToken,
            chunk: chunkBlob,
            start: offset,
            end: endInclusive,
            totalSize,
            onChunkProgress: (loadedInChunk) => {
              if (onProgress && totalSize > 0) {
                const overallPct = Math.min(
                  99,
                  Math.round(((offset + loadedInChunk) / totalSize) * 99)
                );
                onProgress(overallPct);
              }
            },
          });
          break;
        } catch (err: unknown) {
          lastErr = err;
          if (err instanceof DriveConnectionRequiredError) throw err;
          const status = (err as { status?: number })?.status;
          const retryable =
            Boolean((err as { retryable?: boolean })?.retryable) ||
            (typeof status === 'number' && status >= 500);
          if (!retryable || attempt === 2) {
            throw err;
          }
          await new Promise((r) => window.setTimeout(r, 800 * (attempt + 1)));
        }
      }

      if (!chunkResult) {
        throw lastErr instanceof Error ? lastErr : new Error('Chunk upload failed.');
      }

      if (chunkResult.status === 'complete') {
        completedFile = chunkResult.file;
        offset = totalSize;
        break;
      }

      offset = endExclusive;
      if (onProgress && totalSize > 0) {
        onProgress(Math.min(99, Math.round((offset / totalSize) * 99)));
      }
    }
  } catch (err) {
    // Best-effort cleanup of abandoned server session
    getFirebaseIdToken()
      .then((tok) =>
        fetch(`/api/drive/upload/session/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Authorization: `Bearer ${tok}` },
        })
      )
      .catch(() => {});
    throw err;
  }

  if (onProgress) onProgress(100);
  return normalizeUploadedFileResult(completedFile, {
    id: driveFileId,
    name: fileName,
    mimeType: resolvedMime,
    sizeBytes: totalSize,
  });
}

/**
 * Uploads any browser File (NO size limit, chunked resumable up to full 5 TB Company Drive storage)
 * directly to the shared Company Google Drive via the authenticated server proxy.
 */
export async function uploadFileToCompanyDrive(params: {
  file: File;
  parentDriveFolderId?: string;
  description?: string;
  onProgress?: (percent: number) => void;
}): Promise<DriveUploadedFileResult> {
  const { file, parentDriveFolderId, description, onProgress } = params;
  return runChunkedResumableUpload({
    mode: 'create',
    blob: file,
    fileName: file.name || 'uploaded-file',
    mimeType: file.type || inferMimeTypeFromFileName(file.name || ''),
    parentDriveFolderId,
    description,
    onProgress,
  });
}

/**
 * Renames and/or moves a file or folder in the shared Company Google Drive.
 * Call ONLY after explicit user confirmation.
 */
export async function renameCompanyDriveItem(params: {
  driveFileId: string;
  newName: string;
  itemKind: 'file' | 'folder';
  firestoreDocId: string;
  newParentDriveFolderId?: string;
}): Promise<void> {
  const idToken = await getFirebaseIdToken();
  const res = await fetch(`/api/drive/items/${encodeURIComponent(params.driveFileId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      newName: params.newName.trim().slice(0, 200),
      itemKind: params.itemKind,
      firestoreDocId: params.firestoreDocId,
      newParentDriveFolderId: params.newParentDriveFolderId || '',
    }),
  });
  await parseApiJson(res);
}

/**
 * Fetches file bytes directly from the shared Company Google Drive via the server proxy
 * so files can be previewed or downloaded 100% inside the app without opening Google Drive.
 */
export async function fetchCompanyDriveFileBlob(params: {
  driveFileId: string;
  firestoreDocId: string;
  download?: boolean;
}): Promise<{ blob: Blob; contentType: string }> {
  const idToken = await getFirebaseIdToken();
  const qs = new URLSearchParams({
    docId: params.firestoreDocId,
    ...(params.download ? { download: '1' } : {}),
  });
  const res = await fetch(
    `/api/drive/items/${encodeURIComponent(params.driveFileId)}/content?${qs.toString()}`,
    {
      credentials: 'include',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${idToken}` },
    }
  );
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // ignore
    }
    const msg =
      typeof body.error === 'string'
        ? body.error
        : `Could not load file from Company Drive (${res.status})`;
    if (res.status === 503 || body.code === 'DRIVE_NOT_CONNECTED') {
      throw new DriveConnectionRequiredError(msg);
    }
    throw new Error(msg);
  }
  const contentType = (res.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0]
    .trim();
  const blob = await res.blob();
  return { blob, contentType };
}

/**
 * Downloads a file directly inside the browser from Company Google Drive without
 * redirecting to Google Drive or opening any new window/tab.
 */
export async function downloadCompanyDriveFile(params: {
  driveFileId: string;
  firestoreDocId: string;
  fileName: string;
}): Promise<void> {
  const { blob } = await fetchCompanyDriveFileBlob({
    driveFileId: params.driveFileId,
    firestoreDocId: params.firestoreDocId,
    download: true,
  });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = params.fileName || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
  }
}

/**
 * Replaces / modifies a file's content in-place in the shared Company Google Drive
 * using chunked resumable upload (NO size limit).
 * Call ONLY after explicit user confirmation.
 */
export async function replaceCompanyDriveFileContent(params: {
  driveFileId: string;
  firestoreDocId: string;
  content: Blob | File;
  mimeType: string;
  fileName?: string;
  onProgress?: (percent: number) => void;
}): Promise<{ id: string; name: string; mimeType: string; sizeBytes: number }> {
  const { driveFileId, firestoreDocId, content, mimeType, fileName, onProgress } = params;
  const resolvedName =
    fileName || (content instanceof File ? content.name : '') || 'updated-file';
  const result = await runChunkedResumableUpload({
    mode: 'replace',
    blob: content,
    fileName: resolvedName,
    mimeType: mimeType || content.type || inferMimeTypeFromFileName(resolvedName),
    driveFileId,
    firestoreDocId,
    onProgress,
  });
  return {
    id: result.id,
    name: result.name,
    mimeType: result.mimeType,
    sizeBytes: result.sizeBytes,
  };
}

/**
 * Deletes a file or folder from the shared Company Google Drive.
 * Call ONLY after explicit user confirmation.
 */
export async function deleteCompanyDriveItem(params: {
  driveFileId: string;
  itemKind: 'file' | 'folder';
  firestoreDocId: string;
}): Promise<void> {
  if (!params.driveFileId) return;
  const idToken = await getFirebaseIdToken();
  const res = await fetch(`/api/drive/items/${encodeURIComponent(params.driveFileId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      itemKind: params.itemKind,
      firestoreDocId: params.firestoreDocId,
    }),
  });
  await parseApiJson(res);
}

export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}

export function inferMimeTypeFromFileName(fileName: string, fallbackMime?: string): string {
  const cleanFallback = (fallbackMime || '').split(';')[0].trim().toLowerCase();
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';

  const extMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    jfif: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/plain',
    log: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
  };

  if (cleanFallback && cleanFallback !== 'application/octet-stream') {
    return cleanFallback;
  }
  return extMap[ext] || 'application/octet-stream';
}

export type InAppPreviewKind =
  | 'image'
  | 'pdf'
  | 'spreadsheet'
  | 'text'
  | 'video'
  | 'audio'
  | 'binary';

export function getInAppPreviewKind(mimeType: string, fileName: string): InAppPreviewKind {
  const mt = (mimeType || '').toLowerCase();
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';

  if (
    mt.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'svg'].includes(ext)
  ) {
    return 'image';
  }
  if (mt.includes('pdf') || ext === 'pdf') {
    return 'pdf';
  }
  if (
    mt.includes('spreadsheet') ||
    mt.includes('excel') ||
    ['xlsx', 'xlsm', 'xlsb', 'xls'].includes(ext)
  ) {
    return 'spreadsheet';
  }
  if (mt.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v'].includes(ext)) {
    return 'video';
  }
  if (mt.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
    return 'audio';
  }
  if (
    mt.startsWith('text/') ||
    mt.includes('json') ||
    mt.includes('xml') ||
    mt.includes('csv') ||
    ['txt', 'csv', 'json', 'md', 'log', 'xml', 'yml', 'yaml', 'ini', 'sql'].includes(ext)
  ) {
    return 'text';
  }
  return 'binary';
}

export function getFileKindLabel(mimeType: string, fileName: string): {
  label: string;
  tone: 'blue' | 'org' | 'red' | 'mut';
} {
  const mt = (mimeType || '').toLowerCase();
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';

  if (mt.includes('pdf') || ext === 'pdf') return { label: 'PDF', tone: 'red' };
  if (
    mt.includes('spreadsheet') ||
    mt.includes('excel') ||
    ['xlsx', 'xlsm', 'xlsb', 'xls', 'csv'].includes(ext)
  ) {
    return { label: ext === 'csv' ? 'CSV' : ext === 'xlsm' ? 'XLSM' : 'XLSX', tone: 'blue' };
  }
  if (mt.includes('word') || mt.includes('document') || ['doc', 'docx'].includes(ext)) {
    return { label: 'DOC', tone: 'blue' };
  }
  if (mt.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
    return { label: 'PPT', tone: 'org' };
  }
  if (
    mt.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'svg'].includes(ext)
  ) {
    return { label: 'IMG', tone: 'org' };
  }
  if (mt.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) {
    return { label: 'VID', tone: 'blue' };
  }
  if (mt.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
    return { label: 'AUD', tone: 'org' };
  }
  if (mt.includes('zip') || mt.includes('compressed') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { label: 'ZIP', tone: 'mut' };
  }
  return { label: (ext || 'FILE').toUpperCase().slice(0, 5), tone: 'mut' };
}
