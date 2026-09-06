# Insurigence Proposal Builder + Digital Presentation + E-Sign
## Build Plan & Module Breakdown

**Document version:** 1.0
**Date:** 18 August 2026
**Source:** Client feedback — *"One thing I think needs to be completed and is a big proponent of the software is the proposal. I do not believe the proposal is completed."*
**Purpose:** Scope the full proposal system and break it into daily work modules of 2–3 hours each.

---

## 1. Objective

Build a complete proposal system that allows an agent to take quote information received from insurance carriers, create a professional customized proposal, digitally send it to the insured, allow the insured to review multiple options, select an option, and electronically sign required acknowledgements or documents.

The proposal system should be one of the primary client-facing experiences inside Insurigence.

### Target workflow

```
Lead → Evaluation → Quotes Received → Proposal Created → Proposal Sent
     → Insured Views → Insured Selects Option → Insured Signs → Agent Notified
```

---

## 2. Current State Audit

Before scoping, the existing codebase was audited. The client is correct that the proposal is incomplete — but the foundation is not empty either. Roughly **25% of the required system exists**, and critically, the proposal that exists today is a **market-classification presentation**, not a **quote proposal**. The client is asking for a different thing built on top of the same models.

### 2.1 What already exists

| Area | Status | Detail |
|---|---|---|
| `Proposal` model | Partial | Has `publicToken`, `status`, `sharedAt`, `viewedAt`, `snapshot`, `quoteIds`, `agentRecommendation` |
| `Quote` model | Thin | Only `quoteName`, `premiumAnnualCents`, `totalAnnualCents`, `coverageSummary` (Json) |
| Proposal API | Partial | `POST/GET/PATCH /api/leads/[id]/proposal`, `GET/PATCH /api/proposals/[id]`, `GET /api/proposal/[publicToken]` |
| Agent builder page | Partial | 569 lines — market summary, "The Answer / The Why / The Options", recommendation |
| Public proposal page | Partial | 333 lines — **read-only**; no option selection, no signing, no PDF |
| Proposals list page | Exists | 168 lines |
| Agency branding | Partial | `logoUrl`, `brandPrimaryColor`, `brandSecondaryColor`, `proposalFooterText` on `Agency` |
| AI proposal language | Exists | Returns `executiveSummary`, `whatWeRecommend`, `optionComparison` |
| Activity events | Partial | `ActivityEvent` model with `PROPOSAL_CREATED / SHARED / VIEWED` |
| Email infrastructure | Exists | Resend, central `sendEmail()`, branded templates, reply-to support |
| `pdf-lib` | Installed | Currently used only for ACORD form filling |

### 2.2 What is missing

| # | Requirement | Status |
|---|---|---|
| 1 | Quote entry — **no Quote API and no Quote UI exist at all** | Missing |
| 1 | Quote fields: taxes, fees, dates, limits, deductibles, exclusions, payment plan, doc upload, quote expiry | Missing |
| 2 | AI coverage-by-coverage breakdown (plain-language, editable) | Missing |
| 3 | Side-by-side comparison with difference highlighting | Missing |
| 3 | "Agent Recommended" flag + "Why We Recommend This Option" | Partial |
| 4 | Modular proposal builder with the 9 defined sections | Missing |
| 5 | Agency branding applied to proposal; Super Admin override | Partial |
| 6 | Copy Link / Email Proposal / Revoke Link / Resend Proposal | Missing |
| 7 | Polished insured web presentation (not a PDF download) | Partial |
| 8 | Option selection + confirmation + change-before-signing | Missing |
| 9 | Electronic signature + consent + audit capture | Missing |
| 10 | E-Sign activity log UI | Missing |
| 11 | PDF generation — unsigned and signed versions | Missing |
| 12 | Agent notifications on open / select / sign | Missing |
| 13 | Full proposal status set + lead status sync | Partial |
| 14 | Version control on re-send; signed versions immutable | Missing |
| 15 | AI guardrails (no term/limit/premium changes) | Partial |
| 16 | Proposal disclaimer (agency-customisable, Super Admin default) | Missing |
| 17 | Security: token hardening, agency scoping, public payload filtering | Partial |
| 18 | `ProposalSignature` and `ProposalActivityEvent` models | Missing |

### 2.3 Infrastructure gaps that block work

These have **no existing implementation** and must be decided before the modules that depend on them:

1. **File storage.** No blob storage is configured — no S3, Cloudinary, or Vercel Blob. The one existing upload endpoint processes files in memory and discards them. Carrier quote documents (Module 6) and generated PDFs (Module 29) both require persistent storage.
2. **PDF rendering approach.** `pdf-lib` is installed but is low-level — good for filling fixed ACORD forms, painful for laying out a designed proposal. HTML→PDF via headless Chrome produces far better output but adds a heavy dependency with hosting implications.
3. **In-app notifications.** No `Notification` model exists. Email works today; in-app requires new infrastructure.
4. **Database is MongoDB.** Versioning and immutability patterns must suit a document store, not a relational one.

---

## 3. Module Breakdown

