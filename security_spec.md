# Security Specification — Indibat Attendance & Reward System

## 1. Data Invariants
1. Every document across `employees`, `weeklyBatches`, `evaluations`, `activityLogs`, and `userSettings` must belong to a verified authenticated owner (`request.auth.token.email_verified == true` and `ownerId == request.auth.uid`).
2. `evaluations` cannot exist without an existing parent `weeklyBatches/{batchId}` owned by the same user (`get()` Master Gate on single-doc operations).
3. `activityLogs` cannot reference a non-existent or foreign `batchId` (`get()` Master Gate on create).
4. PII (`phone`, `email`) in `employees` and `evaluations` is never exposed to other authenticated users (`allow get, list` strictly checks `resource.data.ownerId == request.auth.uid || isAdmin()`).
5. Immutable fields (`ownerId`, `batchId`, `createdAt`) cannot be altered on update, and timestamps must match `request.time`.
6. Once an `activityLogs` entry reaches terminal status `'sent'`, non-admin updates are blocked (only `'pending'` or `'failed'` entries may transition to `'sent'` or `'failed'`).
7. All strings enforce exact blueprint `.size()` limits, all document IDs enforce `isValidId()`, and bounded arrays (`excusedDates`, `days`) enforce `.size() <= 7`.

## 2. The Dirty Dozen Adversarial Payloads
1. **Identity Spoofing on Employee Create**: `ownerId` set to another user's UID (`"victim-uid"`).
2. **Shadow Field Injection**: Extra undeclared key `isAdmin: true` on `employees` create.
3. **Unverified Email Write**: Authenticated token with `email_verified: false` attempting create/read.
4. **Cross-Tenant PII Read**: User B attempting `get` or `list` on User A's `employees/{id}`.
5. **Orphaned Evaluation Create**: Creating `/weeklyBatches/nonexistent/evaluations/e1` without parent batch.
6. **Foreign Batch Activity Log**: Creating `activityLogs` referencing another user's `batchId`.
7. **ID Poisoning**: Document ID with spaces/slashes or >128 chars.
8. **Resource Exhaustion (Oversized String)**: `templateReward` with 5000 chars (>1500 limit).
9. **Array Overflow**: `days` array with 10 entries (>7 limit).
10. **Immutable Field Tampering**: Updating `createdAt` or `ownerId` on an existing employee.
11. **Terminal State Mutation**: Modifying an `activityLogs` document whose status is already `'sent'` by non-admin.
12. **Client Timestamp Forgery**: Creating a document with a backdated `createdAt` != `request.time`.
