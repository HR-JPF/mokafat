import type {
  DayPunchSummary,
  DayStatus,
  Employee,
  EmployeeEvaluation,
  ManagerDecision,
  RawPunch,
  UserSettings,
} from '../types';

const ARABIC_WORKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

export function parseTimeToMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return 0;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return 0;
  return hours * 60 + mins;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.floor(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function toAsciiDigits(raw: string): string {
  return raw
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
}

export function sanitizeCode(raw: string): string {
  return toAsciiDigits(raw).trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

export function normalizeCodeKey(code: string): string {
  return sanitizeCode(code).toLowerCase();
}

export function canonicalNumericCodeKey(code: string): string {
  const norm = normalizeCodeKey(code);
  if (!norm) return '';
  return norm.replace(/^([a-z_-]*)0+(\d+)$/, '$1$2');
}

export function normalizePersonName(name: string): string {
  return toAsciiDigits(name)
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

function isPlaceholderEmpName(name: string): boolean {
  const trimmed = name.trim();
  return !trimmed || /^موظف رقم\s+\S+/.test(trimmed);
}

/**
 * Matches a biometric record (empCode + optional rawName) to an employee in the directory:
 * 1) Exact code match (case-insensitive, Arabic digits normalized)
 * 2) Leading-zero-insensitive code match (e.g. "00105" === "105", "EMP05" === "emp5")
 * 3) Exact normalized Arabic/English full name match (unique)
 * 4) Unique first-name / word-prefix match (handles BioTime "First Name" vs full name)
 */
export function findMatchingDirectoryEmployee(
  empCode: string,
  rawName: string | undefined,
  employees: Employee[],
  excludeIds?: Set<string>
): Employee | undefined {
  const pool = employees.filter((e) => !excludeIds || !excludeIds.has(e.id));
  if (pool.length === 0) return undefined;

  const codeKey = normalizeCodeKey(empCode);
  if (codeKey) {
    const exactCode = pool.find((e) => normalizeCodeKey(e.empCode) === codeKey);
    if (exactCode) return exactCode;

    const numKey = canonicalNumericCodeKey(empCode);
    if (numKey) {
      const numericMatches = pool.filter((e) => canonicalNumericCodeKey(e.empCode) === numKey);
      if (numericMatches.length === 1) return numericMatches[0];
    }
  }

  const normRaw = rawName && !isPlaceholderEmpName(rawName) ? normalizePersonName(rawName) : '';
  if (!normRaw || normRaw.length < 2) return undefined;

  // Tier 3: Exact normalized name match
  const exactNameMatches = pool.filter((e) => normalizePersonName(e.name) === normRaw);
  if (exactNameMatches.length === 1) return exactNameMatches[0];

  // Tier 4: Unique first-name / word-prefix match (e.g. BioTime "نبيل" <-> Directory "نبيل محمد الأحمد")
  const prefixMatches = pool.filter((e) => {
    const normDir = normalizePersonName(e.name);
    if (!normDir) return false;
    return normDir.startsWith(`${normRaw} `) || normRaw.startsWith(`${normDir} `);
  });
  if (prefixMatches.length === 1) return prefixMatches[0];

  return undefined;
}

/**
 * Overlays live Employee Directory contacts (phone, email, full name, department)
 * onto stored evaluations so adding/editing an employee links immediately without re-upload.
 */
export function resolveEvaluationsWithDirectory(
  evaluations: EmployeeEvaluation[],
  employees: Employee[]
): EmployeeEvaluation[] {
  if (employees.length === 0) return evaluations;
  const activeEmployees = employees.filter((e) => e.active);
  const pool = activeEmployees.length > 0 ? activeEmployees : employees;

  return evaluations.map((ev) => {
    const dirEmp = findMatchingDirectoryEmployee(ev.empCode, ev.employeeName, pool);
    if (!dirEmp) return ev;

    const resolvedName =
      dirEmp.name || ev.employeeName;
    const resolvedDept =
      dirEmp.department && dirEmp.department !== 'عام'
        ? dirEmp.department
        : ev.department && ev.department !== 'غير محدد'
        ? ev.department
        : dirEmp.department || 'غير محدد';

    return {
      ...ev,
      employeeName: resolvedName,
      department: resolvedDept,
      phone: dirEmp.phone || ev.phone,
      email: dirEmp.email || ev.email,
      unmapped: false,
    };
  });
}

const WEEKDAY_TOKEN_TO_DOW: Record<string, number> = {
  sun: 0,
  sunday: 0,
  الاحد: 0,
  الأحد: 0,
  mon: 1,
  monday: 1,
  الاثنين: 1,
  الإثنين: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  الثلاثاء: 2,
  wed: 3,
  wednesday: 3,
  الاربعاء: 3,
  الأربعاء: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  الخميس: 4,
  fri: 5,
  friday: 5,
  الجمعة: 5,
  sat: 6,
  saturday: 6,
  السبت: 6,
};

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isValidYmd(y: number, mo: number, d: number): boolean {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function formatYmd(y: number, mo: number, d: number): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 25000 || serial > 90000) return null;
  const wholeDays = Math.floor(serial);
  // Excel epoch: 1899-12-30 UTC
  const ms = Date.UTC(1899, 11, 30) + wholeDays * 86400000;
  const d = new Date(ms);
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function excelFractionToTime(val: number): { time: string; seconds: string } | null {
  if (!Number.isFinite(val) || val < 0) return null;
  const frac = val >= 1 ? val - Math.floor(val) : val;
  if (val >= 1 && frac === 0) return null;
  const totalSec = Math.round(frac * 86400) % 86400;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return {
    time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    seconds: String(s).padStart(2, '0'),
  };
}

function normalizeDateToken(raw: unknown, weekdayHint?: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return formatYmd(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  if (typeof raw === 'number') {
    return excelSerialToIsoDate(raw);
  }

  const clean = String(raw).trim();
  if (!clean || clean === '-' || clean === '--') return null;

  // Numeric string representing Excel serial date
  if (/^\d{5}(\.\d+)?$/.test(clean)) {
    return excelSerialToIsoDate(Number(clean));
  }

  // Strip trailing time if datetime string was passed
  const datePart = clean.split(/[ T]/)[0];

  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(datePart);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (isValidYmd(y, mo, d)) return formatYmd(y, mo, d);
  }

  // DD/MM/YYYY or MM/DD/YYYY (supports 2-digit or 4-digit year)
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(datePart);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);

    const ddmmValid = isValidYmd(y, b, a);
    const mmddValid = isValidYmd(y, a, b);

    if (ddmmValid && !mmddValid) return formatYmd(y, b, a);
    if (mmddValid && !ddmmValid) return formatYmd(y, a, b);

    if (ddmmValid && mmddValid) {
      // Disambiguate using Weekday column if provided!
      const expectedDow = weekdayHint
        ? WEEKDAY_TOKEN_TO_DOW[weekdayHint.trim().toLowerCase()]
        : undefined;
      if (expectedDow !== undefined) {
        const ddmmDow = new Date(Date.UTC(y, b - 1, a)).getUTCDay();
        const mmddDow = new Date(Date.UTC(y, a - 1, b)).getUTCDay();
        if (ddmmDow === expectedDow && mmddDow !== expectedDow) return formatYmd(y, b, a);
        if (mmddDow === expectedDow && ddmmDow !== expectedDow) return formatYmd(y, a, b);
      }
      // Default international DD/MM/YYYY
      return formatYmd(y, b, a);
    }
  }

  // Named month: "22-Nov-2026" or "22 Nov 2026"
  m = /^(\d{1,2})[-\s]+([A-Za-z]{3,9})[-\s,]+(\d{2,4})$/.exec(clean);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTH_NAME_MAP[m[2].toLowerCase()];
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mo && isValidYmd(y, mo, d)) return formatYmd(y, mo, d);
  }

  // Named month: "Nov 22, 2026"
  m = /^([A-Za-z]{3,9})[-\s]+(\d{1,2}),?[-\s]+(\d{2,4})$/.exec(clean);
  if (m) {
    const mo = MONTH_NAME_MAP[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mo && isValidYmd(y, mo, d)) return formatYmd(y, mo, d);
  }

  return null;
}

