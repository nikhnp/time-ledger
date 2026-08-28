import { db } from '@/lib/db'
import type { Ledger, DayT } from '@/lib/types'

/**
 * Data access layer — Prisma Client over SQLite.
 *
 * (Historical note: this module is still called `neon-sql` because every API
 * route imports it by that path. The signatures mirror the old raw-Neon-SQL
 * version one-for-one, so no route needs to change.)
 *
 * JSON columns (dockConfig, milestones, checkIn, backup payload, audit
 * details) are stored as TEXT and marshalled here. Dates are stored as
 * UTC-midnight DateTimes and serialized to YYYY-MM-DD strings on read.
 */

/* ============================================================
 * TYPES — mirror the old raw SQL row shapes
 * ============================================================ */

export interface UserRow {
  id: string
  name: string
  role: string
  passwordHash: string | null
  forceLogoutAt: Date | null
  createdAt: Date
  isActive: boolean
  passwordResetToken: string | null
  passwordResetExpires: Date | null
  dockConfig: unknown // { enabled: string[], keepInDock: string[] }
}

export interface SessionRow {
  tokenHash: string
  userId: string
  expiresAt: Date
  createdAt: Date
}

export interface GoalRow {
  userId: string
  id: string
  name: string
  unit: string
  target: number
  deadline: Date | null
  weeklyTargetHours: number
  color: string | null
  sortOrder: number
  milestones: unknown
  createdAt: Date
}

export interface TaskRow {
  id: string
  userId: string
  goalId: string
  label: string
  status: string
  priority: string
  urgent: boolean
  important: boolean
  lastTouched: Date
  createdAt: Date
}

export interface HabitRow {
  userId: string
  id: string
  name: string
  targetPerWeek: number
  color: string | null
  sortOrder: number
}

export interface MetricRow {
  userId: string
  id: string
  name: string
  direction: string
  unit: string
  dailyTarget: number | null
  monthlyTarget: number | null
  sortOrder: number
}

export interface ImportantDateRow {
  id: string
  userId: string
  label: string
  date: Date
  type: string
  repeatsAnnually: boolean
  createdAt: Date
}

export interface DayRow {
  userId: string
  date: Date
  highlight: string | null
  checkIn: unknown
}

export interface ActivityRow {
  id: string
  userId: string
  date: Date
  goalId: string | null
  hours: number
  start: string | null
  end: string | null
  label: string | null
  createdAt: Date
}

export interface DayHabitRow {
  userId: string
  date: Date
  habitId: string
  done: boolean
}

export interface DayMetricRow {
  userId: string
  date: Date
  metricId: string
  value: number
}

export interface NoteRow {
  id: string
  userId: string
  date: Date
  text: string
  createdAt: Date
}

export interface InboxItemRow {
  id: string
  userId: string
  text: string
  addedAt: Date
  done: boolean
  createdAt: Date
}

export interface ScreenEntryRow {
  id: string
  userId: string
  date: Date
  appName: string
  category: string
  minutes: number
  createdAt: Date
}

/* ---------- JSON helpers ---------- */

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function d2s(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/* ============================================================
 * USER
 * ============================================================ */

type UserRecord = Awaited<ReturnType<typeof db.user.findFirstOrThrow>>

function toUserRow(u: UserRecord): UserRow {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    passwordHash: u.passwordHash,
    forceLogoutAt: u.forceLogoutAt,
    createdAt: u.createdAt,
    isActive: u.isActive,
    passwordResetToken: u.passwordResetToken,
    passwordResetExpires: u.passwordResetExpires,
    dockConfig: parseJson<unknown>(u.dockConfig, null),
  }
}

export async function countUsers(): Promise<number> {
  return db.user.count()
}

export async function countAdmins(): Promise<number> {
  return db.user.count({ where: { role: 'admin' } })
}

export async function findUserByName(name: string): Promise<UserRow | null> {
  // SQLite has no case-insensitive collation via Prisma; users are few.
  const all = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
  const hit = all.find((u) => u.name.toLowerCase() === name.trim().toLowerCase())
  return hit ? toUserRow(hit) : null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const u = await db.user.findUnique({ where: { id } })
  return u ? toUserRow(u) : null
}

export async function findAllUsersOrderedByCreatedAt(): Promise<UserRow[]> {
  const all = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
  return all.map(toUserRow)
}

export async function createUser(params: {
  id: string
  name: string
  role: string
  passwordHash: string
}): Promise<UserRow> {
  const u = await db.user.create({
    data: {
      id: params.id,
      name: params.name,
      role: params.role,
      passwordHash: params.passwordHash,
    },
  })
  return toUserRow(u)
}

export async function updateUser(params: {
  id: string
  role?: string
  passwordHash?: string | null
  forceLogoutAt?: Date | null
  isActive?: boolean
  passwordResetToken?: string | null
  passwordResetExpires?: Date | null
  dockConfig?: unknown
}): Promise<void> {
  const data: Record<string, unknown> = {}
  if (params.role !== undefined) data.role = params.role
  if (params.passwordHash !== undefined) data.passwordHash = params.passwordHash
  if (params.forceLogoutAt !== undefined) data.forceLogoutAt = params.forceLogoutAt
  if (params.isActive !== undefined) data.isActive = params.isActive
  if (params.passwordResetToken !== undefined) data.passwordResetToken = params.passwordResetToken
  if (params.passwordResetExpires !== undefined) data.passwordResetExpires = params.passwordResetExpires
  if (params.dockConfig !== undefined) data.dockConfig = JSON.stringify(params.dockConfig)
  if (Object.keys(data).length === 0) return
  await db.user.update({ where: { id: params.id }, data })
}

