# Ledger Implementation Plan v2 — living document

**Version:** v2 · 2026-08-28 · supersedes v1 (Phase-1 plan, 716 lines)
**Code state:** `v10.5.0-p2a` (branch `main`, commit `adf885e`)

## 0. What changed since v1

| # | Change |
|---|--------|
| 1 | **Phase 1 complete** (P1-1…P1-6, v10.4.0-p1): auth hotfixes, AES-256-GCM keys, rate limits, headers, Vitest+CI, migration history (db push retired), transactional writes, timezone correctness, dependency diet. Runbook: `docs/PHASE1-RUNBOOK.md`. |
| 2 | **Regression incident:** user-side merge re-introduced stray files (commit `a64ec3b`): `bun.lock` (multiple-lockfiles error), unauthenticated `db-test`/`env-check` routes, 48 unused shadcn components. Fix = `scripts/03-remove-regression-files.sh` (removals are bash scripts per delivery convention). |
| 3 | **New scope adopted from user feedback** (2026-08-28): future-dated deadlines, tool rationalization with default-off, local-first snappiness, tool completion (habits delete/archive, board add/columns, budget add, goals hours, inbox routing, matrix add), speech fixes, lockfile hygiene. |
| 4 | **P2-7a + P2-8 shipped** in v10.5.0-p2a (commit `adf885e`) — see §3. |
| 5 | **Delivery conventions (binding):** ① every file/code REMOVAL ships as a bash script the user runs; ② Neon/DB ops ship as manual console instructions; ③ dev substrate = node + bash only; ④ schema changes ship as hand-reviewed SQL migrations applied by `migrate-safe` at Netlify build. |

## 1. Backlog — work packages

### Phase 1 — Foundation & security ✅ DONE (v10.4.0-p1)
P1-1 security hardening · P1-2 Vitest + CI · P1-3 migration history · P1-4 transactional writes · P1-5 timezone · P1-6 dead-code diet. All acceptance items green except DB suites that execute only where a postgres `DATABASE_URL` exists (CI).

### Phase 2 — Product core

| ID | Package | State | Notes |
|----|---------|-------|-------|
| P2-1 | Delta API — stop returning the full ledger from every mutation | planned | ~25 routes respond `assembleLedgerRaw`; design: per-entity patch events + `since` cursor. Pre-req for P2-10. |
| P2-2 | Pursuits (hobby) as `Goal.kind` | planned | from v1; revisit after P2-6 lens decision |
| P2-3 | Edit/delete parity for entries & notes | planned | note editing, task label edit, activity correction |
| P2-4 | Close-today loop — wire up `suggestions` (currently orphaned) | planned | nightly review; plan tomorrow from inbox |
| P2-5 | Indexes & SQL aggregation | planned | after P2-1 shapes settle |
| **P2-6** | **Tool rationalization + presets** (per TOOLS_AUDIT.md) | **planned** | default dockConfig for new users = today, habits, board, goals, inbox, notes (+people if admin); matrix/budget/screen default OFF as lenses; presets `default`/`everything`; Settings copy; zero data loss on disable |
| **P2-7** | **Tool completion & manual editing** | **P2-7a DONE** | remaining: streak CSS on Week/Month if reused, task label edit (→P2-3) |
| **P2-8** | **Speech capture rework** | **DONE** | Android re-delivered-final dedupe (session-guarded suffix/prefix merge), transient-error auto-restart w/ backoff (network/aborted/audio-capture), permanent errors surfaced readably, session ids kill stale-restart races |
| **P2-9** | **Future-dated capture ("deadline after exactly a week")** | **planned — spec below** | the user's headline request |
| **P2-10** | **Local-first cache & sync (snappy)** | **planned** | IndexedDB mirror + optimistic writes + sync queue; pairs with P2-1 |

### Phase 3 — Experience & ops
P3-1 weekly review view · P3-2 structured LLM output + token budget · P3-3 PWA offline (hand-written SW, idempotent replay) · P3-4 ops hardening (CRON_SECRET, CSP enforce, backup runbook). P2-10 lands before P3-3 and shares its clientId replay design.

## 2. Recommended execution order

```
P2-6 (flags/presets, ~0.5d) ──► P2-1 (delta API) ──► P2-10 (local-first) ──► P2-9 (future dates)
                                                                       └──► P2-4 (close-today)
P2-9 (rule-based date parsing) can start in parallel with P2-1
P2-2 after P2-6 · P2-3 anytime · P2-5 after P2-1 · P3-x unchanged
```

Rationale: P2-6 is half a day and unblocks honest default UX; P2-1+P2-10 kill the
sluggishness (the single biggest felt complaint); P2-9 is the headline feature and is
mostly client-side until the delta API lands.

## 3. Shipped in v10.5.0-p2a (P2-7a + P2-8) — acceptance check

