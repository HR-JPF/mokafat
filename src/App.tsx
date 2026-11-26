import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  CheckCircle2,
  ClipboardList,
  Fingerprint,
  History,
  LogIn,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { ActivityLogView } from './components/ActivityLogView';
import { DispatchModal } from './components/DispatchModal';
import { EmployeeDirectory } from './components/EmployeeDirectory';
import { EvaluationDashboard } from './components/EvaluationDashboard';
import { LoginView } from './components/LoginView';
import { PermissionsPanel } from './components/PermissionsPanel';
import { SettingsView } from './components/SettingsView';
import {
  evaluateWeek,
  findMatchingDirectoryEmployee,
  getAvailableWeeks,
  normalizePhoneNumber,
  parseSpreadsheetMatrix,
  parseZKTecoText,
  recalculateSingleEvaluation,
  renderDecisionMessage,
  resolveEvaluationsWithDirectory,
} from './lib/attendanceEngine';
import { hasPermission, ROLE_LABELS, ROLE_PRESETS } from './lib/authPermissions';
import {
  downloadSampleZKTecoFile,
  exportWeeklyExcel,
  exportWeeklyPdf,
} from './lib/exporters';
import { auth, googleProvider, testFirestoreConnection } from './lib/firebase';
import {
  createActivityLogDoc,
  deleteEmployeeDoc,
  fetchFirestoreWorkspaceSnapshot,
  saveEmployeeDoc,
  saveUserSettingsDoc,
  saveWeeklyBatchWithEvaluations,
  subscribeActivityLogs,
  subscribeBatchEvaluations,
  subscribeEmployees,
  subscribeUserSettings,
  subscribeWeeklyBatches,
  updateActivityLogStatusDoc,
  updateEvaluationContactDoc,
  updateEvaluationDecisionDoc,
  updateEvaluationExcuseDoc,
  updateEvaluationNotificationDoc,
} from './lib/firestoreStore';
import {
  hasAnyWorkspaceData,
  loadWorkspaceBackup,
  saveWorkspaceBackup,
  type WorkspaceBackupData,
} from './lib/localBackup';
import { DEMO_EMPLOYEES, SAMPLE_ZKTECO_CONTENT } from './lib/sampleData';
import {
  DEFAULT_SETTINGS,
  type ActivityLog,
  type AppUserAccount,
  type Employee,
  type EmployeeEvaluation,
  type ManagerDecision,
  type ServerSecretsStatus,
  type UserPermissions,
  type UserRole,
  type UserSettings,
  type WeeklyBatch,
} from './types';

type ActiveView = 'dashboard' | 'employees' | 'logs' | 'settings' | 'permissions';

