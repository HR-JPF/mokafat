import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { hasPermission, ROLE_PRESETS } from './src/lib/authPermissions.ts';
import { IndibatAuthStore } from './src/server/authStore.ts';
import type {
  AppUserAccount,
  Employee,
  EmployeeEvaluation,
  ManagerDecision,
  NotificationStatus,
  PermissionKey,
  UserRole,
  UserSettings,
} from './src/types.ts';

dotenv.config();

const app = express();
app.use(express.json({ limit: '5mb' }));

const authStore = new IndibatAuthStore();

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
let firebaseApiKey = '';
if (fs.existsSync(firebaseConfigPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    firebaseApiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
  } catch {
    firebaseApiKey = '';
  }
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  if (net.isIPv4(lower)) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(lower)) {
    if (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    ) {
      return true;
    }
  }
  return false;
}

function validateSafeHttpsUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    if (isPrivateOrBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface AuthedPrincipal {
  id: string;
  identifier: string;
  user: AppUserAccount;
  source: 'local' | 'firebase';
}

const SESSION_COOKIE_NAME = 'indibat_session';
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function isHttpsRequest(req: express.Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  return req.secure || req.protocol === 'https';
}

function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
  const https = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (https) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: express.Request, res: express.Response): void {
  const https = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (https) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function extractBearerToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req);
  const cookieToken = cookies[SESSION_COOKIE_NAME]?.trim();
  return cookieToken || null;
}

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email: string } | null> {
  if (!idToken || !firebaseApiKey) return null;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId || !user.emailVerified) return null;
    return { uid: user.localId, email: user.email || '' };
  } catch {
    return null;
  }
}

async function verifyRequestAuth(req: express.Request): Promise<AuthedPrincipal | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  // 1. Check custom signed username/password session token first
  const localUser = authStore.verifySessionToken(token);
  if (localUser) {
    return {
      id: localUser.id,
      identifier: localUser.username,
      user: localUser,
      source: 'local',
    };
  }

  // 2. Fallback to verified Firebase ID token (Google Sign-In)
  const fbUser = await verifyFirebaseIdToken(token);
  if (fbUser) {
    return {
      id: fbUser.uid,
      identifier: fbUser.email || fbUser.uid,
      user: {
        id: fbUser.uid,
        username: fbUser.email || fbUser.uid,
        displayName: fbUser.email || 'مدير النظام',
        role: 'super_admin',
        permissions: { ...ROLE_PRESETS.super_admin },
        active: true,
        createdAt: '',
        updatedAt: '',
      },
      source: 'firebase',
    };
  }

  return null;
}

