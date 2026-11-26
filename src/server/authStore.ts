import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizePermissions,
  ROLE_PRESETS,
  validateAdminSafety,
  isValidRole,
} from '../lib/authPermissions.ts';
import {
  DEFAULT_SETTINGS,
  type ActivityLog,
  type AppUserAccount,
  type Employee,
  type EmployeeEvaluation,
  type ManagerDecision,
  type NotificationStatus,
  type UserPermissions,
  type UserRole,
  type UserSettings,
  type WeeklyBatch,
} from '../types.ts';

interface StoredUserRecord extends AppUserAccount {
  passwordHash: string;
  passwordSalt: string;
}

export interface WorkspaceSnapshot {
  employees: Employee[];
  batches: WeeklyBatch[];
  evaluationsByBatch: Record<string, EmployeeEvaluation[]>;
  activityLogs: ActivityLog[];
  settings: UserSettings;
}

interface PersistedDataFile {
  version: 1;
  sessionSecretHex?: string;
  users: StoredUserRecord[];
  workspace: WorkspaceSnapshot;
}

interface SessionPayload {
  sub: string;
  jti: string;
  exp: number;
  isEnvAdmin?: boolean;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashPassword(password: string, saltHex?: string): { hash: string; salt: string } {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

function verifyPassword(password: string, hashHex: string, saltHex: string): boolean {
  try {
    const derived = crypto.scryptSync(password, saltHex, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function toPublicUser(record: StoredUserRecord): AppUserAccount {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    permissions: normalizePermissions(record.permissions, record.role),
    active: record.active,
    isEnvAdmin: record.isEnvAdmin,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class IndibatAuthStore {
  private readonly filePath: string;
  private readonly sessionSecret: Buffer;
  private readonly revokedJtis = new Set<string>();
  private data: PersistedDataFile;

  constructor(storeFilePath?: string, customSecret?: string) {
    this.filePath =
      storeFilePath || path.resolve(process.cwd(), '.data', 'indibat-store.json');
    this.data = this.loadFromDisk();
    const envSecret = customSecret ?? process.env.SESSION_SECRET?.trim();
    if (envSecret) {
      this.sessionSecret = crypto.createHash('sha256').update(envSecret).digest();
    } else if (
      typeof this.data.sessionSecretHex === 'string' &&
      /^[0-9a-f]{64}$/i.test(this.data.sessionSecretHex)
    ) {
      this.sessionSecret = Buffer.from(this.data.sessionSecretHex, 'hex');
    } else {
      const generated = crypto.randomBytes(32);
      this.sessionSecret = generated;
      this.data.sessionSecretHex = generated.toString('hex');
    }
  }

  private createEmptyData(): PersistedDataFile {
    return {
      version: 1,
      users: [],
      workspace: {
        employees: [],
        batches: [],
        evaluationsByBatch: {},
        activityLogs: [],
        settings: { ...DEFAULT_SETTINGS },
      },
    };
  }

  private loadFromDisk(): PersistedDataFile {
    try {
      if (!fs.existsSync(this.filePath)) {
        return this.createEmptyData();
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedDataFile>;
      const empty = this.createEmptyData();
      return {
        version: 1,
        sessionSecretHex:
          typeof parsed.sessionSecretHex === 'string' ? parsed.sessionSecretHex : undefined,
        users: Array.isArray(parsed.users) ? parsed.users : [],
        workspace: {
          employees: Array.isArray(parsed.workspace?.employees)
            ? parsed.workspace.employees
            : [],
          batches: Array.isArray(parsed.workspace?.batches) ? parsed.workspace.batches : [],
          evaluationsByBatch:
            parsed.workspace?.evaluationsByBatch &&
            typeof parsed.workspace.evaluationsByBatch === 'object'
              ? parsed.workspace.evaluationsByBatch
              : {},
          activityLogs: Array.isArray(parsed.workspace?.activityLogs)
            ? parsed.workspace.activityLogs
            : [],
          settings: {
            ...empty.workspace.settings,
            ...(parsed.workspace?.settings || {}),
          },
        },
      };
    } catch {
      return this.createEmptyData();
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmpPath, this.filePath);
  }

  private getEnvAdminConfig(): { username: string; passcode: string } | null {
    const passcode = process.env.ADMIN_PASSCODE?.trim();
    if (!passcode) return null;
    const username = normalizeUsername(process.env.ADMIN_USERNAME?.trim() || 'admin');
    return { username, passcode };
  }

  public getAuthStatus(): { initialized: boolean; envAdminEnabled: boolean } {
    const envAdmin = this.getEnvAdminConfig();
    return {
      initialized: this.data.users.length > 0 || Boolean(envAdmin),
      envAdminEnabled: Boolean(envAdmin),
    };
  }

  public signSessionToken(userId: string, isEnvAdmin = false): string {
    if (this.data.sessionSecretHex && !fs.existsSync(this.filePath)) {
      this.persist();
    }
    const payload: SessionPayload = {
      sub: userId,
      jti: crypto.randomBytes(16).toString('hex'),
      exp: Date.now() + SESSION_TTL_MS,
      isEnvAdmin,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${sig}`;
  }

  public verifySessionToken(token: string): AppUserAccount | null {
    if (!token || !token.includes('.')) return null;
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;

    const expectedSig = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(encoded)
      .digest('base64url');
    if (!safeEqualStrings(sig, expectedSig)) return null;

    try {
      const payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8')
      ) as SessionPayload;
      if (!payload?.sub || !payload?.jti || typeof payload.exp !== 'number') return null;
      if (Date.now() > payload.exp) return null;
      if (this.revokedJtis.has(payload.jti)) return null;

      if (payload.isEnvAdmin) {
        const envAdmin = this.getEnvAdminConfig();
        if (!envAdmin || payload.sub !== 'env_admin') return null;
        return {
          id: 'env_admin',
          username: envAdmin.username,
          displayName: 'مدير النظام الرئيسي',
          role: 'super_admin',
          permissions: { ...ROLE_PRESETS.super_admin },
          active: true,
          isEnvAdmin: true,
          createdAt: '',
          updatedAt: '',
        };
      }

      const record = this.data.users.find((u) => u.id === payload.sub);
      if (!record || !record.active) return null;
      return toPublicUser(record);
    } catch {
      return null;
    }
  }

  public revokeSessionToken(token: string): void {
    const [encoded] = token.split('.');
    if (!encoded) return;
    try {
      const payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8')
      ) as SessionPayload;
      if (payload?.jti) {
        this.revokedJtis.add(payload.jti);
      }
    } catch {
      // Ignore malformed tokens on logout
    }
  }

  /**
   * One-time atomic bootstrap route to create the very first Super Admin account
   * with any username & password chosen by the user (no complexity restrictions).
   */
  public bootstrapFirstAdmin(input: {
    username: string;
    password: string;
    displayName?: string;
  }): { ok: true; user: AppUserAccount; token: string } | { ok: false; status: number; error: string } {
    if (this.data.users.length > 0 || this.getEnvAdminConfig()) {
      return {
        ok: false,
        status: 409,
        error: 'تم إعداد حساب المدير مسبقاً. يرجى تسجيل الدخول باسم المستخدم والرقم السري.',
      };
    }

    const username = normalizeUsername(input.username);
    const password = String(input.password ?? '');
    const displayName = (input.displayName || '').trim() || input.username.trim();

    if (!username || username.length > 64) {
      return { ok: false, status: 400, error: 'يرجى إدخال اسم مستخدم صالح.' };
    }
    if (!password || password.length > 128) {
      return { ok: false, status: 400, error: 'يرجى إدخال الرقم السري.' };
    }

    const { hash, salt } = hashPassword(password);
    const nowIso = new Date().toISOString();
    const record: StoredUserRecord = {
      id: `usr_${crypto.randomBytes(8).toString('hex')}`,
      username,
      displayName: displayName.slice(0, 120),
      role: 'super_admin',
      permissions: { ...ROLE_PRESETS.super_admin },
      active: true,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.data.users.push(record);
    this.persist();
    const user = toPublicUser(record);
    const token = this.signSessionToken(user.id, false);
    return { ok: true, user, token };
  }

  public authenticate(
    rawUsername: string,
    rawPassword: string
  ): { ok: true; user: AppUserAccount; token: string } | { ok: false; status: number; error: string } {
    const username = normalizeUsername(rawUsername);
    const password = String(rawPassword ?? '');

    if (!username || !password) {
      return { ok: false, status: 400, error: 'يرجى إدخال اسم المستخدم والرقم السري.' };
    }

    // 1. Env override super admin (if ADMIN_PASSCODE is configured)
    const envAdmin = this.getEnvAdminConfig();
    if (envAdmin && safeEqualStrings(username, envAdmin.username)) {
      if (safeEqualStrings(password, envAdmin.passcode)) {
        const user: AppUserAccount = {
          id: 'env_admin',
          username: envAdmin.username,
          displayName: 'مدير النظام الرئيسي',
          role: 'super_admin',
          permissions: { ...ROLE_PRESETS.super_admin },
          active: true,
          isEnvAdmin: true,
          createdAt: '',
          updatedAt: '',
        };
        const token = this.signSessionToken('env_admin', true);
        return { ok: true, user, token };
      }
      return { ok: false, status: 401, error: 'اسم المستخدم أو الرقم السري غير صحيح.' };
    }

    // 2. Persisted user accounts (scrypt hash verification)
    const record = this.data.users.find((u) => u.username === username);
    if (!record || !verifyPassword(password, record.passwordHash, record.passwordSalt)) {
      return { ok: false, status: 401, error: 'اسم المستخدم أو الرقم السري غير صحيح.' };
    }

    if (!record.active) {
      return { ok: false, status: 403, error: 'تم إيقاف هذا الحساب من قِبل مدير النظام.' };
    }

    const user = toPublicUser(record);
    const token = this.signSessionToken(user.id, false);
    return { ok: true, user, token };
  }

  // --- User & Permission Management (Admin RBAC Control Panel) ---
  public listUsers(): AppUserAccount[] {
    return this.data.users.map(toPublicUser);
  }

  public createUser(input: {
    username: string;
    password: string;
    displayName: string;
    role: UserRole;
    permissions?: Partial<UserPermissions>;
    active?: boolean;
  }): { ok: true; user: AppUserAccount } | { ok: false; status: number; error: string } {
    const username = normalizeUsername(input.username || '');
    const password = String(input.password ?? '');
    const displayName = (input.displayName || '').trim() || input.username.trim();
    const role: UserRole = isValidRole(input.role) ? input.role : 'viewer';

    if (!username || username.length > 64) {
      return { ok: false, status: 400, error: 'يرجى إدخال اسم مستخدم صالح.' };
    }
    if (!password || password.length > 128) {
      return { ok: false, status: 400, error: 'يرجى إدخال الرقم السري للمستخدم.' };
    }
    if (this.data.users.some((u) => u.username === username)) {
      return { ok: false, status: 409, error: `اسم المستخدم (${username}) مستخدم مسبقاً.` };
    }

    const { hash, salt } = hashPassword(password);
    const nowIso = new Date().toISOString();
    const record: StoredUserRecord = {
      id: `usr_${crypto.randomBytes(8).toString('hex')}`,
      username,
      displayName: displayName.slice(0, 120),
      role,
      permissions: normalizePermissions(input.permissions, role),
      active: input.active !== false,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.data.users.push(record);
    this.persist();
    return { ok: true, user: toPublicUser(record) };
  }

  public updateUser(
    id: string,
    input: {
      username?: string;
      displayName?: string;
      role?: UserRole;
      permissions?: Partial<UserPermissions>;
      active?: boolean;
    }
  ): { ok: true; user: AppUserAccount } | { ok: false; status: number; error: string } {
    const idx = this.data.users.findIndex((u) => u.id === id);
    if (idx === -1) return { ok: false, status: 404, error: 'المستخدم غير موجود.' };

    const current = this.data.users[idx];
    const nextUsername =
      typeof input.username === 'string' && input.username.trim()
        ? normalizeUsername(input.username)
        : current.username;

    if (
      nextUsername !== current.username &&
      this.data.users.some((u) => u.id !== id && u.username === nextUsername)
    ) {
      return { ok: false, status: 409, error: `اسم المستخدم (${nextUsername}) مستخدم مسبقاً.` };
    }

    const nextRole: UserRole = isValidRole(input.role) ? input.role : current.role;
    const nextActive = typeof input.active === 'boolean' ? input.active : current.active;

    const safety = validateAdminSafety(this.data.users, id, {
      type: 'update',
      nextRole,
      nextActive,
    });
    if (!safety.ok) {
      return { ok: false, status: 400, error: safety.error || 'عملية غير مسموح بها.' };
    }

    const updated: StoredUserRecord = {
      ...current,
      username: nextUsername.slice(0, 64),
      displayName:
        typeof input.displayName === 'string' && input.displayName.trim()
          ? input.displayName.trim().slice(0, 120)
          : current.displayName,
      role: nextRole,
      permissions: normalizePermissions(input.permissions ?? current.permissions, nextRole),
      active: nextActive,
      updatedAt: new Date().toISOString(),
    };

    this.data.users[idx] = updated;
    this.persist();
    return { ok: true, user: toPublicUser(updated) };
  }

  public updateUserPassword(
    id: string,
    newPassword: string
  ): { ok: true } | { ok: false; status: number; error: string } {
    const idx = this.data.users.findIndex((u) => u.id === id);
    if (idx === -1) return { ok: false, status: 404, error: 'المستخدم غير موجود.' };

    const password = String(newPassword ?? '');
    if (!password || password.length > 128) {
      return { ok: false, status: 400, error: 'يرجى إدخال الرقم السري الجديد.' };
    }

    const { hash, salt } = hashPassword(password);
    this.data.users[idx] = {
      ...this.data.users[idx],
      passwordHash: hash,
      passwordSalt: salt,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return { ok: true };
  }

  public deleteUser(id: string): { ok: true } | { ok: false; status: number; error: string } {
    const safety = validateAdminSafety(this.data.users, id, { type: 'delete' });
    if (!safety.ok) {
      return { ok: false, status: 400, error: safety.error || 'لا يمكن حذف هذا المستخدم.' };
    }
    this.data.users = this.data.users.filter((u) => u.id !== id);
    this.persist();
    return { ok: true };
  }

  // --- Shared Organization Workspace Persistence ---
  public getWorkspace(): WorkspaceSnapshot {
    return this.data.workspace;
  }

  public saveEmployee(
    actorId: string,
    emp: Omit<Employee, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ): Employee {
    const nowIso = new Date().toISOString();
    if (existingId) {
      const idx = this.data.workspace.employees.findIndex((e) => e.id === existingId);
      if (idx !== -1) {
        const updated: Employee = {
          ...this.data.workspace.employees[idx],
          ...emp,
          updatedAt: nowIso,
        };
        this.data.workspace.employees[idx] = updated;
        this.persist();
        return updated;
      }
    }

    const created: Employee = {
      ...emp,
      id: `emp_${crypto.randomBytes(6).toString('hex')}`,
      ownerId: actorId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.data.workspace.employees.push(created);
    this.data.workspace.employees.sort((a, b) =>
      a.empCode.localeCompare(b.empCode, undefined, { numeric: true })
    );
    this.persist();
    return created;
  }

  public deleteEmployee(id: string): void {
    this.data.workspace.employees = this.data.workspace.employees.filter((e) => e.id !== id);
    this.persist();
  }

  public createWeeklyBatch(
    actorId: string,
    weekKey: string,
    weekLabel: string,
    fileName: string,
    rawEvals: Array<Omit<EmployeeEvaluation, 'id' | 'ownerId' | 'batchId'>>
  ): { batch: WeeklyBatch; evaluations: EmployeeEvaluation[] } {
    const nowIso = new Date().toISOString();
    const batchId = `batch_${weekKey}_${Date.now()}`;
    const compliantCount = rawEvals.filter((e) => e.isCompliant).length;
    const batch: WeeklyBatch = {
      id: batchId,
      ownerId: actorId,
      weekKey: weekKey.slice(0, 32),
      weekLabel: weekLabel.slice(0, 80),
      fileName: fileName.slice(0, 160),
      totalEmployees: rawEvals.length,
      compliantCount,
      nonCompliantCount: rawEvals.length - compliantCount,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const evaluations: EmployeeEvaluation[] = rawEvals.map((ev) => ({
      ...ev,
      id: `ev_${ev.empCode}`,
      ownerId: actorId,
      batchId,
    }));

    this.data.workspace.batches = [batch, ...this.data.workspace.batches];
    this.data.workspace.evaluationsByBatch[batchId] = evaluations;
    this.persist();
    return { batch, evaluations };
  }

  public updateEvaluationDecision(
    batchId: string,
    evalId: string,
    decision: ManagerDecision
  ): EmployeeEvaluation | null {
    const list = this.data.workspace.evaluationsByBatch[batchId];
    if (!list) return null;
    const idx = list.findIndex((e) => e.id === evalId);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], decision };
    this.persist();
    return list[idx];
  }

  public updateEvaluationExcuse(
    batchId: string,
    updatedEval: EmployeeEvaluation
  ): EmployeeEvaluation | null {
    const list = this.data.workspace.evaluationsByBatch[batchId];
    if (!list) return null;
    const idx = list.findIndex((e) => e.id === updatedEval.id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...updatedEval };
    this.persist();
    return list[idx];
  }

  public updateEvaluationNotification(
    batchId: string,
    evalId: string,
    status: NotificationStatus,
    notifiedIso: string
  ): EmployeeEvaluation | null {
    const list = this.data.workspace.evaluationsByBatch[batchId];
    if (!list) return null;
    const idx = list.findIndex((e) => e.id === evalId);
    if (idx === -1) return null;
    list[idx] = {
      ...list[idx],
      lastNotificationStatus: status,
      lastNotifiedAt: notifiedIso,
    };
    this.persist();
    return list[idx];
  }

  public appendActivityLog(
    actorId: string,
    entry: Omit<ActivityLog, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ): ActivityLog {
    const nowIso = new Date().toISOString();
    const created: ActivityLog = {
      ...entry,
      id: `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      ownerId: actorId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.data.workspace.activityLogs = [created, ...this.data.workspace.activityLogs];
    this.persist();
    return created;
  }

  public updateActivityLogStatus(
    logId: string,
    status: 'sent' | 'failed',
    errorMessage = ''
  ): ActivityLog | null {
    const idx = this.data.workspace.activityLogs.findIndex((l) => l.id === logId);
    if (idx === -1) return null;
    const updated: ActivityLog = {
      ...this.data.workspace.activityLogs[idx],
      status,
      errorMessage: errorMessage.slice(0, 400),
      updatedAt: new Date().toISOString(),
    };
    this.data.workspace.activityLogs[idx] = updated;
    this.persist();
    return updated;
  }

  public saveSettings(next: Partial<UserSettings>): UserSettings {
    const clean: UserSettings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>) {
      if (next && key in next && next[key] !== undefined) {
        (clean as unknown as Record<string, unknown>)[key] = next[key];
      }
    }
    this.data.workspace.settings = clean;
    this.persist();
    return this.data.workspace.settings;
  }

  public restoreWorkspace(
    actorId: string,
    snapshot: Partial<WorkspaceSnapshot>,
    mergeOnlyIfEmpty = false
  ): WorkspaceSnapshot {
    const nowIso = new Date().toISOString();
    const shouldReplaceEmployees =
      !mergeOnlyIfEmpty || this.data.workspace.employees.length === 0;
    const shouldReplaceBatches =
      !mergeOnlyIfEmpty || this.data.workspace.batches.length === 0;
    const shouldReplaceLogs =
      !mergeOnlyIfEmpty || this.data.workspace.activityLogs.length === 0;

    if (shouldReplaceEmployees && Array.isArray(snapshot.employees)) {
      this.data.workspace.employees = snapshot.employees
        .filter((e) => e && typeof e.empCode === 'string' && typeof e.name === 'string')
        .slice(0, 5000)
        .map((e) => ({
          id:
            typeof e.id === 'string' && e.id.trim()
              ? e.id.trim().slice(0, 128)
              : `emp_${crypto.randomBytes(6).toString('hex')}`,
          ownerId: actorId,
          empCode: e.empCode.trim().slice(0, 40),
          name: e.name.trim().slice(0, 120),
          department: typeof e.department === 'string' ? e.department.trim().slice(0, 80) : 'عام',
          phone: typeof e.phone === 'string' ? e.phone.trim().slice(0, 32) : '',
          email: typeof e.email === 'string' ? e.email.trim().slice(0, 160) : '',
          active: e.active !== false,
          createdAt: typeof e.createdAt === 'string' && e.createdAt ? e.createdAt : nowIso,
          updatedAt: typeof e.updatedAt === 'string' && e.updatedAt ? e.updatedAt : nowIso,
        }))
        .sort((a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }));
    }

    if (shouldReplaceBatches && Array.isArray(snapshot.batches)) {
      const validBatches = snapshot.batches
        .filter((b) => b && typeof b.id === 'string' && typeof b.weekKey === 'string')
        .slice(0, 200)
        .map((b) => ({
          id: b.id.trim().slice(0, 128),
          ownerId: actorId,
          weekKey: b.weekKey.trim().slice(0, 32),
          weekLabel: typeof b.weekLabel === 'string' ? b.weekLabel.trim().slice(0, 80) : b.weekKey,
          fileName: typeof b.fileName === 'string' ? b.fileName.trim().slice(0, 160) : 'restored',
          totalEmployees: Number(b.totalEmployees || 0),
          compliantCount: Number(b.compliantCount || 0),
          nonCompliantCount: Number(b.nonCompliantCount || 0),
          createdAt: typeof b.createdAt === 'string' && b.createdAt ? b.createdAt : nowIso,
          updatedAt: typeof b.updatedAt === 'string' && b.updatedAt ? b.updatedAt : nowIso,
        }));
      this.data.workspace.batches = validBatches;

      if (snapshot.evaluationsByBatch && typeof snapshot.evaluationsByBatch === 'object') {
        const cleanEvals: Record<string, EmployeeEvaluation[]> = {};
        for (const b of validBatches) {
          const list = snapshot.evaluationsByBatch[b.id];
          if (Array.isArray(list)) {
            cleanEvals[b.id] = list.slice(0, 5000).map((ev) => ({
              ...ev,
              ownerId: actorId,
              batchId: b.id,
            }));
          }
        }
        this.data.workspace.evaluationsByBatch = cleanEvals;
      }
    }

    if (shouldReplaceLogs && Array.isArray(snapshot.activityLogs)) {
      this.data.workspace.activityLogs = snapshot.activityLogs
        .filter((l) => l && typeof l.empCode === 'string' && typeof l.employeeName === 'string')
        .slice(0, 5000)
        .map((l) => ({
          ...l,
          id:
            typeof l.id === 'string' && l.id.trim()
              ? l.id.trim().slice(0, 128)
              : `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          ownerId: actorId,
          createdAt: typeof l.createdAt === 'string' && l.createdAt ? l.createdAt : nowIso,
          updatedAt: typeof l.updatedAt === 'string' && l.updatedAt ? l.updatedAt : nowIso,
        }));
    }

    if (snapshot.settings && typeof snapshot.settings === 'object') {
      const cleanSettings: UserSettings = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>) {
        if (key in snapshot.settings && snapshot.settings[key] !== undefined) {
          (cleanSettings as unknown as Record<string, unknown>)[key] = snapshot.settings[key];
        }
      }
      this.data.workspace.settings = cleanSettings;
    }

    this.persist();
    return this.data.workspace;
  }

  /**
   * Non-destructive union merge used to unify Cloud Firestore (Gmail) data
   * and Username/Password workspace data into a single shared dataset.
   */
  public mergeWorkspace(
    actorId: string,
    incoming: Partial<WorkspaceSnapshot>
  ): WorkspaceSnapshot {
    const nowIso = new Date().toISOString();

    // 1. Merge employees by normalized empCode (never lose phone/email or existing employees)
    if (Array.isArray(incoming.employees)) {
      const byCode = new Map<string, Employee>();
      for (const existing of this.data.workspace.employees) {
        const key = existing.empCode.trim().toLowerCase();
        byCode.set(key, existing);
      }
      for (const raw of incoming.employees.slice(0, 5000)) {
        if (!raw || typeof raw.empCode !== 'string' || typeof raw.name !== 'string') continue;
        const empCode = raw.empCode.trim().slice(0, 40);
        const key = empCode.toLowerCase();
        const prev = byCode.get(key);
        if (!prev) {
          byCode.set(key, {
            id:
              typeof raw.id === 'string' && raw.id.trim()
                ? raw.id.trim().slice(0, 128)
                : `emp_${crypto.randomBytes(6).toString('hex')}`,
            ownerId: actorId,
            empCode,
            name: raw.name.trim().slice(0, 120),
            department: typeof raw.department === 'string' ? raw.department.trim().slice(0, 80) : 'عام',
            phone: typeof raw.phone === 'string' ? raw.phone.trim().slice(0, 32) : '',
            email: typeof raw.email === 'string' ? raw.email.trim().slice(0, 160) : '',
            active: raw.active !== false,
            createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso,
            updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : nowIso,
          });
        } else {
          // Fill in any missing contact fields & prefer newer updatedAt
          const incomingNewer =
            typeof raw.updatedAt === 'string' &&
            raw.updatedAt > (prev.updatedAt || '');
          byCode.set(key, {
            ...prev,
            name: incomingNewer && raw.name.trim() ? raw.name.trim().slice(0, 120) : prev.name,
            department:
              incomingNewer && raw.department?.trim()
                ? raw.department.trim().slice(0, 80)
                : prev.department || raw.department?.trim() || 'عام',
            phone:
              incomingNewer && raw.phone?.trim()
                ? raw.phone.trim().slice(0, 32)
                : prev.phone || raw.phone?.trim() || '',
            email:
              incomingNewer && raw.email?.trim()
                ? raw.email.trim().slice(0, 160)
                : prev.email || raw.email?.trim() || '',
            active: incomingNewer ? raw.active !== false : prev.active,
            updatedAt: incomingNewer ? raw.updatedAt || nowIso : prev.updatedAt,
          });
        }
      }
      this.data.workspace.employees = Array.from(byCode.values()).sort((a, b) =>
        a.empCode.localeCompare(b.empCode, undefined, { numeric: true })
      );
    }

    // 2. Merge weekly batches & evaluations by batch.id
    if (Array.isArray(incoming.batches)) {
      const batchMap = new Map<string, WeeklyBatch>();
      for (const b of this.data.workspace.batches) {
        batchMap.set(b.id, b);
      }
      for (const raw of incoming.batches.slice(0, 200)) {
        if (!raw || typeof raw.id !== 'string' || typeof raw.weekKey !== 'string') continue;
        const id = raw.id.trim().slice(0, 128);
        if (!batchMap.has(id)) {
          batchMap.set(id, {
            id,
            ownerId: actorId,
            weekKey: raw.weekKey.trim().slice(0, 32),
            weekLabel: typeof raw.weekLabel === 'string' ? raw.weekLabel.trim().slice(0, 80) : raw.weekKey,
            fileName: typeof raw.fileName === 'string' ? raw.fileName.trim().slice(0, 160) : 'synced',
            totalEmployees: Number(raw.totalEmployees || 0),
            compliantCount: Number(raw.compliantCount || 0),
            nonCompliantCount: Number(raw.nonCompliantCount || 0),
            createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso,
            updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : nowIso,
          });
        }
      }
      this.data.workspace.batches = Array.from(batchMap.values()).sort((a, b) =>
        (b.createdAt || b.weekKey).localeCompare(a.createdAt || a.weekKey)
      );

      if (incoming.evaluationsByBatch && typeof incoming.evaluationsByBatch === 'object') {
        for (const [batchId, list] of Object.entries(incoming.evaluationsByBatch)) {
          if (!Array.isArray(list) || list.length === 0) continue;
          const existingList = this.data.workspace.evaluationsByBatch[batchId];
          if (!existingList || existingList.length === 0) {
            this.data.workspace.evaluationsByBatch[batchId] = list.slice(0, 5000).map((ev) => ({
              ...ev,
              ownerId: actorId,
              batchId,
            }));
          }
        }
      }
    }

    // 3. Merge activity logs by log.id
    if (Array.isArray(incoming.activityLogs)) {
      const logMap = new Map<string, ActivityLog>();
      for (const l of this.data.workspace.activityLogs) {
        logMap.set(l.id, l);
      }
      for (const raw of incoming.activityLogs.slice(0, 5000)) {
        if (!raw || typeof raw.id !== 'string') continue;
        const id = raw.id.trim().slice(0, 128);
        if (!logMap.has(id)) {
          logMap.set(id, {
            ...raw,
            id,
            ownerId: actorId,
            createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso,
            updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : nowIso,
          });
        }
      }
      this.data.workspace.activityLogs = Array.from(logMap.values()).sort((a, b) =>
        (b.createdAt || '').localeCompare(a.createdAt || '')
      );
    }

    // 4. Settings: adopt incoming settings if provided and current workspace still has defaults
    if (incoming.settings && typeof incoming.settings === 'object') {
      const cleanSettings: UserSettings = { ...this.data.workspace.settings };
      for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>) {
        if (key in incoming.settings && incoming.settings[key] !== undefined) {
          const curVal = cleanSettings[key];
          const defVal = DEFAULT_SETTINGS[key];
          if (curVal === defVal && incoming.settings[key] !== defVal) {
            (cleanSettings as unknown as Record<string, unknown>)[key] = incoming.settings[key];
          }
        }
      }
      this.data.workspace.settings = cleanSettings;
    }

    this.persist();
    return this.data.workspace;
  }
}