function normalizeTimeToken(raw: unknown): { time: string; seconds: string } | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return {
      time: `${String(raw.getHours()).padStart(2, '0')}:${String(raw.getMinutes()).padStart(2, '0')}`,
      seconds: String(raw.getSeconds()).padStart(2, '0'),
    };
  }
  if (typeof raw === 'number') {
    return excelFractionToTime(raw);
  }

  const clean = String(raw).trim();
  if (!clean || clean === '-' || clean === '--' || /^n\/a$/i.test(clean)) return null;

  // Numeric string representing Excel time fraction (e.g. "0.3368")
  if (/^0?\.\d+$/.test(clean)) {
    return excelFractionToTime(Number(clean));
  }

  // Extract time part even if prefixed with date ("2026-11-22 08:05:12 AM")
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?/i.exec(clean);
  if (!m) return null;

  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  const meridiem = m[4]?.toLowerCase();

  if (meridiem === 'pm' || meridiem === 'م') {
    if (h < 12) h += 12;
  } else if (meridiem === 'am' || meridiem === 'ص') {
    if (h === 12) h = 0;
  }

  if (h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) return null;
  return {
    time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    seconds: String(sec).padStart(2, '0'),
  };
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  }
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parses a 2D spreadsheet/CSV/TSV matrix (array of rows).
 * Automatically locates the real header row even when reports like ZKTeco BioTime
 * "First & Last" include title rows above the column headers, and supports both
 * dual-punch columns (First Punch + Last Punch) and single-punch rows.
 */
