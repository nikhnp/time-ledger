'use client'
/* Settings — themes, dock config, LLM provider (BYO key), export/import, account */

import { useState } from 'react'
import { useLedger, type ViewId } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import { Stamp } from '@/components/bits'
import { LLM, LLM_PROVIDERS, type LLMConfig } from '@/lib/llm'
import { presetFor, visibleTools, TOOL_HINTS } from '@/components/AppShellTools'

const THEMES: Array<{ id: 'light' | 'dark' | 'sage' | 'clay' | 'slate'; label: string; dot: string }> = [
  { id: 'light', label: 'Linen', dot: '#F1E9DB' },
  { id: 'dark', label: 'Night', dot: '#15120D' },
  { id: 'sage', label: 'Sage', dot: '#EBEEE0' },
  { id: 'clay', label: 'Clay', dot: '#251C17' },
  { id: 'slate', label: 'Slate', dot: '#E8EBED' },
]

const TOOL_LABELS: Record<string, string> = {
  habits: 'Habits', board: 'Board', budget: 'Budget', goals: 'Goals',
  inbox: 'Inbox', matrix: 'Matrix', notes: 'Notes', people: 'People', screen: 'Screen time',
}

export default function SettingsModal() {
  const open = useLedger((s) => s.settingsOpen)
  const setSettingsOpen = useLedger((s) => s.setSettingsOpen)
  const theme = useLedger((s) => s.theme)
  const setTheme = useLedger((s) => s.setTheme)
  const dockOptional = useLedger((s) => s.dockOptional)
  const setDockOptional = useLedger((s) => s.setDockOptional)
  const user = useLedger((s) => s.user)
  const ledger = useLedger((s) => s.ledger)
  const logout = useLedger((s) => s.logout)
  const setPassword = useLedger((s) => s.setPassword)
  const deleteAccount = useLedger((s) => s.deleteAccount)
  const refresh = useLedger((s) => s.refresh)
  const showToast = useLedger((s) => s.showToast)

  const [cfg, setCfg] = useState<LLMConfig>(() => LLM.cfg())
  const [llmStatus, setLlmStatus] = useState<{ text: string; ok: boolean | null }>({ text: '', ok: null })
  const [testing, setTesting] = useState(false)
  const [pw, setPw] = useState('')

  if (!open || !user) return null
  const me = user

  function saveCfg(next: LLMConfig) {
    setCfg(next)
    LLM.saveCfg(next)
    setLlmStatus({ text: LLM.configured() ? `configured — ${LLM.modelLabel()}` : '', ok: LLM.configured() })
  }

  async function test() {
    saveCfg(cfg)
    if (!LLM.configured()) { setLlmStatus({ text: 'nothing to test — pick a provider and paste a key', ok: false }); return }
    setTesting(true)
    setLlmStatus({ text: 'knocking…', ok: null })
    try {
      const ms = await LLM.test()
      setLlmStatus({ text: `connected ✓ ${LLM.modelLabel()} · ${ms}ms`, ok: true })
    } catch (e) {
      setLlmStatus({ text: LLM.err('no answer', e), ok: false })
    }
    setTesting(false)
  }

  function toggleTool(id: ViewId) {
    if (dockOptional.includes(id)) {
      setDockOptional(dockOptional.filter((x) => x !== id))
    } else {
      if (dockOptional.length >= 2) { showToast('Dock is full — two items max. Remove one first.'); return }
      setDockOptional([...dockOptional, id])
    }
  }

  function exportLedger() {
    if (!ledger) return
    const blob = new Blob([JSON.stringify(ledger, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ledger-${me.name.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 400)
  }

  function importLedger(file: File) {
    const fr = new FileReader()
    fr.onload = () => {
      try {
        const obj = JSON.parse(String(fr.result)) as { days?: unknown }
        if (!obj || !Array.isArray(obj.days)) throw new Error('not a ledger file (missing "days")')
        if (!confirm(`Replace ${me.name}'s ledger with this file? Current data will be overwritten.`)) return
        /* import by merging the full delta via the server */
        fetch('/api/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(obj),
        }).then(() => refresh()).then(() => showToast('Ledger imported ✓'))
          .catch(() => showToast('Import failed'))
      } catch (e) {
        showToast(`Import failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }
    fr.readAsText(file)
  }

  async function savePassword() {
    if (!pw) { showToast('Type a password first.'); return }
    const err = await setPassword(pw)
    if (err) showToast(err)
    else showToast('Password set ✓ (stored hashed on the server)')
    setPw('')
  }

  async function removeAccount() {
    if (!confirm(`Remove ${me.name}'s account and EVERYTHING in it? Goals, habits, days, notes, screen time — all of it. This cannot be undone.`)) return
    const err = await deleteAccount()
    if (err) showToast(err)
  }

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false) }}>
      <div className="modal">
        <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button>
        <Stamp icon="gear">Settings</Stamp>

        <div className="settings-section">
          <p className="settings-h">Appearance</p>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <div
                key={t.id}
                className={`theme-swatch${theme === t.id ? ' active' : ''}`}
                onClick={() => setTheme(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTheme(t.id) } }}
              >
                <div className="theme-dot" style={{ background: t.dot }} />
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {/* v10.3: REMOVED duplicate "Dock items" section — use "Dock customization (v10)" below */}

        {/* v10.3: REMOVED duplicate "LLM — voice & text structuring" section — use "LLM providers (v10)" below */}

        <div className="settings-section">
          <p className="settings-h">Data</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <RoughBtn className="btn-sm" onClick={exportLedger}><I name="download" /> Export JSON</RoughBtn>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              <I name="upload" /> Import JSON
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importLedger(f); e.target.value = '' }}
              />
            </label>
          </div>
          <p className="storage-note">
            this book lives in Postgres (Neon) — every change is written back by the server
          </p>
        </div>

        {/* v10: LLM Settings (server-side, with system-wide + per-user fallback chain) */}
        <V10LlmSection />

        {/* v10: Dock customization (enable/disable + keep in dock checkboxes) */}
        <V10DockSection />

        <div className="settings-section">
          <p className="settings-h">Account</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="New password"
              style={{ border: '1px solid var(--rule)', background: 'var(--paper)', borderRadius: 7, padding: '8px 10px', fontSize: '0.84rem', color: 'var(--ink)' }}
            />
            <RoughBtn className="btn-sm" onClick={savePassword}>Set password</RoughBtn>
          </div>
          <p className="field-hint">At least 8 characters. Stored scrypt-hashed on the server — never in plain text.</p>

          {/* v11: self-serve account removal */}
          <div className="danger-zone">
            <p>Removing your account deletes its ledger, habits, notes and screen time — permanently.</p>
            <RoughBtn className="btn-sm" style={{ color: 'var(--bad)' }} onClick={removeAccount}>
              <I name="trash" /> Remove my account
            </RoughBtn>
          </div>
        </div>

        <RoughBtn className="btn-block" style={{ color: 'var(--blush)' }} onClick={logout}>Log out</RoughBtn>
      </div>
    </div>
  )
}