Modules are sized for **one 2–3 hour working session each**, ordered so each builds on the previous.

### Phase 0 — Data Foundation (5 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 1 | Expand `QuoteOption` schema — all quote fields, migration, backfill from existing `Quote` | 2.5 | ✅ Done |
| 2 | Extend `Proposal`; add `ProposalSignature` + `ProposalActivityEvent`; extend status enums | 2.5 | ✅ Done |

**Delivered:**

- `Quote` (4 real fields) replaced by `QuoteOption` (30 fields) covering the full requirement 1 field list — carrier, program, policy type, all three date types, premium/taxes/fees/total in whole cents, payment plan, coverages, limits, deductibles, endorsements, exclusions, notes, uploaded document, `isRecommended`, `sortOrder`.
- `Proposal` extended with `createdByUserId`, `version`, `selectedQuoteOptionId`, `recommendationText`, `clientMessage`, `disclaimerText`, `sections`, `tokenRevokedAt`, `sentAt`, `selectedAt`, `signedAt`, `expiresAt`, `lockedAt`. All market-classification fields retained.
- `ProposalSignature` added — append-only signing evidence including consent text, IP, user agent, and the frozen proposal version and selected option.
- `ProposalActivityEvent` added, with `ProposalEventType` (12 values) for the E-Sign Activity log.
- `ProposalStatus` migrated: `SHARED → SENT`, `ACCEPTED → SIGNED`, plus `READY_TO_SEND`, `OPTION_SELECTED`, `EXPIRED`, `REVOKED`. `DECLINED` retained — the Super Admin dashboard reports on it.
- `SignatureType` enum added (`TYPED` / `DRAWN`).
- 13 indexes created for agency-scoped and lead-scoped queries.

**Verified:** `prisma validate` passed · `prisma db push` applied 3 collections and 13 indexes · `tsc --noEmit` exit 0 · full-field `QuoteOption` round-tripped against the live database · all 4 existing proposals intact with correct defaults.

**Open Question 5 — answered.** The database held **0 quotes and 4 proposals, all `DRAFT`**. No record used any status being renamed, so the enum migration carried zero data risk and no backfill was needed. The market-classification proposal remains fully functional alongside the new quote-proposal fields.

**Call sites updated (7 files):** `prisma.quote` → `prisma.quoteOption`; `'SHARED'` → `'SENT'` and `'ACCEPTED'` → `'SIGNED'` across the proposal APIs, the Super Admin dashboard, and the two proposal pages. The send path now writes `sentAt`; `sharedAt` is retained on the model for historical rows but is no longer written.

### Phase 1 — Quote Entry (13.5 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 3 | Quote Options API — full CRUD, agency-scoped authorisation | 3.0 | ✅ Done |
| 4 | Quote Option form UI — single option, all fields, validation | 3.0 | ✅ Done |
| 5 | Multiple options — list, edit, delete, reorder, mark recommended | 2.5 | ✅ Done |
| 6 | Carrier quote document upload + persistence (Cloudflare R2) | 5.0 | ✅ Done |

**Open Question 1 — answered: Cloudflare R2.** R2 is S3-compatible, so it works unchanged from DigitalOcean hosting. Module 6 was re-estimated from 2.5 h to 5.0 h to include the storage layer, taking Phase 1 from 11 h to 13.5 h.

**Delivered:**

- `lib/quotes/money.ts` — dollar/cent conversion. Amounts are parsed from `"$8,750.10"` or `8750.10` into exact `BigInt` cents, with bounds and negative checks.
- `lib/quotes/quoteOption.ts` — one validation and serialization module shared by create and update, so the two cannot drift. Handles partial (PATCH) semantics, date ordering, JSON size caps, and BigInt → JSON conversion.
- `GET/POST /api/leads/[id]/quote-options` — list and create. GET also returns the lead name and the agency's active carriers, because no agent-facing carrier endpoint exists.
- `GET/PATCH/DELETE /api/quote-options/[id]` — read, partial update, delete with sort-order resequencing.
- `POST /api/leads/[id]/quote-options/reorder` — whole-list reorder, idempotent and validated against the lead's actual options.
- `QuoteOptionForm` — all requirement-1 fields with client validation mirroring the server, and a live total that previews what the server will compute.
- `QuoteOptionList` — reorder, edit, inline delete confirmation, recommend toggle, plus an expired-quote badge driven by `quoteExpirationDate`.
- `/leads/[id]/quotes` page tying them together.

**Design decisions:**

- **Total annual cost auto-computes** as premium + taxes + fees, but an explicitly entered total always wins — carriers sometimes quote a total that does not equal the parts, and the carrier's number is the one that belongs in front of the insured.
- **Recommendation is exclusive per lead**, enforced in a transaction: setting one clears the others.
- **Cross-agency access returns 404, not 403.** A 403 confirms the id exists, which is itself a leak across the agency boundary.
- **`BigInt(0)` instead of `0n`** — the project targets ES2017, where BigInt literal syntax is unavailable. Raising the global target was not worth the build-wide risk.

