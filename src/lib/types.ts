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

export interface DayT {
  date: string
  highlight: string | null
  checkIn: CheckIn | null
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

/* The merge delta — what Record/Paste/Manual/Timer/LLM all produce */
export interface DeltaActivity {
  goalId?: string | null
  hours: number
  start?: string | null
  end?: string | null
  label?: string | null
}

export interface MergeDelta {
  date: string
  highlight?: string
  checkIn?: CheckIn
  activities?: DeltaActivity[]
  habits?: Array<{ habitId: string; done: boolean }>
  metrics?: Array<{ metricId: string; value: number }>
  newNotes?: string[]
}

export interface MergeResult {
  counts: { activities: number; habits: number; metrics: number; notes: number; highlight: number; checkIn: number }
  skipped: string[]
}
