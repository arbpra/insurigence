# The Desk — Handover Report

**Date:** 22 November 2026, updated 26 November 2026
**Covers:** the 46 modules of the Desk build plan (`THE_DESK_BUILD_PLAN.md`), 125.5 hours in total, and Modules 47–50 (positions, permissions, reporting lines and cover) from Phase 7
**Code:** merged into `main` and deployed to https://insurigence.ai (Modules 47–48 on 26 November 2026)

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

It is live on https://insurigence.ai: the code is deployed, the database is updated, the overdue-alert schedule runs and a real email has arrived. Two things remain before real agencies use it (**Section 4, Going live**):

- set up file storage (R2);
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
| **Insurigence Admin** | The COO, the Directors and the Super Admin, each as their position allows | `/super-admin/desk` and `/desk-ops` | Desk setup: agencies, staff, pods, routing and targets, business calendar, follow-up rules. Operations: workload across all agencies with reassigning and escalating, turnaround, monthly usage against plans, and the audit log |

Each person sees only the menu items they may use. A page they may not open sends them away, and the data behind it is refused as well.

### Positions and permissions (Modules 47–48)

What Desk staff may do comes from the positions they hold, which the **Super Admin** manages at `/super-admin/desk/positions`.

- **Each position has** a reach (all agencies, supervised, assigned, or pod authorisation only), a set of permissions, and the position it reports to.
- **One person can hold several** positions and gets everything they allow. A change applies on their next request.
- **Seven are set up:** Chief Operating Officer (replaces the Operations Manager), Director of Virtual Operations, Pod Leader, Virtual Agent, Director of Agency Operations, Senior Account Manager and Account Manager.
- **A new invite starts in the position for its role:** Operations Manager → COO, Account Manager → Account Manager, VA → Virtual Agent. Assign the Directors, Senior Account Managers and Pod Leaders on the Positions page.
- **A position or reporting line never opens sensitive documents or agency data by itself.** Restricted requests, document permissions and pod authorisation still apply.
- **Plans and prices:** only the COO and the Super Admin change them by default.
- **Not built yet:** a Pod Leader's workload view (51), and alerts by position (60; they still go to the role "Operations Manager").

### Account Managers: reporting lines, cover and reassignment (Module 50)

On **Desk Operations → Account Managers**, for the COO, the Director of Agency Operations and Senior Account Managers (permission "Cover and reassign Account Managers"):

- **Who reports to whom,** person by person. Set by those who reach every agency. A Senior Account Manager then sees the agencies, accounts and requests of everyone below them, but no Financial or Personal file, restricted request or permission beyond their own position's.
- **Cover for an absent Account Manager,** from a start to an end date. The person covering works the absent AM's agencies and is sent what they are sent. It ends by itself at the end date, or can be ended early.
- **Moving an agency** to another Account Manager. Its open requests follow.
- A Senior Account Manager does all of this for themselves and the people below them only, and can't change reporting lines.
- When someone loses an agency this way, open work they can no longer reach goes back to the queue.

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

- **50 automated test suites** with **4,170 checks**:
  - 43 Desk suites from Modules 1–44;
  - the demo walkthrough (83 checks);
  - restricting a request to named people (57 checks);
  - positions (75 checks) and access by position (91 checks);
  - the two older text-matching and user-responses suites (25 checks).

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

These steps are for whoever runs the hosting. Steps 1–4 are required before go-live; steps 5 and 6 are needed for the first agency. **Status on 22 November 2026:** steps 1, 2, 3 and 5 are done; in step 4 everything but R2 is set; step 6 waits for R2.

**Status on 26 November 2026:** Modules 47–49 are live. On that day insurigence.ai was first found to be running a build without The Desk; the new code was then pulled, built and started, and the seven positions created. The site runs on an Ubuntu server behind nginx, so the server settings below belong **on that server**. **Alerts:** the app now runs the alert check itself every 15 minutes (`DESK_ALERT_CHECK_MINUTES=15` on the server); runs were confirmed at 02:34 and 02:48 UTC on 26 November. The GitHub schedule stays as a backup. Its runs from 23 to 25 November failed because the site was running a build without The Desk; the first run after the rebuild succeeded.