/* ============================================================
 * SESSION
 * ============================================================ */

/**
 * P1-1c: only the SHA-256 hash of a session token is ever stored. Callers
 * pass the raw token; it is hashed here at the single write path.
 */
export async function createSessionRow(params: {
  token: string
  userId: string
  expiresAt: Date
  impersonatedBy?: string | null
}): Promise<void> {
  const { hashToken } = await import('@/lib/server/auth')
  await db.session.create({
    data: {
      tokenHash: hashToken(params.token),
      userId: params.userId,
      expiresAt: params.expiresAt,
      impersonatedBy: params.impersonatedBy ?? null,
    },
  })
}

export async function findSessionWithUser(
  token: string,
): Promise<{ session: SessionRow & { impersonatedBy?: string | null }; user: UserRow } | null> {
  const { hashToken } = await import('@/lib/server/auth')
  const row = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!row) return null
  return {
    session: {
      tokenHash: row.tokenHash, // never the raw token — P1-1c
      userId: row.userId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      impersonatedBy: row.impersonatedBy ?? null,
    },
    user: toUserRow(row.user),
  }
}

export async function deleteSession(token: string): Promise<void> {
  const { hashToken } = await import('@/lib/server/auth')
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } })
}

/**
 * Delete all sessions of a user. P1-1d: `keepTokenHash` exempts one session
 * (the current device) so a password change logs out everyone else only.
 */
export async function deleteSessionsByUser(userId: string, keepTokenHash?: string): Promise<void> {
  await db.session.deleteMany({
    where: keepTokenHash ? { userId, NOT: { tokenHash: keepTokenHash } } : { userId },
  })
}

/* ============================================================
 * GOAL
 * ============================================================ */

type GoalRecord = Awaited<ReturnType<typeof db.goal.findFirstOrThrow>>

function toGoalRow(g: GoalRecord): GoalRow {
  return {
    userId: g.userId,
    id: g.id,
    name: g.name,
    unit: g.unit,
    target: g.target,
    deadline: g.deadline,
    weeklyTargetHours: g.weeklyTargetHours,
    color: g.color,
    sortOrder: g.sortOrder,
    milestones: parseJson<unknown>(g.milestones, []),
    createdAt: g.createdAt,
  }
}

export async function findGoalByUserAndId(
  userId: string,
  id: string,
): Promise<GoalRow | null> {
  const g = await db.goal.findUnique({ where: { userId_id: { userId, id } } })
  return g ? toGoalRow(g) : null
}

export async function findGoalsByUser(userId: string): Promise<GoalRow[]> {
  const goals = await db.goal.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } })
  return goals.map(toGoalRow)
}

export async function findGoalsByUserWithTasks(userId: string): Promise<
  Array<GoalRow & { tasks: TaskRow[] }>
> {
  const [goals, tasks] = await Promise.all([
    findGoalsByUser(userId),
    db.task.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ])
  return goals.map((g) => ({
    ...g,
    tasks: tasks
      .filter((t) => t.goalId === g.id)
      .map((t) => ({
        id: t.id, userId: t.userId, goalId: t.goalId, label: t.label, status: t.status,
        priority: t.priority, urgent: t.urgent, important: t.important,
        lastTouched: t.lastTouched, createdAt: t.createdAt,
      })),
  }))
}

export async function updateGoal(
  userId: string,
  id: string,
  patch: {
    name?: string
    target?: number
    weeklyTargetHours?: number
    color?: string | null
    deadline?: Date | null
    milestones?: unknown
  },
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) data.name = patch.name
  if (patch.target !== undefined) data.target = patch.target
  if (patch.weeklyTargetHours !== undefined) data.weeklyTargetHours = patch.weeklyTargetHours
  if (patch.color !== undefined) data.color = patch.color
  if (patch.deadline !== undefined) data.deadline = patch.deadline
  if (patch.milestones !== undefined) data.milestones = JSON.stringify(patch.milestones)
  if (Object.keys(data).length === 0) return
  await db.goal.update({ where: { userId_id: { userId, id } }, data })
}

/** v11: create a goal row for a user (id is a human-friendly slug). */
export async function createGoal(params: {
  userId: string
  id: string
  name: string
  unit?: string
  target?: number
  weeklyTargetHours?: number
  color?: string | null
  sortOrder?: number
}): Promise<GoalRow> {
  const g = await db.goal.create({
    data: {
      userId: params.userId,
      id: params.id,
      name: params.name,
      unit: params.unit ?? 'hours',
      target: params.target ?? 30,
      weeklyTargetHours: params.weeklyTargetHours ?? 8,
      color: params.color ?? null,
      sortOrder: params.sortOrder ?? 0,
      milestones: '[]',
    },
  })
  return toGoalRow(g)
}

/** v11: create a habit row for a user. */
export async function createHabit(params: {
  userId: string
  id: string
  name: string
  targetPerWeek?: number
  color?: string | null
  sortOrder?: number
}): Promise<HabitRow> {
  return db.habit.create({
    data: {
      userId: params.userId,
      id: params.id,
      name: params.name,
      targetPerWeek: params.targetPerWeek ?? 7,
      color: params.color ?? null,
      sortOrder: params.sortOrder ?? 0,
    },
  })
}

/* ============================================================
 * TASK
 * ============================================================ */

