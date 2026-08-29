'use client'
/* The store — one ledger, everything derives from it. Mutations are optimistic,
 * then reconciled with the server's fresh ledger response (DB is truth). */

import { create } from 'zustand'
import type {
  HouseholdRow,
  Ledger,
  LedgerDeleted,
  LedgerPatch,
  LedgerUser,
  MergeResult,
  LlmConfigClientT,
  DockConfigT,
  AdminUserRow,
  AdminActionLogT,
  UserBackupT,
  ScreenEntryT,
  EntryRecommendation,
  MutationResponse,
  DayPlanEntry,
  LlmUsageT,
} from '@/lib/types'
import { clientTz, todayStr } from '@/lib/dates'
import {
  lastUserId, rememberUserId, loadMirror, saveMirror, clearMirror,
  enqueue, outboxAll, outboxCount, outboxDelete, outboxBumpAttempts, clientId as newClientId,
  type OutboxEntry,
} from '@/lib/local'

export type ViewId =
  | 'today' | 'week' | 'month' | 'review' | 'habits' | 'board' | 'budget'
  | 'goals' | 'inbox' | 'matrix' | 'notes' | 'people' | 'screen'

export type EntryTab = 'record' | 'paste' | 'manual' | 'timer' | 'focus' | 'reflect'
export type Theme = 'light' | 'dark' | 'sage' | 'clay' | 'slate'

interface ToastMsg { msg: string; at: number }

interface LedgerStore {
  booted: boolean
  user: LedgerUser | null
  /** v10: when set, this session is an admin impersonating the user with this id. */
  impersonatedBy: string | null
  ledger: Ledger | null
  /** P2-1: ChangeLog cursor of the last server response this device applied. */
  syncCursor: number
  /** P2-10: queued offline mutations waiting to replay. */
  pending: number
  view: ViewId
  toast: ToastMsg | null
  entryOpen: boolean
  entryTab: EntryTab
  /** P2-3: the activity being corrected (opens the sheet in edit mode). */
  activityEdit: { id: string; date: string } | null
  /** P2-4: suggestion chip that opened the Reflect tab. */
  reflectPrefill: string | null
  moreOpen: boolean
  focusOpen: boolean
  settingsOpen: boolean
  /** v10: admin panel open state */
  adminOpen: boolean
  household: HouseholdRow[] | null
  /** v10: per-user dock config from DB (enabled + keepInDock). */
  dockConfig: DockConfigT | null
  /** v10: legacy localStorage-based dock (still used as a quick toggle, syncs to DB). */
  dockOptional: ViewId[]
  theme: Theme

  // v10: admin state
  adminUsers: AdminUserRow[] | null
  adminActions: AdminActionLogT[] | null
  adminBackups: UserBackupT[] | null

  setDockOptional: (tools: ViewId[]) => void
  setTheme: (t: Theme) => void

