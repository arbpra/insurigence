# The Desk — Outsourced Insurance Operations
## Build Plan & Module Breakdown

**Document version:** 1.0
**Date:** 26 October 2026
**Source:** Client brief — *"An agency can upload its book of business, submit work to The Desk, and track everything in one place, while our AMs and specialized VA pods handle the work behind the scenes."*
**Purpose:** Scope the Desk foundation (architecture, four user views, insured account upload/management, task assignment) and break it into work modules of 2–3 hours each.

---

## 1. Objective

Build The Desk as a module inside the existing Insurigence platform, using the same login, database and design system. The foundation covers:

- Four role-based views: **Agency Portal**, **Account Manager Portal**, **Pod / VA Portal**, **Insurigence Admin**
- Agency **insured account** management, including Excel/CSV import
- A **task system** with automatic pod routing, VA assignment, subtasks, documents, notes and full activity history
- **Permissions** so agencies see only their own data and VAs see only the agencies and tasks they are authorized for
- A service layer designed so **Insurigence AI** can later create and progress tasks through the same rules as a person

Individual workflows (renewal pipeline, COI workflow, endorsements, new business, QA) are built **after** this foundation and are not part of this plan.

### Target workflow

```
Agency uploads book → Agency submits request → Auto-routed to pod (AM attached)
     → VA assigned → Work in progress → (Waiting on agency / carrier)
     → QA review (optional) → Completed → Follow-up subtask created (if rule applies)
     → Agency sees completed work
```

---

## 2. Current State Audit

### 2.1 What already exists and will be reused

| Area | Where | How The Desk uses it |
|---|---|---|
| Auth, sessions, roles | `lib/auth.ts`, `middleware.ts` | Extended with new internal roles. Not rebuilt. |
| Invite + password reset | `InviteToken`, `PasswordResetToken`, `app/(auth)/invite` | Onboarding for AMs and VAs |
| Agency model + Super Admin agency/user screens | `Agency`, `app/(main)/super-admin/agencies` | Desk enablement and AM assignment are added to these screens |
| Document storage (Cloudflare R2) | `lib/storage/r2.ts` | Task and insured documents. Same private-bucket, presigned-URL model |
| Email | `lib/email/` (Resend) | Desk notifications |
| Activity logging pattern | `ActivityEvent`, `ProposalActivityEvent` | Template for `TaskEvent` |
| AI layer + audit trail | `lib/ai/`, `AiRun` (with agent review fields) | Future AI task creation / document extraction. Already follows "AI drafts, human approves" |
| ACORD generation, COI assist | `lib/acord/`, `app/api/ai/coi` | Future Pod 1 workflows |
| App shell + UI components | `AppLayout`, `DataTable`, `StatCard`, `Badge` | All four portals |

### 2.2 What is missing

| Gap | Detail |
|---|---|
| Internal staff roles | `UserRole` is only `SUPER_ADMIN / ADMIN / AGENT`. No AM, VA, or Desk Admin. |
| Multi-agency access | `User.agencyId` is a single value. An AM spans many agencies; a VA is scoped by pod and authorized agencies. |
| Insured accounts | `Lead` models prospects only. There is no model for an agency's serviced book or its policies. |
| Tasks | No task, queue, routing, subtask or SLA concept anywhere. |
| Spreadsheet parsing | No CSV/XLSX library installed. |

### 2.3 Infrastructure notes

- **Database is MongoDB via Prisma**, not PostgreSQL as `replit.md` states. Multi-document writes (task + subtask + event) use Prisma transactions, which require the MongoDB deployment to run as a replica set. Atlas does by default. This needs to be confirmed for the production environment before Module 6.
- **Tenant isolation is currently one rule:** `requireAgencyAccess` compares `user.agencyId`. The Desk adds a central access layer (Module 5) instead of extending that check screen by screen.

---

## 3. Module Breakdown

Modules are sized for **one 2–3 hour working session each**, ordered so each builds on the previous.

The **Needs answer** column links a module to the open questions in Section 9. **No module is fully blocked.** Where an answer is pending, the module is built with the default in Section 10 and adjusted once the client replies.

### Phase 0 — Foundation (19 h)