export async function findTaskByUserAndId(
  userId: string,
  id: string,
): Promise<TaskRow | null> {
  const t = await db.task.findFirst({ where: { id, userId } })
  return t ?? null
}

export async function createTask(params: {
  id: string
  userId: string
  goalId: string
  label: string
  status?: string
  priority?: string
  urgent?: boolean
  important?: boolean
  lastTouched: Date
}): Promise<void> {
  await db.task.create({
    data: {
      id: params.id,
      userId: params.userId,
      goalId: params.goalId,
      label: params.label,
      status: params.status ?? 'todo',
      priority: params.priority ?? 'normal',
      urgent: params.urgent ?? false,
      important: params.important ?? true,
      lastTouched: params.lastTouched,
    },
  })
}

export async function updateTask(
  id: string,
  patch: {
    label?: string
    status?: string
    priority?: string
    urgent?: boolean
    important?: boolean
    goalId?: string
    lastTouched?: Date
  },
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.label !== undefined) data.label = patch.label
  if (patch.status !== undefined) data.status = patch.status
  if (patch.priority !== undefined) data.priority = patch.priority
  if (patch.urgent !== undefined) data.urgent = patch.urgent
  if (patch.important !== undefined) data.important = patch.important
  if (patch.goalId !== undefined) data.goalId = patch.goalId
  if (patch.lastTouched !== undefined) data.lastTouched = patch.lastTouched
  if (Object.keys(data).length === 0) return
  await db.task.update({ where: { id }, data })
}

export async function deleteTask(id: string): Promise<void> {
  await db.task.deleteMany({ where: { id } })
}

/* ============================================================
 * HABIT
 * ============================================================ */

export async function findHabitByUserAndId(
  userId: string,
  id: string,
): Promise<HabitRow | null> {
  return db.habit.findUnique({ where: { userId_id: { userId, id } } })
}

export async function findHabitsByUser(userId: string): Promise<HabitRow[]> {
  return db.habit.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } })
}

/* ============================================================
 * METRIC
 * ============================================================ */

export async function findMetricsByUser(userId: string): Promise<MetricRow[]> {
  return db.metric.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } })
}

/* ============================================================
 * DAY_HABIT
 * ============================================================ */

export async function findDayHabit(
  userId: string,
  date: Date,
  habitId: string,
): Promise<DayHabitRow | null> {
  return db.dayHabit.findUnique({
    where: { userId_date_habitId: { userId, date, habitId } },
  })
}

export async function upsertDayHabit(
  userId: string,
  date: Date,
  habitId: string,
  done: boolean,
): Promise<void> {
  await db.dayHabit.upsert({
    where: { userId_date_habitId: { userId, date, habitId } },
    create: { userId, date, habitId, done },
    update: { done },
  })
}

/* ============================================================
 * DAY
 * ============================================================ */

export async function upsertDay(
  userId: string,
  date: Date,
  patch: { highlight?: string | null; checkIn?: object | null },
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.highlight) data.highlight = patch.highlight
  if (patch.checkIn) data.checkIn = JSON.stringify(patch.checkIn)
  if (Object.keys(data).length === 0) {
    // ensure the day exists even with no content
    await db.day.upsert({ where: { userId_date: { userId, date } }, create: { userId, date }, update: {} })
    return
  }
  await db.day.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, ...data },
    update: data,
  })
}

/* ============================================================
 * DAY_METRIC
 * ============================================================ */

export async function upsertDayMetric(
  userId: string,
  date: Date,
  metricId: string,
  value: number,
): Promise<void> {
  await db.dayMetric.upsert({
    where: { userId_date_metricId: { userId, date, metricId } },
    create: { userId, date, metricId, value },
    update: { value },
  })
}

/* ============================================================
 * ACTIVITY
 * ============================================================ */

export async function createActivity(params: {
  id: string
  userId: string
  date: Date
  goalId: string | null
  hours: number
  start: string | null
  end: string | null
  label: string | null
}): Promise<void> {
  await db.activity.create({ data: params })
}

