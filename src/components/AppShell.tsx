'use client'

import { useEffect, useRef, useState } from 'react'
import { useLedger, type ViewId } from '@/store/useLedger'
import { userColor } from '@/lib/colors'
import { I } from '@/components/Icon'
import TodayView from '@/components/views/TodayView'
import WeekView from '@/components/views/WeekView'
import MonthView from '@/components/views/MonthView'
import HabitsView from '@/components/views/HabitsView'
import BoardView from '@/components/views/BoardView'
import BudgetView from '@/components/views/BudgetView'
import GoalsView from '@/components/views/GoalsView'
import InboxView from '@/components/views/InboxView'
import MatrixView from '@/components/views/MatrixView'
import NotesView from '@/components/views/NotesView'
import PeopleView from '@/components/views/PeopleView'
import ScreenTimeView from '@/components/views/ScreenTimeView'
import EntrySheet from '@/components/EntrySheet'
import FocusModal from '@/components/FocusModal'
import SettingsModal from '@/components/SettingsModal'
import AdminPanel from '@/components/AdminPanel'
import Toast from '@/components/Toast'
import { TOOL_LIST } from '@/components/AppShellTools'

/* ---------- dock ---------- */

const VIEW_TITLES: Record<ViewId, string> = {
  today: 'Today', week: 'Week', month: 'Month', habits: 'Habits', board: 'Board',
  budget: 'Budget', goals: 'Goals', inbox: 'Inbox', matrix: 'Matrix', notes: 'Notes',
  people: 'People', screen: 'Screen',
}
const DOCK_ICONS: Record<ViewId, string> = {
  today: 'sun', week: 'calendar', month: 'grid', habits: 'check', board: 'columns',
  budget: 'gauge', goals: 'target', inbox: 'mail', matrix: 'layout', notes: 'file',
  people: 'house', screen: 'phone',
}
/** every optional tool, in More-sheet order (Screen time first — new in v11) */
const MORE_ITEMS: ViewId[] = ['screen', 'habits', 'board', 'budget', 'goals', 'inbox', 'matrix', 'notes', 'people']
const MORE_COLORS: Record<string, string> = {
  screen: '#6E93A0', board: '#C96F4A', budget: '#96829F', goals: '#4C7D8C', inbox: '#C0A058',
  matrix: '#7E9A6B', notes: '#A29272', people: '#B5858F',
  settings: '#C0A058', admin: '#B95F52',
}

function Dock() {
  const view = useLedger((s) => s.view)
  const setView = useLedger((s) => s.setView)
  const openEntry = useLedger((s) => s.openEntry)
  const moreOpen = useLedger((s) => s.moreOpen)
  const setMoreOpen = useLedger((s) => s.setMoreOpen)
  const dockOptional = useLedger((s) => s.dockOptional)
  const dockConfig = useLedger((s) => s.dockConfig)
  const user = useLedger((s) => s.user)

  /* tools the user has enabled (More sheet + dock membership obey this).
   * Until the DB config loads, treat every tool as enabled. */
  const enabled = dockConfig?.enabled
  const isEnabled = (id: ViewId) => !enabled || enabled.includes(id)

  const dockTools = dockOptional.filter((id) => isEnabled(id))
  const navItems: ViewId[] = ['today', 'week', 'month', ...dockTools]
  /* every enabled tool that isn't pinned to the dock — so an unpinned
   * tool (e.g. Habits with its dock slot removed) stays reachable */
  const moreTools = MORE_ITEMS.filter((id) => isEnabled(id) && !dockTools.includes(id))

  return (
    <>
      {/* v11: the dock is one bar — nav on the left, Add on the right.
       * The Add button shares the dock's body and styling. */}
      <div className="dock" id="dock">
        <nav className="dock-row" aria-label="Main navigation">
          {navItems.map((id) => (
            <button
              key={id}
              className={`dock-btn nav-btn${view === id ? ' active' : ''}`}
              onClick={() => setView(id)}
              aria-label={VIEW_TITLES[id]}
              aria-current={view === id ? 'page' : undefined}
            >
              <span className="d-icon"><I name={DOCK_ICONS[id]} /></span>
              <span className="d-label">{VIEW_TITLES[id]}</span>
            </button>
          ))}
          <button
            className={`dock-btn nav-btn${TOOL_LIST.includes(view) && !dockTools.includes(view) ? ' active' : ''}`}
            onClick={() => setMoreOpen(!moreOpen)}
            aria-expanded={moreOpen}
            aria-label="More options"
          >
            <span className="d-icon"><I name="dots" /></span>
            <span className="d-label">More</span>
          </button>
          <span className="dock-sep" aria-hidden />
          <button
            className="dock-btn add-dock-btn"
            onClick={() => openEntry('record')}
            aria-label="Add new entry"
            title="Add new entry"
            style={{ background: 'var(--accent)', borderRadius: 12 }}
          >
            <span className="d-icon"><I name="plus" /></span>
            <span className="d-label">Add</span>
          </button>
        </nav>
      </div>

      {/* More sheet — Settings + Admin settings first (always visible without
       * scrolling), then the enabled tools */}
      <div className={`sheet-scrim${moreOpen ? ' open' : ''}`} onClick={() => setMoreOpen(false)} />
      <div className={`sheet${moreOpen ? ' open' : ''}`} style={{ bottom: 'calc(var(--dock-h) + 26px)' }}>
        <div className="sheet-handle" />
        <button
          className="sheet-item"
          onClick={() => { useLedger.getState().setSettingsOpen(true); setMoreOpen(false) }}
        >
          <span className="s-ic" style={{ color: MORE_COLORS.settings }}><I name="gear" /></span>
          Settings
        </button>
        {user?.role === 'admin' && (
          <button
            className="sheet-item"
            onClick={() => { useLedger.getState().setAdminOpen(true); setMoreOpen(false) }}
          >
            <span className="s-ic" style={{ color: MORE_COLORS.admin }}><I name="shield" /></span>
            Admin settings
          </button>
        )}
        <div className="sheet-divider" />
        {moreTools.length > 0 ? moreTools.map((id) => (
          <button
            key={id}
            className={`sheet-item${view === id ? ' active' : ''}`}
            onClick={() => setView(id)}
          >
            <span className="s-ic" style={{ color: MORE_COLORS[id] }}><I name={DOCK_ICONS[id]} /></span>
            {VIEW_TITLES[id]}
          </button>
        )) : (
          <p className="note" style={{ fontSize: '.8rem', textAlign: 'center', padding: '6px 0' }}>
            No tools enabled — turn some on in Settings.
          </p>
        )}
      </div>
    </>
  )
}