**Verified:** 17 unit tests on money and validation · 7 integration tests against the live database (recommendation exclusivity, reorder, sort-order resequencing after delete, agency isolation, BigInt precision) · `tsc --noEmit` exit 0.

**Bug caught during testing:** the total auto-compute treated an omitted `totalAnnual` as an explicit empty value, resolving the total to null instead of summing the parts. Fixed by excluding `undefined` from the explicit-total branch.

**Module 6 — document storage (Cloudflare R2):**

- `lib/storage/r2.ts` — S3 client against R2 (`region: 'auto'`, account endpoint), built lazily so the app boots without R2 configured and uploads fail with a clear 503 instead of crashing at import.
- `POST/GET/DELETE /api/quote-options/[id]/document` — upload, download, remove. All three run the agency check first.
- `QuoteDocumentField` component; attaches to a saved option.
- Schema: `documentUrl` replaced by `documentKey`, plus `documentSize`, `documentContentType`, `documentUploadedAt`.

**Security model:**

- **The bucket is private.** No public URL exists. `GET` authorises, then 302-redirects to a presigned URL valid for 5 minutes — so a copied link expires, and the object key never reaches the client.
- **Keys are namespaced** `agencies/{agencyId}/quote-options/{optionId}/{uuid}-{filename}`, segmenting the bucket by tenant.
- **Filenames are sanitised** — path separators, traversal sequences, and shell/SQL punctuation stripped; the original name is kept in the database for display and set as the download filename.
- **Uploads are validated** on content type (PDF/Word/image) and size (15 MB), server-side.
- **Downloads bypass the droplet.** The browser fetches from R2 directly, so DigitalOcean egress is not consumed and R2 charges no egress.
- **Ordering under failure:** on replace, the new object is stored before the old is deleted; on delete, the database reference is cleared before the object. Both leave a recoverable orphan rather than a broken reference.

**Verified:** 12 storage tests (key namespacing, path-traversal stripping, Windows separators, collision avoidance, filename truncation, type/size policy, unconfigured detection) · `prisma db push` in sync · `tsc --noEmit` exit 0.

**Not yet verified:** no live round trip against a real bucket — R2 credentials are still blank in `.env`. The code paths that talk to R2 are untested against the service itself.

### Phase 2 — AI-Assisted Breakdown (7.5 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 7 | AI coverage-breakdown prompt + endpoint | 3.0 | ✅ Done |
| 8 | Agent-editable breakdown UI | 2.5 | ✅ Done |
| 9 | AI guardrails — no term/limit/premium mutation, review-required flag | 2.0 | ✅ Done |

**The central design decision — guardrails are structural, not instructional.**

Requirement 15 says AI must never change quote terms, limits, or premiums. Rather than rely on the model obeying its prompt, each coverage is split in two:

| Half | Fields | Who may write it |
|---|---|---|
| **Facts** | name, limit, deductible, included | Agent only — typed from the carrier's quote |
| **Prose** | plainLanguage, whyItMatters, differsFromOthers | AI drafts, agent edits |

`mergeAiProse` starts from the stored coverages and copies across *only* the three prose fields. The AI's output schema has no field for a limit or premium at all. So a hallucinated number has no channel to travel through — it cannot reach the database or the insured even if the model produces one. Limits are sent to the model as read-only context so its comparisons stay accurate.

**Delivered:**

- `lib/quotes/coverage.ts` — the guardrail boundary: `normalizeCoverages`, `parseCoverageInput`, `mergeAiProse`, `markAgentEdits`, `needsAgentReview`, `toClientFacing`.
- `lib/ai/prompts/coverageBreakdown.ts` + `CoverageBreakdownSchema` — prose-only output contract, registered as the `coverage_breakdown` AI purpose.
- `POST /api/leads/[id]/coverage-breakdown` — lead-scoped, because "how this differs from the other options" needs every option in one call. Records an `AiRun` for audit.
- `CoverageBreakdownEditor` — add/remove coverages, edit every AI field, per-coverage "needs review" badges, and an explicit approve action.
- Coverage validation wired into `PATCH /api/quote-options/[id]`.

**Additional guardrails beyond the merge boundary:**

- **Invented coverages are discarded.** AI output joins to stored coverages by key; an unrecognised key has no home, is dropped, and is logged.
- **Agent wording outranks regeneration.** Re-running the draft preserves anything the agent edited, unless `overwriteEdited` is passed explicitly.
- **The review flag is decided server-side.** `markAgentEdits` compares incoming prose against stored prose rather than trusting a client-supplied `agentEdited` — a client cannot mark unreviewed AI text as agent-approved.
- **Editing reviewed text resets its approval**, so a change after sign-off returns to pending.
- **`toClientFacing` strips the review trail** — `aiDrafted`, `agentEdited`, `reviewedAt`, and internal keys never reach the insured.

**Verified:** 35 adversarial guardrail tests, kept as `script/verify-ai-guardrails.ts` — including a simulated model returning fabricated limits, premiums, renamed coverages, and invented entries · live `gpt-4o-mini` call confirming accurate comparisons ("higher limit of $250,000 compared to the $100,000 limit in Option 2") with limits unchanged and all output flagged for review · `tsc --noEmit` exit 0.

