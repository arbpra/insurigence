# AI Build Roadmap — Insurigence

> Status: **Planning** (no code yet). This document is the agreed projection before implementation.
> Last updated: 2026-06-10

---

## Core principle (non-negotiable)

> **The rules engine decides. AI explains, summarizes, cleans up, and drafts paperwork — it never makes underwriting, quoting, or binding decisions, and every output requires agent review.**

Hard guardrails applied to every AI feature:

- AI does **not** override carrier appetite rules.
- AI does **not** invent carrier eligibility, pricing, or binding terms.
- AI does **not** issue certificates, change coverage, or make coverage determinations without agent review.
- Every AI output carries a disclaimer: *"Guidance only. Final review required by licensed agent."*
- We are **not** training a custom model — we use a hosted LLM API (OpenAI or similar).

---

## What the platform is today

Multi-tenant commercial insurance platform (Next.js + Prisma + MongoDB).

**Pipeline:** Intake Form → Submission → Lead → Evaluate (rules engine) → Carrier Fits → Quote → Proposal

- **Super-Admins** configure agencies, carriers, appetite rules, intake forms (`app/(main)/super-admin/`).
- **Agents** receive leads, evaluate them, generate proposals.
- The **deterministic rules engine** lives in `app/api/leads/[id]/evaluate/route.ts`. It scores carriers against appetite rules and outputs `STANDARD / EXCESS_SURPLUS / BORDERLINE` with confidence + reason codes.
- An empty `AiRun` model already exists in `prisma/schema.prisma` (reserved for this build). **No AI is wired up yet.**

---

## Feature list

| # | Feature | Phase | What it does | Connects to |
|---|---------|-------|--------------|-------------|
| 1 | **Smart Intake Assistant** | 1 (priority) | After intake submit → clean business description, operations summary, missing/unclear info, submission-ready risk summary | `IntakeSubmission`, runs on submit; shown on lead detail |
| 2 | **Quick Risk Guide** | 1 (priority) | Agent types a short description → likely market direction, key risk concerns, coverage considerations, NAICS guidance, next steps (**internal only**) | New card on dashboard |
| 3 | **Coverage Explanation Assistant** | 1.5 | Plain-English "why this coverage matters" for agents to use with insureds | Lead detail / proposal pages |
| 4 | **Proposal Language Assistant** | 1.5 | Turns quote + evaluation data into exec summary, "what we recommend & why", coverage explanations, option comparison narrative | `Proposal` (already has `marketSummary`, `agentRecommendation`) |
| 5 | **Policy / Document Summary** | 2 | Upload policy/quote → extract carrier, effective dates, coverages, limits, deductibles, gap opportunities | New upload feature |
| 6 | **COI Assistant** | 2 | Draft Certificate of Insurance fields; missing-info checklist; flag unusual wording; suggest endorsement review | New |
| 7 | **ACORD Form Assistant** | 2 | Populate ACORD 125 / 126 / 140 / 25 (130 later) from intake/lead/policy/quote data; suggest field mappings, flag missing fields | New |
| 8 | **ACORD from Intake** | 2 | Map structured intake data directly into ACORD fields to eliminate duplicate data entry | Builds on intake schema |

**First build priority: Features 1 + 2.** Everything else follows.

---

## 1. AI Service Architecture

Centralized — **not** AI calls scattered through the app.

```
app/api/ai/*              ← thin API routes (one per feature)
        │
        ▼
lib/ai/aiService.ts       ← the ONLY place that talks to the LLM provider
lib/ai/prompts/           ← ALL prompts, versioned (auditable)
lib/ai/schemas.ts         ← Zod schemas → force structured JSON output + validate
        │
        ▼
AiRun table               ← every call persisted for audit / history
```

**Flow rule:** the rules engine runs first; its structured output is passed *into* the AI prompt. AI only explains/summarizes what the rules engine already produced — it never recomputes eligibility or pricing.

---

## 2. Prompt Structure

Each prompt = `system role + guardrails + structured input + required JSON output shape`.

- Every prompt stored as a versioned file in `lib/ai/prompts/` (so each `AiRun` records which prompt version produced it).
- Guardrails baked into every system prompt (see Core principle above).
- Output validated against a Zod schema before saving; reject/retry on malformed JSON.

---

## 3. Database fields

`AiRun` already exists — extend it lightly:

```
AiRun (existing):
  agencyId, leadId?, purpose, model, output (Json), createdAt
Add:
  + status        (PENDING / COMPLETED / FAILED)
  + promptVersion (String)
  + inputSnapshot (Json)        ← exactly what was sent to the LLM
  + reviewedById  (ObjectId?)   ← agent who approved
  + reviewedAt    (DateTime?)
```

Phase 2 additions (store generated data separately from original intake, per client direction):

```
+ AcordDraft  (formType, leadId, fields Json, status, reviewedBy, reviewedAt, ...)
+ CoiDraft    (leadId, holderInfo, fields Json, flags Json, status, ...)
+ PolicyDocument (leadId, fileUrl, extracted Json, ...)
```

---

## 4. Page / feature connections

