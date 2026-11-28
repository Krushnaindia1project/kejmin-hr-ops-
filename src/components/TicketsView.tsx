import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import {
  DirectoryEntry,
  Priority,
  SupportTicketDoc,
  TicketAttachmentCategory,
  TicketAttachmentDoc,
  TicketComment,
  TicketStatus,
  TicketSubtask,
} from '../types';
import {
  addTicketAttachments,
  clearAllSupportTickets,
  createSupportTicket,
  deleteSupportTicket,
  fetchAllTicketAttachments,
  PendingTicketAttachment,
  removeTicketAttachment,
  subscribeTicketAttachments,
  updateSupportTicket,
} from '../services/firestoreService';

interface TicketsViewProps {
  me: DirectoryEntry;
  currentUid: string;
  isDev: boolean;
  isAdmin: boolean;
  directory: DirectoryEntry[];
  tickets: SupportTicketDoc[];
  onToast: (msg: string) => void;
}

type TicketTab = 'list' | 'board' | 'rep';

const STATUS_LIST: ReadonlyArray<[TicketStatus, string]> = [
  ['created', 'Task created'],
  ['review', 'Task on review'],
  ['resp', 'Response received'],
  ['closed', 'Task closed'],
  ['reopen', 'Task reopened'],
];

const STATUS_COLORS: Record<TicketStatus, string> = {
  created: '#2e7cd6',
  review: '#c89a1a',
  resp: '#7a4fd3',
  closed: '#2e9b5e',
  reopen: '#d9422b',
};

const BUILTIN_TYPES: Record<string, [string, string, string]> = {
  bug: ['Bug', '#d92d20', 'B'],
  task: ['Task', '#2e7cd6', 'T'],
  story: ['Story', '#2e9b5e', 'S'],
  epic: ['Epic', '#7a4fd3', 'E'],
  incident: ['Incident', '#c8741a', '!'],
};

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const PRIORITY_COLORS: Record<Priority, string> = {
  High: '#d9622b',
  Medium: '#c89a1a',
  Low: '#2e7cd6',
};

const ATTACHMENT_CATEGORIES: TicketAttachmentCategory[] = ['Inspection', 'Proof', 'Reference'];

const MAX_DATA_URL_CHARS = 780_000;
const MAX_PDF_BYTES = 560 * 1024;

function ticketKey(t: SupportTicketDoc): string {
  return `KEJ-${t.ticketNumber}`;
}

function statusName(s: TicketStatus): string {
  return STATUS_LIST.find(([k]) => k === s)?.[1] || s;
}

function typeInfo(k: string): [string, string, string] {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_TYPES, k)) {
    return BUILTIN_TYPES[k];
  }
  const clean = String(k || 'Task');
  return [clean, '#6b7488', clean.charAt(0).toUpperCase() || 'T'];
}

