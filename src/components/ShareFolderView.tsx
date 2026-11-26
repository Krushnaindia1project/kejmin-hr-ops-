import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { connectGoogleDrive } from '../firebase';
import {
  CompanyDriveStatus,
  connectCompanyDriveOnServer,
  createCompanyDriveFolder,
  deleteCompanyDriveItem,
  disconnectCompanyDriveOnServer,
  downloadCompanyDriveFile,
  DriveConnectionRequiredError,
  fetchCompanyDriveFileBlob,
  fetchCompanyDriveStatus,
  formatFileSize,
  getFileKindLabel,
  getInAppPreviewKind,
  InAppPreviewKind,
  inferMimeTypeFromFileName,
  renameCompanyDriveItem,
  replaceCompanyDriveFileContent,
  uploadFileToCompanyDrive,
} from '../services/driveService';
import {
  DirectoryEntry,
  isDeveloperRole,
  ShareAccessScope,
  SHARED_FILE_CATEGORIES,
  SharedFileDoc,
  SharedFolderDoc,
} from '../types';

interface ShareFolderViewProps {
  me: DirectoryEntry;
  firebaseUid: string;
  isAdmin: boolean;
  directory: DirectoryEntry[];
  branches: string[];
  locations: string[];
  sharedFolders: SharedFolderDoc[];
  sharedFiles: SharedFileDoc[];
  onCreateFolderRecord: (params: {
    name: string;
    parentId: string;
    driveFolderId: string;
    driveUrl: string;
    branch: string;
    location: string;
    accessScope: ShareAccessScope;
    allowedEmpIds: string[];
    description: string;
  }) => Promise<string>;
  onUpdateFolderRecord: (params: {
    folder: SharedFolderDoc;
    name: string;
    parentId?: string;
    branch: string;
    location: string;
    accessScope: ShareAccessScope;
    allowedEmpIds: string[];
    description: string;
  }) => Promise<void>;
  onDeleteFolderRecord: (folder: SharedFolderDoc) => Promise<void>;
  onCreateFileRecord: (params: {
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
  }) => Promise<string>;
  onUpdateFileRecord: (params: {
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
  }) => Promise<void>;
  onDeleteFileRecord: (file: SharedFileDoc, removedFromDrive: boolean) => Promise<void>;
  onToast: (msg: string) => void;
}

const ACCESS_LABELS: Record<ShareAccessScope, string> = {
  all: 'All team',
  branch: 'Branch only',
  location: 'Location only',
  selected: 'Selected staff',
};

const EMPTY_STATUS: CompanyDriveStatus = {
  connected: false,
  mode: 'none',
  permanent: false,
  connectedBy: null,
  accountLabel: null,
  connectedAt: null,
  expiresAt: null,
  rootFolderId: null,
  rootFolderUrl: null,
};

interface ParsedSheetPreview {
  name: string;
  rows: string[][];
  totalRows: number;
}

function formatDateFromTs(ts?: { toDate: () => Date }): string {
  if (!ts) return 'Just now';
  try {
    const d = ts.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  } catch {
    return '-';
  }
}