export async function findActivitiesByUserAndDateRange(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<ActivityRow[]> {
  return db.activity.findMany({
    where: { userId, date: { gte: startDate, lte: endDate } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function findLastActivityDateByUser(
  userId: string,
): Promise<Date | null> {
  const a = await db.activity.findFirst({ where: { userId }, orderBy: { date: 'desc' } })
  return a ? a.date : null
}

/* ============================================================
 * NOTE
 * ============================================================ */

export async function createNote(params: {
  id: string
  userId: string
  date: Date
  text: string
}): Promise<void> {
  await db.note.create({ data: params })
}

export async function findNoteByUserAndId(
  userId: string,
  id: string,
): Promise<NoteRow | null> {
  return db.note.findFirst({ where: { id, userId } })
}

export async function deleteNote(id: string): Promise<void> {
  await db.note.deleteMany({ where: { id } })
}

/* ============================================================
 * INBOX_ITEM
 * ============================================================ */

export async function createInboxItem(params: {
  id: string
  userId: string
  text: string
}): Promise<void> {
  await db.inboxItem.create({
    data: { id: params.id, userId: params.userId, text: params.text, done: false },
  })
}

export async function findInboxItemByUserAndId(
  userId: string,
  id: string,
): Promise<InboxItemRow | null> {
  return db.inboxItem.findFirst({ where: { id, userId } })
}

export async function markInboxItemDone(id: string): Promise<void> {
  await db.inboxItem.updateMany({ where: { id }, data: { done: true } })
}

export async function deleteInboxItem(id: string): Promise<void> {
  await db.inboxItem.deleteMany({ where: { id } })
}

/* ============================================================
 * IMPORTANT_DATE
 * ============================================================ */

export async function createImportantDate(params: {
  id: string
  userId: string
  label: string
  date: Date
  type: string
}): Promise<void> {
  await db.importantDate.create({
    data: { ...params, repeatsAnnually: false },
  })
}

/* ============================================================
 * ASSEMBLE LEDGER — the big read function
 * ============================================================ */

export async function assembleLedgerRaw(userId: string): Promise<Ledger> {
  const [user, goals, habits, metrics, importantDates, days, activities, dayHabits, dayMetrics, notes, inbox] =
    await Promise.all([
      db.user.findUnique({ where: { id: userId } }),
      findGoalsByUserWithTasks(userId),
      findHabitsByUser(userId),
      findMetricsByUser(userId),
      db.importantDate.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
      db.day.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
      db.activity.findMany({ where: { userId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      db.dayHabit.findMany({ where: { userId } }),
      db.dayMetric.findMany({ where: { userId } }),
      db.note.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
      db.inboxItem.findMany({ where: { userId, done: false }, orderBy: { addedAt: 'desc' } }),
    ])

  if (!user) throw new Error('user not found')

  const byDate = new Map<string, DayT>()
  const dayFor = (date: Date): DayT => {
    const key = d2s(date)
    let d = byDate.get(key)
    if (!d) {
      d = { date: key, highlight: null, checkIn: null, activities: [], habits: {}, metrics: {} }
      byDate.set(key, d)
    }
    return d
  }

  days.forEach((d) => {
    dayFor(d.date).highlight = d.highlight
    dayFor(d.date).checkIn = parseJson<DayT['checkIn']>(d.checkIn, null)
  })
  activities.forEach((a) => {
    dayFor(a.date).activities.push({
      id: a.id, goalId: a.goalId, hours: a.hours, start: a.start, end: a.end, label: a.label,
    })
  })
  dayHabits.forEach((h) => {
    dayFor(h.date).habits[h.habitId] = h.done
  })
  dayMetrics.forEach((m) => {
    dayFor(m.date).metrics[m.metricId] = m.value
  })

  const allDates = Array.from(byDate.keys()).sort()
  const startDate = allDates[0] ?? todayStr()

  return {
    meta: { startDate, updated: todayStr() },
    goals: goals.map((g) => ({
      id: g.id, name: g.name, unit: g.unit, target: g.target,
      deadline: g.deadline ? d2s(g.deadline) : null,
      weeklyTargetHours: g.weeklyTargetHours, color: g.color,
      milestones: Array.isArray(g.milestones) ? (g.milestones as Ledger['goals'][number]['milestones']) : [],
      tasks: g.tasks.map((t) => ({
        id: t.id, goalId: t.goalId, label: t.label,
        status: t.status as 'todo' | 'doing' | 'done',
        priority: t.priority as 'normal' | 'high',
        urgent: t.urgent, important: t.important, lastTouched: d2s(t.lastTouched),
      })),
    })),
    metrics: metrics.map((m) => ({
      id: m.id, name: m.name, direction: m.direction as 'up' | 'down', unit: m.unit,
      dailyTarget: m.dailyTarget, monthlyTarget: m.monthlyTarget,
    })),
    habits: habits.map((h) => ({
      id: h.id, name: h.name, targetPerWeek: h.targetPerWeek, color: h.color,
    })),
    importantDates: importantDates.map((d) => ({
      id: d.id, label: d.label, date: d2s(d.date), type: d.type, repeatsAnnually: d.repeatsAnnually,
    })),
    days: Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
    notes: notes.map((n) => ({ id: n.id, date: d2s(n.date), text: n.text })),
    inbox: inbox.map((i) => ({ id: i.id, text: i.text, addedAt: d2s(i.addedAt) })),
  }
}

/* ============================================================
 * LLM SETTINGS (system-wide + per-user, with fallback chain)
 * ============================================================ */

export interface LlmSettingRow {
  id: string
  userId: string | null
  priority: number
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * API keys at rest (P1-1e): AES-256-GCM via src/lib/server/crypto.ts,
 * keyed by LLM_ENCRYPTION_KEY. v10.3's XOR obfuscation (hardcoded fallback
 * key) is gone; legacy blobs are migrated once by the admin maintenance
 * route POST /api/admin/maintenance { job: 'reencrypt-llm-keys' }.
 */
import { encryptSecret, decryptSecret, legacyXorDecrypt } from '@/lib/server/crypto'

export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

/**
 * Decrypt a stored key with legacy tolerance:
 * - `v2:` blobs → AES-256-GCM
 * - legacy XOR blobs → decrypted via the old scheme (and re-encrypted by
 *   the maintenance job). Throws only if a legacy blob exists AND the old
 *   obfuscation secret differs — surfaced as "key unreadable" in the UI.
 */
function decryptStoredKey(stored: string): string {
  if (stored.startsWith('v2:')) return decryptSecret(stored)
  return legacyXorDecrypt(stored)
}

/**
 * For UI display only: decrypt a stored key just enough to mask it.
 * Never throws — unreadable keys (e.g. rotated LLM_ENCRYPTION_KEY) show as
 * "(unreadable — re-enter)" instead of crashing settings.
 */
export function maskStoredApiKey(stored: string): string {
  try {
    return maskApiKey(decryptStoredKey(stored))
  } catch {
    return '(unreadable — re-enter)'
  }
}

/** Get all system-wide LLM settings (sorted by priority asc). */
export async function findSystemLlmSettings(): Promise<LlmSettingRow[]> {
  return db.llmSetting.findMany({
    where: { userId: null },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  })
}

/** Get all per-user LLM settings for a user (sorted by priority asc). */
export async function findUserLlmSettings(userId: string): Promise<LlmSettingRow[]> {
  return db.llmSetting.findMany({
    where: { userId },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  })
}

/**
 * Resolve the LLM fallback chain for a user:
 *  1. User's enabled settings (priority asc)
 *  2. System-wide enabled settings (priority asc)
 * Returns decrypted API keys for actual use.
 */
export async function resolveLlmChain(userId: string): Promise<Array<{
  id: string
  priority: number
  provider: string
  model: string
  apiKey: string // decrypted
  baseUrl: string | null
  source: 'user' | 'system'
}>> {
  const [userSettings, systemSettings] = await Promise.all([
    findUserLlmSettings(userId),
    findSystemLlmSettings(),
  ])
  const chain: Array<{
    id: string
    priority: number
    provider: string
    model: string
    apiKey: string
    baseUrl: string | null
    source: 'user' | 'system'
  }> = []
  for (const s of userSettings) {
    if (!s.enabled) continue
    chain.push({
      id: s.id, priority: s.priority, provider: s.provider, model: s.model,
      apiKey: decryptStoredKey(s.apiKey), baseUrl: s.baseUrl, source: 'user',
    })
  }
  for (const s of systemSettings) {
    if (!s.enabled) continue
    chain.push({
      id: s.id, priority: s.priority + 1000, provider: s.provider, model: s.model,
      apiKey: decryptStoredKey(s.apiKey), baseUrl: s.baseUrl, source: 'system',
    })
  }
  return chain.sort((a, b) => a.priority - b.priority)
}

export async function createLlmSetting(params: {
  id: string
  userId: string | null
  priority: number
  provider: string
  model: string
  apiKey: string // plaintext — will be encrypted
  baseUrl: string | null
  enabled: boolean
}): Promise<LlmSettingRow> {
  return db.llmSetting.create({
    data: {
      id: params.id,
      userId: params.userId,
      priority: params.priority,
      provider: params.provider,
      model: params.model,
      apiKey: encryptSecret(params.apiKey),
      baseUrl: params.baseUrl,
      enabled: params.enabled,
    },
  })
}

export async function updateLlmSetting(
  id: string,
  patch: {
    priority?: number
    provider?: string
    model?: string
    apiKey?: string // plaintext — will be encrypted
    baseUrl?: string | null
    enabled?: boolean
  },
): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.priority !== undefined) data.priority = patch.priority
  if (patch.provider !== undefined) data.provider = patch.provider
  if (patch.model !== undefined) data.model = patch.model
  if (patch.apiKey !== undefined) data.apiKey = encryptSecret(patch.apiKey)
  if (patch.baseUrl !== undefined) data.baseUrl = patch.baseUrl
  if (patch.enabled !== undefined) data.enabled = patch.enabled
  await db.llmSetting.update({ where: { id }, data })
}

export async function deleteLlmSetting(id: string): Promise<void> {
  await db.llmSetting.deleteMany({ where: { id } })
}

/* ============================================================
 * DOCK CONFIG (per-user)
 * ============================================================ */

export async function getDockConfig(userId: string): Promise<{ enabled: string[]; keepInDock: string[] }> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { dockConfig: true } })
  if (!u) return { enabled: ['habits'], keepInDock: ['habits'] }
  const cfg = parseJson<{ enabled?: string[]; keepInDock?: string[] } | null>(u.dockConfig, null)
  if (cfg && typeof cfg === 'object') {
    return {
      enabled: Array.isArray(cfg.enabled) ? cfg.enabled : ['habits'],
      keepInDock: Array.isArray(cfg.keepInDock) ? cfg.keepInDock : ['habits'],
    }
  }
  return { enabled: ['habits'], keepInDock: ['habits'] }
}

export async function setDockConfig(userId: string, config: { enabled: string[]; keepInDock: string[] }): Promise<void> {
  await updateUser({ id: userId, dockConfig: config })
}

/* ============================================================
 * ADMIN ACTIONS (audit log)
 * ============================================================ */

export async function logAdminAction(params: {
  id: string
  actorId: string
  targetId: string
  action: string
  details?: unknown
}): Promise<void> {
  await db.adminAction.create({
    data: {
      id: params.id,
      actorId: params.actorId,
      targetId: params.targetId,
      action: params.action,
      details: params.details ? JSON.stringify(params.details) : null,
    },
  })
}

export async function findAdminActions(limit = 50): Promise<Array<{
  id: string
  actorId: string
  actorName: string
  targetId: string
  targetName: string
  action: string
  details: unknown
  createdAt: Date
}>> {
  const rows = await db.adminAction.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { actor: { select: { name: true } }, target: { select: { name: true } } },
  })
  return rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    actorName: r.actor.name,
    targetId: r.targetId,
    targetName: r.target.name,
    action: r.action,
    details: parseJson<unknown>(r.details, null),
    createdAt: r.createdAt,
  }))
}

