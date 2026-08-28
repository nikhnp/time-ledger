'use client'

import { useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import { Stamp, ViewHead, EmptyNote } from '@/components/bits'

export default function InboxView() {
  const ledger = useLedger((s) => s.ledger)!
  const addInboxItem = useLedger((s) => s.addInboxItem)
  const inboxToTask = useLedger((s) => s.inboxToTask)
  const inboxToNote = useLedger((s) => s.inboxToNote)
  const deleteInboxItem = useLedger((s) => s.deleteInboxItem)
  const [input, setInput] = useState('')
  const [picking, setPicking] = useState<string | null>(null)

  async function capture() {
    if (!input.trim()) { useLedger.getState().showToast('Capture something first.'); return }
    await addInboxItem(input.trim())
    setInput('')
    useLedger.getState().showToast('Captured ✓')
  }

  return (
    <>
      <ViewHead title="Inbox" sub="quick capture, triage later" />
      <div className="card">
        <Stamp icon="mail">Captured</Stamp>
        <div className="inbox-add">
          <input
            type="text"
            placeholder="Capture a thought…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') capture() }}
          />
          <RoughBtn variant="primary" className="btn-sm" onClick={capture}><I name="plus" /> Capture</RoughBtn>
        </div>
        {ledger.inbox.length > 0 ? ledger.inbox.map((it) => (
          <div className="inbox-row" key={it.id}>
            <span className="inbox-text">{it.text}</span>
            <span className="inbox-actions">
              {picking === it.id ? (
                <>
                  <select
                    className="inbox-goal-pick"
                    defaultValue={ledger.goals[0]?.id}
                    onChange={(e) => { inboxToTask(it.id, e.target.value); setPicking(null) }}
                    aria-label="Pick goal"
                  >
                    {ledger.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <RoughBtn className="btn-sm" onClick={() => setPicking(null)}>×</RoughBtn>
                </>
              ) : (
                <>
                  <RoughBtn className="btn-sm" onClick={() => setPicking(it.id)}>→ Task</RoughBtn>
                  <RoughBtn className="btn-sm" onClick={() => inboxToNote(it.id)}>→ Note</RoughBtn>
                  <RoughBtn className="btn-sm" onClick={() => deleteInboxItem(it.id)} title="Dismiss">✓</RoughBtn>
                </>
              )}
            </span>
          </div>
        )) : <EmptyNote>Inbox zero. Capture something above.</EmptyNote>}
      </div>
    </>
  )
}