async function requireAuth(
  req: express.Request,
  res: express.Response,
  perm?: PermissionKey
): Promise<AuthedPrincipal | null> {
  const principal = await verifyRequestAuth(req);
  if (!principal) {
    res.status(401).json({ ok: false, error: 'يرجى تسجيل الدخول أولاً.' });
    return null;
  }
  if (perm && !hasPermission(principal.user, perm)) {
    res.status(403).json({ ok: false, error: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.' });
    return null;
  }
  return principal;
}

const VALID_DECISIONS = new Set<ManagerDecision>([
  'reward',
  'allow_same',
  'allow_with_warning',
  'deny_reward',
  'pending',
]);

const VALID_NOTIF_STATUS = new Set<NotificationStatus>(['none', 'sent', 'failed', 'partial']);

// --- Auth & Session Routes ---
app.get('/api/auth/status', async (req, res) => {
  const status = authStore.getAuthStatus();
  const principal = await verifyRequestAuth(req);
  if (principal && principal.source === 'local') {
    const token = extractBearerToken(req);
    res.json({
      ...status,
      authenticated: true,
      user: principal.user,
      token: token || undefined,
    });
    return;
  }
  res.json({ ...status, authenticated: false });
});

app.post('/api/auth/setup', (req, res) => {
  const { username, password, displayName } = req.body as Record<string, unknown>;
  const result = authStore.bootstrapFirstAdmin({
    username: typeof username === 'string' ? username : '',
    password: typeof password === 'string' ? password : '',
    displayName: typeof displayName === 'string' ? displayName : '',
  });
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  setSessionCookie(req, res, result.token);
  res.status(201).json({ ok: true, token: result.token, user: result.user });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body as Record<string, unknown>;
  const result = authStore.authenticate(
    typeof username === 'string' ? username : '',
    typeof password === 'string' ? password : ''
  );
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  setSessionCookie(req, res, result.token);
  res.json({ ok: true, token: result.token, user: result.user });
});

app.get('/api/auth/me', async (req, res) => {
  const principal = await requireAuth(req, res);
  if (!principal) return;
  const token = extractBearerToken(req);
  res.json({ ok: true, user: principal.user, token: principal.source === 'local' ? token : undefined });
});

app.post('/api/auth/logout', (req, res) => {
  const token = extractBearerToken(req);
  if (token) {
    authStore.revokeSessionToken(token);
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// --- RBAC Users & Permissions Control Panel Routes ---
app.get('/api/users', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageUsers');
  if (!principal) return;
  res.json({ ok: true, users: authStore.listUsers() });
});

app.post('/api/users', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageUsers');
  if (!principal) return;
  const { username, password, displayName, role, permissions, active } = req.body as Record<
    string,
    unknown
  >;
  const result = authStore.createUser({
    username: typeof username === 'string' ? username : '',
    password: typeof password === 'string' ? password : '',
    displayName: typeof displayName === 'string' ? displayName : '',
    role: role as UserRole,
    permissions:
      permissions && typeof permissions === 'object'
        ? (permissions as Partial<AppUserAccount['permissions']>)
        : undefined,
    active: typeof active === 'boolean' ? active : true,
  });
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.status(201).json({ ok: true, user: result.user });
});

app.put('/api/users/:id', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageUsers');
  if (!principal) return;
  const { username, displayName, role, permissions, active } = req.body as Record<string, unknown>;
  const result = authStore.updateUser(req.params.id, {
    username: typeof username === 'string' ? username : undefined,
    displayName: typeof displayName === 'string' ? displayName : undefined,
    role: role as UserRole | undefined,
    permissions:
      permissions && typeof permissions === 'object'
        ? (permissions as Partial<AppUserAccount['permissions']>)
        : undefined,
    active: typeof active === 'boolean' ? active : undefined,
  });
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, user: result.user });
});

app.put('/api/users/:id/password', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageUsers');
  if (!principal) return;
  const { password } = req.body as Record<string, unknown>;
  const result = authStore.updateUserPassword(
    req.params.id,
    typeof password === 'string' ? password : ''
  );
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/users/:id', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageUsers');
  if (!principal) return;
  const result = authStore.deleteUser(req.params.id);
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true });
});

// --- Organization Workspace Persistence Routes (Server-Enforced RBAC) ---
app.get('/api/workspace', async (req, res) => {
  const principal = await requireAuth(req, res);
  if (!principal) return;
  const ws = authStore.getWorkspace();
  const canManageSettings = hasPermission(principal.user, 'manageSettings');
  const safeSettings: UserSettings = canManageSettings
    ? ws.settings
    : {
        ...ws.settings,
        smtpHost: '',
        smtpUser: '',
        whatsappPhoneNumberId: '',
        whatsappInstanceId: '',
        whatsappWebhookUrl: '',
      };

  res.json({
    ok: true,
    workspace: {
      employees: ws.employees,
      batches: ws.batches,
      evaluationsByBatch: ws.evaluationsByBatch,
      activityLogs: hasPermission(principal.user, 'viewLogs') ? ws.activityLogs : [],
      settings: safeSettings,
    },
  });
});