/* ============================================================
 * USER BACKUPS (single-user snapshots)
 * ============================================================ */

export async function createUserBackup(params: {
  id: string
  userId: string
  createdBy: string
  payload: unknown // full user data as JSON
}): Promise<{ id: string; createdAt: Date; sizeBytes: number }> {
  const payloadJson = JSON.stringify(params.payload)
  const row = await db.userBackup.create({
    data: {
      id: params.id,
      userId: params.userId,
      createdBy: params.createdBy,
      payload: payloadJson,
    },
  })
  return { id: row.id, createdAt: row.createdAt, sizeBytes: payloadJson.length }
}

export async function findUserBackups(userId: string): Promise<Array<{
  id: string
  userId: string
  createdBy: string
  createdAt: Date
  sizeBytes: number
}>> {
  const rows = await db.userBackup.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((r) => ({ id: r.id, userId: r.userId, createdBy: r.createdBy, createdAt: r.createdAt, sizeBytes: r.payload.length }))
}

export async function findUserBackupById(id: string): Promise<{
  id: string
  userId: string
  createdBy: string
  payload: unknown
  createdAt: Date
} | null> {
  const r = await db.userBackup.findUnique({ where: { id } })
  if (!r) return null
  return {
    id: r.id,
    userId: r.userId,
    createdBy: r.createdBy,
    payload: parseJson<unknown>(r.payload, null),
    createdAt: r.createdAt,
  }
}