**Not yet verified:** the editor UI has not been driven in a browser.

### Phase 3 — Comparison (8 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 10 | Comparison diff engine | 2.5 | ✅ Done |
| 11 | Side-by-side comparison table with difference highlighting | 3.0 | ✅ Done |
| 12 | "Agent Recommended" + "Why We Recommend This Option" | 2.5 | ✅ Done |

**Delivered:**

- `lib/quotes/comparison.ts` — matches coverages across options despite naming variance ("General Liability (GL)" ≡ "General Liability"), parses limits written as `$250,000` / `250K` / `$1.5M` / `$1M/$2M`, classifies each row as `availability` / `limit` / `deductible` / `mixed`, and writes a plain sentence per difference.
- `ComparisonTable` — side-by-side table, differences tinted, "highest"/"lowest" badges, a differences-only filter, and a key-differences list reused verbatim in the proposal.
- `RecommendationPanel` + `POST /api/leads/[id]/recommendation` — AI drafts "Why We Recommend This Option" from the diff engine's output; the agent's choice of option is an input, never an output.
- Schema: `recommendationRationale`, `rationaleAiDrafted` on `QuoteOption` — stored on the option so it exists before a proposal does; Phase 4 copies it into `Proposal.recommendationText`.

**Design decisions:**

- **The table and the prose share one engine.** The AI recommendation is fed `differenceSummaries()` — the same sentences the table renders — so the narrative can never contradict the table.
- **Highlighting is restrained.** Only flagged rows are tinted and only the strongest cell is badged; colour is never the sole signal (text labels carry the same meaning).
- **Absence is never inferred.** A coverage missing from an option renders "Not quoted", distinct from an explicit "Not included".
- **Editing the rationale clears `rationaleAiDrafted` server-side**, matching the Phase 2 review rule.

**Two defects found by live testing and fixed:**

1. **Inverted cost claim.** The model wrote *"slightly more expensive than Westfield"* when the recommended option was in fact cheaper ($9,125 vs $9,200). Raw totals had been passed and the model did the arithmetic itself. Fixed by adding `costSummaries()`, which states the direction in words ("Travelers costs $1,225 more per year than E&S Market"), plus a prompt rule forbidding the model from comparing totals itself.
2. **Vague `mixed` sentences.** When a limit *and* a deductible both differed — the commonest real case — the summary fell through to "X differs between the options", giving the AI nothing concrete. Now composes both clauses with figures.

**Verified:** 29 diff-engine tests (`script/verify-comparison.ts`), including regression cases for both defects · 35 guardrail tests still pass · two live `gpt-4o-mini` runs, the second citing only supplied figures with the cost direction correct · `tsc --noEmit` exit 0.

### Phase 4 — Proposal Builder (12.5 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 13 | Builder shell + modular section framework | 3.0 | ✅ Done |
| 14 | Sections: Agency Header, Client Information, Executive Summary | 2.5 | ✅ Done |
| 15 | Sections: Coverage Breakdown, Considerations, Notes, Next Steps | 2.5 | ✅ Done |
| 16 | Agency branding config + application | 2.5 | ✅ Done |
| 17 | Disclaimer — platform default, agency customisation | 2.0 | ✅ Done |

**Delivered:**

