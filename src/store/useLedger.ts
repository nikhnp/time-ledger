'use client'
/* The store — one ledger, everything derives from it. Mutations are optimistic,
 * then reconciled with the server's fresh ledger response (DB is truth). */

import { create } from 'zustand'
import type {
  HouseholdRow,
  Ledger,
  LedgerUser,
  MergeResult,
  LlmConfigClientT,
  DockConfigT,
  AdminUserRow,
  AdminActionLogT,
  UserBackupT,
  ScreenEntryT,
  EntryRecommendation,
} from '@/lib/types'
import { clientTz } from '@/lib/dates'

export type ViewId =
  | 'today' | 'week' | 'month' | 'habits' | 'board' | 'budget'
  | 'goals' | 'inbox' | 'matrix' | 'notes' | 'people' | 'screen'

export type EntryTab = 'record' | 'paste' | 'manual' | 'timer' | 'focus'
export type Theme = 'light' | 'dark' | 'sage' | 'clay' | 'slate'

interface ToastMsg { msg: string; at: number }

interface LedgerStore {
  booted: boolean
  user: LedgerUser | null
  /** v10: when set, this session is an admin impersonating the user with this id. */
  impersonatedBy: string | null
  ledger: Ledger | null
  view: ViewId
  toast: ToastMsg | null
  entryOpen: boolean
  entryTab: EntryTab
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

  setView: (v: ViewId) => void
  openEntry: (tab: EntryTab) => void
  setEntryTab: (tab: EntryTab) => void
  closeSheets: () => void
  setMoreOpen: (open: boolean) => void
  setFocusOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setAdminOpen: (open: boolean) => void

  mergeDeltas: (deltas: object[]) => Promise<{ results: MergeResult[] } | { error: string }>
  toggleHabit: (habitId: string, date?: string) => Promise<void>
  addNote: (text: string, date?: string) => Promise<string | null>
  deleteNote: (id: string) => Promise<void>
  addTask: (goalId: string, label: string, priority?: 'normal' | 'high') => Promise<void>
  updateTask: (id: string, patch: Record<string, unknown>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  updateGoal: (id: string, patch: Record<string, unknown>) => Promise<void>
  addInboxItem: (text: string) => Promise<void>
  deleteInboxItem: (id: string) => Promise<void>
  inboxToTask: (id: string, goalId: string) => Promise<void>
  inboxToNote: (id: string) => Promise<void>
  addImportantDate: (label: string, date: string, type: string) => Promise<boolean>
  addGoal: (name: string, opts?: { target?: number; unit?: string; weeklyTargetHours?: number }) => Promise<boolean>
  addHabit: (name: string, targetPerWeek?: number) => Promise<boolean>
  userAction: (name: string, action: string) => Promise<void>
  setPassword: (pw: string) => Promise<string | null>
  deleteAccount: () => Promise<string | null>
  fetchHousehold: () => Promise<void>

  // v10 additions
  fetchDockConfig: () => Promise<void>
  saveDockConfig: (config: DockConfigT) => Promise<string | null>
  fetchLlmSettings: () => Promise<LlmConfigClientT[] | null>
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
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

const DOCK_KEY = 'ledger_dock'
const THEME_KEY = 'ledger_theme'
const VALID_TOOLS: ViewId[] = ['habits', 'board', 'budget', 'goals', 'inbox', 'matrix', 'notes', 'people', 'screen']
const VALID_THEMES: Theme[] = ['light', 'dark', 'sage', 'clay', 'slate']

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
  view: 'today',
  toast: null,
  entryOpen: false,
  entryTab: 'record',
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
    const r = await api<{ user: LedgerUser; ledger: Ledger; impersonatedBy?: string | null }>('/api/auth/me')
    if (r.ok) {
      set({
        user: r.data.user,
        ledger: r.data.ledger,
        impersonatedBy: r.data.impersonatedBy ?? null,
      })
      // v10: fetch dock config from DB
      void get().fetchDockConfig()
      // P1-5: keep the server's copy of this device's timezone current
      void api('/api/account/tz', { method: 'POST', body: JSON.stringify({ tz: clientTz() }) })
    }
    set({ booted: true })
  },