export function parseSpreadsheetMatrix(matrix: unknown[][]): {
  punches: RawPunch[];
  discoveredEmployees: Array<{
    empCode: string;
    name?: string;
    department?: string;
    phone?: string;
    email?: string;
  }>;
} {
  const headerMatchers = {
    empCode: [
      'employee id',
      'emp id',
      'emp_id',
      'empcode',
      'emp_code',
      'ac-no',
      'ac no',
      'badge',
      'pin',
      'user id',
      'الرقم الوظيفي',
      'رقم الموظف',
      'الكود',
    ],
    firstName: ['first name', 'employee name', 'full name', 'name', 'employee', 'الاسم', 'اسم الموظف'],
    lastName: ['last name', 'اسم العائلة'],
    department: ['department', 'dept', 'القسم', 'الإدارة'],
    phone: ['phone', 'mobile', 'whatsapp', 'الجوال', 'واتساب', 'الهاتف'],
    email: ['email', 'mail', 'البريد', 'الإيميل'],
    date: ['date', 'work date', 'attendance date', 'التاريخ', 'اليوم'],
    weekday: ['weekday', 'week day', 'day', 'يوم الأسبوع'],
    firstPunch: [
      'first punch',
      'first in',
      'check in',
      'check-in',
      'clock in',
      'clock-in',
      'in time',
      'أول بصمة',
      'الدخول',
      'وقت الدخول',
    ],
    lastPunch: [
      'last punch',
      'last out',
      'check out',
      'check-out',
      'clock out',
      'clock-out',
      'out time',
      'آخر بصمة',
      'الخروج',
      'وقت الخروج',
      'الانصراف',
    ],
    timestamp: ['timestamp', 'datetime', 'punch time', 'punch', 'time', 'البصمة', 'التاريخ والوقت', 'الوقت'],
  };

  const matchCol = (cellText: string, candidates: string[]): boolean => {
    const norm = cellText.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!norm) return false;
    return candidates.some((c) => norm === c || norm.includes(c));
  };

  // Locate header row within the first 20 rows
  let headerRowIdx = -1;
  let colIdx: Record<keyof typeof headerMatchers, number> = {
    empCode: -1,
    firstName: -1,
    lastName: -1,
    department: -1,
    phone: -1,
    email: -1,
    date: -1,
    weekday: -1,
    firstPunch: -1,
    lastPunch: -1,
    timestamp: -1,
  };

  const scanLimit = Math.min(matrix.length, 20);
  for (let r = 0; r < scanLimit; r++) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length < 2) continue;

    const candidateMap: Record<keyof typeof headerMatchers, number> = {
      empCode: -1,
      firstName: -1,
      lastName: -1,
      department: -1,
      phone: -1,
      email: -1,
      date: -1,
      weekday: -1,
      firstPunch: -1,
      lastPunch: -1,
      timestamp: -1,
    };

    for (let c = 0; c < row.length; c++) {
      const text = String(row[c] ?? '').trim();
      if (!text) continue;
      if (candidateMap.empCode === -1 && (matchCol(text, headerMatchers.empCode) || text.toLowerCase() === 'id')) {
        candidateMap.empCode = c;
      } else if (candidateMap.firstName === -1 && matchCol(text, headerMatchers.firstName)) {
        candidateMap.firstName = c;
      } else if (candidateMap.lastName === -1 && matchCol(text, headerMatchers.lastName)) {
        candidateMap.lastName = c;
      } else if (candidateMap.department === -1 && matchCol(text, headerMatchers.department)) {
        candidateMap.department = c;
      } else if (candidateMap.phone === -1 && matchCol(text, headerMatchers.phone)) {
        candidateMap.phone = c;
      } else if (candidateMap.email === -1 && matchCol(text, headerMatchers.email)) {
        candidateMap.email = c;
      } else if (candidateMap.weekday === -1 && matchCol(text, headerMatchers.weekday)) {
        candidateMap.weekday = c;
      } else if (candidateMap.date === -1 && matchCol(text, headerMatchers.date)) {
        candidateMap.date = c;
      } else if (candidateMap.firstPunch === -1 && matchCol(text, headerMatchers.firstPunch)) {
        candidateMap.firstPunch = c;
      } else if (candidateMap.lastPunch === -1 && matchCol(text, headerMatchers.lastPunch)) {
        candidateMap.lastPunch = c;
      } else if (
        candidateMap.timestamp === -1 &&
        !/total\s*time|work\s*time|duration|ساعات العمل/i.test(text) &&
        matchCol(text, headerMatchers.timestamp)
      ) {
        candidateMap.timestamp = c;
      }
    }

    const hasTimeColumn =
      candidateMap.firstPunch !== -1 ||
      candidateMap.lastPunch !== -1 ||
      candidateMap.timestamp !== -1;

    if (candidateMap.empCode !== -1 && (candidateMap.date !== -1 || hasTimeColumn)) {
      headerRowIdx = r;
      colIdx = candidateMap;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return { punches: [], discoveredEmployees: [] };
  }

  const punches: RawPunch[] = [];
  const empMap = new Map<
    string,
    { empCode: string; name?: string; department?: string; phone?: string; email?: string }
  >();

  let lastEmpCode = '';
  let lastNameStr = '';
  let lastDeptStr = '';

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    const getCell = (idx: number) => (idx >= 0 && idx < row.length ? row[idx] : '');
    const getStr = (idx: number) => String(getCell(idx) ?? '').trim();

    let empCode = sanitizeCode(getStr(colIdx.empCode));
    const firstName = getStr(colIdx.firstName);
    const lastName = getStr(colIdx.lastName);
    const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const department = getStr(colIdx.department);
    const phone = getStr(colIdx.phone);
    const email = getStr(colIdx.email);
    const weekdayHint = getStr(colIdx.weekday);

    // Some BioTime exports leave Employee ID blank on grouped continuation rows
    if (!empCode && lastEmpCode && (getStr(colIdx.date) || getStr(colIdx.firstPunch))) {
      empCode = lastEmpCode;
    }
    if (!empCode) continue;

    const isSameAsPrev = empCode === lastEmpCode;
    lastEmpCode = empCode;
    const effectiveName = combinedName || (isSameAsPrev ? lastNameStr : '');
    const effectiveDept = department || (isSameAsPrev ? lastDeptStr : '');
    lastNameStr = isSameAsPrev ? combinedName || lastNameStr : combinedName;
    lastDeptStr = isSameAsPrev ? department || lastDeptStr : department;

    if (effectiveName || effectiveDept || phone || email) {
      const existing = empMap.get(empCode) || { empCode };
      empMap.set(empCode, {
        empCode,
        name: effectiveName || existing.name,
        department: effectiveDept || existing.department,
        phone: phone || existing.phone,
        email: email || existing.email,
      });
    }

    const rawDateCell = getCell(colIdx.date);
    const firstPunchCell = getCell(colIdx.firstPunch);
    const lastPunchCell = getCell(colIdx.lastPunch);
    const tsCell = getCell(colIdx.timestamp);

    const resolvedDate =
      normalizeDateToken(rawDateCell, weekdayHint) ||
      normalizeDateToken(firstPunchCell, weekdayHint) ||
      normalizeDateToken(tsCell, weekdayHint);

    if (!resolvedDate) continue;

    const pushPunch = (t: { time: string; seconds: string }) => {
      punches.push({
        empCode,
        date: resolvedDate,
        time: t.time,
        timestamp: `${resolvedDate} ${t.time}:${t.seconds}`,
        minutesFromMidnight: parseTimeToMinutes(t.time),
        rawName: effectiveName || undefined,
        rawDepartment: effectiveDept || undefined,
      });
    };

    if (colIdx.firstPunch !== -1 || colIdx.lastPunch !== -1) {
      const tFirst = normalizeTimeToken(firstPunchCell);
      const tLast = normalizeTimeToken(lastPunchCell);
      if (tFirst) pushPunch(tFirst);
      if (tLast) pushPunch(tLast);
    } else if (colIdx.timestamp !== -1) {
      const tSingle = normalizeTimeToken(tsCell);
      if (tSingle) pushPunch(tSingle);
    }
  }

  return { punches, discoveredEmployees: Array.from(empMap.values()) };
}

