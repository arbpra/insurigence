# The Desk — Handover Report

**Date:** 22 November 2026
**Covers:** the 46 modules of the Desk build plan (`THE_DESK_BUILD_PLAN.md`), 125.5 hours in total
**Code:** branch `feature/proposal-system` (not yet merged into `main`)

---

## 1. Summary

The Desk foundation is built and tested. Inside the existing Insurigence app, with the same login and database, an agency can:

- upload its book of business;
- send work to The Desk;
- follow every request in one place.

Behind the scenes, Account Managers and the VA pods do the work.

Everything in the plan's scope is in place:

- the four views;
- insured accounts and imports;
- tasks with routing, subtasks, documents, notes and history;
- need-to-know access for Desk staff;
- business-hours service levels with alerts and escalation;
- billable-activity tracking.

A few things must happen before real agencies use it. They are in **Section 4, Going live**:

- set up file storage;
- switch on the overdue-alert schedule;
- check a real email;
- confirm the plan allowances.

**Section 5** lists the decisions that are yours to make.

---

## 2. What you have

### The four views

| View | Who uses it | Where | What it does |
|---|---|---|---|
| **Agency Portal** | The agency's Owner / Admin, Producers and CSRs | `/desk` | Overview of what needs their attention, all requests with simple statuses, sending a new request, accounts and policies, importing the book (Owner / Admin), messages with their Account Manager, and who in the agency sees which accounts (Owner / Admin) |
| **Account Manager Portal** | Account Managers | `/desk-ops` | Dashboard of open, due-soon and overdue work and upcoming renewals; each agency's accounts and work; messages with agencies; turnaround figures |
| **Pod / VA Portal** | VAs | `/desk-ops` | Their pod's queue to pick work up from, "My tasks", and the working page for a request: status, notes, documents, subtasks and history |
| **Insurigence Admin** | Operations Managers | `/super-admin/desk` and `/desk-ops` | Desk setup: agencies, staff, pods, routing and targets, business calendar, follow-up rules. Operations: workload across all agencies with reassigning and escalating, turnaround, monthly usage against plans, and the audit log |

Each person sees only the menu items their role may use. A page outside their role sends them away, and the data behind it is refused as well.

### How a request flows

1. An agency sends a request for one of its accounts.
2. It is routed to the right pod with the agency's Account Manager attached, and gets its service-level target.
3. A VA picks it up, or the Account Manager assigns it.
4. The VA works it. If they need something, they ask the agency, which pauses the clock; the agency's reply restarts it.
5. Waiting on the carrier or the insured pauses the clock the same way.
6. Optionally, QA review.
7. It is completed. Completion counts it against the agency's monthly allowance, and a follow-up task is created where a rule says so (for example, the AMS update in Pod 1 after a renewal).
8. The agency sees it completed, with its history.

Each step is recorded in the request's history. Every action by anyone is also recorded in a separate audit log.

### Your answers (27 October), and how they were met

| Your answer | In The Desk |
|---|---|
| **Q1. Any AMS; AMS work is manual for now** | Each agency's Desk profile records its AMS and its own instructions for the team. AMS work goes to Pod 1 as tasks. |
| **Q2. Flexible imports, several policies per insured** | Upload any CSV or Excel export, then match its columns once (remembered per agency). You get a preview with errors before anything is saved, grouping of several policies under one insured, files with insureds only, and producer matching. An import can be undone. |
| **Q3. Owner / Admin, Producer, CSR** | The Owner / Admin sees everything and manages access. A Producer sees their assigned accounts. A CSR sees their assigned accounts or the whole book, as the Owner / Admin chooses. An account can have several producers and service staff. |
| **Q4. Need-to-know for VAs, everything logged, no passwords** | A VA sees only work for agencies that authorised their pod or them by name, in their own pod. They reach accounts only through that work. Financial and personal documents need a separate permission. An Account Manager or Operations Manager can restrict a request, with its subtasks, to named VAs, with a reason; VAs and the agency never see who is named or why. Every action is logged. No passwords are stored: The Desk keeps only a pointer to the entry in your password manager, and password-like text typed into The Desk is refused. |
| **Q5. Business-hours targets, pausing, escalation; internal only** | Your initial targets are loaded and can be edited. They count business hours on the Desk calendar and skip weekends and holidays. The clock pauses while waiting. Overdue alerts go to the Account Manager, then to the Operations Managers. Agencies never see targets or due dates. |
| **Q6. Track billable activity now, invoice later** | Plans (Core, Growth, Complete) and per-agency allowances. Each completed request is classed as included, overage or non-billable. A monthly usage page shows each agency against its plan. There is no invoicing yet, as you asked. |