export async function findAllBackups(): Promise<Array<{
  id: string
  userId: string
  createdBy: string
  createdAt: Date
  sizeBytes: number
}>> {
  const rows = await db.userBackup.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return rows.map((r) => ({ id: r.id, userId: r.userId, createdBy: r.createdBy, createdAt: r.createdAt, sizeBytes: r.payload.length }))
}

/* ============================================================
 * USER DELETION (cascade-by-hand, mirrors the old raw SQL order)
 * ============================================================ */

export async function deleteUserAndAllData(userId: string): Promise<void> {
  await db.screenEntry.deleteMany({ where: { userId } })
  await db.dayHabit.deleteMany({ where: { userId } })
  await db.dayMetric.deleteMany({ where: { userId } })
  await db.activity.deleteMany({ where: { userId } })
  await db.day.deleteMany({ where: { userId } })
  await db.note.deleteMany({ where: { userId } })
  await db.inboxItem.deleteMany({ where: { userId } })
  await db.importantDate.deleteMany({ where: { userId } })
  await db.task.deleteMany({ where: { userId } })
  await db.goal.deleteMany({ where: { userId } })
  await db.habit.deleteMany({ where: { userId } })
  await db.metric.deleteMany({ where: { userId } })
  await db.session.deleteMany({ where: { userId } })
  await db.llmSetting.deleteMany({ where: { userId } })
  // audit rows reference users via required relations — drop them first
  await db.adminAction.deleteMany({ where: { OR: [{ actorId: userId }, { targetId: userId }] } })
  await db.userBackup.deleteMany({ where: { userId } })
  await db.user.deleteMany({ where: { id: userId } })
}

/* ============================================================
 * LATEST SESSION TIMESTAMP (for admin "last active" display)
 * ============================================================ */

export async function findLastSessionForUser(userId: string): Promise<{ createdAt: Date } | null> {
  const s = await db.session.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })
  return s ? { createdAt: s.createdAt } : null
}

/* ============================================================
 * BACKUP / RESTORE — full per-user data export/import
 * ============================================================ */

export interface UserBackupPayload {
  user: {
    id: string
    name: string
    role: string
    createdAt: string
  }
  goals: Array<{ userId: string; id: string; name: string; unit: string; target: number; deadline: string | null; weeklyTargetHours: number; color: string | null; sortOrder: number; milestones: unknown }>
  tasks: Array<{ id: string; userId: string; goalId: string; label: string; status: string; priority: string; urgent: boolean; important: boolean; lastTouched: string }>
  habits: Array<{ userId: string; id: string; name: string; targetPerWeek: number; color: string | null; sortOrder: number }>
  metrics: Array<{ userId: string; id: string; name: string; direction: string; unit: string; dailyTarget: number | null; monthlyTarget: number | null; sortOrder: number }>
  importantDates: Array<{ id: string; userId: string; label: string; date: string; type: string; repeatsAnnually: boolean }>
  days: Array<{ userId: string; date: string; highlight: string | null; checkIn: unknown }>
  activities: Array<{ id: string; userId: string; date: string; goalId: string | null; hours: number; start: string | null; end: string | null; label: string | null }>
  dayHabits: Array<{ userId: string; date: string; habitId: string; done: boolean }>
  dayMetrics: Array<{ userId: string; date: string; metricId: string; value: number }>
  notes: Array<{ id: string; userId: string; date: string; text: string }>
  inboxItems: Array<{ id: string; userId: string; text: string; addedAt: string; done: boolean }>
  screenEntries?: Array<{ id: string; userId: string; date: string; appName: string; category: string; minutes: number }>
}

const iso = (d: Date | null | undefined): string | null => (d instanceof Date ? d.toISOString() : (d ?? null))