/* ============================================================
 * v10: LLM Settings — server-side, with system-wide + per-user fallback chain
 * ============================================================ */

import { useEffect } from 'react'
import type { LlmConfigClientT, DockConfigT } from '@/lib/types'

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

function V10LlmSection() {
  const user = useLedger((s) => s.user)
  const fetchLlmSettings = useLedger((s) => s.fetchLlmSettings)
  const saveLlmSetting = useLedger((s) => s.saveLlmSetting)
  const deleteLlmSetting = useLedger((s) => s.deleteLlmSetting)
  const testLlm = useLedger((s) => s.testLlm)
  const showToast = useLedger((s) => s.showToast)

  const [settings, setSettings] = useState<LlmConfigClientT[]>([])
  const [provider, setProvider] = useState('gemini')
  const [model, setModel] = useState(DEFAULT_MODELS.gemini)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const r = await fetchLlmSettings()
    if (r) setSettings(r)
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [])

  async function add() {
    if (!apiKey.trim()) { showToast('Enter an API key first.'); return }
    const err = await saveLlmSetting({
      provider,
      model: model || DEFAULT_MODELS[provider] || '',
      apiKey: apiKey.trim(),
      baseUrl: provider === 'custom' ? baseUrl || null : null,
    })
    if (err) showToast(err)
    else {
      setApiKey('')
      showToast('LLM provider added ✓')
      await load()
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this LLM provider?')) return
    const err = await deleteLlmSetting(id)
    if (err) showToast(err)
    else await load()
  }

  async function test() {
    setTesting(true)
    const err = await testLlm()
    if (err) showToast(`LLM test failed: ${err}`)
    else showToast('LLM connected ✓')
    setTesting(false)
  }

  return (
    <div className="settings-section">
      <p className="settings-h">LLM providers (v10)</p>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        Your settings are saved to the database and used for voice/paste structuring,
        note date extraction, and question suggestions. If yours don&apos;t work,
        the system-wide fallback (set by admin) is used.
      </p>

      {settings.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {settings.map((s) => (
            <div className="llm-setting-row" key={s.id}>
              <div className="llm-setting-info">
                <div className="llm-setting-provider">
                  {LLM_PROVIDER_LABELS[s.provider] ?? s.provider}
                  <span className="llm-setting-badge">you</span>
                </div>
                <div className="llm-setting-model">{s.model}</div>
                <div className="llm-setting-key">{s.apiKeyMasked}</div>
              </div>
              <button className="admin-action-btn danger" onClick={() => remove(s.id)} type="button">Remove</button>
            </div>
          ))}
        </div>
      )}

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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <RoughBtn className="btn-sm" onClick={add} type="button">
          <I name="plus" /> Add provider
        </RoughBtn>
        <RoughBtn className="btn-sm" onClick={test} disabled={testing} type="button">
          <I name="zap" /> Test fallback
        </RoughBtn>
      </div>
    </div>
  )
}

