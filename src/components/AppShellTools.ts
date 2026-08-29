/* Shared dock/tool constants */
import type { ViewId } from '@/store/useLedger'

export const TOOL_LIST: ViewId[] = ['habits', 'screen', 'board', 'budget', 'goals', 'inbox', 'matrix', 'notes', 'people']

/* ============================================================
 * P2-6 — tool rationalization & presets (see TOOLS_AUDIT.md §3)
 *
 * The rule: if a tool adds no data another tool doesn't hold, it is a
 * LENS and ships OFF by default. Lenses: Matrix (priority view over
 * Board tasks), Budget (weekly-hours view over Goals). Screen time is
 * niche self-tracking — also OFF for new users. People is admin-gated.
 *
 * Disabling a tool NEVER deletes its data — re-enabling restores the
 * full state (hidden ≠ deleted).
 * ============================================================ */

/** Tools a non-admin must never see, even with a legacy dockConfig that
 * still lists them (the old v10 default enabled People for everyone). */
export const ADMIN_ONLY_TOOLS: string[] = ['people']

/** The lean default dock preset — what a NEW user starts with:
 * the core pipeline (capture → plan → track → remember) only. */
export const LEAN_PRESET: ViewId[] = ['habits', 'board', 'goals', 'inbox', 'notes']

/** Preset for a role — admins also get People. The DB column default is
 * role-agnostic; the signup route applies the role-aware half of it. */
export function presetFor(role: string | null | undefined): ViewId[] {
  return role === 'admin' ? [...LEAN_PRESET, 'people'] : [...LEAN_PRESET]
}

/** The tools a given role may see/toggle at all. */
export function visibleTools(role: string | null | undefined): ViewId[] {
  return role === 'admin' ? TOOL_LIST : TOOL_LIST.filter((t) => !ADMIN_ONLY_TOOLS.includes(t))
}

/** One-line copy per tool — rendered under each toggle in Settings → Tools. */
export const TOOL_HINTS: Record<string, string> = {
  habits: 'Daily check-ins with streaks and weekly targets.',
  board: 'Kanban of tasks moving To do → In progress → Done.',
  goals: 'Outcomes with weekly hour budgets, deadlines and pace.',
  inbox: 'Capture first, triage later — routes to every tool.',
  notes: 'Loose thoughts, searchable, dated automatically.',
  matrix: 'Urgent × important lens over your Board tasks. No new data.',
  budget: 'Weekly-hours lens over your Goals. No new data.',
  screen: 'Daily screen-time self-tracking with 7-day bars.',
  people: 'Household roster and admin actions. Admins only.',
}