app.post('/api/workspace/employees', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageEmployees');
  if (!principal) return;
  const body = req.body as Partial<Employee>;
  const empCode = typeof body.empCode === 'string' ? body.empCode.trim().slice(0, 40) : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!empCode || !name) {
    res.status(400).json({ ok: false, error: 'الرقم الوظيفي واسم الموظف مطلوبان.' });
    return;
  }
  const saved = authStore.saveEmployee(principal.id, {
    empCode,
    name,
    department: typeof body.department === 'string' ? body.department.trim().slice(0, 80) : 'عام',
    phone: typeof body.phone === 'string' ? body.phone.trim().slice(0, 32) : '',
    email: typeof body.email === 'string' ? body.email.trim().slice(0, 160) : '',
    active: body.active !== false,
  });
  res.status(201).json({ ok: true, employee: saved });
});

app.put('/api/workspace/employees/:id', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageEmployees');
  if (!principal) return;
  const body = req.body as Partial<Employee>;
  const empCode = typeof body.empCode === 'string' ? body.empCode.trim().slice(0, 40) : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!empCode || !name) {
    res.status(400).json({ ok: false, error: 'الرقم الوظيفي واسم الموظف مطلوبان.' });
    return;
  }
  const saved = authStore.saveEmployee(
    principal.id,
    {
      empCode,
      name,
      department: typeof body.department === 'string' ? body.department.trim().slice(0, 80) : 'عام',
      phone: typeof body.phone === 'string' ? body.phone.trim().slice(0, 32) : '',
      email: typeof body.email === 'string' ? body.email.trim().slice(0, 160) : '',
      active: body.active !== false,
    },
    req.params.id
  );
  res.json({ ok: true, employee: saved });
});

app.delete('/api/workspace/employees/:id', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageEmployees');
  if (!principal) return;
  authStore.deleteEmployee(req.params.id);
  res.json({ ok: true });
});

app.post('/api/workspace/batches', async (req, res) => {
  const principal = await requireAuth(req, res, 'uploadAttendance');
  if (!principal) return;
  const { weekKey, weekLabel, fileName, evaluations } = req.body as {
    weekKey?: string;
    weekLabel?: string;
    fileName?: string;
    evaluations?: Array<Omit<EmployeeEvaluation, 'id' | 'ownerId' | 'batchId'>>;
  };
  if (!weekKey || !weekLabel || !fileName || !Array.isArray(evaluations)) {
    res.status(400).json({ ok: false, error: 'بيانات ملف البصمة غير مكتملة.' });
    return;
  }
  const created = authStore.createWeeklyBatch(
    principal.id,
    weekKey,
    weekLabel,
    fileName,
    evaluations
  );
  res.status(201).json({ ok: true, ...created });
});

app.patch('/api/workspace/batches/:batchId/evaluations/:evalId/decision', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageDecisions');
  if (!principal) return;
  const { decision } = req.body as { decision?: ManagerDecision };
  if (!decision || !VALID_DECISIONS.has(decision)) {
    res.status(400).json({ ok: false, error: 'قيمة القرار غير صالحة.' });
    return;
  }
  const updated = authStore.updateEvaluationDecision(req.params.batchId, req.params.evalId, decision);
  if (!updated) {
    res.status(404).json({ ok: false, error: 'سجل التقييم غير موجود.' });
    return;
  }
  res.json({ ok: true, evaluation: updated });
});

app.patch('/api/workspace/batches/:batchId/evaluations/:evalId/excuse', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageDecisions');
  if (!principal) return;
  const { evaluation } = req.body as { evaluation?: EmployeeEvaluation };
  if (!evaluation || evaluation.id !== req.params.evalId) {
    res.status(400).json({ ok: false, error: 'بيانات التقييم غير صالحة.' });
    return;
  }
  const updated = authStore.updateEvaluationExcuse(req.params.batchId, evaluation);
  if (!updated) {
    res.status(404).json({ ok: false, error: 'سجل التقييم غير موجود.' });
    return;
  }
  res.json({ ok: true, evaluation: updated });
});