/* ============================================================
 * v10: Dock Customization — enable/disable + keep in dock checkboxes
 * ============================================================ */

const TOOL_LABELS_FULL: Record<string, string> = {
  habits: 'Habits', board: 'Board', budget: 'Budget', goals: 'Goals',
  inbox: 'Inbox', matrix: 'Matrix', notes: 'Notes', people: 'People', screen: 'Screen time',
}

function V10DockSection() {
  const dockConfig = useLedger((s) => s.dockConfig)
  const saveDockConfig = useLedger((s) => s.saveDockConfig)
  const showToast = useLedger((s) => s.showToast)
  const user = useLedger((s) => s.user)
  /* P2-6: People is admin-gated — hidden from non-admins entirely */
  const tools = visibleTools(user?.role)

  /* v11 fix: don't render toggles until the DB-backed config has loaded —
   * otherwise the section starts from a hardcoded ['habits'] state and a
   * single toggle would silently save that wrong state as the whole config. */
  const loaded = !!dockConfig
  const [enabled, setEnabled] = useState<string[] | null>(null)
  const [keepInDock, setKeepInDock] = useState<string[] | null>(null)

  useEffect(() => {
    if (dockConfig) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnabled(dockConfig.enabled)
      setKeepInDock(dockConfig.keepInDock)
    }
  }, [dockConfig])

  if (!loaded || !enabled || !keepInDock) {
    return (
      <div className="settings-section">
        <p className="settings-h">Tools</p>
        <p className="field-hint" style={{ marginBottom: 12, marginTop: 0 }}>Loading your tool setup…</p>
      </div>
    )
  }

  /* capture the narrowed, non-null lists — closures below keep the type */
  const enabledNow = enabled
  const keepInDockNow = keepInDock

  function applyPreset(kind: 'lean' | 'everything') {
    /* lean = the core pipeline; everything = every tool this role can see.
     * Data is never touched — this only changes what's visible. */
    const next: string[] = kind === 'lean' ? presetFor(user?.role) : tools
    const nextKeep = keepInDockNow.filter((t) => next.includes(t))
    setEnabled(next)
    setKeepInDock(nextKeep)
    void saveDockConfig({ enabled: next, keepInDock: nextKeep })
    showToast(kind === 'lean'
      ? 'Lean preset applied — lenses off, data untouched.'
      : 'Everything preset applied — all tools on.')
  }

  function toggleEnabled(tool: string) {
    const next = enabledNow.includes(tool)
      ? enabledNow.filter((t) => t !== tool)
      : [...enabledNow, tool]
    setEnabled(next)
    // If removing from enabled, also remove from keepInDock
    if (!next.includes(tool)) {
      setKeepInDock(keepInDockNow.filter((t) => t !== tool))
    }
    void saveDockConfig({ enabled: next, keepInDock: keepInDockNow.filter((t) => next.includes(t)) })
  }

  function toggleKeepInDock(tool: string) {
    if (!enabledNow.includes(tool)) {
      showToast('Enable the tool first, then you can keep it in the dock.')
      return
    }
    const next = keepInDockNow.includes(tool)
      ? keepInDockNow.filter((t) => t !== tool)
      : keepInDockNow.length >= 2
        ? (showToast('Maximum 2 tools in the dock. Remove one first.'), keepInDockNow)
        : [...keepInDockNow, tool]
    setKeepInDock(next)
    void saveDockConfig({ enabled: enabledNow, keepInDock: next })
  }

  return (
    <div className="settings-section">
      <p className="settings-h">Tools</p>
      <p className="field-hint" style={{ marginBottom: 12, marginTop: 0 }}>
        Turn tools on or off — turning one off hides it and never deletes its data.
        Of the enabled tools, pin up to 2 to the dock with &quot;Keep in dock&quot;;
        the rest stay reachable via the More menu. Today, Week, Month and More are
        always docked.
      </p>
      <div className="dock-presets">
        <span className="dock-presets-label">Presets</span>
        <RoughBtn className="btn-sm" onClick={() => applyPreset('lean')} type="button">Lean</RoughBtn>
        <RoughBtn className="btn-sm" onClick={() => applyPreset('everything')} type="button">Everything</RoughBtn>
      </div>
      {tools.map((id) => {
        const isEnabled = enabledNow.includes(id)
        const isKept = keepInDockNow.includes(id)
        return (
          <div className="dock-config-row" key={id}>
            <div className="dock-config-text">
              <span className="dock-config-label">{TOOL_LABELS_FULL[id]}</span>
              <span className="dock-tool-hint">{TOOL_HINTS[id]}</span>
            </div>
            <div className="dock-config-controls">
              {/* Toggle slider for Enable/Disable */}
              <button
                type="button"
                role="switch"
                aria-checked={isEnabled}
                aria-label={`Enable ${TOOL_LABELS_FULL[id]}`}
                className={`dock-toggle ${isEnabled ? 'on' : 'off'}`}
                onClick={() => toggleEnabled(id)}
              >
                <span className="dock-toggle-track">
                  <span className="dock-toggle-thumb" />
                </span>
                <span className="dock-toggle-label">{isEnabled ? 'On' : 'Off'}</span>
              </button>
              {/* Checkbox for Keep in dock */}
              <label className="dock-config-check" aria-disabled={!isEnabled}>
                <input
                  type="checkbox"
                  checked={isKept}
                  onChange={() => toggleKeepInDock(id)}
                  disabled={!isEnabled}
                />
                <span>Keep in dock</span>
              </label>
            </div>
          </div>
        )
      })}
    </div>
  )
}