/**
 * Parses ZKTeco .dat / .txt biometric punch logs (tab or whitespace separated)
 * AND structured TSV/CSV reports such as ZKTeco BioTime "First & Last".
 */
export function parseZKTecoText(content: string): RawPunch[] {
  const lines = content.split(/\r?\n/);

  // First check if this text file is a structured TSV/CSV report (e.g. BioTime "First & Last")
  const nonEmptyLines = lines.map((l) => l.trim()).filter(Boolean);
  const sampleHeaderWindow = nonEmptyLines.slice(0, 15).join('\n').toLowerCase();
  const looksLikeTableReport =
    sampleHeaderWindow.includes('employee id') ||
    sampleHeaderWindow.includes('first punch') ||
    sampleHeaderWindow.includes('last punch') ||
    sampleHeaderWindow.includes('الرقم الوظيفي');

  if (looksLikeTableReport) {
    const usesTabs = nonEmptyLines.some((l) => l.includes('\t'));
    const delimiter = usesTabs ? '\t' : ',';
    const matrix = nonEmptyLines.map((l) => splitDelimitedLine(l, delimiter));
    const parsed = parseSpreadsheetMatrix(matrix);
    if (parsed.punches.length > 0) {
      return parsed.punches;
    }
  }

  const punches: RawPunch[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.includes('\t')
      ? line.split('\t').map((s) => s.trim())
      : line.includes(',')
      ? splitDelimitedLine(line, ',')
      : line.split(/\s+/);

    if (parts.length < 2) continue;

    const empCode = sanitizeCode(parts[0]);
    if (!empCode || /^(emp|pin|id|code|user|first|الرقم)/i.test(parts[0])) continue;

    let foundDate: string | null = null;
    const foundTimes: Array<{ time: string; seconds: string }> = [];
    let rawName: string | undefined;

    for (let i = 1; i < parts.length; i++) {
      const token = parts[i];
      if (!token || token === '-' || token === '--') continue;

      const combined =
        /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})[ T](\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)/i.exec(
          token
        );
      if (combined) {
        const d = normalizeDateToken(combined[1]);
        const t = normalizeTimeToken(combined[2]);
        if (d) foundDate = d;
        if (t) foundTimes.push(t);
        continue;
      }

      if (!foundDate) {
        const d = normalizeDateToken(token);
        if (d) {
          foundDate = d;
          continue;
        }
      }

      const t = normalizeTimeToken(token);
      if (t) {
        foundTimes.push(t);
        continue;
      }

      if (i === 1 && !/^\d+$/.test(token) && !normalizeDateToken(token)) {
        rawName = token;
      }
    }

    if (foundDate && foundTimes.length > 0) {
      for (const t of foundTimes) {
        punches.push({
          empCode,
          date: foundDate,
          time: t.time,
          timestamp: `${foundDate} ${t.time}:${t.seconds}`,
          minutesFromMidnight: parseTimeToMinutes(t.time),
          rawName,
        });
      }
    }
  }

  return punches;
}