app.patch('/api/workspace/batches/:batchId/evaluations/:evalId/notification', async (req, res) => {
  const principal = await requireAuth(req, res, 'sendNotifications');
  if (!principal) return;
  const { status, notifiedIso } = req.body as {
    status?: NotificationStatus;
    notifiedIso?: string;
  };
  if (!status || !VALID_NOTIF_STATUS.has(status)) {
    res.status(400).json({ ok: false, error: 'حالة الإرسال غير صالحة.' });
    return;
  }
  const updated = authStore.updateEvaluationNotification(
    req.params.batchId,
    req.params.evalId,
    status,
    typeof notifiedIso === 'string' ? notifiedIso : new Date().toISOString()
  );
  if (!updated) {
    res.status(404).json({ ok: false, error: 'سجل التقييم غير موجود.' });
    return;
  }
  res.json({ ok: true, evaluation: updated });
});

app.post('/api/workspace/logs', async (req, res) => {
  const principal = await requireAuth(req, res, 'sendNotifications');
  if (!principal) return;
  const body = req.body as Record<string, unknown>;
  const created = authStore.appendActivityLog(principal.id, {
    batchId: String(body.batchId || ''),
    weekKey: String(body.weekKey || ''),
    weekLabel: String(body.weekLabel || ''),
    empCode: String(body.empCode || ''),
    employeeName: String(body.employeeName || ''),
    recipient: String(body.recipient || ''),
    decision: (body.decision as Exclude<ManagerDecision, 'pending'>) || 'reward',
    channel: (body.channel as 'whatsapp_api' | 'whatsapp_web' | 'email') || 'whatsapp_web',
    status: (body.status as 'sent' | 'failed' | 'pending') || 'sent',
    messagePreview: String(body.messagePreview || '').slice(0, 1500),
    errorMessage: String(body.errorMessage || '').slice(0, 400),
    sentByEmail: principal.identifier,
  });
  res.status(201).json({ ok: true, log: created });
});

app.patch('/api/workspace/logs/:logId', async (req, res) => {
  const principal = await requireAuth(req, res, 'sendNotifications');
  if (!principal) return;
  const { status, errorMessage } = req.body as { status?: 'sent' | 'failed'; errorMessage?: string };
  if (status !== 'sent' && status !== 'failed') {
    res.status(400).json({ ok: false, error: 'حالة السجل غير صالحة.' });
    return;
  }
  const updated = authStore.updateActivityLogStatus(req.params.logId, status, errorMessage || '');
  if (!updated) {
    res.status(404).json({ ok: false, error: 'السجل غير موجود.' });
    return;
  }
  res.json({ ok: true, log: updated });
});

app.put('/api/workspace/settings', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageSettings');
  if (!principal) return;
  const body = req.body as UserSettings;
  const saved = authStore.saveSettings(body);
  res.json({ ok: true, settings: saved });
});

app.post('/api/workspace/restore', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageEmployees');
  if (!principal) return;
  const body = req.body as {
    mergeOnlyIfEmpty?: boolean;
    workspace?: {
      employees?: Employee[];
      batches?: unknown[];
      evaluationsByBatch?: Record<string, EmployeeEvaluation[]>;
      activityLogs?: unknown[];
      settings?: UserSettings;
    };
  };
  if (!body?.workspace || typeof body.workspace !== 'object') {
    res.status(400).json({ ok: false, error: 'بيانات النسخة الاحتياطية غير صالحة.' });
    return;
  }
  const restored = authStore.restoreWorkspace(
    principal.id,
    body.workspace as Parameters<typeof authStore.restoreWorkspace>[1],
    Boolean(body.mergeOnlyIfEmpty)
  );
  res.json({ ok: true, workspace: restored });
});

