# The Desk — Outsourced Insurance Operations
## Build Plan & Module Breakdown

**Document version:** 1.1 — revised after the client's answers (Section 9)
**Date:** 26 October 2026 · revised 28 October 2026
**Source:** Client brief — *"An agency can upload its book of business, submit work to The Desk, and track everything in one place, while our AMs and specialized VA pods handle the work behind the scenes."*
**Purpose:** Scope the Desk foundation (architecture, four user views, insured account upload/management, task assignment) and break it into work modules of 2–3 hours each.

---

## 1. Objective

Build The Desk as a module inside the existing Insurigence platform, using the same login, database and design system. The foundation covers:

- Four role-based views: **Agency Portal**, **Account Manager Portal**, **Pod / VA Portal**, **Insurigence Admin**
- Agency **insured account** management, including Excel/CSV import
- A **task system** with automatic pod routing, VA assignment, subtasks, documents, notes and full activity history
- **Permissions** so agencies see only their own data and VAs see only the agencies and tasks they are authorized for
- **Agency-side roles** (Owner/Admin, Producer, CSR) with account-level assignment, managed by the agency admin
- **Need-to-know access** for Desk staff: VAs see only the information their assigned work requires, and every action is logged
- **Service levels** in business hours, with holidays, paused clocks while waiting, overdue alerts and an escalation ladder
- **Billable-activity tracking** against each agency's plan allowances (no invoicing yet)
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

- **Database is MongoDB via Prisma**, not PostgreSQL as `replit.md` states. Multi-document writes (task + subtask + event) use Prisma transactions, which require the MongoDB deployment to run as a replica set. Atlas does by default. This needs to be confirmed for the production environment before Module 12.
- **Tenant isolation is currently one rule:** `requireAgencyAccess` compares `user.agencyId`. The Desk adds a central access layer (Modules 9–10) instead of extending that check screen by screen.

---

## 3. Module Breakdown

Modules are sized for **one 2–3 hour working session each**, ordered so each builds on the previous.

**Revision 1.1:** the client's answers (Section 9) added 11 new modules, split the access layer into two, and expanded 11 others. In the **Change** column, 🆕 marks a new module and ✏️ an expanded one. Modules 1–4 were already complete. **None of them needs rework:** every change is additive, apart from the placeholder turnaround hours on routing rules, which Module 7 replaces with proper service-level targets. Modules after 4 have been renumbered.

