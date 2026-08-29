/* Shared types — the Ledger shape the client consumes (dates are YYYY-MM-DD strings) */

export type Role = 'admin' | 'member'
export type TaskStatus = 'todo' | 'doing' | 'done'

export interface LedgerUser {
  id: string
  name: string
  role: Role
}

export interface Milestone {
  label: string
  done: boolean
}

export interface TaskT {
  id: string
  goalId: string | null // null = unassigned (not tied to a goal)
  label: string
  status: TaskStatus
  priority: 'normal' | 'high'
  urgent: boolean
  important: boolean
  lastTouched: string
}

export interface GoalT {
  id: string
  name: string
  unit: string
  target: number
  deadline: string | null
  weeklyTargetHours: number
  color: string | null
  kind: 'goal' | 'hobby' // P2-2: pursuits
  milestones: Milestone[]
}

export interface HabitT {
  id: string
  name: string
  targetPerWeek: number
  color: string | null
  archived: boolean
}

export interface MetricT {
  id: string
  name: string
  direction: 'up' | 'down'
  unit: string
  dailyTarget: number | null
  monthlyTarget: number | null
}

export interface ImportantDateT {
  id: string
  label: string
  date: string
  type: string
  repeatsAnnually: boolean
}

export interface ActivityT {
  id: string
  goalId: string | null
  hours: number
  start: string | null
  end: string | null
  label: string | null
}

export interface CheckIn {
  question: string
  answer: string
}

/** P2-4: one intent for tomorrow (written the evening before). */
export interface DayPlanEntry {
  goalId: string | null
  hours: number
  note?: string
}

export interface DayT {
  date: string
  highlight: string | null
  checkIn: CheckIn | null
  plan: DayPlanEntry[] | null // P2-4: tomorrow's plan (next-morning banner)
  activities: ActivityT[]
  habits: Record<string, boolean>
  metrics: Record<string, number>
}

export interface NoteT {
  id: string
  date: string
  text: string
}

export interface InboxItemT {
  id: string
  text: string
  addedAt: string
}

export interface Ledger {
  meta: { startDate: string; updated: string }
  goals: GoalT[]
  metrics: MetricT[]
  habits: HabitT[]
  importantDates: ImportantDateT[]
  days: DayT[]
  notes: NoteT[]
  inbox: InboxItemT[]
  tasks: TaskT[] // flat since v10.5 — tasks may be goal-less
}

export interface HouseholdRow {
  name: string
  role: Role
  hoursThisWeek: number
  daysThisWeek: number
  updated: string | null
}

// v10 additions

export interface LlmSettingT {
  id: string
  userId: string | null // null = system-wide
  priority: number
  provider: string // 'gemini' | 'groq' | 'openai' | 'cerebras' | 'openrouter' | 'custom'
  model: string
  apiKey: string // returned to admin only; masked for non-admins
  baseUrl: string | null
  enabled: boolean
  createdAt: string
}

export interface DockConfigT {
  enabled: string[] // tool IDs the user has enabled (shown in More menu or dock)
  keepInDock: string[] // subset of enabled that's pinned to the dock
}

export interface AdminUserRow {
  id: string
  name: string
  role: Role
  isActive: boolean
  createdAt: string
  lastActive: string | null // most recent session createdAt
  forceLogoutAt: string | null
}

export interface AdminActionLogT {
  id: string
  actorId: string
  actorName: string
  targetId: string
  targetName: string
  action: string
  details: unknown
  createdAt: string
}

export interface UserBackupT {
  id: string
  userId: string
  userName: string
  createdBy: string
  createdByName: string
  createdAt: string
  sizeBytes: number
}

/* ---------- v11: screen time (Digital Wellbeing style) ---------- */

export interface ScreenEntryT {
  id: string
  date: string // YYYY-MM-DD
  appName: string
  category: string // social | work | entertainment | learning | health | other
  minutes: number
}

export const SCREEN_CATEGORIES = ['social', 'work', 'entertainment', 'learning', 'health', 'other'] as const
export type ScreenCategory = (typeof SCREEN_CATEGORIES)[number]

/** LLM (or heuristic) suggestion for what to record or write about. */
export interface EntryRecommendation {
  kind: 'activity' | 'habit' | 'note' | 'checkin' | 'screen'
  text: string
  /** optional prefill for the manual form */
  goalId?: string
  minutes?: number
}

/** Sanitized LLM config returned to the client — apiKey is masked. */
export interface LlmConfigClientT {
  id: string
  priority: number
  provider: string
  model: string
  apiKeyMasked: string // e.g. "sk-…ab12"
  baseUrl: string | null
  enabled: boolean
  isSystem: boolean
}

/* ---------- P3-2: LLM usage (Settings panel) ---------- */

export interface LlmUsageT {
  todayTokens: number
  limit: number
  monthByRoute: Array<{ route: string; tokens: number }>
}

/* The merge delta — what Record/Paste/Manual/Timer/LLM all produce */
export interface DeltaActivity {
  goalId?: string | null
  hours: number
  start?: string | null
  end?: string | null
  label?: string | null
  /** P2-10: idempotency key — a replayed capture upserts instead of appending. */
  clientId?: string
}

/** P2-9: a dated item extracted from capture ("deadline after exactly a week"). */
export interface DeltaDate {
  label: string
  date: string // YYYY-MM-DD, resolved against the user's timezone
  type: 'deadline' | 'birthday' | 'reminder' | 'event'
  /** P2-10: idempotency key (notes-style dedupe uses text+date matching). */
  clientId?: string
}

export interface MergeDelta {
  date: string
  highlight?: string
  checkIn?: CheckIn
  activities?: DeltaActivity[]
  habits?: Array<{ habitId: string; done: boolean }>
  metrics?: Array<{ metricId: string; value: number }>
  newNotes?: Array<string | { text: string; clientId?: string }>
  dates?: DeltaDate[] // P2-9: dated items land on their day, not today's notes
}

export interface MergeResult {
  counts: { activities: number; habits: number; metrics: number; notes: number; highlight: number; checkIn: number; dates?: number }
  skipped: string[]
}

/* ---------- P2-1: delta sync ---------- */

/** A slice of the Ledger touched by a mutation (server sends only these). */
export type LedgerPatch = {
  goals?: GoalT[]
  tasks?: TaskT[]
  habits?: HabitT[]
  metrics?: MetricT[]
  importantDates?: ImportantDateT[]
  notes?: NoteT[]
  inbox?: InboxItemT[]
  /** fully re-folded DayT rows — replace by date */
  days?: DayT[]
}

/** Entity ids removed server-side (drop them from the local ledger). */
export type LedgerDeleted = {
  goals?: string[]
  tasks?: string[]
  habits?: string[]
  metrics?: string[]
  importantDates?: string[]
  notes?: string[]
  inbox?: string[]
}

/** What every mutation responds with now: a small patch (+ cursor), or a
 * full ledger for boot/gap-fallback flows. */
export interface MutationResponse {
  cursor?: number // ChangeLog high-water mark — echo back as ?since= next poll
  patch?: LedgerPatch
  deleted?: LedgerDeleted
  ledger?: Ledger // present only on boot/full-sync fallback
}