function initialsOf(name: string): string {
  if (!name) return '–';
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatBytes(n: number): string {
  if (n > 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function localDateTimeOffset(daysOffset = 0, hours?: number, mins?: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const p = (n: number) => String(n).padStart(2, '0');
  const hh = hours !== undefined ? hours : d.getHours();
  const mm = mins !== undefined ? mins : d.getMinutes();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hh)}:${p(mm)}`;
}

function formatIncidentDT(iso?: string, short = false): string {
  if (!iso) return '–';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(
    'en-IN',
    short
      ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
      : { dateStyle: 'medium', timeStyle: 'short' }
  );
}

function nowReadable(): string {
  return new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function pctStr(v: number, total: number): string {
  return total ? `${Math.round((v / total) * 100)}%` : '0%';
}

function dataUrlToBlob(dataUrl: string, fallbackType: string): Blob {
  const parts = dataUrl.split(',');
  const header = parts[0] || '';
  const mimeMatch = header.match(/data:([^;]+);/);
  const mime = mimeMatch?.[1] || fallbackType || 'application/octet-stream';
  const bin = atob(parts[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    arr[i] = bin.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function compressImageFile(file: File): Promise<{ dataUrl: string; size: number; type: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxSide = 1400;
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          const ratio = Math.min(maxSide / width, maxSide / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Canvas unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.82;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > MAX_DATA_URL_CHARS && quality > 0.35) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > MAX_DATA_URL_CHARS) {
          const scale = 0.65;
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/jpeg', 0.68);
        }
        URL.revokeObjectURL(objectUrl);
        const approxBytes = Math.round(((dataUrl.split(',')[1] || '').length * 3) / 4);
        resolve({ dataUrl, size: approxBytes, type: 'image/jpeg' });
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image'));
    };
    img.src = objectUrl;
  });
}

async function prepareAttachments(
  files: FileList | File[],
  cat: TicketAttachmentCategory,
  onWarn: (msg: string) => void
): Promise<PendingTicketAttachment[]> {
  const out: PendingTicketAttachment[] = [];
  const list = Array.from(files);
  for (const f of list) {
    const isImg = f.type.startsWith('image/');
    const isPdf = f.type === 'application/pdf';
    if (!isImg && !isPdf) {
      onWarn(`${f.name}: only images and PDFs are allowed`);
      continue;
    }
    try {
      if (isPdf) {
        if (f.size > MAX_PDF_BYTES) {
          onWarn(`${f.name}: PDF must be 550 KB or smaller to store directly on a ticket`);
          continue;
        }
        const data = await readFileAsDataUrl(f);
        if (data.length > MAX_DATA_URL_CHARS) {
          onWarn(`${f.name}: PDF is too large to store directly on a ticket`);
          continue;
        }
        out.push({ name: f.name, type: f.type, size: f.size, cat, data });
      } else {
        let data = await readFileAsDataUrl(f);
        let size = f.size;
        let type = f.type;
        if (data.length > MAX_DATA_URL_CHARS) {
          const compressed = await compressImageFile(f);
          data = compressed.dataUrl;
          size = compressed.size;
          type = compressed.type;
        }
        if (data.length > MAX_DATA_URL_CHARS) {
          onWarn(`${f.name}: image is too large even after compression`);
          continue;
        }
        out.push({ name: f.name, type, size, cat, data });
      }
    } catch {
      onWarn(`Could not read ${f.name}`);
    }
  }
  return out;
}

interface ConfirmDialogState {
  message: string;
  confirmWord?: string;
  onConfirm: () => Promise<void> | void;
}

interface DonutSlice {
  n: string;
  v: number;
  c: string;
}

const DonutChart: React.FC<{ slices: DonutSlice[]; total: number }> = ({ slices, total }) => {
  const r = 42;
  const C = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg viewBox="0 0 120 120" width="124" height="124" role="img" aria-label={`Share of ${total} tickets`}>
      <circle cx="60" cy="60" r={r} fill="none" style={{ stroke: 'var(--bd)' }} strokeWidth="16" />
      {total > 0 &&
        slices
          .filter((s) => s.v > 0)
          .map((s) => {
            const len = (s.v / total) * C;
            const currentOffset = offset;
            offset += len;
            return (
              <circle
                key={s.n}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={s.c}
                strokeWidth="16"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-currentOffset}
                transform="rotate(-90 60 60)"
              >
                <title>{`${s.n}: ${s.v} (${pctStr(s.v, total)})`}</title>
              </circle>
            );
          })}
      <text x="60" y="59" textAnchor="middle" fontSize="22" fontWeight="700" style={{ fill: 'var(--tx)' }}>
        {total}
      </text>
      <text x="60" y="75" textAnchor="middle" fontSize="10" style={{ fill: 'var(--mut)' }}>
        tickets
      </text>
    </svg>
  );
};

export const TicketsView: React.FC<TicketsViewProps> = ({
  me,
  currentUid,
  isDev,
  isAdmin,
  directory,
  tickets,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<TicketTab>('list');
  const [searchQ, setSearchQ] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPri, setFilterPri] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterMine, setFilterMine] = useState(false);
  const [mobileBoardStatus, setMobileBoardStatus] = useState<TicketStatus>('created');

  // Drag & drop state
  const [dragTicketId, setDragTicketId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TicketStatus | null>(null);

  // Locally added custom types before first save
  const [extraCustomTypes, setExtraCustomTypes] = useState<string[]>([]);

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('task');
  const [newTypeCustom, setNewTypeCustom] = useState('');
  const [newPri, setNewPri] = useState<Priority>('Medium');
  const [newAssignee, setNewAssignee] = useState(me.name);
  const [newIncident, setNewIncident] = useState(() => localDateTimeOffset());
  const [newLabels, setNewLabels] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAttCat, setNewAttCat] = useState<TicketAttachmentCategory>('Proof');
  const [pendingAtts, setPendingAtts] = useState<PendingTicketAttachment[]>([]);
  const [createBusy, setCreateBusy] = useState(false);

  // Detail drawer state
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [detailAttachments, setDetailAttachments] = useState<TicketAttachmentDoc[]>([]);
  const [loadingAtts, setLoadingAtts] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editLabels, setEditLabels] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editTypeAdding, setEditTypeAdding] = useState(false);
  const [editTypeCustom, setEditTypeCustom] = useState('');
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [newCommentText, setNewCommentText] = useState('');
  const [uploadCat, setUploadCat] = useState<TicketAttachmentCategory>('Proof');
  const [detailBusy, setDetailBusy] = useState(false);
  const detailFileInputRef = useRef<HTMLInputElement>(null);

  // Attachment preview lightbox
  const [previewAtt, setPreviewAtt] = useState<TicketAttachmentDoc | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);

  // Confirm dialog
  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Excel export state
  const [exportingExcel, setExportingExcel] = useState(false);

  // Sorted tickets (newest ticketNumber first in list, consistent order)
  const sortedTickets = useMemo(() => {
    return [...tickets].sort((a, b) => b.ticketNumber - a.ticketNumber);
  }, [tickets]);

  // Active employee names from KEJMIN OPS directory + any historical assignees on tickets
  const userNames = useMemo(() => {
    const names = new Set<string>();
    directory
      .filter((d) => d.active)
      .forEach((d) => {
        if (d.name) names.add(d.name);
      });
    if (me.name) names.add(me.name);
    tickets.forEach((t) => {
      if (t.assignee) names.add(t.assignee);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [directory, me.name, tickets]);

  // Discover all custom ticket types from existing tickets + locally added
  const customTypes = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      if (t.type && !Object.prototype.hasOwnProperty.call(BUILTIN_TYPES, t.type)) {
        set.add(t.type);
      }
    });
    extraCustomTypes.forEach((c) => {
      if (c && !Object.prototype.hasOwnProperty.call(BUILTIN_TYPES, c)) {
        set.add(c);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tickets, extraCustomTypes]);

  const normalizeType = (raw: string): string => {
    const trimmed = raw.trim().slice(0, 30);
    if (!trimmed) return '';
    const lc = trimmed.toLowerCase();
    const builtinKey = Object.keys(BUILTIN_TYPES).find(
      (k) => k === lc || BUILTIN_TYPES[k][0].toLowerCase() === lc
    );
    if (builtinKey) return builtinKey;
    const existingCustom = customTypes.find((c) => c.toLowerCase() === lc);
    if (existingCustom) return existingCustom;
    setExtraCustomTypes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    return trimmed;
  };

  // Selected ticket live object
  const selectedTicket = useMemo(
    () => (selectedTicketId ? tickets.find((t) => t.ticketId === selectedTicketId) || null : null),
    [selectedTicketId, tickets]
  );

  // Sync local editable fields when switching or receiving updates for selectedTicket
  useEffect(() => {
    if (!selectedTicket) return;
    setEditTitle(selectedTicket.title);
    setEditLabels((selectedTicket.labels || []).join(', '));
    setEditDesc(selectedTicket.desc || '');
    setEditTypeAdding(false);
    setEditTypeCustom('');
  }, [selectedTicket?.ticketId, selectedTicket?.title, selectedTicket?.desc, selectedTicket?.labels]);

  // Subscribe to attachments ONLY for the currently open ticket
  useEffect(() => {
    if (!selectedTicketId) {
      setDetailAttachments([]);
      setLoadingAtts(false);
      return;
    }
    setLoadingAtts(true);
    const unsub = subscribeTicketAttachments(selectedTicketId, (items) => {
      setDetailAttachments(items);
      setLoadingAtts(false);
    });
    return () => unsub();
  }, [selectedTicketId]);

  // Manage PDF blob URL for preview lightbox
  useEffect(() => {
    if (!previewAtt) {
      setPreviewBlobUrl(null);
      return;
    }
    if (previewAtt.type === 'application/pdf') {
      const blob = dataUrlToBlob(previewAtt.data, previewAtt.type);
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewBlobUrl(previewAtt.data);
  }, [previewAtt]);

  // Escape key closes top-most overlay cleanly
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmState) {
        setConfirmState(null);
      } else if (previewAtt) {
        setPreviewAtt(null);
      } else if (showCreate) {
        setShowCreate(false);
      } else if (selectedTicketId) {
        setSelectedTicketId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState, previewAtt, showCreate, selectedTicketId]);

  // Summary stats (computed on all tickets, matching reference)
  const todayIsoDate = localDateTimeOffset(0).slice(0, 10);
  const stats = useMemo(() => {
    return [
      { label: 'Open', value: tickets.filter((t) => t.status !== 'closed').length },
      { label: 'On review', value: tickets.filter((t) => t.status === 'review').length },
      {
        label: 'Reported today',
        value: tickets.filter((t) => (t.incident || '').slice(0, 10) === todayIsoDate).length,
      },
      { label: 'Closed', value: tickets.filter((t) => t.status === 'closed').length },
    ];
  }, [tickets, todayIsoDate]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return sortedTickets.filter((t) => {
      if (q) {
        const hay = `${t.title} ${ticketKey(t)} ${(t.labels || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterType && t.type !== filterType) return false;
      if (filterPri && t.pri !== filterPri) return false;
      if (filterAssignee) {
        if (filterAssignee === '_') {
          if (t.assignee) return false;
        } else if (t.assignee !== filterAssignee) {
          return false;
        }
      }
      if (filterMine && t.assignee !== me.name) return false;
      return true;
    });
  }, [sortedTickets, searchQ, filterType, filterPri, filterAssignee, filterMine, me.name]);

  const hasActiveFilters = Boolean(searchQ || filterType || filterPri || filterAssignee || filterMine);

  const clearFilters = () => {
    setSearchQ('');
    setFilterType('');
    setFilterPri('');
    setFilterAssignee('');
    setFilterMine(false);
  };

  const openCreateModal = () => {
    setNewTitle('');
    setNewType('task');
    setNewTypeCustom('');
    setNewPri('Medium');
    setNewAssignee(me.name);
    setNewIncident(localDateTimeOffset());
    setNewLabels('');
    setNewDesc('');
    setNewAttCat('Proof');
    setPendingAtts([]);
    setShowCreate(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) {
      onToast('Add a summary to create the ticket');
      return;
    }
    if (!newIncident) {
      onToast('Add the incident date and time');
      return;
    }
    let finalType = newType;
    if (finalType === '__new') {
      finalType = normalizeType(newTypeCustom);
      if (!finalType) {
        onToast('Type the new task type');
        return;
      }
    }

    const maxNum = tickets.reduce((m, t) => Math.max(m, t.ticketNumber || 0), 0);
    setCreateBusy(true);
    try {
      const created = await createSupportTicket({
        title: cleanTitle,
        desc: newDesc,
        type: finalType,
        pri: newPri,
        assignee: newAssignee,
        incident: newIncident,
        labels: newLabels
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        pendingAttachments: pendingAtts,
        nextTicketNumber: maxNum + 1,
        actor: me,
      });
      setShowCreate(false);
      onToast(`KEJ-${created.ticketNumber} created`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create ticket';
      onToast(msg);
    } finally {
      setCreateBusy(false);
    }
  };

  const handleMoveStatus = async (ticket: SupportTicketDoc, nextStatus: TicketStatus) => {
    if (ticket.status === nextStatus) return;
    try {
      await updateSupportTicket({
        ticket,
        patch: { status: nextStatus },
        logMessage: `Status changed from ${statusName(ticket.status)} to ${statusName(nextStatus)}`,
        actor: me,
      });
      onToast(`${ticketKey(ticket)} moved to ${statusName(nextStatus)}`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update ticket status');
    }
  };

  const isLockedClosed = Boolean(selectedTicket && selectedTicket.status === 'closed' && !isAdmin);

  const handleDetailFieldChange = async (
    field: 'status' | 'pri' | 'assignee' | 'incident' | 'desc' | 'title' | 'labels' | 'type',
    label: string,
    nextVal: string | string[],
    prevVal: string | string[]
  ) => {
    if (!selectedTicket) return;
    const prevStr = Array.isArray(prevVal) ? prevVal.join(', ') : prevVal;
    const nextStr = Array.isArray(nextVal) ? nextVal.join(', ') : nextVal;
    if (prevStr === nextStr) return;

    const patch: Record<string, unknown> = { [field]: nextVal };
    const logMessage =
      field === 'title'
        ? 'Summary updated'
        : field === 'status'
          ? `Status changed from ${statusName(prevVal as TicketStatus)} to ${statusName(nextVal as TicketStatus)}`
          : field === 'type'
            ? `Type changed from ${typeInfo(String(prevVal))[0]} to ${typeInfo(String(nextVal))[0]}`
            : `${label} changed from ${prevStr || 'none'} to ${nextStr || 'none'}`;

    setDetailBusy(true);
    try {
      await updateSupportTicket({
        ticket: selectedTicket,
        patch,
        logMessage,
        actor: me,
      });
      if (field === 'status') {
        onToast(`${ticketKey(selectedTicket)} moved to ${statusName(nextVal as TicketStatus)}`);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update ticket');
    } finally {
      setDetailBusy(false);
    }
  };

  const handleToggleSubtask = async (idx: number, checked: boolean) => {
    if (!selectedTicket || isLockedClosed) return;
    const nextSubs: TicketSubtask[] = (selectedTicket.subs || []).map((s, i) =>
      i === idx ? { ...s, d: checked } : s
    );
    try {
      await updateSupportTicket({
        ticket: selectedTicket,
        patch: { subs: nextSubs },
        actor: me,
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update subtask');
    }
  };

  const handleAddSubtask = async () => {
    if (!selectedTicket || isLockedClosed) return;
    const text = newSubtaskText.trim();
    if (!text) return;
    const nextSubs: TicketSubtask[] = [
      ...(selectedTicket.subs || []),
      { id: Math.random().toString(36).slice(2, 10), t: text.slice(0, 200), d: false },
    ].slice(0, 50);
    setNewSubtaskText('');
    try {
      await updateSupportTicket({
        ticket: selectedTicket,
        patch: { subs: nextSubs },
        logMessage: `Subtask added: ${text.slice(0, 120)}`,
        actor: me,
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not add subtask');
    }
  };

  const handleAddComment = async () => {
    if (!selectedTicket) return;
    const text = newCommentText.trim();
    if (!text) {
      onToast('Write a comment first');
      return;
    }
    const nextComments: TicketComment[] = [
      ...(selectedTicket.comments || []),
      {
        id: Math.random().toString(36).slice(2, 10),
        u: me.name,
        empId: me.empId,
        t: text.slice(0, 1500),
        at: nowReadable(),
      },
    ].slice(0, 100);
    setNewCommentText('');
    try {
      await updateSupportTicket({
        ticket: selectedTicket,
        patch: { comments: nextComments },
        logMessage: 'Comment added',
        actor: me,
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not add comment');
    }
  };

  const handleDownloadAttachment = (att: TicketAttachmentDoc) => {
    const blob = dataUrlToBlob(att.data, att.type);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = att.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleDetailUploadFiles = async (files: FileList | null) => {
    if (!selectedTicket || !files || files.length === 0) return;
    const prepared = await prepareAttachments(files, uploadCat, onToast);
    if (!prepared.length) return;
    setDetailBusy(true);
    try {
      await addTicketAttachments({
        ticket: selectedTicket,
        files: prepared,
        actor: me,
      });
      onToast(`File added to ${uploadCat}`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not upload file');
    } finally {
      setDetailBusy(false);
    }
  };

  const askConfirm = (message: string, onConfirm: () => Promise<void> | void, confirmWord?: string) => {
    setConfirmInput('');
    setConfirmState({ message, onConfirm, confirmWord });
  };

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const L = filteredTickets;
      const allAtts = await fetchAllTicketAttachments();
      const ticketMap = new Map(L.map((t) => [t.ticketId, t]));
      const visibleAtts = allAtts.filter((a) => ticketMap.has(a.ticketId));
      const allTypeKeys = [...Object.keys(BUILTIN_TYPES), ...customTypes];

      const wb = XLSX.utils.book_new();

      const sum: (string | number)[][] = [
        ['KEJMIN OPS – Ticket report'],
        ['Generated', nowReadable()],
        ['Total tickets', L.length],
        [],
        ['Status', 'Tickets'],
        ...STATUS_LIST.map(([k, lbl]) => [lbl, L.filter((t) => t.status === k).length]),
        [],
        ['Priority', 'Tickets'],
        ...PRIORITIES.map((p) => [p, L.filter((t) => t.pri === p).length]),
        [],
        ['Assignee', 'Tickets'],
        ...['', ...userNames].map((u) => [u || 'Unassigned', L.filter((t) => (t.assignee || '') === u).length]),
        [],
        ['Type', 'Tickets'],
        ...allTypeKeys.map((k) => [typeInfo(k)[0], L.filter((t) => t.type === k).length]),
      ];

      const tk: (string | number)[][] = [
        [
          'Ticket',
          'Summary',
          'Type',
          'Priority',
          'Status',
          'Assignee',
          'Reporter',
          'Incident date & time',
          'Labels',
          'Description',
          'Subtasks done',
          'Subtasks total',
          'Comments',
          'Attachments',
        ],
        ...L.map((t) => [
          ticketKey(t),
          t.title,
          typeInfo(t.type)[0],
          t.pri,
          statusName(t.status),
          t.assignee || 'Unassigned',
          t.reporter,
          t.incident ? formatIncidentDT(t.incident) : '',
          (t.labels || []).join(', '),
          t.desc || '',
          (t.subs || []).filter((s) => s.d).length,
          (t.subs || []).length,
          (t.comments || []).length,
          t.attachmentCount || 0,
        ]),
      ];

      const cm: (string | number)[][] = [['Ticket', 'Author', 'Date', 'Comment']];
      L.forEach((t) => (t.comments || []).forEach((c) => cm.push([ticketKey(t), c.u, c.at, c.t])));

      const lg: (string | number)[][] = [['Ticket', 'Date', 'Activity']];
      L.forEach((t) => (t.log || []).forEach((l) => lg.push([ticketKey(t), l.at, l.t])));

      const at: (string | number)[][] = [
        ['Ticket', 'Category', 'File name', 'File type', 'Size (KB)', 'Uploaded by', 'Uploaded at'],
      ];
      visibleAtts.forEach((a) => {
        const parent = ticketMap.get(a.ticketId);
        if (!parent) return;
        at.push([ticketKey(parent), a.cat, a.name, a.type, Math.round(a.size / 1024), a.by, a.at]);
      });

      const sheets: Array<[string, (string | number)[][], number[]]> = [
        ['Summary', sum, [28, 16]],
        ['Tickets', tk, [10, 40, 16, 10, 20, 20, 20, 24, 22, 50, 13, 13, 10, 12]],
        ['Comments', cm, [10, 20, 22, 60]],
        ['Activity', lg, [10, 22, 70]],
        ['Attachments', at, [10, 14, 36, 18, 10, 20, 22]],
      ];
      sheets.forEach(([name, data, widths]) => {
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = widths.map((wch) => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, name);
      });

      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `KEJMIN-ticket-report-${todayIsoDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      onToast('Excel ticket report downloaded');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to export Excel report');
    } finally {
      setExportingExcel(false);
    }
  };

  // Report computations for Reports tab
  const reportData = useMemo(() => {
    const L = filteredTickets;
    const total = L.length;
    const byStatus = STATUS_LIST.map(([k, n]) => ({
      k,
      n,
      v: L.filter((t) => t.status === k).length,
      c: STATUS_COLORS[k],
    }));
    const byPriority: DonutSlice[] = PRIORITIES.map((p) => ({
      n: p,
      v: L.filter((t) => t.pri === p).length,
      c: PRIORITY_COLORS[p],
    }));
    const allTypes = [...Object.keys(BUILTIN_TYPES), ...customTypes];
    const byType: DonutSlice[] = allTypes.map((k) => {
      const info = typeInfo(k);
      return {
        n: info[0],
        v: L.filter((t) => t.type === k).length,
        c: info[1],
      };
    });
    const byAssignee = ['', ...userNames].map((u) => ({
      n: u || 'Unassigned',
      u,
      v: L.filter((t) => (t.assignee || '') === u).length,
    }));
    const maxAssignee = Math.max(1, ...byAssignee.map((a) => a.v));

    const days = [6, 5, 4, 3, 2, 1, 0].map((offset) => {
      const isoDay = localDateTimeOffset(-offset, 0, 0).slice(0, 10);
      return {
        key: isoDay,
        v: L.filter((t) => (t.incident || '').slice(0, 10) === isoDay).length,
        label: new Date(`${isoDay}T00:00`).toLocaleDateString('en-IN', {
          weekday: 'short',
          day: 'numeric',
        }),
      };
    });
    const maxDay = Math.max(1, ...days.map((d) => d.v));

    return { total, byStatus, byPriority, byType, byAssignee, maxAssignee, days, maxDay };
  }, [filteredTickets, customTypes, userNames]);

  const canDeleteSelected = Boolean(
    selectedTicket && (isAdmin || selectedTicket.reporterUid === currentUid)
  );

  const renderTypeBadge = (typeKey: string) => {
    const [label, color, glyph] = typeInfo(typeKey);
    return (
      <span className="tkt-ty" style={{ background: color }} title={label}>
        {glyph}
      </span>
    );
  };

  const renderAvatar = (name: string) => (
    <span className={`tkt-av${name ? '' : ' u'}`} title={name || 'Unassigned'}>
      {initialsOf(name)}
    </span>
  );

  const renderBoardCard = (t: SupportTicketDoc) => (
    <div
      key={t.ticketId}
      className={`tkt-card${dragTicketId === t.ticketId ? ' drag' : ''}`}
      draggable
      onClick={() => setSelectedTicketId(t.ticketId)}
      onDragStart={() => setDragTicketId(t.ticketId)}
      onDragEnd={() => {
        setDragTicketId(null);
        setDragOverStatus(null);
      }}
    >
      <p>{t.title}</p>
      {(t.labels || []).length > 0 && (
        <div className="tkt-card-lbls">
          {t.labels.map((l, idx) => (
            <span key={`${l}-${idx}`} className="tkt-lbl">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="tkt-meta">
        {renderTypeBadge(t.type)}
        <span className="tkt-num">{ticketKey(t)}</span>
        <span className="tkt-pri" style={{ color: PRIORITY_COLORS[t.pri] }}>
          {t.pri}
        </span>
        <span className="tkt-sp" />
        {renderAvatar(t.assignee)}
      </div>
      {((t.attachmentCount || 0) > 0 || t.incident) && (
        <div className="tkt-meta m2">
          {(t.attachmentCount || 0) > 0 && (
            <span className="tkt-pts" title="Attachments">
              {t.attachmentCount} file{t.attachmentCount > 1 ? 's' : ''}
            </span>
          )}
          {t.incident && <span title="Incident date and time">{formatIncidentDT(t.incident, true)}</span>}
        </div>
      )}
    </div>
  );

  return (
    <div className="view on" id="v-tickets">
      {/* Top Action Header */}
      <div className="tkt-top">
        <div>
          <h1>Tickets</h1>
          <small>
            {me.role} · {me.location}
          </small>
        </div>
        <div className="tkt-top-r">
          {isDev && (
            <button
              type="button"
              className="tkt-btn d"
              onClick={() =>
                askConfirm(
                  'This permanently deletes all tickets, comments, attachments and activity history. This cannot be undone.',
                  async () => {
                    await clearAllSupportTickets(me);
                    setSelectedTicketId(null);
                    onToast('All tickets and records deleted');
                  },
                  'DELETE'
                )
              }
            >
              Clear all data
            </button>
          )}
          <button type="button" className="tkt-btn p" onClick={openCreateModal}>
            + Create ticket
          </button>
        </div>
      </div>

      {/* 4 Summary KPI Stat Cards */}
      <div className="tkt-stats">
        {stats.map((s) => (
          <div key={s.label} className="tkt-stat">
            <span>{s.label}</span>
            <b>{s.value}</b>
          </div>
        ))}
      </div>

      {/* Tabs: List | Board | Reports */}
      <div className="tkt-tabs" role="tablist" aria-label="Ticket views">
        {(
          [
            ['list', 'List'],
            ['board', 'Board'],
            ['rep', 'Reports'],
          ] as Array<[TicketTab, string]>
        ).map(([tabKey, tabLabel]) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={activeTab === tabKey}
            className={`tkt-tab${activeTab === tabKey ? ' on' : ''}`}
            onClick={() => setActiveTab(tabKey)}
          >
            {tabLabel}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="tkt-filters">
        <input
          type="search"
          placeholder="Search tickets or labels"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {Object.entries(BUILTIN_TYPES).map(([k, [lbl]]) => (
            <option key={k} value={k}>
              {lbl}
            </option>
          ))}
          {customTypes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={filterPri} onChange={(e) => setFilterPri(e.target.value)} aria-label="Filter by priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          aria-label="Filter by assignee"
        >
          <option value="">All assignees</option>
          <option value="_">Unassigned</option>
          {userNames.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`tkt-btn${filterMine ? ' p' : ''}`}
          onClick={() => setFilterMine((v) => !v)}
        >
          My tickets
        </button>
        <button type="button" className="tkt-btn" onClick={clearFilters} disabled={!hasActiveFilters}>
          Clear
        </button>
      </div>

      {/* LIST VIEW */}
      {activeTab === 'list' && (
        <>
          {filteredTickets.length === 0 ? (
            <div className="tkt-empty">
              <p>
                {tickets.length === 0
                  ? 'No support tickets yet. Create your first ticket to start tracking issues.'
                  : 'No tickets match these filters. Clear filters or create a ticket.'}
              </p>
              <div className="tkt-empty-acts">
                {hasActiveFilters && (
                  <button type="button" className="tkt-btn" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
                <button type="button" className="tkt-btn p" onClick={openCreateModal}>
                  + Create ticket
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="tkt-wrap tkt-desk-only">
                <table className="tkt-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Summary</th>
                      <th>Type</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Assignee</th>
                      <th>Incident date &amp; time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTickets.map((t) => (
                      <tr key={t.ticketId} onClick={() => setSelectedTicketId(t.ticketId)}>
                        <td className="tkt-num">{ticketKey(t)}</td>
                        <td className="tkt-sum-cell">{t.title}</td>
                        <td>
                          <span className="tkt-ty-cell">
                            {renderTypeBadge(t.type)} {typeInfo(t.type)[0]}
                          </span>
                        </td>
                        <td style={{ color: PRIORITY_COLORS[t.pri], fontWeight: 600 }}>{t.pri}</td>
                        <td>{statusName(t.status)}</td>
                        <td>{t.assignee || 'Unassigned'}</td>
                        <td className="tkt-num">{formatIncidentDT(t.incident)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Android-App Stacked Card List */}
              <div className="tkt-m-list tkt-mob-only">
                {filteredTickets.map((t) => (
                  <button
                    key={t.ticketId}
                    type="button"
                    className="tkt-m-card"
                    onClick={() => setSelectedTicketId(t.ticketId)}
                  >
                    <div className="tkt-m-top">
                      <span className="tkt-m-key">
                        {renderTypeBadge(t.type)}
                        <span>{ticketKey(t)}</span>
                      </span>
                      <span className="tkt-m-st" style={{ color: STATUS_COLORS[t.status] }}>
                        {statusName(t.status)}
                      </span>
                    </div>
                    <div className="tkt-m-title">{t.title}</div>
                    {(t.labels || []).length > 0 && (
                      <div className="tkt-card-lbls">
                        {t.labels.map((l, idx) => (
                          <span key={`${l}-${idx}`} className="tkt-lbl">
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="tkt-m-foot">
                      <span className="tkt-pri" style={{ color: PRIORITY_COLORS[t.pri] }}>
                        {t.pri}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{t.assignee || 'Unassigned'}</span>
                      {(t.attachmentCount || 0) > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {t.attachmentCount} file{t.attachmentCount > 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                      <span className="tkt-sp" />
                      <span className="tkt-num">{formatIncidentDT(t.incident, true)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* BOARD VIEW (KANBAN) */}
      {activeTab === 'board' && (
        <>
          {/* Mobile status selector strip for Android ergonomics */}
          <div className="tkt-m-bnav tkt-mob-only" role="tablist" aria-label="Board status columns">
            {STATUS_LIST.map(([stKey, stLabel]) => {
              const count = filteredTickets.filter((t) => t.status === stKey).length;
              return (
                <button
                  key={stKey}
                  type="button"
                  role="tab"
                  aria-selected={mobileBoardStatus === stKey}
                  className={`tkt-m-btab${mobileBoardStatus === stKey ? ' on' : ''}`}
                  onClick={() => setMobileBoardStatus(stKey)}
                >
                  <span>{stLabel}</span>
                  <b>{count}</b>
                </button>
              );
            })}
          </div>

          <div className="tkt-board">
            {STATUS_LIST.map(([stKey, stLabel]) => {
              const colTickets = filteredTickets.filter((t) => t.status === stKey);
              return (
                <div
                  key={stKey}
                  className={`tkt-col${dragOverStatus === stKey ? ' over' : ''}${
                    mobileBoardStatus === stKey ? ' m-on' : ''
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverStatus !== stKey) setDragOverStatus(stKey);
                  }}
                  onDragLeave={() => {
                    if (dragOverStatus === stKey) setDragOverStatus(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverStatus(null);
                    if (!dragTicketId) return;
                    const dragged = tickets.find((x) => x.ticketId === dragTicketId);
                    setDragTicketId(null);
                    if (dragged) {
                      void handleMoveStatus(dragged, stKey);
                    }
                  }}
                >
                  <h3>
                    <span>{stLabel}</span>
                    <i>{colTickets.length}</i>
                  </h3>
                  {colTickets.length > 0 ? (
                    colTickets.map(renderBoardCard)
                  ) : (
                    <div className="tkt-meta" style={{ padding: 8 }}>
                      No tickets
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* REPORTS VIEW */}
      {activeTab === 'rep' && (
        <div className="tkt-reports">
          <div className="tkt-rhead">
            <div>
              <h3>Ticket report</h3>
              <small>
                {reportData.total} ticket{reportData.total === 1 ? '' : 's'} in this view
              </small>
            </div>
            <button
              type="button"
              className="tkt-btn p"
              disabled={exportingExcel}
              onClick={() => void handleExportExcel()}
            >
              {exportingExcel ? 'Preparing Excel…' : 'Download Excel report'}
            </button>
          </div>

          <div className="tkt-rgrid">
            {/* Ticket progress (full-width card) */}
            <div className="tkt-rc wide">
              <h4>Ticket progress</h4>
              <div className="tkt-seg">
                {reportData.byStatus.some((p) => p.v > 0) ? (
                  reportData.byStatus
                    .filter((p) => p.v > 0)
                    .map((p) => (
                      <i
                        key={p.k}
                        style={{ flex: p.v, background: p.c }}
                        title={`${p.n}: ${p.v}`}
                      />
                    ))
                ) : (
                  <i style={{ flex: 1, background: 'var(--bd)' }} />
                )}
              </div>
              <div className="tkt-tiles">
                {reportData.byStatus.map((p) => (
                  <div key={p.k} className="tkt-tile">
                    <i style={{ background: p.c }} />
                    <b className="tkt-num">{p.v}</b>
                    <span>{p.n}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* By priority */}
            <div className="tkt-rc">
              <h4>By priority</h4>
              <div className="tkt-dn">
                <DonutChart slices={reportData.byPriority} total={reportData.total} />
                <div className="tkt-lgd">
                  {reportData.byPriority.map((p) => (
                    <div key={p.n}>
                      <i style={{ background: p.c }} />
                      <span>{p.n}</span>
                      <b className="tkt-num">{p.v}</b>
                      <em className="tkt-num">{pctStr(p.v, reportData.total)}</em>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* By type */}
            <div className="tkt-rc">
              <h4>By type</h4>
              <div className="tkt-dn">
                <DonutChart slices={reportData.byType} total={reportData.total} />
                <div className="tkt-lgd">
                  {reportData.byType.map((p) => (
                    <div key={p.n}>
                      <i style={{ background: p.c }} />
                      <span>{p.n}</span>
                      <b className="tkt-num">{p.v}</b>
                      <em className="tkt-num">{pctStr(p.v, reportData.total)}</em>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* By assignee */}
            <div className="tkt-rc">
              <h4>By assignee</h4>
              {reportData.byAssignee.map((a) => (
                <div key={a.n} className="tkt-ar">
                  {renderAvatar(a.u)}
                  <div className="tkt-an">
                    <span>{a.n}</span>
                    <div className="tkt-tr">
                      <i style={{ width: `${(a.v / reportData.maxAssignee) * 100}%` }} />
                    </div>
                  </div>
                  <b className="tkt-num">{a.v}</b>
                </div>
              ))}
            </div>

            {/* Incidents in the last 7 days */}
            <div className="tkt-rc">
              <h4>Incidents in the last 7 days</h4>
              <div className="tkt-cols">
                {reportData.days.map((d) => (
                  <div
                    key={d.key}
                    className="tkt-cl"
                    title={`${d.label}: ${d.v} incident${d.v === 1 ? '' : 's'}`}
                  >
                    <b className="tkt-num">{d.v}</b>
                    <div className="tkt-cb">
                      <i style={{ height: `${(d.v / reportData.maxDay) * 100}%` }} />
                    </div>
                    <span>{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE TICKET MODAL */}
      {showCreate &&
        createPortal(
          <div
            className="tkt-ov mid"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tkt-create-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !createBusy) setShowCreate(false);
            }}
          >
            <form className="tkt-panel" onSubmit={(e) => void handleCreateSubmit(e)}>
              <h2 id="tkt-create-title">Create ticket</h2>
              <div className="tkt-grid">
                <div className="tkt-f full">
                  <label htmlFor="tkt_n_t">Summary *</label>
                  <input
                    id="tkt_n_t"
                    placeholder="What needs to be done?"
                    maxLength={160}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_n_ty">Type</label>
                  <select
                    id="tkt_n_ty"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                  >
                    {Object.entries(BUILTIN_TYPES).map(([k, [lbl]]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                    {customTypes.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value="__new">+ Add new type…</option>
                  </select>
                  {newType === '__new' && (
                    <input
                      placeholder="Type the new task type"
                      maxLength={30}
                      value={newTypeCustom}
                      onChange={(e) => setNewTypeCustom(e.target.value)}
                      style={{ marginTop: 6 }}
                      autoFocus
                    />
                  )}
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_n_pr">Priority</label>
                  <select
                    id="tkt_n_pr"
                    value={newPri}
                    onChange={(e) => setNewPri(e.target.value as Priority)}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_n_as">Assignee</label>
                  <select
                    id="tkt_n_as"
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {userNames.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_n_d">Incident date &amp; time *</label>
                  <input
                    id="tkt_n_d"
                    type="datetime-local"
                    value={newIncident}
                    max={localDateTimeOffset()}
                    onChange={(e) => setNewIncident(e.target.value)}
                  />
                </div>

                <div className="tkt-f full">
                  <label htmlFor="tkt_n_l">Labels (comma separated)</label>
                  <input
                    id="tkt_n_l"
                    placeholder="ui, attendance"
                    value={newLabels}
                    onChange={(e) => setNewLabels(e.target.value)}
                  />
                </div>

                <div className="tkt-f full">
                  <label htmlFor="tkt_n_ds">Description</label>
                  <textarea
                    id="tkt_n_ds"
                    maxLength={4000}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>

                <div className="tkt-f full">
                  <label htmlFor="tkt_n_f">Attachments (images or PDF)</label>
                  <div className="tkt-row">
                    <select
                      value={newAttCat}
                      onChange={(e) => setNewAttCat(e.target.value as TicketAttachmentCategory)}
                      style={{ flex: 'none', width: 130 }}
                      aria-label="Attachment category"
                    >
                      {ATTACHMENT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <input
                      id="tkt_n_f"
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={async (e) => {
                        if (!e.target.files) return;
                        const prepared = await prepareAttachments(e.target.files, newAttCat, onToast);
                        e.target.value = '';
                        if (prepared.length) {
                          setPendingAtts((prev) => [...prev, ...prepared].slice(0, 20));
                        }
                      }}
                    />
                  </div>
                  {pendingAtts.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {pendingAtts.map((a, idx) => (
                        <div key={`${a.name}-${idx}`} className="tkt-at">
                          <div className="tkt-th">{a.type.startsWith('image/') ? 'IMG' : 'PDF'}</div>
                          <div className="tkt-at-nm">
                            <b>{a.name}</b>
                            <small>
                              {a.cat} · {formatBytes(a.size)}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="tkt-btn d"
                            onClick={() =>
                              setPendingAtts((prev) => prev.filter((_, i) => i !== idx))
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="tkt-row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="tkt-btn"
                  disabled={createBusy}
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="tkt-btn p" disabled={createBusy}>
                  {createBusy ? 'Creating…' : 'Create ticket'}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* TICKET DETAIL SLIDE-OVER DRAWER */}
      {selectedTicket &&
        createPortal(
          <div
            className="tkt-ov"
            role="dialog"
            aria-modal="true"
            aria-label={`Ticket ${ticketKey(selectedTicket)}`}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedTicketId(null);
            }}
          >
            <div className="tkt-panel">
              <div className="tkt-meta">
                <span className="tkt-key">
                  {renderTypeBadge(selectedTicket.type)} {ticketKey(selectedTicket)}
                </span>
                <span className="tkt-sp" />
                {canDeleteSelected && (
                  <button
                    type="button"
                    className="tkt-btn d"
                    disabled={detailBusy}
                    onClick={() =>
                      askConfirm(
                        `Delete ${ticketKey(selectedTicket)}? This cannot be undone.`,
                        async () => {
                          await deleteSupportTicket({ ticket: selectedTicket, actor: me });
                          setSelectedTicketId(null);
                          onToast(`${ticketKey(selectedTicket)} deleted`);
                        }
                      )
                    }
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  className="tkt-btn"
                  onClick={() => setSelectedTicketId(null)}
                >
                  Close
                </button>
              </div>

              {/* Inline Editable Summary */}
              <input
                className="tkt-ttl-input"
                value={editTitle}
                maxLength={160}
                disabled={isLockedClosed}
                aria-label="Ticket summary"
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => {
                  const trimmed = editTitle.trim();
                  if (!trimmed) {
                    setEditTitle(selectedTicket.title);
                    return;
                  }
                  if (trimmed !== selectedTicket.title) {
                    void handleDetailFieldChange('title', 'Summary', trimmed, selectedTicket.title);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
              />

              {isLockedClosed && (
                <div className="tkt-closed-note">
                  This ticket is closed. Change Status to <b>Task reopened</b> to edit details or subtasks; comments remain enabled.
                </div>
              )}

              <div className="tkt-grid">
                <div className="tkt-f">
                  <label htmlFor="tkt_d_st">Status</label>
                  <select
                    id="tkt_d_st"
                    value={selectedTicket.status}
                    disabled={detailBusy}
                    onChange={(e) =>
                      void handleDetailFieldChange(
                        'status',
                        'Status',
                        e.target.value,
                        selectedTicket.status
                      )
                    }
                  >
                    {STATUS_LIST.map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_d_pr">Priority</label>
                  <select
                    id="tkt_d_pr"
                    value={selectedTicket.pri}
                    disabled={detailBusy || isLockedClosed}
                    onChange={(e) =>
                      void handleDetailFieldChange('pri', 'Priority', e.target.value, selectedTicket.pri)
                    }
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_d_ty">Type</label>
                  <select
                    id="tkt_d_ty"
                    value={editTypeAdding ? '__new' : selectedTicket.type}
                    disabled={detailBusy || isLockedClosed}
                    onChange={(e) => {
                      if (e.target.value === '__new') {
                        setEditTypeAdding(true);
                        setEditTypeCustom('');
                        return;
                      }
                      setEditTypeAdding(false);
                      void handleDetailFieldChange('type', 'Type', e.target.value, selectedTicket.type);
                    }}
                  >
                    {Object.entries(BUILTIN_TYPES).map(([k, [lbl]]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                    {customTypes.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value="__new">+ Add new type…</option>
                  </select>
                  {editTypeAdding && (
                    <div className="tkt-row" style={{ marginTop: 6 }}>
                      <input
                        placeholder="Type the new task type"
                        maxLength={30}
                        value={editTypeCustom}
                        onChange={(e) => setEditTypeCustom(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const norm = normalizeType(editTypeCustom);
                            if (norm && norm !== selectedTicket.type) {
                              setEditTypeAdding(false);
                              void handleDetailFieldChange('type', 'Type', norm, selectedTicket.type);
                            }
                          }
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="tkt-btn s p"
                        onClick={() => {
                          const norm = normalizeType(editTypeCustom);
                          if (!norm) {
                            setEditTypeAdding(false);
                            return;
                          }
                          setEditTypeAdding(false);
                          if (norm !== selectedTicket.type) {
                            void handleDetailFieldChange('type', 'Type', norm, selectedTicket.type);
                          }
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_d_as">Assignee</label>
                  <select
                    id="tkt_d_as"
                    value={selectedTicket.assignee || ''}
                    disabled={detailBusy || isLockedClosed}
                    onChange={(e) =>
                      void handleDetailFieldChange(
                        'assignee',
                        'Assignee',
                        e.target.value,
                        selectedTicket.assignee || ''
                      )
                    }
                  >
                    <option value="">Unassigned</option>
                    {userNames.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_d_rp">Reporter</label>
                  <input id="tkt_d_rp" value={selectedTicket.reporter} disabled />
                </div>

                <div className="tkt-f">
                  <label htmlFor="tkt_d_d">Incident date &amp; time</label>
                  <input
                    id="tkt_d_d"
                    type="datetime-local"
                    value={selectedTicket.incident || ''}
                    max={localDateTimeOffset()}
                    disabled={detailBusy || isLockedClosed}
                    onChange={(e) =>
                      void handleDetailFieldChange(
                        'incident',
                        'Incident date & time',
                        e.target.value,
                        selectedTicket.incident || ''
                      )
                    }
                  />
                </div>

                <div className="tkt-f full">
                  <label htmlFor="tkt_d_l">Labels (comma separated)</label>
                  <input
                    id="tkt_d_l"
                    value={editLabels}
                    disabled={detailBusy || isLockedClosed}
                    onChange={(e) => setEditLabels(e.target.value)}
                    onBlur={() => {
                      const arr = editLabels
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean);
                      void handleDetailFieldChange(
                        'labels',
                        'Labels',
                        arr,
                        selectedTicket.labels || []
                      );
                    }}
                  />
                </div>

                <div className="tkt-f full">
                  <label htmlFor="tkt_d_ds">Description</label>
                  <textarea
                    id="tkt_d_ds"
                    maxLength={4000}
                    value={editDesc}
                    disabled={detailBusy || isLockedClosed}
                    onChange={(e) => setEditDesc(e.target.value)}
                    onBlur={() => {
                      if (editDesc !== (selectedTicket.desc || '')) {
                        void handleDetailFieldChange(
                          'desc',
                          'Description',
                          editDesc,
                          selectedTicket.desc || ''
                        );
                      }
                    }}
                  />
                </div>
              </div>

              {/* ATTACHMENTS SECTION */}
              <div className="tkt-sec">
                <h4>
                  Attachments ({loadingAtts ? selectedTicket.attachmentCount || 0 : detailAttachments.length})
                </h4>
                {ATTACHMENT_CATEGORIES.map((cat) => {
                  const list = detailAttachments.filter((a) => a.cat === cat);
                  return (
                    <div key={cat} className="tkt-ag">
                      <h5>
                        <span>{cat}</span>
                        <i>{list.length}</i>
                        {!isLockedClosed && (
                          <button
                            type="button"
                            className="tkt-btn"
                            disabled={detailBusy}
                            onClick={() => {
                              setUploadCat(cat);
                              detailFileInputRef.current?.click();
                            }}
                          >
                            Add file
                          </button>
                        )}
                      </h5>
                      {list.length > 0 ? (
                        list.map((a) => {
                          const canRemove =
                            !isLockedClosed &&
                            (isAdmin ||
                              a.byUid === currentUid ||
                              selectedTicket.reporterUid === currentUid);
                          return (
                            <div key={a.attachmentId} className="tkt-at">
                              {a.type.startsWith('image/') ? (
                                <img
                                  className="tkt-th"
                                  src={a.data}
                                  alt={a.name}
                                  referrerPolicy="no-referrer"
                                  onClick={() => setPreviewAtt(a)}
                                />
                              ) : (
                                <div className="tkt-th" onClick={() => setPreviewAtt(a)}>
                                  PDF
                                </div>
                              )}
                              <div className="tkt-at-nm">
                                <b>{a.name}</b>
                                <small>
                                  {formatBytes(a.size)} · {a.by} · {a.at}
                                </small>
                              </div>
                              <button
                                type="button"
                                className="tkt-btn"
                                onClick={() => setPreviewAtt(a)}
                              >
                                View
                              </button>
                              <button
                                type="button"
                                className="tkt-btn"
                                onClick={() => handleDownloadAttachment(a)}
                              >
                                Download
                              </button>
                              {canRemove && (
                                <button
                                  type="button"
                                  className="tkt-btn d"
                                  disabled={detailBusy}
                                  onClick={() =>
                                    askConfirm(`Remove ${a.name}?`, async () => {
                                      await removeTicketAttachment({
                                        ticket: selectedTicket,
                                        attachment: a,
                                        actor: me,
                                      });
                                      onToast(`Removed ${a.name}`);
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <small style={{ color: 'var(--mut)' }}>
                          {loadingAtts
                            ? 'Loading files…'
                            : 'No files yet. Add images or PDFs as evidence.'}
                        </small>
                      )}
                    </div>
                  );
                })}
                <input
                  ref={detailFileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  hidden
                  onChange={(e) => {
                    void handleDetailUploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {/* SUBTASKS SECTION */}
              <div className="tkt-sec">
                <h4>
                  Subtasks ({(selectedTicket.subs || []).filter((s) => s.d).length}/
                  {(selectedTicket.subs || []).length})
                </h4>
                {(selectedTicket.subs || []).map((s, idx) => (
                  <label key={s.id || idx} className={`tkt-sub${s.d ? ' d' : ''}`}>
                    <input
                      type="checkbox"
                      checked={s.d}
                      disabled={isLockedClosed}
                      onChange={(e) => void handleToggleSubtask(idx, e.target.checked)}
                    />
                    <span>{s.t}</span>
                  </label>
                ))}
                {!isLockedClosed && (
                  <div className="tkt-row" style={{ marginTop: 8 }}>
                    <input
                      placeholder="Add a subtask"
                      value={newSubtaskText}
                      maxLength={200}
                      onChange={(e) => setNewSubtaskText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleAddSubtask();
                        }
                      }}
                    />
                    <button type="button" className="tkt-btn" onClick={() => void handleAddSubtask()}>
                      Add subtask
                    </button>
                  </div>
                )}
              </div>

              {/* COMMENTS SECTION */}
              <div className="tkt-sec">
                <h4>Comments ({(selectedTicket.comments || []).length})</h4>
                {(selectedTicket.comments || []).map((c, idx) => (
                  <div key={c.id || idx} className="tkt-cm">
                    {renderAvatar(c.u)}
                    <div>
                      <b>{c.u}</b> <small>{c.at}</small>
                      <p>{c.t}</p>
                    </div>
                  </div>
                ))}
                <div className="tkt-f">
                  <textarea
                    placeholder="Write a comment"
                    value={newCommentText}
                    maxLength={1500}
                    onChange={(e) => setNewCommentText(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="tkt-btn p"
                  style={{ marginTop: 8 }}
                  onClick={() => void handleAddComment()}
                >
                  Add comment
                </button>
              </div>

              {/* ACTIVITY SECTION */}
              <div className="tkt-sec">
                <h4>Activity</h4>
                {(selectedTicket.log || []).map((l, idx) => (
                  <div key={`${l.at}-${idx}`} className="tkt-lg">
                    {l.t} · {l.at}
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ATTACHMENT LIGHTBOX PREVIEW */}
      {previewAtt &&
        createPortal(
          <div
            className="tkt-ov mid"
            style={{ zIndex: 130 }}
            role="dialog"
            aria-modal="true"
            aria-label={previewAtt.name}
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewAtt(null);
            }}
          >
            <div className="tkt-panel tkt-vwp">
              <div className="tkt-meta">
                <b>{previewAtt.name}</b>
                <span className="tkt-sp" />
                <button
                  type="button"
                  className="tkt-btn s"
                  onClick={() => handleDownloadAttachment(previewAtt)}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="tkt-btn s"
                  onClick={() => setPreviewAtt(null)}
                >
                  Close
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                {previewAtt.type.startsWith('image/') ? (
                  <img
                    src={previewBlobUrl || previewAtt.data}
                    alt={previewAtt.name}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  previewBlobUrl && <iframe src={previewBlobUrl} title={previewAtt.name} />
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* CONFIRMATION DIALOG */}
      {confirmState &&
        createPortal(
          <div
            className="tkt-ov mid"
            style={{ zIndex: 150 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tkt-ask-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !confirmBusy) setConfirmState(null);
            }}
          >
            <div className="tkt-panel" style={{ maxWidth: 440 }}>
              <h2 id="tkt-ask-title">Are you sure?</h2>
              <p style={{ margin: '8px 0 14px' }}>{confirmState.message}</p>
              {confirmState.confirmWord && (
                <div className="tkt-f">
                  <label htmlFor="tkt_aw">Type {confirmState.confirmWord} to confirm</label>
                  <input
                    id="tkt_aw"
                    autoComplete="off"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    autoFocus
                  />
                </div>
              )}
              <div className="tkt-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <button
                  type="button"
                  className="tkt-btn"
                  disabled={confirmBusy}
                  onClick={() => setConfirmState(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="tkt-btn p"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  disabled={
                    confirmBusy ||
                    Boolean(
                      confirmState.confirmWord && confirmInput.trim() !== confirmState.confirmWord
                    )
                  }
                  onClick={async () => {
                    setConfirmBusy(true);
                    try {
                      await confirmState.onConfirm();
                      setConfirmState(null);
                    } catch (err) {
                      onToast(err instanceof Error ? err.message : 'Action failed');
                    } finally {
                      setConfirmBusy(false);
                    }
                  }}
                >
                  {confirmBusy ? 'Working…' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