  boot: () => Promise<void>
  login: (name: string, password: string) => Promise<string | null>
  signup: (name: string, password: string) => Promise<string | null>
  setupStatus: () => Promise<{ initialized: boolean; userCount: number; error?: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  showToast: (msg: string) => void

  /** P2-1: apply a server response (full ledger or patch+cursor) to the store. */
  absorb: (data: MutationResponse) => void
  /** P2-1: pull everything missed since the stored cursor (reconnect/wake). */
  resync: () => Promise<void>
  /** P3-1: one aggregate request for the weekly review view. */
  fetchReview: (start: string) => Promise<Record<string, unknown> | null>

  setView: (v: ViewId) => void
  openEntry: (tab: EntryTab) => void
  setEntryTab: (tab: EntryTab) => void
  /** P2-3: open the entry sheet in activity-edit mode. */
  openActivityEdit: (id: string, date: string) => void
  /** P2-4: open the Reflect tab (optionally prefilled from a suggestion chip). */
  openReflect: (question?: string | null) => void
  closeSheets: () => void
  setMoreOpen: (open: boolean) => void
  setFocusOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setAdminOpen: (open: boolean) => void

  mergeDeltas: (deltas: object[]) => Promise<{ results: MergeResult[] } | { error: string }>
  toggleHabit: (habitId: string, date?: string) => Promise<void>
  addNote: (text: string, date?: string) => Promise<string | null>
  deleteNote: (id: string) => Promise<void>
  /** P2-3: fix a typo'd note. */
  editNote: (id: string, text: string) => Promise<void>
  /** P2-3: correct the record — edit / delete an activity. */
  patchActivity: (id: string, patch: { hours?: number; start?: string | null; end?: string | null; label?: string | null; goalId?: string | null; date?: string }) => Promise<boolean>
  removeActivity: (id: string) => Promise<void>
  /** P2-4: save tomorrow's plan (a suggestion, never an auto-write). */
  saveDayPlan: (date: string, plan: DayPlanEntry[] | null) => Promise<boolean>
  /** P2-10: replay queued offline mutations (online event / interval). */
  drainOutbox: () => Promise<void>
  addTask: (goalId: string | null, label: string, priority?: 'normal' | 'high', opts?: { status?: 'todo' | 'doing' | 'done'; urgent?: boolean; important?: boolean }) => Promise<void>
  updateTask: (id: string, patch: Record<string, unknown>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  updateGoal: (id: string, patch: Record<string, unknown>) => Promise<void>
  deleteGoal: (id: string) => Promise<void>
  logGoalHours: (goalId: string, hours: number, date?: string) => Promise<boolean>
  addInboxItem: (text: string) => Promise<void>
  deleteInboxItem: (id: string) => Promise<void>
  inboxToTask: (id: string, goalId: string | null) => Promise<void>
  inboxToNote: (id: string) => Promise<void>
  inboxToHabit: (id: string) => Promise<void>
  inboxToDeadline: (id: string, date: string) => Promise<void>
  addImportantDate: (label: string, date: string, type: string) => Promise<boolean>
  /** P2-3: fix a wrong date in place (Coming up rows). */
  updateImportantDate: (id: string, patch: { label?: string; date?: string; type?: string }) => Promise<void>
  deleteImportantDate: (id: string) => Promise<void>
  addGoal: (name: string, opts?: { target?: number; unit?: string; weeklyTargetHours?: number; kind?: 'goal' | 'hobby' }) => Promise<boolean>
  addHabit: (name: string, targetPerWeek?: number) => Promise<boolean>
  updateHabit: (id: string, patch: { name?: string; targetPerWeek?: number; archived?: boolean }) => Promise<void>
  deleteHabit: (id: string) => Promise<void>
  userAction: (name: string, action: string) => Promise<void>
  setPassword: (pw: string) => Promise<string | null>
  deleteAccount: () => Promise<string | null>
  fetchHousehold: () => Promise<void>

  // v10 additions
  fetchDockConfig: () => Promise<void>
  saveDockConfig: (config: DockConfigT) => Promise<string | null>
  fetchLlmSettings: () => Promise<{ settings: LlmConfigClientT[]; usage?: LlmUsageT } | null>
  saveLlmSetting: (params: {
    provider: string
    model: string
    apiKey: string
    baseUrl?: string | null
  }) => Promise<string | null>
  deleteLlmSetting: (id: string) => Promise<string | null>
  testLlm: () => Promise<string | null>
  fetchSuggestions: () => Promise<string[] | null>
  fetchEntryRecommendations: () => Promise<EntryRecommendation[] | null>

  // v11: screen time (Digital Wellbeing style)
  screenEntries: ScreenEntryT[] | null
  fetchScreenEntries: (startDate?: string, endDate?: string) => Promise<void>
  saveScreenEntries: (date: string, items: Array<{ appName: string; category?: string; minutes: number }>) => Promise<string | null>
  deleteScreenEntry: (id: string) => Promise<string | null>

  // v10 admin actions
  fetchAdminUsers: () => Promise<void>
  adminUserAction: (targetId: string, action: string) => Promise<string | null>
  adminDeleteUser: (targetId: string) => Promise<string | null>
  adminBackupUser: (targetId: string) => Promise<string | null>
  adminBackupAll: () => Promise<string | null>
  adminRestoreBackup: (backupId: string) => Promise<string | null>
  fetchAdminBackups: () => Promise<void>
  adminLoginAs: (targetId: string) => Promise<string | null>
  // v10.1
  switchBack: () => Promise<string | null>
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    })
    const data = (await r.json().catch(() => ({}))) as T & { error?: string }
    if (!r.ok) return { ok: false, error: data?.error ?? `HTTP ${r.status}` }
    return { ok: true, data }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'network error'
    /* P2-10: an OFFLINE mutation is not a failed mutation — queue the exact
     * request and replay it on reconnect. Boot/auth/tz calls never queue
     * (they are session-level, and a replayed login would be surprising).
     * Replays are idempotent: captures carry clientIds, the server upserts. */
    const method = (init?.method ?? 'GET').toUpperCase()
    const queueable = method !== 'GET' && !url.startsWith('/api/auth/') && url !== '/api/account/tz'
    if (isNetworkError(error) && queueable && typeof window !== 'undefined') {
      const { useLedger } = await import('@/store/useLedger')
      const uid = useLedger.getState().user?.id ?? null
      if (uid) {
        await enqueue({
          url,
          method,
          body: typeof init?.body === 'string' ? init.body : null,
          createdAt: Date.now(),
          userId: uid,
        })
        useLedger.setState({ pending: await outboxCount() })
        useLedger.getState().showToast('Offline — entry queued, it will sync on reconnect')
      }
    }
    return { ok: false, error }
  }
}

const DOCK_KEY = 'ledger_dock'
const THEME_KEY = 'ledger_theme'
const CURSOR_KEY = 'ledger_sync_cursor'
const VALID_TOOLS: ViewId[] = ['habits', 'board', 'budget', 'goals', 'inbox', 'matrix', 'notes', 'people', 'screen']
const VALID_THEMES: Theme[] = ['light', 'dark', 'sage', 'clay', 'slate']

/* ---------- P2-10: mirror write-through + outbox drain ---------- */

let mirrorTimer: ReturnType<typeof setTimeout> | null = null
/** Debounced mirror write — absorb() can fire many times per second. */
function scheduleMirrorSave(userId: string, ledger: Ledger): void {
  if (mirrorTimer) clearTimeout(mirrorTimer)
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null
    void saveMirror(userId, ledger)
  }, 250)
}

function isNetworkError(msg: string): boolean {
  return /network error|failed to fetch|networkerror|load failed|timeout/i.test(msg)
}

/* ---------- P2-1: delta sync helpers ---------- */