/** Export a user's complete data as a JSON-serializable payload. */
export async function exportUserPayload(userId: string): Promise<UserBackupPayload> {
  const [user, goals, tasks, habits, metrics, importantDates, days, activities, dayHabits, dayMetrics, notes, inboxItems, screenEntries] =
    await Promise.all([
      db.user.findUnique({ where: { id: userId } }),
      db.goal.findMany({ where: { userId } }),
      db.task.findMany({ where: { userId } }),
      db.habit.findMany({ where: { userId } }),
      db.metric.findMany({ where: { userId } }),
      db.importantDate.findMany({ where: { userId } }),
      db.day.findMany({ where: { userId } }),
      db.activity.findMany({ where: { userId } }),
      db.dayHabit.findMany({ where: { userId } }),
      db.dayMetric.findMany({ where: { userId } }),
      db.note.findMany({ where: { userId } }),
      db.inboxItem.findMany({ where: { userId } }),
      db.screenEntry.findMany({ where: { userId } }),
    ])
  if (!user) throw new Error('user not found for backup')
  return {
    user: { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt.toISOString() },
    goals: goals.map((g) => ({ ...g, milestones: parseJson<unknown>(g.milestones, []), deadline: iso(g.deadline), createdAt: undefined as unknown as string })),
    tasks: tasks.map((t) => ({ id: t.id, userId: t.userId, goalId: t.goalId, label: t.label, status: t.status, priority: t.priority, urgent: t.urgent, important: t.important, lastTouched: t.lastTouched.toISOString() })),
    habits,
    metrics,
    importantDates: importantDates.map((d) => ({ id: d.id, userId: d.userId, label: d.label, date: d.date.toISOString(), type: d.type, repeatsAnnually: d.repeatsAnnually })),
    days: days.map((d) => ({ userId: d.userId, date: d.date.toISOString(), highlight: d.highlight, checkIn: parseJson<unknown>(d.checkIn, null) })),
    activities: activities.map((a) => ({ id: a.id, userId: a.userId, date: a.date.toISOString(), goalId: a.goalId, hours: a.hours, start: a.start, end: a.end, label: a.label })),
    dayHabits: dayHabits.map((h) => ({ userId: h.userId, date: h.date.toISOString(), habitId: h.habitId, done: h.done })),
    dayMetrics: dayMetrics.map((m) => ({ userId: m.userId, date: m.date.toISOString(), metricId: m.metricId, value: m.value })),
    notes: notes.map((n) => ({ id: n.id, userId: n.userId, date: n.date.toISOString(), text: n.text })),
    inboxItems: inboxItems.map((i) => ({ id: i.id, userId: i.userId, text: i.text, addedAt: i.addedAt.toISOString(), done: i.done })),
    screenEntries: screenEntries.map((s) => ({ id: s.id, userId: s.userId, date: s.date.toISOString(), appName: s.appName, category: s.category, minutes: s.minutes })),
  }
}

/** Restore a user's data from a backup payload. Wipes existing data first. */
export async function restoreUserPayload(userId: string, payload: UserBackupPayload): Promise<void> {
  await deleteUserAndAllDataExceptUser(userId)

  // Re-insert user row (preserves the same id). P1-1a: passwordHash is NOT
  // NULL now, and backup payloads deliberately exclude it — set an unusable
  // hash; the admin sends a reset link for the user to set a new password.
  const { hashPassword } = await import('@/lib/server/auth')
  const { randomBytes } = await import('node:crypto')
  await db.user.upsert({
    where: { id: payload.user.id },
    create: {
      id: payload.user.id,
      name: payload.user.name,
      role: payload.user.role,
      createdAt: new Date(payload.user.createdAt),
      isActive: true,
      passwordHash: hashPassword(randomBytes(32).toString('hex')),
    },
    update: { name: payload.user.name, role: payload.user.role },
  })

  for (const g of payload.goals) {
    await db.goal.upsert({
      where: { userId_id: { userId: g.userId, id: g.id } },
      create: {
        userId: g.userId, id: g.id, name: g.name, unit: g.unit, target: g.target,
        deadline: g.deadline ? new Date(g.deadline) : null,
        weeklyTargetHours: g.weeklyTargetHours, color: g.color, sortOrder: g.sortOrder,
        milestones: JSON.stringify(g.milestones ?? []),
      },
      update: { name: g.name, unit: g.unit, target: g.target },
    })
  }
  for (const t of payload.tasks) {
    await db.task.upsert({
      where: { id: t.id },
      create: {
        id: t.id, userId: t.userId, goalId: t.goalId, label: t.label, status: t.status,
        priority: t.priority, urgent: t.urgent, important: t.important,
        lastTouched: new Date(t.lastTouched),
      },
      update: { label: t.label, status: t.status },
    })
  }
  for (const h of payload.habits) {
    await db.habit.upsert({
      where: { userId_id: { userId: h.userId, id: h.id } },
      create: h,
      update: { name: h.name, targetPerWeek: h.targetPerWeek },
    })
  }
  for (const m of payload.metrics) {
    await db.metric.upsert({
      where: { userId_id: { userId: m.userId, id: m.id } },
      create: m,
      update: { name: m.name },
    })
  }
  for (const d of payload.importantDates) {
    await db.importantDate.upsert({
      where: { id: d.id },
      create: { id: d.id, userId: d.userId, label: d.label, date: new Date(d.date), type: d.type, repeatsAnnually: d.repeatsAnnually },
      update: {},
    })
  }
  for (const d of payload.days) {
    await db.day.upsert({
      where: { userId_date: { userId: d.userId, date: new Date(d.date) } },
      create: { userId: d.userId, date: new Date(d.date), highlight: d.highlight, checkIn: d.checkIn ? JSON.stringify(d.checkIn) : null },
      update: { highlight: d.highlight },
    })
  }
  for (const a of payload.activities) {
    await db.activity.upsert({
      where: { id: a.id },
      create: { id: a.id, userId: a.userId, date: new Date(a.date), goalId: a.goalId, hours: a.hours, start: a.start, end: a.end, label: a.label },
      update: {},
    })
  }
  for (const h of payload.dayHabits) {
    await db.dayHabit.upsert({
      where: { userId_date_habitId: { userId: h.userId, date: new Date(h.date), habitId: h.habitId } },
      create: { userId: h.userId, date: new Date(h.date), habitId: h.habitId, done: h.done },
      update: { done: h.done },
    })
  }
  for (const m of payload.dayMetrics) {
    await db.dayMetric.upsert({
      where: { userId_date_metricId: { userId: m.userId, date: new Date(m.date), metricId: m.metricId } },
      create: { userId: m.userId, date: new Date(m.date), metricId: m.metricId, value: m.value },
      update: { value: m.value },
    })
  }
  for (const n of payload.notes) {
    await db.note.upsert({
      where: { id: n.id },
      create: { id: n.id, userId: n.userId, date: new Date(n.date), text: n.text },
      update: {},
    })
  }
  for (const i of payload.inboxItems) {
    await db.inboxItem.upsert({
      where: { id: i.id },
      create: { id: i.id, userId: i.userId, text: i.text, addedAt: new Date(i.addedAt), done: i.done },
      update: {},
    })
  }
  for (const s of payload.screenEntries ?? []) {
    await db.screenEntry.upsert({
      where: { userId_date_appName: { userId: s.userId, date: new Date(s.date), appName: s.appName } },
      create: { userId: s.userId, date: new Date(s.date), appName: s.appName, category: s.category, minutes: s.minutes },
      update: { minutes: s.minutes, category: s.category },
    })
  }
}

