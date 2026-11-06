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
| 5 | Agency-side roles and account assignment: add the `CSR` agency role, label the existing `AGENT` role "Producer", per-user book access (all accounts / assigned only) set by the agency admin, `InsuredAssignment` (several producers / service staff per account) | 2.5 | 🆕 Q3 | ✅ Done |
| 6 | Agency Desk profile and billing data: agency AMS system + agency-specific instructions + password-vault reference (never passwords); `DeskPlan` (Core / Growth / Complete) with monthly allowances, agency plan + overrides; task billing fields (service category, units, complexity, included / overage / non-billable, billing status) | 3.0 | 🆕 Q1, Q6 | ✅ Done |
| 7 | Service levels and business calendar: task complexity (standard / complex), `WAITING_ON_INSURED` status, `ServiceLevelTarget` (by type × complexity × priority, with per-agency agreement overrides; business-time or days-before-expiration), business hours + holidays; seed the client's targets; replaces the placeholder turnaround on routing rules | 3.0 | 🆕 Q5 | ✅ Done |
| 8 | Need-to-know and audit models: document sensitivity category, VA sensitive-data permissions, task restriction to named staff, `DeskAuditLog` for every action including document views and downloads | 2.5 | 🆕 Q4 | ✅ Done |
| 9 | Access layer, part 1 — `lib/desk/access.ts` for agency users (admin / producer / CSR, book access, account assignment) and Account Managers; cross-tenant returns 404 | 2.5 | ✏️ Q3 | ✅ Done |
| 10 | Access layer, part 2 — VAs on a need-to-know basis: agency authorization × pod × named restrictions × task; VAs reach insureds and policies only through tasks they can work; sensitive documents only with explicit permission | 2.5 | ✏️ Q4 | ✅ Done |
| 11 | Business-hours SLA engine (pure, unit-tested): add business time across nights, weekends and holidays; elapsed time excluding waiting periods; expiration-anchored targets | 3.0 | 🆕 Q5 | ✅ Done |
| 12 | Task service layer `lib/desk/tasks.ts`: create (routing + AM attach + SLA target), status state machine, assign, note; every action writes a `TaskEvent` and an audit entry; internal → agency status mapping | 3.0 | ✏️ | ✅ Done |
| 13 | Task service, part 2 — SLA clock pause / resume on waiting statuses; billing capture at completion (classified as included or overage against the month's allowance, or non-billable) | 2.5 | 🆕 Q5, Q6 | ✅ Done |
| 14 | Navigation shell: role-aware sidebar and post-login landing; route areas `/desk` (agency), `/desk-ops` (AM / VA), `/super-admin/desk`; placeholder pages | 2.5 | | ✅ Done |

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

**Module 5 — Agency-side roles and account assignment (✅ complete, 29 Oct 2026)**

**Delivered:**

- **Three agency roles, as the client described:**
  - **Owner / Admin** (the existing agency admin role) always sees the whole book.
  - **Producer** (the existing agent role, renamed on screen; producers keep using leads and proposals exactly as before).
  - **CSR** (new).
- **Book access per user:** each Producer or CSR either sees **only their assigned accounts** (the default) or **the whole book**, as granted by the agency admin. The default is the narrower view, so wider access is always a deliberate choice by the admin. The screen to manage it is Module 23.
- `InsuredAssignment`: links agency users to the accounts they're responsible for, as **producer** or **service** (CSR). An account can have several producers and service staff, as requested. This is also where an imported "assigned producer" column will land (Module 26).
- Agency admins can now **invite CSRs** from the Team page. They still cannot create Desk staff or platform roles. Role names display as Owner / Admin, Producer, CSR and Operations Manager (Desk Admin) across the Team, Super Admin Users and Agency screens.
- The rules live in `lib/roles.ts`: `effectiveBookAccess`, `canBeAssignedToInsured`, `defaultAssignmentRole`. The access layer (Module 9) builds on them.

**Issue fixed:** changing agency settings was blocked only for the `AGENT` role, a block-list. Any new agency role, such as CSR, would have been allowed to change the agency's settings, branding and disclaimer. It is now an allow-list (Owner / Admin and Super Admin only), and a test confirms a CSR is refused.

**Data:** existing users have no stored book-access value, which correctly means "use the role default", so no backfill was needed. All existing agents now show as Producers, with no change to what they can do in the existing tools.

**Verified:** `prisma validate` passed · `prisma db push` created 1 collection and 2 indexes · `tsc --noEmit` exit 0 · **31 tests passed** (`script/verify-desk-agency-roles.ts`): role and book-access rules; CSR invitation through the real invite endpoint with emails switched off; agency admins unable to create Desk or platform roles; settings admin-only; CSR and Producer read access unchanged; several producers per account; "my accounts" lookup; delete behaviour; temporary records removed · Module 1–4 suites re-run: 21, 22, 28, 26 passed (the Module 1 role count updated from six to seven).

**Module 6 — Agency Desk profile and billing data (✅ complete, 29 Oct 2026)**

**Delivered — agency profile:**

- **AMS system** on each agency: Applied Epic, AMS360, HawkSoft, EZLynx, QQCatalyst, or Other with the agency's own system name.
- **Agency-specific instructions** for Desk staff.
- **Password-vault reference:** where the agency's AMS and carrier logins live in the password manager (for example "1Password › Desk › Acme Insurance"). A pointer only.
- **Credential guard** (`lib/desk/profile.ts`): text that reads like a password, PIN, API key or security answer ("Epic password: …", "pwd=…") is recognized and will be refused when saved (screen in Module 15). Ordinary mentions such as "logins are in 1Password" or "reset the password via the portal" are allowed. This puts the client's rule into practice: credentials are never stored in The Desk.

**Delivered — billing data (tracked now; invoicing later):**

- `DeskPlan`: **Desk Core $1,500 · Desk Growth $2,500 · Desk Complete from $4,000**, seeded. Each has a managed-accounts allowance and per-service monthly allowances. Prices and allowances are data, editable without code.
- **Allowances per service category:** COIs, Endorsements, Renewals, Remarketing credits, New business, General service. Each allowance can be a number of units or unlimited.
- `AgencyDeskPlan`: the plan each agency is on, its start date, and any **negotiated price** (needed for "Complete from $4,000"), managed-accounts override or per-category allowance overrides.
- **Billing fields on every task:**
  - complexity (standard / complex)
  - service category
  - billable units
  - a non-billable flag for internal work
  - billing class (included / overage / non-billable, decided once at completion in Module 13)
  - invoicing status (unbilled / billed / waived / not applicable)
  - the month it counted toward
- **Type → category mapping** (`lib/desk/billing.ts`): Submission and Proposal Prep count as New business, Loss Runs as Renewal, AMS entry / ACORD / policy updates / documents as General service. QA review is internal and never billed. Follow-up tasks (such as the AMS update after a renewal) are non-billable by default, configurable per rule.
- **Billing month is computed in the Desk's time zone.** A COI completed at 9:59pm New York time on 31 October counts toward October, even though it is already November in UTC.

**Pending client input (D1):** allowances are **deliberately not seeded**. A guessed allowance would mark real work as included or overage incorrectly. The system reports "not configured" until the numbers are entered. **D1 is needed before Module 13**, where completed tasks are classified.

**Data:** the 2 existing follow-up rules were backfilled as non-billable (same MongoDB reason as before). No tasks existed, so nothing else needed backfilling. A new shared filter, `BILLING_UNCLASSIFIED`, finds tasks awaiting classification, with a test proving the plain filter misses them.

**Verified:** `prisma validate` passed · `prisma db push` created 4 collections and 6 indexes · `tsc --noEmit` exit 0 · **33 tests passed** (`script/verify-desk-billing.ts`): AMS names; the credential guard refusing 9 credential-like texts with no false alarms on 7 ordinary instructions; every request type mapped; billing month across time zones; allowance resolution (override over plan, unlimited, not configured) both in memory and from stored records; seeded plans and prices; one plan per agency; plans in use protected from deletion; task billing defaults and filters; temporary records removed · Module 1–5 suites re-run: 21, 22, 28, 26, 31 passed.

**Module 7 — Service levels and business calendar (✅ complete, 29 Oct 2026)**

**Delivered:**

- `ServiceLevelTarget`: an internal turnaround target for a request type. It can be narrowed by complexity and / or priority, and an agency's own service agreement can override the Desk default. A target takes one of three forms:
  - **N business hours** (e.g. 4 for a standard COI)
  - **N business days** (e.g. 2 for a standard endorsement). Days stay days, so if the Desk's hours change from 9–5 to 8–6, "1 business day" still means one day.
  - **Anchored to the policy's expiration date** (renewal work): when the work opens and when it is due.
- **The client's targets, seeded:**

  | Request | Target |
  |---|---|
  | COI — standard / complex | 4 business hours / 1 business day |
  | Endorsement — standard / complex | 2 / 3 business days (time waiting on the carrier is paused) |
  | AMS entry, policy update | 1 business day |
  | New business, submission | 2 business days (paused while waiting on complete information) |
  | Document request | 1 business day |
  | Renewal | Opens 120 days before expiration, due by 90 |
  | Remarketing | Opens 60 days before expiration, due by 45 |

- **Which target applies:** the most specific one wins. An agency's own agreement beats any Desk default. Then priority beats complexity, so a future "Urgent COI" target applies to every urgent COI. A target naming both beats either.
- **Each task keeps a copy of its target** when created. Editing a target later never changes what an open task was promised.
- **New status "Waiting on Insured"**, alongside Waiting on Agency and Waiting on Carrier. The clock pauses in all three (Module 13). Agencies see it as "In Progress".
- `DeskCalendar` (working days, hours, time zone) and `DeskHoliday` (dates stored as plain calendar dates, so they can't shift with time zones). Seeded with the **placeholder Mon–Fri 9:00–17:00 US Eastern and 23 US federal holidays for 2026–2027** on their observed dates.
- The placeholder turnaround hours from Module 4 were **removed** from routing rules, including from the 13 stored records.
- Helpers in `lib/desk/service-levels.ts`: target selection, plain-English wording ("4 business hours", "due 90 days before expiration (opens at 120)"), validation for the editor in Module 18, and the task snapshot. `npm run db:seed:desk` now also prints each request type's pod and target.

**For the client:** five request types have **no target yet** because none was given: **ACORD, Loss Runs, Proposal Prep, QA Review and Other**. Those tasks will have no target date until one is set (detail D5).

**Verified:** `prisma validate` passed · `prisma db push` created 3 collections and 3 indexes · `tsc --noEmit` exit 0 · **31 tests passed** (`script/verify-desk-service-levels.ts`): target selection across agency / priority / complexity / type, inactive and missing targets; wording and validation; all 11 client targets stored correctly; duplicate defaults refused whether empty fields were written or left out; agency agreements beside defaults; calendar values and a valid time zone; every observed holiday on a weekday; re-seeding creating nothing; the new status and target snapshot on a task; temporary records removed · Module 1–6 suites re-run: 21, 22, 28, 26, 31, 33 passed.

**Module 8 — Need-to-know and audit models (✅ complete, 29 Oct 2026)**

**Delivered:**

- **Document sensitivity:** every task document is classified as **General, Policy documents, Financial or Personal information** (placeholder categories, D3). There is **no default**: the uploader must choose, so an unclassified bank statement can never land in the open category.
- **Who sees which category** (`lib/desk/need-to-know.ts`):
  - **Desk VAs:** General and Policy, plus Financial and / or Personal only if individually granted.
  - **Account Managers, Operations Managers and Super Admin:** everything for the agencies they oversee.
  - **Agency users:** all of their own agency's documents.
- `DeskStaffPermission`: one record per Desk staff member, holding the extra categories they've been granted. No record means defaults only. (Granting screen: Module 17.)
- **Restricting a task to named staff:** a task can be limited to specific people, with a reason (for example "VIP client"). Only those people, the agency's Account Manager and Operations Managers can see it. Agency users are unaffected. This works alongside the agency-level restriction from Module 2 (authorizing only named VAs for an agency).
- `DeskAuditLog`: the security trail. Every create, change, view, download and **refused attempt**, with who, their role, what, which agency, IP address and browser, plus context. It is separate from the task history agencies see, and is never shown to agencies.
  - **It fails closed:** if an entry can't be written, the action doesn't happen, so "all actions are logged" holds.
  - **Values under secret-looking names** (password, token, API key, PIN) are redacted before saving, at any depth.

**Issue found and solved:** a task stored without its restriction list (possible after a raw database write or migration) **cannot be matched by any Prisma filter**. Tests showed "is empty", "equals empty" and even "NOT non-empty" all skip it, so such a task would silently vanish from every queue. Normal code always stores the list. As a safeguard, an integrity check and repair (`lib/desk/integrity.ts`) now runs with `npm run db:seed:desk`, and it found nothing to repair in the live data.

**Verified:** `prisma validate` passed · `prisma db push` created 2 collections and 5 indexes · `tsc --noEmit` exit 0 · **37 tests passed** (`script/verify-desk-need-to-know.ts`): the full sensitivity matrix by role and grant; restriction rules; restriction as a database filter, including the missing-list trap, detection, repair and idempotency; documents refused without a category; one permission record per person, applied to a real financial document; audit redaction, request context, a recorded download and a recorded refusal; and a simulated database failure proving the audit log fails closed · Module 1–7 suites re-run: 21, 22, 28, 26, 31, 33, 31 passed.

**Module 9 — Access layer, part 1 (✅ complete, 29 Oct 2026)**

**Delivered:**

- `lib/desk/access.ts`: the single place that decides what a user may see in The Desk. Every Desk screen and API from here on asks it, so no page writes its own permission check.
- **What each role sees:**
  - **Owner / Admin:** the agency's whole book.
  - **Producer and CSR:** the accounts they're assigned to, unless the agency admin granted them the whole book. They also see requests they submitted themselves, including general requests not tied to an account.
  - **Account Manager:** every agency where they are primary or backup AM, including tasks restricted to named staff (Module 8).
  - **Operations Manager and Super Admin:** every agency.
  - **Desk VA:** nothing yet. VA need-to-know scoping is Module 10, and until then VAs are refused everywhere, so nothing is exposed early.
  - **Agencies without The Desk switched on:** no access for their users or their AM.
- **One rule applied three ways:** the same scope filters account lists, policy lists and task lists, and guards opening a single account, policy or task.
- **Out of scope is "not found":** another agency's record, an unassigned account, a nonexistent id and a malformed id all return the same 404. A user can't tell whether a record exists. Responses carry no detail.
- **Every refusal is audited** with who, their role, the record, the record's real agency, IP address and browser. A logging failure still refuses the request.
- **Submitting requests (D4 default):** a user may submit only for accounts they can see. The agency is always taken from the account or the user's own agency, never from what the browser sends, so a request can't be filed into another agency. A policy must belong to the chosen account. AMs can file on behalf of agencies they cover.
- **Managing access:** only the agency's Owner / Admin (for their own agency), Operations Managers and Super Admin may change book access and account assignments. Producers, CSRs and AMs can't (client answer Q3).
- **Changes apply on the next request:** permissions are read from the database each time, not from the login session. Granting the whole book, removing a backup AM or switching The Desk off takes effect immediately, without signing out.

**Design decisions:**

- **404, not 403,** for anything outside a user's scope, so record ids can't be probed across agencies.
- **Producers see requests they submitted,** even on accounts later reassigned, so they can follow their own work. They don't see colleagues' general requests.
- **VAs are denied by default** until Module 10 defines their scope, rather than given temporary broad access.

**Issues:** none. All tests passed on the first run.

**Verified:** `tsc --noEmit` exit 0 · **61 tests passed** (`script/verify-desk-access.ts`) on three temporary agencies (two with The Desk, one without) with 12 users across every role: scope resolution; account, policy and task lists by role; single-record 404s for cross-agency, unassigned, nonexistent and malformed ids; refusals audited with the real agency; submission rules; who may manage access; changes taking effect immediately; generic error responses; temporary records removed · Module 1–8 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37 passed (**290 in total**).

**Module 10 — Access layer, part 2: VA need-to-know (✅ complete, 30 Oct 2026)**

**Delivered:**

- **A VA sees a task only when all four checks pass** (client answer Q4):
  1. **Pod:** the VA is a member of the task's pod, and the pod is active.
  2. **Agency authorization:** the agency authorized that pod as a whole, or this VA by name, and has The Desk switched on.
  3. **Restriction:** the task isn't restricted to other named staff.
  4. **Task:** the task is open, or the VA is its assignee. A VA keeps their own completed work history but doesn't see colleagues' finished or cancelled tasks.
- **Unrouted tasks are invisible to every VA** until an AM sends them to a pod.
- **Accounts and policies only through tasks:** a VA sees an insured account only while they can see a task on it. For policies:
  - a task about one policy (for example an endorsement) shows that policy only;
  - a task on the account with no specific policy (for example a COI) shows that account's policies.
- **Sensitive documents:** VAs see General and Policy documents. Financial and Personal documents need an individual grant, per category. Refusals are audited with the document's category, so attempts on sensitive files stand out.
- **Agency side:** agency users now see only documents and history entries marked as shared with the agency, never internal notes or internal files. Removed documents are hidden from everyone.
- **VAs can't file requests;** they work them. (Subtasks come in Module 38.)
- **Changes apply on the next request.** Removing a VA from a pod, deactivating a pod, withdrawing a named authorization, switching The Desk off or adding a VA to a restricted task all take effect immediately.

**Design decisions:**

- **Authorization beats assignment.** A VA assigned to a task loses sight of it if their pod or agency authorization is removed. The AM reassigns the work.
- **Named authorization is an allow-list.** When an agency authorizes only named VAs from a pod, other members of that pod see nothing from that agency.

**Issues:** one type-checking issue, caught before testing. The shared whole-pod filter was declared read-only, so it couldn't be combined with other conditions. I fixed it at the source in `lib/desk/pods.ts`, with no change in behaviour, and the Module 2 suite still passes. One Module 9 test was updated: a VA with no pod now resolves to a VA scope with no grants, instead of "no access", and still sees nothing.

**Verified:** `tsc --noEmit` exit 0 · **46 tests passed** (`script/verify-desk-va-access.ts`) on three temporary agencies (one without The Desk), three temporary pods (one inactive) and six VAs:
- authorization by whole pod, by name, inactive pod and Desk switched off;
- task visibility across every check;
- accounts and policies reached only through tasks;
- documents by category and agency visibility;
- internal history hidden from agencies;
- single-record 404s;
- a refused financial document audited with its category;
- five live permission changes;
- temporary records removed.

Module 1–9 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61 passed (**336 in total**).

**Module 11 — Business-hours SLA engine (✅ complete, 30 Oct 2026)**

**Delivered:** `lib/desk/business-time.ts`, the arithmetic behind every target date. It is pure calculation with no database access, so it is fully testable and can run in the browser too.

- **Business hours and days** run on the Desk calendar: working days, opening and closing times, one time zone, and holidays. Nights, weekends and holidays never count.
  - A request arriving in the evening or at the weekend starts the clock at the next opening time.
  - Work that ends exactly at closing time is due that day, not the next morning.
- **"1 business day" means a full working day of time:**
  - received Monday 10:00, due Tuesday 10:00;
  - received Friday 16:00, due Monday 16:00;
  - received on a Saturday, due Monday at closing time.
- **Waiting periods** (on the agency, carrier or insured) are taken out of elapsed time. Overlapping waits aren't double-counted, and a wait still in progress counts up to now. When a task resumes, its due time moves out by the business time spent waiting. Module 13 uses this.
- **Renewal and remarketing windows** are counted in calendar days before the policy's expiration. Work opens at the start of business on the opening day and is due at closing time on the due day. A due date on a weekend or holiday moves **earlier**, never later. Expiration dates are treated as dates, so they don't shift a day because of the time zone.
- **Applying a target** gives the due date for any of the 11 client targets. A renewal without a policy expiration date gets **no** due date rather than a guessed one.
- **On track, due soon or overdue**, with remaining time counted in business minutes. A task due Monday 10:00 that is checked on Friday evening has one business hour left, not three days. This is the basis for the alerts in Module 41.
- **Time zones and daylight saving** are handled with the browser and server's built-in time-zone data, with no extra library. Any time zone and any working week can be configured, for example a six-day week in India.
- **Unusable calendars** (no working days, or closing before opening) are refused with an error instead of searching forever.
- **Loads the live calendar and holidays** from the database, and falls back to the defaults if none are stored.

**Design decisions:**

- **Business days are counted as working time** (8 hours per day on the current calendar), not as "end of the Nth day". Days and hours then behave the same way, and pauses subtract cleanly.
- **Renewal due dates round earlier** when they land on a non-working day, so a renewal is never late because of a weekend.

**Issues:** none in the engine. A deliberate fault test (breaking the code on purpose to confirm a test fails) found a gap in the **tests**. The extra time-zone check needed on daylight-saving change days had no test covering it, because it only matters at night and never during business hours. I added a test for 3:30 a.m. on the March clock-change day, and the fault test now fails as expected.

**Verified:** `tsc --noEmit` exit 0 · **58 tests passed** (`script/verify-desk-business-time.ts`):
- time zones either side of both 2026 clock changes;
- hours and days across nights, weekends, Thanksgiving and Christmas;
- business time counted for a normal week, Thanksgiving week and a full year (computed in about 0.14 s);
- **300 random requests over four months** where adding time and counting it back always matched exactly;
- waiting periods, including overlapping and open waits;
- renewal windows with weekend and holiday due dates;
- the client's COI, endorsement, renewal and remarketing targets applied to real dates;
- due-soon and overdue;
- another time zone with a six-day week;
- refusal of bad calendars;
- the live calendar and its 23 holidays.

Module 1–10 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46 passed (**394 in total**).

**Module 12 — Task service layer (✅ complete, 30 Oct 2026)**

**Delivered:** `lib/desk/tasks.ts` is the only code that creates or changes tasks. The API routes in Module 28 will be thin wrappers around it. Each change, its timeline entry and its audit entry are saved together in one database transaction, so a change that can't be logged doesn't happen.

- **Filing a request** (`createTask`):
  - The agency, account and policy come from the access layer, so a user can submit only for accounts they can see (D4). A policy fills in its account.
  - **Routed automatically** to the pod for the request type. "Other", or a type with no active rule, stays unrouted for the AM to triage.
  - **The agency's primary AM is attached**, or the backup when there is no primary.
  - **The matching target is applied and the due date set:** agency agreement first, then priority, then complexity. The target is copied onto the task, so later edits never change what an open task was promised.
    - Renewals use the policy's expiration date. Without one, the task gets no due date rather than a guessed one.
    - ACORD, Loss Runs, Proposal Prep, QA Review and Other get no due date (D5).
  - **Billing category and billable flag** are set from the type (QA Review is non-billable).
  - The request is checked: valid type, a title (up to 200 characters), complexity and priority.
- **Status changes** (`changeTaskStatus`) follow a fixed set of allowed moves, for example In Progress → Waiting / QA Review / Completed. Anything else is refused with a clear message.
  - **VAs** change only tasks assigned to them.
  - **Agency users** may only cancel, and only before work starts.
  - **Only AMs and Operations Managers** reopen a completed or cancelled task.
  - **A reason is required** for waiting, cancelling and reopening. A "waiting on agency" reason is shown to the agency, because it says what's needed.
  - **Start, completion and cancellation times are recorded.** The first start time is kept when a task is reopened.
- **Assignment** (`assignTask`):
  - A VA picks up an unassigned task or releases their own. AMs assign and reassign anyone eligible.
  - **The new assignee must be authorized for that agency, pod and task under their own need-to-know rules**, so work can't be handed to someone the agency hasn't approved.
  - New ⇄ Assigned follows automatically.
- **Notes** (`addTaskNote`): staff notes are internal by default and can be shared with the agency. Agency notes are always shared. **When the agency replies to a task waiting on them, it resumes automatically:** back to In Progress, or back to the queue if nobody has picked it up yet. Notes are audited without their text.
- **Agency view** (`agencyTaskView`): the simplified status (Received / In Progress / Needs Your Attention / Completed / Cancelled), with no internal fields such as pod, assignee, restriction, billing or target details.
- **Timeline visibility:** a status change is shown to the agency only when the agency's simplified status changes. Internal moves, such as In Progress → Waiting on Carrier, stay internal.

**Design decisions:**

- **Two people changing the same task at once:** exactly one change wins. The other person is told the task was changed and to refresh, with no silent overwrite and no server error. This holds whether the second request races the first or arrives just after it.
- **Role refusals are audited too.** Out-of-scope requests were already logged as "not found" by the access layer. Refused actions on a task the user can see, such as a VA changing a task they haven't picked up, are now logged with the reason. Invalid input and conflicts aren't access attempts, so they aren't logged.

**Issues caught and fixed:**

- **The missing-field trap again (found while writing).** The pick-up check matched "no assignee" with a plain null. A new task stores no assignee field at all, so every first pick-up would have failed as "changed by someone else". It now uses the shared filter from Module 4, and a test proves a first pick-up works.
- **Agency reply on an unassigned task:** it would have moved the task to In Progress with nobody working it. It now returns to the queue.
- **Two race tests would have been flaky:** two status changes can both succeed if they arrive one after the other. The tests now use moves that conflict either way (complete vs cancel), and three consecutive runs gave the expected result with different winners.
- **Audit gap:** see "Role refusals are audited too" above.

**Verified:** `tsc --noEmit` exit 0 · **76 tests passed** (`script/verify-desk-task-service.ts`) using the seeded pods and routing rules, with temporary agencies, users and pod memberships:
- the status rules and agency mapping;
- creation: routing, AM and backup AM, standard and complex COI targets, an agency agreement overriding the default, a renewal from its policy's expiration, D5 types, unrouted "Other", priority, AM filing on an agency's behalf, billing defaults, every validation error;
- pick-up, assignment rules and authorization of the assignee;
- the full lifecycle including waiting, the agency reply, QA, completion and reopening;
- agency cancelling;
- notes and their visibility;
- 404s out of scope;
- the agency view hiding internal fields;
- one audit entry per action and audited refusals;
- simultaneous changes and simultaneous pick-ups;
- temporary records removed.

Module 1–11 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58 passed (**470 in total**).

**Module 13 — Clock pause / resume and billing capture (✅ complete, 30 Oct 2026)**

**Delivered:**

- **The service-level clock stops while waiting** (on the agency, carrier or insured) and restarts when work resumes:
  - Two new task fields: when the current wait began, and the business minutes waited so far.
  - **On resuming, the working due date moves out by exactly the business time spent waiting.** A wait from Friday 16:00 to Monday 10:00 counts 2 business hours, not 66.
  - **Switching from one wait to another** (carrier → insured) keeps the clock stopped from the original moment.
  - **Several waits add up.**
  - **The original commitment (`slaDueAt`) never moves,** so turnaround reporting (Module 42) can measure against what was promised, minus recorded waiting.
  - **Renewal and remarketing due dates stay tied to the policy's expiration;** the wait is recorded but the date doesn't move. A task cancelled while waiting records the wait without moving its date.
  - **An agency reply** that resumes a task waiting on them restarts the clock the same way.
  - Each resume records the minutes waited and the old and new due dates on the timeline and in the audit log.
- **Billing captured at completion** (`lib/desk/billing-capture.ts`), in the month of completion in the Desk time zone:
  - **Included:** within the agency's monthly allowance for the category. Agency overrides beat the plan, and "unlimited" is supported.
  - **Overage:** the allowance is used up, so it is marked as unbilled overage.
  - **Non-billable:** internal work such as QA Review, which never touches the allowance.
  - **Not yet classified:** the agency has no plan, or its plan has no allowance for that category yet (D1). The month is recorded, the reason is stored, and nothing is guessed.
  - **A task is included only if all its units fit;** it's never split across included and overage.
  - **Reopening a completed task clears its billing and returns its allowance units,** so the next completion can use them.
  - **Invoiced work can't be reopened** (a new request is filed instead).
  - **Cancelled work is never billed.**
- **Late classification (`classifyPendingBilling`):** once the client confirms allowances (D1), one run classifies all pending completed work, oldest first, in the month it was completed. Each one is logged as a system action, and re-running changes nothing.
- **Repair step extended:** `npm run db:seed:desk` also fills the new waiting counter on any task stored without it. Prisma refuses to read a task that's missing a required field.

**Design decisions:**

- **Allowance use is counted atomically** (a counter per agency, month and category, using the same mechanism as task numbers). It isn't recounted on each completion, so two tasks completed at the same moment can never both take the last included unit.
- **When a completion fails to save,** for example because two people completed the same task at once, the allowance unit it took is returned.
- **Expiration-anchored targets don't move when paused,** because a policy expires on its date regardless of waiting.

**Issues:** none. All tests passed on the first run. Two deliberate faults confirmed the key tests aren't passing by accident:
- **Removing the "give the unit back" step** was caught by the double-completion test.
- **Making the allowance counter non-atomic** was caught by ten tests, including three simultaneous completions all being marked "included".

**Verified:** `prisma validate` passed · `prisma db push` in sync · `tsc --noEmit` exit 0 · **43 tests passed** (`script/verify-desk-clock-billing.ts`):
- the clock rules on fixed dates (stop, switch, resume, weekend, accumulation, expiration-anchored, cancelled, no due date, old data);
- real tasks paused for a week of business time and resumed (due date moved by exactly the wait, original commitment unchanged, audit and timeline details);
- the agency-reply resume;
- billing on a temporary plan: included, overage, reopening and returned units, agency override, multi-unit tasks, unlimited, non-billable, no plan, not configured, cancelled, late classification and re-run;
- invoiced work protected;
- three simultaneous completions with one unit left;
- the same task completed twice at once;
- temporary records removed.

Module 1–12 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76 passed (**513 in total**).

**Module 14 — Navigation shell (✅ complete, 30 Oct 2026)**

**Delivered:**

- **Three Desk areas, each with its own sidebar**, from one shared shell (`app/components/desk/DeskShell.tsx`):
  - **`/desk` (Agency Portal):** Overview, Requests, New request, Accounts, Messages. Agency admins also see Import and Team access.
  - **`/desk-ops` (Account Manager / Pod / VA Portal):**
    - VAs see Overview, Pod queue and My tasks.
    - Account Managers also see Agencies, Messages and Turnaround.
    - Operations Managers and Super Admin also see Workload and Usage & audit.
  - **`/super-admin/desk` (Insurigence Admin, Desk setup):** Overview, Agencies, Staff, Pods, Routing & targets, Business calendar, Follow-up rules.
- **24 placeholder pages.** Each one names the module that will build it. The three overview pages already show real facts:
  - **Agency:** the agency's name, whether the user sees the whole book or only assigned accounts, and their Account Manager.
  - **Account Manager:** how many agencies they manage.
  - **VA:** their pods and how many agencies they can work for.
  - **Setup:** agencies using The Desk, active pods and active Desk staff.
- **Access is checked on the server for every page,** using the same Desk scope as the access layer, so it's never just a link hidden from the sidebar:
  - Users who belong in another area are sent there. For example, a VA opening `/desk` lands on `/desk-ops`.
  - Pages limited to some roles are enforced. A CSR opening Import, or a VA opening Workload, is sent back to their overview.
  - Agency users whose agency hasn't turned The Desk on see a clear "not set up for your agency yet" page.
- **Post-login landing by role:** Super Admin goes to Super Admin. Operations Managers, Account Managers and VAs go to `/desk-ops`. Agency users go to the dashboard as before, with a new "The Desk" link in the header and sidebar when their agency uses it.
- **Desk staff no longer see the agency app** (leads, intake, proposals). If they open it, they're sent to their own area.
- **Login redirect hardened:** the `?redirect=` after sign-in is followed only if it's a page on this site. Before, any address was followed, so a crafted link could send a user to another site after login.

**Design decisions:**

- **Operations Managers can use Desk setup** (`/super-admin/desk`) but no other Super Admin page. The access layer already treats them as platform-wide, and setup is their job. All other Super Admin pages and APIs remain Super Admin only.
- **Agency users still land on the dashboard,** because the placement tools remain their main product. The Desk is one click away.
- **Import and Team access are for agency admins only.** Q3 makes the agency admin responsible for permissions, and loading the book of business is the same kind of decision. This can be widened later.
- **One list of pages drives everything:** the sidebars, the role limits, the placeholders and the tests. A page can't be added to the sidebar without a role rule, or the other way round.

**Issues:**

- **Redirects inside the existing Super Admin frame are streamed rather than sent as a 307 header.** That frame is drawn in the browser, so when an AM or VA opens a Desk setup page, the redirect arrives in the page body instead. I confirmed the response contains no setup content, only the redirect, and the browser follows it. The `/desk` and `/desk-ops` areas give a normal 307.
- **An early version shared a constant with the access layer in a way that would have put server code in the browser bundle.** Caught before testing. The constant now lives in a small pure file, and a test guards against it happening again.

**Verified:** `tsc --noEmit` exit 0 · **80 tests passed** (`script/verify-desk-navigation.ts`):
- the landing page for all 7 roles;
- the exact sidebar for each role;
- every sidebar entry has a page, inside its own area, rendering its own entry;
- every area has a server-side layout;
- the navigation rules contain no server code;
- active highlighting;
- role-limited pages refused;
- agency-app and Super Admin rules, including a look-alike path;
- safe login redirects (`//`, `https://` and backslash tricks refused);
- links between areas;
- who gets into which area, against real scopes for 9 temporary users, including "not enabled", a deactivated user and the no-redirect-loop guard;
- overview facts;
- temporary records removed.

**Live check:** the app was started and 22 requests were made as real signed-in users of every role (anonymous, CSR, agency admin, agency without The Desk, VA, AM, Operations Manager, Super Admin). Pages render or redirect as expected, and the session reports whether the agency uses The Desk. The temporary users, sessions and agencies were removed afterwards.

Module 1–13 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76, 43 passed (**593 in total** with this module).

### Phase 1 — Admin Setup (13 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 15 | Enable The Desk per agency; assign primary / backup AM; Desk profile (AMS system, instructions, plan and allowance overrides) | 3.0 | ✏️ Q1, Q6 | ✅ Done |
| 16 | Internal staff management: create / invite / deactivate AMs, VAs, Desk Admins / Operations Managers (reuses invite flow) | 2.5 | | ✅ Done |
| 17 | Pod management: create / edit pods, add / remove VAs, authorize pods and named VAs per agency, VA sensitive-data permissions | 3.0 | ✏️ Q4 | ✅ Done |
| 18 | Routing and service-level editor: request type → pod, default priority; targets by type, complexity and priority; per-agency agreement overrides | 2.5 | ✏️ Q5 | ✅ Done |
| 19 | Business calendar editor: business hours, time zone, holidays | 2.0 | 🆕 Q5 | ✅ Done |

**Module 15 — Per-agency Desk setup (✅ complete, 5 Nov 2026)**

**Delivered:**

- **Agencies list** (`/super-admin/desk/agencies`): every agency with its Desk status, Account Managers, plan and AMS, with search and an on / off filter.
- **Setup form for each agency,** with a checklist of what's still missing (primary Account Manager, plan, AMS, an authorized pod):
  - **Turn The Desk on or off.** Access changes immediately for the agency's users, its Account Managers and VAs. Turning it off while requests are open needs a confirmation that states how many.
  - **Primary and backup Account Manager.** Each must be an active Account Manager, they must be different people, and a backup needs a primary.
  - **AMS and profile (Q1):** the AMS (or "Other" with its name), instructions for Desk staff, and where the logins are kept in the password manager.
  - **Credential guard in force.** Text that reads like a password is refused in the instructions, the login location, the AMS name and the plan notes. This applies the client's rule that passwords are never stored in The Desk.
  - **Plan (Q6):** plan, start date, negotiated price (required for "Complete from $4,000"), managed-accounts override, notes.
  - **Allowance overrides per service:** use the plan's allowance, set a number, or unlimited.
- **When the Account Manager changes,** open requests move to the new one. Completed work keeps who handled it. If a request is still assigned to the person removed, the admin is told, because that person can no longer see it.
- **Waiting billing is classified automatically.** When a plan is saved, work completed earlier without an allowance is classified, oldest first, and the admin is told how many.
- **Every save is logged once,** with who, when, the IP address and which fields changed. Instructions and the login location are never copied into the log. Saving a form with no changes writes nothing.
- **Access:** Super Admin and Operations Managers only. Other roles get a 403, and the refusal is logged.

**Design decisions:**

- **The checklist advises and doesn't block.** An agency can be turned on before it has a plan or Account Manager. Staff and pod screens arrive in Modules 16–17, and missing billing data leaves work unclassified rather than wrong.
- **Two admins editing the same agency:** the second save is refused with "someone else just changed this agency", rather than silently overwriting the first.
- **Allowance changes don't reclassify work already classified.** They apply to what's completed from then on, and to work still waiting.

**Issues:**

- **Audit accuracy:** the form sends every field on each save, so the first version logged fields as changed when they weren't. It now compares against stored values.
- **Test gap found by deliberate faults:** removing the protection against overwriting another admin's save wasn't caught, because two truly simultaneous saves are also stopped by the database. A new test forces another save to land between this one's read and write.
- **Not yet clicked through in a browser.** The pages compile and are served, and the API behind them was exercised over HTTP as real users. The form's on-screen behaviour gets its walkthrough in Module 45, unless checked sooner.
- **Open point: no screen for plan-level allowances.** Module 15 sets them per agency. When the client's numbers arrive (D1), the plan-wide allowances need a screen or a one-time data entry. No module currently covers this.

**Verified:** `tsc --noEmit` exit 0 · **98 tests passed** (`script/verify-desk-agency-setup.ts`):
- who may read and save;
- list search and filters;
- turning on and off, and the effect on access;
- Account Manager rules, open work moving, access removed;
- AMS rules and the credential guard in all four text fields, with ordinary mentions allowed;
- plan rules, price and overrides;
- no-change saves;
- removing a plan;
- late billing classification (allowance of 1: oldest included, next overage);
- out-of-date, simultaneous and interleaved saves;
- audit contents;
- temporary records removed.

**Deliberate faults:** six were introduced one at a time (race guard, open work moving, credential guard, platform check, no-change detection, late classification). All six were caught, and the file was restored.

**Live check:** the app was started and 20 requests were made as real signed-in users (anonymous, agency admin, Account Manager, VA, Operations Manager, Super Admin): refusals, a full save over HTTP, an out-of-date form, a refused credential, and both pages served. No server errors. Temporary records were removed.

Module 1–14 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76, 43, 80 passed (**691 in total** with this module).

**Module 16 — Internal staff management (✅ complete, 5 Nov 2026)**

**Delivered** (`/super-admin/desk/staff`):

- **Staff list:** Account Managers, VAs and Operations Managers, with search and filters by role and status. Each row shows invite status (sent or expired) and how many agencies, pods and open requests the person has.
- **Invite:** the existing single-use link, valid for 72 hours. The invitee sets their own password, so no password is ever sent or seen. If the email can't be delivered, the invite still exists and the admin is given the link to share.
- **Resend invite:** a new link, and the old one stops working.
- **Edit name.**
- **Deactivate,** which takes effect immediately and never waits for a handover:
  - The person is signed out and can't log in, and any unused invite link stops working.
  - Their open requests return to the queue. Work in progress restarts as New. Work waiting on the agency, carrier or insured stays waiting, with the clock still stopped. The task history records this.
  - Open requests under them as Account Manager move to the agency's backup, or to nobody if there's no active backup.
  - The admin is told which agencies now have no active Account Manager.
- **Reactivate:** agency and pod assignments come back, because they're kept on record.
- **Logging:** every action is in the audit log. Invite links are never logged.

**Bug fixed in Module 12's code:** new requests were attached to an agency's primary Account Manager without checking that person was still active. They now go to the first active one, primary then backup, or to nobody.

**Design decisions:**

- **Only a Super Admin can manage Operations Managers.** They hold platform-wide access, so they can't create or remove their own peers.
- **No role changes on this screen.** Moving someone from VA to Account Manager has consequences for agencies and pods, and the plan doesn't call for it. The existing Super Admin users page can still change a role.

**Issues:**

- **Simultaneous invites:** two invites for the same email at the same moment caused a server error. Found by a test; now a clear "already exists" message.
- **Old invite links weren't being revoked** in the first version, because of the known MongoDB rule that a filter on "empty" misses a field that was never set. Found by the tests before commit and now fixed.
- **Open point: the older Super Admin users page bypasses these rules.** Deactivating Desk staff there sets them inactive and they lose access at once, but their open requests aren't returned to the queue. It should send Desk staff to this screen, or use the same code.
- **Limits of the live check:**
  - Successful invites used a stand-in sender, so **no real invite email has been sent or seen in an inbox.**
  - The `/staff/[id]` route ran directly with real signed-in requests, not through the web server, and the invite page itself wasn't loaded. The test server's worker for such addresses had failed, and its restart wasn't possible.
  - The screen has not been clicked through in a browser.

**Verified:** `tsc --noEmit` exit 0 · **86 tests passed** (`script/verify-desk-staff.ts`):
- who may manage whom;
- invite rules, tidy email, no password, link lifetime, audit without the link;
- email failure;
- simultaneous invites;
- resend replacing the old link;
- invite states;
- rename;
- deactivating a VA (session ended, each status handled, history, audit);
- deactivating an Account Manager (backup cover, agencies flagged);
- new work skipping someone who left;
- reactivation;
- temporary records removed.

**Deliberate faults:** six were introduced one at a time (peer management, sessions, invite revocation, returning work, Account Manager cover, new-work routing). All six were caught, and the code was restored.

**Journey check:** 27 checks with real signed-in users: refusals, invite, cannot log in before accepting, accept and sign in, link can't be reused, lands in operations, deactivate (session ends, login refused), reactivate (login works). No real email was sent, and temporary records were removed.

Module 1–15 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76, 43, 80, 98 passed (**777 in total** with this module).

**Module 17 — Pod management (✅ complete, 5 Nov 2026)**

**Delivered** (`/super-admin/desk/pods`, three tabs):

- **Pods and members:** create, rename, describe and switch pods off or on; add and remove VAs and Account Managers. A pod still in use (request types routed to it, follow-up rules, open requests) can't be switched off, and the message says what's using it.
- **Agency access:** for each agency and pod, one of **Not authorized, Whole pod, or Named VAs only** (Q4: "restrict certain agencies or tasks to specific employees"). Only VAs in the pod can be named.
- **VA permissions:** Financial and Personal documents are granted per VA. General and Policy documents are open to every VA on work they're authorized for.
- **All changes apply immediately,** because the access layer reads these settings on every request. Each is in the audit log, with before and after where relevant.
- **Work follows access.** When a change means a VA can no longer see a task assigned to them, it returns to the queue in the same step (work in progress restarts as New; waiting work keeps waiting with the clock stopped), and the admin is told how many. Account Managers keep their tasks, because their access comes from the agency, not the pod.
- **Leaving a pod also removes access naming that person in it,** so adding them back later doesn't quietly restore it.
- **Older Super Admin users page fixed** (open point from Module 16): deactivating or reactivating Desk staff there now follows the same rules as the Staff screen. Agency users behave as before.

**Design decisions:**

- **Named access means only those VAs.** Whole pod and named VAs are alternatives for each agency and pod, not combined, so a restriction can't be undone by a leftover whole-pod setting.
- **Seeded pods can't be switched off yet,** because request types route to them. Module 18's routing editor is where they can be moved.

**Issues:**

- **My test run switched off a real pod in the shared database.** One deliberate fault removed the "pod in use" guard while a test aimed at a seeded pod, so Pod 1 (Service & AMS) was switched off from 14:58 UTC on 5 Nov until the regression exposed it. I restored it. **Nothing was affected:** the database has no tasks, and Pod 1 has no members or agency access. The test design was the fault: it now uses a temporary pod with a simulated routing count, and a new check confirms all seeded pods stay active. Re-running that fault caught it and left every seeded pod active.
- **Leftover test records removed:** a Module 9 test run on 30 Oct had left 3 agencies and 6 users, tagged as test data with nothing attached. They were deleted. The database has no remaining test agencies or `@example.test` users.
- **Limits of the live check:** a test server is still running and its worker for addresses such as `/pods/[id]` has failed (see Module 16). Those routes ran directly with real signed-in requests. The screen has not been clicked through in a browser.

**Verified:** `tsc --noEmit` exit 0 · **99 tests passed** (`script/verify-desk-pods.ts`):
- who may do what;
- pod rules (names, permanent code, no-change saves);
- member rules;
- all three access states against real VA scopes;
- work returning to the queue on narrowing, removal and leaving a pod, for each status;
- Account Managers' work untouched;
- switching pods off;
- VA grants and revocations applying immediately;
- the older users route, including agency users unchanged;
- seeded pods untouched;
- temporary records removed.

**Deliberate faults:** seven were introduced one at a time. All seven were caught.

**Live check:** 22 checks with real signed-in users: refusals, listing, creating a pod, a duplicate name, granting a permission, adding a member, authorizing a named VA and reading it back.

Module 1–16 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76, 43, 80, 98, 86 passed (**876 in total** with this module).

**Module 18 — Routing and service-level editor (✅ complete, 5 Nov 2026)**

**Delivered** (`/super-admin/desk/routing`):

- **Routing per request type:** choose the pod, or "Unrouted" so the Account Manager triages it, and the default priority.
- **Targets per request type (Q5):**
  - Set by complexity and priority, or left to apply to all.
  - Measured in business hours, business days, or days before expiration.
  - Add, edit and remove, with validation such as "hours or days, not both" and "work must open on or before its due date".
- **Per-agency agreements:** a selector switches from the Desk defaults to one agency. A target added there replaces the default for that agency only.
- **What applies today:** each request type shows the target a normal-priority request would get, for standard and complex, so an admin can see the effect of an agreement. Types with no target stand out.
- **D5 can now be entered without code:** ACORD, Loss Runs, Proposal Prep, QA Review and Other can be given targets as soon as the client confirms them.
- **Every change is in the audit log** with before and after in plain words ("2 business days" to "4 business hours"). Saving with no change writes nothing.
- **Access:** Super Admin and Operations Managers only.

**Design decisions:**

- **Changes apply to new requests only.** Open requests stay in their pod and keep the target and due date they started with, so a date already set never changes silently.
- **Routing is the same for every agency.** Only targets vary by agreement, as the plan describes.
- **Nothing is deleted.** The Desk seeder recreates any missing default, so a deleted rule would come back. "Unrouted" and "removed" switch the record off, and saving the same combination later switches it back on.
- **The target list by agency shows normal priority only.** Priority-specific targets are listed on the type but aren't reflected in the "what applies" line.

**Issues:**

- **Three bugs found by the tests and fixed before commit:** unrouting a request type crashed; a default priority with no pod was accepted silently instead of refused; editing a target without sending a note wiped the existing note.
- **Tests write only to safe data** (lesson from Module 17). They touch only request types with nothing seeded, or temporary agencies. A snapshot of all seeded routing and targets is compared at the end of every run.
- **Fault-check script under-reported.** Two faults first showed as missed because the script counted failure lines only, and those faults stop the suite with an error. Checked again using the exit code: both were caught.
- **Not yet clicked through in a browser.**

**Verified:** `tsc --noEmit` exit 0 · **91 tests passed** (`script/verify-desk-routing.ts`):
- who may read and change;
- what the editor shows, including the client's targets;
- routing rules, unrouting and re-routing, what new requests actually get;
- open requests unchanged after routing and target edits;
- the seeder not undoing an edit;
- target validation;
- priority and complexity targets;
- agency agreements beating defaults for that agency only;
- removing and re-adding;
- seeded data unchanged;
- temporary records removed.

**Deliberate faults:** six were introduced one at a time. All six were caught.

**Live check:** 26 checks over real HTTP with signed-in users: refusals for each role, reading the editor data, saving and clearing routing, an agreement target added, edited and removed, validation and duplicate errors, the page served. Seeded data was confirmed unchanged afterwards.

Module 1–17 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76, 43, 80, 98, 86, 99 passed (**967 in total** with this module).

**Module 19 — Business calendar editor (✅ complete, 6 Nov 2026). Phase 1, Admin Setup, is now complete.**

**Delivered** (`/super-admin/desk/calendar`):

- **Business hours:** time zone, opening and closing times, and working days. D2 can now be entered without code.
- **Worked examples:** the page shows what the saved calendar means for a request made now: when the clock starts, and when a 4-hour and a 1-day target would be due.
- **Holidays:** add and remove, listed by year. These days never count toward a target.
- **Running-out warning:** when the list ends within 90 days, the page says so, because days off would otherwise count as worked. The seeded list ends on 31 Dec 2027.
- **Every change is in the audit log** with before and after. Saving with no change writes nothing.
- **Access:** Super Admin and Operations Managers only.

**Design decisions:**

- **Changes apply from the next calculation.** Open requests keep the due date they already have. Time waited is measured with the calendar in force when the wait ends.
- **Named time zones only.** Fixed offsets such as "+05:30" are refused, because they ignore daylight saving.
- **Hours must open and close on the same day.** An overnight shift can't be entered. If the client needs one, it's a change to the business-time engine.
- **Two admins editing:** the second save is refused rather than overwriting the first.
- **The seeder now fills the holiday list only when it's empty.** Before this, it would have brought back any default holiday an admin removed on purpose. It also means future default holidays won't be added automatically; the warning above covers that.

**Issues:**

- **Business-time code assumed hours never fall inside the daylight-saving jump.** That was safe with fixed hours but not with editable ones. New tests cover opening inside the spring jump, hours inside the repeated autumn hour, nearly round-the-clock days, one-minute days, one-day weeks, and zones with half-hour daylight saving. All passed with no code change, and the outdated comment was corrected.
- **Tests never write to the real calendar** (lesson from Module 17). It's one shared record, so saves go to an in-memory stand-in, holidays use dates in 2099 only, and the real calendar and holidays are compared against a snapshot on every run.
- **Session ended during the fault and regression run.** A killed run skips its own cleanup, so I checked for faults left in the code (none) and for damage to real data (none). It had left one staff test's records (4 agencies, 13 users, 2 tasks, 2 insureds), which I deleted by that run's tag after confirming no other tasks existed. The four suites that hadn't run were then completed.
- **Limits of the live check:** no real calendar change was saved over HTTP, to avoid altering shared data; that path is covered by the tests through the stand-in. The screen has not been clicked through in a browser.

**Verified:** `tsc --noEmit` exit 0 · **72 tests passed** (`script/verify-desk-calendar.ts`):
- who may read and change;
- time-zone, hours and working-day rules;
- no-change saves;
- worked examples;
- audit contents;
- out-of-date, simultaneous and interleaved saves;
- an unseeded Desk;
- open requests keeping their dates while new ones use the new hours;
- holiday rules, and the arithmetic skipping a holiday;
- the running-out warning;
- the seeder leaving an existing list alone;
- unusual hours across daylight saving;
- real data unchanged;
- temporary records removed.

**Deliberate faults:** seven were introduced one at a time. All seven were caught.

**Live check:** 25 checks over real HTTP with signed-in users: refusals for each role, reading the calendar, a no-change save, invalid hours and zone, an out-of-date form, adding and removing a 2099 holiday, the page served. The real calendar and holidays were confirmed unchanged afterwards.

Module 1–18 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76, 43, 80, 98, 86, 99, 91 passed (**1,039 in total** with this module).

### Phase 2 — Insured Accounts (22.5 h)

| # | Module | Hours | Change | Status |
|---|---|---:|---|---|
| 20 | Insured accounts API: CRUD with policies and staff assignments, scoped through the access layer | 3.0 | ✏️ Q3 | ✅ Done |
| 21 | Agency Portal: insured list (search, filter, paging, "my accounts") + add / edit form | 3.0 | | ✅ Done |
| 22 | Insured detail page: profile, assigned producer / CSR, policies, open tasks, documents | 2.5 | | ⬜ |
| 23 | Agency user permissions: agency admin sets each user's role and book access, and assigns producers / CSRs to accounts (single and bulk) | 2.5 | 🆕 Q3 | ⬜ |
| 24 | Import engine: server-side CSV / XLSX parsing, header detection, staging rows in an `ImportBatch` | 3.0 | | ⬜ |
| 25 | Import mapping UI: map any export's columns to Desk fields, with mappings remembered per agency for the next upload | 3.0 | ✏️ Q2 | ⬜ |
| 26 | Import validation and grouping: several policy rows per insured, insured-only rows, producer matched to agency users, date / premium / policy-status parsing, duplicate detection, preview | 3.0 | 🆕 Q2 | ⬜ |
| 27 | Import commit, one-click undo of a batch, downloadable import template | 2.5 | | ⬜ |

**Module 20 — Insured accounts API (✅ complete, 6 Nov 2026)**

This module is the server side only. There is no screen yet; Modules 21 and 22 build the list, form and detail page on top of it.

**Delivered:**

- `lib/desk/book.ts`: list, view, add and edit accounts; add, edit and remove policies; assign and unassign agency staff.
- `app/api/desk/insureds` (list, add), `insureds/[id]` (view, edit), `insureds/[id]/policies` (add), `insureds/[id]/assignments` (assign, unassign), `policies/[id]` (edit, remove).
- `deskUserRequest` in `lib/desk/admin-api.ts`: a guard for Desk APIs open to any Desk user, with what they can reach decided by the access layer.
- New audit actions for policies. Opening an account, each change and each refusal are logged. Logs list field names, never the text entered. The one exception is a removed policy's number, kept so the log shows which policy went.
- New rule in `lib/desk/access.ts`: a new request can't be sent on an inactive account, either directly or through one of its policies.

**Who can do what:**

| | See | Add / edit accounts and policies | Deactivate, assign staff |
|---|---|---|---|
| Agency Owner / Admin | Whole book | Yes | Yes |
| Producer / CSR | Assigned accounts, or the whole book if granted | Yes, on what they can see | No |
| Account Manager | Covered agencies | Yes | Yes |
| Super Admin / Operations Manager | All Desk agencies | Yes | Yes |
| VA | Only what the access layer allows | No (read-only) | No |

**Design decisions:**

- **Another agency's account returns "not found", not "forbidden",** so the answer doesn't confirm the account exists. The attempt is logged.
- **VAs get less detail (Q4, need-to-know).** They don't receive account notes, premiums, policy notes, the staff list or open-request totals, because the server leaves those fields out of the response. Of an account's policies, they see only the one on their request.
- **Agency users can only add to their own agency,** whatever the request says. An Account Manager or platform user must name a covered, Desk-enabled agency.
- **Someone who sees only assigned accounts is assigned to anything they add.** Otherwise a new account would vanish from their own list as soon as they saved it.
- **Protected fields can't be set through the API:** agency, source, import batch, creator and carrier link. Only listed fields are accepted.
- **Duplicate names are refused unless confirmed.** Matching ignores differences in how a name is written. The message says only that a same-named account exists. The form in Module 21 can offer "save anyway". The same policy number can't appear twice on one account.
- **Accounts are deactivated, never deleted,** and not while they have open requests; the refusal gives the count. A policy can be removed only if no request has ever been made on it.
- **Changing a policy's expiration date leaves open requests' due dates alone,** in line with Module 19's rule that existing dates aren't recalculated.
- **Passwords (Q4):** text that looks like a credential is refused in account notes, account descriptions and policy notes. This is a screen for obvious cases, not a guarantee.

**Issues:**

- **Type error in the list view,** from returning the staff list conditionally. Staff are now always read and removed for VAs before the response is built. A test confirms the VA's list still comes back without staff or totals.
- **Two mistakes in my tests, not the code:** an `await` in a non-async function, and one test expecting "forbidden" for a CSR who isn't on the account. The correct answer is "not found". It's now two tests: not on the account gives "not found", on the account but not allowed to assign gives "forbidden".
- **Limits of the check:** the route handlers were called directly in the test process with real signed-in sessions, not through a running web server. The rest of that path is exercised when Module 21's screens are built.

**Verified:** `tsc --noEmit` exit 0 · **155 tests passed** (`script/verify-desk-insureds.ts`), on temporary agencies and users only, none left behind:
- each role's reach, and agency separation;
- VA read-only access and the fields withheld;
- adding, editing and the protected fields;
- duplicates, credentials in notes, deactivation rules;
- policies and removal rules;
- staff assignment, including refusing other agencies' users and Desk staff;
- out-of-date and interleaved saves;
- audit contents, and no entry when nothing changed;
- requests refused on inactive accounts;
- the real route handlers, with signed-in requests.

**Deliberate faults:** ten were introduced one at a time. All ten were caught, and the code was confirmed restored afterwards.

Module 1–19 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76, 43, 80, 98, 86, 99, 91, 72 passed (**1,194 in total** with this module).

**Module 21 — Agency Portal account list and form (✅ complete, 6 Nov 2026)**

**Delivered:**

- **Accounts list** (`/desk/accounts`): search by name, DBA, contact, email, AMS reference or policy number; status filter; "My accounts"; 25 per page. Filters are kept in the address, so a reload or Back returns to the same view.
- **Add and edit** (`/desk/accounts/new`, `/desk/accounts/[id]/edit`): business, contact, address and other details.
- **Deactivate and reactivate** on the edit page, for those allowed to, with the reason shown when it isn't possible.
- `lib/desk/account-form.ts`: the form and filter logic and the field limits, shared by the screens and the server.
- `lib/desk/literal-match.ts`: makes user text safe to search with (see Issues).
- `deskPageAccess` in `DeskAreaLayout`: the server-side access check for built pages. Placeholder pages use it too.

**Design decisions:**

- **Rows open the edit page for now.** Module 22 adds the account's own page, with policies and assigned staff, and rows will open that instead.
- **Default view is active accounts.** Inactive ones are one filter away and labelled.
- **"My accounts" appears only for people who see the whole book.** For anyone else it would change nothing.
- **Duplicate names can be saved after confirming.** The refusal offers "It's a different business: continue anyway". Changing any field withdraws the offer, so it can't save values other than those on screen.
- **If someone else saved first,** the save is refused, what was typed stays on screen, and reloading is a separate choice.
- **Refusals carry a code** (`DUPLICATE_NAME`, `CHANGED_ELSEWHERE`), so screens don't depend on the wording of a message. "Not found" answers carry none.
- **Filters don't go back to the server for the page,** only for the rows, so they respond immediately.
- **Leaving with unsaved changes asks first** from the form's own links, and on closing or reloading the tab. Sidebar links don't ask yet.

**Issues:**

- **Search text was treated as a pattern (found by this module's tests).** Prisma on MongoDB sends `contains`, and `equals` with `mode: 'insensitive'`, to the database as a regular expression without escaping it. Typing "(" gave a server error, ".*" matched everything the user could see, and a crafted pattern could tie up the database. None of this crossed agencies, because the access filter still applied. Fixed in the account, agency and staff searches and the pod name check, which came from earlier modules.
- **The same problem existed outside The Desk.** Fixed straight after this module in a separate commit, with its own test (`script/verify-text-matching.ts`, 11 tests, 9 of which failed before the fix):
  - `app/api/auth/signup/route.ts` checked the agency name this way on the public signup page. An agency name such as "Smith & Co (East)" could sign up, but the same name could then sign up again, because the duplicate check missed it (an earlier draft of this report wrongly said such a name fails). An unclosed bracket was a server error; ".*" reported that an agency exists; a crafted pattern could test which agency names exist or tie up the database, with no sign-in.
  - `app/api/super-admin/users/route.ts` search failed on "(" (Super Admin only).
- **A VA could confirm a policy number through search** on a policy of that account outside their work (a Module 20 gap). Search now covers only policies they may see.
- **Reactivating an account skipped the duplicate check** (a Module 20 gap), which could give two active accounts the same name. It now asks first.
- **An absurd `?page=` value gave a server error** (a Module 20 gap). It now gives an empty page, and the screen steps back to the last real one.
- **Found by the browser check:** the range label changed before the new rows arrived, and each filter click re-rendered the page on the server, so checkboxes lagged. Both fixed.
- **Two mistakes in my tests, not the code:** a wrong session helper call, and a test expecting no match for a search that reduces to the word "a".
- **Limits of the check:** the browser check script is not in the repo, because the project has no browser test tooling and I didn't add a dependency. The check ran in Chrome only, and no person has tried these screens yet.

**Verified:** `tsc --noEmit` exit 0 · **99 tests passed** (`script/verify-desk-accounts.ts`), on temporary records, none left behind:
- form values, changed-field detection and cleared fields;
- filters, the address round trip and bad `?page=` values;
- every form field reaching the server and returning;
- browser code importing nothing from the server;
- paging, status filters, "my accounts" and agency separation;
- odd search input, and literal matching in all four places;
- VA policy-number search;
- refusal codes and reactivation rules.

**Deliberate faults:** fifteen were introduced one at a time. All fifteen were caught, and the code was confirmed restored afterwards.

**Browser check:** 51 checks in real Chrome against a temporary dev server, using temporary agencies and users, with no script errors. This is the first time a Desk screen has been clicked through. Covered: paging; typing a search with a bracket; status and "My accounts"; reload; an old link past the end; adding; a refused password; the duplicate flow; editing; someone else saving first; leaving with unsaved changes; deactivate and reactivate; Back to a filtered list; another agency's account; a producer's narrower view; an agency without The Desk; not signed in; phone width. The screens were also checked by eye from screenshots. The server was stopped afterwards and no records were left. The admin screens from Modules 15–19 are still not clicked through.

Module 1–20 suites re-run: 21, 22, 28, 26, 31, 33, 31, 37, 61, 46, 58, 76, 43, 80, 98, 86, 99, 91, 72, 155 passed (**1,293 in total** with this module).

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

**Progress:** Modules 1–21 complete (56.5 h). **69.0 h remaining.**

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
| D2 | Desk business hours, time zone and holiday list | Module 11 | Mon–Fri 9:00–17:00 US Eastern; US federal holidays; can be changed in the Module 19 editor once confirmed |
| D3 | Document sensitivity categories: are General / Policy / Financial / Personal the right four? | Module 8 | Those four |
| D4 | Can a Producer submit requests for accounts outside their assignment? | Module 9 | No: only accounts they can see |
| D5 | Targets for ACORD, Loss Runs, Proposal Prep, QA Review and Other (none given) | Module 12 | No target date for these types; can be entered in the Module 18 editor once confirmed |
