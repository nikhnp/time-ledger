'use client'

import { useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { Stamp, ViewHead, NoteRow, EmptyNote } from '@/components/bits'
import { LLM } from '@/lib/llm'

export default function NotesView() {
  const ledger = useLedger((s) => s.ledger)!
  const deleteNote = useLedger((s) => s.deleteNote)
  const showToast = useLedger((s) => s.showToast)
  const setSettingsOpen = useLedger((s) => s.setSettingsOpen)
  const addImportantDate = useLedger((s) => s.addImportantDate)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const notes = [...ledger.notes]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .filter((n) => !q || n.text.toLowerCase().includes(q.toLowerCase()))

  async function extract(noteId: string) {
    const n = ledger.notes.find((x) => x.id === noteId)
    if (!n) return
    if (!LLM.configured()) { showToast('Configure the LLM first — Settings'); setSettingsOpen(true); return }
    setBusy(noteId)
    try {
      const d = await LLM.extractDate(n.text)
      if (!d) showToast('No clear date in that note.')
      else {
        const dup = ledger.importantDates.some((x) => x.date === d.date && x.label.trim().toLowerCase() === d.label.trim().toLowerCase())
        if (dup) showToast(`Already in Coming up: ${d.label}`)
        else if (await addImportantDate(d.label, d.date, d.type)) showToast(`Added to Coming up: ${d.label} — ${d.date} ✓`)
      }
    } catch (e) {
      showToast(LLM.err('The LLM balked', e))
    }
    setBusy(null)
  }

  return (
    <>
      <ViewHead title="Notes" sub="everything jotted down, searchable" />
      <div className="card">
        <Stamp icon="file">All notes</Stamp>
        <input
          type="text"
          className="note-search"
          placeholder="Search notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <p className="chart-note" style={{ margin: '0 0 10px' }}>
          flagged notes carry a calendar button — the LLM reads them and adds real dates to Coming up
        </p>
        {notes.length > 0
          ? notes.map((n) => <NoteRow key={n.id} note={n} showDate onDelete={deleteNote} onExtract={busy ? undefined : extract} />)
          : <EmptyNote>{q ? `Nothing matches "${q}".` : 'No notes yet.'}</EmptyNote>}
      </div>
    </>
  )
}
