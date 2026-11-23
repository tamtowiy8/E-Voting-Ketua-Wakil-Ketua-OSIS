# Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Identity Integrity**: Every document created by a user in `/users/{userId}`, `/users/{userId}/sheetLinks/{linkId}`, `/elections/{electionId}`, `/elections/{electionId}/candidates/{candidateId}`, and `/elections/{electionId}/voters/{voterId}` MUST carry an owner/uid matching `request.auth.uid`, and `request.auth.token.email_verified == true`.
2. **Master Gate Relational Sync**: Subcollection writes (`/sheetLinks`, `/candidates`, `/voters`) MUST verify parent document existence via `exists()` and parent ownership via `get()` on `/users/{userId}` or `/elections/{electionId}`.
3. **Immutable Ownership & Timestamps**: `ownerId`, `uid`, `electionId`, and `createdAt` cannot be modified after creation. `createdAt == request.time` on creation and `updatedAt == request.time` on update.
4. **No Self-Assigned Admin Roles**: Standard users creating `/users/{userId}` MUST set `role == 'operator'`; only a verified `isAdmin()` (including bootstrapped admin `tamtowiy8@gmail.com`) can manage `/admins/{uid}` or set `role == 'admin'`.
5. **Terminal State Locking**: Once an `/elections/{electionId}` document reaches `status == 'closed'`, non-admin owners cannot mutate it unless an `isAdmin()` overrides.
6. **Zero PII Leakage & Strict List Enforcement**: No blanket `isSignedIn()` reads or lists. All `allow list` rules check `resource.data.ownerId == request.auth.uid || isAdmin()` without invoking `get()`/`exists()` inside `allow list`.

## 2. "Dirty Dozen" Adversarial Payloads (Must All Be Rejected)
1. **Unauthenticated Write**: Create `/elections/e1` with `request.auth == null`.
2. **Unverified Email Write**: Create `/users/u1` with `request.auth.uid == 'u1'` and `email_verified: false`.
3. **Self-Assigned Admin Escalation**: Create `/users/u1` with `role: 'admin'` by non-admin user `u1`.
4. **UID / Owner Spoofing**: Create `/elections/e1` as `u1` with `ownerId: 'victim_uid'`.
5. **Ghost / Shadow Field Injection**: Create `/users/u1/sheetLinks/s1` with extra `isVerified: true` field.
6. **ID Poisoning**: Create `/elections/invalid id with spaces and 200 chars...` violating `isValidId()`.
7. **Resource Exhaustion (1MB String)**: Create `/elections/e1/candidates/c1` with `vision` length > 1000 chars.
8. **Type Poisoning on Update**: Update `/elections/e1` changing `totalDpt` to string `"many"` or negative `-5`.
9. **Temporal Spoofing**: Create `/elections/e1` with client-forged `createdAt` != `request.time`.
10. **Immutable Field Tampering**: Update `/elections/e1/voters/v1` changing `ownerId` or `electionId`.
11. **Orphaned Subcollection Write**: Create `/elections/nonexistent/voters/v1` where parent `/elections/nonexistent` does not exist.
12. **Terminal State Bypass & Cross-User List Scraping**: Non-admin attempting `list` on `/elections/e1/voters` without `ownerId == request.auth.uid`, or updating `/elections/e1` when `status == 'closed'`.
