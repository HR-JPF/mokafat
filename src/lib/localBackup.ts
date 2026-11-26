import type {
  ActivityLog,
  Employee,
  EmployeeEvaluation,
  UserSettings,
  WeeklyBatch,
} from '../types';

export interface WorkspaceBackupData {
  version: 1;
  savedAt: string;
  employees: Employee[];
  batches: WeeklyBatch[];
  evaluationsByBatch: Record<string, EmployeeEvaluation[]>;
  activityLogs: ActivityLog[];
  settings: UserSettings;
}

const DB_NAME = 'indibat_workspace_backup_db';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'latest_workspace';

function openBackupDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveWorkspaceBackup(data: Omit<WorkspaceBackupData, 'version' | 'savedAt'>): Promise<void> {
  const db = await openBackupDb();
  if (!db) return;

  const snapshot: WorkspaceBackupData = {
    version: 1,
    savedAt: new Date().toISOString(),
    employees: data.employees,
    batches: data.batches,
    evaluationsByBatch: data.evaluationsByBatch,
    activityLogs: data.activityLogs,
    settings: data.settings,
  };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadWorkspaceBackup(): Promise<WorkspaceBackupData | null> {
  const db = await openBackupDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      req.onsuccess = () => {
        db.close();
        const result = req.result as WorkspaceBackupData | undefined;
        if (!result || typeof result !== 'object') {
          resolve(null);
          return;
        }
        resolve(result);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export function hasAnyWorkspaceData(data: {
  employees?: Employee[];
  batches?: WeeklyBatch[];
  activityLogs?: ActivityLog[];
}): boolean {
  return (
    (data.employees?.length ?? 0) > 0 ||
    (data.batches?.length ?? 0) > 0 ||
    (data.activityLogs?.length ?? 0) > 0
  );
}
