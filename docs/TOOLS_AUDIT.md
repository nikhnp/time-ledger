# Ledger Tools Audit — what each tool owes you, what overlaps, what ships off by default

**Version:** 1.1 · 2026-08-29 · feeds IMPLEMENTATION_PLAN_v2 (P2-6, P2-7) — post-P3 status: notes edit ✓ (P2-3), review wired ✓ (P3-1), Budget fold-into-Goals still optional, habit color picker UI + reminders still owed (P3 polish)
**Method:** market research on what each tool category is expected to do (Zapier's habit-tracker review, Atlassian/Todoist kanban guides, GTD's five steps, Eisenhower-me/Asana matrix practice, NerdWallet/Equifax budgeting essentials, Strides/OKR goal trackers), combined with a code-level audit of Ledger v10.4.0-p1 (file:line references in the Phase-2 map) and your reported pain points.

---

## 1. The core idea: one capture, one routing table, many lenses

The tools should not be nine separate silos. They should be **one pipeline** with different
views on the same ledger:

```
                 ┌──────────────────────────────────────────────────────┐
 capture ───────►│ INBOX (triage)                                       │
 (voice/text/    │  → Task ──► BOARD (status: todo/doing/done)          │
  manual/add     │  → Task ──► MATRIX (urgent×important lens on tasks)  │
  button)        │  → Deadline ► TODAY "Coming up" (important-dates)    │
                 │  → Habit ──► HABITS (streaks, weekly target)         │
                 │  → Note ───► NOTES                                   │
                 └──────────────────────────────────────────────────────┘
                        │                                   ▲
                        ▼                                   │
                 GOALS (outcomes, hours) ◄── BUDGET (weekly hours lens on goals)
                        │
                        ▼
                 TODAY / WEEK / MONTH (roll-ups) + REVIEW (P2-4/P3-1)
```

Shipped in v10.5.0-p2a (this session): inbox got the missing routes (→ Deadline, → Habit),
and converting now navigates you to the tool that received the item, so the pipeline is
**felt**, not just structural.

---

## 2. Tool-by-tool: expected vs. actual, verdict

Legend: **Verdict** = what we do with it in P2-6. "Lens" = the tool becomes a view over
another tool's data instead of an independent silo. "Default off" = hidden for new users,
one toggle in Settings → Tools to bring it back (your explicit ask).

### 2.1 Habits — KEEP, default ON
- **What the market expects** (Zapier "best habit trackers" 2025, Streaks, Habitify class): one-tap daily check, streaks, weekly/monthly targets, history heatmap, **delete AND archive**, reminders, notes.
- **Actual (before this batch):** add + toggle only — habits were literally immortal; no delete, no archive, no rename; streak badge overflowed its row on narrow screens.
- **Shipped v10.5.0-p2a:** archive (history kept, hidden), permanent delete with confirm (wipes DayHabit rows), inline rename, per-row tools that appear on hover/focus; streak badge now truncates with ellipsis (`habit-streak-badge` max-width + overflow fix); archived section with restore.
- **Still owed:** reminders/notifications (P3-4 territory), per-habit color picker (field exists, no UI — trivial add later).

### 2.2 Board (kanban) — KEEP, default ON
- **What the market expects** (Atlassian kanban guide, Todoist boards): cards, **To do / In progress / Done columns**, **create into a chosen column**, drag between columns, WIP awareness, delete/edit.
- **Actual (before):** add row existed but **crashed with zero goals** (`ledger.goals[0].id` TypeError — why "I cannot add anything to the board"), no status choice at creation, tight input row.
- **Shipped:** column picker at creation (To do / In progress / Done), "No goal — free card" option, crash fixed, goal optional end-to-end (schema → API → UI), footer no longer lies about goals.
- **Still owed:** card edit-in-place (label/priority), WIP limit hint (nice-to-have, P3).

