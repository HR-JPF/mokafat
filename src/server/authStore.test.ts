import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IndibatAuthStore } from './authStore';
import { hasPermission, normalizePermissions } from '../lib/authPermissions';

function createTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indibat-auth-test-'));
  const filePath = path.join(dir, 'store.json');
  const store = new IndibatAuthStore(filePath, 'test-signing-secret-123');
  return {
    store,
    filePath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('first-run admin bootstrap works with any username/PIN and locks after claiming', () => {
  const { store, filePath, cleanup } = createTempStore();
  try {
    assert.equal(store.getAuthStatus().initialized, false);

    // User chooses simple username + short PIN with no complexity restrictions
    const boot = store.bootstrapFirstAdmin({
      username: 'نور',
      password: '123',
      displayName: 'نور صالح',
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;

    assert.equal(boot.user.role, 'super_admin');
    assert.equal(hasPermission(boot.user, 'manageUsers'), true);
    assert.equal(store.getAuthStatus().initialized, true);

    // Ensure plaintext password is never persisted to disk
    const rawDisk = fs.readFileSync(filePath, 'utf8');
    assert.equal(rawDisk.includes('"password":"123"'), false);

    // Second bootstrap attempt MUST be rejected (409)
    const secondBoot = store.bootstrapFirstAdmin({
      username: 'attacker',
      password: '999',
    });
    assert.equal(secondBoot.ok, false);
    if (!secondBoot.ok) {
      assert.equal(secondBoot.status, 409);
    }

    // Authenticate with exact credentials succeeds; wrong password fails
    const okLogin = store.authenticate('نور', '123');
    assert.equal(okLogin.ok, true);
    const badLogin = store.authenticate('نور', '124');
    assert.equal(badLogin.ok, false);
  } finally {
    cleanup();
  }
});

test('signed Bearer sessions reject tampering and honor server-side revocation', () => {
  const { store, cleanup } = createTempStore();
  try {
    const boot = store.bootstrapFirstAdmin({ username: 'admin', password: '000' });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;

    const verified = store.verifySessionToken(boot.token);
    assert.ok(verified);
    assert.equal(verified?.username, 'admin');

    // Tampered token must fail verification
    const tampered = `${boot.token.slice(0, -4)}AAAA`;
    assert.equal(store.verifySessionToken(tampered), null);

    // Revoked token must fail immediately
    store.revokeSessionToken(boot.token);
    assert.equal(store.verifySessionToken(boot.token), null);
  } finally {
    cleanup();
  }
});

test('RBAC user management enforces custom permissions and prevents deleting last super_admin', () => {
  const { store, cleanup } = createTempStore();
  try {
    const boot = store.bootstrapFirstAdmin({ username: 'boss', password: '111' });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;

    // Cannot delete the last super_admin
    const delLast = store.deleteUser(boot.user.id);
    assert.equal(delLast.ok, false);

    // Cannot demote the last super_admin
    const demoteLast = store.updateUser(boot.user.id, { role: 'viewer' });
    assert.equal(demoteLast.ok, false);

    // Create a restricted supervisor with custom permissions
    const created = store.createUser({
      username: 'nabil',
      password: '222',
      displayName: 'نبيل المتابعة',
      role: 'supervisor',
      permissions: {
        uploadAttendance: true,
        manageDecisions: true,
        sendNotifications: false,
        manageSettings: false,
        manageUsers: false,
      },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(hasPermission(created.user, 'uploadAttendance'), true);
    assert.equal(hasPermission(created.user, 'sendNotifications'), false);
    assert.equal(hasPermission(created.user, 'manageUsers'), false);

    // Suspending the user invalidates their active session immediately
    const login = store.authenticate('nabil', '222');
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.ok(store.verifySessionToken(login.token));

    const suspend = store.updateUser(created.user.id, { active: false });
    assert.equal(suspend.ok, true);
    assert.equal(store.verifySessionToken(login.token), null);

    // Shadow keys in permissions are stripped
    const norm = normalizePermissions({ uploadAttendance: true, evilKey: true } as unknown, 'viewer');
    assert.equal(norm.uploadAttendance, true);
    assert.equal('evilKey' in norm, false);
  } finally {
    cleanup();
  }
});

test('session signing secret persists across store restarts so active cookies remain valid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indibat-restart-test-'));
  const filePath = path.join(dir, 'store.json');
  try {
    const store1 = new IndibatAuthStore(filePath);
    const boot = store1.bootstrapFirstAdmin({ username: 'noor', password: '555' });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;

    // Simulate process restart without SESSION_SECRET env var
    const store2 = new IndibatAuthStore(filePath);
    const verified = store2.verifySessionToken(boot.token);
    assert.ok(verified);
    assert.equal(verified?.username, 'noor');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mergeWorkspace unifies Gmail and Username/Password records without overwriting existing data', () => {
  const { store, cleanup } = createTempStore();
  try {
    store.saveEmployee('local_admin', {
      empCode: '101',
      name: 'نبيل',
      department: 'التقنية',
      phone: '0551112222',
      email: '',
      active: true,
    });

    // Simulate Gmail/Firestore sync bringing employee 102 + missing email for 101
    const merged = store.mergeWorkspace('google_uid', {
      employees: [
        {
          id: 'fb_101',
          ownerId: 'google_uid',
          empCode: '101',
          name: 'نبيل',
          department: 'التقنية',
          phone: '',
          email: 'nabil@company.sa',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'fb_102',
          ownerId: 'google_uid',
          empCode: '102',
          name: 'سارة',
          department: 'المالية',
          phone: '0559998888',
          email: 'sara@company.sa',
          active: true,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    assert.equal(merged.employees.length, 2);
    const emp101 = merged.employees.find((e) => e.empCode === '101');
    const emp102 = merged.employees.find((e) => e.empCode === '102');
    assert.equal(emp101?.phone, '0551112222'); // Preserved existing phone!
    assert.equal(emp101?.email, 'nabil@company.sa'); // Filled missing email!
    assert.equal(emp102?.name, 'سارة');
  } finally {
    cleanup();
  }
});