app.post('/api/workspace/sync', async (req, res) => {
  const principal = await requireAuth(req, res, 'manageEmployees');
  if (!principal) return;
  const body = req.body as {
    workspace?: Parameters<typeof authStore.mergeWorkspace>[1];
  };
  if (!body?.workspace || typeof body.workspace !== 'object') {
    res.status(400).json({ ok: false, error: 'بيانات المزامنة غير صالحة.' });
    return;
  }
  const merged = authStore.mergeWorkspace(principal.id, body.workspace);
  res.json({ ok: true, workspace: merged });
});

// --- Server Config Readiness Flags ---
app.get('/api/config/status', (_req, res) => {
  res.json({
    whatsappCloudConfigured: Boolean(process.env.WHATSAPP_API_TOKEN?.trim()),
    whatsappUltramsgConfigured: Boolean(process.env.WHATSAPP_ULTRAMSG_TOKEN?.trim()),
    whatsappWebhookSecretConfigured: Boolean(process.env.WHATSAPP_WEBHOOK_SECRET?.trim()),
    smtpPasswordConfigured: Boolean(process.env.SMTP_PASS?.trim()),
  });
});

// --- Notification Dispatch Routes (Supports Username/Password Bearer + Firebase Token) ---
app.post('/api/notifications/whatsapp', async (req, res) => {
  const principal = await requireAuth(req, res, 'sendNotifications');
  if (!principal) return;

  const {
    provider,
    phone,
    message,
    phoneNumberId,
    instanceId,
    webhookUrl,
  } = req.body as Record<string, unknown>;

  const cleanPhone = typeof phone === 'string' ? phone.replace(/[^\d]/g, '') : '';
  const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 1500) : '';

  if (!cleanPhone || cleanPhone.length < 8 || !cleanMessage) {
    res.status(400).json({ ok: false, error: 'رقم الواتساب أو نص الرسالة غير صالح.' });
    return;
  }

  try {
    if (provider === 'cloud_api') {
      const token = process.env.WHATSAPP_API_TOKEN?.trim();
      const pid =
        typeof phoneNumberId === 'string' ? phoneNumberId.replace(/[^a-zA-Z0-9_-]/g, '') : '';
      if (!token) {
        res.status(400).json({
          ok: false,
          error:
            'رمز WHATSAPP_API_TOKEN غير مضاف في متغيرات البيئة على الخادم. يمكنك تفعيله أو استخدام خيار واتساب ويب.',
        });
        return;
      }
      if (!pid) {
        res.status(400).json({
          ok: false,
          error: 'يرجى إدخال معرف رقم الهاتف (Phone Number ID) في إعدادات الواتساب.',
        });
        return;
      }

      const apiResp = await fetch(`https://graph.facebook.com/v21.0/${pid}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'text',
          text: { body: cleanMessage },
        }),
      });
      const payload = (await apiResp.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!apiResp.ok) {
        res.status(502).json({
          ok: false,
          error: payload.error?.message || `فشل الإرسال عبر WhatsApp Cloud API (${apiResp.status}).`,
        });
        return;
      }
      res.json({ ok: true });
      return;
    }

    if (provider === 'ultramsg') {
      const token = process.env.WHATSAPP_ULTRAMSG_TOKEN?.trim();
      const inst =
        typeof instanceId === 'string' ? instanceId.replace(/[^a-zA-Z0-9_-]/g, '') : '';
      if (!token) {
        res.status(400).json({
          ok: false,
          error: 'رمز WHATSAPP_ULTRAMSG_TOKEN غير مضاف في متغيرات البيئة على الخادم.',
        });
        return;
      }
      if (!inst) {
        res.status(400).json({
          ok: false,
          error: 'يرجى إدخال معرف الجلسة (Instance ID) في إعدادات الواتساب.',
        });
        return;
      }

      const params = new URLSearchParams();
      params.set('token', token);
      params.set('to', cleanPhone);
      params.set('body', cleanMessage);

      const apiResp = await fetch(`https://api.ultramsg.com/${inst}/messages/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!apiResp.ok) {
        res.status(502).json({ ok: false, error: `فشل الإرسال عبر UltraMsg (${apiResp.status}).` });
        return;
      }
      res.json({ ok: true });
      return;
    }

    if (provider === 'webhook') {
      const safeUrl = typeof webhookUrl === 'string' ? validateSafeHttpsUrl(webhookUrl) : null;
      if (!safeUrl) {
        res.status(400).json({
          ok: false,
          error: 'رابط Webhook يجب أن يكون عنوان HTTPS عام وآمن.',
        });
        return;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();
      if (webhookSecret) {
        headers.Authorization = `Bearer ${webhookSecret}`;
      }

      const apiResp = await fetch(safeUrl.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: cleanPhone,
          message: cleanMessage,
          sender: principal.identifier,
        }),
      });
      if (!apiResp.ok) {
        res.status(502).json({ ok: false, error: `رفض خادم Webhook الطلب (${apiResp.status}).` });
        return;
      }
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: 'مزود الواتساب غير مدعوم.' });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'حدث خطأ أثناء الاتصال بمزود الواتساب.',
    });
  }
});

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