const DEMO_MANAGED_USERS: AppUserAccount[] = [
  {
    id: 'demo_admin',
    username: 'admin',
    displayName: 'مدير النظام (معاينة)',
    role: 'super_admin',
    permissions: { ...ROLE_PRESETS.super_admin },
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo_hr',
    username: 'hr_manager',
    displayName: 'مدير الموارد البشرية',
    role: 'hr_manager',
    permissions: { ...ROLE_PRESETS.hr_manager },
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo_viewer',
    username: 'auditor',
    displayName: 'مراقب تقارير',
    role: 'viewer',
    permissions: { ...ROLE_PRESETS.viewer },
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export default function App() {
  // Firebase Google Auth state (optional cloud mode)
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Username & Password Auth state (Bearer token kept strictly in JS memory)
  const [authInitialized, setAuthInitialized] = useState(true);
  const [authStatusLoading, setAuthStatusLoading] = useState(true);
  const [localAccount, setLocalAccount] = useState<AppUserAccount | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [managedUsers, setManagedUsers] = useState<AppUserAccount[]>([]);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const syncedServerBatchIdsRef = useRef<Set<string>>(new Set());

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Supports ?autostart=1 for instant interactive preview / verification
  const [demoMode, setDemoMode] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1';
  });

  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Core Domain State
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [settingsExistInDb, setSettingsExistInDb] = useState(false);
  const [batches, setBatches] = useState<WeeklyBatch[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [evaluationsByBatch, setEvaluationsByBatch] = useState<
    Record<string, EmployeeEvaluation[]>
  >({});
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  const [secretsStatus, setSecretsStatus] = useState<ServerSecretsStatus>({
    whatsappCloudConfigured: false,
    whatsappUltramsgConfigured: false,
    whatsappWebhookSecretConfigured: false,
    smtpPasswordConfigured: false,
  });

  // UI Transient State
  const [uploading, setUploading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchPreselected, setDispatchPreselected] = useState<string[] | undefined>(undefined);
  const [draftEmployee, setDraftEmployee] = useState<{ empCode: string; name: string } | null>(
    null
  );
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    window.setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const effectivePermissions: UserPermissions = useMemo(() => {
    if (localAccount) {
      return localAccount.role === 'super_admin'
        ? { ...ROLE_PRESETS.super_admin }
        : localAccount.permissions;
    }
    return { ...ROLE_PRESETS.super_admin };
  }, [localAccount]);

  const apiFetch = useCallback(
    async <T,>(url: string, init: RequestInit = {}, tokenOverride?: string | null): Promise<T> => {
      const token = tokenOverride !== undefined ? tokenOverride : sessionToken;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const resp = await fetch(url, { ...init, headers, credentials: 'include' });
      const data = (await resp.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
      if (!resp.ok || data.ok === false) {
        throw new Error(data.error || `خطأ في الخادم (${resp.status})`);
      }
      return data;
    },
    [sessionToken]
  );

  const loadLocalWorkspace = useCallback(
    async (token: string | null, account: AppUserAccount) => {
      const wsResp = await apiFetch<{
        ok: true;
        workspace: {
          employees: Employee[];
          batches: WeeklyBatch[];
          evaluationsByBatch: Record<string, EmployeeEvaluation[]>;
          activityLogs: ActivityLog[];
          settings: UserSettings;
        };
      }>('/api/workspace', { method: 'GET' }, token);

      let ws = wsResp.workspace;

      // If the ephemeral server disk restarted empty, auto-recover from persistent browser backup
      if (!hasAnyWorkspaceData(ws)) {
        const localBackup = await loadWorkspaceBackup();
        if (localBackup && hasAnyWorkspaceData(localBackup)) {
          ws = {
            employees: localBackup.employees || [],
            batches: localBackup.batches || [],
            evaluationsByBatch: localBackup.evaluationsByBatch || {},
            activityLogs: localBackup.activityLogs || [],
            settings: localBackup.settings || DEFAULT_SETTINGS,
          };
          if (hasPermission(account, 'manageEmployees')) {
            try {
              const restored = await apiFetch<{
                ok: true;
                workspace: typeof ws;
              }>(
                '/api/workspace/restore',
                {
                  method: 'POST',
                  body: JSON.stringify({ mergeOnlyIfEmpty: true, workspace: ws }),
                },
                token
              );
              ws = restored.workspace;
            } catch {
              // Keep restored state locally even if server restore is restricted
            }
          }
          showToast('تمت استعادة بياناتك المحفوظة تلقائياً بنجاح.');
        }
      }

      setEmployees(ws.employees || []);
      setBatches(ws.batches || []);
      setEvaluationsByBatch(ws.evaluationsByBatch || {});
      setActivityLogs(ws.activityLogs || []);
      setSettings(ws.settings || DEFAULT_SETTINGS);
      setActiveBatchId(ws.batches?.[0]?.id || null);
      setWorkspaceHydrated(true);

      if (hasPermission(account, 'manageUsers')) {
        const usersResp = await apiFetch<{ ok: true; users: AppUserAccount[] }>(
          '/api/users',
          { method: 'GET' },
          token
        );
        setManagedUsers(usersResp.users || []);
      } else {
        setManagedUsers([]);
      }
    },
    [apiFetch, showToast]
  );

  // Fetch server secret readiness + custom auth status + restore active HttpOnly session cookie on boot
  useEffect(() => {
    let cancelled = false;

    fetch('/api/config/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setSecretsStatus(data as ServerSecretsStatus);
      })
      .catch(() => {});

    fetch('/api/auth/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(async (statusData) => {
        if (cancelled) return;
        const st = statusData as {
          initialized?: boolean;
          authenticated?: boolean;
          user?: AppUserAccount;
          token?: string;
        } | null;
        if (st && typeof st.initialized === 'boolean') {
          setAuthInitialized(st.initialized);
        }
        if (st?.authenticated && st.user) {
          const restoredToken = typeof st.token === 'string' ? st.token : null;
          setSessionToken(restoredToken);
          setLocalAccount(st.user);
          setDemoMode(false);
          try {
            await loadLocalWorkspace(restoredToken, st.user);
          } catch {
            // Keep logged-in session even if workspace fetch briefly retries
          }
        }
      })
      .finally(() => {
        if (!cancelled) setAuthStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadLocalWorkspace]);

  // Hydrate browser backup in Quick Preview (demoMode) so refresh never wipes edits
  useEffect(() => {
    if (!demoMode || localAccount || user) return;
    if (managedUsers.length === 0) {
      setManagedUsers(DEMO_MANAGED_USERS);
    }
    if (workspaceHydrated) return;
    loadWorkspaceBackup()
      .then((backup) => {
        if (backup && hasAnyWorkspaceData(backup)) {
          setEmployees(backup.employees || []);
          setBatches(backup.batches || []);
          setEvaluationsByBatch(backup.evaluationsByBatch || {});
          setActivityLogs(backup.activityLogs || []);
          if (backup.settings) setSettings(backup.settings);
          setActiveBatchId(backup.batches?.[0]?.id || null);
        }
      })
      .finally(() => setWorkspaceHydrated(true));
  }, [demoMode, localAccount, user, managedUsers.length, workspaceHydrated]);

  // Automatically mirror non-secret workspace data to IndexedDB whenever it changes
  useEffect(() => {
    if (!workspaceHydrated) return;
    if (!localAccount && !user && !demoMode) return;
    if (!hasAnyWorkspaceData({ employees, batches, activityLogs })) return;
    void saveWorkspaceBackup({
      employees,
      batches,
      evaluationsByBatch,
      activityLogs,
      settings,
    });
  }, [
    workspaceHydrated,
    localAccount,
    user,
    demoMode,
    employees,
    batches,
    evaluationsByBatch,
    activityLogs,
    settings,
  ]);

  // Firebase Auth listener + startup Firestore connection check
  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) {
        setDemoMode(false);
      }
    });
    return unsub;
  }, []);

  // Load real managed users when signed in via Google (without localAccount)
  useEffect(() => {
    if (!authReady || !user || localAccount) return;
    let cancelled = false;
    user
      .getIdToken()
      .then((idToken) =>
        apiFetch<{ ok: true; users: AppUserAccount[] }>('/api/users', { method: 'GET' }, idToken)
      )
      .then((resp) => {
        if (!cancelled) setManagedUsers(resp.users || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authReady, user, localAccount, apiFetch]);

  // Firestore real-time subscriptions when authenticated via Google Sign-In
  useEffect(() => {
    if (!authReady || !user || localAccount) return;
    const unsubEmp = subscribeEmployees(user.uid, (list) => {
      setEmployees(list);
      setWorkspaceHydrated(true);
    });
    const unsubSettings = subscribeUserSettings(user.uid, (s, exists) => {
      setSettings(s);
      setSettingsExistInDb(exists);
    });
    const unsubBatches = subscribeWeeklyBatches(user.uid, (list) => {
      setBatches(list);
      setActiveBatchId((prev) =>
        prev && list.some((b) => b.id === prev) ? prev : list[0]?.id || null
      );
      setWorkspaceHydrated(true);
    });
    const unsubLogs = subscribeActivityLogs(user.uid, setActivityLogs);

    return () => {
      unsubEmp();
      unsubSettings();
      unsubBatches();
      unsubLogs();
    };
  }, [authReady, user, localAccount]);

  // Subscribe to evaluations of the active batch when authenticated via Google
  useEffect(() => {
    if (!authReady || !user || localAccount || !activeBatchId) return;
    return subscribeBatchEvaluations(user.uid, activeBatchId, (evals) => {
      setEvaluationsByBatch((prev) => ({ ...prev, [activeBatchId]: evals }));
    });
  }, [authReady, user, localAccount, activeBatchId]);

  // Two-way unification between Gmail (Cloud Firestore) and shared server workspace
  // so Gmail login and Username/Password accounts ALWAYS share the exact same data!
  useEffect(() => {
    if (!authReady || !user || localAccount || !workspaceHydrated) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const idToken = await user.getIdToken();
        const resp = await apiFetch<{
          ok: true;
          workspace: {
            employees: Employee[];
            batches: WeeklyBatch[];
            evaluationsByBatch: Record<string, EmployeeEvaluation[]>;
            activityLogs: ActivityLog[];
            settings: UserSettings;
          };
        }>(
          '/api/workspace/sync',
          {
            method: 'POST',
            body: JSON.stringify({
              workspace: {
                employees,
                batches,
                evaluationsByBatch,
                activityLogs,
                settings,
              },
            }),
          },
          idToken
        );
        if (cancelled || !resp.workspace) return;

        // Push any employees added under Username/Password into Cloud Firestore
        const existingCodes = new Set(employees.map((e) => e.empCode.trim().toLowerCase()));
        for (const srvEmp of resp.workspace.employees || []) {
          const key = srvEmp.empCode.trim().toLowerCase();
          if (!existingCodes.has(key)) {
            existingCodes.add(key);
            await saveEmployeeDoc(user.uid, {
              empCode: srvEmp.empCode,
              name: srvEmp.name,
              department: srvEmp.department,
              phone: srvEmp.phone,
              email: srvEmp.email,
              active: srvEmp.active,
            }).catch(() => {});
          }
        }

        // Push any batches uploaded under Username/Password into Cloud Firestore (once per batch)
        const existingBatchKeys = new Set(
          batches.map((b) => `${b.weekKey}|${b.fileName}|${b.totalEmployees}`)
        );
        for (const srvBatch of resp.workspace.batches || []) {
          const sig = `${srvBatch.weekKey}|${srvBatch.fileName}|${srvBatch.totalEmployees}`;
          if (existingBatchKeys.has(sig) || syncedServerBatchIdsRef.current.has(srvBatch.id)) {
            continue;
          }
          const evals = resp.workspace.evaluationsByBatch?.[srvBatch.id];
          if (Array.isArray(evals) && evals.length > 0) {
            syncedServerBatchIdsRef.current.add(srvBatch.id);
            existingBatchKeys.add(sig);
            await saveWeeklyBatchWithEvaluations(
              user.uid,
              srvBatch.weekKey,
              srvBatch.weekLabel,
              srvBatch.fileName,
              evals.map(({ id: _id, ownerId: _o, batchId: _b, ...rest }) => rest)
            ).catch(() => {});
          }
        }
      } catch {
        // Non-fatal background sync
      }
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    authReady,
    user,
    localAccount,
    workspaceHydrated,
    employees,
    batches,
    evaluationsByBatch,
    activityLogs,
    settings,
    apiFetch,
  ]);

  // When logged in with Username/Password AND Google Cloud Firestore is linked in the browser,
  // pull any existing Cloud Firestore records into the unified shared workspace automatically.
  useEffect(() => {
    if (!authReady || !user || !localAccount || !workspaceHydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const fbSnap = await fetchFirestoreWorkspaceSnapshot(user.uid);
        if (cancelled) return;
        if (
          fbSnap.employees.length > 0 ||
          fbSnap.batches.length > 0 ||
          fbSnap.activityLogs.length > 0
        ) {
          const resp = await apiFetch<{
            ok: true;
            workspace: {
              employees: Employee[];
              batches: WeeklyBatch[];
              evaluationsByBatch: Record<string, EmployeeEvaluation[]>;
              activityLogs: ActivityLog[];
              settings: UserSettings;
            };
          }>('/api/workspace/sync', {
            method: 'POST',
            body: JSON.stringify({ workspace: fbSnap }),
          });
          if (cancelled || !resp.workspace) return;
          setEmployees(resp.workspace.employees || []);
          setBatches(resp.workspace.batches || []);
          setEvaluationsByBatch(resp.workspace.evaluationsByBatch || {});
          setActivityLogs(resp.workspace.activityLogs || []);
          setSettings(resp.workspace.settings || DEFAULT_SETTINGS);
          setActiveBatchId((prev) => prev || resp.workspace.batches?.[0]?.id || null);
        }
      } catch {
        // Non-fatal cloud merge
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, user, localAccount, workspaceHydrated, apiFetch]);

  // Ensure activeView stays permitted whenever permissions change
  useEffect(() => {
    if (activeView === 'employees' && !effectivePermissions.manageEmployees) {
      setActiveView('dashboard');
    } else if (activeView === 'logs' && !effectivePermissions.viewLogs) {
      setActiveView('dashboard');
    } else if (activeView === 'settings' && !effectivePermissions.manageSettings) {
      setActiveView('dashboard');
    } else if (activeView === 'permissions' && !effectivePermissions.manageUsers) {
      setActiveView('dashboard');
    }
  }, [activeView, effectivePermissions]);

  const activeBatch = useMemo(
    () => batches.find((b) => b.id === activeBatchId) || null,
    [batches, activeBatchId]
  );

  const rawActiveEvaluations = useMemo(
    () => (activeBatchId ? evaluationsByBatch[activeBatchId] || [] : []),
    [activeBatchId, evaluationsByBatch]
  );

  const activeEvaluations = useMemo(
    () => resolveEvaluationsWithDirectory(rawActiveEvaluations, employees),
    [rawActiveEvaluations, employees]
  );

  // --- Auth Actions ---
  const handleFirstAdminSetup = async (
    username: string,
    password: string,
    displayName: string
  ) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const resp = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, displayName }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        token?: string;
        user?: AppUserAccount;
        error?: string;
      };
      if (!resp.ok || !data.ok || !data.token || !data.user) {
        setAuthError(data.error || 'تعذر إنشاء حساب المدير.');
        return;
      }
      setAuthInitialized(true);
      setSessionToken(data.token);
      setLocalAccount(data.user);
      setDemoMode(false);
      setActiveView('dashboard');
      await loadLocalWorkspace(data.token, data.user);
      showToast(`أهلاً بك ${data.user.displayName}! تم إنشاء حساب مدير النظام بنجاح.`);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'تعذر الاتصال بالخادم.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasswordLogin = async (username: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        token?: string;
        user?: AppUserAccount;
        error?: string;
      };
      if (!resp.ok || !data.ok || !data.token || !data.user) {
        setAuthError(data.error || 'اسم المستخدم أو الرقم السري غير صحيح.');
        return;
      }
      setSessionToken(data.token);
      setLocalAccount(data.user);
      setDemoMode(false);
      setActiveView('dashboard');
      await loadLocalWorkspace(data.token, data.user);
      showToast(`تم تسجيل الدخول بنجاح — ${data.user.displayName}`);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'تعذر الاتصال بالخادم.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (localAccount && cred.user) {
        // Mirror current local employees & settings into Cloud Firestore right away
        for (const emp of employees) {
          await saveEmployeeDoc(cred.user.uid, {
            empCode: emp.empCode,
            name: emp.name,
            department: emp.department,
            phone: emp.phone,
            email: emp.email,
            active: emp.active,
          }).catch(() => {});
        }
        await saveUserSettingsDoc(cred.user.uid, settings, false).catch(() => {});
        showToast('تم ربط الحفظ السحابي بحساب Google ومزامنة بياناتك بنجاح.');
      }
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'تعذر تسجيل الدخول عبر Google. تأكد من السماح بالنوافذ المنبثقة.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (localAccount || sessionToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined,
      }).catch(() => {});
    }
    if (user) {
      await signOut(auth);
    }
    setWorkspaceHydrated(false);
    setSessionToken(null);
    setLocalAccount(null);
    setManagedUsers([]);
    setDemoMode(false);
    setEmployees([]);
    setBatches([]);
    setEvaluationsByBatch({});
    setActivityLogs([]);
    setActiveBatchId(null);
    setActiveView('dashboard');
    fetch('/api/auth/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { initialized?: boolean } | null) => {
        if (data && typeof data.initialized === 'boolean') {
          setAuthInitialized(data.initialized);
        }
      })
      .catch(() => {});
  };

  // --- Attendance Upload & Demo Loader ---
  const processUploadedPunches = async (
    punches: ReturnType<typeof parseZKTecoText>,
    fileName: string,
    employeeListOverride?: Employee[]
  ) => {
    const weeks = getAvailableWeeks(punches);
    if (weeks.length === 0) {
      showToast('لم يتم العثور على بصمات صالحة لأيام الأحد إلى الخميس داخل الملف.', 'error');
      return;
    }

    const chosenWeek = weeks[0];
    const dir = employeeListOverride || employees;
    const { evaluations: rawEvals, unmappedCodes } = evaluateWeek(
      punches,
      chosenWeek.sundayDate,
      dir,
      settings
    );

    if (localAccount) {
      const resp = await apiFetch<{
        ok: true;
        batch: WeeklyBatch;
        evaluations: EmployeeEvaluation[];
      }>('/api/workspace/batches', {
        method: 'POST',
        body: JSON.stringify({
          weekKey: chosenWeek.weekKey,
          weekLabel: chosenWeek.weekLabel,
          fileName,
          evaluations: rawEvals,
        }),
      });
      setBatches((prev) => [resp.batch, ...prev]);
      setEvaluationsByBatch((prev) => ({ ...prev, [resp.batch.id]: resp.evaluations }));
      setActiveBatchId(resp.batch.id);
      if (user) {
        await saveWeeklyBatchWithEvaluations(
          user.uid,
          chosenWeek.weekKey,
          chosenWeek.weekLabel,
          fileName,
          rawEvals
        ).catch(() => {});
      }
    } else if (user) {
      const newBatchId = await saveWeeklyBatchWithEvaluations(
        user.uid,
        chosenWeek.weekKey,
        chosenWeek.weekLabel,
        fileName,
        rawEvals
      );
      setActiveBatchId(newBatchId);
    } else {
      const batchId = `demo_batch_${chosenWeek.weekKey}_${Date.now()}`;
      const compliantCount = rawEvals.filter((e) => e.isCompliant).length;
      const nowIso = new Date().toISOString();
      const newBatch: WeeklyBatch = {
        id: batchId,
        ownerId: 'demo-manager',
        weekKey: chosenWeek.weekKey,
        weekLabel: chosenWeek.weekLabel,
        fileName,
        totalEmployees: rawEvals.length,
        compliantCount,
        nonCompliantCount: rawEvals.length - compliantCount,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const fullEvals: EmployeeEvaluation[] = rawEvals.map((e) => ({
        ...e,
        id: `ev_${e.empCode}`,
        ownerId: 'demo-manager',
        batchId,
      }));
      setBatches((prev) => [newBatch, ...prev]);
      setEvaluationsByBatch((prev) => ({ ...prev, [batchId]: fullEvals }));
      setActiveBatchId(batchId);
    }

    showToast(
      unmappedCodes.length > 0
        ? `تم تحليل الأسبوع (${chosenWeek.weekLabel}) لـ ${rawEvals.length} موظف. يوجد ${unmappedCodes.length} رقم وظيفي غير مسجل في الدليل.`
        : `تم تحليل ملف البصمة بنجاح لأسبوع (${chosenWeek.weekLabel}) — ${rawEvals.length} موظف.`
    );
  };

  const handleUploadFile = async (file: File) => {
    setUploading(true);
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.ods')) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: false });
        let punches: ReturnType<typeof parseZKTecoText> = [];
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: true,
            defval: '',
          });
          const res = parseSpreadsheetMatrix(matrix);
          if (res.punches.length > 0) {
            punches = res.punches;
            break;
          }
        }
        await processUploadedPunches(punches, file.name);
      } else {
        const text = await file.text();
        let punches = parseZKTecoText(text);
        if (punches.length === 0) {
          const wb = XLSX.read(text, { type: 'string' });
          for (const sheetName of wb.SheetNames) {
            const sheet = wb.Sheets[sheetName];
            const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
              header: 1,
              raw: true,
              defval: '',
            });
            const res = parseSpreadsheetMatrix(matrix);
            if (res.punches.length > 0) {
              punches = res.punches;
              break;
            }
          }
        }
        await processUploadedPunches(punches, file.name);
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'تعذر قراءة ملف البصمة. تأكد من صحة الصيغة.',
        'error'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleLoadDemoData = async () => {
    setUploading(true);
    try {
      let currentEmployees = employees;
      if (employees.length === 0) {
        if (localAccount && effectivePermissions.manageEmployees) {
          const savedList: Employee[] = [];
          for (const emp of DEMO_EMPLOYEES) {
            const resp = await apiFetch<{ ok: true; employee: Employee }>(
              '/api/workspace/employees',
              {
                method: 'POST',
                body: JSON.stringify({
                  empCode: emp.empCode,
                  name: emp.name,
                  department: emp.department,
                  phone: emp.phone,
                  email: emp.email,
                  active: emp.active,
                }),
              }
            );
            savedList.push(resp.employee);
          }
          setEmployees(savedList);
          currentEmployees = savedList;
        } else if (user) {
          for (const emp of DEMO_EMPLOYEES) {
            await saveEmployeeDoc(user.uid, {
              empCode: emp.empCode,
              name: emp.name,
              department: emp.department,
              phone: emp.phone,
              email: emp.email,
              active: emp.active,
            });
          }
          currentEmployees = DEMO_EMPLOYEES.map((e) => ({ ...e, ownerId: user.uid }));
        } else {
          setEmployees(DEMO_EMPLOYEES);
          currentEmployees = DEMO_EMPLOYEES;
        }
      }
      const punches = parseZKTecoText(SAMPLE_ZKTECO_CONTENT);
      await processUploadedPunches(punches, 'attlog_zkteco_2026_w47.dat', currentEmployees);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تحميل البيانات التجريبية.', 'error');
    } finally {
      setUploading(false);
    }
  };

  // --- Evaluation Decision & Day Excuse ---
  const handleDecisionChange = async (ev: EmployeeEvaluation, decision: ManagerDecision) => {
    if (!activeBatchId) return;
    try {
      if (localAccount) {
        await apiFetch(
          `/api/workspace/batches/${encodeURIComponent(activeBatchId)}/evaluations/${encodeURIComponent(ev.id)}/decision`,
          { method: 'PATCH', body: JSON.stringify({ decision }) }
        );
        setEvaluationsByBatch((prev) => ({
          ...prev,
          [activeBatchId]: (prev[activeBatchId] || []).map((item) =>
            item.id === ev.id ? { ...item, decision } : item
          ),
        }));
      } else if (user) {
        await updateEvaluationDecisionDoc(activeBatchId, ev.id, decision);
      } else {
        setEvaluationsByBatch((prev) => ({
          ...prev,
          [activeBatchId]: (prev[activeBatchId] || []).map((item) =>
            item.id === ev.id ? { ...item, decision } : item
          ),
        }));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ القرار.', 'error');
    }
  };

  const handleBulkDecisionChange = async (evalIds: string[], decision: ManagerDecision) => {
    if (!activeBatchId) return;
    try {
      if (localAccount) {
        await Promise.all(
          evalIds.map((id) =>
            apiFetch(
              `/api/workspace/batches/${encodeURIComponent(activeBatchId)}/evaluations/${encodeURIComponent(id)}/decision`,
              { method: 'PATCH', body: JSON.stringify({ decision }) }
            )
          )
        );
        const idSet = new Set(evalIds);
        setEvaluationsByBatch((prev) => ({
          ...prev,
          [activeBatchId]: (prev[activeBatchId] || []).map((item) =>
            idSet.has(item.id) ? { ...item, decision } : item
          ),
        }));
      } else if (user) {
        await Promise.all(
          evalIds.map((id) => updateEvaluationDecisionDoc(activeBatchId, id, decision))
        );
      } else {
        const idSet = new Set(evalIds);
        setEvaluationsByBatch((prev) => ({
          ...prev,
          [activeBatchId]: (prev[activeBatchId] || []).map((item) =>
            idSet.has(item.id) ? { ...item, decision } : item
          ),
        }));
      }
      showToast(`تم تحديث القرار لـ ${evalIds.length} موظف.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تحديث القرارات.', 'error');
    }
  };

  const handleToggleExcuseDay = async (ev: EmployeeEvaluation, date: string) => {
    if (!activeBatch) return;
    const exists = ev.excusedDates.includes(date);
    const nextExcuses = exists
      ? ev.excusedDates.filter((d) => d !== date)
      : [...ev.excusedDates, date];
    const recalculated = recalculateSingleEvaluation(ev, activeBatch.weekKey, settings, nextExcuses);

    try {
      if (localAccount) {
        await apiFetch(
          `/api/workspace/batches/${encodeURIComponent(activeBatch.id)}/evaluations/${encodeURIComponent(ev.id)}/excuse`,
          { method: 'PATCH', body: JSON.stringify({ evaluation: recalculated }) }
        );
        setEvaluationsByBatch((prev) => ({
          ...prev,
          [activeBatch.id]: (prev[activeBatch.id] || []).map((item) =>
            item.id === ev.id ? recalculated : item
          ),
        }));
      } else if (user) {
        await updateEvaluationExcuseDoc(activeBatch.id, recalculated);
      } else {
        setEvaluationsByBatch((prev) => ({
          ...prev,
          [activeBatch.id]: (prev[activeBatch.id] || []).map((item) =>
            item.id === ev.id ? recalculated : item
          ),
        }));
      }
      showToast(
        exists
          ? `تم إلغاء استثناء يوم ${date} وإعادة احتساب الالتزام.`
          : `تم استثناء يوم ${date} وإعادة احتساب التزام ${ev.employeeName}.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تحديث الاستثناء.', 'error');
    }
  };

  // --- Employee Directory Handlers ---
  const handleSaveEmployee = async (
    emp: Omit<Employee, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => {
    const tempEmp: Employee = {
      ...emp,
      id: existingId || `tmp_${emp.empCode}`,
      ownerId: localAccount?.id || user?.uid || 'demo-manager',
    };

    if (localAccount) {
      const resp = existingId
        ? await apiFetch<{ ok: true; employee: Employee }>(
            `/api/workspace/employees/${encodeURIComponent(existingId)}`,
            { method: 'PUT', body: JSON.stringify(emp) }
          )
        : await apiFetch<{ ok: true; employee: Employee }>('/api/workspace/employees', {
            method: 'POST',
            body: JSON.stringify(emp),
          });

      setEmployees((prev) => {
        const next = existingId
          ? prev.map((x) => (x.id === existingId ? resp.employee : x))
          : [...prev, resp.employee];
        return next.sort((a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }));
      });
      if (user) {
        await saveEmployeeDoc(user.uid, emp).catch(() => {});
      }
    } else if (user) {
      await saveEmployeeDoc(user.uid, emp, existingId);
      if (activeBatchId) {
        const matches = rawActiveEvaluations.filter((ev) =>
          Boolean(findMatchingDirectoryEmployee(ev.empCode, ev.employeeName, [tempEmp]))
        );
        await Promise.all(
          matches.map((match) =>
            updateEvaluationContactDoc(activeBatchId, match.id, {
              employeeName: emp.name,
              department: emp.department,
              phone: emp.phone,
              email: emp.email,
            })
          )
        );
      }
    } else {
      if (existingId) {
        setEmployees((prev) => prev.map((x) => (x.id === existingId ? { ...x, ...emp } : x)));
      } else {
        setEmployees((prev) => [
          ...prev,
          { ...emp, id: `emp_${Date.now()}`, ownerId: 'demo-manager' },
        ]);
      }
    }

    if (activeBatchId && !user) {
      setEvaluationsByBatch((prev) => ({
        ...prev,
        [activeBatchId]: (prev[activeBatchId] || []).map((ev) =>
          findMatchingDirectoryEmployee(ev.empCode, ev.employeeName, [tempEmp])
            ? {
                ...ev,
                employeeName: emp.name,
                department: emp.department,
                phone: emp.phone,
                email: emp.email,
                unmapped: false,
              }
            : ev
        ),
      }));
    }
    showToast(`تم حفظ بيانات الموظف ${emp.name}.`);
  };

  const handleDeleteEmployee = async (id: string) => {
    try {
      if (localAccount) {
        await apiFetch(`/api/workspace/employees/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        setEmployees((prev) => prev.filter((e) => e.id !== id));
      } else if (user) {
        await deleteEmployeeDoc(id);
        const idToken = await user.getIdToken().catch(() => null);
        if (idToken) {
          await apiFetch(
            `/api/workspace/employees/${encodeURIComponent(id)}`,
            { method: 'DELETE' },
            idToken
          ).catch(() => {});
        }
      } else {
        setEmployees((prev) => prev.filter((e) => e.id !== id));
      }
      showToast('تم حذف الموظف من الدليل.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حذف الموظف.', 'error');
    }
  };

  const handleBulkImportEmployees = async (
    list: Array<Omit<Employee, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>>
  ) => {
    for (const item of list) {
      const existing = employees.find((e) => e.empCode === item.empCode);
      await handleSaveEmployee(item, existing?.id);
    }
    showToast(`تم استيراد ${list.length} موظف إلى الدليل بنجاح.`);
  };

  // --- RBAC User Management Handlers (Works for both Username/Password & Google Admins) ---
  const getAdminApiToken = async (): Promise<string | null> => {
    if (sessionToken) return sessionToken;
    if (user) return user.getIdToken();
    return null;
  };

  const handleCreateManagedUser = async (payload: {
    username: string;
    password: string;
    displayName: string;
    role: UserRole;
    permissions: UserPermissions;
    active: boolean;
  }) => {
    if (localAccount || user) {
      const token = await getAdminApiToken();
      const resp = await apiFetch<{ ok: true; user: AppUserAccount }>(
        '/api/users',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        token
      );
      setManagedUsers((prev) => [...prev, resp.user]);
      showToast(`تم إنشاء حساب المستخدم «${resp.user.displayName}» بنجاح.`);
      return;
    }

    // Local preview mode fallback
    const cleanUsername = payload.username.trim().toLowerCase();
    if (managedUsers.some((u) => u.username === cleanUsername)) {
      throw new Error(`اسم المستخدم (${cleanUsername}) مستخدم مسبقاً.`);
    }
    const nowIso = new Date().toISOString();
    const created: AppUserAccount = {
      id: `demo_usr_${Date.now()}`,
      username: cleanUsername,
      displayName: payload.displayName,
      role: payload.role,
      permissions: payload.permissions,
      active: payload.active,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setManagedUsers((prev) => [...prev, created]);
    showToast(`تم إنشاء حساب المستخدم «${created.displayName}» في وضع المعاينة.`);
  };

  const handleUpdateManagedUser = async (
    userId: string,
    payload: {
      username: string;
      displayName: string;
      role: UserRole;
      permissions: UserPermissions;
      active: boolean;
    }
  ) => {
    if (localAccount || user) {
      const token = await getAdminApiToken();
      const resp = await apiFetch<{ ok: true; user: AppUserAccount }>(
        `/api/users/${encodeURIComponent(userId)}`,
        { method: 'PUT', body: JSON.stringify(payload) },
        token
      );
      setManagedUsers((prev) => prev.map((u) => (u.id === userId ? resp.user : u)));
      if (localAccount?.id === userId) {
        setLocalAccount(resp.user);
      }
      showToast(`تم تحديث صلاحيات «${resp.user.displayName}».`);
      return;
    }

    setManagedUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
              ...u,
              username: payload.username.trim().toLowerCase(),
              displayName: payload.displayName,
              role: payload.role,
              permissions: payload.permissions,
              active: payload.active,
              updatedAt: new Date().toISOString(),
            }
          : u
      )
    );
    showToast(`تم تحديث صلاحيات «${payload.displayName}».`);
  };

  const handleChangeManagedPassword = async (userId: string, newPassword: string) => {
    if (localAccount || user) {
      const token = await getAdminApiToken();
      await apiFetch(
        `/api/users/${encodeURIComponent(userId)}/password`,
        {
          method: 'PUT',
          body: JSON.stringify({ password: newPassword }),
        },
        token
      );
    }
    showToast('تم تحديث الرقم السري بنجاح.');
  };

  const handleDeleteManagedUser = async (userId: string) => {
    try {
      if (localAccount || user) {
        const token = await getAdminApiToken();
        await apiFetch(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }, token);
      }
      setManagedUsers((prev) => prev.filter((u) => u.id !== userId));
      showToast('تم حذف حساب المستخدم بنجاح.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حذف المستخدم.', 'error');
    }
  };

  // --- Notification Dispatching & Logging ---
  const appendLog = async (
    entry: Omit<ActivityLog, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => {
    if (localAccount) {
      const resp = await apiFetch<{ ok: true; log: ActivityLog }>('/api/workspace/logs', {
        method: 'POST',
        body: JSON.stringify(entry),
      });
      setActivityLogs((prev) => [resp.log, ...prev]);
    } else if (user) {
      await createActivityLogDoc(user.uid, entry);
    } else {
      const now = new Date().toISOString();
      setActivityLogs((prev) => [
        {
          ...entry,
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ownerId: 'demo-manager',
          createdAt: now,
          updatedAt: now,
        },
        ...prev,
      ]);
    }
  };

  const markEvalNotification = async (
    batchId: string,
    evalId: string,
    status: EmployeeEvaluation['lastNotificationStatus']
  ) => {
    const nowIso = new Date().toISOString();
    if (localAccount) {
      await apiFetch(
        `/api/workspace/batches/${encodeURIComponent(batchId)}/evaluations/${encodeURIComponent(evalId)}/notification`,
        { method: 'PATCH', body: JSON.stringify({ status, notifiedIso: nowIso }) }
      );
      setEvaluationsByBatch((prev) => ({
        ...prev,
        [batchId]: (prev[batchId] || []).map((e) =>
          e.id === evalId ? { ...e, lastNotificationStatus: status, lastNotifiedAt: nowIso } : e
        ),
      }));
    } else if (user) {
      await updateEvaluationNotificationDoc(batchId, evalId, status, nowIso);
    } else {
      setEvaluationsByBatch((prev) => ({
        ...prev,
        [batchId]: (prev[batchId] || []).map((e) =>
          e.id === evalId ? { ...e, lastNotificationStatus: status, lastNotifiedAt: nowIso } : e
        ),
      }));
    }
  };

  const sendSingleChannel = async (
    channel: 'whatsapp_api' | 'email',
    recipient: string,
    message: string,
    weekLabel: string,
    activeSettings: UserSettings
  ): Promise<{ ok: boolean; error?: string }> => {
    const authToken = sessionToken || (user ? await user.getIdToken() : null);
    if (!authToken && !localAccount) {
      if (!recipient) {
        return {
          ok: false,
          error: channel === 'email' ? 'لا يوجد بريد إلكتروني مسجل.' : 'لا يوجد رقم واتساب مسجل.',
        };
      }
      return { ok: true };
    }

    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      reqHeaders.Authorization = `Bearer ${authToken}`;
    }

    if (channel === 'whatsapp_api') {
      const cleanPhone = normalizePhoneNumber(recipient, activeSettings.defaultCountryCode);
      if (!cleanPhone) {
        return { ok: false, error: 'رقم الواتساب غير مسجل أو غير صالح.' };
      }
      const resp = await fetch('/api/notifications/whatsapp', {
        method: 'POST',
        credentials: 'include',
        headers: reqHeaders,
        body: JSON.stringify({
          provider: activeSettings.whatsappProvider,
          phone: cleanPhone,
          message,
          phoneNumberId: activeSettings.whatsappPhoneNumberId,
          instanceId: activeSettings.whatsappInstanceId,
          webhookUrl: activeSettings.whatsappWebhookUrl,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      return resp.ok && data.ok
        ? { ok: true }
        : { ok: false, error: data.error || `خطأ خادم (${resp.status})` };
    } else {
      if (!recipient) {
        return { ok: false, error: 'لا يوجد بريد إلكتروني مسجل للموظف.' };
      }
      const subject = (activeSettings.emailSubject || 'إشعار نظام انضباط').replaceAll(
        '{الأسبوع}',
        weekLabel
      );
      const resp = await fetch('/api/notifications/email', {
        method: 'POST',
        credentials: 'include',
        headers: reqHeaders,
        body: JSON.stringify({
          to: recipient,
          subject,
          message,
          smtpHost: activeSettings.smtpHost,
          smtpPort: activeSettings.smtpPort,
          smtpSecure: activeSettings.smtpSecure,
          smtpUser: activeSettings.smtpUser,
          fromName: activeSettings.emailFromName,
          fromAddress: activeSettings.emailFromAddress,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      return resp.ok && data.ok
        ? { ok: true }
        : { ok: false, error: data.error || `خطأ خادم (${resp.status})` };
    }
  };

  const handleDispatchAutomated = async (
    targets: EmployeeEvaluation[],
    channels: Array<'whatsapp_api' | 'email'>
  ): Promise<Record<string, { ok: boolean; error?: string }>> => {
    if (!activeBatch) return {};
    const outcomeMap: Record<string, { ok: boolean; error?: string }> = {};
    const senderLabel = localAccount?.username || user?.email || 'demo@indibat.local';

    for (const ev of targets) {
      if (ev.decision === 'pending') continue;
      const msg = renderDecisionMessage(ev.decision, ev, activeBatch.weekLabel, settings);
      let successCount = 0;
      let lastErr = '';

      for (const ch of channels) {
        const recipient =
          ch === 'email'
            ? ev.email
            : normalizePhoneNumber(ev.phone, settings.defaultCountryCode);
        const res = await sendSingleChannel(ch, recipient, msg, activeBatch.weekLabel, settings);
        if (res.ok) successCount += 1;
        else lastErr = res.error || 'فشل الإرسال';

        await appendLog({
          batchId: activeBatch.id,
          weekKey: activeBatch.weekKey,
          weekLabel: activeBatch.weekLabel,
          empCode: ev.empCode,
          employeeName: ev.employeeName,
          recipient,
          decision: ev.decision,
          channel: ch,
          status: res.ok ? 'sent' : 'failed',
          messagePreview: msg,
          errorMessage: res.ok ? '' : res.error || 'فشل الإرسال',
          sentByEmail: senderLabel,
        });
      }

      const evalStatus: EmployeeEvaluation['lastNotificationStatus'] =
        successCount === channels.length
          ? 'sent'
          : successCount > 0
          ? 'partial'
          : 'failed';
      await markEvalNotification(activeBatch.id, ev.id, evalStatus);
      outcomeMap[ev.id] = { ok: successCount === channels.length, error: lastErr || undefined };
    }

    const totalOk = Object.values(outcomeMap).filter((x) => x.ok).length;
    showToast(
      `اكتملت عملية الإرسال: نجح ${totalOk} من أصل ${targets.length} موظف.`,
      totalOk === targets.length ? 'success' : 'error'
    );
    return outcomeMap;
  };

  const handleRecordWhatsAppWebSent = async (ev: EmployeeEvaluation, message: string) => {
    if (!activeBatch || ev.decision === 'pending') return;
    const recipient = normalizePhoneNumber(ev.phone, settings.defaultCountryCode);
    await appendLog({
      batchId: activeBatch.id,
      weekKey: activeBatch.weekKey,
      weekLabel: activeBatch.weekLabel,
      empCode: ev.empCode,
      employeeName: ev.employeeName,
      recipient,
      decision: ev.decision,
      channel: 'whatsapp_web',
      status: 'sent',
      messagePreview: message,
      errorMessage: '',
      sentByEmail: localAccount?.username || user?.email || 'demo@indibat.local',
    });
    await markEvalNotification(activeBatch.id, ev.id, 'sent');
  };

  const handleRetryLog = async (log: ActivityLog) => {
    if (log.channel === 'whatsapp_web') {
      await handleMarkLogSent(log);
      return;
    }

    const res = await sendSingleChannel(
      log.channel,
      log.recipient,
      log.messagePreview,
      log.weekLabel,
      settings
    );
    if (localAccount) {
      await apiFetch(`/api/workspace/logs/${encodeURIComponent(log.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: res.ok ? 'sent' : 'failed', errorMessage: res.error || '' }),
      });
      setActivityLogs((prev) =>
        prev.map((l) =>
          l.id === log.id
            ? { ...l, status: res.ok ? 'sent' : 'failed', errorMessage: res.error || '' }
            : l
        )
      );
    } else if (user) {
      await updateActivityLogStatusDoc(log.id, res.ok ? 'sent' : 'failed', res.error || '');
    } else {
      setActivityLogs((prev) =>
        prev.map((l) =>
          l.id === log.id
            ? { ...l, status: res.ok ? 'sent' : 'failed', errorMessage: res.error || '' }
            : l
        )
      );
    }
    showToast(
      res.ok
        ? `تمت إعادة إرسال الرسالة إلى ${log.employeeName} بنجاح.`
        : res.error || 'فشلت إعادة الإرسال.',
      res.ok ? 'success' : 'error'
    );
  };

  const handleMarkLogSent = async (log: ActivityLog) => {
    if (localAccount) {
      await apiFetch(`/api/workspace/logs/${encodeURIComponent(log.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent', errorMessage: '' }),
      });
      setActivityLogs((prev) =>
        prev.map((l) => (l.id === log.id ? { ...l, status: 'sent', errorMessage: '' } : l))
      );
    } else if (user) {
      await updateActivityLogStatusDoc(log.id, 'sent', '');
    } else {
      setActivityLogs((prev) =>
        prev.map((l) => (l.id === log.id ? { ...l, status: 'sent', errorMessage: '' } : l))
      );
    }
    showToast(`تم تأكيد الإرسال لـ ${log.employeeName}.`);
  };

  // --- Settings Save & Re-evaluate active week ---
  const handleSaveSettings = async (next: UserSettings) => {
    if (localAccount) {
      await apiFetch('/api/workspace/settings', {
        method: 'PUT',
        body: JSON.stringify(next),
      });
      if (user) {
        await saveUserSettingsDoc(user.uid, next, settingsExistInDb).catch(() => {});
      }
    } else if (user) {
      await saveUserSettingsDoc(user.uid, next, settingsExistInDb);
    }
    setSettings(next);

    if (activeBatch && activeEvaluations.length > 0) {
      const updatedList = activeEvaluations.map((ev) =>
        recalculateSingleEvaluation(ev, activeBatch.weekKey, next, ev.excusedDates)
      );
      if (localAccount) {
        await Promise.all(
          updatedList.map((ev) =>
            apiFetch(
              `/api/workspace/batches/${encodeURIComponent(activeBatch.id)}/evaluations/${encodeURIComponent(ev.id)}/excuse`,
              { method: 'PATCH', body: JSON.stringify({ evaluation: ev }) }
            ).catch(() => {})
          )
        );
        setEvaluationsByBatch((prev) => ({ ...prev, [activeBatch.id]: updatedList }));
      } else if (user) {
        await Promise.all(updatedList.map((ev) => updateEvaluationExcuseDoc(activeBatch.id, ev)));
      } else {
        setEvaluationsByBatch((prev) => ({ ...prev, [activeBatch.id]: updatedList }));
      }
    }
    showToast('تم حفظ الإعدادات وتحديث تقييم الأسبوع الحالي.');
  };

  // --- Full Workspace Backup Export / Import ---
  const handleExportBackup = () => {
    const payload: WorkspaceBackupData = {
      version: 1,
      savedAt: new Date().toISOString(),
      employees,
      batches,
      evaluationsByBatch,
      activityLogs,
      settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `indibat-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم تنزيل النسخة الاحتياطية الكاملة بنجاح.');
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<WorkspaceBackupData>;
      if (!parsed || typeof parsed !== 'object') {
        showToast('ملف النسخة الاحتياطية غير صالح.', 'error');
        return;
      }
      const nextWorkspace = {
        employees: Array.isArray(parsed.employees) ? parsed.employees : [],
        batches: Array.isArray(parsed.batches) ? parsed.batches : [],
        evaluationsByBatch:
          parsed.evaluationsByBatch && typeof parsed.evaluationsByBatch === 'object'
            ? parsed.evaluationsByBatch
            : {},
        activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
        settings: parsed.settings ? { ...DEFAULT_SETTINGS, ...parsed.settings } : settings,
      };

      if (localAccount) {
        const resp = await apiFetch<{
          ok: true;
          workspace: typeof nextWorkspace;
        }>('/api/workspace/restore', {
          method: 'POST',
          body: JSON.stringify({ mergeOnlyIfEmpty: false, workspace: nextWorkspace }),
        });
        setEmployees(resp.workspace.employees);
        setBatches(resp.workspace.batches);
        setEvaluationsByBatch(resp.workspace.evaluationsByBatch);
        setActivityLogs(resp.workspace.activityLogs);
        setSettings(resp.workspace.settings);
        setActiveBatchId(resp.workspace.batches[0]?.id || null);
      } else {
        setEmployees(nextWorkspace.employees);
        setBatches(nextWorkspace.batches);
        setEvaluationsByBatch(nextWorkspace.evaluationsByBatch);
        setActivityLogs(nextWorkspace.activityLogs);
        setSettings(nextWorkspace.settings);
        setActiveBatchId(nextWorkspace.batches[0]?.id || null);
      }

      if (user) {
        for (const emp of nextWorkspace.employees) {
          await saveEmployeeDoc(user.uid, {
            empCode: emp.empCode,
            name: emp.name,
            department: emp.department,
            phone: emp.phone,
            email: emp.email,
            active: emp.active,
          }).catch(() => {});
        }
        await saveUserSettingsDoc(user.uid, nextWorkspace.settings, settingsExistInDb).catch(
          () => {}
        );
      }

      await saveWorkspaceBackup(nextWorkspace);
      showToast(
        `تمت استعادة النسخة الاحتياطية بنجاح (${nextWorkspace.employees.length} موظف و ${nextWorkspace.batches.length} أسبوع).`
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'تعذر قراءة ملف النسخة الاحتياطية.',
        'error'
      );
    }
  };

  // --- Export Actions ---
  const handleExportExcel = () => {
    if (!activeBatch) return;
    exportWeeklyExcel(activeBatch, activeEvaluations, activityLogs);
    showToast('تم تصدير ملف Excel بنجاح.');
  };

  const handleExportPdf = async () => {
    if (!activeBatch) return;
    setExportingPdf(true);
    try {
      await exportWeeklyPdf(activeBatch, activeEvaluations);
      showToast('تم تصدير تقرير PDF العربي بنجاح.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تصدير تقرير PDF.', 'error');
    } finally {
      setExportingPdf(false);
    }
  };

  // --- Loading & Auth Gate ---
  const isAuthenticated = Boolean(localAccount || user || demoMode);

  if (!authReady && !demoMode && !localAccount && authStatusLoading) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-sm text-slate-500">جارٍ تهيئة نظام انضباط...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginView
        authInitialized={authInitialized}
        authStatusLoading={authStatusLoading}
        onPasswordLogin={handlePasswordLogin}
        onFirstAdminSetup={handleFirstAdminSetup}
        onGoogleSignIn={handleGoogleSignIn}
        onEnterDemo={() => setDemoMode(true)}
        loading={authLoading}
        error={authError}
      />
    );
  }

  const navItems: Array<{
    id: ActiveView;
    label: string;
    icon: typeof ClipboardList;
    count?: number;
    visible: boolean;
  }> = [
    { id: 'dashboard', label: 'التقييم الأسبوعي', icon: ClipboardList, visible: true },
    {
      id: 'employees',
      label: 'دليل الموظفين',
      icon: Users,
      count: employees.length,
      visible: effectivePermissions.manageEmployees,
    },
    {
      id: 'logs',
      label: 'سجل الأحداث',
      icon: History,
      count: activityLogs.length,
      visible: effectivePermissions.viewLogs,
    },
    {
      id: 'settings',
      label: 'الإعدادات',
      icon: SettingsIcon,
      visible: effectivePermissions.manageSettings,
    },
    {
      id: 'permissions',
      label: 'لوحة الصلاحيات',
      icon: ShieldCheck,
      count: managedUsers.length,
      visible: effectivePermissions.manageUsers,
    },
  ];

  const visibleNavItems = navItems.filter((n) => n.visible);
  const currentViewTitle = visibleNavItems.find((n) => n.id === activeView)?.label || '';

  const accountDisplayName = localAccount
    ? localAccount.displayName
    : user
    ? user.displayName || user.email || 'مدير النظام'
    : 'وضع المعاينة المحلية';

  const accountSubLabel = localAccount
    ? `@${localAccount.username} · ${ROLE_LABELS[localAccount.role]}`
    : user
    ? user.email || ''
    : 'البيانات مؤقتة في المعاينة';

  return (
    <div dir="rtl" className="min-h-screen bg-[#F8FAFC] text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-white border-l border-slate-200 shrink-0 no-print">
        <div className="h-16 px-6 border-b border-slate-200 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
            <Fingerprint className="w-4 h-4" />
          </div>
          <span className="text-lg font-bold font-display text-slate-900 whitespace-nowrap">
            انضباط
          </span>
        </div>

        <nav className="flex-1 p-4 space-y-1" aria-label="القائمة الرئيسية">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                  active
                    ? 'bg-teal-50 text-teal-900 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${active ? 'text-teal-700' : 'text-slate-400'}`} />
                  <span className="whitespace-nowrap">{item.label}</span>
                </span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span className="font-mono tabular-nums text-xs text-slate-400">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-2.5">
          <div className="text-xs text-slate-500">
            <div className="font-semibold text-slate-800 truncate">{accountDisplayName}</div>
            <div className="truncate mt-0.5 text-slate-400">{accountSubLabel}</div>
          </div>

          {localAccount || user ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>تسجيل الخروج</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>العودة لشاشة تسجيل الدخول</span>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white h-full border-l border-slate-200 flex flex-col z-10">
            <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-teal-700 text-white flex items-center justify-center">
                  <Fingerprint className="w-4 h-4" />
                </div>
                <span className="font-bold font-display text-slate-900">انضباط</span>
              </div>
              <button
                type="button"
                aria-label="إغلاق القائمة"
                onClick={() => setMobileNavOpen(false)}
                className="p-1.5 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveView(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg ${
                      active ? 'bg-teal-50 text-teal-900 font-semibold' : 'text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
            <div className="p-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  handleSignOut();
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Contextual Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="فتح القائمة"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 -mr-2 text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
              <span className="font-semibold text-slate-900 whitespace-nowrap">نظام انضباط</span>
              <span aria-hidden="true">/</span>
              <span className="whitespace-nowrap">{currentViewTitle}</span>
              {activeBatch && activeView === 'dashboard' && (
                <>
                  <span aria-hidden="true" className="hidden sm:inline">
                    /
                  </span>
                  <span className="hidden sm:inline font-mono tabular-nums text-xs text-slate-500">
                    {activeBatch.weekLabel}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {localAccount ? (
              <span className="text-xs font-medium text-slate-600 hidden sm:inline">
                {ROLE_LABELS[localAccount.role]}
              </span>
            ) : !user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="px-3.5 py-1.5 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                تسجيل الدخول
              </button>
            ) : null}
          </div>
        </header>

        {/* Main Workspace */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1400px] w-full mx-auto">
          {activeView === 'dashboard' && (
            <EvaluationDashboard
              batches={batches}
              activeBatch={activeBatch}
              onSelectBatch={setActiveBatchId}
              evaluations={activeEvaluations}
              settings={settings}
              uploading={uploading}
              exportingPdf={exportingPdf}
              permissions={effectivePermissions}
              onUploadFile={handleUploadFile}
              onLoadDemoData={handleLoadDemoData}
              onDownloadSampleDat={() => downloadSampleZKTecoFile(SAMPLE_ZKTECO_CONTENT)}
              onDecisionChange={handleDecisionChange}
              onBulkDecisionChange={handleBulkDecisionChange}
              onToggleExcuseDay={handleToggleExcuseDay}
              onQuickAddEmployee={(empCode, defaultName) => {
                setDraftEmployee({ empCode, name: defaultName });
                setActiveView('employees');
              }}
              onOpenDispatch={(ids) => {
                setDispatchPreselected(ids);
                setDispatchOpen(true);
              }}
              onExportExcel={handleExportExcel}
              onExportPdf={handleExportPdf}
            />
          )}

          {activeView === 'employees' && effectivePermissions.manageEmployees && (
            <EmployeeDirectory
              employees={employees}
              initialDraftCode={draftEmployee}
              onClearInitialDraft={() => setDraftEmployee(null)}
              onSaveEmployee={handleSaveEmployee}
              onDeleteEmployee={handleDeleteEmployee}
              onBulkImportEmployees={handleBulkImportEmployees}
            />
          )}

          {activeView === 'logs' && effectivePermissions.viewLogs && (
            <ActivityLogView
              logs={activityLogs}
              onRetryLog={handleRetryLog}
              onRetryAllFailed={async (failedList) => {
                for (const item of failedList) {
                  await handleRetryLog(item);
                }
              }}
              onMarkSent={handleMarkLogSent}
            />
          )}

          {activeView === 'settings' && effectivePermissions.manageSettings && (
            <SettingsView
              settings={settings}
              secretsStatus={secretsStatus}
              cloudConnectedEmail={user?.email || null}
              onConnectCloud={handleGoogleSignIn}
              onExportBackup={handleExportBackup}
              onImportBackup={handleImportBackup}
              onSaveSettings={handleSaveSettings}
              onTestWhatsApp={(phone, draft) =>
                sendSingleChannel(
                  'whatsapp_api',
                  phone,
                  'رسالة اختبار من نظام انضباط لتقييم البصمة الأسبوعية.',
                  activeBatch?.weekLabel || 'أسبوع تجريبي',
                  draft
                )
              }
              onTestEmail={(emailAddr, draft) =>
                sendSingleChannel(
                  'email',
                  emailAddr,
                  'رسالة اختبار بريد إلكتروني من نظام انضباط لتقييم البصمة الأسبوعية.',
                  activeBatch?.weekLabel || 'أسبوع تجريبي',
                  draft
                )
              }
            />
          )}

          {activeView === 'permissions' && effectivePermissions.manageUsers && (
            <PermissionsPanel
              users={managedUsers}
              currentUserId={localAccount?.id || (demoMode ? 'demo_admin' : user?.uid || '')}
              isDemoMode={!localAccount && !user}
              onCreateUser={handleCreateManagedUser}
              onUpdateUser={handleUpdateManagedUser}
              onChangePassword={handleChangeManagedPassword}
              onDeleteUser={handleDeleteManagedUser}
            />
          )}
        </main>
      </div>

      {/* Dispatch Modal */}
      {activeBatch && effectivePermissions.sendNotifications && (
        <DispatchModal
          open={dispatchOpen}
          onClose={() => {
            setDispatchOpen(false);
            setDispatchPreselected(undefined);
          }}
          batch={activeBatch}
          evaluations={activeEvaluations}
          preselectedIds={dispatchPreselected}
          settings={settings}
          secretsStatus={secretsStatus}
          isDemoMode={!localAccount && !user}
          onDispatchAutomated={handleDispatchAutomated}
          onRecordWhatsAppWebSent={handleRecordWhatsAppWebSent}
          onQuickAddEmployee={
            effectivePermissions.manageEmployees
              ? (empCode, defaultName) => {
                  setDispatchOpen(false);
                  setDispatchPreselected(undefined);
                  setDraftEmployee({ empCode, name: defaultName });
                  setActiveView('employees');
                }
              : undefined
          }
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-6 z-40 max-w-md px-4 py-3 rounded-lg border shadow-lg text-sm flex items-center gap-2.5 ${
            toast.type === 'success'
              ? 'bg-slate-900 border-slate-800 text-white'
              : 'bg-red-700 border-red-800 text-white'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-teal-300" />
          <span className="flex-1">{toast.text}</span>
          <button
            type="button"
            aria-label="إغلاق التنبيه"
            onClick={() => setToast(null)}
            className="text-white/70 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