### Phase 0 — Foundation (37.5 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 1 | Internal roles: add `ACCOUNT_MANAGER`, `DESK_VA`, `DESK_ADMIN`; `Agency.deskEnabled`; audit every existing role / `agencyId` check so new roles gain no unintended access | 2.5 | | ✅ Done |
| 2 | Desk org models: `Pod`, `PodMember`, `AgencyDeskAssignment` (primary + backup AM), `AgencyPodAccess` (authorized pods / VAs per agency); seed the 4 pods | 2.5 | | ✅ Done |
| 3 | Book-of-business models: `InsuredAccount`, `Policy`, `ImportBatch` | 2.5 | | ✅ Done |
| 4 | Task models: `Task`, `TaskEvent`, `TaskDocument`, `TaskRoutingRule`, `TaskFollowUpRule`, plus type / status / priority / source / visibility enums | 3.0 | | ✅ Done |
| 5 | Agency-side roles and account assignment: add the `CSR` agency role, label the existing `AGENT` role "Producer", per-user book access (all accounts / assigned only) set by the agency admin, `InsuredAssignment` (several producers / service staff per account) | 2.5 | 🆕 Q3 | ⬜ |
| 6 | Agency Desk profile and billing data: agency AMS system + agency-specific instructions + password-vault reference (never passwords); `DeskPlan` (Core / Growth / Complete) with monthly allowances, agency plan + overrides; task billing fields (service category, units, complexity, included / overage / non-billable, billing status) | 3.0 | 🆕 Q1, Q6 | ⬜ |
| 7 | Service levels and business calendar: task complexity (standard / complex), `WAITING_ON_INSURED` status, `ServiceLevelTarget` (by type × complexity × priority, with per-agency agreement overrides; business-time or days-before-expiration), business hours + holidays; seed the client's targets; replaces the placeholder turnaround on routing rules | 3.0 | 🆕 Q5 | ⬜ |
| 8 | Need-to-know and audit models: document sensitivity category, VA sensitive-data permissions, task restriction to named staff, `DeskAuditLog` for every action including document views and downloads | 2.5 | 🆕 Q4 | ⬜ |
| 9 | Access layer, part 1 — `lib/desk/access.ts` for agency users (admin / producer / CSR, book access, account assignment) and Account Managers; cross-tenant returns 404 | 2.5 | ✏️ Q3 | ⬜ |
| 10 | Access layer, part 2 — VAs on a need-to-know basis: agency authorization × pod × named restrictions × task; VAs reach insureds and policies only through tasks they can work; sensitive documents only with explicit permission | 2.5 | ✏️ Q4 | ⬜ |
| 11 | Business-hours SLA engine (pure, unit-tested): add business time across nights, weekends and holidays; elapsed time excluding waiting periods; expiration-anchored targets | 3.0 | 🆕 Q5 | ⬜ |
| 12 | Task service layer `lib/desk/tasks.ts`: create (routing + AM attach + SLA target), status state machine, assign, note; every action writes a `TaskEvent` and an audit entry; internal → agency status mapping | 3.0 | ✏️ | ⬜ |
| 13 | Task service, part 2 — SLA clock pause / resume on waiting statuses; billing capture at completion (classified as included or overage against the month's allowance, or non-billable) | 2.5 | 🆕 Q5, Q6 | ⬜ |
| 14 | Navigation shell: role-aware sidebar and post-login landing; route areas `/desk` (agency), `/desk-ops` (AM / VA), `/super-admin/desk`; placeholder pages | 2.5 | | ⬜ |

**Module 1 — Internal roles (✅ complete, 26 Oct 2026)**

**Delivered:**

- `UserRole` extended with `DESK_ADMIN`, `ACCOUNT_MANAGER`, `DESK_VA`. Existing roles are unchanged.
- `Agency.deskEnabled` (default `false`) and `Agency.deskEnabledAt`. The Desk is off for every agency until an admin turns it on (Module 15).
- `lib/roles.ts`: one shared definition of all roles, the agency / Desk role groups, display labels, and the rule `agencyIdForRole`. Agency roles must have an agency; every other role is forced to have none. Usable from both server and browser code.
- Super Admin user **create** now validates the role (an unknown role returned a server error before; it now returns a clear 400), and stores no agency for Desk staff even if one is sent.
- Super Admin user **update** now resolves role and agency together. **Existing bug fixed:** changing a user's role without also sending an agency left the old agency in place. Under the new roles, a promoted agent would have kept their former agency's access.
- Super Admin Users screen: role filter and create form list all six roles (grouped Agency / The Desk / Platform), with labels and colours. The agency field only appears for agency roles.
- Five screens that hard-coded the three-role list now use the shared type.

**Access audit — result:** all 40+ existing role and agency checks were reviewed. Every agency-data API either compares the record's agency with the user's, or rejects users with no agency. Desk staff have no agency, so **they cannot reach any existing agency data**. No existing API needed a change. The only changes were the Super Admin user routes above.

**Data:** the 3 existing agencies were backfilled with `deskEnabled: false`. MongoDB treats a missing field differently from `false`, so without this, a future "Desk not enabled" filter would have skipped them. All existing users already satisfy the new agency rule (0 agency users without an agency).

**Verified:** `prisma validate` passed · `tsc --noEmit` exit 0 · **21 tests passed** (`script/verify-desk-roles.ts`): 5 unit tests on the role rules, 7 on Super Admin create/update, and 9 calling the real APIs as an Account Manager (leads, lead archive, quotes, proposals, agency settings, team, intake, Super Admin), all denied, with the lead confirmed unchanged. Test users, sessions and audit events were removed afterwards.

**Not changed yet (by design):** Desk staff who log in currently land on the agency dashboard, which shows "No agency assigned". The Desk landing pages and navigation are Module 14.

**Module 2 — Organisation models (✅ complete, 26 Oct 2026)**

**Delivered:**

- `Pod`: a specialised team with a stable `code` (used by routing rules) and an editable display name, description, active flag and display order.
- `PodMember`: a staff member in a pod, with an optional "pod lead" flag. One person can be in several pods.
- `AgencyDeskAssignment`: one per agency, holding its primary Account Manager and an optional backup. One AM can be primary for many agencies.
- `AgencyPodAccess`: which pods may work an agency. A row without a user authorizes the **whole pod**. A row with a user authorizes **only that person**, which gives an allow-list for sensitive agencies. Nothing is authorized until a row exists.
- Eligibility rules in `lib/roles.ts`: only Account Managers can be assigned as AM; VAs and AMs can join pods (AMs cover QA initially).
- **4 default pods seeded** in the live database: Pod 1 Service & AMS (`SERVICE_AMS`), Pod 2 Renewals & Remarketing (`RENEWALS`), Pod 3 New Business & Marketing (`NEW_BUSINESS`), Pod 4 Quality Assurance (`QA`).
- `npm run db:seed:desk`: a separate, repeatable pod seeder. It only creates missing pods and never overwrites a pod an admin has renamed. It is kept separate from `npm run db:seed` because that script also resets the demo users' passwords. The main seed now creates the pods too, for fresh databases.

**Delete behaviour:** deleting an agency removes its assignment and pod access. Deleting a staff member removes their pod memberships and named access. Deleting a backup AM clears the backup slot but keeps the agency's assignment.

**Issue caught during testing:** a "whole pod" access row is stored with the user field **missing**, and MongoDB does not match a missing field when searching for "no user". Every whole-pod authorization would have been invisible to the access checks in Module 10. Fixed with one shared filter (`WHOLE_POD_ACCESS`) that matches both forms, with tests proving the plain search misses it and the shared filter finds it. Duplicate protection was unaffected, because the unique index treats the two forms the same.

**Verified:** `prisma validate` passed · `prisma db push` created 4 collections and 9 indexes · `tsc --noEmit` exit 0 · **22 tests passed** (`script/verify-desk-org.ts`) covering eligibility, default pods, seeding idempotency, every uniqueness rule and delete behaviour, on temporary agencies and users that were removed afterwards · Module 1 suite re-run: 21 passed.

**Module 3 — Book-of-business models (✅ complete, 26 Oct 2026)**

**Delivered:**

- `InsuredAccount`: an agency's serviced client. Name and DBA, active / inactive status, contact (name, email, phone, website), mailing address, industry, description, notes, and the agency's own AMS client code. It also records how the account was created (manual, import, or converted from a lead), which import created it, and who created it. It is kept separate from `Lead`, which stays the prospect pipeline.
- `Policy`: belongs to an insured. Policy number, line of business, carrier, effective and expiration dates, premium, status (active / pending / expired / cancelled), notes and AMS reference. Premiums are stored in whole cents, as with quotes.
- `ImportBatch`: one spreadsheet upload. File details, the column mapping chosen, row and result counts, and committed / undone timestamps for the one-click undo in Module 27.
- `ImportRow`: each uploaded row exactly as parsed, with its row number, validation status and error messages. Rows are stored separately because a large book embedded in the batch could exceed MongoDB's 16 MB document limit.
- `lib/desk/insureds.ts` → `insuredNameKey()`: a normalized name for duplicate detection. "ABC Plumbing, L.L.C.", "abc plumbing llc" and "ABC Plumbing" all match. It ignores punctuation, accents, "&" vs "and", a leading "The" and legal suffixes (LLC, Inc, Co, Ltd …), while keeping genuinely different names apart.

**Design decisions:**

- **Line of business and carrier are free text.** The existing line-of-business list only contains Commercial GL, and agency AMS exports label lines inconsistently. Carrier follows the quote pattern: a free-text name plus an optional link to the agency's carrier list. Standard lists can be added once the client's AMS answer (Q1) is known.
- **Optional identifiers are indexed, not unique.** MongoDB's unique index allows only one record with a missing value, which would block the second insured imported without an AMS code. Duplicates are detected by the importer (Module 26), where the user can decide what to do with them.
- **Indexed for the queries that come next:** duplicate lookup (agency + name key), AMS code lookup, renewals (agency + expiration date), and undo (import batch).
- **Undo is explicit.** Deleting an import record removes its rows but never the clients it created. Removing those is a deliberate action with its own safety checks (Module 27).

**Pending client input (Q2):** core fields are in place. Extra columns from the client's real exports can be added without affecting existing data.

**Verified:** `prisma validate` passed · `prisma db push` created 4 collections and 12 indexes · `tsc --noEmit` exit 0 · **28 tests passed** (`script/verify-desk-book.ts`): 9 on name matching, and 19 against the database covering agency separation, multiple clients without AMS codes, exact premium storage for very large amounts, the 90-day renewal query, import rows and undo lookup, and delete behaviour, on temporary agencies removed afterwards · Module 1 and 2 suites re-run: 21 and 22 passed.

**Module 4 — Task models (✅ complete, 26 Oct 2026)**

**Delivered:**

- `Task`: the backbone. Every task carries its agency, and optionally the insured and policy. It also holds type, title, description, priority, status, pod, Account Manager, assigned VA, working due date, the original target date, source (agency / internal / system / AI), escalation details, start / complete / cancel times, last activity, and a parent task for subtasks.
- **Reference numbers:** every task gets a short number (#1001, #1002 …) that agencies and staff can quote to each other. It is issued by an atomic counter, so two requests submitted at the same moment can never receive the same number.
- **14 request types:** COI, Endorsement, ACORD, AMS Entry, Policy Update, Document Upload, Renewal, Remarketing, Loss Runs, New Business, Submission, Proposal Prep, QA Review, Other.
- **8 internal statuses:** New, Assigned, In Progress, Waiting on Agency, Waiting on Carrier, QA Review, Completed, Cancelled. The simplified agency view is built on top of these in Module 12.
- `TaskEvent`: the task's permanent history (status changes, assignments, routing, priority / due-date changes, notes, documents, escalations, subtasks). Each entry is marked **internal** or **agency-visible**, and is **internal by default**, so a mistake hides information rather than leaking it.
- `TaskDocument`: files on a task, stored privately in the existing secure storage, also internal by default. Removing a file hides it but keeps the record for the history.
- `TaskRoutingRule`: which pod each request type goes to, its default priority and its turnaround. **Seeded with 13 rules** (below).
- `TaskFollowUpRule`: "when a task of type X reaches status Y, create a task of type Z". **Seeded with the client's example:** Renewal completed → AMS update for Pod 1. Also New Business completed → AMS entry.
- `npm run db:seed:desk` now seeds pods, routing and follow-up rules. It is create-only, so an admin's edits are never overwritten.

**Default routing** *(the turnaround hours below were placeholders; Module 7 replaces them with the client's business-hours targets from Section 9)*:

| Pod | Request types | Turnaround |
|---|---|---|
| Pod 1 – Service & AMS | COI | 24 h |
| | Endorsement, ACORD, AMS Entry, Policy Update, Document Upload | 48 h |
| Pod 2 – Renewals & Remarketing | Renewal, Remarketing | 120 h |
| | Loss Runs | 72 h |
| Pod 3 – New Business & Marketing | New Business | 120 h |
| | Submission, Proposal Prep | 72 h |
| Pod 4 – Quality Assurance | QA Review | 24 h |
| *(none — Account Manager triages)* | Other | — |

**Design decisions:**

- **Two due dates.** The *working* due date can be moved by the AM. The *target* date is set once at creation and never changes, so turnaround reporting (Module 42) measures against what was originally committed.
- **Work history is protected.** An insured, policy or parent task that has tasks against it cannot be deleted. This also covers import undo (Module 27), which can never wipe out a client that already has work.
- **AI-ready:** each task records whether it was created by an agency, staff, an automatic rule or AI, and can link to the existing AI audit trail.

**Issue prevented:** the same MongoDB gap found in Module 2 applies to tasks. A task with no pod or no assignee stores those fields as missing, so the "waiting for AM triage" and "unassigned in the pod queue" lists would have silently shown nothing. Shared filters (`UNROUTED`, `UNASSIGNED`, `TOP_LEVEL` in `lib/desk/task-filters.ts`) are in place before any screen uses them, with a test proving the plain filter misses these tasks.

**Verified:** `prisma validate` passed · `prisma db push` created 6 collections and 14 indexes · `tsc --noEmit` exit 0 · seeding re-run creates nothing · **26 tests passed** (`script/verify-desk-tasks.ts`): seeded rules, 25 simultaneous reference requests all receiving distinct consecutive numbers, task defaults, subtasks, queue filters, internal-vs-agency timeline, document soft delete, and delete protection, on temporary records removed afterwards · Module 1–3 suites re-run: 21, 22, 28 passed.

### Phase 1 — Admin Setup (13 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 15 | Enable The Desk per agency; assign primary / backup AM; Desk profile (AMS system, instructions, plan and allowance overrides) | 3.0 | ✏️ Q1, Q6 | ⬜ |
| 16 | Internal staff management: create / invite / deactivate AMs, VAs, Desk Admins / Operations Managers (reuses invite flow) | 2.5 | | ⬜ |
| 17 | Pod management: create / edit pods, add / remove VAs, authorize pods and named VAs per agency, VA sensitive-data permissions | 3.0 | ✏️ Q4 | ⬜ |
| 18 | Routing and service-level editor: request type → pod, default priority; targets by type, complexity and priority; per-agency agreement overrides | 2.5 | ✏️ Q5 | ⬜ |
| 19 | Business calendar editor: business hours, time zone, holidays | 2.0 | 🆕 Q5 | ⬜ |

### Phase 2 — Insured Accounts (22.5 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 20 | Insured accounts API: CRUD with policies and staff assignments, scoped through the access layer | 3.0 | ✏️ Q3 | ⬜ |
| 21 | Agency Portal: insured list (search, filter, paging, "my accounts") + add / edit form | 3.0 | | ⬜ |
| 22 | Insured detail page: profile, assigned producer / CSR, policies, open tasks, documents | 2.5 | | ⬜ |
| 23 | Agency user permissions: agency admin sets each user's role and book access, and assigns producers / CSRs to accounts (single and bulk) | 2.5 | 🆕 Q3 | ⬜ |
| 24 | Import engine: server-side CSV / XLSX parsing, header detection, staging rows in an `ImportBatch` | 3.0 | | ⬜ |
| 25 | Import mapping UI: map any export's columns to Desk fields, with mappings remembered per agency for the next upload | 3.0 | ✏️ Q2 | ⬜ |
| 26 | Import validation and grouping: several policy rows per insured, insured-only rows, producer matched to agency users, date / premium / policy-status parsing, duplicate detection, preview | 3.0 | 🆕 Q2 | ⬜ |
| 27 | Import commit, one-click undo of a batch, downloadable import template | 2.5 | | ⬜ |

### Phase 3 — Task System Core (17 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 28 | Task API: create, scoped list, detail, transition, assign, notes | 3.0 | | ⬜ |
| 29 | Agency: submit service request (insured picker, request type, complexity, details, attachments) | 2.5 | | ⬜ |
| 30 | Task documents: upload / download / remove on R2, internal vs agency-visible, sensitivity category, every view and download logged | 2.5 | ✏️ Q4 | ⬜ |
| 31 | Pod queue for VAs: queue, filters, pick up / assign, "My tasks" | 3.0 | | ⬜ |
| 32 | Internal task workspace: status and waiting reason, internal and agency notes, history timeline, documents, reassign, complexity and billing review | 3.0 | | ⬜ |
| 33 | Agency tracker: simplified statuses, "Needs your attention", completed work, agency task view | 3.0 | | ⬜ |

### Phase 4 — Account Manager Portal & Communication (11 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 34 | AM dashboard: assigned agencies, open requests, overdue, items to review, upcoming renewals from policy expirations | 3.0 | | ⬜ |
| 35 | AM per-agency view: drill-down into one agency's accounts and work | 2.5 | | ⬜ |
| 36 | Messaging: agency ↔ AM general thread, plus per-task conversation | 3.0 | | ⬜ |
| 37 | Email notifications: new request, assigned, needs attention, completed | 2.5 | | ⬜ |

### Phase 5 — Subtasks, Service Levels & Oversight (17 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 38 | Subtasks: manual creation, parent / child display, parent completion rule | 2.5 | | ⬜ |
| 39 | Follow-up rules engine + admin editor (e.g. Renewal completed → AMS update in Pod 1) | 2.5 | | ⬜ |
| 40 | Admin workload view: all tasks across agencies and pods, reassign, escalate | 3.0 | | ⬜ |
| 41 | Overdue alerts and escalation ladder: approaching / overdue tasks go to the assigned AM, then to the Operations Manager; scheduled check | 3.0 | 🆕 Q5 | ⬜ |
| 42 | Turnaround metrics per pod, VA and agency, in business time excluding waiting periods | 3.0 | ✏️ Q5 | ⬜ |
| 43 | Service usage and audit views: each agency's monthly usage against its plan allowances (included / overage / non-billable), audit log viewer | 3.0 | 🆕 Q4, Q6 | ⬜ |

### Phase 6 — Hardening & Acceptance (7.5 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 44 | Permission test suite: cross-agency access, producer scope, unauthorized VA, VA need-to-know and sensitive documents, restricted tasks, internal-note leak to agency | 3.0 | ✏️ | ⬜ |
| 45 | Demo seed data, end-to-end walkthrough of all four views, bug fixes | 2.5 | | ⬜ |
| 46 | Client handover report | 2.0 | | ⬜ |

---

## 4. Schedule Summary

| Phase | Modules | Hours | v1.0 hours |
|---|---|---:|---:|
| 0 — Foundation | 1–14 | 37.5 | 19.0 |
| 1 — Admin Setup | 15–19 | 13.0 | 10.0 |
| 2 — Insured Accounts | 20–27 | 22.5 | 17.0 |
| 3 — Task System Core | 28–33 | 17.0 | 17.0 |
| 4 — AM Portal & Communication | 34–37 | 11.0 | 11.0 |
| 5 — Subtasks, Service Levels & Oversight | 38–43 | 17.0 | 11.0 |
| 6 — Hardening & Acceptance | 44–46 | 7.5 | 7.5 |
| **Total** | **46 modules** | **125.5 h** | **92.5 h** |

**Progress:** Modules 1–4 complete (10.5 h). **115 h remaining.**

The client's answers added **33 hours** (see Section 9), approximately:

| Answer | Added | Where |
|---|---:|---|
| Q2 — flexible imports with policies | 3 h | Module 26 |
| Q3 — agency-side roles and account assignment | 6 h | Modules 5, 23, part of 9 |
| Q4 — need-to-know access and audit log | 4.5 h | Module 8, part of 10, part of 43 |
| Q5 — business-hours service levels, holidays, pausing, escalation | 13 h | Modules 7, 11, 19, 41, parts of 13 and 18 |
| Q6 (+ Q1) — billing tracking, plans, agency AMS profile | 6.5 h | Module 6, parts of 13, 15 and 43 |

At **2–3 hours per day**, the full plan is approximately:

- **46 working days**, one module per day (42 remaining)
- **~9 working weeks** at 5 days per week
- **~11 calendar weeks** allowing for review cycles and client feedback

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
| `IN_PROGRESS`, `WAITING_ON_CARRIER`, `WAITING_ON_INSURED` *(v1.1)*, `QA_REVIEW` | In Progress |
| `WAITING_ON_AGENCY` | Needs Your Attention |
| `COMPLETED` | Completed |
| `CANCELLED` | Cancelled |

The service-level clock **pauses** in all three `WAITING_ON_…` statuses and resumes when work restarts (Module 13).

Initial request types: `COI`, `ENDORSEMENT`, `ACORD`, `AMS_ENTRY`, `POLICY_UPDATE`, `DOCUMENT_UPLOAD`, `RENEWAL`, `REMARKETING`, `LOSS_RUNS`, `NEW_BUSINESS`, `SUBMISSION`, `PROPOSAL_PREP`, `QA_REVIEW`, `OTHER`.

### 5.5 Additions in revision 1.1 (Modules 5–8)

```
Agency roles       ADMIN = Owner/Admin · AGENT shown as "Producer" · + CSR
User               + bookAccess (ALL | ASSIGNED) — set by the agency admin;
                     Admin always ALL, Producer defaults ASSIGNED, CSR either
InsuredAssignment  insuredId, userId, role (PRODUCER | SERVICE)   — several per account

Agency             + amsSystem (Applied Epic, AMS360, HawkSoft, EZLynx, QQCatalyst, Other)
                   + amsSystemOther, deskInstructions, credentialVaultRef
                     (a pointer to the password manager entry — never a password)
DeskPlan           code (CORE | GROWTH | COMPLETE), name, monthlyPriceCents,
                   allowances { managedAccounts, coi, endorsement, renewal, remarketingCredits }
AgencyDeskPlan     agencyId, planId, allowance overrides, startsOn
Task               + complexity (STANDARD | COMPLEX)
                   + billing: serviceCategory, billableUnits, billingClass
                     (INCLUDED | OVERAGE | NON_BILLABLE), billingStatus, countedInMonth

ServiceLevelTarget taskType, complexity?, priority?, agencyId? (agreement override),
                   businessMinutes  — or —  daysBeforeExpiration (renewal work)
BusinessCalendar   timeZone, working days, start / end time
Holiday            date, name
TaskStatus         + WAITING_ON_INSURED

TaskDocument       + sensitivity (GENERAL | POLICY | FINANCIAL | PERSONAL)
DeskStaffPermission userId, may view FINANCIAL / PERSONAL documents
Task               + restrictedToUserIds (only these staff, plus the AM, may see it)
DeskAuditLog       actorId, action, entity, entityId, agencyId, ip, userAgent, at
                   — every create / change / view / download, append-only
```

---

## 6. Key Design Decisions

- **One app, not a separate product.** Same login, so one person can later hold both an agency role and a Desk role without a second account.
- **One access layer.** Every Desk query goes through `lib/desk/access.ts`. No screen writes its own permission check.
- **One service layer.** Every task change goes through `lib/desk/tasks.ts`, so API routes, follow-up rules and (later) AI all obey the same routing, permissions and history.
- **Rules are data, not code.** Routing and follow-up rules live in the database and are edited by admins.
- **History is append-only.** `TaskEvent` rows are never edited or deleted.
- **Internal by default.** Notes and documents are internal unless explicitly marked agency-visible, so a mistake hides information rather than leaking it.
- **Cross-tenant access returns 404, not 403**, consistent with the proposal system.
- **Need-to-know for Desk staff (v1.1).** A VA does not browse an agency's book. They reach an insured or policy only through a task they are authorized to work: agency authorization × pod × any named restriction on the agency or task. Financial and personal documents need an explicit permission on top of that.
- **Credentials are never stored (v1.1).** The Desk keeps only a pointer to the password-manager entry for an agency's AMS or carrier logins.
- **Everything is logged (v1.1).** Every create, change, view and download goes to an append-only audit log, separate from the task history the agency sees.
- **Billing is classified at completion (v1.1).** When a task is completed, it is counted against the agency's monthly allowance for its service category and marked included, overage or non-billable. Invoicing is out of scope, but the data is accurate from day one.
- **Service levels are business time (v1.1).** Targets are measured in working hours on the Desk calendar, skip weekends and holidays, and pause while waiting on the agency, insured or carrier.

---

## 7. AI Readiness (no AI features in this plan)

- `Task.source = AI` and `Task.aiRunId` link AI-created work to the existing `AiRun` audit trail.
- AI-created tasks arrive as suggestions that a person accepts, in line with the existing AI guardrails in `AI_ROADMAP.md`.
- Structured types, statuses and policy dates make later automation possible: renewal tasks from expirations, document extraction into task fields, next-step recommendations.

---

## 8. Out of Scope for This Plan

- Individual workflows: renewal pipeline, COI workflow, endorsements, new business / submissions, QA checklists
- **Automatic renewal generation** from expiration dates. The data, indexes and expiration-anchored targets (90–120 / 45–60 days) are in place, so this is the first workflow to build next.
- AMS integrations (Applied Epic, AMS360, HawkSoft, EZLynx, QQCatalyst, etc.). AMS work is manual tasks for Pod 1.
- Storing carrier or AMS passwords. These stay in the client's password manager.
- AI features (task creation, extraction, drafting, recommendations)
- Invoicing and payment processing. Billable activity is tracked (Modules 6, 13, 43).
- The agency-facing usage dashboard. Usage data and an internal usage view are built (Module 43); the agency-facing version follows.
- Insured-facing (end-customer) portal

---

## 9. Client Answers (received 27 October 2026)

| # | Question | Client's answer | How the plan uses it |
|---|---|---|---|
| Q1 | AMS platforms | Any AMS: Applied Epic, AMS360, HawkSoft, EZLynx, QQCatalyst, others. AMS work is manual for Pod 1. Each agency's profile records its AMS and agency-specific instructions. Integrations later. | AMS system + instructions on the agency's Desk profile (Modules 6, 15). AMS integrations stay out of scope. |
| Q2 | Upload contents | Insured- and policy-level: named insured / DBA, address, contact, assigned producer, policy number, carrier, line, effective / expiration dates, premium, status. Several policies per insured. Flexible column mapping, preview, then import. Insured-only files allowed. Expiration dates are key for future renewals. | Fields already modelled in Module 3; the producer is linked through account assignment (Module 5). Mappings are remembered per agency (25). Multi-row grouping, insured-only rows and producer matching (26). |
| Q3 | Agency-side users | Owner/Admin sees everything. Producer sees assigned accounts unless granted more. CSR sees assigned accounts or the whole book. The agency admin manages this. Several producers / service staff per account. | CSR role, book-access setting, `InsuredAssignment` (5), access rules (9), admin screen (23). |
| Q4 | VA data access | Need-to-know: agency authorization, pod, individual permissions, task requirements. Restrict agencies or tasks to specific employees. Log all actions. Never store carrier / AMS passwords. | Sensitivity categories, staff permissions, task restriction, audit log (8), VA access rules (10), document logging (30), audit viewer (43). Credentials not stored. |
| Q5 | Turnaround targets | Configurable by type, priority and agency agreement. Initial targets below. Business hours, weekends, holidays, pause while waiting, overdue alerts, escalation to the AM then the Operations Manager. Internal targets, not guarantees. | Targets model and seed (7), SLA engine (11), pause / resume (13), editors (18, 19), escalation (41), metrics (42). |
| Q6 | Billing | Monthly retainer tiers (Core $1,500, Growth $2,500, Complete from $4,000) with allowances for managed accounts, COIs, endorsements, renewals and remarketing credits; overages billed separately. Track billable activity now; invoicing later. | Plans, allowances and task billing fields (6), classification at completion (13), usage view (43). |

**Client's initial turnaround targets** (seeded in Module 7, editable in Module 18):

| Request | Target |
|---|---|
| Standard COI | 4 business hours |
| Complex COI | 1 business day |
| Standard endorsement | 2 business days |
| Complex endorsement | 3 business days (or per carrier response) |
| AMS data entry / update | 1 business day |
| New-business submission preparation | 2 business days after complete information |
| Routine document request | 1 business day |
| Renewal outreach | Start 90–120 days before expiration |
| Renewal remarketing preparation | 45–60 days before expiration |

---

## 10. Decisions and Remaining Details

**Decisions made in this revision.** These are design choices for the client to see and correct if needed:

- **Existing roles are reused.** The platform's `ADMIN` role is the agency Owner/Admin. The existing `AGENT` role is shown as **Producer**, because agents already use leads and proposals and keep doing so. A new **CSR** role is added. The agency's CSR is labelled "CSR" throughout, to avoid confusion with the Desk's own Account Manager.
- **"Operations Manager" is the `DESK_ADMIN` role,** shown with that label. Escalations go to the assigned AM first, then to Desk Admins.
- **Complexity is chosen by the agency** when submitting (Standard by default). The AM or VA can reclassify it, and every reclassification is logged, because it affects both the target and billing.
- **Follow-up tasks are non-billable by default** (for example, the AMS update after a renewal), since they are part of the parent service. This is configurable per rule.
- **Renewal targets are anchored to the expiration date** rather than counted from creation. The target model supports both from the start.
- Internal staff (`ACCOUNT_MANAGER`, `DESK_VA`, `DESK_ADMIN`) have no `agencyId`; their access comes only from Desk assignments.
- `SUPER_ADMIN` keeps full access and can act as Desk Admin.

**Details still needed from the client.** None blocks work. Each is configurable, so a placeholder is used until confirmed:

| # | Detail | Needed by | Placeholder until then |
|---|---|---|---|
| D1 | Monthly allowances per tier (managed accounts, COIs, endorsements, renewals, remarketing credits) and which services can be billed as overage | Module 13 | Plans created with zero allowances; editable |
| D2 | Desk business hours, time zone and holiday list | Module 11 | Mon–Fri 9:00–17:00 US Eastern; US federal holidays |
| D3 | Document sensitivity categories: are General / Policy / Financial / Personal the right four? | Module 8 | Those four |
| D4 | Can a Producer submit requests for accounts outside their assignment? | Module 9 | No: only accounts they can see |
