import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  DEFAULT_SETTINGS,
  type ActivityLog,
  type Employee,
  type EmployeeEvaluation,
  type ManagerDecision,
  type NotificationStatus,
  type UserSettings,
  type WeeklyBatch,
} from '../types';
import { db, handleFirestoreError, OperationType } from './firebase';

function tsToIso(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) {
    return (val as Timestamp).toDate().toISOString();
  }
  return '';
}

function clampStr(val: string | undefined | null, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

function safeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

function safeCode(raw: string | undefined | null): string {
  const ascii = (raw ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
  return ascii || `EMP_${Date.now()}`;
}

export function subscribeEmployees(
  uid: string,
  onData: (employees: Employee[]) => void
): Unsubscribe {
  const q = query(collection(db, 'employees'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: Employee[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || uid),
            empCode: String(data.empCode || ''),
            name: String(data.name || ''),
            department: String(data.department || ''),
            phone: String(data.phone || ''),
            email: String(data.email || ''),
            active: Boolean(data.active),
            createdAt: tsToIso(data.createdAt),
            updatedAt: tsToIso(data.updatedAt),
          };
        })
        .sort((a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'employees')
  );
}

export async function saveEmployeeDoc(
  uid: string,
  emp: Omit<Employee, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
  existingId?: string
): Promise<string> {
  const normalizedCode = safeCode(emp.empCode);
  const docId = existingId ? safeId(existingId) : safeId(`emp_${uid.slice(0, 8)}_${normalizedCode}`);
  const ref = doc(db, 'employees', docId);
  try {
    if (existingId) {
      await updateDoc(ref, {
        empCode: normalizedCode,
        name: clampStr(emp.name, 120),
        department: clampStr(emp.department, 80),
        phone: clampStr(emp.phone, 32),
        email: clampStr(emp.email, 160),
        active: Boolean(emp.active),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ownerId: uid,
        empCode: normalizedCode,
        name: clampStr(emp.name, 120),
        department: clampStr(emp.department, 80),
        phone: clampStr(emp.phone, 32),
        email: clampStr(emp.email, 160),
        active: Boolean(emp.active),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return docId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, `employees/${docId}`);
  }
}

export async function deleteEmployeeDoc(employeeDocId: string): Promise<void> {
  const ref = doc(db, 'employees', employeeDocId);
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `employees/${employeeDocId}`);
  }
}

export function subscribeUserSettings(
  uid: string,
  onData: (settings: UserSettings, exists: boolean) => void
): Unsubscribe {
  const ref = doc(db, 'userSettings', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(DEFAULT_SETTINGS, false);
        return;
      }
      const d = snap.data();
      onData(
        {
          workStartTime: String(d.workStartTime || DEFAULT_SETTINGS.workStartTime),
          workEndTime: String(d.workEndTime || DEFAULT_SETTINGS.workEndTime),
          graceLateMinutes: Number(d.graceLateMinutes ?? DEFAULT_SETTINGS.graceLateMinutes),
          graceEarlyMinutes: Number(d.graceEarlyMinutes ?? DEFAULT_SETTINGS.graceEarlyMinutes),
          maxLateDaysAllowed: Number(d.maxLateDaysAllowed ?? DEFAULT_SETTINGS.maxLateDaysAllowed),
          maxTotalLateMinutes: Number(d.maxTotalLateMinutes ?? DEFAULT_SETTINGS.maxTotalLateMinutes),
          thursdayMorningOnly: Boolean(d.thursdayMorningOnly ?? DEFAULT_SETTINGS.thursdayMorningOnly),
          countMissingPunchAsNonCompliant: Boolean(
            d.countMissingPunchAsNonCompliant ?? DEFAULT_SETTINGS.countMissingPunchAsNonCompliant
          ),
          countAbsenceAsNonCompliant: Boolean(
            d.countAbsenceAsNonCompliant ?? DEFAULT_SETTINGS.countAbsenceAsNonCompliant
          ),
          whatsappMode: (d.whatsappMode as UserSettings['whatsappMode']) || 'both',
          whatsappProvider: (d.whatsappProvider as UserSettings['whatsappProvider']) || 'cloud_api',
          whatsappPhoneNumberId: String(d.whatsappPhoneNumberId || ''),
          whatsappInstanceId: String(d.whatsappInstanceId || ''),
          whatsappWebhookUrl: String(d.whatsappWebhookUrl || ''),
          defaultCountryCode: String(d.defaultCountryCode || '966'),
          emailEnabled: Boolean(d.emailEnabled ?? true),
          smtpHost: String(d.smtpHost || ''),
          smtpPort: Number(d.smtpPort ?? 587),
          smtpSecure: Boolean(d.smtpSecure ?? false),
          smtpUser: String(d.smtpUser || ''),
          emailFromName: String(d.emailFromName || DEFAULT_SETTINGS.emailFromName),
          emailFromAddress: String(d.emailFromAddress || ''),
          emailSubject: String(d.emailSubject || DEFAULT_SETTINGS.emailSubject),
          templateReward: String(d.templateReward || DEFAULT_SETTINGS.templateReward),
          templateAllowWithWarning: String(
            d.templateAllowWithWarning || DEFAULT_SETTINGS.templateAllowWithWarning
          ),
          templateDenyReward: String(d.templateDenyReward || DEFAULT_SETTINGS.templateDenyReward),
        },
        true
      );
    },
    (error) => handleFirestoreError(error, OperationType.GET, `userSettings/${uid}`)
  );
}

