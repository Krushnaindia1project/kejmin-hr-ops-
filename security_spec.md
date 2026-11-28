# KEJMIN OPS Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Verified Identity Gate**: Every Firestore read and write requires an authenticated user with `request.auth.token.email_verified == true`.
2. **PII Isolation (Split Collection)**: Private user PII (`email`, `phone`, `passwordHash`, `passwordSalt`) resides strictly in `/users/{empDocId}` and is readable/writable only by its owner (`authUid == request.auth.uid`) or a verified Admin. Non-PII organizational roster fields (`name`, `role`, `branch`, `location`, `designation`, `photoUrl`) reside in `/directory/{empDocId}`.
3. **No Self-Role Escalation**: Non-admin self-registration in `/directory/{empDocId}` is strictly limited to `role in ['Process Coordinator', 'Plant Staff']` and must bind `authUid == request.auth.uid`. Users cannot modify their own `role`, `branch`, or `location` after creation.
4. **Immutable Audit Log**: `/auditLog/{logId}` entries are strictly append-only (`update` and `delete` are unconditionally denied), require `at == request.time` and `actorUid == request.auth.uid`, and are readable only by Developer/Admin accounts.
5. **Append-Only Scoring Ledger**: `/scoreEvents/{eventId}` entries are strictly append-only (`update` and `delete` are unconditionally denied), require `at == request.time` and `actorUid == request.auth.uid`, and enforce bounded point ranges (`-20 <= points <= 20`). Send-back reversals append negative point events rather than mutating history.
6. **Task Lifecycle & Terminal State Lock**: Tasks start at `stage == 0` with `status == 'open'`. Non-admin stage advances must increment `stage` by exactly `1`; send-backs must decrement `stage` by `1` with a non-empty `lastSendBackReason`. Once `status == 'closed'`, non-admins are locked out of further updates.
7. **Strict Schema & Path Hardening**: Every single-document operation validates `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars). Every write validates required/allowed keys (`hasAll` + `hasOnly`), string `.size()` bounds, bounded list sizes, and server timestamps (`request.time`).
8. **Secure List Queries**: No blanket `allow list: if isSignedIn();` rules exist. Every `allow list` evaluates `resource.data` without `get()` or `exists()` lookups.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Target Collection | Attack Class | Malicious Payload / Operation | Expected Result |
|---|-------------------|--------------|-------------------------------|-----------------|
| 1 | `/tasks/{taskId}` | Unauthenticated Read/Write | Unauthenticated `create` on `/tasks/t1` | `PERMISSION_DENIED` |
| 2 | `/tasks/{taskId}` | Unverified Email Spoofing | Auth token with `email: "krushna.hka2@gmail.com"`, `email_verified: false` | `PERMISSION_DENIED` |
| 3 | `/directory/{empDocId}` | Self-Role Escalation | Non-admin creates `/directory/hacker` with `role: "Developer"` | `PERMISSION_DENIED` |
| 4 | `/users/{empDocId}` | PII Blanket Leak | Non-admin `get` on another user's `/users/asha` | `PERMISSION_DENIED` |
| 5 | `/tasks/{taskId}` | Shadow Field Injection | Create task with extra ghost field `isVerified: true` | `PERMISSION_DENIED` |
| 6 | `/tasks/{taskId}` | Resource Poisoning (ID) | Create task with 200-char doc ID containing spaces/slashes | `PERMISSION_DENIED` |
| 7 | `/tasks/{taskId}` | State Shortcutting | Non-admin updates task stage directly from `0` to `3` | `PERMISSION_DENIED` |
| 8 | `/tasks/{taskId}` | Terminal State Bypass | Non-admin updates a task where `status == "closed"` | `PERMISSION_DENIED` |
| 9 | `/scoreEvents/{eventId}` | Score Tampering | Any user attempts `update` or `delete` on `/scoreEvents/s1` | `PERMISSION_DENIED` |
| 10 | `/auditLog/{logId}` | Audit Log Deletion / Forgery | Non-developer reads `/auditLog` or admin attempts `delete` on `/auditLog/l1` | `PERMISSION_DENIED` |
| 11 | `/tasks/{taskId}` | Client Timestamp Forgery | Create task with client-backdated `createdAt` (`!= request.time`) | `PERMISSION_DENIED` |
| 12 | `/directory/{empDocId}` | Value Poisoning on Update | Non-admin updates own profile with `name: 12345` or oversized 500-char name | `PERMISSION_DENIED` |
| 13 | `/supportTickets/{ticketId}` | Identity Spoofing / Shadow Field | Create ticket with `reporterUid != request.auth.uid` or ghost field `isAdmin: true` | `PERMISSION_DENIED` |
| 14 | `/supportTickets/{ticketId}` | Closed Ticket Field Mutation | Non-admin modifies `title` or `pri` on a `closed` ticket without reopening it | `PERMISSION_DENIED` |
| 15 | `/ticketAttachments/{attachmentId}` | Orphaned Attachment Injection | Create attachment referencing non-existent `ticketId` or oversized `data` (>800KB) | `PERMISSION_DENIED` |

