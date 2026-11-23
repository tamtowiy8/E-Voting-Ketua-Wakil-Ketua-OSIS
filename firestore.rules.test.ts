import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const blueprint = JSON.parse(fs.readFileSync(path.resolve('firebase-blueprint.json'), 'utf8'));
const rulesFile = fs.existsSync('firestore.rules') ? 'firestore.rules' : 'DRAFT_firestore.rules';
const rulesText = fs.readFileSync(path.resolve(rulesFile), 'utf8');

test('rules use rules_version 2 and default-deny catch-all', () => {
  assert.match(rulesText, /rules_version\s*=\s*'2'/);
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});

test('all blueprint collections have matching rules blocks', () => {
  const expectedCollections = [
    'admins',
    'users',
    'sheetLinks',
    'elections',
    'candidates',
    'voters',
    'auditLogs',
  ];
  for (const col of expectedCollections) {
    assert.ok(rulesText.includes(`match /${col}/`), `Missing match block for ${col}`);
  }
  assert.ok(Object.keys(blueprint.firestore).length >= 7);
});

test('Dirty Dozen security invariants are enforced in rules', () => {
  // 1 & 2. Auth + email_verified guard
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  // 3. No self-assigned admin escalation
  assert.match(rulesText, /incoming\(\)\.role == 'operator' \|\| isAdmin\(\)/);
  // 4. UID / Owner binding
  assert.match(rulesText, /incoming\(\)\.ownerId == request\.auth\.uid/);
  // 5. Strict key allowlisting (no shadow fields)
  assert.match(rulesText, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rulesText, /affectedKeys\(\)\.hasOnly\(/);
  // 6. Path ID validation
  assert.match(rulesText, /function isValidId\(id\)/);
  // 7. String & list bounds
  assert.match(rulesText, /data\.vision\.size\(\) <= 1000/);
  assert.match(rulesText, /data\.missions\.size\(\) <= 20/);
  // 8. Type validation
  assert.match(rulesText, /data\.totalDpt is int/);
  // 9. Temporal integrity
  assert.match(rulesText, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesText, /incoming\(\)\.updatedAt == request\.time/);
  // 10. Immutable owner/createdAt
  assert.match(rulesText, /incoming\(\)\.ownerId == existing\(\)\.ownerId/);
  assert.match(rulesText, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
  // 11. Parent existence check (Master Gate)
  assert.match(rulesText, /exists\(\/databases\/\$\(database\)\/documents\/elections\/\$\(electionId\)\)/);
  // 12. Terminal state lock & list query owner enforcement
  assert.match(rulesText, /existing\(\)\.status != 'closed'/);
  assert.match(rulesText, /allow list: if isVerifiedUser\(\) && \(existing\(\)\.ownerId == request\.auth\.uid \|\| isAdmin\(\)\)/);
  // 13. Voter votedCandidateId validation guard
  assert.match(rulesText, /'votedCandidateId'/);
  assert.match(rulesText, /isValidId\(data\.votedCandidateId\)/);
  // 14. Election voterLoginMode enum validation guard
  assert.match(rulesText, /'voterLoginMode'/);
  assert.match(rulesText, /data\.voterLoginMode in \['NISN', 'QR_CODE', 'BOTH'\]/);
  // 15. Bounded summary tally maps for 1-doc real-time monitoring
  assert.match(rulesText, /data\.candidateVotes is map && data\.candidateVotes\.size\(\) <= 50/);
  assert.match(rulesText, /data\.gradeTotals is map && data\.gradeTotals\.size\(\) <= 10/);
  assert.match(rulesText, /data\.gradeVoted is map && data\.gradeVoted\.size\(\) <= 10/);
});