- [x] Habit: archive (history kept) / restore / rename / delete-with-confirm; archived section; streak badge no longer overflows (ellipsis, max-width, hover tools)
- [x] Board: add works with **zero goals** (previous `ledger.goals[0].id` crash), status picker (To do / In progress / Done) at creation, "No goal — free card"
- [x] Tasks are goal-optional end-to-end: `Task.goalId` nullable (migration `2_p2_tool_completeness`), flat `ledger.tasks` (nested copies removed), all consumers migrated (store optimistic patch, derivations, Today, recommendations, suggestions)
- [x] Matrix: manual add with quadrant + goal pickers
- [x] Budget: "Add budget item" form (creates goal w/ weekly hours); dead `void wk` removed
- [x] Goals: "Log hours" quick action (activity via merge pipeline), deadline date picker (feeds "Coming up" + behind-pace recs), delete with confirm (tasks cascade)
- [x] Inbox: → Task (free-task option), → Deadline (date picker), → Note, → Habit (7×/wk), Dismiss; navigates to the receiving tool after triage; footer documents routing
- [x] Capture sheet: error boundary (no more blank black popup — readable fallback + reload)
- [x] Speech: dedupe + restart + readable errors (see P2-8)
- [x] `npm run typecheck` clean · 17/17 pure tests pass · `next build` green incl. new `/api/habits/[id]`

**Deploy notes for this drop:** `migrate-safe` auto-applies `2_p2_tool_completeness` (two idempotent ALTERs — nullable `Task.goalId`, `Habit.archived`). No Neon console steps. No forced logouts. Users' existing dockConfig untouched (matrix/budget stay visible for existing users until P2-6 presets land).

## 4. P2-9 spec — future-dated capture (headline request)

**Story:** "I say *'I have a deadline after exactly a week'* and it shows up on that day's
Today page — not as today's note."

1. **Model:** reuse `ImportantDate {label, date, type: deadline|reminder|event|birthday}` — no new table. Goal deadlines already ride the same "Coming up" rail.
2. **Extraction (capture pipeline):** `LLM.structureDay` prompt gains a `dates[]` output block: `{label, date: YYYY-MM-DD, type}` with rules: resolve relative phrases ("after exactly a week", "next monday", "in 3 days", "on the 15th") against the **user's timezone date** (`todayIn(user.tz)` — never UTC); "exactly a week" = +7 days; include the resolved date in the preview so the user can correct it before merge.
3. **Client rule-based fallback** (works without LLM): `chrono`-style mini-parser for the top 20 English relative-date patterns; runs on the Record/Paste text before the LLM call, merged into the delta preview.
4. **Delta plumbing:** `MergeDelta.dates[]` accepted by `/api/merge` (validated: ISO date, ≤120-char label, type whitelist); `StructuredPreview` renders date rows with include/exclude.
5. **Rendering:** TodayView "Coming up" already lists importantDates — extend WeekView/MonthView to render dated items on their days; add an "Upcoming (7 days)" strip to Today.
6. **Verification UX:** after capture, toast `"Saved for Fri Sep 4 ✓"` with the parsed date; wrong-date edits route through P2-3 (important-date edit/delete endpoints — currently create-only, flagged in the audit).
7. **Acceptance:** saying/typing "deadline after exactly a week" yields an item on the correct day's Today + Week + Month views, in the user's timezone, with no duplicate on today's page; works offline-LLM via the rule-based parser.

## 5. P2-6 spec — rationalization & presets (summary; details in TOOLS_AUDIT.md)

- New-user default enabled set: `today, habits, board, goals, inbox, notes` (+`people` for admins); `matrix`, `budget`, `screen` **default OFF** (lenses / niche).
- Signup applies the `default` preset; Settings → Tools gains preset buttons (`Lean` / `Everything`) + one-line copy per toggle; disabling never deletes data.
- Later (separate mini-package): fold Budget into GoalsView as a "Weekly budget" section and retire the standalone view.

## 6. P2-10 spec — local-first (summary)

- **Read path:** boot serves from an IndexedDB mirror (Dexie or hand-rolled, no new heavy deps) → instant paint; background `GET /api/ledger` reconciles.
- **Write path:** every mutation = optimistic local write + enqueue in a durable outbox (`clientId` + monotonic seq) → POST when online; server responses replace the mirror. Conflicts: last-write-wins per entity id (single-user app; admin impersonation excluded from cache).
- **Feels-snappy budget:** interaction → visual feedback < 16ms; habit toggle not waiting on network (already optimistic — extend pattern to tasks/goals/notes/inbox).
- **Acceptance:** airplane-mode toggles/creates/deletes queue and replay on reconnect; cold boot paints from cache in < 100ms; no duplicate side effects on replay (clientId idempotency key on /api/merge).

## 7. Risk register (delta)

| Risk | L | I | Mitigation |
|------|---|---|------------|
| Flat-task ledger shape breaks old clients mid-deploy | L | M | client+server deploy together (single Netlify build); old clients re-fetch on next boot |
| `2_p2_tool_completeness` migration on huge Task table | L | L | two metadata-only ALTERs; Postgres 11+ fast nullable change |
| Speech dedupe merges a legitimately repeated phrase | M | L | merge applies only on first-final-after-restart window; worst case one repeated word collapses |
| Local-first cache staleness after admin impersonation | M | M | cache keyed per userId; impersonation bypasses/skips cache |
| Suggestions API stays orphaned | — | — | wired in P2-4 (tracked) |
