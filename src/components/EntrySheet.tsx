'use client'
/* EntrySheet — the ways in: Record (speech→LLM→preview), Paste (NL or raw
 * JSON), Manual, Timer, Focus. Everything ends in the server-side merge.
 * v11: opens with LLM recommendations for what to record or write about,
 * and hosts the focus session (moved here from the top bar). */

import { useEffect, useRef, useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import StructuredPreview from '@/components/StructuredPreview'
import { FocusTimer } from '@/components/FocusModal'
import { Speech } from '@/lib/speech'
import { LLM } from '@/lib/llm'
import { validateDelta, type ValidatedDelta } from '@/lib/derivations'
import { toMin, hmDate, todayStr } from '@/lib/dates'
import type { EntryRecommendation, MergeResult } from '@/lib/types'

type Preview = { delta: ValidatedDelta; skipped: string[] } | null

const TABS = [
  { id: 'record', icon: 'mic', label: 'Record' },
  { id: 'paste', icon: 'paste', label: 'Paste' },
  { id: 'manual', icon: 'pencil', label: 'Manual' },
  { id: 'timer', icon: 'clock', label: 'Timer' },
  { id: 'focus', icon: 'target', label: 'Focus' },
] as const

const KIND_LABELS: Record<EntryRecommendation['kind'], string> = {
  activity: 'log',
  habit: 'habit',
  note: 'note',
  checkin: 'reflect',
  screen: 'screen',
}

export default function EntrySheet() {
  const entryOpen = useLedger((s) => s.entryOpen)

  /* the inner sheet mounts fresh on every open — its recommendation fetch
   * starts from clean state without sync setState inside an effect */
  if (!entryOpen) return null
  return <EntrySheetInner />
}

function EntrySheetInner() {
  const entryTab = useLedger((s) => s.entryTab)
  const setEntryTab = useLedger((s) => s.setEntryTab)
  const closeSheets = useLedger((s) => s.closeSheets)

  const [recs, setRecs] = useState<EntryRecommendation[] | null>(null)
  const [recsBusy, setRecsBusy] = useState(true)
  const [prefill, setPrefill] = useState<{ label?: string; goalId?: string; text?: string }>({})

  /* fetch LLM recommendations each time the sheet opens */
  useEffect(() => {
    let cancelled = false
    fetch('/api/recommendations')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.recommendations) setRecs(data.recommendations.slice(0, 4))
      })
      .catch(() => { /* recommendations are optional */ })
      .finally(() => { if (!cancelled) setRecsBusy(false) })
    return () => { cancelled = true }
  }, [])

  function applyRec(r: EntryRecommendation) {
    if (r.kind === 'activity' || r.kind === 'screen') {
      setPrefill({ label: r.text, goalId: r.goalId })
      setEntryTab('manual')
    } else {
      setPrefill({ text: r.text })
      setEntryTab('record')
    }
  }

  return (
    <>
      <div className="sheet-scrim open" onClick={closeSheets} />
      <div className="sheet open" role="dialog" aria-label="Add to the ledger" style={{ bottom: 'calc(var(--dock-h) + 26px)' }}>
        <div className="sheet-handle" />

        {/* v11: LLM recommendations on what to record or write about
            (hidden on the Focus tab — the timer needs the room) */}
        {entryTab !== 'focus' && (
        <div className="rec-section">
          <span className="rec-head"><I name="spark" /> worth writing down</span>
          {recsBusy && recs === null ? (
            <p className="rec-hint">thinking about your day…</p>
          ) : recs && recs.length > 0 ? (
            <div className="rec-list">
              {recs.map((r, i) => (
                <button key={i} className="rec-item" onClick={() => applyRec(r)} type="button">
                  <span className="ri-icon"><I name={r.kind === 'screen' ? 'phone' : r.kind === 'habit' ? 'check' : r.kind === 'note' ? 'file' : r.kind === 'checkin' ? 'compass' : 'clock'} /></span>
                  <span className="ri-text">{r.text}</span>
                  <span className="ri-kind">{KIND_LABELS[r.kind] ?? 'log'}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rec-hint">no ideas right now — your book looks complete</p>
          )}
        </div>
        )}

        <div className="segmented" style={{ marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`seg-btn${entryTab === t.id ? ' active' : ''}`}
              onClick={() => setEntryTab(t.id)}
              aria-pressed={entryTab === t.id}
            >
              <I name={t.icon} /> {t.label}
            </button>
          ))}
        </div>
        {entryTab === 'record' && <RecordTab prefillText={prefill.text} />}
        {entryTab === 'paste' && <PasteTab />}
        {entryTab === 'manual' && <ManualTab prefillLabel={prefill.label} prefillGoal={prefill.goalId} />}
        {entryTab === 'timer' && <TimerTab />}
        {entryTab === 'focus' && <FocusTimer onLogged={closeSheets} />}
      </div>
    </>
  )
}

