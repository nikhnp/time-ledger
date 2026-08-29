'use client'

import { useMemo, useState } from 'react'
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import { Stamp, ViewHead, Washi } from '@/components/bits'
import { allTasks, STATUS_ORDER } from '@/lib/derivations'
import { goalCat } from '@/lib/colors'
import { daysSince, todayStr } from '@/lib/dates'
import type { TaskStatus } from '@/lib/types'

const COLS: Array<{ id: TaskStatus; title: string }> = [
  { id: 'todo', title: 'To do' },
  { id: 'doing', title: 'In progress' },
  { id: 'done', title: 'Done' },
]

function Card({ task, goalId, goalName }: { task: { id: string; label: string; status: string; priority: string; lastTouched: string }; goalId: string | null; goalName: string }) {
  const updateTask = useLedger((s) => s.updateTask)
  const deleteTask = useLedger((s) => s.deleteTask)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  const cat = goalCat(goalId)
  const idle = daysSince(task.lastTouched)
  /* P2-3: task label edit — the audit's "card edit-in-place" */
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.label)

  function saveLabel() {
    const v = draft.trim()
    if (v && v !== task.label) updateTask(task.id, { label: v })
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`kcard${task.status === 'done' ? ' done' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ touchAction: 'none' }}
    >
      <div className="k-top">
        {editing ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveLabel()
              if (e.key === 'Escape') { setEditing(false); setDraft(task.label) }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={saveLabel}
            style={{ flex: 1, fontSize: '.86rem', padding: '2px 6px' }}
            aria-label="Edit card label"
          />
        ) : (
          <span className="k-label">{task.label}</span>
        )}
        <span className="k-actions">
          {!editing && (
            <button
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); setDraft(task.label); setEditing(true) }}
              title="Edit label"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <I name="pencil" />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={(e) => { e.stopPropagation(); updateTask(task.id, { status: STATUS_ORDER[(STATUS_ORDER.indexOf(task.status as TaskStatus) + 1) % 3] }) }}
            title="Move along"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <I name="cycle" />
          </button>
          <button
            className="icon-btn"
            onClick={(e) => { e.stopPropagation(); deleteTask(task.id) }}
            title="Delete"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <I name="trash" />
          </button>
        </span>
      </div>
      <div className="k-tags">
        <span className="k-goal" style={{ background: `${cat.hex}22`, color: cat.hex }}>{goalName}</span>
        {task.priority === 'high' && <Washi bg="var(--terracotta-soft)" color="var(--terracotta)">priority</Washi>}
        {task.status !== 'done' && idle >= 3 && <Washi bg="var(--stone-soft)" color="var(--ink-soft)">{idle}d idle</Washi>}
      </div>
    </div>
  )
}

function Column({ col, tasks }: { col: { id: TaskStatus; title: string }; tasks: Array<{ task: { id: string; label: string; status: string; priority: string; lastTouched: string }; goalId: string | null; goalName: string }> }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id })
  return (
    <div className={`board-col${isOver ? ' drag-over' : ''}`} ref={setNodeRef} data-col={col.id}>
      <h3>{col.title} <span className="count">{tasks.length}</span></h3>
      <div>
        {tasks.length === 0 && <p className="note" style={{ fontSize: '.8rem', margin: '4px 0 10px' }}>nothing here</p>}
        {tasks.map((x) => <Card key={x.task.id} task={x.task} goalId={x.goalId} goalName={x.goalName} />)}
      </div>
    </div>
  )
}

export default function BoardView() {
  const ledger = useLedger((s) => s.ledger)!
  const addTask = useLedger((s) => s.addTask)
  const [label, setLabel] = useState('')
  const [goalId, setGoalId] = useState(ledger.goals[0]?.id ?? '')
  const [priority, setPriority] = useState<'normal' | 'high'>('normal')
  const [status, setStatus] = useState<TaskStatus>('todo')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  )

  const tasks = useMemo(() => allTasks(ledger), [ledger])

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id)
    const col = e.over?.id ? String(e.over.id) : null
    if (!col) return
    const st = col as TaskStatus
    const ref = tasks.find((x) => x.task.id === id)
    if (ref && ref.task.status !== st) useLedger.getState().updateTask(id, { status: st })
  }

  async function submit() {
    if (!label.trim()) { useLedger.getState().showToast('Give the card a name.'); return }
    /* v10.5: goal is optional — empty goal select or "No goal" creates an unassigned card */
    await addTask(goalId || null, label.trim(), priority, { status })
    setLabel('')
    useLedger.getState().showToast('Card added ✓')
  }

  return (
    <>
      <ViewHead title="Board" sub="every card is a real task — drag, tap-cycle, or pick a column below" />
      <div className="board-add">
        <input
          type="text"
          placeholder="New card — e.g. Draft the launch email"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="Goal">
          {ledger.goals.length === 0 && <option value="">No goal — free card</option>}
          {ledger.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          {ledger.goals.length > 0 && <option value="">No goal — free card</option>}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} aria-label="Column">
          {COLS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as 'normal' | 'high')} aria-label="Priority">
          <option value="normal">normal</option>
          <option value="high">priority</option>
        </select>
        <RoughBtn variant="primary" className="btn-sm" onClick={submit}><I name="plus" /> Add card</RoughBtn>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="board-cols">
          {COLS.map((col) => (
            <Column key={col.id} col={col} tasks={tasks.filter((x) => x.task.status === col.id)} />
          ))}
        </div>
      </DndContext>

      <p className="chart-note" style={{ marginTop: 14 }}>
        board state lives in the ledger — {tasks.filter((x) => x.task.status !== 'done').length} open tasks · updated {todayStr()}
      </p>
      <div style={{ display: 'none' }}><Stamp icon="columns">Board</Stamp></div>
    </>
  )
}