  async login(name, password) {
    const r = await api<{ user: LedgerUser; ledger: Ledger }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, password, tz: clientTz() }),
    })
    if (!r.ok) return r.error
    set({ user: r.data.user, ledger: r.data.ledger, view: 'today', household: null })
    /* v11 fix: the dock/tool config must load on login too — previously only
     * boot() fetched it, so a fresh SPA login left dockConfig null and every
     * tool behaved as enabled (tool on/off in Settings appeared broken). */
    void get().fetchDockConfig()
    return null
  },
  async signup(name, password) {
    const r = await api<{ user: LedgerUser; ledger: Ledger }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, password, tz: clientTz() }),
    })
    if (!r.ok) return r.error
    set({ user: r.data.user, ledger: r.data.ledger, view: 'today', household: null })
    void get().fetchDockConfig()
    return null
  },

  async setupStatus() {
    const r = await api<{ initialized: boolean; userCount: number; error?: string }>('/api/auth/setup-status')
    if (!r.ok) return { initialized: false, userCount: 0, error: r.error }
    return r.data
  },


  async logout() {
    await api('/api/auth/logout', { method: 'POST' })
    set({
      user: null,
      ledger: null,
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
    const r = await api<{ ledger: Ledger }>('/api/ledger')
    if (r.ok) set({ ledger: r.data.ledger })
  },

  showToast(msg) {
    set({ toast: { msg, at: Date.now() } })
  },

  setView(view) { set({ view, moreOpen: false }) },
  openEntry(tab) { set({ entryOpen: true, entryTab: tab, moreOpen: false }) },
  setEntryTab(entryTab) { set({ entryTab }) },
  closeSheets() { set({ entryOpen: false, moreOpen: false }) },
  setMoreOpen(moreOpen) { set({ moreOpen }) },
  setFocusOpen(focusOpen) { set({ focusOpen }) },
  setSettingsOpen(settingsOpen) { set({ settingsOpen }) },
  setAdminOpen(adminOpen) { set({ adminOpen }) },

  async mergeDeltas(deltas) {
    const r = await api<{ ledger: Ledger; results: MergeResult[] }>('/api/merge', {
      method: 'POST',
      body: JSON.stringify(deltas.length === 1 ? deltas[0] : deltas),
    })
    if (!r.ok) return { error: r.error }
    set({ ledger: r.data.ledger })
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
    const r = await api<{ ledger: Ledger }>('/api/habits/toggle', {
      method: 'POST',
      body: JSON.stringify({ habitId, date }),
    })
    if (r.ok) set({ ledger: r.data.ledger })
  },

  async addNote(text, date) {
    const r = await api<{ ledger: Ledger; noteId: string }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ text, date }),
    })
    if (!r.ok) { get().showToast(r.error); return null }
    set({ ledger: r.data.ledger })
    return r.data.noteId
  },

  async deleteNote(id) {
    const r = await api<{ ledger: Ledger }>(`/api/notes/${id}`, { method: 'DELETE' })
    if (r.ok) set({ ledger: r.data.ledger })
  },

  async addTask(goalId, label, priority = 'normal') {
    const r = await api<{ ledger: Ledger }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ goalId, label, priority }),
    })
    if (!r.ok) { get().showToast(r.error); return }
    set({ ledger: r.data.ledger })
  },

  async updateTask(id, patch) {
    /* optimistic */
    const led = get().ledger
    if (led) {
      let changed = false
      const goals = led.goals.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => {
          if (t.id !== id) return t
          changed = true
          return { ...t, ...patch, lastTouched: new Date().toISOString().slice(0, 10) } as typeof t
        }),
      }))
      if (changed) set({ ledger: { ...led, goals } })
    }
    const r = await api<{ ledger: Ledger }>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (r.ok) set({ ledger: r.data.ledger })
  },

  async deleteTask(id) {
    const r = await api<{ ledger: Ledger }>(`/api/tasks/${id}`, { method: 'DELETE' })
    if (r.ok) set({ ledger: r.data.ledger })
  },

  async updateGoal(id, patch) {
    /* optimistic */
    const led = get().ledger
    if (led) {
      const goals = led.goals.map((g) => (g.id === id ? { ...g, ...patch } as typeof g : g))
      set({ ledger: { ...led, goals } })
    }
    const r = await api<{ ledger: Ledger }>(`/api/goals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (r.ok) set({ ledger: r.data.ledger })
    else await get().refresh()
  },

  async addInboxItem(text) {
    const r = await api<{ ledger: Ledger }>('/api/inbox', {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    if (!r.ok) { get().showToast(r.error); return }
    set({ ledger: r.data.ledger })
  },

  async deleteInboxItem(id) {
    const r = await api<{ ledger: Ledger }>(`/api/inbox/${id}`, { method: 'DELETE' })
    if (r.ok) set({ ledger: r.data.ledger })
  },

  async inboxToTask(id, goalId) {
    const led = get().ledger
    const item = led?.inbox.find((i) => i.id === id)
    if (!item) return
    const created = await api<{ ledger: Ledger }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ goalId, label: item.text, priority: 'normal' }),
    })
    if (!created.ok) { get().showToast(created.error); return }
    await get().deleteInboxItem(id)
    get().showToast('Task created from inbox ✓')
  },

  async inboxToNote(id) {
    const led = get().ledger
    const item = led?.inbox.find((i) => i.id === id)
    if (!item) return
    const added = await get().addNote(item.text)
    if (added) {
      await get().deleteInboxItem(id)
      get().showToast('Filed as a note ✓')
    }
  },

  async addImportantDate(label, date, type) {
    const r = await api<{ ledger: Ledger }>('/api/important-dates', {
      method: 'POST',
      body: JSON.stringify({ label, date, type }),
    })
    if (!r.ok) { get().showToast(r.error); return false }
    set({ ledger: r.data.ledger })
    return true
  },

  /** v11: create a goal (fresh accounts start with none). */
  async addGoal(name, opts) {
    const r = await api<{ ledger: Ledger }>('/api/goals', {
      method: 'POST',
      body: JSON.stringify({ name, ...opts }),
    })
    if (!r.ok) { get().showToast(r.error); return false }
    set({ ledger: r.data.ledger })
    return true
  },

  /** v11: create a habit. */
  async addHabit(name, targetPerWeek) {
    const r = await api<{ ledger: Ledger }>('/api/habits', {
      method: 'POST',
      body: JSON.stringify({ name, targetPerWeek }),
    })
    if (!r.ok) { get().showToast(r.error); return false }
    set({ ledger: r.data.ledger })
    return true
  },

  async userAction(name, action) {
    const r = await api<{ ledger: Ledger }>(`/api/users/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    })
    if (!r.ok) { get().showToast(r.error); return }
    set({ ledger: r.data.ledger })
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
    const r = await api<{ ok: boolean }>('/api/account/delete', { method: 'POST' })
    if (!r.ok) return r.error
    set({
      user: null,
      ledger: null,
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
    const r = await api<{ settings: LlmConfigClientT[] }>('/api/settings/llm/me')
    if (r.ok) return r.data.settings
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