- `lib/proposals/sections.ts` — all nine specification sections, split into **content** (agent writes prose, stored on the proposal) and **data** (rendered live from the lead's quote options). Reorderable, retitleable, and switchable — except required sections, which cannot be removed.
- `lib/proposals/assemble.ts` — one assembler serving the builder preview, and later the client page and the PDF, so the three cannot drift.
- `lib/proposals/branding.ts` — branding resolution, hex validation, and the disclaimer precedence chain.
- `GET /api/leads/[id]/proposal-builder` (creates the draft on first visit) and `PATCH /api/proposals/[id]/builder`.
- `SectionEditor`, `ProposalPreview`, and the builder page at `/leads/[id]/proposal-builder` — section list beside a live preview, autosaving on a debounce.
- Agency settings extended with logo, colours, footer, disclaimer, phone, email, website.

**Design decisions:**

- **The audience boundary is an allowlist, not a denylist.** `assembleProposal(..., { audience: 'client' })` builds the client payload field by field rather than deleting what must not ship. A field added later is private by default instead of leaking the moment it appears.
- **Required sections are enforced on read as well as write** — a stored layout with `quoteOptions` disabled is corrected on load, so bad data cannot produce a proposal with no options in it.
- **Disclaimer precedence: frozen → agency → platform default.** Text stored on a sent proposal always wins, so an agency editing its disclaimer never changes what an insured already signed.
- **Hex colours are validated with an anchored pattern and rejected, not sanitised.** These values are interpolated into inline styles; a permissive parser would be an injection route.
- **A locked (signed) proposal returns 409 on edit** — the immutability rule from Phase 0, enforced at the first write path that could break it.

**Bug found and fixed — carried over from Phase 2:** `toClientFacing` was stripping `differsFromOthers`, so the per-coverage comparison prose the AI drafts specifically for the insured was never reaching them. Requirement 2 lists it as client-facing content. Now included and rendered; both test suites updated to assert it ships while provenance fields stay withheld.

**Verified:** 50 builder tests (`script/verify-proposal-builder.ts`) covering the section framework, malformed stored JSON, required-section enforcement, hex/CSS-injection rejection, disclaimer precedence, and the client/agent boundary · 36 guardrail tests · 29 comparison tests · `tsc --noEmit` exit 0.

**Not yet verified:** the builder UI has not been driven in a browser.

### Phase 5 — Delivery (7 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 18 | Secure tokens — random, non-enumerable, revocable, expiring | 2.5 | ✅ Done |
| 19 | Send / Copy Link / Resend / Withdraw | 2.5 | ✅ Done |
| 20 | Proposal email template | 2.0 | ✅ Done |

**Delivered:**

- `lib/proposals/token.ts` — 256-bit base64url tokens, unrelated to any database id, with `resolveProposalToken` as the single gate applying revocation, expiry, and not-yet-sent checks. Links expire after 60 days by default.
- `lib/proposals/events.ts` — `recordProposalEvent`, best-effort and non-throwing, already recording SENT / RESENT / LINK_REVOKED. Phase 9 builds the log UI on it.
- `POST /api/proposals/[id]/send` — mints or reuses the link, freezes the disclaimer, moves status to SENT, optionally emails.
- `POST /api/proposals/[id]/revoke` — withdraws the link immediately.
- `proposalSentEmail` template, and `SendProposalPanel` in the builder.

**Design decisions:**

- **Every public read goes through one gate.** Nothing queries `publicToken` directly any more, so a future endpoint cannot accidentally skip the revocation or expiry check.
- **Re-sending reuses the existing token**, so a link already in the insured's inbox keeps working. A token is only re-minted when none exists or a withdrawn link is being reinstated — in which case the old one must stay dead.
- **The email carries no premiums, carriers, or limits.** Email is not a private channel and a forwarded message should not disclose an insured's pricing; everything sensitive stays behind the link.
- **A failed email does not lose the link.** The token is minted and persisted first; a send failure reports "the link is ready, but the email did not send" rather than a bare error.
- **A signed proposal's link cannot be withdrawn** — it is the insured's own copy of what they agreed to.
- **The disclaimer is frozen at send time**, completing the precedence chain built in Phase 4.

**Security gap found and fixed:** the pre-existing public route `GET /api/proposal/[publicToken]` predated the `tokenRevokedAt` and `expiresAt` fields and checked neither — a withdrawn or expired link would still have served the proposal. It now resolves through the same gate.

**Verified:** 28 delivery tests (`script/verify-delivery.ts`) — token collision/entropy/format, all four resolution failures against the live database, revocation reported ahead of expiry, signed proposals staying readable, email disclosure boundary, HTML escaping of injected markup · all prior suites still pass (50 + 36 + 29) · `tsc --noEmit` exit 0.

**Not yet verified:** no proposal email has been sent live, and the UI has not been browser-tested.

### Phase 6 — Insured Experience (8.5 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 21 | Public proposal presentation — no account required | 3.0 | ✅ Done |
| 22 | Mobile-responsive pass | 2.5 | ✅ Done |
| 23 | Option selection + confirmation + change before signing | 3.0 | ✅ Done |

**Critical bug found and fixed:** the public proposal page lived inside the `(main)` route group, whose layout redirects to `/login` when there is no session. **Every insured opening their link was bounced to a login screen** — the entire "no account required" premise of requirements 6 and 7 was broken, and had been since the feature was first built. The page now sits at the app root alongside `intake/public`, which was already doing this correctly. The legacy market-classification view moved with it, so that presentation became reachable too.

**Delivered:**

- `GET /api/proposal/[publicToken]` rebuilt — resolves through the token gate, records OPENED/VIEWED, and returns either the assembled client payload (`kind: 'quote'`) or the original legacy shape.
- `POST /api/proposal/[publicToken]/select` — records the insured's choice.
- `ClientProposalView` — the full presentation: agency header, recommendation, option cards with expandable coverage detail, key differences, disclaimer.
- `LegacyProposalView` extracted so older proposals keep their original presentation.

**Design decisions:**

- **Mobile-first, not mobile-tolerated.** Options render as stacked cards rather than a table, because a four-column comparison is unreadable on a phone and these links are usually opened from email. The confirmation step is a bottom sheet on small screens and a centred dialog on large.
- **Coverage detail sits inside each option card**, next to the price it belongs to, rather than in a separate section further down.
- **The token authorises the proposal, not the database.** Selection re-checks that the option belongs to this proposal's lead and agency, so a valid token cannot be used to select another lead's option.
- **Viewing never regresses a decision.** Re-opening after selecting or signing leaves the status where it is; only a `SENT` proposal advances to `VIEWED`.
- **The first selection timestamps the decision.** Changing choice before signing updates the option but preserves `selectedAt`.
- **Selecting is explicitly not signing** — stated in the confirmation dialog, and nothing is locked until a signature exists.

**Verified:** 23 insured-flow tests (`script/verify-insured-flow.ts`) — route placement outside the auth group, anonymous resolution, client payload boundary, selection, change-of-mind, status non-regression, signed proposals staying readable · all prior suites pass (28 + 50 + 36 + 29 + 24) · `tsc --noEmit` exit 0.

**Not yet verified:** no browser test of the insured page.

### Phase 7 — Electronic Signature (8.5 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 24 | Signature capture UI — typed and drawn | 3.0 | ✅ Done |
| 25 | Signature API + full audit capture | 3.0 | ✅ Done |
| 26 | Immutability — lock and freeze the signed document | 2.5 | ✅ Done |

**Open Question 2 — built as specified.** This is the specification's own V1 signature: typed or drawn, with a complete audit record. It is **not** a certified e-signature service. If the client requires DocuSign-grade certification, Phase 7 is a different build and this section should be revisited.

**Delivered:**

- `lib/proposals/signature.ts` — input validation, the stored ESIGN consent wording, device description.
- `POST /api/proposal/[publicToken]/sign` — writes the signature, freezes the document, locks the proposal, advances the lead.
- `SignaturePanel` — typed or drawn capture. The drawn pad is a pointer-event canvas so finger, stylus, and mouse share one code path, scaled by device pixel ratio so a phone signature is not exported blurred.
- Signed proposals render the signature back to the insured as their own record.

**The immutability problem, and the fix.** Data sections (options, coverages, comparison) render from the lead's *live* quote options. An agent editing a quote after signature would therefore have silently changed the document the insured agreed to — the lock alone did not prevent this, because the lock is on the proposal and the data lives elsewhere. Signing now stores `signedSnapshot`: the complete client-facing document frozen at that moment, which the public view serves in place of re-assembling. Proven by test — editing a signed quote's carrier and premium leaves the signed document untouched while the live record changes.

**Other decisions:**

- **Consent is stored verbatim, not referenced.** A signature evidences agreement to *those words*; if the wording is later revised, existing signatures must still show what was actually agreed.
- **A typed signature must match the entered legal name.** Without that rule the typed form is just a text box near a name field.
- **Drawn signatures accept only PNG/JPEG data URLs**, rejected rather than sanitised — SVG (which can carry script), HTML data URLs, remote URLs, and `javascript:` are all refused.
- **Selection is required before signing** — a signature has to attach to a specific option or there is no record of what was agreed.
- **Signing never sets the lead to BOUND.** It advances to PRESENTED at most; Insurigence does not bind coverage (requirement 13).
- **A signed proposal's link stays live** — it is the insured's own copy.

**Verified:** 38 signature tests (`script/verify-signature.ts`) — consent enforcement, identity rules, six injection attempts on the drawn signature, complete audit record, and the immutability proof above · all prior suites pass (23 + 28 + 50 + 36 + 29 + 24) · `tsc --noEmit` exit 0.

**Not yet verified:** no browser test of the signature pad; drawn-signature capture in particular is only verified by code review.

### Phase 8 — PDF Generation (8.5 h) — ✅ COMPLETE

| # | Module | Hours | Status |
|---|---|---:|---|
| 27 | Unsigned proposal PDF | 3.0 | ✅ Done |
| 28 | Signed PDF + certification page | 3.0 | ✅ Done |
| 29 | Download endpoints + archiving | 2.5 | ✅ Done |

**Open Question 3 — answered: `pdf-lib`.** Already installed, no headless-Chrome dependency, and nothing extra to provision on DigitalOcean. The cost is that pdf-lib draws at absolute coordinates with no concept of a paragraph or a page break, so a small layout engine was needed.

**Delivered:**

- `lib/proposals/pdf/layout.ts` — a flowing-document writer over pdf-lib: cursor, wrapping, pagination, tables with repeating headers, footers stamped once the page count is known.
- `lib/proposals/pdf/proposalPdf.ts` — renders an assembled proposal; adds the signature block and certification page when signed.
- `lib/proposals/pdf/generate.ts` — picks the right source, archives the signed copy to R2 when configured.
- `GET /api/proposals/[id]/pdf` (agent) and `GET /api/proposal/[publicToken]/pdf` (insured), plus download buttons in both UIs.

**Design decisions:**

- **Generated on demand, not stored as the source of truth.** The signed PDF renders from `signedSnapshot`, so rebuilding it always produces the same document. Archiving to R2 is for the agency's records — which is why **Open Question 1 no longer blocks this module**: PDFs work today, and only archiving waits on credentials.
- **Which version you get is decided by the proposal's state, not a parameter**, so an agent cannot hand out an unsigned copy of a signed document.
- **The PDF is built with the client audience**, so internal notes cannot reach a document that goes to the insured — verified by test.
- **The insured's PDF goes through the same token gate**, so a withdrawn link cannot be used to pull one.

**Two encoding hazards handled:** the standard PDF fonts use WinAnsi, which cannot represent em dashes, curly quotes, or ellipses — and pdf-lib throws on them. Our content is full of them (AI output, default section wording, the disclaimer). `toWinAnsi` maps them to ASCII equivalents and drops anything unmappable, so a stray emoji cannot abort a document mid-render. Long unbroken strings are split by character rather than overflowing the margin.

**Bug found by reading the output, not by a test:** the certification page rendered `toLocaleTimeString` in the *server's* timezone while labelling it UTC. A signature signed at 15:04:22 UTC printed as "08:34:22 PM UTC" — a false statement of fact on a legal audit document, and near midnight it would have named the wrong day. All certificate dates and times now format with `timeZone: 'UTC'` explicitly, with regression tests on both midnight edges.

**Verified:** 30 PDF tests (`script/verify-pdf.ts`) — encoding safety, wrapping, colour fallback, pagination under very long content, empty-proposal rendering, UTC timestamps, storage keys · sample PDFs written to `script/out/` and their extracted text read back to confirm content, ordering, and pagination · all prior suites pass (38 + 23 + 28 + 50 + 36 + 29 + 24) · `tsc --noEmit` exit 0.

**Not yet verified:** the PDFs have been read as text, not seen as pages — no visual check of spacing, alignment, or colour.

### Phase 9 — Tracking & Notifications (9.5 h) — ✅ COMPLETE

| # | Module | Hours | Notes |
|---|---|---:|---|
| 30 | Full lifecycle event recording | 2.5 | ✅ Done |
| 31 | E-Sign Activity log UI | 2.5 | ✅ Done |
| 32 | Agent notifications (email only) | 2.0 | ✅ Done |
| 33 | Proposal statuses + lead sync | 2.5 | ✅ Done |

**Delivered:** all 12 event types now recorded · `GET /api/proposals/[id]/activity` + `ActivityLog` timeline with the signature audit record · `proposalActivityEmail` to the creating agent and the assigned agent on first open, selection, and signature · `lib/proposals/status.ts` holding the transition and lead-sync rules.

**Decisions:** a proposal **never moves backwards** — re-opening after selecting or signing cannot undo it, enforced by ranked transitions. **Only the first open emails the agent**; re-reads are not news. A signature advances the lead to the new **`READY_TO_BIND`** status and never to `BOUND` — binding stays a human action after the carrier confirms (requirement 13). A lapsed proposal is **marked expired lazily on read**, so it stops showing as "Sent" in the agent's list. The signed-notification email states in bold that **coverage is not bound**.

### Phase 10 — Hardening & Acceptance (8.5 h) — ✅ COMPLETE

| # | Module | Hours | Notes |
|---|---|---:|---|
| 34 | Version control | 2.5 | ✅ Done |
| 35 | Security pass | 3.0 | ✅ Done |
| 36 | V1 acceptance walkthrough | 3.0 | ✅ Done |

**Module 34 — versioning.** A DRAFT is edited in place; a proposal the insured already holds a link to is **forked** into the next version rather than overwritten. The old version keeps its status, snapshot, signature, events — and its token, so the link the insured already has continues to serve exactly what they were sent. Forking is opt-in (`createVersion: true`) so the builder's autosave cannot spawn versions while someone types; the UI asks first.

**Module 35 — security pass.** 21 checks, kept as `script/verify-security.ts`: every agent route authorises and scopes by agency (14/14), no route scopes by an environment variable, all public routes go through the token gate, nothing queries `publicToken` directly, the insured page is outside the authenticated layout, and the client payload withholds agent notes, storage keys, coverage join keys, AI provenance, and market classification.

**Module 36 — acceptance.** `script/verify-acceptance.ts` runs the client's own 15 criteria as one journey — empty lead through to a downloaded 3-page signed PDF — and restores the database afterwards. **15 of 15 met.**

**Bug the acceptance run found:** empty *optional* sections were counted as send-blockers, and `/send` refuses while blockers exist. An agent who did not want an Executive Summary would have been **unable to send at all** until they wrote one or hunted down three toggles — despite those sections already rendering nothing when empty. Readiness now separates **blockers** (no options, no recommendation, unreviewed AI text) from **hints** (an empty optional section simply will not appear), and only blockers refuse a send.

---

## 4. Schedule Summary

| Phase | Modules | Hours |
|---|---|---:|
| 0 — Data Foundation | 1–2 | 5.0 |
| 1 — Quote Entry | 3–6 | 11.0 |
| 2 — AI Breakdown | 7–9 | 7.5 |
| 3 — Comparison | 10–12 | 8.0 |
| 4 — Proposal Builder | 13–17 | 12.5 |
| 5 — Delivery | 18–20 | 7.0 |
| 6 — Insured Experience | 21–23 | 8.5 |
| 7 — Electronic Signature | 24–26 | 8.5 |
| 8 — PDF Generation | 27–29 | 8.5 |
| 9 — Tracking & Notifications | 30–33 | 9.5 |
| 10 — Hardening & Acceptance | 34–36 | 8.5 |
| **Total** | **36 modules** | **95.5 h** |

At **2–3 hours per day**, this is approximately:

- **36 working days** — one module per day
- **~7 working weeks** at 5 days per week
- **~9 calendar weeks** allowing for review cycles and client feedback

---

## 5. Data Model Changes

### 5.1 `QuoteOption` — expand the existing thin `Quote`

```
id, leadId, agencyId, carrierId/name, programName, policyType/lineOfBusiness,
effectiveDate, expirationDate, annualPremium, taxes, fees, totalAnnualCost,
paymentPlan, limits, deductibles, coverages, endorsements, exclusions,
notes, uploadedDocument, quoteExpirationDate, isRecommended,
createdAt, updatedAt
```

### 5.2 `Proposal` — extend existing

```
id, leadId, agencyId, createdByUserId, publicToken, status, version,
selectedQuoteOptionId, recommendationText, clientMessage,
sentAt, viewedAt, selectedAt, signedAt, expiresAt, createdAt, updatedAt
```

### 5.3 `ProposalSignature` — new

```
id, proposalId, signerName, signerEmail, signerTitle, signatureData,
signedAt, ipAddress, userAgent, consentAccepted, proposalVersion
```

### 5.4 `ProposalActivityEvent` — new

```
id, proposalId, eventType, createdAt, metadata
```

### 5.5 Status enums

**Proposal:** `Draft, Ready to Send, Sent, Viewed, Option Selected, Signed, Expired, Revoked`

The current enum is `DRAFT, SHARED, VIEWED, ACCEPTED, DECLINED` — this needs a migration, not just an extension.

**Lead:** on proposal signed → move to *Client Approved* / *Ready to Bind*.
Insurigence must **not** automatically bind coverage.

---

## 6. AI Guardrails (Requirement 15)

**AI may assist with:** coverage explanations, quote summaries, comparison summaries, recommendation language, client-friendly descriptions.

**AI must never:** change quote terms, alter carrier limits or premiums, invent coverage, bind coverage, or make the final agent recommendation without review.

All AI-generated client-facing text must be editable by the agent before sending. Module 9 enforces this with schema validation and a review-required flag — not with prompt wording alone.

---

## 7. V1 Acceptance Criteria

The build is complete when an agent can:

- [ ] Open a Lead
- [ ] Add at least two carrier quote options
- [ ] Compare them
- [ ] Mark one as recommended
- [ ] Add/edit coverage explanations
- [ ] Generate an agency-branded proposal
- [ ] Send the insured a secure digital link
- [ ] Insured opens the proposal without an account
- [ ] Insured compares options
- [ ] Insured selects an option
- [ ] Insured electronically signs
- [ ] Agent receives confirmation
- [ ] Signed proposal and audit history are saved
- [ ] Signed PDF can be downloaded
- [ ] No other agency can access the proposal

---

## 8. Out of Scope for V1

Explicitly deferred — these must not delay V1:

- SMS proposal delivery
- Multiple signers
- Countersignature by agent
- Embedded payment collection
- Automatic binding
- Carrier API integration
- AMS export
- Custom document packets
- Required supplemental document signatures
- Quote Tracker integration
- Full client portal

---

## 9. Open Questions — Needed Before Work Starts

These change the estimate materially and should be answered before the affected module begins.

| # | Question | Blocks | Impact |
|---|---|---|---|
| 1 | Where do uploaded carrier quote documents and generated PDFs get stored? No blob storage exists today (S3 / Cloudinary / Vercel Blob / other). | M6, M29 | Adds 2–4 h for storage setup |
| 2 | Is a typed/drawn signature acceptable for V1, or does the client require a certified e-sign provider (DocuSign, Dropbox Sign)? | M24–M26 | A third-party provider changes Phase 7 substantially |
| 3 | PDF approach — `pdf-lib` (installed, low-level) or HTML→PDF via headless Chrome (better output, heavier dependency)? | M27–M28 | Affects hosting requirements |
| 4 | ~~Do agent notifications need in-app?~~ **ANSWERED: email only for MVP.** In-app deferred to a later update. Module 32 drops from 3.0 h to 2.0 h. | — | Resolved |
| 5 | Should existing market-classification `Proposal` records be migrated, or coexist with the new quote proposals? | M2 | Migration path affects Phase 0 |
| 6 | Is there an ESIGN/UETA legal review requirement, or is the consent language in requirement 9 sufficient? | M25 | Compliance review sits outside development scope |

---

## 10. Assumptions

1. Estimates cover development only. They exclude client review cycles, design sign-off, QA by others, and deployment.
2. Estimates assume the existing agency / lead / auth infrastructure stays as-is and needs no rework.
3. The existing market-classification proposal remains available; the new quote proposal is additive rather than a replacement, unless Open Question 5 is answered otherwise.
4. Any answer to the Open Questions that adds infrastructure (blob storage, e-sign provider, headless Chrome) is additional to the 95.5 h.
5. Modules are sequenced by dependency. Reordering is possible within a phase, but not across the Phase 0 foundation.