- **Feature 1** → fires after `app/api/intake/submit`; output shown on lead detail.
- **Feature 2** → new card on `app/(main)/dashboard`.
- **Features 3 & 4** → lead detail + `app/(main)/leads/[id]/proposal` pages.
- **Phase 2** → new ACORD/COI section; super-admin screen to manage AI settings/prompts.

Reused everywhere: a single **disclaimer + "agent review required"** component, and an **agent review/approve screen** before any export.

---

## 5. Estimated timeline

| Phase | Scope | Estimate |
|-------|-------|----------|
| **Phase 1** | Service scaffold + prompt store + `AiRun` wiring + Features 1 & 2 + UI | ~2 weeks |
| **Phase 1.5** | Features 3 & 4 | ~1.5 weeks |
| **Phase 2** | Doc upload (5) + COI (6) + ACORD (7, 8) | ~4–6 weeks |

ACORD PDF generation is the heaviest lift in Phase 2. Use deterministic validation rules wherever possible; AI only handles mapping/interpretation of ambiguous fields.

---

## Recommended build order

1. **Foundation** — `lib/ai/aiService.ts`, prompt store, extend `AiRun`, reusable disclaimer component. *Built once; every feature depends on it.*
2. **Feature 2 (Quick Risk Guide)** — simplest, no dependencies, strong demo.
3. **Feature 1 (Smart Intake Assistant)** — runs on real submission data.
4. **Features 3 + 4** — explanations + proposal language.
5. **Phase 2** — doc upload → COI → ACORD.

---

## Foundation status — COMPLETE

The shared AI layer that all 8 features build on is built and verified (type-checked, DB synced):

- **Day 1** — `lib/ai/config.ts` (model, guardrails, disclaimer, purposes), `lib/ai/client.ts` (lazy OpenAI singleton), `lib/ai/aiService.ts` (`callAI`).
- **Day 2** — `lib/ai/schemas.ts` (Zod output contracts), `lib/ai/prompts/*` (versioned prompt store), `callPrompt` with schema validation.
- **Day 3** — extended `AiRun` model (status, promptVersion, inputSnapshot, usage, error, reviewedById/At) + `lib/ai/persistence.ts` (`saveAiRun`) for full audit/history.
- **Day 4** — reusable UI: `app/components/ai/AiDisclaimer`, `AiAssistedBadge`, `AiReviewStatus`.
- **Test harness** — `app/(main)/super-admin/ai-lab` + `app/api/super-admin/ai-lab` exercise the whole chain end-to-end (Quick Risk Guide).

Pipeline: **guardrails → versioned prompt → OpenAI JSON mode → Zod validation → typed result → audit persistence → disclaimer UI.**

## Features built

- **Day 5 — Feature 2: Quick Risk Guide (agent-facing).** `app/api/ai/quick-risk-guide` (agent auth, logs run under agency) + `app/components/ai/QuickRiskGuide.tsx` collapsible widget on the agent dashboard. Uses the shared disclaimer + AI-assisted badge. Market direction shown is non-binding.
- **Day 6 — Feature 1: Smart Intake Assistant.** `app/api/ai/smart-intake/[leadId]` with GET (return saved run — page load is free) + POST (generate/regenerate, saves AiRun under lead+agency) + `app/components/ai/SmartIntakePanel.tsx` on the lead's proposal page. Outputs clean business description, operations summary, missing-info checklist, submission-ready risk summary, with disclaimer + review status.
- **Day 6.5 — Fix:** converted `app/api/leads/[id]/proposal` (GET/POST/PATCH) off the dev-only `DEV_AGENCY_ID` env crutch to session auth (`getAuthContext`) scoped by the lead's agency, consistent with the rest of the app. Unblocked the proposal page.
- **Day 7 — Feature 3: Coverage Explanation Assistant.** `app/api/ai/coverage-explanation/[leadId]` (GET saved / POST generate) + `app/components/ai/CoverageExplanationPanel.tsx` on the proposal page. Agent picks coverages from a curated list; AI explains each (why it matters / when it applies / if missing) tailored to the lead's business. AI explains relevance only — it does not decide the business needs/has a coverage.

- **Day 8 — Feature 4: Proposal Language Assistant.** `app/api/ai/proposal-language/[leadId]` (GET saved / POST generate) + `app/components/ai/ProposalLanguagePanel.tsx` on the proposal page. Generates a client-ready executive summary, "what we recommend and why", and option-comparison narrative from the rules-engine evaluation + carrier fits. Each section has a copy button. Writes only from the provided structured data — no invented carriers/pricing.

Pattern established for all features: explicit JSON shape in the prompt + tolerant schema + GET-caches/POST-generates so we don't re-pay OpenAI on page loads.

## Phase 1 COMPLETE ✅

All five initial AI features are built on the shared foundation: Smart Intake Assistant (1), Quick Risk Guide (2), Coverage Explanation Assistant (3), Proposal Language Assistant (4). (Feature numbering per brief; build order differed.)

### Phase 2 progress