export async function saveUserSettingsDoc(
  uid: string,
  settings: UserSettings,
  alreadyExists: boolean
): Promise<void> {
  const ref = doc(db, 'userSettings', uid);
  const payload = {
    workStartTime: /^\d{2}:\d{2}$/.test(settings.workStartTime) ? settings.workStartTime : '08:00',
    workEndTime: /^\d{2}:\d{2}$/.test(settings.workEndTime) ? settings.workEndTime : '16:00',
    graceLateMinutes: Math.max(0, Math.min(180, Number(settings.graceLateMinutes) || 0)),
    graceEarlyMinutes: Math.max(0, Math.min(180, Number(settings.graceEarlyMinutes) || 0)),
    maxLateDaysAllowed: Math.max(0, Math.min(5, Number(settings.maxLateDaysAllowed) || 0)),
    maxTotalLateMinutes: Math.max(0, Math.min(600, Number(settings.maxTotalLateMinutes) || 0)),
    thursdayMorningOnly: Boolean(settings.thursdayMorningOnly),
    countMissingPunchAsNonCompliant: Boolean(settings.countMissingPunchAsNonCompliant),
    countAbsenceAsNonCompliant: Boolean(settings.countAbsenceAsNonCompliant),
    whatsappMode: settings.whatsappMode,
    whatsappProvider: settings.whatsappProvider,
    whatsappPhoneNumberId: clampStr(settings.whatsappPhoneNumberId, 120),
    whatsappInstanceId: clampStr(settings.whatsappInstanceId, 120),
    whatsappWebhookUrl: clampStr(settings.whatsappWebhookUrl, 300),
    defaultCountryCode: clampStr(settings.defaultCountryCode, 8) || '966',
    emailEnabled: Boolean(settings.emailEnabled),
    smtpHost: clampStr(settings.smtpHost, 160),
    smtpPort: Math.max(1, Math.min(65535, Number(settings.smtpPort) || 587)),
    smtpSecure: Boolean(settings.smtpSecure),
    smtpUser: clampStr(settings.smtpUser, 160),
    emailFromName: clampStr(settings.emailFromName, 120),
    emailFromAddress: clampStr(settings.emailFromAddress, 160),
    emailSubject: clampStr(settings.emailSubject, 200),
    templateReward: clampStr(settings.templateReward, 1500) || DEFAULT_SETTINGS.templateReward,
    templateAllowWithWarning:
      clampStr(settings.templateAllowWithWarning, 1500) || DEFAULT_SETTINGS.templateAllowWithWarning,
    templateDenyReward:
      clampStr(settings.templateDenyReward, 1500) || DEFAULT_SETTINGS.templateDenyReward,
    updatedAt: serverTimestamp(),
  };

  try {
    if (alreadyExists) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, {
        ...payload,
        ownerId: uid,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(
      error,
      alreadyExists ? OperationType.UPDATE : OperationType.CREATE,
      `userSettings/${uid}`
    );
  }
}

export function subscribeWeeklyBatches(
  uid: string,
  onData: (batches: WeeklyBatch[]) => void
): Unsubscribe {
  const q = query(collection(db, 'weeklyBatches'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: WeeklyBatch[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || uid),
            weekKey: String(data.weekKey || ''),
            weekLabel: String(data.weekLabel || ''),
            fileName: String(data.fileName || ''),
            totalEmployees: Number(data.totalEmployees || 0),
            compliantCount: Number(data.compliantCount || 0),
            nonCompliantCount: Number(data.nonCompliantCount || 0),
            createdAt: tsToIso(data.createdAt),
            updatedAt: tsToIso(data.updatedAt),
          };
        })
        .sort((a, b) => b.weekKey.localeCompare(a.weekKey));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'weeklyBatches')
  );
}