### 2.3 Matrix (Eisenhower) — KEEP as a LENS, default OFF
- **What the market expects** (eisenhower.me, Asana, Focus Matrix): four quadrants, drag between quadrants, add manually, quadrant = priority attributes on tasks, **not a second task store**.
- **Actual (before):** no add at all ("I cannot add anything to the matrix manually"), fed only by existing tasks — a read-only lens that *felt* like a broken silo.
- **Shipped:** manual add with quadrant + goal pickers; drag/cycle/done already worked.
- **Verdict:** it adds no data the Board doesn't hold — every matrix item IS a task. It's a **priority lens over Board data**. Ship it **default OFF for new users** (Settings → Tools → Matrix), because two task surfaces confuse triage; power users re-enable in one tap. No code is deleted; nothing is lost.

### 2.4 Budget — KEEP as a LENS over Goals, default OFF (fold into Goals later)
- **What the market expects** (NerdWallet/Equifax essentials): an **Add** affordance, categories, editable targets, over/under feedback.
- **Actual (before):** read-only bars; the only edit was clicking the tiny inline target number; **no add button at all**; duplicated Goals' weekly-target editing with none of its context.
- **Shipped:** "Add a budget item" form (name + h/week) — a budget item is a goal with a weekly time target, so it lands in Goals too and shows up on Today; empty states.
- **Verdict:** 100% overlap with Goals (it renders `weeklyTargetHours` vs logged hours). Keep as a lens, **default OFF**; in P2-6 consider merging it into GoalsView as a "Weekly budget" section and retiring the standalone view.

### 2.5 Goals — KEEP, default ON (the spine)
- **What the market expects** (Strides, OKR apps): outcome + measurable target, **manual progress/hours logging**, milestones, deadline, pace feedback.
- **Actual (before):** progress was display-only (hours only arrived via the capture sheet); the model's `deadline`/`color` fields were unreachable from any UI — so the "Coming up" goal-deadline logic could never fire; no delete.
- **Shipped:** "Log hours" quick action per goal (creates an activity via the merge pipeline — same source of truth as everything else), deadline date picker per goal (now feeds "Coming up" and the behind-pace recommendation), goal delete with confirm (tasks cascade).
- **Still owed:** milestone reorder, color picker (P3 polish).

### 2.6 Inbox — KEEP, default ON (the router)
- **What the market expects** (GTD: capture → clarify → organize → reflect → engage): frictionless capture, and triage that **routes** each item somewhere real; an inbox that can't route is just a second pile.
- **Actual (before):** could only make a task (goal required) or a note — no deadline, no habit, no free task, no navigation after triage; server's mark-done endpoint orphaned. This is why it "felt entirely unconnected".
- **Shipped:** → Task (with "No goal" option), → **Deadline** (date picker → "Coming up" on Today), → Note, → **Habit** (7×/week default), Dismiss; every successful triage **navigates to the receiving tool**; footer documents the routing table.
- **Shipped (P2-4, p2d):** the close-the-day loop is live — suggestions feed the Reflect tab, tomorrow gets planned, and the weekly review (P3-1) reports planned-vs-done.

### 2.7 Notes — KEEP, default ON
- **Expected:** create, search, delete, edit; date extraction.
- **Actual:** search + delete + LLM date-extraction exist; **no edit**; manual add lives on Today only.
- **Shipped (P2-3, p2d):** inline note editing (pencil on every row). Manual date entry as an LLM-down fallback stays optional — the rule-based date parser (P2-9) now covers capture without the LLM. Verdict: keep default ON.

### 2.8 Screen time — KEEP, default OFF (new accounts)
- **Expected:** quick manual entry, daily reference ring, weekly bars (Digital Wellbeing style).
- **Actual:** the most complete tool after Today — add, delete, replace-on-same-day, 7-day bars. No complaints on record.
- **Verdict:** functionally fine, but it's a niche self-tracking surface; **default OFF for new users** so the first-run dock is: Today, Habits, Board, Goals, Inbox, Notes. Existing users keep whatever they have enabled — no behavior change.

### 2.9 People — KEEP, admin-gated
- **Expected:** household member list, admin actions (grant/revoke, force logout).
- **Actual:** exactly that; resetpw removed deliberately in P1 (security).
- **Verdict:** keep, but P2-6 should hide it from non-admins entirely rather than showing a read-only table. Default ON for admins only.

