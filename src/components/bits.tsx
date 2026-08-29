'use client'
/* Small shared pieces — rubber-stamp headers, washi tags, view heads, note rows */

import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import { isFlagged } from '@/lib/derivations'
import { fmtDateShort } from '@/lib/dates'
import type { NoteT } from '@/lib/types'
import { useState } from 'react'

export function Stamp({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="stamp">
      <span className="g"><I name={icon} /></span>
      {children}
    </div>
  )
}

export function PanelTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="panel-title">
      <I name={icon} /> {children}
    </div>
  )
}

export function Washi({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return <span className="washi" style={{ background: bg, color }}>{children}</span>
}

export function ViewHead({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <div className="view-head">
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
    </div>
  )
}

export function NoteRow({
  note, showDate, onDelete, onExtract, onEdit,
}: { note: NoteT; showDate?: boolean; onDelete: (id: string) => void; onExtract?: (id: string) => void; onEdit?: (id: string, text: string) => void }) {
  const flagged = isFlagged(note.text)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)

  return (
    <div className="note-row">
      {showDate && <span className="note-date">{fmtDateShort(note.date)}</span>}
      {editing ? (
        <span className="note-text" style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim() && onEdit) { onEdit(note.id, draft.trim()); setEditing(false) }
              if (e.key === 'Escape') { setEditing(false); setDraft(note.text) }
            }}
            style={{ flex: 1, fontSize: '.9rem' }}
            aria-label="Edit note text"
          />
          <button className="note-extract" title="Save" onClick={() => { if (draft.trim() && onEdit) { onEdit(note.id, draft.trim()); setEditing(false) } }}>
            <I name="check" />
          </button>
          <button className="note-del" title="Cancel" onClick={() => { setEditing(false); setDraft(note.text) }}>×</button>
        </span>
      ) : (
        <span className="note-text">
          {note.text}
          {flagged && (
            <span className="washi" style={{ background: 'var(--mustard-soft)', color: 'var(--mustard)', marginLeft: 8 }}>flagged</span>
          )}
        </span>
      )}
      <span className="note-tools">
        {onEdit && !editing && (
          <button className="note-extract" onClick={() => setEditing(true)} title="Edit note">
            <I name="pencil" />
          </button>
        )}
        {flagged && onExtract && (
          <button className="note-extract" onClick={() => onExtract(note.id)} title="Read a date out of this note (LLM)">
            <I name="calplus" />
          </button>
        )}
        <button className="note-del" onClick={() => onDelete(note.id)} title="Delete note">×</button>
      </span>
    </div>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="note" style={{ fontSize: '.85rem' }}>{children}</p>
}

/* the torn divider between sections */
export function Torn() {
  return (
    <div className="torn" aria-hidden>
      <svg viewBox="0 0 1200 14" preserveAspectRatio="none">
        <path
          d="M0,7 Q15,2 30,7 T60,7 T90,7 T120,7 T150,7 T180,7 T210,7 T240,7 T270,7 T300,7 T330,7 T360,7 T390,7 T420,7 T450,7 T480,7 T510,7 T540,7 T570,7 T600,7 T630,7 T660,7 T690,7 T720,7 T750,7 T780,7 T810,7 T840,7 T870,7 T900,7 T930,7 T960,7 T990,7 T1020,7 T1050,7 T1080,7 T1110,7 T1140,7 T1170,7 T1200,7"
          fill="none" stroke="currentColor" strokeWidth="1.2"
        />
      </svg>
    </div>
  )
}

export function AIWordsButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <RoughBtn className="words-ai-btn" onClick={onClick} disabled={busy} title="Ask your configured LLM to write this">
      <I name={busy ? 'clock' : 'spark'} /> {busy ? 'writing…' : 'write it'}
    </RoughBtn>
  )
}