export function subscribeBatchEvaluations(
  uid: string,
  batchId: string,
  onData: (evals: EmployeeEvaluation[]) => void
): Unsubscribe {
  const colPath = `weeklyBatches/${batchId}/evaluations`;
  const q = query(collection(db, colPath), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: EmployeeEvaluation[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || uid),
            batchId: String(data.batchId || batchId),
            empCode: String(data.empCode || ''),
            employeeName: String(data.employeeName || ''),
            department: String(data.department || ''),
            phone: String(data.phone || ''),
            email: String(data.email || ''),
            isCompliant: Boolean(data.isCompliant),
            lateDaysCount: Number(data.lateDaysCount || 0),
            totalLateMinutes: Number(data.totalLateMinutes || 0),
            earlyLeaveMinutes: Number(data.earlyLeaveMinutes || 0),
            missingPunchDays: Number(data.missingPunchDays || 0),
            absentDays: Number(data.absentDays || 0),
            presentDays: Number(data.presentDays || 0),
            decision: (data.decision as ManagerDecision) || 'pending',
            excusedDates: Array.isArray(data.excusedDates) ? data.excusedDates.slice(0, 7) : [],
            days: Array.isArray(data.days) ? data.days.slice(0, 7) : [],
            lastNotifiedAt: String(data.lastNotifiedAt || ''),
            lastNotificationStatus: (data.lastNotificationStatus as NotificationStatus) || 'none',
          };
        })
        .sort((a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, colPath)
  );
}

