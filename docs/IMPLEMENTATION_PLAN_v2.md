# Ledger Implementation Plan v2 — living document

**Version:** v2.4 · 2026-08-29 · supersedes v2.3
**Code state:** `v10.6.0-p3a` (branch `main`) — Phases 1–3 COMPLETE (the whole plan shipped)

## 0. What changed since v1

| # | Change |
|---|--------|
| 1 | **Phase 1 complete** (P1-1…P1-6, v10.4.0-p1): auth hotfixes, AES-256-GCM keys, rate limits, headers, Vitest+CI, migration history (db push retired), transactional writes, timezone correctness, dependency diet. Runbook: `docs/PHASE1-RUNBOOK.md`. |
| 2 | **Regression incident:** user-side merge re-introduced stray files (commit `a64ec3b`): `bun.lock` (multiple-lockfiles error), unauthenticated `db-test`/`env-check` routes, 48 unused shadcn components. Fix = `scripts/03-remove-regression-files.sh` (removals are bash scripts per delivery convention). |
| 3 | **New scope adopted from user feedback** (2026-08-28): future-dated deadlines, tool rationalization with default-off, local-first snappiness, tool completion (habits delete/archive, board add/columns, budget add, goals hours, inbox routing, matrix add), speech fixes, lockfile hygiene. |
| 4 | **P2-7a + P2-8 shipped** in v10.5.0-p2a — see §3. |
| 5 | **CI green + P2-6 shipped** in v10.5.0-p2b — see §3b. CI fix: the P1-1a null-hash regression test predated the NOT NULL column and tried `passwordHash: null` through Prisma (PrismaClientValidationError); it now pins BOTH defense layers (raw-SQL NULL rejected by the DB + the route's falsy-hash 403 backstop via an empty-string hash). |
| 6 | **P2-1 delta API shipped** in v10.5.0-p2c — see §3c. Mutations now respond `{ cursor, patch, deleted }` (per-entity patches + a ChangeLog cursor) instead of re-shipping the full ledger; `GET /api/ledger?since=` replays deltas for other devices. Prerequisite for P2-10. |
| 9 | **Phase 3 complete** (v10.6.0-p3a): P3-1 weekly review, P3-2 structured LLM + cost control, P3-3 PWA offline capture, P3-4 ops hardening — see §3e. |
| 8 | **Phase 2 complete** (v10.5.0-p2d): P2-2 pursuits, P2-3 edit/delete, P2-4 close-the-day, P2-5 indexes, P2-9 future dates, P2-10 local-first — see §3d. |
| 7 | **Delivery conventions (binding):** ① every file/code REMOVAL ships as a bash script the user runs; ② Neon/DB ops ship as manual console instructions; ③ dev substrate = node + bash only; ④ schema changes ship as hand-reviewed SQL migrations applied by `migrate-safe` at Netlify build. |

## 1. Backlog — work packages

### Phase 1 — Foundation & security ✅ DONE (v10.4.0-p1)
P1-1 security hardening · P1-2 Vitest + CI · P1-3 migration history · P1-4 transactional writes · P1-5 timezone · P1-6 dead-code diet. All acceptance items green except DB suites that execute only where a postgres `DATABASE_URL` exists (CI).

### Phase 2 — Product core

| ID | Package | State | Notes |
|----|---------|-------|-------|
| P2-1 | Delta API — stop returning the full ledger from every mutation | **DONE (p2c)** | ChangeLog feed + `since` cursor; per-entity patch responses; see §3c |
| **P2-2** | **Pursuits (hobby) as `Goal.kind`** | **DONE (p2d)** | migration `5_p2_pursuits`; goals/hobbies tabs; Today hobby strip with +15/30/60 quick-log; 8-hobby cap; household counts hobby time (by design) |
| **P2-3** | **Edit/delete parity for entries & notes** | **DONE (p2d)** | PATCH/DELETE `/api/activities/[id]`, PATCH `/api/days/[date]`, PATCH `/api/notes/[id]`, important-date edit/delete; EntrySheet edit mode; Board label edit-in-place; note inline edit; `Activity.updatedAt`; shared `server/validate.ts` |
| **P2-4** | **Close-today loop** | **DONE (p2d)** | suggestions diet (scoped queries — orphan wired); Close-the-day card; Reflect tab (check-in/highlight editor); plan tomorrow via `Day.plan`; next-morning banner with one-tap log |
| **P2-5** | **Indexes & SQL aggregation** | **DONE (p2d)** | migration `7_p2_indexes` (Activity[userId,goalId,date], DayHabit[userId,habitId,date], DayMetric[userId,metricId,date]); household route = 2 queries total (was 2×N) |
| **P2-6** | **Tool rationalization + presets** (per TOOLS_AUDIT.md) | **DONE (p2b)** | lean new-user default (today, habits, board, goals, inbox, notes; +people for admins); matrix/budget/screen default OFF as lenses; presets `Lean`/`Everything`; Settings copy; zero data loss on disable |
| **P2-7** | **Tool completion & manual editing** | **DONE** | P2-7a (p2a) + task label edit landed with P2-3 (p2d) |
| **P2-8** | **Speech capture rework** | **DONE** | Android re-delivered-final dedupe (session-guarded suffix/prefix merge), transient-error auto-restart w/ backoff (network/aborted/audio-capture), permanent errors surfaced readably, session ids kill stale-restart races |
| **P2-9** | **Future-dated capture ("deadline after exactly a week")** | **DONE (p2d)** | `dates[]` in merge + LLM prompt; rule-based parser (`src/lib/date-words.ts`, 12 pure tests) works offline-LLM; StructuredPreview date rows with resolved day; Week/Month render dated items; important-date fix-in-place; §4 spec shipped |
| **P2-10** | **Local-first cache & sync (snappy)** | **DONE (p2d)** | hand-rolled IndexedDB mirror (paint-before-network boot) + durable outbox (online event, focus, 60s interval) + `clientId` idempotency on Activity/Note (migration `8_p2_local_first`); impersonation bypasses the cache; offline chip in the topbar; §6 spec shipped |

### Phase 3 — Experience & ops ✅ DONE (v10.6.0-p3a)
P3-1 weekly review view (`/api/review/week` — ONE aggregate request; dock tool `review`, new-user default via `9_p3_review_default`) · P3-2 structured LLM + token budget (`generateJson` + zod 4 native JSON Schema, `LlmCall` table via `10_p3_llm_calls`, `LLM_DAILY_TOKEN_BUDGET` default 50k, circuit breaker, 8s timeouts, usage panel) · P3-3 PWA offline (hand-rolled `sw.js` + manifest + offline fallback; capture rides the P2-10 outbox + clientIds) · P3-4 ops hardening (`/api/admin/purge` + `CRON_SECRET`, CSP enforced, `docs/backup.yml.example`, `docs/RUNBOOK.md`).

## 2. Recommended execution order

```
P2-6 (done, p2b) ──► P2-1 (done, p2c) ──► P2-10 (done, p2d) ──► P2-9 (done, p2d)
                                                                       └──► P2-4 (close-today)
P2-9 (rule-based date parsing) can start in parallel with P2-10
P2-2 after P2-6 · P2-3 anytime · P2-5 after P2-1 (shapes now settled) · P3-x unchanged
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

## 3b. Shipped in v10.5.0-p2b (CI green + P2-6) — acceptance check

- [x] CI: P1-1a null-hash test rewritten for the NOT NULL world — layer 1: `UPDATE "User" SET "passwordHash" = NULL` via `$executeRaw` must be REJECTED (pins the DB constraint); layer 2: an EMPTY hash (passes NOT NULL, falsy in JS) must hit the login route's 403 backstop — never 200
- [x] P2-6: new users (signup) get the lean preset — `enabled = habits, board, goals, inbox, notes` (+ `people` for the first/admin account); migration `3_p2_presets` mirrors the DB column default (metadata-only `SET DEFAULT`)
- [x] P2-6: Settings → Tools gains `Lean` / `Everything` preset buttons + one-line copy per toggle; section renamed from "Dock customization"
- [x] P2-6: People is admin-gated end-to-end — Settings row hidden for non-admins, dock/More-sheet hard-gated by role (covers legacy configs), and `PUT /api/settings/dock` strips `people` server-side for non-admins
- [x] P2-6: zero data loss — disabling a tool only hides it; existing users' saved dockConfig is never rewritten (old default keeps matrix/budget/screen visible for them)
- [x] Stale copy fixed: account section no longer claims "empty password = any password opens the ledger" (pre-P1 text); dock-full toast says two, not six
- [x] Tests: 3 new DB-backed pins (signup preset, member can't enable People, admin can) — run in CI alongside the full auth-flow suite
- [x] `npm run typecheck` clean · `npm run lint` clean · 17/17 pure tests · `next build` green

**Deploy notes for this drop:** `migrate-safe` auto-applies `3_p2_presets` (one metadata-only `ALTER COLUMN ... SET DEFAULT` — instant, no rewrite). No Neon console steps. No forced logouts. No user-visible change for existing accounts until they open Settings → Tools.

## 3c. Shipped in v10.5.0-p2c (P2-1 delta API) — acceptance check

- [x] **ChangeLog feed:** every ledger mutation appends per-entity rows in the SAME transaction as the write (goal/task/habit/metric/importantDate/day/activity/dayHabit/dayMetric/note/inbox; `op` upsert|delete; day-scoped rows carry `entityDate`). Migration `4_p2_delta_api` (+ `User.syncWatermark`).
- [x] **Mutations respond small patches:** all 15 mutating routes return `{ cursor, patch, deleted }` — no route re-ships the full ledger anymore. Patches contain fresh rows for touched entities (mapped by the SAME mappers as the full assembly) and re-folded DayT rows for every touched date; `deleted` lists cascaded ids (goal→tasks cascade is logged explicitly inside the transaction since the FK cascade can't self-report).
- [x] **Delta endpoint:** `GET /api/ledger?since=<cursor>` returns exactly what a device missed; falls back to a FULL ledger when the cursor is below `User.syncWatermark` (pruned/never-seen changes — e.g. long offline or a backup restore) or bogus. Boot responses (login/signup/me/reset-password) now carry the cursor.
- [x] **Client:** store `absorb()` applies patches (upsert-by-id preserves positions, days replace by date, notes/inbox re-sorted to assembly order, meta.updated refreshed) and persists the cursor; `resync()` pulls deltas on reconnect/refocus/visibility (throttled 2s). Logout/account-delete resets the cursor.
- [x] **Safety nets:** last-change-per-entity wins in the patch builder; upserts whose row vanished self-heal into deletes (e.g. inbox done); feed pruned per user (keep newest 500, watermark records the horizon); backup restore bumps the watermark forcing one full re-sync; ScreenEntry stays outside the feed (own API/state).
- [x] Tests: `tests/delta-sync.test.ts` — 8 DB-backed pins (patch-not-ledger contract, multi-device delta replay, goal cascade in `deleted`, habit toggle/delete day re-fold, merge days+notes, note/inbox lifecycle, watermark gap fallback, boot cursor). Runs in CI; self-skips without postgres.
- [x] `npm run typecheck` clean · `npm run lint` clean · 17/17 pure tests · `next build` green

**Deploy notes for this drop:** `migrate-safe` auto-applies `4_p2_delta_api` (`CREATE TABLE ChangeLog` + one `ADD COLUMN` — instant). No Neon console steps. No forced logouts; old clients keep working until refresh (they ignore `cursor/patch/deleted` extra fields and the new response shape only lands after the client bundle updates — client+server deploy together on Netlify).

## 3d. Shipped in v10.5.0-p2d (Phase 2 finale: P2-2 + P2-3 + P2-4 + P2-5 + P2-9 + P2-10) — acceptance check

- [x] **P2-2 Pursuits:** `Goal.kind` ('goal' | 'hobby', migration `5_p2_pursuits`); create hobby "Piano" → log via strip or "Log hours" → week hours count toward weeklyTargetHours; 9th hobby → friendly 400; existing users see zero change until they create a hobby (invisible default)
- [x] **P2-3 Edit/delete:** PATCH/DELETE `/api/activities/[id]` (shared validation `server/validate.ts` — same rules as capture; sets `updatedAt`, createdAt untouched); PATCH `/api/days/[date]` (highlight/checkIn clear-by-null); PATCH `/api/notes/[id]`; important-date PATCH/DELETE (wrong-date fixes); EntrySheet edit mode from Today's entry list; Board card label edit-in-place; note inline edit in Notes/Week/Month; deleting another user's activity → 404; all deletes confirm-stepped
- [x] **P2-4 Close-the-day:** `/api/suggestions` diet (was assembleLedgerRaw per call → 9 scoped queries ≈100 rows; response shape unchanged; LLM down → static fallbacks); Close-the-day card (18:00+ local or day has ≥1 activity, no check-in) with 3 suggestion chips; Reflect tab (question editable, answer, highlight — merge contract replace semantics, so "edit last night's answer" is the same UI); `Day.plan` (migration `6_p2_editing_dayplan`) written by PATCH days; planner seeds from today's most-logged goals; next-morning "Tonight you planned…" banner with one-tap "log it" (never an auto-write)
- [x] **P2-5 Indexes:** 3 composite indexes (migration `7_p2_indexes`, names match Prisma defaults — drift check stays green); household route 2N+ queries → 2 total; consistency heatmap unchanged pixel-for-pixel (pure index win)
- [x] **P2-9 Future dates:** LLM `structureDay` prompt emits `dates[]` (resolve "after exactly a week" = +7 against the user's tz; do NOT also put in newNotes); rule-based parser `date-words.ts` (top ~20 English relative patterns, intent-gated so "did laundry on monday" never captures) merged into the preview and working with NO LLM; `/api/merge` accepts `dates[]` (ISO date, ≤120-char label, type whitelist, ≤10 per delta) creating ImportantDates in the same transaction; StructuredPreview shows the resolved day per row with include/exclude; toast "saved for Fri Sep 5"; Week/Month render dated items on their days; wrong-date → fix in place from Coming up
- [x] **P2-10 Local-first:** cold boot paints from the IndexedDB mirror before the network round-trip (impersonation bypasses the cache — risk register); mirror write-through debounced in `absorb()`; failed-network mutations queue in a durable outbox (exact request body, per-user) and replay FIFO on online/focus/60s interval — responses absorb like live ones; captures stamp `clientId` ids, server upserts on (userId, clientId) instead of appending (migration `8_p2_local_first` unique indexes) — replays never double-write; 4xx rejects are dropped (retrying never helps); topbar chip "offline — N queued"; logout/deleteAccount clears the mirror
- [x] Tests: 12 pure parser tests (`tests/date-words.test.ts`, always-on) + 4 DB pins in merge suite (dates[] create + invalid skip, replay dedupe, plan persist/clear) — DB suites run in CI
- [x] `npm run typecheck` clean · `npm run lint` clean · 29/29 pure tests · `next build` green (incl. `/api/activities/[id]`, `/api/days/[date]`, `/api/important-dates/[id]`)

**Deploy notes for this drop:** `migrate-safe` auto-applies `5_p2_pursuits` + `6_p2_editing_dayplan` + `7_p2_indexes` + `8_p2_local_first` (two ADD COLUMNs, one TEXT column, three CREATE INDEX, two nullable columns + two unique indexes — all instant at solo scale, no table rewrites, no forced logouts). No Neon console steps. Existing users' dockConfig untouched; the Goals dock tool hosts both tabs (no new tool id, no preset change).

## 3e. Shipped in v10.6.0-p3a (Phase 3: P3-1 + P3-2 + P3-3 + P3-4) — acceptance check

- [x] **P3-1 Weekly review:** `GET /api/review/week?start=` (Monday-normalized server-side) returns ONE computed object — hours per pursuit vs `weeklyTargetHours` (hobbies included), habit hit-rate per habit + current streak, top-5 activity labels, note count, check-in count ("you reflected 4 of 7 nights"), screen-time category totals, and planned-vs-done from `Day.plan` (the loop's report card); renders from exactly one request (zero full-ledger fetches); `WeekReviewView` with this/last-week arrows, deep-link `?view=review&start=`, honest empty-state (no NaN on blank weeks), "copy as text" → Markdown clipboard; registered as dock tool `review` (new-user default via metadata-only migration `9_p3_review_default`; existing users one tap in Settings → Tools)
- [x] **P3-2 Structured LLM + cost control:** `generateJson<T>()` in `llm-server.ts` — provider-NATIVE structured output (OpenAI-compatible `response_format json_schema` / Gemini `responseMimeType + responseSchema`) built from the SAME zod schema that validates the reply (zod 4 `z.toJSONSchema`); graceful degradation to prompt-instructed JSON; ONE repair round on invalid output; 8s fetch timeout; circuit breaker (3 consecutive provider failures → skip 5 min); every call logs an `LlmCall` row (migration `10_p3_llm_calls`, failures included); per-user daily budget `LLM_DAILY_TOKEN_BUDGET` (default 50k) — exceeded → friendly 429 / static fallback, never a 500; suggestions + recommendations switched to the contract; `/api/llm/chat` logs route-named calls (`structure` / `extract-date` / `write-words` / `test`); Settings → LLM providers shows today-vs-budget + month-per-route usage
- [x] **P3-3 PWA offline capture:** `public/manifest.webmanifest` + `layout.tsx` meta (standalone, theme color, apple-web-app); hand-rolled ~150-line `public/sw.js` (no deps): hashed build assets cache-first, documents network-first with `/offline.html` fallback, `/api/*` NEVER cached (the store owns mutations — double-writing is worse than an error), `skipWaiting` + old-cache drop + message-hook kill-switch; registered in `AppShell` (prod only); offline CAPTURE itself rides P2-10's durable outbox + clientId idempotency (airplane-mode entries sync exactly once on reconnect)
- [x] **P3-4 Ops hardening:** `POST /api/admin/purge` guarded by `CRON_SECRET` header (expired sessions + ended impersonation sessions + stale reset tokens >7d); CSP flipped Report-Only → enforced in `next.config.ts` + `netlify.toml` (report window clean since P1); nightly `pg_dump` GitHub Action as `docs/backup.yml.example` (zips deliberately exclude `.github/**` — copy to `.github/workflows/backup.yml`, one secret `BACKUP_DATABASE_URL`); `docs/RUNBOOK.md` (key rotation, CRON rotation, restore drill into a Neon branch, purge schedule wiring, re-login announcement template, budget/alerts); `netlify.toml` serves `/sw.js` no-cache
- [x] `npm run typecheck` clean · `npm run lint` clean · 29/29 pure tests · `next build` green (incl. `/api/review/week`, `/api/admin/purge`)

**Deploy notes for this drop:** `migrate-safe` auto-applies `9_p3_review_default` (metadata-only SET DEFAULT — instant) + `10_p3_llm_calls` (`CREATE TABLE LlmCall` + index + FK — instant at solo scale). No forced logouts. Set `CRON_SECRET` in Netlify env before wiring the purge schedule (purge answers 503 without it). CSP is now ENFORCED — if a view breaks, check the console and relax the exact directive in `next.config.ts` (do not remove CSP). Existing users: Review appears in Settings → Tools; enable it in one tap. Client+server deploy together on Netlify.

## 4. P2-9 spec — future-dated capture (headline request) — SHIPPED in p2d

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

## 6. P2-10 spec — local-first (summary) — SHIPPED in p2d

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
| ~~Suggestions API stays orphaned~~ | — | — | RESOLVED p2d — wired into the Close-the-day card (fetch + chips) |