---

## 3. How it was tested

- **47 automated test suites** with **3,852 checks**:
  - 43 Desk suites from Modules 1–44 (3,688 checks);
  - the demo walkthrough (83 checks);
  - restricting a request to named people (57 checks);
  - the two older text-matching and user-responses suites (24 checks).

  They all pass. They run against the real database through the real API routes, signed in as real people. Each one cleans up its own temporary records.
- **Permission suite (Module 44):** 123 checks that each person can do only what their role allows:
  - one agency's data can never be reached from another agency;
  - Producers stay within their accounts;
  - VAs see only what they are authorised for;
  - sensitive documents need the right permission;
  - restricted requests stay restricted;
  - internal notes never reach the agency.
- **Deliberate faults:** in many modules, mistakes were planted in the code on purpose, to prove the tests notice them. Nearly all were caught. Every miss either could do no harm or led to a stronger test.
- **Page walkthrough (Module 45),** on a production build, as six different people:
  - every page in each person's menu opens without an error;
  - each menu holds exactly the right items;
  - other areas send people away.

  The median page time was about 1 second.

**Not yet done: a person clicking through in a browser.** The development machine didn't have enough memory to run the browser checks from Module 38 onwards. The tests above cover what each page receives and what each action does, but the screens have not been seen in a browser since Module 37. **Please do one click-through before go-live** (the demo in Section 6 makes this quick).

---

## 4. Going live

These steps are for whoever runs the hosting. Steps 1–4 are required before go-live; steps 5 and 6 are needed for the first agency.

| # | Step | Why |
|---|---|---|
| 1 | **Merge the branch** `feature/proposal-system` into `main` and deploy. | The Desk exists only on that branch. |
| 2 | **Update the production database** (the `insurigence` database on Atlas, which development has also been using): `npm run db:push`, then `npm run db:seed:desk`. | The first creates The Desk's collections and indexes. The second creates the defaults: the four pods, routing and follow-up rules, the three plans, your targets, the business calendar and holidays. It only creates what is missing, so running it again is safe. **Don't run `npm run db:seed` on a live database:** it resets the demo users' passwords. |
| 3 | **Confirm the database runs as a replica set.** MongoDB Atlas does by default. | Requests, subtasks and history are saved together in one transaction, which needs a replica set. |
| 4 | **Set the server settings** in the table below. **Most important:** set up file storage (R2), and turn on the overdue-alert schedule. | Without R2, documents can't be uploaded. Without the schedule, nobody receives overdue or escalation alerts (the Workload page says so). |
| 5 | **Send one real email.** Invite a staff member to your own address, and send a test request to see the notification. | Emails go through Resend, as invites already do, but no Desk email has yet been seen arriving in an inbox. |
| 6 | **Upload one real document** to a request, then open it. | The storage code is tested, but never against your R2 bucket. |
| 7 | **Set up the team and the first agency**, in Desk setup (`/super-admin/desk`): see the steps below. | |

### Server settings