function loadCursor(): number {
  try { return Math.max(0, Math.trunc(Number(localStorage.getItem(CURSOR_KEY))) || 0) } catch { return 0 }
}
function saveCursor(n: number): void {
  try { localStorage.setItem(CURSOR_KEY, String(n)) } catch { /* ignore */ }
}
function clearCursor(): void {
  try { localStorage.removeItem(CURSOR_KEY) } catch { /* ignore */ }
}

function upsertById<T extends { id: string }>(list: T[], items: T[]): T[] {
  if (!items.length) return list
  const map = new Map(list.map((x) => [x.id, x]))
  for (const item of items) map.set(item.id, item) // updated rows keep their position; new ones append
  return Array.from(map.values())
}

function removeIds<T extends { id: string }>(list: T[], ids: string[] | undefined): T[] {
  if (!ids || ids.length === 0) return list
  const gone = new Set(ids)
  return list.filter((x) => !gone.has(x.id))
}

/** Merge a server patch into the local ledger (pure — DB stays truth). */
function mergePatch(led: Ledger, patch: LedgerPatch | undefined, deleted: LedgerDeleted | undefined): Ledger {
  const next: Ledger = { ...led }
  if (patch?.goals) next.goals = upsertById(next.goals, patch.goals)
  if (patch?.tasks) next.tasks = upsertById(next.tasks, patch.tasks)
  if (patch?.habits) next.habits = upsertById(next.habits, patch.habits)
  if (patch?.metrics) next.metrics = upsertById(next.metrics, patch.metrics)
  if (patch?.importantDates) next.importantDates = upsertById(next.importantDates, patch.importantDates)
  // keep the assembly's ordering: notes by date, inbox by addedAt desc
  if (patch?.notes) next.notes = upsertById(next.notes, patch.notes).sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1))
  if (patch?.inbox) next.inbox = upsertById(next.inbox, patch.inbox).sort((a, b) => (a.addedAt === b.addedAt ? 0 : a.addedAt > b.addedAt ? -1 : 1))
  if (patch?.days) {
    // server sends fully re-folded DayT rows — replace by date
    const map = new Map(next.days.map((d) => [d.date, d]))
    for (const d of patch.days) map.set(d.date, d)
    next.days = Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1))
  }
  next.goals = removeIds(next.goals, deleted?.goals)
  next.tasks = removeIds(next.tasks, deleted?.tasks)
  next.habits = removeIds(next.habits, deleted?.habits)
  next.metrics = removeIds(next.metrics, deleted?.metrics)
  next.importantDates = removeIds(next.importantDates, deleted?.importantDates)
  next.notes = removeIds(next.notes, deleted?.notes)
  next.inbox = removeIds(next.inbox, deleted?.inbox)
  next.meta = { ...next.meta, updated: todayStr() }
  return next
}

let lastResyncAt = 0

function loadDock(): ViewId[] {
  try {
    const d = JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null') as ViewId[] | null
    if (Array.isArray(d)) return d.filter((x) => VALID_TOOLS.includes(x)).slice(0, 2)
  } catch { /* ignore */ }
  return ['habits']
}

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY) as Theme | null
    if (t && VALID_THEMES.includes(t)) return t
  } catch { /* ignore */ }
  return 'light'
}

/** True when a tool is enabled for the current user (default: enabled —
 *  until the DB-backed dock config has loaded). Views use this to hide a
 *  disabled tool's sections everywhere, not just in the More sheet. */
export function useToolEnabled(tool: ViewId): boolean {
  const dockConfig = useLedger((s) => s.dockConfig)
  return !dockConfig?.enabled || dockConfig.enabled.includes(tool)
}