/* ================= Record ================= */

function RecordTab({ prefillText }: { prefillText?: string }) {
  const ledger = useLedger((s) => s.ledger)!
  const showToast = useLedger((s) => s.showToast)
  const setSettingsOpen = useLedger((s) => s.setSettingsOpen)
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [finalText, setFinalText] = useState('')
  const [showType, setShowType] = useState(!Speech.supported || !!prefillText)
  const [typed, setTyped] = useState(prefillText ?? '')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<Preview>(null)

  useEffect(() => () => Speech.stop(), [])

  function toggleMic() {
    if (!Speech.supported) { setShowType(true); return }
    if (recording) {
      Speech.stop()
      setRecording(false)
    } else {
      setFinalText('')
      setTranscript('')
      setRecording(true)
      const ok = Speech.start({
        onLive: (text) => { if (text) setTranscript(text) },
        onDone: (text) => {
          setRecording(false)
          const t = text.trim()
          setFinalText(t)
          if (t) setTranscript(t)
          else setTranscript('Nothing caught — try again, or type it below.')
        },
        onErr: (msg) => {
          setRecording(false)
          setTranscript(`Dictation stopped (${msg}) — you can still type your day below.`)
          setShowType(true)
        },
      })
      if (!ok) setRecording(false)
    }
  }

  async function structure(spoken: boolean) {
    const text = spoken ? finalText : typed
    if (!text.trim()) { showToast(spoken ? 'Nothing was recorded.' : 'Type your day first.'); return }
    if (!LLM.configured()) { showToast('Configure the LLM first — Settings'); setSettingsOpen(true); return }
    setStatus('busy')
    try {
      const raw = await LLM.structureDay(text, ledger)
      const v = validateDelta(ledger, raw)
      setStatus('')
      const empty = !v.delta.activities.length && !v.delta.habits.length && !v.delta.newNotes.length
        && !v.delta.highlight && !v.delta.checkIn && !v.delta.metrics.length
      if (empty && !v.skipped.length) {
        setStatus('Nothing recognizable in that — try mentioning what you did and when.')
        return
      }
      setPreview(v)
    } catch (e) {
      setStatus('')
      showToast(LLM.err('The LLM balked', e))
    }
  }

  return (
    <div>
      <div className="entry-record">
        <button
          className={`mic-btn${recording ? ' recording' : ''}`}
          onClick={toggleMic}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
          style={!Speech.supported ? { opacity: 0.45 } : undefined}
        >
          <I name={recording ? 'stop' : 'mic'} size={30} />
        </button>
        {recording && (
          <div className="waveform">
            {Array.from({ length: 7 }, (_, i) => <span key={i} />)}
          </div>
        )}
        <div id="transcriptArea" className="note" style={{ fontSize: '0.92rem', textAlign: 'center', minHeight: 44, maxWidth: 420 }}>
          {recording
            ? (transcript ? `"${transcript}"` : 'Listening…')
            : transcript
              ? <em>&quot;{transcript}&quot;</em>
              : Speech.supported ? 'Tap to start recording' : "This browser can't dictate — type your day below"}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {!recording && finalText && (
            <RoughBtn className="btn-sm" onClick={() => structure(true)}><I name="spark" /> Structure this</RoughBtn>
          )}
          <RoughBtn className="btn-sm" onClick={() => { setShowType((v) => !v) }}><I name="pencil" /> Or type it</RoughBtn>
        </div>
        <div className="note" style={{ fontSize: '.74rem', minHeight: '1.2em', textAlign: 'center' }}>
          {status === 'busy' ? (
            <span className="llm-busy">
              <span className="waveform" style={{ height: 14 }}>{Array.from({ length: 5 }, (_, i) => <span key={i} />)}</span>
              listening to your words with {LLM.modelLabel()}…
            </span>
          ) : status}
        </div>
      </div>

      {showType && (
        <div style={{ marginTop: 6 }}>
          <textarea
            className="textarea"
            id="speechTypeArea"
            placeholder="Type your day — e.g. worked on the proposal 9 to 12:30, gym 5 to 6, meditated this morning. Note: book physio for Friday."
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{ width: '100%', minHeight: 90 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <RoughBtn variant="primary" className="btn-sm" onClick={() => structure(false)}><I name="spark" /> Structure it</RoughBtn>
            <span className="note" style={{ fontSize: '.74rem' }}>natural language in, structured ledger out</span>
          </div>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 12 }}>
          <StructuredPreview
            result={preview}
            onDone={() => { setPreview(null); setFinalText(''); setTranscript(''); setTyped('') }}
            onDiscard={() => setPreview(null)}
          />
        </div>
      )}
    </div>
  )
}