export const ShareFolderView: React.FC<ShareFolderViewProps> = ({
  me,
  firebaseUid,
  isAdmin,
  directory,
  branches,
  locations,
  sharedFolders,
  sharedFiles,
  onCreateFolderRecord,
  onUpdateFolderRecord,
  onDeleteFolderRecord,
  onCreateFileRecord,
  onUpdateFileRecord,
  onDeleteFileRecord,
  onToast,
}) => {
  const isDeveloper = isDeveloperRole(me.role);

  // Shared Company Google Drive connection status (managed on the server for all users)
  const [driveStatus, setDriveStatus] = useState<CompanyDriveStatus>(EMPTY_STATUS);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);

  const refreshDriveStatus = useCallback(async () => {
    try {
      const status = await fetchCompanyDriveStatus();
      setDriveStatus(status);
    } catch {
      // keep previous status if offline temporarily
    }
  }, []);

  useEffect(() => {
    void refreshDriveStatus();
    const handleDriveStatusUpdated = () => {
      void refreshDriveStatus();
    };
    window.addEventListener('kejmin-drive-status-updated', handleDriveStatusUpdated);
    const interval = window.setInterval(() => {
      void refreshDriveStatus();
    }, 60_000);
    return () => {
      window.removeEventListener('kejmin-drive-status-updated', handleDriveStatusUpdated);
      window.clearInterval(interval);
    };
  }, [refreshDriveStatus]);

  // Navigation & filter state
  const [currentFolderId, setCurrentFolderId] = useState<string>('');
  const canUploadHere = isDeveloper || Boolean(currentFolderId);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [branchFilter, setBranchFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');
  const [accessFilter, setAccessFilter] = useState<'all' | 'mine' | 'public' | 'restricted'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'name' | 'size'>('newest');

  // In-app File Viewer & Text Editor modal state (never leaves app or opens Google Drive)
  const [viewerFile, setViewerFile] = useState<SharedFileDoc | null>(null);
  const [viewerKind, setViewerKind] = useState<InAppPreviewKind>('binary');
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerPreviewUrl, setViewerPreviewUrl] = useState<string | null>(null);
  const [viewerText, setViewerText] = useState<string>('');
  const [viewerEditingText, setViewerEditingText] = useState(false);
  const [viewerDraftText, setViewerDraftText] = useState<string>('');
  const [viewerConfirmSaveText, setViewerConfirmSaveText] = useState(false);
  const [viewerSavingText, setViewerSavingText] = useState(false);
  const [viewerSheets, setViewerSheets] = useState<ParsedSheetPreview[]>([]);
  const [viewerSheetIdx, setViewerSheetIdx] = useState(0);
  const viewerObjectUrlRef = useRef<string | null>(null);
  const viewerReqIdRef = useRef<number>(0);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [upFolderId, setUpFolderId] = useState('');
  const [upCategory, setUpCategory] = useState<string>('General');
  const [upBranch, setUpBranch] = useState<string>(me.branch === 'All' ? 'All' : me.branch);
  const [upLocation, setUpLocation] = useState<string>(me.location === 'All' ? 'All' : me.location);
  const [upScope, setUpScope] = useState<ShareAccessScope>('all');
  const [upAllowedEmpIds, setUpAllowedEmpIds] = useState<string[]>([]);
  const [upAllowDownload, setUpAllowDownload] = useState(true);
  const [upDescription, setUpDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    index: number;
    total: number;
    fileName: string;
    percent: number;
  } | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Create / Edit folder modal state
  const [folderModalMode, setFolderModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingFolder, setEditingFolder] = useState<SharedFolderDoc | null>(null);
  const [fldName, setFldName] = useState('');
  const [fldParentId, setFldParentId] = useState('');
  const [fldBranch, setFldBranch] = useState('All');
  const [fldLocation, setFldLocation] = useState('All');
  const [fldScope, setFldScope] = useState<ShareAccessScope>('all');
  const [fldAllowedEmpIds, setFldAllowedEmpIds] = useState<string[]>([]);
  const [fldDescription, setFldDescription] = useState('');
  const [fldBusy, setFldBusy] = useState(false);
  const [fldErr, setFldErr] = useState<string | null>(null);

  // Edit / Modify file modal state (rename, move folder, replace content, update access)
  const [editingFile, setEditingFile] = useState<SharedFileDoc | null>(null);
  const [efName, setEfName] = useState('');
  const [efFolderId, setEfFolderId] = useState('');
  const [efCategory, setEfCategory] = useState('General');
  const [efBranch, setEfBranch] = useState('All');
  const [efLocation, setEfLocation] = useState('All');
  const [efScope, setEfScope] = useState<ShareAccessScope>('all');
  const [efAllowedEmpIds, setEfAllowedEmpIds] = useState<string[]>([]);
  const [efAllowDownload, setEfAllowDownload] = useState(true);
  const [efDescription, setEfDescription] = useState('');
  const [efReplaceFile, setEfReplaceFile] = useState<File | null>(null);
  const [efReplacePct, setEfReplacePct] = useState<number | null>(null);
  const [efBusy, setEfBusy] = useState(false);
  const [efErr, setEfErr] = useState<string | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Mandatory explicit delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'file'; file: SharedFileDoc }
    | { kind: 'folder'; folder: SharedFolderDoc }
    | null
  >(null);
  const [deleteAlsoFromDrive, setDeleteAlsoFromDrive] = useState(true);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // Disconnect confirmation modal for Admin
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Clean up any active object URL only on unmount (avoids premature revocation during renders)
  useEffect(() => {
    return () => {
      if (viewerObjectUrlRef.current) {
        URL.revokeObjectURL(viewerObjectUrlRef.current);
        viewerObjectUrlRef.current = null;
      }
    };
  }, []);

  const activeEmployees = useMemo(
    () =>
      directory
        .filter((d) => d.active)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [directory]
  );

  // Visibility & management permission helpers
  const canViewFolder = (f: SharedFolderDoc): boolean => {
    if (isAdmin) return true;
    if (f.createdByEmpId === me.empId || f.createdByUid === firebaseUid) return true;
    if (f.accessScope === 'all') return true;
    if (f.accessScope === 'branch') {
      return f.branch === 'All' || me.branch === 'All' || f.branch === me.branch;
    }
    if (f.accessScope === 'location') {
      return f.location === 'All' || me.location === 'All' || f.location === me.location;
    }
    if (f.accessScope === 'selected') {
      return (f.allowedEmpIds || []).includes(me.empId);
    }
    return false;
  };

  const canViewFile = (f: SharedFileDoc): boolean => {
    if (isAdmin) return true;
    if (f.uploadedByEmpId === me.empId || f.uploadedByUid === firebaseUid) return true;
    if (f.accessScope === 'all') return true;
    if (f.accessScope === 'branch') {
      return f.branch === 'All' || me.branch === 'All' || f.branch === me.branch;
    }
    if (f.accessScope === 'location') {
      return f.location === 'All' || me.location === 'All' || f.location === me.location;
    }
    if (f.accessScope === 'selected') {
      return (f.allowedEmpIds || []).includes(me.empId);
    }
    return false;
  };

  const canManageFolder = (f: SharedFolderDoc): boolean =>
    isAdmin || f.createdByUid === firebaseUid || f.createdByEmpId === me.empId;

  const canManageFile = (f: SharedFileDoc): boolean =>
    isAdmin || f.uploadedByUid === firebaseUid || f.uploadedByEmpId === me.empId;

  const visibleFolders = useMemo(
    () => sharedFolders.filter(canViewFolder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sharedFolders, isAdmin, me.empId, me.branch, me.location, firebaseUid]
  );

  const visibleFiles = useMemo(
    () => sharedFiles.filter(canViewFile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sharedFiles, isAdmin, me.empId, me.branch, me.location, firebaseUid]
  );

  const folderMap = useMemo(() => {
    const map = new Map<string, SharedFolderDoc>();
    visibleFolders.forEach((f) => map.set(f.folderId, f));
    return map;
  }, [visibleFolders]);

  // Build readable path string for any folder ID (e.g. "Company Drive / MIS / 2026")
  const getFolderPathLabel = useCallback(
    (folderId: string): string => {
      if (!folderId) return 'Company Drive';
      const names: string[] = [];
      let cursor = folderId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const fld = folderMap.get(cursor);
        if (!fld) break;
        names.unshift(fld.name);
        cursor = fld.parentId;
      }
      return names.length ? `Company Drive / ${names.join(' / ')}` : 'Company Drive';
    },
    [folderMap]
  );

  // Helper to prevent moving a folder into itself or one of its own subfolders
  const getDescendantFolderIds = useCallback(
    (rootId: string): Set<string> => {
      const blocked = new Set<string>([rootId]);
      let changed = true;
      while (changed) {
        changed = false;
        visibleFolders.forEach((f) => {
          if (f.parentId && blocked.has(f.parentId) && !blocked.has(f.folderId)) {
            blocked.add(f.folderId);
            changed = true;
          }
        });
      }
      return blocked;
    },
    [visibleFolders]
  );

  // Breadcrumb path from root to currentFolderId
  const breadcrumbs = useMemo(() => {
    const chain: SharedFolderDoc[] = [];
    let cursor = currentFolderId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const fld = folderMap.get(cursor);
      if (!fld) break;
      chain.unshift(fld);
      cursor = fld.parentId;
    }
    return chain;
  }, [currentFolderId, folderMap]);

  const currentFolder = currentFolderId ? folderMap.get(currentFolderId) || null : null;

  const displayedFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return visibleFolders
      .filter((f) => {
        if (!q && f.parentId !== currentFolderId) return false;
        if (q && !f.name.toLowerCase().includes(q) && !f.description.toLowerCase().includes(q)) {
          return false;
        }
        if (branchFilter !== 'All' && f.branch !== 'All' && f.branch !== branchFilter) return false;
        if (locationFilter !== 'All' && f.location !== 'All' && f.location !== locationFilter) {
          return false;
        }
        if (accessFilter === 'mine' && f.createdByEmpId !== me.empId) return false;
        if (accessFilter === 'public' && f.accessScope !== 'all') return false;
        if (accessFilter === 'restricted' && f.accessScope === 'all') return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    visibleFolders,
    currentFolderId,
    searchQuery,
    branchFilter,
    locationFilter,
    accessFilter,
    me.empId,
  ]);

  const hasGlobalFilter = Boolean(
    searchQuery.trim() ||
      categoryFilter !== 'All' ||
      branchFilter !== 'All' ||
      locationFilter !== 'All' ||
      accessFilter !== 'all'
  );

  const displayedFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = visibleFiles.filter((f) => {
      if (!hasGlobalFilter && f.folderId !== currentFolderId) return false;
      if (hasGlobalFilter && currentFolderId && f.folderId !== currentFolderId && !q) return false;
      if (
        q &&
        !f.name.toLowerCase().includes(q) &&
        !f.uploadedBy.toLowerCase().includes(q) &&
        !f.category.toLowerCase().includes(q) &&
        !f.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (categoryFilter !== 'All' && f.category !== categoryFilter) return false;
      if (branchFilter !== 'All' && f.branch !== 'All' && f.branch !== branchFilter) return false;
      if (locationFilter !== 'All' && f.location !== 'All' && f.location !== locationFilter) {
        return false;
      }
      if (accessFilter === 'mine' && f.uploadedByEmpId !== me.empId) return false;
      if (accessFilter === 'public' && f.accessScope !== 'all') return false;
      if (accessFilter === 'restricted' && f.accessScope === 'all') return false;
      return true;
    });

    return list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return (b.sizeBytes || 0) - (a.sizeBytes || 0);
      return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
    });
  }, [
    visibleFiles,
    hasGlobalFilter,
    currentFolderId,
    searchQuery,
    categoryFilter,
    branchFilter,
    locationFilter,
    accessFilter,
    sortBy,
    me.empId,
  ]);

  const totalStorageBytes = useMemo(
    () => visibleFiles.reduce((sum, f) => sum + (f.sizeBytes || 0), 0),
    [visibleFiles]
  );
  const myUploadsCount = useMemo(
    () => visibleFiles.filter((f) => f.uploadedByEmpId === me.empId).length,
    [visibleFiles, me.empId]
  );

  // Developer connects the SINGLE shared Company Google Drive for the entire organization
  const handleConnectCompanyDrive = async (): Promise<boolean> => {
    setConnectingDrive(true);
    setDriveError(null);
    try {
      const { accessToken } = await connectGoogleDrive(driveStatus.hintEmail);
      const updatedStatus = await connectCompanyDriveOnServer(accessToken, me.name);
      setDriveStatus(updatedStatus);
      window.dispatchEvent(new Event('kejmin-drive-status-updated'));
      onToast('Company Google Drive connected for all team members');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('popup-closed-by-user') || msg.includes('cancelled-popup-request')) {
        setDriveError('Google sign-in popup was closed before connecting Company Drive.');
      } else {
        setDriveError(msg || 'Could not connect Company Google Drive.');
      }
      return false;
    } finally {
      setConnectingDrive(false);
    }
  };

  const handleDisconnectCompanyDrive = async () => {
    setConnectingDrive(true);
    setDriveError(null);
    try {
      const updated = await disconnectCompanyDriveOnServer();
      setDriveStatus(updated);
      window.dispatchEvent(new Event('kejmin-drive-status-updated'));
      setShowDisconnectConfirm(false);
      onToast('Company Google Drive disconnected');
    } catch (err: unknown) {
      setDriveError(err instanceof Error ? err.message : 'Could not disconnect Company Drive.');
    } finally {
      setConnectingDrive(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('All');
    setBranchFilter('All');
    setLocationFilter('All');
    setAccessFilter('all');
  };

  // Navigate to Company Drive root inside the app (NEVER opens external Google Drive)
  const handleNavigateCompanyDriveRoot = () => {
    setCurrentFolderId('');
    clearFilters();
    void refreshDriveStatus();
    onToast('Navigated to Company Drive root inside Share Folder');
  };

  // ===== IN-APP FILE VIEWER & INLINE EDITOR =====
  const revokeViewerObjectUrl = useCallback(() => {
    if (viewerObjectUrlRef.current) {
      URL.revokeObjectURL(viewerObjectUrlRef.current);
      viewerObjectUrlRef.current = null;
    }
  }, []);

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Could not convert file preview data.'));
        }
      };
      reader.onerror = () => reject(new Error('Could not read preview data.'));
      reader.readAsDataURL(blob);
    });

  const closeFileViewer = () => {
    viewerReqIdRef.current += 1;
    revokeViewerObjectUrl();
    setViewerFile(null);
    setViewerPreviewUrl(null);
    setViewerText('');
    setViewerDraftText('');
    setViewerEditingText(false);
    setViewerConfirmSaveText(false);
    setViewerSheets([]);
    setViewerSheetIdx(0);
    setViewerError(null);
    setViewerLoading(false);
  };

  const loadFileIntoViewer = async (file: SharedFileDoc) => {
    const reqId = ++viewerReqIdRef.current;
    revokeViewerObjectUrl();
    setViewerPreviewUrl(null);

    const kind = getInAppPreviewKind(file.mimeType, file.name);
    setViewerFile(file);
    setViewerKind(kind);
    setViewerLoading(true);
    setViewerError(null);
    setViewerText('');
    setViewerDraftText('');
    setViewerEditingText(false);
    setViewerConfirmSaveText(false);
    setViewerSheets([]);
    setViewerSheetIdx(0);

    if (kind === 'binary') {
      setViewerLoading(false);
      return;
    }

    // Protect browser memory on extremely large files stored on 5 TB Drive
    if (kind === 'spreadsheet' && file.sizeBytes > 40 * 1024 * 1024) {
      setViewerKind('binary');
      setViewerLoading(false);
      return;
    }
    if (kind === 'text' && file.sizeBytes > 15 * 1024 * 1024) {
      setViewerKind('binary');
      setViewerLoading(false);
      return;
    }
    if ((kind === 'video' || kind === 'audio') && file.sizeBytes > 150 * 1024 * 1024) {
      setViewerKind('binary');
      setViewerLoading(false);
      return;
    }

    try {
      const { blob, contentType } = await fetchCompanyDriveFileBlob({
        driveFileId: file.driveFileId,
        firestoreDocId: file.fileId,
        download: false,
      });

      if (viewerReqIdRef.current !== reqId) return;

      if (!blob || blob.size === 0) {
        setViewerError('This file is empty (0 bytes) in Company Drive.');
        return;
      }

      const resolvedMime = inferMimeTypeFromFileName(file.name, contentType || file.mimeType);
      const resolvedKind = getInAppPreviewKind(resolvedMime, file.name);
      setViewerKind(resolvedKind);

      // Guard against non-binary HTML/JSON error pages accidentally returned for media/documents
      if (resolvedKind !== 'text') {
        const headText = (await blob.slice(0, 64).text()).trim().toLowerCase();
        if (headText.startsWith('<!doctype html') || headText.startsWith('<html')) {
          setViewerError(
            'Could not load file bytes from Company Drive (received an HTML page). Please reconnect Company Drive and retry.'
          );
          return;
        }
        if (headText.startsWith('{"error"')) {
          try {
            const parsedErr = JSON.parse(await blob.text()) as { error?: string };
            setViewerError(parsedErr.error || 'Could not load file preview from Company Drive.');
          } catch {
            setViewerError('Could not load file preview from Company Drive.');
          }
          return;
        }
      }

      if (resolvedKind === 'image') {
        const imgMime = resolvedMime.startsWith('image/')
          ? resolvedMime
          : inferMimeTypeFromFileName(file.name, 'image/jpeg');
        const typedBlob = new Blob([blob], { type: imgMime });
        // Use Data URL for images <= 20 MB so rendering is 100% immune to blob URL / iframe quirks
        if (typedBlob.size <= 20 * 1024 * 1024) {
          const dataUrl = await blobToDataUrl(typedBlob);
          if (viewerReqIdRef.current !== reqId) return;
          setViewerPreviewUrl(dataUrl);
        } else {
          const objUrl = URL.createObjectURL(typedBlob);
          viewerObjectUrlRef.current = objUrl;
          setViewerPreviewUrl(objUrl);
        }
      } else if (resolvedKind === 'pdf') {
        const typedBlob = new Blob([blob], { type: 'application/pdf' });
        const objUrl = URL.createObjectURL(typedBlob);
        viewerObjectUrlRef.current = objUrl;
        setViewerPreviewUrl(objUrl);
      } else if (resolvedKind === 'video' || resolvedKind === 'audio') {
        const typedBlob = new Blob([blob], { type: resolvedMime });
        const objUrl = URL.createObjectURL(typedBlob);
        viewerObjectUrlRef.current = objUrl;
        setViewerPreviewUrl(objUrl);
      } else if (resolvedKind === 'spreadsheet') {
        const arrayBuf = await blob.arrayBuffer();
        if (viewerReqIdRef.current !== reqId) return;
        const wb = XLSX.read(arrayBuf, { type: 'array' });
        const sheets: ParsedSheetPreview[] = wb.SheetNames.map((sheetName) => {
          const ws = wb.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            defval: '',
          });
          const totalRows = rawRows.length;
          const rows = rawRows
            .slice(0, 500)
            .map((r) => (Array.isArray(r) ? r.map((cell) => String(cell ?? '')) : []));
          return { name: sheetName, rows, totalRows };
        });
        setViewerSheets(sheets);
        setViewerSheetIdx(0);
      } else if (resolvedKind === 'text') {
        const txt = await blob.text();
        if (viewerReqIdRef.current !== reqId) return;
        setViewerText(txt);
        setViewerDraftText(txt);
      }
    } catch (err: unknown) {
      if (viewerReqIdRef.current !== reqId) return;
      if (err instanceof DriveConnectionRequiredError) {
        void refreshDriveStatus();
      }
      setViewerError(
        err instanceof Error ? err.message : 'Could not load file preview from Company Drive.'
      );
    } finally {
      if (viewerReqIdRef.current === reqId) {
        setViewerLoading(false);
      }
    }
  };

  // In-app silent download (NEVER redirects or opens a new window)
  const handleInAppDownload = async (file: SharedFileDoc) => {
    setDownloadingFileId(file.fileId);
    try {
      await downloadCompanyDriveFile({
        driveFileId: file.driveFileId,
        firestoreDocId: file.fileId,
        fileName: file.name,
      });
      onToast(`Downloaded "${file.name}"`);
    } catch (err: unknown) {
      if (err instanceof DriveConnectionRequiredError) {
        void refreshDriveStatus();
      }
      onToast(err instanceof Error ? err.message : 'Could not download file.');
    } finally {
      setDownloadingFileId(null);
    }
  };

  // Save edited text directly back to Company Drive (called ONLY after explicit confirmation)
  const handleConfirmSaveInlineText = async () => {
    if (!viewerFile) return;
    setViewerSavingText(true);
    setViewerError(null);
    try {
      const mime = viewerFile.mimeType?.startsWith('text/')
        ? viewerFile.mimeType
        : 'text/plain';
      const updatedBlob = new Blob([viewerDraftText], { type: mime });
      const res = await replaceCompanyDriveFileContent({
        driveFileId: viewerFile.driveFileId,
        firestoreDocId: viewerFile.fileId,
        content: updatedBlob,
        mimeType: mime,
      });

      await onUpdateFileRecord({
        file: viewerFile,
        name: viewerFile.name,
        folderId: viewerFile.folderId,
        branch: viewerFile.branch,
        location: viewerFile.location,
        category: viewerFile.category,
        description: viewerFile.description,
        accessScope: viewerFile.accessScope,
        allowedEmpIds: viewerFile.allowedEmpIds || [],
        allowDownload: viewerFile.allowDownload !== false,
        sizeBytes: res.sizeBytes,
        mimeType: res.mimeType || mime,
      });

      setViewerText(viewerDraftText);
      setViewerEditingText(false);
      setViewerConfirmSaveText(false);
      setViewerFile({
        ...viewerFile,
        sizeBytes: res.sizeBytes,
        mimeType: res.mimeType || mime,
      });
      onToast(`Saved changes to "${viewerFile.name}" in Company Drive`);
    } catch (err: unknown) {
      if (err instanceof DriveConnectionRequiredError) {
        void refreshDriveStatus();
      }
      setViewerError(err instanceof Error ? err.message : 'Could not save modified file.');
      setViewerConfirmSaveText(false);
    } finally {
      setViewerSavingText(false);
    }
  };

  // ===== UPLOAD MODAL HANDLERS =====
  const openUploadModal = (prefillFiles?: File[]) => {
    if (!isDeveloper && !currentFolderId) {
      onToast('Please open a folder inside Company Drive to upload files.');
      return;
    }
    setQueuedFiles(prefillFiles || []);
    setUpFolderId(currentFolderId);
    setUpCategory('General');
    setUpBranch(me.branch === 'All' ? 'All' : me.branch);
    setUpLocation(me.location === 'All' ? 'All' : me.location);
    setUpScope('all');
    setUpAllowedEmpIds([]);
    setUpAllowDownload(true);
    setUpDescription('');
    setUploadErr(null);
    setUploadProgress(null);
    setShowUploadModal(true);
  };

  const handleAddFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) => f.size >= 0);
    if (!incoming.length) return;
    setQueuedFiles((prev) => {
      const existingKeys = new Set(prev.map((p) => `${p.name}_${p.size}_${p.lastModified}`));
      const next = [...prev];
      incoming.forEach((f) => {
        const k = `${f.name}_${f.size}_${f.lastModified}`;
        if (!existingKeys.has(k)) next.push(f);
      });
      return next;
    });
    setUploadErr(null);
  };

  const handleStartUpload = async () => {
    if (!queuedFiles.length) {
      setUploadErr('Please select at least one file to upload.');
      return;
    }
    if (!isDeveloper && !upFolderId) {
      setUploadErr(
        'Files must be uploaded inside a folder. Only Developers can upload directly to Company Drive root.'
      );
      return;
    }
    if (upScope === 'selected' && upAllowedEmpIds.length === 0) {
      setUploadErr('Select at least one employee who should have access.');
      return;
    }

    if (!driveStatus.connected) {
      if (isDeveloper) {
        const ok = await handleConnectCompanyDrive();
        if (!ok) {
          setUploadErr('Connect Company Google Drive first to upload files.');
          return;
        }
      } else {
        setUploadErr(
          'Company Drive is currently unavailable. Please contact the Developer to reconnect.'
        );
        return;
      }
    }

    setUploading(true);
    setUploadErr(null);

    try {
      const targetFolder = upFolderId ? folderMap.get(upFolderId) : null;
      let parentDriveId = targetFolder?.driveFolderId || driveStatus.rootFolderId || undefined;
      if (targetFolder && !targetFolder.driveFolderId) {
        const parentOfTarget = targetFolder.parentId ? folderMap.get(targetFolder.parentId) : null;
        const createdSubfolder = await createCompanyDriveFolder(
          targetFolder.name,
          parentOfTarget?.driveFolderId || driveStatus.rootFolderId || undefined
        );
        parentDriveId = createdSubfolder.id;
      }

      let uploadedCount = 0;

      for (let i = 0; i < queuedFiles.length; i++) {
        const file = queuedFiles[i];
        setUploadProgress({
          index: i + 1,
          total: queuedFiles.length,
          fileName: file.name,
          percent: 5,
        });

        const driveRes = await uploadFileToCompanyDrive({
          file,
          parentDriveFolderId: parentDriveId,
          description: upDescription,
          onProgress: (percent) => {
            setUploadProgress({
              index: i + 1,
              total: queuedFiles.length,
              fileName: file.name,
              percent,
            });
          },
        });

        await onCreateFileRecord({
          folderId: upFolderId,
          name: driveRes.name,
          mimeType: driveRes.mimeType,
          sizeBytes: driveRes.sizeBytes,
          driveFileId: driveRes.id,
          webViewLink: driveRes.webViewLink,
          webContentLink: driveRes.webContentLink,
          branch: upScope === 'branch' ? upBranch : upBranch || 'All',
          location: upScope === 'location' ? upLocation : upLocation || 'All',
          category: upCategory,
          description: upDescription,
          accessScope: upScope,
          allowedEmpIds: upScope === 'selected' ? upAllowedEmpIds : [],
          allowDownload: upAllowDownload,
        });

        uploadedCount++;
      }

      setShowUploadModal(false);
      setQueuedFiles([]);
      setUploadProgress(null);
      onToast(
        `Uploaded ${uploadedCount} file${uploadedCount > 1 ? 's' : ''} directly to Company Drive`
      );
    } catch (err: unknown) {
      if (err instanceof DriveConnectionRequiredError) {
        void refreshDriveStatus();
        setUploadErr(err.message);
      } else {
        setUploadErr(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      }
    } finally {
      setUploading(false);
    }
  };

  // ===== FOLDER CREATE / EDIT / MOVE MODAL HANDLERS =====
  const openCreateFolderModal = () => {
    setEditingFolder(null);
    setFldName('');
    setFldParentId(currentFolderId);
    setFldBranch('All');
    setFldLocation('All');
    setFldScope('all');
    setFldAllowedEmpIds([]);
    setFldDescription('');
    setFldErr(null);
    setFolderModalMode('create');
  };

  const openEditFolderModal = (folder: SharedFolderDoc) => {
    setEditingFolder(folder);
    setFldName(folder.name);
    setFldParentId(folder.parentId || '');
    setFldBranch(folder.branch);
    setFldLocation(folder.location);
    setFldScope(folder.accessScope);
    setFldAllowedEmpIds(folder.allowedEmpIds || []);
    setFldDescription(folder.description || '');
    setFldErr(null);
    setFolderModalMode('edit');
  };

  const handleSaveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = fldName.trim();
    if (!cleanName) {
      setFldErr('Folder name is required.');
      return;
    }
    if (fldScope === 'selected' && fldAllowedEmpIds.length === 0) {
      setFldErr('Select at least one employee for folder access.');
      return;
    }

    setFldBusy(true);
    setFldErr(null);
    try {
      if (folderModalMode === 'create') {
        let driveFolderId = '';
        let driveUrl = '';
        if (driveStatus.connected) {
          try {
            const parentFolderObj = fldParentId ? folderMap.get(fldParentId) : null;
            const parentDriveId =
              parentFolderObj?.driveFolderId || driveStatus.rootFolderId || undefined;
            const createdDrive = await createCompanyDriveFolder(cleanName, parentDriveId);
            driveFolderId = createdDrive.id;
            driveUrl = createdDrive.webViewLink;
          } catch (driveCreateErr) {
            if (driveCreateErr instanceof DriveConnectionRequiredError) {
              void refreshDriveStatus();
            } else {
              console.warn('Created folder in app index without Drive subfolder:', driveCreateErr);
            }
          }
        }
        await onCreateFolderRecord({
          name: cleanName,
          parentId: fldParentId,
          driveFolderId,
          driveUrl,
          branch: fldBranch,
          location: fldLocation,
          accessScope: fldScope,
          allowedEmpIds: fldScope === 'selected' ? fldAllowedEmpIds : [],
          description: fldDescription,
        });
        onToast(`Folder "${cleanName}" created`);
      } else if (folderModalMode === 'edit' && editingFolder) {
        const parentChanged = fldParentId !== (editingFolder.parentId || '');
        const nameChanged = cleanName !== editingFolder.name;
        if (
          driveStatus.connected &&
          editingFolder.driveFolderId &&
          (nameChanged || parentChanged)
        ) {
          try {
            const targetParentObj = fldParentId ? folderMap.get(fldParentId) : null;
            const newParentDriveFolderId = parentChanged
              ? targetParentObj?.driveFolderId || 'ROOT'
              : undefined;
            await renameCompanyDriveItem({
              driveFileId: editingFolder.driveFolderId,
              newName: cleanName,
              itemKind: 'folder',
              firestoreDocId: editingFolder.folderId,
              newParentDriveFolderId,
            });
          } catch (renameErr) {
            if (renameErr instanceof DriveConnectionRequiredError) {
              void refreshDriveStatus();
            } else {
              console.warn('Drive folder update skipped:', renameErr);
            }
          }
        }
        await onUpdateFolderRecord({
          folder: editingFolder,
          name: cleanName,
          parentId: fldParentId,
          branch: fldBranch,
          location: fldLocation,
          accessScope: fldScope,
          allowedEmpIds: fldScope === 'selected' ? fldAllowedEmpIds : [],
          description: fldDescription,
        });
        onToast(`Folder "${cleanName}" updated`);
      }
      setFolderModalMode(null);
      setEditingFolder(null);
    } catch (err: unknown) {
      setFldErr(err instanceof Error ? err.message : 'Could not save folder.');
    } finally {
      setFldBusy(false);
    }
  };

  // ===== EDIT / MODIFY / REPLACE FILE MODAL HANDLERS =====
  const openEditFileModal = (file: SharedFileDoc) => {
    setEditingFile(file);
    setEfName(file.name);
    setEfFolderId(file.folderId || '');
    setEfCategory(file.category || 'General');
    setEfBranch(file.branch || 'All');
    setEfLocation(file.location || 'All');
    setEfScope(file.accessScope);
    setEfAllowedEmpIds(file.allowedEmpIds || []);
    setEfAllowDownload(file.allowDownload !== false);
    setEfDescription(file.description || '');
    setEfReplaceFile(null);
    setEfReplacePct(null);
    setEfErr(null);
  };

  const handleSaveEditFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFile) return;
    const cleanName = efName.trim();
    if (!cleanName) {
      setEfErr('File name is required.');
      return;
    }
    if (efScope === 'selected' && efAllowedEmpIds.length === 0) {
      setEfErr('Select at least one employee for file access.');
      return;
    }
    if (!isDeveloper && !efFolderId && editingFile.folderId) {
      setEfErr('Only Developers can move files to Company Drive root. Please choose a folder.');
      return;
    }

    setEfBusy(true);
    setEfErr(null);
    try {
      let nextSizeBytes: number | undefined;
      let nextMimeType: string | undefined;

      // 1. If user picked a replacement file, overwrite content in-place on Company Google Drive
      if (efReplaceFile) {
        if (!driveStatus.connected) {
          setEfErr(
            'Company Google Drive is not connected. Connect Company Drive to replace file content.'
          );
          setEfBusy(false);
          return;
        }
        const replaced = await replaceCompanyDriveFileContent({
          driveFileId: editingFile.driveFileId,
          firestoreDocId: editingFile.fileId,
          content: efReplaceFile,
          mimeType: efReplaceFile.type || editingFile.mimeType || 'application/octet-stream',
          fileName: efReplaceFile.name,
          onProgress: (pct) => setEfReplacePct(pct),
        });
        nextSizeBytes = replaced.sizeBytes;
        nextMimeType = replaced.mimeType || efReplaceFile.type || editingFile.mimeType;
      }

      // 2. Rename and/or move file inside Company Google Drive
      const folderChanged = efFolderId !== (editingFile.folderId || '');
      const nameChanged = cleanName !== editingFile.name;
      if (driveStatus.connected && editingFile.driveFileId && (nameChanged || folderChanged)) {
        try {
          const targetFolderObj = efFolderId ? folderMap.get(efFolderId) : null;
          const newParentDriveFolderId = folderChanged
            ? targetFolderObj?.driveFolderId || 'ROOT'
            : undefined;
          await renameCompanyDriveItem({
            driveFileId: editingFile.driveFileId,
            newName: cleanName,
            itemKind: 'file',
            firestoreDocId: editingFile.fileId,
            newParentDriveFolderId,
          });
        } catch (renameErr) {
          if (renameErr instanceof DriveConnectionRequiredError) {
            void refreshDriveStatus();
          } else {
            console.warn('Company Drive update skipped:', renameErr);
          }
        }
      }

      // 3. Persist updated metadata/size/folder to Firestore
      await onUpdateFileRecord({
        file: editingFile,
        name: cleanName,
        folderId: efFolderId,
        branch: efBranch,
        location: efLocation,
        category: efCategory,
        description: efDescription,
        accessScope: efScope,
        allowedEmpIds: efScope === 'selected' ? efAllowedEmpIds : [],
        allowDownload: efAllowDownload,
        sizeBytes: nextSizeBytes,
        mimeType: nextMimeType,
      });

      const updatedDoc: SharedFileDoc = {
        ...editingFile,
        name: cleanName,
        folderId: efFolderId,
        branch: efBranch,
        location: efLocation,
        category: efCategory,
        description: efDescription,
        accessScope: efScope,
        allowedEmpIds: efScope === 'selected' ? efAllowedEmpIds : [],
        allowDownload: efAllowDownload,
        sizeBytes: nextSizeBytes ?? editingFile.sizeBytes,
        mimeType: nextMimeType ?? editingFile.mimeType,
      };

      const wasViewing = viewerFile?.fileId === editingFile.fileId;
      setEditingFile(null);
      setEfReplaceFile(null);
      setEfReplacePct(null);
      onToast(
        efReplaceFile
          ? `Modified & replaced "${cleanName}" in Company Drive`
          : `Updated "${cleanName}"`
      );
      if (wasViewing) {
        void loadFileIntoViewer(updatedDoc);
      }
    } catch (err: unknown) {
      if (err instanceof DriveConnectionRequiredError) {
        void refreshDriveStatus();
      }
      setEfErr(err instanceof Error ? err.message : 'Could not update file.');
    } finally {
      setEfBusy(false);
    }
  };

  // ===== MANDATORY EXPLICIT DELETE CONFIRMATION HANDLERS =====
  const requestDeleteFile = (file: SharedFileDoc) => {
    setDeleteTarget({ kind: 'file', file });
    setDeleteAlsoFromDrive(Boolean(driveStatus.connected && file.driveFileId));
    setDeleteErr(null);
  };

  const requestDeleteFolder = (folder: SharedFolderDoc) => {
    setDeleteTarget({ kind: 'folder', folder });
    setDeleteAlsoFromDrive(Boolean(driveStatus.connected && folder.driveFolderId));
    setDeleteErr(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      if (deleteTarget.kind === 'file') {
        const target = deleteTarget.file;
        let removedFromDrive = false;
        if (deleteAlsoFromDrive && target.driveFileId) {
          if (!driveStatus.connected) {
            setDeleteErr(
              'Company Google Drive is not currently connected. Uncheck "Also permanently delete from Company Drive" to remove only from the Share Folder list.'
            );
            setDeleteBusy(false);
            return;
          }
          try {
            await deleteCompanyDriveItem({
              driveFileId: target.driveFileId,
              itemKind: 'file',
              firestoreDocId: target.fileId,
            });
            removedFromDrive = true;
          } catch (driveDelErr) {
            if (driveDelErr instanceof DriveConnectionRequiredError) {
              void refreshDriveStatus();
              setDeleteErr(driveDelErr.message);
              setDeleteBusy(false);
              return;
            }
            console.warn('Could not delete from Company Google Drive:', driveDelErr);
          }
        }
        await onDeleteFileRecord(target, removedFromDrive);
        if (viewerFile?.fileId === target.fileId) {
          closeFileViewer();
        }
        onToast(
          removedFromDrive
            ? `Deleted "${target.name}" from Company Drive & Share Folder`
            : `Removed "${target.name}" from Share Folder`
        );
      } else {
        const folder = deleteTarget.folder;
        const childFiles = sharedFiles.filter((f) => f.folderId === folder.folderId);
        const childFolders = sharedFolders.filter((f) => f.parentId === folder.folderId);
        if (childFiles.length > 0 || childFolders.length > 0) {
          setDeleteErr(
            `This folder still contains ${childFolders.length} subfolder(s) and ${childFiles.length} file(s). Move or delete them first.`
          );
          setDeleteBusy(false);
          return;
        }
        if (deleteAlsoFromDrive && folder.driveFolderId && driveStatus.connected) {
          try {
            await deleteCompanyDriveItem({
              driveFileId: folder.driveFolderId,
              itemKind: 'folder',
              firestoreDocId: folder.folderId,
            });
          } catch (driveDelErr) {
            if (driveDelErr instanceof DriveConnectionRequiredError) {
              void refreshDriveStatus();
              setDeleteErr(driveDelErr.message);
              setDeleteBusy(false);
              return;
            }
            console.warn('Could not delete folder from Company Google Drive:', driveDelErr);
          }
        }
        await onDeleteFolderRecord(folder);
        if (currentFolderId === folder.folderId) {
          setCurrentFolderId(folder.parentId || '');
        }
        onToast(`Deleted folder "${folder.name}"`);
      }
      setDeleteTarget(null);
    } catch (err: unknown) {
      setDeleteErr(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleEmpSelection = (
    empId: string,
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setter(list.includes(empId) ? list.filter((id) => id !== empId) : [...list, empId]);
  };

  const getFolderItemCount = (folderId: string) => {
    const subCount = visibleFolders.filter((f) => f.parentId === folderId).length;
    const fileCount = visibleFiles.filter((f) => f.folderId === folderId).length;
    return { subCount, fileCount };
  };

  const blockedParentIds = useMemo(() => {
    if (folderModalMode === 'edit' && editingFolder) {
      return getDescendantFolderIds(editingFolder.folderId);
    }
    return new Set<string>();
  }, [folderModalMode, editingFolder, getDescendantFolderIds]);

  const renderGoogleConnectButton = (label: string) => (
    <button
      type="button"
      className="gsi-material-button"
      disabled={connectingDrive}
      onClick={() => void handleConnectCompanyDrive()}
    >
      <div className="gsi-material-button-state" />
      <div className="gsi-material-button-content-wrapper">
        <div className="gsi-material-button-icon">
          <svg
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            style={{ display: 'block' }}
            aria-hidden="true"
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
            <path fill="none" d="M0 0h48v48H0z" />
          </svg>
        </div>
        <span className="gsi-material-button-contents">
          {connectingDrive ? 'Connecting...' : label}
        </span>
      </div>
    </button>
  );

  return (
    <div id="v-share" className="view on">
      {/* Compact Header & In-App Company Drive Bar (Zero External Redirects) */}
      <div className="sh-panel">
        <div className="sh-hd">
          <div className="sh-title-wrap">
            <h2 className="sh-title">Share Folder</h2>
          </div>

          <div className="sh-actions">
            {isDeveloper && (
              <>
                <button
                  type="button"
                  className="sh-btn sh-btn-secondary"
                  onClick={handleNavigateCompanyDriveRoot}
                  title="Navigate to Company Drive root folder inside this page"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  Company Drive
                </button>

                {!driveStatus.connected && renderGoogleConnectButton('Connect Company Drive')}

                {driveStatus.connected && !driveStatus.permanent && (
                  <>
                    <button
                      type="button"
                      className="sh-btn sh-btn-secondary"
                      disabled={connectingDrive}
                      onClick={() => void handleConnectCompanyDrive()}
                      title="Refresh or switch the shared Company Drive account"
                    >
                      {connectingDrive ? 'Connecting...' : 'Switch / Refresh Drive'}
                    </button>
                    <button
                      type="button"
                      className="sh-btn sh-btn-secondary"
                      disabled={connectingDrive}
                      onClick={() => setShowDisconnectConfirm(true)}
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </>
            )}

            <button
              type="button"
              className="sh-btn sh-btn-secondary"
              onClick={openCreateFolderModal}
            >
              + New Folder
            </button>

            {canUploadHere && (
              <button
                type="button"
                className="sh-btn sh-btn-primary"
                disabled={!driveStatus.connected && !isDeveloper}
                title={
                  !driveStatus.connected && !isDeveloper
                    ? 'Company Drive is currently unavailable'
                    : 'Upload files directly into the current folder'
                }
                onClick={() => openUploadModal()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" />
                </svg>
                Upload Files
              </button>
            )}
          </div>
        </div>

        {driveError && (
          <div style={{ padding: '0 14px 10px' }}>
            <div className="er" style={{ marginTop: 0 }}>
              {driveError}
            </div>
          </div>
        )}

        {/* Filter Toolbar */}
        <div className="sh-body">
          <div className="sh-filters">
            <div className="sh-field sh-search">
              <label htmlFor="sh-q">Search files &amp; folders</label>
              <input
                id="sh-q"
                type="text"
                placeholder="Search by file name, uploader, category, or note..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="sh-field">
              <label htmlFor="sh-cat">Category</label>
              <select
                id="sh-cat"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="All">All categories</option>
                {SHARED_FILE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="sh-field">
              <label htmlFor="sh-br">Branch</label>
              <select
                id="sh-br"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              >
                <option value="All">All branches</option>
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="sh-field">
              <label htmlFor="sh-loc">Location</label>
              <select
                id="sh-loc"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
              >
                <option value="All">All locations</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div className="sh-field">
              <label htmlFor="sh-acc">Access</label>
              <select
                id="sh-acc"
                value={accessFilter}
                onChange={(e) =>
                  setAccessFilter(e.target.value as 'all' | 'mine' | 'public' | 'restricted')
                }
              >
                <option value="all">All accessible</option>
                <option value="mine">Uploaded by me</option>
                <option value="public">Shared with all team</option>
                <option value="restricted">Branch / Staff restricted</option>
              </select>
            </div>

            <div className="sh-field">
              <label htmlFor="sh-sort">Sort by</label>
              <select
                id="sh-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'newest' | 'name' | 'size')}
              >
                <option value="newest">Newest first</option>
                <option value="name">Name (A–Z)</option>
                <option value="size">Largest first</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Compact Summary Strip */}
      <div className="grid" id="sh-kpis">
        <div className="glass card">
          <div className="sub">Shared files</div>
          <div className="big">{visibleFiles.length}</div>
          <div className="sh-kpi-sub">Accessible inside KEJMIN OPS</div>
        </div>
        <div className="glass card">
          <div className="sub">Folders</div>
          <div className="big">{visibleFolders.length}</div>
          <div className="sh-kpi-sub">Organized in Company Drive</div>
        </div>
        <div className="glass card">
          <div className="sub">Total Drive storage</div>
          <div className="big">{formatFileSize(totalStorageBytes)}</div>
          <div className="sh-kpi-sub">Stored in one shared Company Drive</div>
        </div>
        <div className="glass card">
          <div className="sub">Uploaded by me</div>
          <div className="big o">{myUploadsCount}</div>
          <div className="sh-kpi-sub">
            {driveStatus.connected
              ? 'View, edit, upload & delete directly here'
              : isDeveloper
              ? 'Connect Company Drive once for all users'
              : 'Company Drive storage'}
          </div>
        </div>
      </div>

      {/* In-App File Explorer with Path Navigation + Drag & Drop Zone */}
      <div
        className={`glass sec sh-explorer${dragActive ? ' drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (canUploadHere) setDragActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) {
            if (!canUploadHere) {
              onToast('Open a folder first — files must be uploaded inside a folder.');
              return;
            }
            if (!driveStatus.connected && !isDeveloper) {
              onToast('Company Drive is currently unavailable. Please contact the Developer.');
              return;
            }
            openUploadModal(Array.from(e.dataTransfer.files));
          }
        }}
      >
        {/* File Path Breadcrumb Navigator */}
        <div className="sh-crumbs-bar">
          <div className="sh-crumbs">
            {currentFolder && (
              <button
                type="button"
                className="sh-btn sh-btn-secondary"
                style={{ height: 28, padding: '0 9px', fontSize: 12 }}
                onClick={() => setCurrentFolderId(currentFolder.parentId || '')}
              >
                ← Up
              </button>
            )}
            <button
              type="button"
              className={`sh-crumb${!currentFolderId ? ' on' : ''}`}
              onClick={() => setCurrentFolderId('')}
            >
              Company Drive
            </button>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.folderId}>
                <span className="sh-sep">/</span>
                <button
                  type="button"
                  className={`sh-crumb${idx === breadcrumbs.length - 1 ? ' on' : ''}`}
                  onClick={() => setCurrentFolderId(crumb.folderId)}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {hasGlobalFilter && (
              <button
                type="button"
                className="sh-btn sh-btn-secondary"
                style={{ height: 28, fontSize: 12 }}
                onClick={clearFilters}
              >
                Reset filters
              </button>
            )}
            {currentFolder && (
              <>
                <button
                  type="button"
                  className="sh-btn sh-btn-secondary"
                  style={{ height: 28, fontSize: 12 }}
                  onClick={openCreateFolderModal}
                >
                  + Subfolder
                </button>
                {(driveStatus.connected || isDeveloper) && (
                  <button
                    type="button"
                    className="sh-btn sh-btn-primary"
                    style={{ height: 28, fontSize: 12 }}
                    onClick={() => openUploadModal()}
                  >
                    Upload Here
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Subfolders Grid */}
        {displayedFolders.length > 0 && (
          <div className="sh-folders-wrap">
            <div className="sh-section-lbl">Folders ({displayedFolders.length})</div>
            <div className="sh-folders-grid">
              {displayedFolders.map((folder) => {
                const counts = getFolderItemCount(folder.folderId);
                const manageable = canManageFolder(folder);
                return (
                  <div key={folder.folderId} className="sh-folder-card">
                    <div
                      className="sh-folder-main"
                      onClick={() => setCurrentFolderId(folder.folderId)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setCurrentFolderId(folder.folderId);
                        }
                      }}
                    >
                      <div className="sh-folder-icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                      </div>
                      <div className="sh-folder-info">
                        <div className="sh-folder-name" title={folder.name}>
                          {folder.name}
                        </div>
                        <div className="sh-folder-meta">
                          {counts.fileCount} file{counts.fileCount === 1 ? '' : 's'}
                          {counts.subCount > 0
                            ? ` · ${counts.subCount} folder${counts.subCount === 1 ? '' : 's'}`
                            : ''}
                          {' · '}
                          {ACCESS_LABELS[folder.accessScope]}
                        </div>
                      </div>
                    </div>

                    <div className="sh-folder-foot">
                      <span className="sh-folder-by">By {folder.createdBy}</span>
                      <div className="sh-folder-acts">
                        <button
                          type="button"
                          className="sh-link-btn"
                          onClick={() => setCurrentFolderId(folder.folderId)}
                        >
                          Open
                        </button>
                        {manageable && (
                          <>
                            <button
                              type="button"
                              className="sh-link-btn"
                              onClick={() => openEditFolderModal(folder)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="sh-link-btn danger"
                              onClick={() => requestDeleteFolder(folder)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Files Table */}
        <div className="sh-section-lbl" style={{ marginTop: displayedFolders.length ? 18 : 4 }}>
          Files ({displayedFiles.length})
          <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--mut)' }}>
            {!canUploadHere
              ? 'Open a folder above to upload files'
              : driveStatus.connected
              ? 'Click any file to preview or edit · Drag & drop files here to upload'
              : isDeveloper
              ? 'Connect Company Drive once above so all staff can preview, upload, and modify files here'
              : 'Company Drive storage'}
          </span>
        </div>

        {displayedFiles.length === 0 ? (
          <div className="sh-empty">
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--tx)' }}>
              {hasGlobalFilter
                ? 'No shared files match your current filters.'
                : !canUploadHere
                ? 'Open a folder to upload files.'
                : 'No files in this folder yet.'}
            </div>
            <div className="sub" style={{ marginTop: 4 }}>
              {hasGlobalFilter
                ? 'Try clearing the search or changing branch/location filters.'
                : !canUploadHere
                ? 'Files must be uploaded inside a folder in Company Drive. Open a folder above or create a new folder first.'
                : driveStatus.connected
                ? 'Upload documents, Excel sheets, PDFs, or images directly here.'
                : isDeveloper
                ? 'Connect Company Drive once and every employee in KEJMIN OPS can manage files directly inside this page.'
                : 'Files uploaded to this folder will appear here.'}
            </div>
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                gap: 8,
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              {hasGlobalFilter ? (
                <button type="button" className="btn g" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : (
                <>
                  {canUploadHere && (driveStatus.connected || isDeveloper) && (
                    <button type="button" className="btn" onClick={() => openUploadModal()}>
                      Upload Files
                    </button>
                  )}
                  <button type="button" className="btn g" onClick={openCreateFolderModal}>
                    {currentFolderId ? 'Create subfolder' : 'Create folder'}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Category</th>
                  <th>Scope &amp; Access</th>
                  <th>Size</th>
                  <th>Uploaded by</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedFiles.map((file) => {
                  const kind = getFileKindLabel(file.mimeType, file.name);
                  const manageable = canManageFile(file);
                  const parentFld = file.folderId ? folderMap.get(file.folderId) : null;
                  const canDownload = file.allowDownload !== false || manageable;
                  const scopeDetail =
                    file.accessScope === 'all'
                      ? 'Everyone'
                      : file.accessScope === 'branch'
                      ? `Branch: ${file.branch}`
                      : file.accessScope === 'location'
                      ? `Location: ${file.location}`
                      : `${file.allowedEmpIds.length} staff selected`;

                  return (
                    <tr key={file.fileId}>
                      <td>
                        <div className="sh-file-cell">
                          <span className={`sh-ext ${kind.tone}`}>{kind.label}</span>
                          <div style={{ minWidth: 0 }}>
                            <button
                              type="button"
                              className="sh-file-name"
                              title={`View "${file.name}" inside KEJMIN OPS`}
                              onClick={() => void loadFileIntoViewer(file)}
                            >
                              {file.name}
                            </button>
                            <div className="sh-file-meta">
                              {parentFld && hasGlobalFilter && (
                                <button
                                  type="button"
                                  className="sh-inline-fld"
                                  onClick={() => {
                                    setCurrentFolderId(parentFld.folderId);
                                    clearFilters();
                                  }}
                                >
                                  {parentFld.name}
                                </button>
                              )}
                              {file.description && <span>{file.description}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="sh-cat-badge">{file.category}</span>
                      </td>
                      <td>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{scopeDetail}</div>
                        <div className="sub" style={{ fontSize: 11.5 }}>
                          {file.branch} · {file.location}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                        {formatFileSize(file.sizeBytes)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{file.uploadedBy}</div>
                        <div className="sub" style={{ fontSize: 11.5 }}>
                          {formatDateFromTs(file.createdAt)}
                        </div>
                      </td>
                      <td>
                        <div className="sh-row-acts">
                          <button
                            type="button"
                            className="sh-act-btn primary"
                            onClick={() => void loadFileIntoViewer(file)}
                          >
                            View
                          </button>
                          {canDownload && (
                            <button
                              type="button"
                              className="sh-act-btn"
                              disabled={downloadingFileId === file.fileId}
                              onClick={() => void handleInAppDownload(file)}
                            >
                              {downloadingFileId === file.fileId ? 'Saving...' : 'Download'}
                            </button>
                          )}
                          {manageable && (
                            <>
                              <button
                                type="button"
                                className="sh-act-btn"
                                onClick={() => openEditFileModal(file)}
                              >
                                Edit / Modify
                              </button>
                              <button
                                type="button"
                                className="sh-act-btn danger"
                                onClick={() => requestDeleteFile(file)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== SHARE FOLDER MODALS (PORTALED TO BODY SO SIDEBAR NEVER OVERLAPS) ===== */}
      {createPortal(
        <>
          {/* ===== IN-APP FILE VIEWER & INLINE EDITOR MODAL (ZERO EXTERNAL REDIRECT) ===== */}
          {viewerFile && (
            <div
              className="ov"
              onClick={(e) => {
                if (e.target === e.currentTarget && !viewerSavingText) {
                  closeFileViewer();
                }
              }}
            >
              <div className="md sh-viewer-md">
            <div className="sh-viewer-hd">
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 className="sh-viewer-title">{viewerFile.name}</h3>
                <div className="sh-viewer-path">
                  {getFolderPathLabel(viewerFile.folderId)} · {formatFileSize(viewerFile.sizeBytes)}{' '}
                  · {viewerFile.category} · Uploaded by {viewerFile.uploadedBy}
                </div>
              </div>

              <div className="sh-viewer-acts">
                {(viewerFile.allowDownload !== false || canManageFile(viewerFile)) && (
                  <button
                    type="button"
                    className="sh-act-btn"
                    disabled={downloadingFileId === viewerFile.fileId}
                    onClick={() => void handleInAppDownload(viewerFile)}
                  >
                    {downloadingFileId === viewerFile.fileId ? 'Downloading...' : 'Download'}
                  </button>
                )}

                {viewerKind === 'text' && canManageFile(viewerFile) && !viewerLoading && !viewerError && (
                  !viewerEditingText ? (
                    <button
                      type="button"
                      className="sh-act-btn primary"
                      onClick={() => {
                        setViewerDraftText(viewerText);
                        setViewerEditingText(true);
                      }}
                    >
                      Edit Content
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="sh-act-btn"
                        disabled={viewerSavingText}
                        onClick={() => {
                          setViewerEditingText(false);
                          setViewerConfirmSaveText(false);
                          setViewerDraftText(viewerText);
                        }}
                      >
                        Cancel Edit
                      </button>
                      <button
                        type="button"
                        className="sh-act-btn primary"
                        disabled={viewerSavingText}
                        onClick={() => setViewerConfirmSaveText(true)}
                      >
                        Save Changes
                      </button>
                    </>
                  )
                )}

                {canManageFile(viewerFile) && (
                  <>
                    <button
                      type="button"
                      className="sh-act-btn"
                      onClick={() => openEditFileModal(viewerFile)}
                    >
                      Modify / Replace
                    </button>
                    <button
                      type="button"
                      className="sh-act-btn danger"
                      onClick={() => requestDeleteFile(viewerFile)}
                    >
                      Delete
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="sh-act-btn"
                  disabled={viewerSavingText}
                  onClick={closeFileViewer}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="sh-viewer-stage">
              {viewerLoading ? (
                <div className="sh-viewer-binary">
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    Loading file inside KEJMIN OPS...
                  </div>
                  <div className="sub" style={{ marginTop: 6 }}>
                    Fetching &ldquo;{viewerFile.name}&rdquo; from Company Drive
                  </div>
                </div>
              ) : viewerError ? (
                <div className="sh-viewer-binary">
                  <div className="er" style={{ margin: '0 auto 14px', maxWidth: 520 }}>
                    {viewerError}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn g"
                      onClick={() => void loadFileIntoViewer(viewerFile)}
                    >
                      Retry Preview
                    </button>
                    {isDeveloper && !driveStatus.connected && (
                      <button
                        type="button"
                        className="btn"
                        disabled={connectingDrive}
                        onClick={async () => {
                          const ok = await handleConnectCompanyDrive();
                          if (ok) {
                            void loadFileIntoViewer(viewerFile);
                          }
                        }}
                      >
                        {connectingDrive ? 'Connecting...' : 'Connect Company Drive & Retry'}
                      </button>
                    )}
                  </div>
                </div>
              ) : viewerKind === 'image' && viewerPreviewUrl ? (
                <div className="sh-viewer-img-wrap">
                  <img
                    src={viewerPreviewUrl}
                    alt={viewerFile.name}
                    className="sh-viewer-img"
                    onError={() => {
                      setViewerError(
                        `This image ("${viewerFile.name}") could not be rendered in the browser. It may be an unsupported format or damaged — try downloading or re-uploading it.`
                      );
                    }}
                  />
                </div>
              ) : viewerKind === 'pdf' && viewerPreviewUrl ? (
                <div>
                  <iframe
                    title={viewerFile.name}
                    src={viewerPreviewUrl}
                    className="sh-viewer-pdf"
                  />
                  <div className="sub" style={{ marginTop: 6, textAlign: 'center' }}>
                    If your browser blocks embedded PDF display, use the Download button above to
                    view it locally.
                  </div>
                </div>
              ) : viewerKind === 'video' && viewerPreviewUrl ? (
                <div className="sh-viewer-img-wrap">
                  <video
                    src={viewerPreviewUrl}
                    controls
                    className="sh-viewer-media"
                    onError={() =>
                      setViewerError(
                        'This video codec is not supported for inline browser playback. Click Download above to play it locally.'
                      )
                    }
                  />
                </div>
              ) : viewerKind === 'audio' && viewerPreviewUrl ? (
                <div className="sh-viewer-binary">
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
                    {viewerFile.name}
                  </div>
                  <audio
                    src={viewerPreviewUrl}
                    controls
                    style={{ width: 'min(520px, 100%)' }}
                    onError={() =>
                      setViewerError(
                        'This audio format is not supported for inline playback. Click Download above to play it locally.'
                      )
                    }
                  />
                </div>
              ) : viewerKind === 'spreadsheet' && viewerSheets.length > 0 ? (
                <div>
                  <div className="sh-sheet-tabs">
                    {viewerSheets.map((s, idx) => (
                      <button
                        key={s.name}
                        type="button"
                        className={`sh-sheet-tab${idx === viewerSheetIdx ? ' on' : ''}`}
                        onClick={() => setViewerSheetIdx(idx)}
                      >
                        {s.name} ({s.totalRows} rows)
                      </button>
                    ))}
                  </div>
                  <div className="sh-sheet-wrap">
                    <table className="sh-sheet-tbl">
                      <tbody>
                        {(viewerSheets[viewerSheetIdx]?.rows || []).map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} title={cell}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(viewerSheets[viewerSheetIdx]?.totalRows || 0) > 500 && (
                    <div className="sub" style={{ marginTop: 8 }}>
                      Showing first 500 of {viewerSheets[viewerSheetIdx].totalRows} rows. Click
                      Download above to open the complete workbook locally.
                    </div>
                  )}
                </div>
              ) : viewerKind === 'text' ? (
                viewerEditingText ? (
                  <div>
                    <textarea
                      className="sh-viewer-textarea"
                      value={viewerDraftText}
                      onChange={(e) => setViewerDraftText(e.target.value)}
                      disabled={viewerSavingText}
                      spellCheck={false}
                    />
                    {viewerConfirmSaveText && (
                      <div className="sh-connect-callout" style={{ marginTop: 12, marginBottom: 0 }}>
                        <div>
                          <b>Confirm overwriting &ldquo;{viewerFile.name}&rdquo;?</b>
                          <div className="sub">
                            This will save your edited content directly to Company Google Drive for
                            all team members.
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="btn g"
                            disabled={viewerSavingText}
                            onClick={() => setViewerConfirmSaveText(false)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={viewerSavingText}
                            onClick={() => void handleConfirmSaveInlineText()}
                          >
                            {viewerSavingText ? 'Saving...' : 'Confirm & Overwrite'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <pre className="sh-viewer-pre">{viewerText || '(Empty file)'}</pre>
                )
              ) : (
                <div className="sh-viewer-binary">
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--tx)' }}>
                    {viewerFile.name}
                  </div>
                  <div className="sub" style={{ marginTop: 6 }}>
                    In-browser preview is not available for this file format (
                    {viewerFile.mimeType || 'binary file'}). You can download it directly or
                    replace it with a newer version right here.
                  </div>
                  {viewerFile.description && (
                    <div style={{ marginTop: 10, fontSize: 13 }}>
                      <b>Notes:</b> {viewerFile.description}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 16,
                      display: 'flex',
                      gap: 8,
                      justifyContent: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    {(viewerFile.allowDownload !== false || canManageFile(viewerFile)) && (
                      <button
                        type="button"
                        className="btn"
                        disabled={downloadingFileId === viewerFile.fileId}
                        onClick={() => void handleInAppDownload(viewerFile)}
                      >
                        {downloadingFileId === viewerFile.fileId
                          ? 'Downloading...'
                          : 'Download File'}
                      </button>
                    )}
                    {canManageFile(viewerFile) && (
                      <button
                        type="button"
                        className="btn g"
                        onClick={() => openEditFileModal(viewerFile)}
                      >
                        Modify / Replace File
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="sh-viewer-foot">
              <span>
                Branch: <b>{viewerFile.branch}</b> · Location: <b>{viewerFile.location}</b> ·
                Access: <b>{ACCESS_LABELS[viewerFile.accessScope]}</b>
              </span>
              <span>
                Uploaded {formatDateFromTs(viewerFile.createdAt)}
                {viewerFile.description ? ` · ${viewerFile.description}` : ''}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ===== UPLOAD TO COMPANY GOOGLE DRIVE MODAL ===== */}
      {showUploadModal && (
        <div
          className="ov"
          onClick={(e) => {
            if (e.target === e.currentTarget && !uploading) setShowUploadModal(false);
          }}
        >
          <div className="md" style={{ width: 'min(560px, 100%)' }}>
            <h3 style={{ marginTop: 0 }}>Upload files to Company Drive</h3>
            <div className="sub" style={{ marginBottom: 12 }}>
              Files are uploaded directly into KEJMIN OPS&apos;s shared Company Drive and managed
              right inside this page.
            </div>

            {!driveStatus.connected && (
              <div className="sh-connect-callout">
                <div>
                  <b>
                    {isDeveloper
                      ? 'Connect Company Drive once for all users'
                      : 'Company Drive not connected'}
                  </b>
                  <div className="sub">
                    {isDeveloper
                      ? 'Once you connect Company Drive here, every user in KEJMIN OPS uploads straight into this same Drive.'
                      : 'Please contact the Developer to connect Company Drive.'}
                  </div>
                </div>
                {isDeveloper && renderGoogleConnectButton('Connect Company Drive')}
              </div>
            )}

            {/* File dropzone */}
            <div
              className="sh-dropzone"
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!uploading && e.dataTransfer.files?.length) {
                  handleAddFiles(e.dataTransfer.files);
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.length) {
                    handleAddFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
              <b>Click to choose files or drag &amp; drop here</b>
              <div className="sub">
                Any file format · Unlimited files &amp; size (uses your full Company Drive storage)
              </div>
            </div>

            {queuedFiles.length > 0 && (
              <div className="sh-queue">
                {queuedFiles.map((f, idx) => (
                  <div key={`${f.name}_${f.size}_${idx}`} className="sh-queue-item">
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {f.name} <span className="sub">({formatFileSize(f.size)})</span>
                    </span>
                    {!uploading && (
                      <button
                        type="button"
                        className="sh-link-btn danger"
                        onClick={() =>
                          setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="fg">
              <div>
                <label htmlFor="up-fld">Target folder path</label>
                <select
                  id="up-fld"
                  value={upFolderId}
                  onChange={(e) => setUpFolderId(e.target.value)}
                  disabled={uploading}
                >
                  {isDeveloper && <option value="">Company Drive (Root)</option>}
                  {visibleFolders.map((fld) => (
                    <option key={fld.folderId} value={fld.folderId}>
                      {getFolderPathLabel(fld.folderId)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="up-cat">Category</label>
                <select
                  id="up-cat"
                  value={upCategory}
                  onChange={(e) => setUpCategory(e.target.value)}
                  disabled={uploading}
                >
                  {SHARED_FILE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="up-br">Branch</label>
                <select
                  id="up-br"
                  value={upBranch}
                  onChange={(e) => setUpBranch(e.target.value)}
                  disabled={uploading}
                >
                  <option value="All">All branches</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="up-loc">Location</label>
                <select
                  id="up-loc"
                  value={upLocation}
                  onChange={(e) => setUpLocation(e.target.value)}
                  disabled={uploading}
                >
                  <option value="All">All locations</option>
                  {locations.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="up-scope">Who can access in KEJMIN OPS</label>
            <select
              id="up-scope"
              value={upScope}
              onChange={(e) => setUpScope(e.target.value as ShareAccessScope)}
              disabled={uploading}
            >
              <option value="all">All team members (Everyone in KEJMIN OPS)</option>
              <option value="branch">Selected Branch only</option>
              <option value="location">Selected Location only</option>
              <option value="selected">Specific selected employees</option>
            </select>

            {upScope === 'selected' && (
              <div className="sh-emp-picker">
                {activeEmployees.map((emp) => (
                  <label key={emp.empId} className="sh-emp-chk">
                    <input
                      type="checkbox"
                      checked={upAllowedEmpIds.includes(emp.empId)}
                      onChange={() =>
                        toggleEmpSelection(emp.empId, upAllowedEmpIds, setUpAllowedEmpIds)
                      }
                      disabled={uploading}
                    />
                    <span>
                      {emp.name} <span className="sub">({emp.role})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <label htmlFor="up-desc">Description / notes (optional)</label>
            <input
              id="up-desc"
              type="text"
              maxLength={400}
              placeholder="Brief note about this document..."
              value={upDescription}
              onChange={(e) => setUpDescription(e.target.value)}
              disabled={uploading}
            />

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                marginTop: 12,
              }}
            >
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={upAllowDownload}
                onChange={(e) => setUpAllowDownload(e.target.checked)}
                disabled={uploading}
              />
              <span style={{ color: 'var(--tx)', fontWeight: 500 }}>
                Allow direct Download button for team members
              </span>
            </label>

            {uploadProgress && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    marginBottom: 4,
                  }}
                >
                  <span>
                    Uploading {uploadProgress.index}/{uploadProgress.total}:{' '}
                    {uploadProgress.fileName}
                  </span>
                  <b>{uploadProgress.percent}%</b>
                </div>
                <div className="bar">
                  <i style={{ width: `${uploadProgress.percent}%` }} />
                </div>
              </div>
            )}

            {uploadErr && <div className="er">{uploadErr}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                className="btn g"
                disabled={uploading}
                onClick={() => setShowUploadModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={
                  uploading || queuedFiles.length === 0 || (!driveStatus.connected && !isDeveloper)
                }
                onClick={() => void handleStartUpload()}
              >
                {uploading
                  ? 'Uploading...'
                  : `Upload ${queuedFiles.length || ''} file${queuedFiles.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== CREATE / EDIT / MOVE FOLDER MODAL ===== */}
      {folderModalMode && (
        <div
          className="ov"
          onClick={(e) => {
            if (e.target === e.currentTarget && !fldBusy) setFolderModalMode(null);
          }}
        >
          <form className="md" onSubmit={(e) => void handleSaveFolder(e)}>
            <h3 style={{ marginTop: 0 }}>
              {folderModalMode === 'create' ? 'Create Shared Folder' : 'Edit / Move Shared Folder'}
            </h3>
            {folderModalMode === 'edit' && editingFolder?.driveFolderId && (
              <div className="sub" style={{ marginBottom: 8 }}>
                Confirming will update this folder&apos;s name, location path, and permissions
                directly in Company Drive.
              </div>
            )}

            <label htmlFor="fld-name">Folder name</label>
            <input
              id="fld-name"
              type="text"
              maxLength={100}
              required
              placeholder="e.g. Monthly MIS Reports, Plant 1 SOPs"
              value={fldName}
              onChange={(e) => setFldName(e.target.value)}
              disabled={fldBusy}
            />

            <label htmlFor="fld-parent">Parent folder path</label>
            <select
              id="fld-parent"
              value={fldParentId}
              onChange={(e) => setFldParentId(e.target.value)}
              disabled={fldBusy}
            >
              <option value="">Company Drive (Root)</option>
              {visibleFolders
                .filter((f) => !blockedParentIds.has(f.folderId))
                .map((fld) => (
                  <option key={fld.folderId} value={fld.folderId}>
                    {getFolderPathLabel(fld.folderId)}
                  </option>
                ))}
            </select>

            <div className="fg">
              <div>
                <label htmlFor="fld-br">Branch</label>
                <select
                  id="fld-br"
                  value={fldBranch}
                  onChange={(e) => setFldBranch(e.target.value)}
                  disabled={fldBusy}
                >
                  <option value="All">All branches</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="fld-loc">Location</label>
                <select
                  id="fld-loc"
                  value={fldLocation}
                  onChange={(e) => setFldLocation(e.target.value)}
                  disabled={fldBusy}
                >
                  <option value="All">All locations</option>
                  {locations.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="fld-scope">Folder access</label>
            <select
              id="fld-scope"
              value={fldScope}
              onChange={(e) => setFldScope(e.target.value as ShareAccessScope)}
              disabled={fldBusy}
            >
              <option value="all">All team members</option>
              <option value="branch">Selected Branch only</option>
              <option value="location">Selected Location only</option>
              <option value="selected">Specific selected employees</option>
            </select>

            {fldScope === 'selected' && (
              <div className="sh-emp-picker">
                {activeEmployees.map((emp) => (
                  <label key={emp.empId} className="sh-emp-chk">
                    <input
                      type="checkbox"
                      checked={fldAllowedEmpIds.includes(emp.empId)}
                      onChange={() =>
                        toggleEmpSelection(emp.empId, fldAllowedEmpIds, setFldAllowedEmpIds)
                      }
                      disabled={fldBusy}
                    />
                    <span>
                      {emp.name} <span className="sub">({emp.role})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <label htmlFor="fld-desc">Description (optional)</label>
            <input
              id="fld-desc"
              type="text"
              maxLength={300}
              placeholder="What files belong in this folder?"
              value={fldDescription}
              onChange={(e) => setFldDescription(e.target.value)}
              disabled={fldBusy}
            />

            {fldErr && <div className="er">{fldErr}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                className="btn g"
                disabled={fldBusy}
                onClick={() => setFolderModalMode(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={fldBusy}>
                {fldBusy
                  ? 'Saving...'
                  : folderModalMode === 'create'
                  ? 'Create Folder'
                  : 'Confirm & Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== EDIT / MODIFY / REPLACE FILE MODAL ===== */}
      {editingFile && (
        <div
          className="ov"
          onClick={(e) => {
            if (e.target === e.currentTarget && !efBusy) setEditingFile(null);
          }}
        >
          <form className="md" style={{ width: 'min(560px, 100%)' }} onSubmit={(e) => void handleSaveEditFile(e)}>
            <h3 style={{ marginTop: 0 }}>Edit / Modify shared file</h3>
            <div className="sub" style={{ marginBottom: 8 }}>
              Confirming will update this file&apos;s name, folder path, sharing settings
              {efReplaceFile ? ', and overwrite the file content in Company Drive.' : ' directly in Company Drive.'}
            </div>

            <label htmlFor="ef-name">File name</label>
            <input
              id="ef-name"
              type="text"
              maxLength={200}
              required
              value={efName}
              onChange={(e) => setEfName(e.target.value)}
              disabled={efBusy}
            />

            <div className="fg">
              <div>
                <label htmlFor="ef-fld">Folder path (move file)</label>
                <select
                  id="ef-fld"
                  value={efFolderId}
                  onChange={(e) => setEfFolderId(e.target.value)}
                  disabled={efBusy}
                >
                  {(isDeveloper || !editingFile.folderId) && (
                    <option value="">Company Drive (Root)</option>
                  )}
                  {visibleFolders.map((fld) => (
                    <option key={fld.folderId} value={fld.folderId}>
                      {getFolderPathLabel(fld.folderId)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ef-cat">Category</label>
                <select
                  id="ef-cat"
                  value={efCategory}
                  onChange={(e) => setEfCategory(e.target.value)}
                  disabled={efBusy}
                >
                  {SHARED_FILE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ef-br">Branch</label>
                <select
                  id="ef-br"
                  value={efBranch}
                  onChange={(e) => setEfBranch(e.target.value)}
                  disabled={efBusy}
                >
                  <option value="All">All branches</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ef-loc">Location</label>
                <select
                  id="ef-loc"
                  value={efLocation}
                  onChange={(e) => setEfLocation(e.target.value)}
                  disabled={efBusy}
                >
                  <option value="All">All locations</option>
                  {locations.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Replace / Upload New Version Box */}
            <div className="sh-replace-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx)' }}>
                    Replace file content (optional)
                  </div>
                  <div className="sub" style={{ fontSize: 11.5 }}>
                    {efReplaceFile
                      ? `Selected: ${efReplaceFile.name} (${formatFileSize(efReplaceFile.size)})`
                      : 'Upload an updated version of this file directly into Company Drive'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    ref={replaceFileInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const picked = e.target.files?.[0] || null;
                      if (picked) {
                        setEfReplaceFile(picked);
                      }
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="sh-act-btn"
                    disabled={efBusy}
                    onClick={() => replaceFileInputRef.current?.click()}
                  >
                    {efReplaceFile ? 'Change File' : 'Choose New Version'}
                  </button>
                  {efReplaceFile && (
                    <button
                      type="button"
                      className="sh-act-btn danger"
                      disabled={efBusy}
                      onClick={() => setEfReplaceFile(null)}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              {efReplacePct !== null && (
                <div style={{ marginTop: 8 }}>
                  <div className="bar">
                    <i style={{ width: `${efReplacePct}%` }} />
                  </div>
                </div>
              )}
            </div>

            <label htmlFor="ef-scope">Who can access</label>
            <select
              id="ef-scope"
              value={efScope}
              onChange={(e) => setEfScope(e.target.value as ShareAccessScope)}
              disabled={efBusy}
            >
              <option value="all">All team members</option>
              <option value="branch">Selected Branch only</option>
              <option value="location">Selected Location only</option>
              <option value="selected">Specific selected employees</option>
            </select>

            {efScope === 'selected' && (
              <div className="sh-emp-picker">
                {activeEmployees.map((emp) => (
                  <label key={emp.empId} className="sh-emp-chk">
                    <input
                      type="checkbox"
                      checked={efAllowedEmpIds.includes(emp.empId)}
                      onChange={() =>
                        toggleEmpSelection(emp.empId, efAllowedEmpIds, setEfAllowedEmpIds)
                      }
                      disabled={efBusy}
                    />
                    <span>
                      {emp.name} <span className="sub">({emp.role})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <label htmlFor="ef-desc">Description</label>
            <input
              id="ef-desc"
              type="text"
              maxLength={400}
              value={efDescription}
              onChange={(e) => setEfDescription(e.target.value)}
              disabled={efBusy}
            />

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                marginTop: 12,
              }}
            >
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={efAllowDownload}
                onChange={(e) => setEfAllowDownload(e.target.checked)}
                disabled={efBusy}
              />
              <span style={{ color: 'var(--tx)', fontWeight: 500 }}>
                Allow direct Download button for team members
              </span>
            </label>

            {efErr && <div className="er">{efErr}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                className="btn g"
                disabled={efBusy}
                onClick={() => setEditingFile(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={efBusy}>
                {efBusy
                  ? 'Saving...'
                  : efReplaceFile
                  ? 'Confirm & Replace File'
                  : 'Confirm & Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== MANDATORY EXPLICIT DELETE CONFIRMATION MODAL ===== */}
      {deleteTarget && (
        <div
          className="ov"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleteBusy) setDeleteTarget(null);
          }}
        >
          <div className="md">
            <h3 style={{ marginTop: 0, color: 'var(--red)' }}>
              {deleteTarget.kind === 'file'
                ? 'Delete shared file?'
                : 'Delete shared folder?'}
            </h3>
            <p style={{ marginTop: 8, marginBottom: 12 }}>
              Are you sure you want to delete{' '}
              <b>
                &ldquo;
                {deleteTarget.kind === 'file'
                  ? deleteTarget.file.name
                  : deleteTarget.folder.name}
                &rdquo;
              </b>
              ? Team members will immediately lose access to it in KEJMIN OPS.
            </p>

            {((deleteTarget.kind === 'file' && deleteTarget.file.driveFileId) ||
              (deleteTarget.kind === 'folder' && deleteTarget.folder.driveFolderId)) && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--bd)',
                  background: 'rgba(184,58,46,.06)',
                  cursor: 'pointer',
                  marginTop: 8,
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: 'auto', marginTop: 2 }}
                  checked={deleteAlsoFromDrive}
                  onChange={(e) => setDeleteAlsoFromDrive(e.target.checked)}
                  disabled={deleteBusy}
                />
                <span style={{ color: 'var(--tx)', fontWeight: 500, fontSize: 13 }}>
                  Also permanently delete from Company Drive
                  <span className="sub" style={{ display: 'block', marginTop: 2 }}>
                    This action cannot be undone once deleted from Google Drive.
                  </span>
                </span>
              </label>
            )}

            {deleteErr && <div className="er">{deleteErr}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                type="button"
                className="btn g"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn r"
                style={{ background: 'var(--red)', color: '#fff' }}
                disabled={deleteBusy}
                onClick={() => void handleConfirmDelete()}
              >
                {deleteBusy ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DISCONNECT COMPANY DRIVE CONFIRMATION MODAL (DEVELOPER ONLY) ===== */}
      {isDeveloper && showDisconnectConfirm && (
        <div
          className="ov"
          onClick={(e) => {
            if (e.target === e.currentTarget && !connectingDrive) {
              setShowDisconnectConfirm(false);
            }
          }}
        >
          <div className="md">
            <h3 style={{ marginTop: 0 }}>Disconnect Company Drive?</h3>
            <p style={{ marginTop: 8, marginBottom: 12 }}>
              Disconnecting will pause file previews, uploads, and downloads for all team members
              until an Administrator reconnects Company Drive.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                className="btn g"
                disabled={connectingDrive}
                onClick={() => setShowDisconnectConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn r"
                style={{ background: 'var(--red)', color: '#fff' }}
                disabled={connectingDrive}
                onClick={() => void handleDisconnectCompanyDrive()}
              >
                {connectingDrive ? 'Disconnecting...' : 'Confirm Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
        </>,
        document.body
      )}
    </div>
  );
};