/* ---------- topbar ---------- */

function TopBar() {
  const user = useLedger((s) => s.user)
  const logout = useLedger((s) => s.logout)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  if (!user) return null

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-icon"><I name="spark" /></span>
        <span className="brand-name">Ledger</span>
      </div>
      <div className="topbar-right">
        {/* v11: the profile chip opens a small profile menu — NOT settings.
         * Settings and Admin settings live in the More sheet. */}
        <div className="profile-wrap" ref={menuRef}>
          <button
            className="avatar-chip"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Profile"
            type="button"
          >
            <span className="avatar" style={{ background: userColor(user.name) }}>{user.name[0]}</span>
            <span className="uname">{user.name}</span>
            <span className="urole">{user.role}</span>
          </button>
          {menuOpen && (
            <div className="profile-menu" role="menu">
              <div className="profile-menu-head">
                <div className="pm-name">{user.name}</div>
                <div className="pm-role">{user.role}</div>
              </div>
              <button className="profile-menu-item danger" role="menuitem" onClick={() => { setMenuOpen(false); void logout() }}>
                <I name="x" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

/* ---------- impersonation banner (admin logged in as a user) ---------- */

function ImpersonationBanner() {
  const impersonatedBy = useLedger((s) => s.impersonatedBy)
  const switchBack = useLedger((s) => s.switchBack)
  const user = useLedger((s) => s.user)
  if (!impersonatedBy || !user) return null
  return (
    <div className="imp-banner">
      <I name="shield" /> viewing as {user.name}
      <button onClick={() => void switchBack()}>switch back</button>
    </div>
  )
}

/* ---------- the shell ---------- */

const VIEWS: Record<ViewId, React.ComponentType> = {
  today: TodayView, week: WeekView, month: MonthView, habits: HabitsView, board: BoardView,
  budget: BudgetView, goals: GoalsView, inbox: InboxView, matrix: MatrixView, notes: NotesView,
  people: PeopleView, screen: ScreenTimeView,
}

export default function AppShell() {
  const view = useLedger((s) => s.view)
  const dockConfig = useLedger((s) => s.dockConfig)

  /* dock height → CSS var (content, sheets and toasts must clear it) */
  useEffect(() => {
    const dock = document.getElementById('dock')
    if (!dock) return
    const measure = () => document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight + 28}px`)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(dock)
    return () => ro.disconnect()
  }, [])

  /* if the current view's tool got disabled, fall back to Today */
  useEffect(() => {
    if (!dockConfig?.enabled) return
    if (TOOL_LIST.includes(view) && !dockConfig.enabled.includes(view)) {
      useLedger.getState().setView('today')
    }
  }, [dockConfig, view])

  const View = VIEWS[view]

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <ImpersonationBanner />
      <TopBar />
      <main className="content" id="main-content">
        <div key={view} className="view active">
          <View />
        </div>
      </main>
      <Dock />
      <EntrySheet />
      <FocusModal />
      <SettingsModal />
      <AdminPanel />
      <Toast />
    </>
  )
}