/**
 * Parses Excel / CSV object rows into RawPunch entries and optional discovered employee metadata.
 */
export function parseSpreadsheetRows(rows: Record<string, unknown>[]): {
  punches: RawPunch[];
  discoveredEmployees: Array<{
    empCode: string;
    name?: string;
    department?: string;
    phone?: string;
    email?: string;
  }>;
} {
  if (rows.length === 0) return { punches: [], discoveredEmployees: [] };
  const keys = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>())
  );
  const matrix: unknown[][] = [keys, ...rows.map((r) => keys.map((k) => r[k] ?? ''))];
  return parseSpreadsheetMatrix(matrix);
}

function parseIsoDateUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = parseIsoDateUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUtcDate(d);
}

/**
 * Given any YYYY-MM-DD date, returns the Sunday YYYY-MM-DD starting its Sun-Thu workweek.
 * Friday (5) and Saturday (6) map to the preceding Sunday.
 */
export function getWeekSunday(dateStr: string): string {
  const d = parseIsoDateUtc(dateStr);
  const dow = d.getUTCDay(); // 0 = Sun ... 6 = Sat
  d.setUTCDate(d.getUTCDate() - dow);
  return formatUtcDate(d);
}

export interface DetectedWeek {
  weekKey: string; // Sunday YYYY-MM-DD
  sundayDate: string;
  thursdayDate: string;
  weekLabel: string;
  punchCount: number;
}

export function getAvailableWeeks(punches: RawPunch[]): DetectedWeek[] {
  const map = new Map<string, number>();

  for (const p of punches) {
    const dow = parseIsoDateUtc(p.date).getUTCDay();
    if (dow < 0 || dow > 4) continue; // Only Sun..Thu punches define workweeks
    const sunday = getWeekSunday(p.date);
    map.set(sunday, (map.get(sunday) || 0) + 1);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([sunday, punchCount]) => {
      const thursday = addDays(sunday, 4);
      return {
        weekKey: sunday,
        sundayDate: sunday,
        thursdayDate: thursday,
        weekLabel: `${sunday} إلى ${thursday}`,
        punchCount,
      };
    });
}