**Each time code is deployed,** on that server: `git pull origin main`, `npm ci`, `npm run db:push`, `npm run build`, `npm run db:seed:desk`, then restart the app. A push to GitHub alone doesn't update the site. **Module 50 needs both database steps:** `db:push` adds the reporting-line and cover collections (already added to the shared database on 26 November, so there it changes nothing), and `db:seed:desk` should print "Permissions added: team.manage → COO, DIRECTOR_AGENCY_OPS, SENIOR_AM" the first time (nothing on later runs).

| # | Step | Why |
|---|---|---|
| 1 | ✅ **Merge the branch** `feature/proposal-system` into `main` and deploy. Done 22 November 2026. | The Desk existed only on that branch. |
| 2 | ✅ **Update the production database** (the `insurigence` database on Atlas, which development has also been using): `npm run db:push`, then `npm run db:seed:desk`. Done on the server, 22 November 2026. | The first creates The Desk's collections and indexes. The second creates the defaults: the four pods, routing and follow-up rules, the three plans, your targets, the business calendar and holidays. It only creates what is missing, so running it again is safe. **Don't run `npm run db:seed` on a live database:** it resets the demo users' passwords. |
| 3 | ✅ **Confirm the database runs as a replica set.** MongoDB Atlas does by default, and the transactions run on it. | Requests, subtasks and history are saved together in one transaction, which needs a replica set. |
| 4 | **Set the server settings** in the table below. **Most important:** set up file storage (R2), and turn on the overdue-alert schedule. The schedule, `APP_URL` and email are done; **R2 is still to set**. | Without R2, documents can't be uploaded. Without the schedule, nobody receives overdue or escalation alerts (the Workload page says so). |
| 5 | ✅ **Send one real email.** Done 22 November 2026: a Desk notification email arrived, from `noreply@insurigence.ai`. | Emails go through Resend, as invites already do. |
| 6 | **Upload one real document** to a request, then open it. | The storage code is tested, but never against your R2 bucket. |
| 7 | **Set up the team and the first agency**, in Desk setup (`/super-admin/desk`): see the steps below. | |

### Server settings

| Setting | Required? | What it does |
|---|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | **Yes, for documents** | Cloudflare R2 file storage, in the same private bucket model as the existing quote documents. **Not set yet:** waiting for the client's Cloudflare credentials. |
| `DESK_CRON_SECRET` | **Yes, for alerts** | A random secret of at least 24 characters. A scheduler then calls `https://insurigence.ai/api/desk/cron/alerts` every 15 minutes with the header `Authorization: Bearer <secret>`. It suits any kind of hosting. Any scheduler that can send a header works. **Set up, as a backup:** GitHub Actions calls the check every 15 minutes (`.github/workflows/desk-alerts.yml`, using the repository secret `DESK_CRON_SECRET`, which must match the server's). It can also be run by hand from GitHub → Actions → Desk alert check → Run workflow. A failed call shows as a red run. GitHub can start scheduled runs a few minutes late, which doesn't matter for 2- and 4-hour thresholds. |
| `DESK_ALERT_CHECK_MINUTES` | Alternative to the schedule | For example `15`: the app runs the check itself while it is running. Suits a server that stays up, as the Ubuntu server does. **Set to `15` on the server since 26 November 2026; this is now the main check.** Using both settings is safe: no alert is sent twice. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` | Already set | Email sending, and the links in emails. `APP_URL` is `https://insurigence.ai` on the server. |
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

The demo was loaded on the live database for the owner's click-through on 22 November 2026, every sign-in was checked, and it was then removed (2 agencies, 10 people, 13 requests). It is **not** loaded now.

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