| # | Module | Hours | Needs answer | Status |
|---|---|---:|---|---|
| 1 | Internal roles: add `ACCOUNT_MANAGER`, `DESK_VA`, `DESK_ADMIN`; `Agency.deskEnabled`; audit every existing role / `agencyId` check so new roles gain no unintended access | 2.5 | — | ✅ Done |
| 2 | Desk org models: `Pod`, `PodMember`, `AgencyDeskAssignment` (primary + backup AM), `AgencyPodAccess` (authorized pods / VAs per agency); seed the 4 pods | 2.5 | — | ⬜ |
| 3 | Book-of-business models: `InsuredAccount`, `Policy`, `ImportBatch` | 2.5 | Q2 (extra fields only) | ⬜ |
| 4 | Task models: `Task`, `TaskEvent`, `TaskDocument`, `TaskRoutingRule`, `TaskFollowUpRule`, plus type / status / priority / source / visibility enums | 3.0 | — | ⬜ |
| 5 | Central access layer `lib/desk/access.ts`: per-role scope filters, `canViewTask` / `canEditTask`, cross-tenant returns 404; unit tests | 3.0 | Q3, Q4 (defaults) | ⬜ |
| 6 | Task service layer `lib/desk/tasks.ts`: create (routing + AM attach + due date), status state machine, assign, note; every action writes a `TaskEvent`; internal → agency status mapping | 3.0 | Q5 (due-date defaults) | ⬜ |
| 7 | Navigation shell: role-aware sidebar and post-login landing; route areas `/desk` (agency), `/desk-ops` (AM / VA), `/super-admin/desk`; placeholder pages | 2.5 | — | ⬜ |

**Module 1 — Internal roles (✅ complete, 26 Oct 2026)**

**Delivered:**

- `UserRole` extended with `DESK_ADMIN`, `ACCOUNT_MANAGER`, `DESK_VA`. Existing roles are unchanged.
- `Agency.deskEnabled` (default `false`) and `Agency.deskEnabledAt`. The Desk is off for every agency until an admin turns it on (Module 8).
- `lib/roles.ts`: one shared definition of all roles, the agency / Desk role groups, display labels, and the rule `agencyIdForRole`. Agency roles must have an agency; every other role is forced to have none. Usable from both server and browser code.
- Super Admin user **create** now validates the role (an unknown role returned a server error before; it now returns a clear 400), and stores no agency for Desk staff even if one is sent.
- Super Admin user **update** now resolves role and agency together. **Existing bug fixed:** changing a user's role without also sending an agency left the old agency in place. Under the new roles, a promoted agent would have kept their former agency's access.
- Super Admin Users screen: role filter and create form list all six roles (grouped Agency / The Desk / Platform), with labels and colours. The agency field only appears for agency roles.
- Five screens that hard-coded the three-role list now use the shared type.

**Access audit — result:** all 40+ existing role and agency checks were reviewed. Every agency-data API either compares the record's agency with the user's, or rejects users with no agency. Desk staff have no agency, so **they cannot reach any existing agency data**. No existing API needed a change. The only changes were the Super Admin user routes above.

**Data:** the 3 existing agencies were backfilled with `deskEnabled: false`. MongoDB treats a missing field differently from `false`, so without this, a future "Desk not enabled" filter would have skipped them. All existing users already satisfy the new agency rule (0 agency users without an agency).

**Verified:** `prisma validate` passed · `tsc --noEmit` exit 0 · **21 tests passed**: 5 unit tests on the role rules, 7 on Super Admin create/update, and 9 calling the real APIs as an Account Manager (leads, lead archive, quotes, proposals, agency settings, team, intake, Super Admin), all denied, with the lead confirmed unchanged. Test users, sessions and audit events were removed afterwards.

**Not changed yet (by design):** Desk staff who log in currently land on the agency dashboard, which shows "No agency assigned". The Desk landing pages and navigation are Module 7.

### Phase 1 — Admin Setup (10 h)

| # | Module | Hours | Needs answer | Status |
|---|---|---:|---|---|
| 8 | Enable The Desk per agency; assign primary / backup AM (API + agency detail UI) | 2.5 | — | ⬜ |
| 9 | Internal staff management: create / invite / deactivate AMs, VAs, Desk Admins (reuses invite flow) | 2.5 | — | ⬜ |
| 10 | Pod management: create / edit pods, add / remove VAs, authorize pods and VAs per agency | 3.0 | — | ⬜ |
| 11 | Routing rules editor: request type → pod, default priority, default turnaround | 2.0 | Q5 (values) | ⬜ |

### Phase 2 — Insured Accounts (17 h)

| # | Module | Hours | Needs answer | Status |
|---|---|---:|---|---|
| 12 | Insured accounts API — CRUD with policies, scoped through the access layer | 3.0 | — | ⬜ |
| 13 | Agency Portal: insured list (search, filter, paging) + add / edit form | 3.0 | — | ⬜ |
| 14 | Insured detail page: profile, policies, open tasks, documents | 2.5 | — | ⬜ |
| 15 | Import engine: server-side CSV / XLSX parsing, header detection, staging rows in an `ImportBatch` | 3.0 | — | ⬜ |
| 16 | Import UI: column mapping, row-level validation preview, duplicate detection | 3.0 | Q2 (default mappings) | ⬜ |
| 17 | Import commit, one-click undo of a batch, downloadable import template | 2.5 | Q2 (template columns) | ⬜ |