export function evaluateEmployeeDays(
  empPunchesByDate: Map<string, RawPunch[]>,
  weekSunday: string,
  settings: UserSettings,
  excusedDates: string[]
): {
  days: DayPunchSummary[];
  isCompliant: boolean;
  lateDaysCount: number;
  totalLateMinutes: number;
  earlyLeaveMinutes: number;
  missingPunchDays: number;
  absentDays: number;
  presentDays: number;
} {
  const startMin = parseTimeToMinutes(settings.workStartTime);
  const endMin = parseTimeToMinutes(settings.workEndTime);
  const excuseSet = new Set(excusedDates);

  const days: DayPunchSummary[] = [];
  let lateDaysCount = 0;
  let totalLateMinutes = 0;
  let totalEarlyLeaveMinutes = 0;
  let missingPunchDays = 0;
  let absentDays = 0;
  let presentDays = 0;

  for (let i = 0; i < 5; i++) {
    const date = addDays(weekSunday, i);
    const dayNameAr = ARABIC_WORKDAYS[i];
    const isThursday = i === 4;
    const isExcused = excuseSet.has(date);
    const rawList = (empPunchesByDate.get(date) || [])
      .slice()
      .sort((a, b) => a.minutesFromMidnight - b.minutesFromMidnight);

    if (isExcused) {
      const first = rawList[0] ?? null;
      const last =
        rawList.length >= 2 &&
        rawList[rawList.length - 1].minutesFromMidnight - rawList[0].minutesFromMidnight >= 5
          ? rawList[rawList.length - 1]
          : null;
      presentDays += 1;
      days.push({
        date,
        dayNameAr,
        dayIndex: i,
        firstIn: first ? first.time : null,
        lastOut: last ? last.time : null,
        punchCount: rawList.length,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        missingPunch: false,
        absent: false,
        excused: true,
        status: 'excused',
      });
      continue;
    }

    if (rawList.length === 0) {
      absentDays += 1;
      days.push({
        date,
        dayNameAr,
        dayIndex: i,
        firstIn: null,
        lastOut: null,
        punchCount: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        missingPunch: false,
        absent: true,
        excused: false,
        status: 'absent',
      });
      continue;
    }

    presentDays += 1;
    const first = rawList[0];
    // Guard against accidental double-tap within 5 minutes being treated as checkout
    const candidateLast = rawList[rawList.length - 1];
    const hasDistinctCheckout =
      rawList.length >= 2 && candidateLast.minutesFromMidnight - first.minutesFromMidnight >= 5;
    const last = hasDistinctCheckout ? candidateLast : null;

    const rawLate = Math.max(0, first.minutesFromMidnight - startMin);
    const lateMinutes = rawLate > settings.graceLateMinutes ? rawLate : 0;

    let earlyLeaveMinutes = 0;
    let missingPunch = false;

    if (isThursday && settings.thursdayMorningOnly) {
      // Thursday morning-only mode: do not penalize missing checkout or early departure
      missingPunch = false;
      earlyLeaveMinutes = 0;
    } else {
      if (!last) {
        missingPunch = true;
      } else {
        const rawEarly = Math.max(0, endMin - last.minutesFromMidnight);
        earlyLeaveMinutes = rawEarly > settings.graceEarlyMinutes ? rawEarly : 0;
      }
    }

    if (lateMinutes > 0) {
      lateDaysCount += 1;
      totalLateMinutes += lateMinutes;
    }
    if (earlyLeaveMinutes > 0) {
      totalEarlyLeaveMinutes += earlyLeaveMinutes;
    }
    if (missingPunch) {
      missingPunchDays += 1;
    }

    let status: DayStatus = 'on_time';
    if (missingPunch) status = 'missing_punch';
    else if (lateMinutes > 0) status = 'late';
    else if (earlyLeaveMinutes > 0) status = 'early_leave';

    days.push({
      date,
      dayNameAr,
      dayIndex: i,
      firstIn: first.time,
      lastOut: last ? last.time : null,
      punchCount: rawList.length,
      lateMinutes,
      earlyLeaveMinutes,
      missingPunch,
      absent: false,
      excused: false,
      status,
    });
  }

  const failsLateDays = lateDaysCount > settings.maxLateDaysAllowed;
  const failsLateMinutes = totalLateMinutes > settings.maxTotalLateMinutes;
  const failsEarlyLeave = totalEarlyLeaveMinutes > 0;
  const failsMissing = settings.countMissingPunchAsNonCompliant && missingPunchDays > 0;
  const failsAbsence = settings.countAbsenceAsNonCompliant && absentDays > 0;

  const isCompliant = !(
    failsLateDays ||
    failsLateMinutes ||
    failsEarlyLeave ||
    failsMissing ||
    failsAbsence
  );

  return {
    days,
    isCompliant,
    lateDaysCount,
    totalLateMinutes,
    earlyLeaveMinutes: totalEarlyLeaveMinutes,
    missingPunchDays,
    absentDays,
    presentDays,
  };
}