| Setting | Required? | What it does |
|---|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | **Yes, for documents** | Cloudflare R2 file storage, in the same private bucket model as the existing quote documents. **They are not set in the current `.env`.** |
| `DESK_CRON_SECRET` | **Yes, for alerts** | A random secret of at least 24 characters. A scheduler then calls `https://insurigence.ai/api/desk/cron/alerts` every 15 minutes with the header `Authorization: Bearer <secret>`. This is the right choice for the current Replit "autoscale" deployment, which sleeps when idle and can run several copies. Any scheduler that can send a header works (for example a Replit scheduled deployment, or an external cron service). |
| `DESK_ALERT_CHECK_MINUTES` | Not on autoscale | For example `15`: the app runs the check itself while it is running. Only suits a server that stays up (a reserved VM). Using both settings is safe: no alert is sent twice. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` | Already set | Email sending, and the links in emails. |
| `DESK_EMAIL_NOTIFICATIONS=off` | Only on test copies | Stops Desk emails and alerts. Use it on any staging or test copy that shares real data. |

Two safeguards apply whatever the settings:

- Emails are never sent to reserved addresses (`.invalid`, `.test`, `example.com` and similar).
- No setting can make The Desk store a password.

### Setting up the team and the first agency

1. **Staff** (`/super-admin/desk/staff`): invite the Operations Managers, Account Managers and VAs. They set their own passwords from the invite email.
2. **Pods** (`/super-admin/desk/pods`):
   - put each VA in their pod;
   - give a Financial or Personal document permission to the VAs who need it.
3. **Agency** (`/super-admin/desk/agencies`):
   - turn The Desk on;
   - choose the primary and backup Account Managers, the plan, the AMS and the agency's instructions;
   - add the pointer to its password-manager entry;
   - authorise the pods it uses, either whole pods or named VAs.

   The page shows a checklist of what is still missing.
4. **The agency's Owner / Admin** then:
   - imports the book (`/desk/import`);
   - invites their Producers and CSRs;
   - sets who sees which accounts (`/desk/team`).

---

## 5. Decisions that are yours

### Details from the plan (Section 10) still to confirm

Each one has a working placeholder, and can be changed on screen unless noted.

| # | Detail | Today | Where to change it |
|---|---|---|---|
| **D1** | **Monthly allowances per plan** (managed accounts, COIs, endorsements, renewals, remarketing credits), and which services can be billed as overage | **Not entered.** Completed work is marked "not yet classified" rather than guessed. Once the numbers are in, one run classifies all past work in the month it was completed. | Per agency: on the agency's Desk setup page. **Per plan: there is no screen yet.** It is either a one-time data entry or a small screen (about 1 hour). |
| D2 | Desk business hours, time zone, holidays | Mon–Fri 9:00–17:00 US Eastern, US federal holidays | Business calendar |
| D3 | Document categories: General / Policy / Financial / Personal | Those four, with no default: the uploader must choose one | A code change |
| D4 | Can a Producer send requests for accounts outside their assignment? | No, only accounts they can see | A code change |
| D5 | Targets for ACORD, Loss Runs, Proposal Prep, QA Review and Other | No target date for these types | Routing & targets |

### Questions raised during the build

- **Sample AMS exports.** The import was built and tested with sample files modelled on common AMS exports, not real ones. One real export from each AMS your first agencies use would confirm the column matching.
- **Unfinished imports.** An import that is uploaded but never committed stays as a draft for good. Should drafts expire after a set time?
- **Document retention.** When someone removes a document, its stored file is deleted. If documents must be kept for a period, that needs a rule.
- **Audit log retention.** Audit entries are kept indefinitely. Is there a retention period, or a need for archiving?
- **Alert timing.** "Approaching" means 2 business hours before the target, and escalation to the Operations Managers comes 4 business hours after it is missed. Changing these is a one-line change; a screen could be added.
- **Who gets overdue alerts.** As planned, the Account Manager and the Operations Managers. The VA holding the work sees it marked overdue in their queue, but isn't emailed. Say if VAs should be emailed too.
- **The demo** (Section 6). Should it be loaded on the shared database for your review? It creates working sign-ins, including an Operations Manager, so this is your call.

---

## 6. The demo

`npm run db:seed:desk-demo` creates two demo agencies, their people and books, a demo Desk team, and requests at every stage. It is enough to see all four views working. It prints the sign-ins.

- **Password:** all demo people share one password. Set it with `DESK_DEMO_PASSWORD` (12 characters or more), or a random one is printed.
- **No email:** every demo address uses the reserved `desk-demo.invalid` domain, so no email can reach anyone.
- **Removing it:** `npm run db:seed:desk-demo -- --remove` takes it out; `-- --reset` takes it out and creates it again. Removal touches only demo records. It refuses to run if a real person has been added to a demo agency.
- **Before real agencies go live, remove the demo from that database.** The demo VAs sit in the real pods, so they would see the work of any real agency that authorises a whole pod.

The demo is **not** loaded on the shared database now. Today no agency on that database has The Desk on.

---

## 7. Known limits

These were recorded module by module in the build plan. None blocks go-live.

**Agencies**
- An agency can't edit a request's title or details after sending it. They add a note instead.
- The agency's Overview page has no "needs your attention" count yet; that count is on the Requests page and in the email.
- Messages can't be edited, deleted or carry attachments. Files belong on a request.
- There's no unread-message count in the menu, and pages don't refresh by themselves; they update on each action or reload.

**Desk team**
- The sharing of a document (internal or agency-visible) can't be changed after upload.
- Subtasks can't be reordered, renamed or moved to another request.
- A follow-up rule triggers only on completion, creates one task, and leaves it unassigned in its pod's queue.
- Bulk changes on the Workload page are limited to 50 requests at a time.
- Account names on the Account Manager's agency page aren't links; there is no staff page for one account.

**Reports**
- Turnaround compares one period (the last 7, 30, 90 or 365 days), with no trend or chart, and covers up to 20,000 requests per report.
- Usage has no export; the audit log does (up to 5,000 entries per download).
- Usage for past months shows today's count of managed accounts, not the count at the time.

**Email**
- Emails are sent while the action happens, so a slow email provider slows that action. A failed email is recorded, but not retried.
- There are no personal email settings (turning some off, or a daily digest).
- Sharing a note with the agency sends no email. Asking the agency for something does.

**Imports**
- At the largest allowed file size, saving takes about a minute and undoing about two. A host with a short request time limit could cut these off. An undo can be repeated, but your host's limit is worth checking.
- AMS "continuation" rows with a blank name are treated as errors, rather than taking the name above.

**Older parts of the app**
- The quote-document and document-summary uploads were lowered to 9 MB, to match the 10 MB limit on what reaches the server. Their larger files used to fail.
- The main app's pages (the dashboard and Super Admin) send an empty page and redirect in the browser once they have checked the session. This was so before The Desk. Nothing is exposed, because the data comes only from the API, which refuses. The Desk's own pages redirect on the server.

---

## 8. Not in this plan, and suggested next steps

As agreed in the plan's Section 8, these are not included:

- the individual workflows (renewal pipeline, COI, endorsements, new business, QA checklists);
- AMS integrations;
- AI features;
- invoicing;
- an agency-facing usage page;
- a portal for insureds.

Suggested order:

1. **Renewal pipeline.** Policy expiration dates, the indexes and the expiration-based targets (90–120 and 45–60 days) are already in place, and the Account Manager dashboard already lists upcoming renewals. Creating renewal requests automatically is the natural first workflow.
2. **COI workflow** for Pod 1, using the ACORD generation and COI assistant already in Insurigence.
3. **Plan allowances screen and invoicing,** once D1 is confirmed.
4. **AI assistance.** Tasks already record whether a person or AI created them, linked to the existing AI audit trail, so AI suggestions can follow the same rules as people.

---

## 9. For a developer taking over

| What | Where |
|---|---|
| Access rules (every Desk query) | `lib/desk/access.ts` |
| Task changes (every route, rule and future AI) | `lib/desk/tasks.ts` |
| Service levels and the business-hours clock | `lib/desk/service-levels.ts`, `lib/desk/business-time.ts` |
| Alerts and their schedule | `lib/desk/alerts.ts`, `lib/desk/alert-schedule.ts`, `instrumentation.ts` |
| Menus and which roles see what | `lib/desk/navigation.ts` |
| Defaults and the demo | `lib/desk/defaults.ts`, `lib/desk/demo.ts` |
| Pages | `app/(desk)/desk` (agency), `app/(desk)/desk-ops` (team), `app/(main)/super-admin/desk` (setup) |
| Tests | `script/verify-desk-*.ts`, each run with `npx tsx <file>` |
| Module-by-module record | `THE_DESK_BUILD_PLAN.md`: what was built, the design decisions, issues, limits and tests for each module |

Points to know:

- **Text search must be escaped.** On MongoDB, Prisma's `contains`, `startsWith` and `endsWith` are sent as regular expressions. Wrap user text in `literal()` from `lib/desk/literal-match.ts`.
- **Notes and documents are internal unless marked shared,** so a mistake hides information instead of leaking it.
- **Another agency's record answers "not found",** not "forbidden".
- **Request history is append-only.**
- **Run tests with Desk email off:** `DESK_EMAIL_NOTIFICATIONS=off`, and an empty `RESEND_API_KEY`. The tests use the real database and their own temporary records, which they remove.