async function deleteUserAndAllDataExceptUser(userId: string): Promise<void> {
  await db.screenEntry.deleteMany({ where: { userId } })
  await db.dayHabit.deleteMany({ where: { userId } })
  await db.dayMetric.deleteMany({ where: { userId } })
  await db.activity.deleteMany({ where: { userId } })
  await db.day.deleteMany({ where: { userId } })
  await db.note.deleteMany({ where: { userId } })
  await db.inboxItem.deleteMany({ where: { userId } })
  await db.importantDate.deleteMany({ where: { userId } })
  await db.task.deleteMany({ where: { userId } })
  await db.goal.deleteMany({ where: { userId } })
  await db.habit.deleteMany({ where: { userId } })
  await db.metric.deleteMany({ where: { userId } })
  await db.session.deleteMany({ where: { userId } })
  // Do NOT delete LlmSetting or UserBackup — those are audit/config
}

/* ============================================================
 * HABIT CONSISTENCY DATA (for the habit tracker heatmap)
 * ============================================================ */

/**
 * Returns `weeks` weeks of habit completion data (7 days × N weeks cells).
 * Each cell: { date, done }
 */
export async function getHabitConsistencyData(
  userId: string,
  habitId: string,
  weeks = 18,
): Promise<Array<{ date: string; done: boolean }>> {
  const today = new Date()
  const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const startDate = new Date(endDate.getTime() - (weeks * 7 - 1) * 86400000)

  const rows = await db.dayHabit.findMany({
    where: { userId, habitId, date: { gte: startDate, lte: endDate } },
  })
  const doneMap = new Map<string, boolean>()
  for (const r of rows) {
    doneMap.set(d2s(r.date), !!r.done)
  }
  const cells: Array<{ date: string; done: boolean }> = []
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(startDate.getTime() + i * 86400000)
    const dateStr = d.toISOString().slice(0, 10)
    cells.push({ date: dateStr, done: doneMap.get(dateStr) ?? false })
  }
  return cells
}

/* ============================================================
 * USER BY RESET TOKEN (for password reset flow)
 * ============================================================ */

export async function findUserByResetToken(token: string): Promise<UserRow | null> {
  const u = await db.user.findFirst({ where: { passwordResetToken: token } })
  return u ? toUserRow(u) : null
}

/* ============================================================
 * v11: SCREEN TIME (Digital Wellbeing style app usage tracking)
 * ============================================================ */

/** Log/replace screen-time entries for one day. Each item is an app + minutes;
 * re-logging the same app on the same day replaces its minutes (upsert). */
export async function upsertScreenEntries(
  userId: string,
  date: Date,
  items: Array<{ appName: string; category?: string; minutes: number }>,
): Promise<void> {
  for (const item of items) {
    const appName = item.appName.trim().slice(0, 60)
    if (!appName) continue
    const minutes = Math.max(0, Math.min(24 * 60, Math.round(Number(item.minutes) || 0)))
    if (minutes <= 0) {
      await db.screenEntry.deleteMany({ where: { userId, date, appName } })
      continue
    }
    await db.screenEntry.upsert({
      where: { userId_date_appName: { userId, date, appName } },
      create: { userId, date, appName, category: item.category ?? 'other', minutes },
      update: { minutes, category: item.category ?? 'other' },
    })
  }
}

export async function deleteScreenEntry(userId: string, id: string): Promise<void> {
  await db.screenEntry.deleteMany({ where: { id, userId } })
}

/** All screen entries for a user in [startDate, endDate] (inclusive). */
export async function findScreenEntriesByRange(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<ScreenEntryRow[]> {
  return db.screenEntry.findMany({
    where: { userId, date: { gte: startDate, lte: endDate } },
    orderBy: [{ date: 'asc' }, { minutes: 'desc' }],
  })
}