### Phase 3 — Task System Core (17 h)

| # | Module | Hours | Needs answer | Status |
|---|---|---:|---|---|
| 18 | Task API: create, scoped list, detail, transition, assign, notes | 3.0 | — | ⬜ |
| 19 | Agency: submit service request (insured picker, request type, details, attachments) | 2.5 | — | ⬜ |
| 20 | Task documents: upload / download / remove on R2, internal vs agency-visible | 2.5 | — | ⬜ |
| 21 | Pod queue for VAs: queue, filters, pick up / assign, "My tasks" | 3.0 | — | ⬜ |
| 22 | Internal task workspace: status, internal and agency notes, history timeline, documents, reassign | 3.0 | — | ⬜ |
| 23 | Agency tracker: simplified statuses, "Needs your attention", completed work, agency task view | 3.0 | — | ⬜ |

### Phase 4 — Account Manager Portal & Communication (11 h)

| # | Module | Hours | Needs answer | Status |
|---|---|---:|---|---|
| 24 | AM dashboard: assigned agencies, open requests, overdue, items to review, upcoming renewals from policy expirations | 3.0 | — | ⬜ |
| 25 | AM per-agency view: drill-down into one agency's accounts and work | 2.5 | — | ⬜ |
| 26 | Messaging: agency ↔ AM general thread, plus per-task conversation | 3.0 | — | ⬜ |
| 27 | Email notifications: new request, assigned, needs attention, completed | 2.5 | — | ⬜ |

### Phase 5 — Subtasks & Oversight (11 h)

| # | Module | Hours | Needs answer | Status |
|---|---|---:|---|---|
| 28 | Subtasks: manual creation, parent / child display, parent completion rule | 2.5 | — | ⬜ |
| 29 | Follow-up rules engine + admin editor (e.g. Renewal completed → AMS update in Pod 1) | 2.5 | — | ⬜ |
| 30 | Admin workload view: all tasks across agencies and pods, reassign, escalate | 3.0 | — | ⬜ |
| 31 | Turnaround and overdue tracking; metrics per pod, VA and agency | 3.0 | Q5 (targets) | ⬜ |

### Phase 6 — Hardening & Acceptance (7.5 h)

| # | Module | Hours | Needs answer | Status |
|---|---|---:|---|---|
| 32 | Permission test suite: cross-agency access, unauthorized VA, internal-note leak to agency | 3.0 | — | ⬜ |
| 33 | Demo seed data, end-to-end walkthrough of all four views, bug fixes | 2.5 | — | ⬜ |
| 34 | Client handover report | 2.0 | — | ⬜ |

---

## 4. Schedule Summary

| Phase | Modules | Hours |
|---|---|---:|
| 0 — Foundation | 1–7 | 19.0 |
| 1 — Admin Setup | 8–11 | 10.0 |
| 2 — Insured Accounts | 12–17 | 17.0 |
| 3 — Task System Core | 18–23 | 17.0 |
| 4 — AM Portal & Communication | 24–27 | 11.0 |
| 5 — Subtasks & Oversight | 28–31 | 11.0 |
| 6 — Hardening & Acceptance | 32–34 | 7.5 |
| **Total** | **34 modules** | **92.5 h** |

At **2–3 hours per day**, this is approximately:

- **34 working days**, one module per day
- **~7 working weeks** at 5 days per week
- **~8–9 calendar weeks** allowing for review cycles and client feedback

---

## 5. Data Model Changes

All new collections carry `agencyId` (where applicable) and are indexed on it, matching the existing tenant pattern.

### 5.1 Roles and organisation

```
UserRole           + ACCOUNT_MANAGER, DESK_VA, DESK_ADMIN   (internal staff: agencyId = null)
Agency             + deskEnabled, deskEnabledAt
Pod                name, code, description, isActive
PodMember          podId, userId, isLead
AgencyDeskAssignment  agencyId, primaryAmId, backupAmId
AgencyPodAccess    agencyId, podId, userId? (null = whole pod authorized)
```

### 5.2 Book of business

```
InsuredAccount     agencyId, name, dba, contact fields, address, industry,
                   status, externalRef (AMS id), importBatchId?, convertedFromLeadId?
Policy             agencyId, insuredId, carrier, lineOfBusiness, policyNumber,
                   effectiveDate, expirationDate, premiumCents, status
ImportBatch        agencyId, uploadedById, fileName, columnMapping, rowCount,
                   createdCount, skippedCount, errorRows, status, undoneAt
```