/* ================= Paste ================= */

function PasteTab() {
  const ledger = useLedger((s) => s.ledger)!
  const mergeDeltas = useLedger((s) => s.mergeDeltas)
  const showToast = useLedger((s) => s.showToast)
  const setSettingsOpen = useLedger((s) => s.setSettingsOpen)
  const closeSheets = useLedger((s) => s.closeSheets)
  const [mode, setMode] = useState<'nl' | 'json'>('nl')
  const [nl, setNl] = useState('')
  const [nlStatus, setNlStatus] = useState('')
  const [preview, setPreview] = useState<Preview>(null)
  const [json, setJson] = useState('')
  const [jsonStatus, setJsonStatus] = useState('')

  async function structureNL() {
    if (!nl.trim()) { setNlStatus('Say something first.'); return }
    if (!LLM.configured()) { showToast('Configure the LLM first — Settings'); setSettingsOpen(true); return }
    setNlStatus('busy')
    try {
      const raw = await LLM.structureDay(nl, ledger)
      const v = validateDelta(ledger, raw)
      setNlStatus('')
      const empty = !v.delta.activities.length && !v.delta.habits.length && !v.delta.newNotes.length
        && !v.delta.highlight && !v.delta.checkIn && !v.delta.metrics.length
      if (empty && !v.skipped.length) {
        setNlStatus('Nothing recognizable in that.')
        return
      }
      setPreview(v)
    } catch (e) {
      setNlStatus('')
      showToast(LLM.err('The LLM balked', e))
    }
  }

  async function mergeJSON() {
    if (!json.trim()) { setJsonStatus('Paste something first.'); return }
    try {
      const p = JSON.parse(json) as Record<string, unknown> | Array<Record<string, unknown>>
      const ds = Array.isArray(p) ? p : [p]
      const results: MergeResult[] = []
      let skipped = 0
      for (const d of ds) {
        if (!d || typeof d !== 'object') throw new Error('delta needs to be an object')
        if (!d.date) throw new Error('delta needs a "date" field')
        const r = await mergeDeltas([d as object])
        if ('error' in r) throw new Error(r.error)
        results.push(...r.results)
        skipped += r.results[0]?.skipped.length ?? 0
      }
      setJsonStatus(`Merged ${ds.length} day${ds.length > 1 ? 's' : ''} in.${skipped ? ` Skipped: ${skipped} unknown item${skipped > 1 ? 's' : ''}.` : ''}`)
      setJson('')
      showToast('Merged into ledger ✓')
      setTimeout(() => closeSheets(), 700)
    } catch (err) {
      setJsonStatus(`Couldn't merge: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  return (
    <div>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={`seg-btn${mode === 'nl' ? ' active' : ''}`} onClick={() => setMode('nl')}><I name="mic" /> Natural language</button>
        <button className={`seg-btn${mode === 'json' ? ' active' : ''}`} onClick={() => setMode('json')}><I name="paste" /> Raw JSON</button>
      </div>

      {mode === 'nl' ? (
        <div>
          <textarea
            placeholder="Tell the ledger about your day in plain words — the LLM turns it into a structured delta you review before merging."
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            style={{ width: '100%', minHeight: 100 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <RoughBtn variant="primary" className="btn-sm" onClick={structureNL}><I name="spark" /> Structure &amp; preview</RoughBtn>
            <span className="note" style={{ fontSize: '.8rem' }}>
              {nlStatus === 'busy' ? (
                <span className="llm-busy">
                  <span className="waveform" style={{ height: 14 }}>{Array.from({ length: 5 }, (_, i) => <span key={i} />)}</span>
                  thinking…
                </span>
              ) : nlStatus}
            </span>
          </div>
          {preview && (
            <div style={{ marginTop: 12 }}>
              <StructuredPreview result={preview} onDone={() => { setPreview(null); setNl('') }} onDiscard={() => setPreview(null)} />
            </div>
          )}
        </div>
      ) : (
        <div>
          <textarea
            placeholder={`{"date":"${todayStr()}","highlight":"Shipped the demo","activities":[{"goalId":"deep-work","hours":1.5,"start":"14:00","end":"15:30"}],"habits":[{"habitId":"meditate","done":true}],"newNotes":["Deadline: send tax docs Friday"]}`}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            style={{ width: '100%', minHeight: 110 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <RoughBtn variant="primary" className="btn-sm" onClick={mergeJSON}>Merge into ledger</RoughBtn>
            <span className="note" style={{ fontSize: '.8rem' }}>{jsonStatus}</span>
          </div>
          <p className="field-hint">merge contract: activities append, habits/metrics set, checkIn/highlight replace, notes append — nothing is ever deleted</p>
        </div>
      )}
    </div>
  )
}

/* ================= Manual ================= */

function ManualTab({ prefillLabel, prefillGoal }: { prefillLabel?: string; prefillGoal?: string }) {
  const ledger = useLedger((s) => s.ledger)!
  const mergeDeltas = useLedger((s) => s.mergeDeltas)
  const showToast = useLedger((s) => s.showToast)
  const closeSheets = useLedger((s) => s.closeSheets)
  const [label, setLabel] = useState(prefillLabel ?? '')
  const [goalId, setGoalId] = useState(prefillGoal ?? ledger.goals[0]?.id ?? '')
  const [date, setDate] = useState(todayStr())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!label.trim()) { showToast('Give it a label.'); return }
    if (!from || !to) { showToast('Need both from and to times.'); return }
    const mins = toMin(to) - toMin(from)
    if (mins <= 0) { showToast('The end has to be after the start.'); return }
    const hours = +(mins / 60).toFixed(2)
    const r = await mergeDeltas([{
      date: date || todayStr(),
      activities: [{ goalId: goalId || ledger.goals[0]?.id, hours, start: from, end: to, label: label.trim() }],
    }])
    if ('error' in r) { showToast(r.error); return }
    showToast(`Added ${hours}h (${from}–${to}) → ${ledger.goals.find((g) => g.id === goalId)?.name ?? goalId} ✓`)
    closeSheets()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
        What did you do?
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Deep work on proposal" />
      </label>
      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
        Goal
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          {ledger.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ flex: 1, minWidth: 120, fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label style={{ flex: 1, minWidth: 90, fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          From
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ flex: 1, minWidth: 90, fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          To
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>Duration is worked out from the from/to times — add several entries for split sessions.</p>
      <RoughBtn variant="primary" type="submit" className="btn-block">Save entry</RoughBtn>
    </form>
  )
}

/* ================= Timer ================= */

function timerFmt(s: number) {
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const x = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${x}`
}

function TimerTab() {
  const ledger = useLedger((s) => s.ledger)!
  const mergeDeltas = useLedger((s) => s.mergeDeltas)
  const showToast = useLedger((s) => s.showToast)
  const closeSheets = useLedger((s) => s.closeSheets)
  const [label, setLabel] = useState('')
  const [goalId, setGoalId] = useState(ledger.goals[0]?.id ?? '')
  const [sec, setSec] = useState(0)
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState<Date | null>(null)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  function startPause() {
    if (running && !paused) {
      /* pause */
      if (timerRef.current) clearInterval(timerRef.current)
      setPaused(true)
      return
    }
    if (!startedAt) setStartedAt(new Date())
    setRunning(true)
    setPaused(false)
    timerRef.current = setInterval(() => setSec((s) => s + 1), 1000)
  }

  async function stopSave() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (sec > 0) {
      if (sec < 60) {
        showToast('Under a minute — not worth the ink.')
      } else {
        const hrs = +(sec / 3600).toFixed(2)
        const endD = new Date()
        const delta = {
          date: todayStr(),
          activities: [{
            goalId: goalId || ledger.goals[0]?.id,
            hours: hrs,
            start: startedAt ? hmDate(startedAt) : undefined,
            end: hmDate(endD),
            label: label.trim() || undefined,
          }],
        }
        const r = await mergeDeltas([delta])
        if ('error' in r) { showToast(r.error); return }
        showToast(`Logged ${timerFmt(sec)} → ${ledger.goals.find((g) => g.id === goalId)?.name ?? goalId} ✓`)
        closeSheets()
      }
    }
    setSec(0)
    setRunning(false)
    setPaused(false)
    setStartedAt(null)
  }

  return (
    <div className="timer-face">
      <div className="timer-digits">{timerFmt(sec)}</div>
      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
        What are you timing?
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Deep work session" />
      </label>
      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
        Goal
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          {ledger.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <RoughBtn variant="primary" onClick={startPause}>{running && !paused ? 'Pause' : paused ? 'Resume' : 'Start'}</RoughBtn>
        <RoughBtn onClick={stopSave} disabled={sec === 0}>Stop &amp; save</RoughBtn>
      </div>
      <p className="field-hint" style={{ marginTop: 10 }}>The real clock start/stop is recorded, so the timeline places it correctly.</p>
    </div>
  )
}
