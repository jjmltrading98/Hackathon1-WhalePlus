# WhalePulse Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants & Relationship Mapping

1. **Master Source of Truth & Ownership**:
   - Every document in `/userSessions/{sessionId}`, `/scannerConfigs/{scannerId}`, `/whaleCandidates/{candidateId}`, `/optionPrints/{printId}`, and `/llmEngineConfigs/{configId}` is strictly owned by an authenticated, email-verified user (`request.auth.uid == data.ownerId` and `request.auth.token.email_verified == true`).
   - For `/userSessions/{sessionId}` and `/llmEngineConfigs/{configId}`, the document path variable (`{sessionId}` or `{configId}`) MUST equal `request.auth.uid` so each user can only read/write their own canonical workspace session state and LLM engine configuration.
2. **Strict Schema & Volumetric Bounds**:
   - Every collection enforces exact `hasAll` and `hasOnly` key allowlists on `create`, and action-based `incoming().diff(existing()).affectedKeys().hasOnly(...)` on `update` wrapped inside `isValid[Entity](incoming())`.
   - Every string field enforces explicit `minLength`, `maxLength` (`.size()`), and `pattern` (`.matches()`) checks synchronized with `firebase-blueprint.json`.
   - Every document ID variable (`{sessionId}`, `{scannerId}`, `{candidateId}`, `{printId}`) is guarded by `isValidId(id)` (`id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`) on single-document operations (`get`, `create`, `update`, `delete`).
3. **Temporal & Immutability Invariants**:
   - `createdAt` must equal `request.time` on creation and is strictly immutable (`incoming().createdAt == existing().createdAt`) on update.
   - `updatedAt` must equal `request.time` on both creation and update.
   - `ownerId` is strictly immutable (`incoming().ownerId == existing().ownerId`).
4. **Terminal State Locking**:
   - For `/whaleCandidates/{candidateId}`, once `existing().status == 'invalidated'`, no further updates are permitted (`existing().status != 'invalidated'`).
5. **Query Enforcer (No Blanket Reads)**:
   - Every `allow list` rule explicitly enforces `isVerifiedUser() && resource.data.ownerId == request.auth.uid` without any `get()` or `exists()` calls inside `list`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Identity Spoofing on Create)**: Creating `/userSessions/user_1` with `ownerId: "victim_uid"` while authenticated as `attacker_uid` -> **PERMISSION_DENIED**.
2. **Payload 2 (Unverified Email Spoofing)**: Writing to `/scannerConfigs/scn_1` when `request.auth.token.email_verified == false` -> **PERMISSION_DENIED**.
3. **Payload 3 (Shadow / Ghost Field Injection)**: Creating `/scannerConfigs/scn_1` with an undeclared field `"isAdmin": true` -> **PERMISSION_DENIED** via `keys().hasOnly(...)`.
4. **Payload 4 (Update-Gap / Value Poisoning)**: Updating `/scannerConfigs/scn_1` allowed key `name` with a 5,000-character string or boolean -> **PERMISSION_DENIED** via `isValidScannerConfigDoc(incoming())` wrapping `allow update`.
5. **Payload 5 (ID Poisoning Attack)**: Creating `/whaleCandidates/bad$id!@#` with invalid characters or >128 chars -> **PERMISSION_DENIED** via `isValidId(candidateId)`.
6. **Payload 6 (Immutable Owner Hijack on Update)**: Updating `/whaleCandidates/cand_1` to change `ownerId` from `user_1` to `user_2` -> **PERMISSION_DENIED**.
7. **Payload 7 (Timestamp Forgery)**: Creating `/optionPrints/prt_1` with a backdated `createdAt` timestamp (`createdAt != request.time`) -> **PERMISSION_DENIED**.
8. **Payload 8 (Terminal State Bypass)**: Updating `/whaleCandidates/cand_1` when `existing().status == 'invalidated'` -> **PERMISSION_DENIED**.
9. **Payload 9 (Unauthorized List Query Scraping)**: Executing an unconstrained `list` query on `/whaleCandidates` without `where('ownerId', '==', request.auth.uid)` -> **PERMISSION_DENIED**.
10. **Payload 10 (Cross-User Session Read)**: Reading `/userSessions/user_2` while signed in as `user_1` -> **PERMISSION_DENIED**.
11. **Payload 11 (Enum Violation on Candidate Direction)**: Creating `/whaleCandidates/cand_1` with `direction: "sideways"` -> **PERMISSION_DENIED**.
12. **Payload 12 (Immutable Option Print Mutation)**: Attempting to `update` an audit log record in `/optionPrints/prt_1` -> **PERMISSION_DENIED** (append-only audit log; `allow update: if false`).