app.post('/api/notifications/email', async (req, res) => {
  const principal = await requireAuth(req, res, 'sendNotifications');
  if (!principal) return;

  const {
    to,
    subject,
    message,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    fromName,
    fromAddress,
  } = req.body as Record<string, unknown>;

  const cleanTo = typeof to === 'string' ? to.trim() : '';
  const cleanSubject =
    typeof subject === 'string' ? subject.trim().slice(0, 200) : 'إشعار نظام انضباط';
  const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 1500) : '';
  const cleanHost = typeof smtpHost === 'string' ? smtpHost.trim() : '';
  const cleanPort = typeof smtpPort === 'number' ? smtpPort : Number(smtpPort) || 587;
  const cleanUser = typeof smtpUser === 'string' ? smtpUser.trim() : '';
  const smtpPass = process.env.SMTP_PASS?.trim();

  if (!cleanTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
    res.status(400).json({ ok: false, error: 'عنوان البريد الإلكتروني للموظف غير صالح.' });
    return;
  }
  if (!cleanHost || isPrivateOrBlockedHost(cleanHost)) {
    res.status(400).json({ ok: false, error: 'عنوان خادم SMTP غير صالح أو غير مسموح.' });
    return;
  }
  if (!cleanUser || !smtpPass) {
    res.status(400).json({
      ok: false,
      error: 'يرجى ضبط اسم مستخدم SMTP وإضافة كلمة مرور SMTP_PASS في متغيرات البيئة على الخادم.',
    });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: cleanHost,
      port: Math.max(1, Math.min(65535, cleanPort)),
      secure: Boolean(smtpSecure),
      auth: {
        user: cleanUser,
        pass: smtpPass,
      },
    });

    const safeFromName =
      typeof fromName === 'string' && fromName.trim() ? fromName.trim() : 'نظام انضباط';
    const safeFromAddr =
      typeof fromAddress === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress.trim())
        ? fromAddress.trim()
        : cleanUser;

    const htmlBody = `
      <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background:#f8fafc; padding:24px; color:#0f172a;">
        <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:24px;">
          <h2 style="margin:0 0 12px; font-size:18px; color:#0f766e;">${escapeHtml(safeFromName)}</h2>
          <p style="margin:0; font-size:15px; line-height:1.8; white-space:pre-line;">${escapeHtml(cleanMessage)}</p>
          <hr style="border:none; border-top:1px solid #e2e8f0; margin:20px 0 12px;" />
          <p style="margin:0; font-size:12px; color:#64748b;">تم الإرسال آلياً عبر نظام انضباط لتقييم البصمة والمكافأة الأسبوعية.</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"${safeFromName.replaceAll('"', '')}" <${safeFromAddr}>`,
      to: cleanTo,
      subject: cleanSubject,
      text: cleanMessage,
      html: htmlBody,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : 'فشل إرسال البريد الإلكتروني عبر خادم SMTP.',
    });
  }
});

async function startServer() {
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Indibat server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
