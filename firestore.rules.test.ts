import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Static and structural security assertions verifying that the Dirty Dozen
 * adversarial scenarios documented in security_spec.md are gated in firestore.rules.
 */
const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const draftPath = path.resolve(process.cwd(), 'DRAFT_firestore.rules');
const activeRulesPath = fs.existsSync(rulesPath) ? rulesPath : draftPath;
const rulesContent = fs.readFileSync(activeRulesPath, 'utf8');

test('rules start with rules_version 2 and default-deny catch-all', () => {
  assert.match(rulesContent, /rules_version\s*=\s*'2'/);
  assert.match(rulesContent, /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;/);
});

test('all writes enforce verified email and ownerId identity integrity', () => {
  assert.match(rulesContent, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(rulesContent, /incoming\(\)\.ownerId\s*==\s*request\.auth\.uid/);
  assert.match(rulesContent, /incoming\(\)\.ownerId\s*==\s*existing\(\)\.ownerId/);
});

test('shadow field injection is blocked via hasAll + hasOnly blueprints', () => {
  assert.match(rulesContent, /isValidEmployee\(incoming\(\)\)/);
  assert.match(rulesContent, /isValidWeeklyBatch\(incoming\(\)\)/);
  assert.match(rulesContent, /isValidEvaluation\(incoming\(\),\s*batchId\)/);
  assert.match(rulesContent, /isValidActivityLog\(incoming\(\)\)/);
  assert.match(rulesContent, /isValidUserSettings\(incoming\(\)\)/);
  assert.match(rulesContent, /affectedKeys\(\)\.hasOnly\(/);
});

test('PII collections never allow blanket signed-in reads or lists', () => {
  assert.doesNotMatch(rulesContent, /allow\s+(read|get|list):\s*if\s+isSignedIn\(\)\s*;/);
  assert.match(rulesContent, /allow\s+list:\s*if\s+isVerified\(\)\s*&&\s*\(existing\(\)\.ownerId\s*==\s*request\.auth\.uid\s*\|\|\s*isAdmin\(\)\)/);
});

test('Master Gate verifies parent batch ownership on evaluations and activityLogs', () => {
  assert.match(rulesContent, /get\(\/databases\/\$\(database\)\/documents\/weeklyBatches\/\$\(batchId\)\)\.data\.ownerId\s*==\s*request\.auth\.uid/);
  assert.match(rulesContent, /get\(\/databases\/\$\(database\)\/documents\/weeklyBatches\/\$\(incoming\(\)\.batchId\)\)\.data\.ownerId\s*==\s*request\.auth\.uid/);
});

test('temporal integrity, bounded arrays, and terminal sent lock are enforced', () => {
  assert.match(rulesContent, /incoming\(\)\.createdAt\s*==\s*request\.time/);
  assert.match(rulesContent, /incoming\(\)\.updatedAt\s*==\s*request\.time/);
  assert.match(rulesContent, /data\.days\.size\(\)\s*<=\s*7/);
  assert.match(rulesContent, /existing\(\)\.status\s*!=\s*'sent'/);
});