export async function saveWeeklyBatchWithEvaluations(
  uid: string,
  weekKey: string,
  weekLabel: string,
  fileName: string,
  evaluations: Array<Omit<EmployeeEvaluation, 'id' | 'ownerId' | 'batchId'>>
): Promise<string> {
  const batchId = safeId(`batch_${uid.slice(0, 8)}_${weekKey}_${Date.now()}`);
  const compliantCount = evaluations.filter((e) => e.isCompliant).length;
  const nonCompliantCount = evaluations.length - compliantCount;

  try {
    // 1. Create parent batch first so subcollection Master Gate get() succeeds
    await setDoc(doc(db, 'weeklyBatches', batchId), {
      ownerId: uid,
      weekKey: clampStr(weekKey, 32),
      weekLabel: clampStr(weekLabel, 80),
      fileName: clampStr(fileName, 160),
      totalEmployees: evaluations.length,
      compliantCount,
      nonCompliantCount,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 2. Write evaluations in chunks of 400
    for (let i = 0; i < evaluations.length; i += 400) {
      const chunk = evaluations.slice(i, i + 400);
      const wb = writeBatch(db);
      for (const ev of chunk) {
        const evalCode = safeCode(ev.empCode);
        const evalId = safeId(`ev_${evalCode}`);
        const ref = doc(db, 'weeklyBatches', batchId, 'evaluations', evalId);
        wb.set(ref, {
          ownerId: uid,
          batchId,
          empCode: evalCode,
          employeeName: clampStr(ev.employeeName, 120),
          department: clampStr(ev.department, 80),
          phone: clampStr(ev.phone, 32),
          email: clampStr(ev.email, 160),
          isCompliant: Boolean(ev.isCompliant),
          lateDaysCount: Math.max(0, Math.min(7, ev.lateDaysCount)),
          totalLateMinutes: Math.max(0, Math.min(10000, ev.totalLateMinutes)),
          earlyLeaveMinutes: Math.max(0, Math.min(10000, ev.earlyLeaveMinutes)),
          missingPunchDays: Math.max(0, Math.min(7, ev.missingPunchDays)),
          absentDays: Math.max(0, Math.min(7, ev.absentDays)),
          presentDays: Math.max(0, Math.min(7, ev.presentDays)),
          decision: ev.decision,
          excusedDates: ev.excusedDates.slice(0, 7),
          days: ev.days.slice(0, 7),
          lastNotifiedAt: clampStr(ev.lastNotifiedAt, 64),
          lastNotificationStatus: ev.lastNotificationStatus,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await wb.commit();
    }

    return batchId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `weeklyBatches/${batchId}`);
  }
}

export async function updateEvaluationDecisionDoc(
  batchId: string,
  evalId: string,
  decision: ManagerDecision
): Promise<void> {
  const ref = doc(db, 'weeklyBatches', batchId, 'evaluations', evalId);
  try {
    await updateDoc(ref, {
      decision,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `weeklyBatches/${batchId}/evaluations/${evalId}`);
  }
}

export async function updateEvaluationExcuseDoc(
  batchId: string,
  ev: EmployeeEvaluation
): Promise<void> {
  const ref = doc(db, 'weeklyBatches', batchId, 'evaluations', ev.id);
  try {
    await updateDoc(ref, {
      excusedDates: ev.excusedDates.slice(0, 7),
      days: ev.days.slice(0, 7),
      isCompliant: ev.isCompliant,
      lateDaysCount: ev.lateDaysCount,
      totalLateMinutes: ev.totalLateMinutes,
      earlyLeaveMinutes: ev.earlyLeaveMinutes,
      missingPunchDays: ev.missingPunchDays,
      absentDays: ev.absentDays,
      presentDays: ev.presentDays,
      decision: ev.decision,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `weeklyBatches/${batchId}/evaluations/${ev.id}`);
  }
}

export async function updateEvaluationNotificationDoc(
  batchId: string,
  evalId: string,
  status: NotificationStatus,
  notifiedIso: string
): Promise<void> {
  const ref = doc(db, 'weeklyBatches', batchId, 'evaluations', evalId);
  try {
    await updateDoc(ref, {
      lastNotifiedAt: clampStr(notifiedIso, 64),
      lastNotificationStatus: status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `weeklyBatches/${batchId}/evaluations/${evalId}`);
  }
}

export async function updateEvaluationContactDoc(
  batchId: string,
  evalId: string,
  contact: { employeeName: string; department: string; phone: string; email: string }
): Promise<void> {
  const ref = doc(db, 'weeklyBatches', batchId, 'evaluations', evalId);
  try {
    await updateDoc(ref, {
      employeeName: clampStr(contact.employeeName, 120),
      department: clampStr(contact.department, 80),
      phone: clampStr(contact.phone, 32),
      email: clampStr(contact.email, 160),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `weeklyBatches/${batchId}/evaluations/${evalId}`);
  }
}

export function subscribeActivityLogs(
  uid: string,
  onData: (logs: ActivityLog[]) => void
): Unsubscribe {
  const q = query(collection(db, 'activityLogs'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: ActivityLog[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || uid),
            batchId: String(data.batchId || ''),
            weekKey: String(data.weekKey || ''),
            weekLabel: String(data.weekLabel || ''),
            empCode: String(data.empCode || ''),
            employeeName: String(data.employeeName || ''),
            recipient: String(data.recipient || ''),
            decision: data.decision as Exclude<ManagerDecision, 'pending'>,
            channel: data.channel as ActivityLog['channel'],
            status: data.status as ActivityLog['status'],
            messagePreview: String(data.messagePreview || ''),
            errorMessage: String(data.errorMessage || ''),
            sentByEmail: String(data.sentByEmail || ''),
            createdAt: tsToIso(data.createdAt),
            updatedAt: tsToIso(data.updatedAt),
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'activityLogs')
  );
}

export async function createActivityLogDoc(
  uid: string,
  log: Omit<ActivityLog, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const logId = safeId(`log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const ref = doc(db, 'activityLogs', logId);
  try {
    await setDoc(ref, {
      ownerId: uid,
      batchId: safeId(log.batchId),
      weekKey: clampStr(log.weekKey, 32),
      weekLabel: clampStr(log.weekLabel, 80),
      empCode: safeCode(log.empCode),
      employeeName: clampStr(log.employeeName, 120),
      recipient: clampStr(log.recipient, 160),
      decision: log.decision,
      channel: log.channel,
      status: log.status,
      messagePreview: clampStr(log.messagePreview, 1500) || '—',
      errorMessage: clampStr(log.errorMessage, 400),
      sentByEmail: clampStr(log.sentByEmail, 160),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return logId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `activityLogs/${logId}`);
  }
}

export async function updateActivityLogStatusDoc(
  logId: string,
  status: 'sent' | 'failed',
  errorMessage = ''
): Promise<void> {
  const ref = doc(db, 'activityLogs', logId);
  try {
    await updateDoc(ref, {
      status,
      errorMessage: clampStr(errorMessage, 400),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `activityLogs/${logId}`);
  }
}

export async function fetchFirestoreWorkspaceSnapshot(uid: string): Promise<{
  employees: Employee[];
  batches: WeeklyBatch[];
  evaluationsByBatch: Record<string, EmployeeEvaluation[]>;
  activityLogs: ActivityLog[];
  settings?: UserSettings;
}> {
  const [empSnap, batchSnap, logSnap, settingsSnap] = await Promise.all([
    getDocs(query(collection(db, 'employees'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'weeklyBatches'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'activityLogs'), where('ownerId', '==', uid))),
    getDoc(doc(db, 'userSettings', uid)),
  ]);

  const employees: Employee[] = empSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId || uid),
        empCode: String(data.empCode || ''),
        name: String(data.name || ''),
        department: String(data.department || ''),
        phone: String(data.phone || ''),
        email: String(data.email || ''),
        active: Boolean(data.active),
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
      };
    })
    .sort((a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }));

  const batches: WeeklyBatch[] = batchSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId || uid),
        weekKey: String(data.weekKey || ''),
        weekLabel: String(data.weekLabel || ''),
        fileName: String(data.fileName || ''),
        totalEmployees: Number(data.totalEmployees || 0),
        compliantCount: Number(data.compliantCount || 0),
        nonCompliantCount: Number(data.nonCompliantCount || 0),
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
      };
    })
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey));

  const evaluationsByBatch: Record<string, EmployeeEvaluation[]> = {};
  for (const b of batches.slice(0, 12)) {
    const evalSnap = await getDocs(
      query(collection(db, `weeklyBatches/${b.id}/evaluations`), where('ownerId', '==', uid))
    );
    evaluationsByBatch[b.id] = evalSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId || uid),
          batchId: String(data.batchId || b.id),
          empCode: String(data.empCode || ''),
          employeeName: String(data.employeeName || ''),
          department: String(data.department || ''),
          phone: String(data.phone || ''),
          email: String(data.email || ''),
          isCompliant: Boolean(data.isCompliant),
          lateDaysCount: Number(data.lateDaysCount || 0),
          totalLateMinutes: Number(data.totalLateMinutes || 0),
          earlyLeaveMinutes: Number(data.earlyLeaveMinutes || 0),
          missingPunchDays: Number(data.missingPunchDays || 0),
          absentDays: Number(data.absentDays || 0),
          presentDays: Number(data.presentDays || 0),
          decision: (data.decision as ManagerDecision) || 'pending',
          excusedDates: Array.isArray(data.excusedDates) ? data.excusedDates.slice(0, 7) : [],
          days: Array.isArray(data.days) ? data.days.slice(0, 7) : [],
          lastNotifiedAt: String(data.lastNotifiedAt || ''),
          lastNotificationStatus: (data.lastNotificationStatus as NotificationStatus) || 'none',
        };
      })
      .sort((a, b2) => a.empCode.localeCompare(b2.empCode, undefined, { numeric: true }));
  }

  const activityLogs: ActivityLog[] = logSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId || uid),
        batchId: String(data.batchId || ''),
        weekKey: String(data.weekKey || ''),
        weekLabel: String(data.weekLabel || ''),
        empCode: String(data.empCode || ''),
        employeeName: String(data.employeeName || ''),
        recipient: String(data.recipient || ''),
        decision: data.decision as Exclude<ManagerDecision, 'pending'>,
        channel: data.channel as ActivityLog['channel'],
        status: data.status as ActivityLog['status'],
        messagePreview: String(data.messagePreview || ''),
        errorMessage: String(data.errorMessage || ''),
        sentByEmail: String(data.sentByEmail || ''),
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  let settings: UserSettings | undefined;
  if (settingsSnap.exists()) {
    const d = settingsSnap.data();
    settings = {
      ...DEFAULT_SETTINGS,
      workStartTime: String(d.workStartTime || DEFAULT_SETTINGS.workStartTime),
      workEndTime: String(d.workEndTime || DEFAULT_SETTINGS.workEndTime),
      graceLateMinutes: Number(d.graceLateMinutes ?? DEFAULT_SETTINGS.graceLateMinutes),
      graceEarlyMinutes: Number(d.graceEarlyMinutes ?? DEFAULT_SETTINGS.graceEarlyMinutes),
      maxLateDaysAllowed: Number(d.maxLateDaysAllowed ?? DEFAULT_SETTINGS.maxLateDaysAllowed),
      maxTotalLateMinutes: Number(d.maxTotalLateMinutes ?? DEFAULT_SETTINGS.maxTotalLateMinutes),
      thursdayMorningOnly: Boolean(d.thursdayMorningOnly ?? DEFAULT_SETTINGS.thursdayMorningOnly),
      countMissingPunchAsNonCompliant: Boolean(
        d.countMissingPunchAsNonCompliant ?? DEFAULT_SETTINGS.countMissingPunchAsNonCompliant
      ),
      countAbsenceAsNonCompliant: Boolean(
        d.countAbsenceAsNonCompliant ?? DEFAULT_SETTINGS.countAbsenceAsNonCompliant
      ),
      whatsappMode: (d.whatsappMode as UserSettings['whatsappMode']) || 'both',
      whatsappProvider: (d.whatsappProvider as UserSettings['whatsappProvider']) || 'cloud_api',
      whatsappPhoneNumberId: String(d.whatsappPhoneNumberId || ''),
      whatsappInstanceId: String(d.whatsappInstanceId || ''),
      whatsappWebhookUrl: String(d.whatsappWebhookUrl || ''),
      defaultCountryCode: String(d.defaultCountryCode || '966'),
      emailEnabled: Boolean(d.emailEnabled ?? true),
      smtpHost: String(d.smtpHost || ''),
      smtpPort: Number(d.smtpPort ?? 587),
      smtpSecure: Boolean(d.smtpSecure ?? false),
      smtpUser: String(d.smtpUser || ''),
      emailFromName: String(d.emailFromName || DEFAULT_SETTINGS.emailFromName),
      emailFromAddress: String(d.emailFromAddress || ''),
      emailSubject: String(d.emailSubject || DEFAULT_SETTINGS.emailSubject),
      templateReward: String(d.templateReward || DEFAULT_SETTINGS.templateReward),
      templateAllowWithWarning: String(
        d.templateAllowWithWarning || DEFAULT_SETTINGS.templateAllowWithWarning
      ),
      templateDenyReward: String(d.templateDenyReward || DEFAULT_SETTINGS.templateDenyReward),
    };
  }

  return { employees, batches, evaluationsByBatch, activityLogs, settings };
}