### 5.3 Tasks

```
Task               agencyId, insuredId?, policyId?, parentTaskId?,
                   type, title, description, priority, status,
                   podId, amId, assigneeId?, dueAt, slaDueAt,
                   source (AGENCY | AM | SYSTEM | AI), createdById, aiRunId?,
                   escalated, startedAt, completedAt
TaskEvent          taskId, agencyId, actorId?, kind (STATUS | NOTE | ASSIGN | DOC | ...),
                   visibility (INTERNAL | AGENCY), body, metadata, createdAt   (append-only)
TaskDocument       taskId, agencyId, storageKey, fileName, size, contentType,
                   visibility, uploadedById
TaskRoutingRule    taskType → podId, defaultPriority, turnaroundHours
TaskFollowUpRule   onTaskType + onStatus → createTaskType in podId
```

### 5.4 Status model

| Internal status (team sees) | Agency status (agency sees) |
|---|---|
| `NEW`, `ASSIGNED` | Received |
| `IN_PROGRESS`, `WAITING_ON_CARRIER`, `QA_REVIEW` | In Progress |
| `WAITING_ON_AGENCY` | Needs Your Attention |
| `COMPLETED` | Completed |
| `CANCELLED` | Cancelled |

Initial request types: `COI`, `ENDORSEMENT`, `ACORD`, `AMS_ENTRY`, `POLICY_UPDATE`, `DOCUMENT_UPLOAD`, `RENEWAL`, `REMARKETING`, `LOSS_RUNS`, `NEW_BUSINESS`, `SUBMISSION`, `PROPOSAL_PREP`, `QA_REVIEW`, `OTHER`.

---

## 6. Key Design Decisions

- **One app, not a separate product.** Same login, so one person can later hold both an agency role and a Desk role without a second account.
- **One access layer.** Every Desk query goes through `lib/desk/access.ts`. No screen writes its own permission check.
- **One service layer.** Every task change goes through `lib/desk/tasks.ts`, so API routes, follow-up rules and (later) AI all obey the same routing, permissions and history.
- **Rules are data, not code.** Routing and follow-up rules live in the database and are edited by admins.
- **History is append-only.** `TaskEvent` rows are never edited or deleted.
- **Internal by default.** Notes and documents are internal unless explicitly marked agency-visible, so a mistake hides information rather than leaking it.
- **Cross-tenant access returns 404, not 403**, consistent with the proposal system.

---

## 7. AI Readiness (no AI features in this plan)

- `Task.source = AI` and `Task.aiRunId` link AI-created work to the existing `AiRun` audit trail.
- AI-created tasks arrive as suggestions that a person accepts, in line with the existing AI guardrails in `AI_ROADMAP.md`.
- Structured types, statuses and policy dates make later automation possible: renewal tasks from expirations, document extraction into task fields, next-step recommendations.

---

## 8. Out of Scope for This Plan

- Individual workflows: renewal pipeline, COI workflow, endorsements, new business / submissions, QA checklists
- AMS integrations (Applied Epic, AMS360, HawkSoft, EZLynx, etc.)
- AI features (task creation, extraction, drafting, recommendations)
- Billing for Desk services
- Field-level data masking for VAs (pending Q4)
- Insured-facing (end-customer) portal

---

## 9. Open Questions — Sent to Client

| # | Question | Affects |
|---|---|---|
| Q1 | Which AMS platforms do the agencies use? | Future integrations; import column hints |
| Q2 | What does a typical agency export contain — insureds only, or policies with expiration dates? | Modules 3, 16, 17 |
| Q3 | Do all staff at an agency see everything, or only their own accounts? | Module 5 |
| Q4 | Are there restrictions on what data VAs may see? | Module 5; masking (later) |
| Q5 | Target turnaround times per request type? | Modules 6, 11, 31 |
| Q6 | How will Desk work be billed? | Not in this plan |

---

## 10. Assumptions (used until the client answers)

- **Q2:** Imports contain insureds and, where present, policies with expiration dates. Both are supported; policies are optional per row.
- **Q3:** All users of an agency see all of that agency's Desk data.
- **Q4:** VAs see full records for agencies they are authorized for, and nothing for other agencies.
- **Q5:** Turnaround defaults are placeholders (e.g. COI 1 business day, endorsement 2, others 5), editable in the routing rules screen.
- Internal staff (`ACCOUNT_MANAGER`, `DESK_VA`, `DESK_ADMIN`) have no `agencyId`; their access comes only from Desk assignments.
- `SUPER_ADMIN` keeps full access and can act as Desk Admin.