export const useLedger = create<LedgerStore>((set, get) => ({
  booted: false,
  user: null,
  impersonatedBy: null,
  ledger: null,
  syncCursor: typeof window === 'undefined' ? 0 : loadCursor(),
  pending: 0,
  view: 'today',
  toast: null,
  entryOpen: false,
  entryTab: 'record',
  activityEdit: null,
  reflectPrefill: null,
  moreOpen: false,
  focusOpen: false,
  settingsOpen: false,
  adminOpen: false,
  household: null,
  dockConfig: null,
  dockOptional: typeof window === 'undefined' ? ['habits'] : loadDock(),
  theme: typeof window === 'undefined' ? 'light' : loadTheme(),
  adminUsers: null,
  adminActions: null,
  adminBackups: null,
  screenEntries: null,

  setDockOptional(tools) {
    const capped = tools.slice(0, 2)
    try { localStorage.setItem(DOCK_KEY, JSON.stringify(capped)) } catch { /* ignore */ }
    set({ dockOptional: capped })
    // v10: also sync to DB
    void get().saveDockConfig({
      enabled: capped,
      keepInDock: capped,
    })
  },
  setTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
    if (theme === 'light') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  async boot() {
    /* P2-10: paint the cached ledger BEFORE the network round-trip —
     * instant views on cold boot; /api/auth/me reconciles right after.
     * Impersonation bypasses the cache entirely (risk register). */
    const lastUser = lastUserId()
    if (lastUser && !get().ledger && !get().user) {
      const cached = await loadMirror<Ledger>(lastUser)
      if (cached && cached.days && cached.goals) set({ ledger: cached })
    }
    const r = await api<{ user: LedgerUser; ledger: Ledger; impersonatedBy?: string | null; cursor?: number }>('/api/auth/me')
    if (r.ok) {
      set({
        user: r.data.user,
        ledger: r.data.ledger,
        impersonatedBy: r.data.impersonatedBy ?? null,
      })
      // P2-1: adopt the server's change-feed cursor for future delta syncs
      get().absorb({ cursor: r.data.cursor })
      // P2-10: mirror the fresh snapshot + remember whose book this is
      rememberUserId(r.data.user.id)
      if (!r.data.impersonatedBy) void saveMirror(r.data.user.id, r.data.ledger)
      // v10: fetch dock config from DB
      void get().fetchDockConfig()
      // P1-5: keep the server's copy of this device's timezone current
      void api('/api/account/tz', { method: 'POST', body: JSON.stringify({ tz: clientTz() }) })
    }
    set({ booted: true })
    // P2-10: surface anything queued from a previous offline session
    set({ pending: await outboxCount() })
    void get().drainOutbox()
  },

  async login(name, password) {
    const r = await api<{ user: LedgerUser; ledger: Ledger; cursor?: number }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, password, tz: clientTz() }),
    })
    if (!r.ok) return r.error
    set({ user: r.data.user, ledger: r.data.ledger, view: 'today', household: null })
    rememberUserId(r.data.user.id)
    void saveMirror(r.data.user.id, r.data.ledger)
    get().absorb({ cursor: r.data.cursor })
    /* v11 fix: the dock/tool config must load on login too — previously only
     * boot() fetched it, so a fresh SPA login left dockConfig null and every
     * tool behaved as enabled (tool on/off in Settings appeared broken). */
    void get().fetchDockConfig()
    return null
  },
  async signup(name, password) {
    const r = await api<{ user: LedgerUser; ledger: Ledger; cursor?: number }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, password, tz: clientTz() }),
    })
    if (!r.ok) return r.error
    set({ user: r.data.user, ledger: r.data.ledger, view: 'today', household: null })
    rememberUserId(r.data.user.id)
    void saveMirror(r.data.user.id, r.data.ledger)
    get().absorb({ cursor: r.data.cursor })
    void get().fetchDockConfig()
    return null
  },

  async setupStatus() {
    const r = await api<{ initialized: boolean; userCount: number; error?: string }>('/api/auth/setup-status')
    if (!r.ok) return { initialized: false, userCount: 0, error: r.error }
    return r.data
  },


  async logout() {
    const uid = get().user?.id
    await api('/api/auth/logout', { method: 'POST' })
    clearCursor()
    if (uid) void clearMirror(uid)
    rememberUserId(null)
    set({
      user: null,
      ledger: null,
      syncCursor: 0,
      pending: 0,
      view: 'today',
      household: null,
      entryOpen: false,
      moreOpen: false,
      settingsOpen: false,
      focusOpen: false,
      adminOpen: false,
      impersonatedBy: null,
      dockConfig: null,
      adminUsers: null,
      adminActions: null,
      adminBackups: null,
    })
  },

  async refresh() {
    if (!get().user) return
    const r = await api<MutationResponse>('/api/ledger')
    if (r.ok) get().absorb(r.data)
  },

  showToast(msg) {
    set({ toast: { msg, at: Date.now() } })
  },

  /** P2-1: apply a server response — full ledger (boot/gap) or patch+cursor. */
  absorb(data) {
    if (typeof data.cursor === 'number' && Number.isFinite(data.cursor)) {
      set({ syncCursor: data.cursor })
      saveCursor(data.cursor)
    }
    const user = get().user
    const impersonating = !!get().impersonatedBy
    const persist = (led: Ledger) => {
      // P2-10: write-through to the IndexedDB mirror (impersonation excluded)
      if (user && !impersonating) scheduleMirrorSave(user.id, led)
    }
    if (data.ledger) {
      set({ ledger: data.ledger })
      persist(data.ledger)
      return
    }
    const led = get().ledger
    if (!led) return
    if (!data.patch && !data.deleted) {
      persist(led) // cursor-only adopt — refresh the snapshot age anyway
      return
    }
    const next = mergePatch(led, data.patch, data.deleted)
    set({ ledger: next })
    persist(next)
  },

  /** P3-1: one aggregate request for the weekly review view. */
  async fetchReview(start) {
    const r = await api<Record<string, unknown>>(`/api/review/week?start=${encodeURIComponent(start)}`)
    return r.ok ? r.data : null
  },

  /** P2-1: pull everything the device missed since its cursor (reconnect, wake). */
  async resync() {
    if (!get().user) return
    const now = Date.now()
    if (now - lastResyncAt < 2000) return
    lastResyncAt = now
    const r = await api<MutationResponse>(`/api/ledger?since=${get().syncCursor}`)
    if (r.ok) get().absorb(r.data)
  },

  setView(view) { set({ view, moreOpen: false }) },
  openEntry(tab) { set({ entryOpen: true, entryTab: tab, moreOpen: false, activityEdit: null, reflectPrefill: null }) },
  setEntryTab(entryTab) { set({ entryTab }) },
  openActivityEdit(id, date) { set({ entryOpen: true, moreOpen: false, activityEdit: { id, date }, reflectPrefill: null }) },
  openReflect(question) { set({ entryOpen: true, moreOpen: false, entryTab: 'reflect', activityEdit: null, reflectPrefill: question ?? null }) },
  closeSheets() { set({ entryOpen: false, moreOpen: false, activityEdit: null, reflectPrefill: null }) },
  setMoreOpen(moreOpen) { set({ moreOpen }) },
  setFocusOpen(focusOpen) { set({ focusOpen }) },
  setSettingsOpen(settingsOpen) { set({ settingsOpen }) },
  setAdminOpen(adminOpen) { set({ adminOpen }) },

  async mergeDeltas(deltas) {
    /* P2-10: stamp every capture with idempotency keys so a replayed
     * offline delta upserts instead of appending duplicates. */
    const stamped = deltas.map((d0) => {
      const d = d0 as Record<string, unknown>
      const acts = Array.isArray(d.activities)
        ? (d.activities as Array<Record<string, unknown>>).map((a) => ({ ...a, clientId: a.clientId ?? newClientId('act') }))
        : d.activities
      const notes = Array.isArray(d.newNotes)
        ? (d.newNotes as Array<string | { text?: string; clientId?: string }>).map((n) =>
            typeof n === 'string' ? { text: n, clientId: newClientId('note') } : { ...n, clientId: n.clientId ?? newClientId('note') })
        : d.newNotes
      const dates = Array.isArray(d.dates)
        ? (d.dates as Array<Record<string, unknown>>).map((x) => ({ ...x, clientId: x.clientId ?? newClientId('date') }))
        : d.dates
      return { ...d, activities: acts, newNotes: notes, dates }
    })
    const r = await api<MutationResponse & { results: MergeResult[] }>('/api/merge', {
      method: 'POST',
      body: JSON.stringify(stamped.length === 1 ? stamped[0] : stamped),
    })
    if (!r.ok) return { error: r.error }
    get().absorb(r.data)
    return { results: r.data.results }
  },

  async toggleHabit(habitId, date) {
    /* optimistic */
    const led = get().ledger
    if (led) {
      const dateStr = date ?? new Date().toISOString().slice(0, 10)
      const day = led.days.find((d) => d.date === dateStr)
      if (day) day.habits[habitId] = !day.habits[habitId]
      set({ ledger: { ...led, days: [...led.days] } })
    }
    const r = await api<MutationResponse>('/api/habits/toggle', {
      method: 'POST',
      body: JSON.stringify({ habitId, date }),
    })
    if (r.ok) get().absorb(r.data)
  },

  async addNote(text, date) {
    const r = await api<MutationResponse & { noteId: string }>('/api/notes', {
      method: 'POST',
      // P2-10: idempotency key — a replayed offline note never duplicates
      body: JSON.stringify({ text, date, clientId: newClientId('note') }),
    })
    if (!r.ok) { get().showToast(r.error); return null }
    get().absorb(r.data)
    return r.data.noteId
  },

  async deleteNote(id) {
    const r = await api<MutationResponse>(`/api/notes/${id}`, { method: 'DELETE' })
    if (r.ok) get().absorb(r.data)
  },

  /** P2-3: fix a typo'd note — optimistic text swap, then the patch lands. */
  async editNote(id, text) {
    const led = get().ledger
    if (led) {
      const notes = led.notes.map((n) => (n.id === id ? { ...n, text } : n))
      set({ ledger: { ...led, notes } })
    }
    const r = await api<MutationResponse>(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    })
    if (r.ok) get().absorb(r.data)
    else get().showToast(r.error)
  },

  /** P2-3: correct the record — hours/times/label/goal/date, same rules as
   * capture (the server re-derives and re-folds the affected days). */
  async patchActivity(id, patch) {
    const led = get().ledger
    /* optimistic — every aggregate derives from the store, so views shift
     * immediately (edit 3.5h → 1.5h moves month totals by −2h instantly) */
    if (led) {
      const days = led.days.map((day) => {
        const idx = day.activities.findIndex((a) => a.id === id)
        if (idx === -1) return day
        const activities = [...day.activities]
        activities[idx] = {
          ...activities[idx],
          ...(patch.hours !== undefined ? { hours: patch.hours } : {}),
          ...(patch.start !== undefined ? { start: patch.start } : {}),
          ...(patch.end !== undefined ? { end: patch.end } : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.goalId !== undefined ? { goalId: patch.goalId } : {}),
        }
        return { ...day, activities }
      })
      set({ ledger: { ...led, days } })
    }
    const r = await api<MutationResponse>(`/api/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (r.ok) {
      get().absorb(r.data) // re-folded days replace the optimistic guess
      return true
    }
    get().showToast(r.error)
    await get().refresh()
    return false
  },

  async removeActivity(id) {
    const led = get().ledger
    if (led) {
      const days = led.days.map((day) =>
        day.activities.some((a) => a.id === id) ? { ...day, activities: day.activities.filter((a) => a.id !== id) } : day,
      )
      set({ ledger: { ...led, days } })
    }
    const r = await api<MutationResponse>(`/api/activities/${id}`, { method: 'DELETE' })
    if (r.ok) get().absorb(r.data)
    else get().showToast(r.error)
  },

  /** P2-4: write tomorrow's intents (PATCH /api/days/[date]) — the planner
   * is a suggestion: logging them tomorrow stays a one-tap decision. */
  async saveDayPlan(date, plan) {
    const led = get().ledger
    /* optimistic */
    if (led) {
      const days = led.days.map((day) => (day.date === date ? { ...day, plan } : day))
      set({ ledger: { ...led, days } })
    }
    const r = await api<MutationResponse>(`/api/days/${date}`, {
      method: 'PATCH',
      body: JSON.stringify({ plan }),
    })
    if (r.ok) {
      get().absorb(r.data)
      return true
    }
    get().showToast(r.error)
    return false
  },

  /** P2-10: replay queued offline mutations, FIFO. Responses carry patches,
   * so replay application is identical to live application. */
  async drainOutbox() {
    if (!get().user || typeof navigator === 'undefined' || !navigator.onLine) return
    const uid = get().user!.id
    const entries = await outboxAll()
    let changed = false
    for (const e of entries) {
      if (e.userId !== uid) continue // another account's queue stays put
      try {
        const r = await fetch(e.url, {
          method: e.method,
          headers: { 'Content-Type': 'application/json' },
          body: e.body,
          cache: 'no-store',
        })
        if (r.ok) {
          const data = (await r.json().catch(() => ({}))) as MutationResponse
          get().absorb(data)
          await outboxDelete(e.seq)
          changed = true
        } else if (r.status >= 400 && r.status < 500) {
          // the server understood and refused — retrying never helps
          await outboxDelete(e.seq)
          changed = true
          get().showToast('A queued entry was rejected by the server and dropped.')
        } else {
          const attempts = e.attempts + 1
          await outboxBumpAttempts(e.seq, attempts)
          if (attempts >= 5) get().showToast('1 entry needs attention — it will keep retrying.')
          break // stop the drain on the first server-side hiccup
        }
      } catch {
        break // still offline — try again on the next wake
      }
    }
    if (changed) set({ pending: await outboxCount() })
  },

  async addTask(goalId, label, priority = 'normal', opts) {
    const r = await api<MutationResponse>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ goalId, label, priority, ...opts }),
    })
    if (!r.ok) { get().showToast(r.error); return }
    get().absorb(r.data)
  },

  async updateTask(id, patch) {
    /* optimistic — v10.5: tasks live flat on the ledger */
    const led = get().ledger
    if (led) {
      const changed = led.tasks.some((t) => t.id === id)
      if (changed) {
        const tasks = led.tasks.map((t) =>
          t.id === id ? ({ ...t, ...patch, lastTouched: new Date().toISOString().slice(0, 10) } as typeof t) : t,
        )
        set({ ledger: { ...led, tasks } })
      }
    }
    const r = await api<MutationResponse>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (r.ok) get().absorb(r.data)
  },

  async deleteTask(id) {
    const r = await api<MutationResponse>(`/api/tasks/${id}`, { method: 'DELETE' })
    if (r.ok) get().absorb(r.data)
  },

  async updateGoal(id, patch) {
    /* optimistic */
    const led = get().ledger
    if (led) {
      const goals = led.goals.map((g) => (g.id === id ? { ...g, ...patch } as typeof g : g))
      set({ ledger: { ...led, goals } })
    }
    const r = await api<MutationResponse>(`/api/goals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (r.ok) get().absorb(r.data)
    else await get().refresh()
  },

  async addInboxItem(text) {
    const r = await api<MutationResponse>('/api/inbox', {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    if (!r.ok) { get().showToast(r.error); return }
    get().absorb(r.data)
  },

  async deleteInboxItem(id) {
    const r = await api<MutationResponse>(`/api/inbox/${id}`, { method: 'DELETE' })
    if (r.ok) get().absorb(r.data)
  },

  async inboxToTask(id, goalId) {
    const led = get().ledger
    const item = led?.inbox.find((i) => i.id === id)
    if (!item) return
    const created = await api<MutationResponse>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ goalId, label: item.text, priority: 'normal' }),
    })
    if (!created.ok) { get().showToast(created.error); return }
    await get().deleteInboxItem(id)
    get().showToast(goalId ? 'Task created from inbox ✓' : 'Unassigned task created ✓')
    if (goalId) get().setView('board')
  },

  async inboxToNote(id) {
    const led = get().ledger
    const item = led?.inbox.find((i) => i.id === id)
    if (!item) return
    const added = await get().addNote(item.text)
    if (added) {
      await get().deleteInboxItem(id)
      get().showToast('Filed as a note ✓')
      get().setView('notes')
    }
  },

  /** v10.5: turn a captured thought into a daily habit (7x/week default). */
  async inboxToHabit(id) {
    const led = get().ledger
    const item = led?.inbox.find((i) => i.id === id)
    if (!item) return
    const ok = await get().addHabit(item.text, 7)
    if (ok) {
      await get().deleteInboxItem(id)
      get().showToast('Habit created — tweak its target in Habits ✓')
      get().setView('habits')
    }
  },

  /** v10.5: turn a captured thought into a dated deadline ("Coming up"). */
  async inboxToDeadline(id, date) {
    const led = get().ledger
    const item = led?.inbox.find((i) => i.id === id)
    if (!item) return
    const ok = await get().addImportantDate(item.text, date, 'deadline')
    if (ok) {
      await get().deleteInboxItem(id)
      get().showToast(`Deadline set for ${date} ✓`)
      get().setView('today')
    }
  },

  async addImportantDate(label, date, type) {
    const r = await api<MutationResponse>('/api/important-dates', {
      method: 'POST',
      body: JSON.stringify({ label, date, type }),
    })
    if (!r.ok) { get().showToast(r.error); return false }
    get().absorb(r.data)
    return true
  },

  /** P2-3: the wrong date the LLM parsed can now be fixed in place. */
  async updateImportantDate(id, patch) {
    const led = get().ledger
    if (led) {
      const importantDates = led.importantDates.map((d) => (d.id === id ? { ...d, ...patch } : d))
      set({ ledger: { ...led, importantDates } })
    }
    const r = await api<MutationResponse>(`/api/important-dates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (r.ok) get().absorb(r.data)
    else get().showToast(r.error)
  },

  async deleteImportantDate(id) {
    const r = await api<MutationResponse>(`/api/important-dates/${id}`, { method: 'DELETE' })
    if (r.ok) get().absorb(r.data)
    else get().showToast(r.error)
  },

  /** v11: create a goal — or a hobby (P2-2); fresh accounts start with none. */
  async addGoal(name, opts) {
    const r = await api<MutationResponse>('/api/goals', {
      method: 'POST',
      body: JSON.stringify({ name, ...opts }),
    })
    if (!r.ok) { get().showToast(r.error); return false }
    get().absorb(r.data)
    return true
  },

  /** v10.5: delete a goal (its tasks cascade server-side). */
  async deleteGoal(id) {
    const r = await api<MutationResponse>(`/api/goals/${id}`, { method: 'DELETE' })
    if (!r.ok) { get().showToast(r.error); return }
    get().absorb(r.data)
    get().showToast('Goal removed ✓')
  },

  /** v10.5: quick-log hours against a goal (creates an activity via merge). */
  async logGoalHours(goalId, hours, date) {
    if (!(hours > 0 && hours <= 24)) { get().showToast('Hours must be between 0 and 24.'); return false }
    const res = await get().mergeDeltas([{ date: date ?? todayStr(), activities: [{ goalId, hours }] }])
    if ('error' in res) { get().showToast(res.error); return false }
    get().showToast(`Logged ${hours}h ✓`)
    return true
  },

  /** v11: create a habit. */
  async addHabit(name, targetPerWeek) {
    const r = await api<MutationResponse>('/api/habits', {
      method: 'POST',
      body: JSON.stringify({ name, targetPerWeek }),
    })
    if (!r.ok) { get().showToast(r.error); return false }
    get().absorb(r.data)
    return true
  },

  /** v10.5: rename / retarget / archive a habit. */
  async updateHabit(id, patch) {
    /* optimistic for the archive toggle */
    const led = get().ledger
    if (led && patch.archived !== undefined) {
      const habits = led.habits.map((h) => (h.id === id ? { ...h, ...patch } : h))
      set({ ledger: { ...led, habits } })
    }
    const r = await api<MutationResponse>(`/api/habits/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (r.ok) get().absorb(r.data)
    else get().showToast(r.error)
  },

  /** v10.5: permanently delete a habit and its check history. */
  async deleteHabit(id) {
    const r = await api<MutationResponse>(`/api/habits/${id}`, { method: 'DELETE' })
    if (!r.ok) { get().showToast(r.error); return }
    get().absorb(r.data)
    get().showToast('Habit deleted ✓')
  },

  async userAction(name, action) {
    const r = await api<MutationResponse>(`/api/users/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    })
    if (!r.ok) { get().showToast(r.error); return }
    get().absorb(r.data)
    await get().fetchHousehold()
  },

  async setPassword(pw) {
    const r = await api<{ ok: boolean }>('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({ password: pw }),
    })
    return r.ok ? null : r.error
  },

  /** v11: remove the signed-in account and all of its data, then sign out. */
  async deleteAccount() {
    const uid = get().user?.id
    const r = await api<{ ok: boolean }>('/api/account/delete', { method: 'POST' })
    if (!r.ok) return r.error
    clearCursor()
    if (uid) void clearMirror(uid)
    rememberUserId(null)
    set({
      user: null,
      ledger: null,
      syncCursor: 0,
      pending: 0,
      view: 'today',
      household: null,
      entryOpen: false,
      moreOpen: false,
      settingsOpen: false,
      focusOpen: false,
      adminOpen: false,
      impersonatedBy: null,
      dockConfig: null,
      adminUsers: null,
      adminActions: null,
      adminBackups: null,
      screenEntries: null,
    })
    return null
  },

  async fetchHousehold() {
    const r = await api<{ household: HouseholdRow[] }>('/api/household')
    if (r.ok) set({ household: r.data.household })
  },

  // ---------- v10 additions ----------

  async fetchDockConfig() {
    const r = await api<{ config: DockConfigT }>('/api/settings/dock')
    if (r.ok) {
      // keepInDock arrives as JSON (string[]) — narrow to the first two ViewIds
      set({ dockConfig: r.data.config, dockOptional: r.data.config.keepInDock.slice(0, 2) as ViewId[] })
    }
  },

  async saveDockConfig(config) {
    const r = await api<{ config: DockConfigT }>('/api/settings/dock', {
      method: 'PUT',
      body: JSON.stringify(config),
    })
    if (!r.ok) return r.error
    set({ dockConfig: r.data.config, dockOptional: r.data.config.keepInDock.slice(0, 2) as ViewId[] })
    return null
  },

  async fetchLlmSettings() {
    // Try user settings first; if empty, fall back to system settings (admin sees both)
    const r = await api<{ settings: LlmConfigClientT[]; usage?: LlmUsageT }>('/api/settings/llm/me')
    if (r.ok) return { settings: r.data.settings, usage: r.data.usage }
    return null
  },

  async saveLlmSetting(params) {
    const r = await api<{ setting: LlmConfigClientT }>('/api/settings/llm/me', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return r.ok ? null : r.error
  },

  async deleteLlmSetting(id) {
    const r = await api(`/api/settings/llm/me?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    return r.ok ? null : r.error
  },

  async testLlm() {
    const r = await api<{ ok: boolean; ms: number }>('/api/settings/llm', { method: 'PUT' })
    return r.ok ? null : r.error
  },

  async fetchSuggestions() {
    const r = await api<{ questions: string[] }>('/api/suggestions')
    if (r.ok) return r.data.questions
    return null
  },

  /** v11: LLM-powered ideas for what to record or write about (Add sheet). */
  async fetchEntryRecommendations() {
    const r = await api<{ recommendations: EntryRecommendation[] }>('/api/recommendations')
    if (r.ok) return r.data.recommendations
    return null
  },

  // ---------- v11: screen time ----------

  async fetchScreenEntries(startDate, endDate) {
    const params = new URLSearchParams()
    if (startDate) params.set('from', startDate)
    if (endDate) params.set('to', endDate)
    const qs = params.toString()
    const r = await api<{ entries: ScreenEntryT[] }>(`/api/screentime${qs ? `?${qs}` : ''}`)
    if (r.ok) set({ screenEntries: r.data.entries })
  },

  async saveScreenEntries(date, items) {
    const r = await api<{ entries: ScreenEntryT[] }>('/api/screentime', {
      method: 'POST',
      body: JSON.stringify({ date, items }),
    })
    if (!r.ok) return r.error
    set({ screenEntries: r.data.entries })
    return null
  },

  async deleteScreenEntry(id) {
    const r = await api(`/api/screentime?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) return r.error
    const cur = get().screenEntries
    if (cur) set({ screenEntries: cur.filter((e) => e.id !== id) })
    return null
  },

  // ---------- v10 admin ----------

  async fetchAdminUsers() {
    const r = await api<{
      users: AdminUserRow[]
      adminCount: number
      userCount: number
      recentActions: AdminActionLogT[]
    }>('/api/admin/users')
    if (r.ok) {
      set({ adminUsers: r.data.users, adminActions: r.data.recentActions })
    }
  },

  async adminUserAction(targetId, action) {
    const r = await api<{ ok?: boolean; resetUrl?: string; expiresAt?: string }>(
      `/api/admin/users/${encodeURIComponent(targetId)}`,
      { method: 'POST', body: JSON.stringify({ action }) },
    )
    if (!r.ok) return r.error
    // Refresh admin user list
    await get().fetchAdminUsers()
    // If a reset URL was returned, surface it via toast (or return it)
    if (r.data.resetUrl) {
      get().showToast(`Reset link generated: ${r.data.resetUrl}`)
    }
    return null
  },

  async adminDeleteUser(targetId) {
    const r = await api(`/api/admin/users/${encodeURIComponent(targetId)}`, { method: 'DELETE' })
    if (!r.ok) return r.error
    await get().fetchAdminUsers()
    return null
  },

  async adminBackupUser(targetId) {
    const r = await api<{ ok: boolean; backupId: string; createdAt: string; sizeBytes: number }>(
      `/api/admin/users/${encodeURIComponent(targetId)}`,
      { method: 'POST', body: JSON.stringify({ action: 'backup' }) },
    )
    if (!r.ok) return r.error
    get().showToast('Backup created ✓')
    await get().fetchAdminUsers()
    return null
  },

  async adminBackupAll() {
    const r = await api<{ backups: UserBackupT[] }>('/api/admin/backup', {
      method: 'POST', body: JSON.stringify({ action: 'backup_all' }),
    })
    if (!r.ok) return r.error
    set({ adminBackups: r.data.backups })
    get().showToast(`Backed up ${r.data.backups.length} users ✓`)
    return null
  },

  async adminRestoreBackup(backupId) {
    const r = await api<{ ok: boolean; restoredUserId: string }>('/api/admin/backup/restore', {
      method: 'POST', body: JSON.stringify({ backupId }),
    })
    if (!r.ok) return r.error
    get().showToast('Restore complete ✓')
    await get().fetchAdminBackups()
    return null
  },

  async fetchAdminBackups() {
    const r = await api<{ backups: UserBackupT[] }>('/api/admin/backup')
    if (r.ok) set({ adminBackups: r.data.backups })
  },

  async adminLoginAs(targetId) {
    const r = await api<{ ok: boolean; user: LedgerUser }>('/api/auth/login-as', {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    })
    if (!r.ok) return r.error
    // Reload the session — the response cookie has been set
    await get().boot()
    set({ adminOpen: false, view: 'today' })
    get().showToast(`Logged in as ${r.data.user.name}`)
    return null
  },

  // v10.1: switch back to admin account after impersonation
  async switchBack() {
    const r = await api<{ ok: boolean; user: LedgerUser }>('/api/auth/switch-back', {
      method: 'POST',
    })
    if (!r.ok) return r.error
    // Reload the session — the response cookie has been set with the admin's new session
    await get().boot()
    get().showToast(`Switched back to ${r.data.user.name}`)
    return null
  },
}))