### 2.10 Fixed views — Today / Week / Month
Not toggleable; they're the roll-up surfaces. **Owed:** Week/Month should render deadlines and future-dated items (P2-9), not just logged activities.

---

## 3. Duplicates & the default-off policy (your rule, applied)

> "If there are multiple that do the same but add no extra features, disable them by
> default (users can turn it on later)."

| Pair | Overlap | Extra features the second one adds | Decision |
|---|---|---|---|
| Matrix vs Board | Same task objects | Quadrant prioritization | Matrix = lens, **default OFF** |
| Budget vs Goals | Same goal objects, same weekly-target edit | Weekly hours bars | Budget = lens, **default OFF**; candidate for merge into Goals |
| Inbox vs Notes | Both hold text | Inbox is a routing queue with triage actions | Both stay ON — different jobs |
| Habits vs Goals | Both track ongoing effort | Habits = recurring/daily, Goals = cumulative outcome | Both stay ON — different jobs |
| `suggestions` vs `recommendations` APIs | Both LLM helpers | suggestions = reflection questions (close-the-day), recommendations = entry prefills | Both stay; **suggestions gets wired up in P2-4** (currently orphaned) |

**Mechanism:** Ledger already has a DB-backed per-user tool toggle (`User.dockConfig`,
Settings → Tools, `useToolEnabled` gating). P2-6 extends it with:
1. **Presets** — `Lean` (the lean set above), `Everything` (all tools), as buttons in Settings → Tools; the lean set is applied automatically at signup.
2. **Default dockConfig for new users:** enabled = `habits, board, goals, inbox, notes` (+ `people` if admin); matrix/budget/screen start disabled — DB column default via migration `3_p2_presets`, role-aware half via the signup route.
3. Settings → Tools copy that explains each toggle in one line (and marks the lenses).
4. **People is admin-gated end-to-end:** hidden from non-admin Settings, hard-gated in the dock/More sheet, and stripped server-side in `PUT /api/settings/dock`.
5. **Zero data loss when disabled:** hidden ≠ deleted; re-enabling restores full state.

**Shipped in v10.5.0-p2b** — all five points above are live; see IMPLEMENTATION_PLAN_v2.md §3b.

---

## 4. What "expected of such tools" is still missing overall

1. **Future-dated anything** (P2-9): "deadline after exactly a week" must land on that
   day's Today page. Model already exists (`ImportantDate` + goal deadlines); the capture
   pipeline needs to emit dated items and Week/Month need to render them.
2. **Snappiness** (P2-10): every mutation currently re-downloads the entire ledger —
   local-first cache (IndexedDB) + optimistic writes + delta responses.
3. **Speech that behaves** (P2-8 — shipped this session): Android re-delivery dedupe,
   transient-error auto-restart, readable errors.
4. **Close-the-day loop** (P2-4): suggestions wired into a nightly review; tomorrow gets
   planned from the inbox.
5. ~~**Edit affordances** (P2-3)~~ — SHIPPED p2d: note editing, Board card label edit-in-place, activity correction (edit + delete), important-date fix-in-place. Append-only is over.

---

## 5. Sources (research layer)

- Kanban column/card/WIP practice: Atlassian "What is a kanban board?", Todoist kanban guide, MeisterTask (2025–26)
- GTD five steps (capture/clarify/organize/reflect/engage): gettingthingsdone.com, Todoist GTD guide
- Habit tracker expectations (streaks, targets, archive/delete, heatmaps): Zapier "5 best habit tracker apps" (2025), abitbox.app & abi.app habit tracker roundups (2026)
- Budgeting app must-haves (add expense, categories, over/under): NerdWallet best budget apps (2026), Equifax budgeting guide
- Goal tracking (milestones, pace, hours): Strides (SMART + pace), beyondtime.ai OKR comparison (2026)
- Eisenhower matrix practice: eisenhower.me official app, Asana priority matrix guide
- Local-first/sync patterns: LogRocket "Offline-first frontend apps in 2025", RxDB local-first guide, Smashing Magazine local-first architecture (2026)
- Web Speech API behaviors: MDN SpeechRecognition, Chrome platform notes (continuous/auto-end), documented Android final-re-delivery behavior