export function evaluateWeek(
  punches: RawPunch[],
  weekSunday: string,
  employees: Employee[],
  settings: UserSettings,
  existingExcuses: Record<string, string[]> = {},
  existingDecisions: Record<string, ManagerDecision> = {}
): {
  evaluations: Array<Omit<EmployeeEvaluation, 'id' | 'ownerId' | 'batchId'>>;
  unmappedCodes: string[];
} {
  const weekDates = new Set(Array.from({ length: 5 }, (_, idx) => addDays(weekSunday, idx)));
  const activeEmployees = employees.filter((emp) => emp.active);

  // Group punches by empCode -> date -> RawPunch[]
  const punchesByEmp = new Map<string, Map<string, RawPunch[]>>();
  const rawNames = new Map<string, string>();
  const rawDepartments = new Map<string, string>();

  for (const p of punches) {
    if (!weekDates.has(p.date)) continue;
    let byDate = punchesByEmp.get(p.empCode);
    if (!byDate) {
      byDate = new Map();
      punchesByEmp.set(p.empCode, byDate);
    }
    const list = byDate.get(p.date) || [];
    list.push(p);
    byDate.set(p.date, list);
    if (p.rawName && !rawNames.has(p.empCode)) {
      rawNames.set(p.empCode, p.rawName);
    }
    if (p.rawDepartment && !rawDepartments.has(p.empCode)) {
      rawDepartments.set(p.empCode, p.rawDepartment);
    }
  }

  const unmappedCodes: string[] = [];
  const evaluations: Array<Omit<EmployeeEvaluation, 'id' | 'ownerId' | 'batchId'>> = [];
  const matchedDirEmpIds = new Set<string>();

  // 1. Evaluate all employees present in the biometric file first (linking smartly to directory)
  const fileCodes = Array.from(punchesByEmp.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  for (const empCode of fileCodes) {
    const rawName = rawNames.get(empCode);
    const rawDept = rawDepartments.get(empCode);
    const dirEmp = findMatchingDirectoryEmployee(empCode, rawName, activeEmployees, matchedDirEmpIds);

    if (dirEmp) {
      matchedDirEmpIds.add(dirEmp.id);
    } else {
      unmappedCodes.push(empCode);
    }

    const excusedDates =
      existingExcuses[empCode] || (dirEmp ? existingExcuses[dirEmp.empCode] : undefined) || [];
    const empPunchesByDate = punchesByEmp.get(empCode) || new Map<string, RawPunch[]>();
    const calc = evaluateEmployeeDays(empPunchesByDate, weekSunday, settings, excusedDates);

    const prevDecision =
      existingDecisions[empCode] || (dirEmp ? existingDecisions[dirEmp.empCode] : undefined);
    let decision: ManagerDecision;
    if (calc.isCompliant) {
      decision = 'reward';
    } else if (prevDecision && prevDecision !== 'reward') {
      decision = prevDecision;
    } else {
      decision = 'pending';
    }

    const resolvedDept =
      dirEmp?.department && dirEmp.department !== 'عام'
        ? dirEmp.department
        : rawDept || dirEmp?.department || 'غير محدد';

    evaluations.push({
      empCode,
      employeeName: dirEmp?.name || rawName || `موظف رقم ${empCode}`,
      department: resolvedDept,
      phone: dirEmp?.phone || '',
      email: dirEmp?.email || '',
      isCompliant: calc.isCompliant,
      lateDaysCount: calc.lateDaysCount,
      totalLateMinutes: calc.totalLateMinutes,
      earlyLeaveMinutes: calc.earlyLeaveMinutes,
      missingPunchDays: calc.missingPunchDays,
      absentDays: calc.absentDays,
      presentDays: calc.presentDays,
      decision,
      excusedDates,
      days: calc.days,
      lastNotifiedAt: '',
      lastNotificationStatus: 'none',
      unmapped: !dirEmp,
    });
  }

  // 2. Append remaining active directory employees who had zero punches in the file (genuinely absent)
  const remainingDirectory = activeEmployees
    .filter((emp) => !matchedDirEmpIds.has(emp.id))
    .sort((a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }));

  for (const dirEmp of remainingDirectory) {
    const empCode = sanitizeCode(dirEmp.empCode) || dirEmp.empCode;
    const excusedDates = existingExcuses[empCode] || [];
    const calc = evaluateEmployeeDays(new Map<string, RawPunch[]>(), weekSunday, settings, excusedDates);
    const prevDecision = existingDecisions[empCode];
    const decision: ManagerDecision = calc.isCompliant
      ? 'reward'
      : prevDecision && prevDecision !== 'reward'
      ? prevDecision
      : 'pending';

    evaluations.push({
      empCode,
      employeeName: dirEmp.name,
      department: dirEmp.department || 'غير محدد',
      phone: dirEmp.phone || '',
      email: dirEmp.email || '',
      isCompliant: calc.isCompliant,
      lateDaysCount: calc.lateDaysCount,
      totalLateMinutes: calc.totalLateMinutes,
      earlyLeaveMinutes: calc.earlyLeaveMinutes,
      missingPunchDays: calc.missingPunchDays,
      absentDays: calc.absentDays,
      presentDays: calc.presentDays,
      decision,
      excusedDates,
      days: calc.days,
      lastNotifiedAt: '',
      lastNotificationStatus: 'none',
      unmapped: false,
    });
  }

  evaluations.sort((a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }));

  return { evaluations, unmappedCodes };
}

