import { AttendanceRecord, AttendanceSettings, Holiday } from '../types';

export const pad = (n: number): string => String(n).padStart(2, '0');

export const localDateStr = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const dayOffset = (daysAgo: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return localDateStr(d);
};

export const todayStr = (): string => localDateStr(new Date());

export const nowTimeStr = (d: Date = new Date()): string =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const toMins = (hhmm: string): number => {
  if (!hhmm || hhmm.length < 5) return 0;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
};

export const round1 = (v: number): number => Math.round(v * 10) / 10;

export const fmtHours = (h: number): string => {
  const clamped = Math.max(0, h);
  const hrs = Math.floor(clamped);
  const mins = Math.round((clamped - hrs) * 60);
  if (mins === 60) return `${hrs + 1}h 00m`;
  return `${hrs}h ${pad(mins)}m`;
};

export const safeDocId = (raw: string): string => {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\./g, '__')
    .replace(/[^a-z0-9_\-]/g, '_')
    .slice(0, 120);
  return cleaned || 'id_' + Math.random().toString(36).slice(2, 10);
};

export const randomId = (prefix: string): string => {
  const rand =
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint8Array(6)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
};

export const randomTempPassword = (): string => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    for (let i = 0; i < arr.length; i++) out += chars[arr[i] % chars.length];
  } else {
    out = Math.random().toString(36).slice(2, 10);
  }
  return out;
};

export const generateSalt = (): string => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return 'salt_' + Math.random().toString(36).slice(2, 14);
};

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  const computed = await hashPassword(password, salt);
  return computed === expectedHash;
}

/** Calculate total break minutes from breaks array ["HH:MM-HH:MM", "HH:MM-"] */
export function calcBreakMins(breaks: string[], nowMins?: number): number {
  let total = 0;
  for (const b of breaks || []) {
    const [start, end] = b.split('-');
    if (!start) continue;
    const s = toMins(start);
    const e = end ? toMins(end) : nowMins ?? s;
    if (e > s) total += e - s;
  }
  return total;
}

export function isOnActiveBreak(rec?: AttendanceRecord): boolean {
  if (!rec || !rec.breaks || !rec.breaks.length || rec.out) return false;
  const last = rec.breaks[rec.breaks.length - 1];
  return last.endsWith('-');
}

/** Worked hours = check-out - check-in - breaks */
export function calcWorkedHours(rec?: AttendanceRecord): number {
  if (!rec || !rec.in || !rec.out) return 0;
  const gross = toMins(rec.out) - toMins(rec.in);
  const brk = calcBreakMins(rec.breaks || []);
  return Math.max(0, (gross - brk) / 60);
}

/** Live worked hours while currently clocked in */
export function calcLiveWorkedHours(rec?: AttendanceRecord): number {
  if (!rec || !rec.in) return 0;
  if (rec.out) return calcWorkedHours(rec);
  const now = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  const gross = Math.max(0, nowM - toMins(rec.in));
  const brk = calcBreakMins(rec.breaks || [], nowM);
  return Math.max(0, (gross - brk) / 60);
}

export function findHoliday(
  date: string,
  location: string,
  holidays: Holiday[]
): Holiday | undefined {
  return holidays.find(
    (h) => h.date === date && (h.location === 'All' || h.location === location)
  );
}

export function isWorkingDay(
  date: string,
  location: string,
  settings: AttendanceSettings,
  holidays: Holiday[]
): boolean {
  const dow = new Date(`${date}T00:00:00`).getDay();
  return settings.wd.includes(dow) && !findHoliday(date, location, holidays);
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

export function isSundayDate(dateStr: string): boolean {
  return new Date(`${dateStr}T00:00:00`).getDay() === 0;
}

/** Daily repeated tasks run every day except Sunday and any Holiday on the calendar */
export function isDailyRunDate(
  dateStr: string,
  location: string,
  holidays: Holiday[]
): boolean {
  return !isSundayDate(dateStr) && !findHoliday(dateStr, location, holidays);
}

export function nextDailyRunDate(
  fromDateStr: string,
  location: string,
  holidays: Holiday[],
  includeFromDate = true
): string {
  let cursor = includeFromDate ? fromDateStr : addDaysToDateStr(fromDateStr, 1);
  for (let i = 0; i < 60; i++) {
    if (isDailyRunDate(cursor, location, holidays)) return cursor;
    cursor = addDaysToDateStr(cursor, 1);
  }
  return cursor;
}

export function upcomingDailyRunDates(
  fromDateStr: string,
  location: string,
  holidays: Holiday[],
  count = 3
): string[] {
  const out: string[] = [];
  let cursor = fromDateStr;
  for (let i = 0; i < count; i++) {
    const next = nextDailyRunDate(cursor, location, holidays, i === 0);
    out.push(next);
    cursor = next;
  }
  return out;
}

export function calcDayStatus(
  rec: AttendanceRecord | undefined,
  date: string,
  joinedAt: string,
  location: string,
  settings: AttendanceSettings,
  holidays: Holiday[]
): string {
  const td = todayStr();
  if (findHoliday(date, location, holidays)) return 'Holiday';
  const dow = new Date(`${date}T00:00:00`).getDay();
  if (!settings.wd.includes(dow)) return 'Weekly off';
  if (!rec || !rec.in) {
    if (date > td || (joinedAt && date < joinedAt)) return '';
    return date === td ? 'Not clocked in' : 'Absent';
  }
  if (!rec.out) {
    if (date === td) return isOnActiveBreak(rec) ? 'On break' : 'Working';
    return 'No clock-out';
  }
  if (calcWorkedHours(rec) < 4) return 'Half day';
  return toMins(rec.in) > toMins(settings.st) + settings.gr ? 'Late' : 'Present';
}

export function calcAttendanceStats(
  empRecordsByDate: Record<string, AttendanceRecord>,
  joinedAt: string,
  location: string,
  from: string,
  to: string,
  settings: AttendanceSettings,
  holidays: Holiday[]
): { w: number; p: number; l: number; ab: number; h: number; ot: number; pct: number } {
  let w = 0;
  let p = 0;
  let l = 0;
  let ab = 0;
  let h = 0;
  let ot = 0;
  const td = todayStr();
  const shiftHours = Math.max(1, (toMins(settings.en) - toMins(settings.st)) / 60);
  const start = new Date(`${from}T00:00:00`);
  for (let d = new Date(start); localDateStr(d) <= to && localDateStr(d) <= td; d.setDate(d.getDate() + 1)) {
    const s = localDateStr(d);
    const rc = empRecordsByDate[s];
    if (!isWorkingDay(s, location, settings, holidays)) {
      if (rc && rc.out) {
        const hrs = calcWorkedHours(rc);
        h += hrs;
        ot += hrs;
      }
      continue;
    }
    if (s === td && (!rc || !rc.in)) continue;
    const st = calcDayStatus(rc, s, joinedAt, location, settings, holidays);
    if (!st) continue;
    w++;
    if (st === 'Absent') ab++;
    else if (st === 'Half day') p += 0.5;
    else {
      p++;
      if (st === 'Late') l++;
    }
    if (rc && rc.out) {
      const hrs = calcWorkedHours(rc);
      h += hrs;
      ot += Math.max(0, hrs - shiftHours);
    }
  }
  return {
    w,
    p: round1(p),
    l,
    ab,
    h: round1(h),
    ot: round1(ot),
    pct: w ? Math.round((p / w) * 100) : 0,
  };
}

export const fmtTimestamp = (tsMs: number): string => {
  const d = new Date(tsMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