- **Day 9 — Feature 5: Document Summary (extraction core).** `app/api/ai/document-summary/[leadId]` (GET saved / POST extract from pasted text) + `app/components/ai/DocumentSummaryPanel.tsx` on the proposal page. Extracts carrier, effective/expiration dates, coverage lines (limit + deductible), and flags potential gaps. Stored in AiRun for audit. **Day 10 adds binary PDF upload + text extraction** on top of this core.

- **Day 10 — Feature 5: PDF upload + parsing.** Added `unpdf`-based `lib/ai/pdf.ts` (extract text from PDF), shared `lib/ai/runDocumentSummary.ts` helper, and `app/api/ai/document-summary/[leadId]/upload` (multipart PDF → text → same extraction). The panel now has an **Upload PDF** button (10 MB cap, rejects scanned/image PDFs with no text). Verified end-to-end: PDF bytes → text → structured extraction.

- **Day 11 — Feature 6: COI Assistant.** `app/api/ai/coi/[leadId]` (GET saved / POST draft) + `app/components/ai/CoiAssistantPanel.tsx` on the proposal page. Agent enters certificate holder / project / wording + additional-insured / waiver toggles; AI drafts COI fields (pulling policy data from the latest Document Summary), a missing-info checklist, flags unusual wording, and suggests endorsement review. Draft only — never confirms coverage or issues a COI.

- **Day 12 — Features 7/8: ACORD mapping engine (deterministic core).** New `AcordDraft` model (stored separately from intake, with status + review trail + missingFields). Reusable mapping layer under `lib/acord/` (`types`, `acord125` spec+mapper, `index` registry + `buildAcordDraft`/`detectMissing`). `app/api/acord/[leadId]` GET drafts / POST generate-and-save. Mapping is fully deterministic; AI is reserved for ambiguous-field cleanup (next). Verified: full intake → no missing; sparse intake → flags the 5 missing required fields.

- **Day 13 — ACORD review/edit UI + AI description cleanup.** Generate route now reuses the lead's latest Smart Intake `cleanBusinessDescription` for Description of Operations (AI-assisted cleanup, no new prompt). `app/api/acord/[leadId]/[draftId]` GET/PATCH (save edits + approve, recomputes missingFields deterministically). `app/components/ai/AcordPanel.tsx` on the proposal page: form selector, generate, editable fields by section with missing-required highlighted, Save / Approve for Export (review trail) / Unapprove. "Generated draft. Agent review required." banner. Export PDF button stubbed.

- **Day 14 — ACORD PDF export.** `pdf-lib`-based `lib/acord/pdf.ts` generates a clean sectioned PDF of the mapped fields. `app/api/acord/[leadId]/[draftId]/pdf` GET exports it — gated to REVIEWED/EXPORTED drafts (agent approval required first), marks EXPORTED on first download. Panel's Export PDF button now active once approved. Verified: valid PDF, correct sections/labels/values, wrapped description, disclaimer footer. (Renders agency data — not the licensed ACORD-branded template; pdf-lib can fill official fillable PDFs later if the agency provides them.)

- **Day 15 — ACORD forms 126 / 140 / 25.** Extracted shared `lib/acord/util.ts` (`pick`), added specs `acord126` (GL section), `acord140` (Property section), `acord25` (Certificate of Liability), and registered all in the registry. No engine/UI/PDF/route changes needed — they all read the registry. The form selector now offers all four; each gets deterministic mapping, per-form required-field validation, agent review/edit, and PDF export. Verified all four map + validate (140 flags premisesAddress, 25 flags certificateHolder, as expected). ACORD 130 (WC) deferred per brief.

### Client add-on — Premium Indication (inside Quick Risk Guide)

- **Deterministic benchmark, AI explains only.** `lib/premium/benchmark.ts` computes an estimated **annual premium RANGE** + confidence (Low/Med/High) from structured GL facts (industry class rate × revenue, adjusted for market type / tenure / losses). Never an exact number, never a quote. Insufficient data → "Insufficient information to provide a reliable indication."
- Quick Risk Guide prompt now also parses `parsedFacts` (revenue/state/employees/etc.) from the free text; the route runs the benchmark, then `premiumExplanationPrompt` (AI) writes the plain-language reasoning. Both risk guide + premium indication saved to AiRun for audit.
- UI: Premium Indication card in the Quick Risk Guide output (range, confidence, reasoning, factors considered, factors that may change pricing, and the full mandatory disclaimer). Internal-facing; "Not a quote" labeled.
- Guardrails enforced: ranges only, no carrier-specific pricing, no binding/rating, disclaimer everywhere, rules-first.

## Phase 2 COMPLETE ✅

Features 5 (Document Summary + PDF), 6 (COI Assistant), 7/8 (ACORD generation: 125/126/140/25 with mapping, AI-assisted description, agent review/approve, PDF export). All 8 AI features from the brief are built.

## Open decisions

- [x] LLM provider: **OpenAI** (`gpt-4o-mini` default, configurable via `AI_MODEL`).
- [ ] Whether AI settings (enable/disable per feature, prompt overrides) are managed per-agency by super-admin.