export function recalculateSingleEvaluation(
  ev: EmployeeEvaluation,
  weekSunday: string,
  settings: UserSettings,
  newExcusedDates: string[]
): EmployeeEvaluation {
  // Rebuild pseudo-punches from stored days so recalculation works even without re-uploading the raw file
  const byDate = new Map<string, RawPunch[]>();
  for (const day of ev.days) {
    const list: RawPunch[] = [];
    if (day.firstIn) {
      list.push({
        empCode: ev.empCode,
        date: day.date,
        time: day.firstIn,
        timestamp: `${day.date} ${day.firstIn}:00`,
        minutesFromMidnight: parseTimeToMinutes(day.firstIn),
      });
    }
    if (day.lastOut) {
      list.push({
        empCode: ev.empCode,
        date: day.date,
        time: day.lastOut,
        timestamp: `${day.date} ${day.lastOut}:00`,
        minutesFromMidnight: parseTimeToMinutes(day.lastOut),
      });
    }
    if (list.length > 0) {
      byDate.set(day.date, list);
    }
  }

  const calc = evaluateEmployeeDays(byDate, weekSunday, settings, newExcusedDates);
  const nextDecision: ManagerDecision = calc.isCompliant
    ? 'reward'
    : ev.decision === 'reward'
    ? 'pending'
    : ev.decision;

  return {
    ...ev,
    ...calc,
    excusedDates: newExcusedDates,
    decision: nextDecision,
  };
}

export function renderDecisionMessage(
  decision: Exclude<ManagerDecision, 'pending'>,
  ev: Pick<
    EmployeeEvaluation,
    'employeeName' | 'totalLateMinutes' | 'lateDaysCount' | 'missingPunchDays' | 'absentDays'
  >,
  weekLabel: string,
  settings: UserSettings
): string {
  const template =
    decision === 'reward' || decision === 'allow_same'
      ? settings.templateReward
      : decision === 'allow_with_warning'
      ? settings.templateAllowWithWarning
      : settings.templateDenyReward;

  return template
    .replaceAll('{الاسم}', ev.employeeName)
    .replaceAll('{الأسبوع}', weekLabel)
    .replaceAll('{دقائق_التأخير}', String(ev.totalLateMinutes))
    .replaceAll('{أيام_التأخير}', String(ev.lateDaysCount))
    .replaceAll('{البصمات_الناقصة}', String(ev.missingPunchDays))
    .replaceAll('{أيام_الغياب}', String(ev.absentDays));
}

export function normalizePhoneNumber(raw: string, defaultCountryCode = '966'): string {
  const digits = toAsciiDigits(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  const cc = toAsciiDigits(defaultCountryCode).replace(/[^\d]/g, '') || '966';
  let normalized = digits.startsWith('00') ? digits.slice(2) : digits;

  // Handle common mistake: country code followed by local leading zero (e.g. +966 0501234567)
  if (
    normalized.startsWith(`${cc}0`) &&
    normalized.length >= cc.length + 9 &&
    normalized.length <= cc.length + 11
  ) {
    return `${cc}${normalized.slice(cc.length + 1)}`;
  }

  if (normalized.startsWith('0') && normalized.length >= 9 && normalized.length <= 11) {
    return `${cc}${normalized.slice(1)}`;
  }
  if (normalized.length === 9 && normalized.startsWith('5')) {
    return `${cc}${normalized}`;
  }
  return normalized;
}

export function buildWhatsAppWebUrl(
  rawPhone: string,
  message: string,
  defaultCountryCode = '966'
): string | null {
  const phone = normalizePhoneNumber(rawPhone, defaultCountryCode);
  if (!phone || phone.length < 8) return null;
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppAppUrl(
  rawPhone: string,
  message: string,
  defaultCountryCode = '966'
): string | null {
  const phone = normalizePhoneNumber(rawPhone, defaultCountryCode);
  if (!phone || phone.length < 8) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export interface EvaluationWorkflowGroups {
  pending: EmployeeEvaluation[];
  ready: EmployeeEvaluation[];
  sent: EmployeeEvaluation[];
}

/**
 * Partitions weekly evaluations into 3 mutually exclusive action-status groups:
 * 1) pending: No manager decision taken yet
 * 2) ready: Decision finalized and ready to send via WhatsApp / Email
 * 3) sent: Notification already dispatched
 */
export function groupEvaluationsByWorkflow(
  evaluations: EmployeeEvaluation[]
): EvaluationWorkflowGroups {
  const pending: EmployeeEvaluation[] = [];
  const ready: EmployeeEvaluation[] = [];
  const sent: EmployeeEvaluation[] = [];

  for (const ev of evaluations) {
    if (ev.lastNotificationStatus === 'sent') {
      sent.push(ev);
    } else if (ev.decision === 'pending') {
      pending.push(ev);
    } else {
      ready.push(ev);
    }
  }

  return { pending, ready, sent };
}

