'use client'

import { useEffect, useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import type { AdminUserRow, AdminActionLogT, UserBackupT } from '@/lib/types'

/**
 * AdminPanel — admin-only UI for managing users.
 *
 * Features:
 *   - List all users with status (active/inactive, last seen, role)
 *   - Deactivate / Activate users
 *   - Promote to admin / Demote from admin (max 2 admins enforced server-side)
 *   - Force logout (kills all sessions for that user)
 *   - Generate reset link (returns a shareable URL)
 *   - Backup single user's data
 *   - Login as user (impersonation — admin gets a 4-hour session as that user)
 *   - Delete user
 *
 * Plus:
 *   - Backup ALL users (button at top)
 *   - Restore from any backup
 *
 * Only renders for admin users. Visibility controlled by `adminOpen` store flag.
 */
export default function AdminPanel() {
  const open = useLedger((s) => s.adminOpen)
  const setAdminOpen = useLedger((s) => s.setAdminOpen)
  const user = useLedger((s) => s.user)
  const adminUsers = useLedger((s) => s.adminUsers)
  const adminActions = useLedger((s) => s.adminActions)
  const adminBackups = useLedger((s) => s.adminBackups)
  const fetchAdminUsers = useLedger((s) => s.fetchAdminUsers)
  const adminUserAction = useLedger((s) => s.adminUserAction)
  const adminDeleteUser = useLedger((s) => s.adminDeleteUser)
  const adminBackupUser = useLedger((s) => s.adminBackupUser)
  const adminBackupAll = useLedger((s) => s.adminBackupAll)
  const adminRestoreBackup = useLedger((s) => s.adminRestoreBackup)
  const fetchAdminBackups = useLedger((s) => s.fetchAdminBackups)
  const adminLoginAs = useLedger((s) => s.adminLoginAs)
  const showToast = useLedger((s) => s.showToast)

  const [tab, setTab] = useState<'users' | 'llm' | 'backups' | 'audit'>('users')
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    if (open && user?.role === 'admin') {
      fetchAdminUsers()
      fetchAdminBackups()
    }
  }, [open, user, fetchAdminUsers, fetchAdminBackups])

  if (!open || !user || user.role !== 'admin') return null

  async function handleAction(targetId: string, action: string, name: string) {
    const confirmMsg = action === 'delete'
      ? `Delete user "${name}"? This permanently removes all their data.`
      : action === 'login_as'
        ? `Log in as "${name}"? Your admin session will be replaced (4-hour limit).`
        : action === 'deactivate'
          ? `Deactivate "${name}"? They will be signed out and cannot log in.`
          : action === 'promote'
            ? `Promote "${name}" to admin? Max 2 admins allowed.`
            : `Perform "${action}" on "${name}"?`
    if (!confirm(confirmMsg)) return
    const err = await adminUserAction(targetId, action)
    if (err) showToast(err)
    else if (action === 'login_as') { /* boot() handled inside store */ }
  }

  async function handleDelete(targetId: string, name: string) {
    if (!confirm(`DELETE USER "${name}"?\n\nThis permanently removes ALL their data: goals, tasks, habits, days, activities, notes, inbox items, sessions, and LLM settings.\n\nThis cannot be undone. Consider backing up first.`)) return
    const err = await adminDeleteUser(targetId)
    if (err) showToast(err)
  }

  return (
    <div className="admin-panel" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <div className="admin-panel-card">
        <div className="admin-panel-head">
          <h2 className="admin-panel-title" id="admin-title">Admin</h2>
          <button
            className="admin-panel-close"
            onClick={() => setAdminOpen(false)}
            aria-label="Close admin panel"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="admin-tabs" role="tablist">
          <button className={`admin-tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')} role="tab" type="button">Users</button>
          <button className={`admin-tab${tab === 'llm' ? ' active' : ''}`} onClick={() => setTab('llm')} role="tab" type="button">LLM</button>
          <button className={`admin-tab${tab === 'backups' ? ' active' : ''}`} onClick={() => setTab('backups')} role="tab" type="button">Backups</button>
          <button className={`admin-tab${tab === 'audit' ? ' active' : ''}`} onClick={() => setTab('audit')} role="tab" type="button">Audit log</button>
        </div>

        {tab === 'users' && (
          <div className="admin-section">
            <div className="admin-section-head">
              All users ({adminUsers?.length ?? 0})
              <button
                className="admin-action-btn primary"
                onClick={async () => {
                  if (!confirm('Backup ALL users? This may take a moment.')) return
                  const err = await adminBackupAll()
                  if (err) showToast(err)
                }}
                type="button"
              >
                Backup all
              </button>
            </div>

            {!adminUsers || adminUsers.length === 0 ? (
              <div className="consistency-empty">No users found.</div>
            ) : (
              adminUsers.map((u) => (
                <div className="admin-user-row" key={u.id}>
                  <div className="admin-user-name">
                    {u.name}
                    <span className={`role-badge ${u.role}`}>{u.role}</span>
                    {!u.isActive && <span className="admin-user-status inactive"> · deactivated</span>}
                  </div>
                  <div className="admin-user-status">
                    {u.lastActive ? `Last active: ${new Date(u.lastActive).toLocaleDateString()}` : 'Never signed in'}
                  </div>
                  <div className="admin-user-status">
                    Joined: {new Date(u.createdAt).toLocaleDateString()}
                  </div>
                  <div className="admin-user-actions">
                    {u.isActive ? (
                      <button className="admin-action-btn" onClick={() => handleAction(u.id, 'deactivate', u.name)} type="button">Deactivate</button>
                    ) : (
                      <button className="admin-action-btn" onClick={() => handleAction(u.id, 'activate', u.name)} type="button">Activate</button>
                    )}
                    {u.role === 'member' ? (
                      <button className="admin-action-btn" onClick={() => handleAction(u.id, 'promote', u.name)} type="button">Promote</button>
                    ) : (
                      <button className="admin-action-btn" onClick={() => handleAction(u.id, 'demote', u.name)} type="button">Demote</button>
                    )}
                    <button className="admin-action-btn" onClick={() => handleAction(u.id, 'force_logout', u.name)} type="button">Force logout</button>
                    <button className="admin-action-btn" onClick={() => handleAction(u.id, 'reset_link', u.name)} type="button">Reset link</button>
                    <button className="admin-action-btn" onClick={() => handleAction(u.id, 'backup', u.name)} type="button">Backup</button>
                    <button className="admin-action-btn" onClick={() => handleAction(u.id, 'login_as', u.name)} type="button">Login as</button>
                    <button className="admin-action-btn danger" onClick={() => handleDelete(u.id, u.name)} type="button">Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'llm' && (
          <SystemLlmManager />
        )}

        {tab === 'backups' && (
          <div className="admin-section">
            <div className="admin-section-head">
              Backups ({adminBackups?.length ?? 0})
              <button className="admin-action-btn primary" onClick={async () => {
                if (!confirm('Backup ALL users now?')) return
                const err = await adminBackupAll()
                if (err) showToast(err)
              }} type="button">Backup all</button>
            </div>
            {!adminBackups || adminBackups.length === 0 ? (
              <div className="consistency-empty">No backups yet.</div>
            ) : (
              adminBackups.map((b: UserBackupT) => (
                <div className="admin-user-row" key={b.id} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                  <div className="admin-user-name">{b.userName}</div>
                  <div className="admin-user-status">{new Date(b.createdAt).toLocaleString()}</div>
                  <div className="admin-user-status">{(b.sizeBytes / 1024).toFixed(1)} KB</div>
                  <div className="admin-user-actions">
                    <button
                      className="admin-action-btn"
                      onClick={async () => {
                        if (!confirm(`Restore backup for "${b.userName}"? This will WIPE their current data and replace it with this snapshot.`)) return
                        const err = await adminRestoreBackup(b.id)
                        if (err) showToast(err)
                      }}
                      type="button"
                    >
                      Restore
                    </button>
                    <button
                      className="admin-action-btn"
                      onClick={async () => {
                        // Download the backup payload as a JSON file
                        try {
                          const r = await fetch(`/api/admin/backup?id=${encodeURIComponent(b.id)}`)
                          if (!r.ok) { showToast('Failed to download backup'); return }
                          const blob = await r.blob()
                          const a = document.createElement('a')
                          const url = URL.createObjectURL(blob)
                          a.href = url
                          a.download = `backup-${b.userName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${b.createdAt.slice(0, 10)}.json`
                          document.body.appendChild(a)
                          a.click()
                          setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 400)
                        } catch (e) {
                          showToast(`Download failed: ${e instanceof Error ? e.message : 'unknown error'}`)
                        }
                      }}
                      type="button"
                    >
                      Download
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'audit' && (
          <div className="admin-section">
            <div className="admin-section-head">Recent admin actions</div>
            {!adminActions || adminActions.length === 0 ? (
              <div className="consistency-empty">No admin actions logged.</div>
            ) : (
              <div className="admin-actions-log">
                {adminActions.map((a: AdminActionLogT) => (
                  <div className="admin-actions-log-row" key={a.id}>
                    <span className="admin-actions-log-time">{new Date(a.createdAt).toLocaleString()}</span>{' '}
                    <strong>{a.actorName}</strong> {a.action.replace(/_/g, ' ')}{' '}
                    <strong>{a.targetName}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
 * v10.1: SystemLlmManager — admin UI for system-wide LLM settings
 * ============================================================ */

import type { LlmConfigClientT } from '@/lib/types'

const LLM_PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  openai: 'OpenAI',
  cerebras: 'Cerebras',
  openrouter: 'OpenRouter',
  custom: 'Custom (OpenAI-compatible)',
}

const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
  cerebras: 'llama-3.3-70b',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
  custom: '',
}

function SystemLlmManager() {
  const showToast = useLedger((s) => s.showToast)
  const [settings, setSettings] = useState<LlmConfigClientT[]>([])
  const [loading, setLoading] = useState(true)
  const [provider, setProvider] = useState('gemini')
  const [model, setModel] = useState(DEFAULT_MODELS.gemini)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/settings/llm')
      if (!r.ok) {
        if (r.status === 403) { setSettings([]); return }
        throw new Error(`HTTP ${r.status}`)
      }
      const data = await r.json()
      setSettings(data.settings ?? [])
    } catch (e) {
      showToast(`Failed to load LLM settings: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  async function add() {
    if (!apiKey.trim()) { showToast('Enter an API key first.'); return }
    const r = await fetch('/api/settings/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        model: model || DEFAULT_MODELS[provider] || '',
        apiKey: apiKey.trim(),
        baseUrl: provider === 'custom' ? baseUrl || null : null,
        enabled: true,
      }),
    })
    if (!r.ok) {
      const data = await r.json().catch(() => ({}))
      showToast(`Add failed: ${data.error ?? `HTTP ${r.status}`}`)
      return
    }
    setApiKey('')
    showToast('System LLM provider added ✓')
    await load()
  }

  async function toggle(id: string, currentlyEnabled: boolean) {
    const r = await fetch(`/api/settings/llm?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !currentlyEnabled }),
    })
    if (!r.ok) { showToast(`Toggle failed: HTTP ${r.status}`); return }
    await load()
  }

  async function remove(id: string) {
    if (!confirm('Remove this system LLM provider? Users relying on it will fall back to their own settings.')) return
    const r = await fetch(`/api/settings/llm?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) { showToast(`Remove failed: HTTP ${r.status}`); return }
    showToast('System LLM provider removed')
    await load()
  }

  return (
    <div className="admin-section">
      <div className="admin-section-head">System-wide LLM providers</div>
      <p className="field-hint" style={{ marginBottom: 14 }}>
        These are tried in priority order (lower number first) for every user
        who hasn&apos;t set up their own LLM providers in Settings. If a user
        has their own settings, those are tried first; only when those fail do
        we fall back to these system-wide providers.
      </p>

      {loading ? (
        <div className="consistency-empty">Loading…</div>
      ) : settings.length === 0 ? (
        <div className="consistency-empty" style={{ marginBottom: 16 }}>
          No system LLM providers configured yet. Add one below.
        </div>
      ) : (
        <div style={{ marginBottom: 18 }}>
          {settings.map((s) => (
            <div className="llm-setting-row" key={s.id}>
              <div className="llm-setting-info">
                <div className="llm-setting-provider">
                  {LLM_PROVIDER_LABELS[s.provider] ?? s.provider}
                  <span className="llm-setting-badge system">system</span>
                  {!s.enabled && <span className="llm-setting-badge" style={{ background: 'var(--terracotta-soft, #EEDAC8)', color: 'var(--terracotta, #B85C38)' }}>disabled</span>}
                </div>
                <div className="llm-setting-model">{s.model} · priority {s.priority}</div>
                <div className="llm-setting-key">{s.apiKeyMasked}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="admin-action-btn"
                  onClick={() => toggle(s.id, s.enabled)}
                  type="button"
                >
                  {s.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="admin-action-btn danger"
                  onClick={() => remove(s.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="admin-section-head" style={{ fontSize: '0.95rem' }}>Add new system provider</div>
      <div className="llm-form-row">
        <label className="llm-form-label">Provider</label>
        <select value={provider} onChange={(e) => {
          setProvider(e.target.value)
          setModel(DEFAULT_MODELS[e.target.value] ?? '')
        }}>
          {Object.entries(LLM_PROVIDER_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>
      <div className="llm-form-row">
        <label className="llm-form-label">Model</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={DEFAULT_MODELS[provider] ?? 'model name'}
        />
      </div>
      {provider === 'custom' && (
        <div className="llm-form-row">
          <label className="llm-form-label">Base URL (e.g. https://api.example.com/v1)</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
      )}
      <div className="llm-form-row">
        <label className="llm-form-label">API key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="admin-action-btn primary" onClick={add} type="button">
          + Add system provider
        </button>
      </div>
    </div>
  )
}
