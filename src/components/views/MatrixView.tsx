'use client'

import { useMemo } from 'react'
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { ViewHead, Washi } from '@/components/bits'
import { allTasks, quadrantOf, type Quadrant } from '@/lib/derivations'
import { goalCat } from '@/lib/colors'

const QUADS: Array<{ id: Quadrant; title: string; color: string }> = [
  { id: 'q1', title: 'Do first — urgent & important', color: 'var(--terracotta)' },
  { id: 'q2', title: 'Schedule — important, not urgent', color: 'var(--sage)' },
  { id: 'q3', title: 'Delegate — urgent, not important', color: 'var(--mustard)' },
  { id: 'q4', title: 'Eliminate — neither', color: 'var(--ink-faint)' },
]
const Q_ORDER: Quadrant[] = ['q1', 'q2', 'q4', 'q3']

function MItem({ task, goalId, goalName }: { task: { id: string; label: string; urgent: boolean; important: boolean; status: string }; goalId: string; goalName: string }) {
  const updateTask = useLedger((s) => s.updateTask)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  const cat = goalCat(goalId)

  function nextQuad() {
    const cur = quadrantOf(task as never) ?? 'q4'
    const next = Q_ORDER[(Q_ORDER.indexOf(cur) + 1) % Q_ORDER.length]
    updateTask(task.id, { urgent: next === 'q1' || next === 'q3', important: next === 'q1' || next === 'q2' })
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`mitem${isDragging ? ' dragging' : ''}`}
      style={{ touchAction: 'none' }}
    >
      <div className="k-top">
        <span className="k-label">{task.label}</span>
        <span className="k-actions">
          <button
            className="icon-btn"
            onClick={(e) => { e.stopPropagation(); nextQuad() }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Next quadrant"
          >
            <I name="cycle" />
          </button>
          <button
            className="icon-btn"
            onClick={(e) => { e.stopPropagation(); updateTask(task.id, { status: 'done' }) }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Done"
          >
            <I name="check" />
          </button>
        </span>
      </div>
      <div className="k-tags">
        <span className="k-goal" style={{ background: `${cat.hex}22`, color: cat.hex }}>{goalName}</span>
      </div>
    </div>
  )
}

function Quad({ quad, tasks }: { quad: typeof QUADS[number]; tasks: Array<{ task: { id: string; label: string; urgent: boolean; important: boolean; status: string }; goalId: string; goalName: string }> }) {
  const { setNodeRef, isOver } = useDroppable({ id: quad.id })
  return (
    <div className={`matrix-quad${isOver ? ' drag-over' : ''}`} ref={setNodeRef} data-q={quad.id}>
      <h4 style={{ color: quad.color }}>{quad.title}</h4>
      <div>
        {tasks.length === 0 && <p className="note" style={{ fontSize: '.8rem', margin: 0 }}>empty</p>}
        {tasks.map((x) => <MItem key={x.task.id} task={x.task} goalId={x.goalId} goalName={x.goalName} />)}
      </div>
    </div>
  )
}

export default function MatrixView() {
  const ledger = useLedger((s) => s.ledger)!
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  )

  const tasks = useMemo(
    () => allTasks(ledger).filter((x) => quadrantOf(x.task) !== null),
    [ledger]
  )

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id)
    const q = e.over?.id ? String(e.over.id) as Quadrant : null
    if (!q) return
    useLedger.getState().updateTask(id, { urgent: q === 'q1' || q === 'q3', important: q === 'q1' || q === 'q2' })
  }

  return (
    <>
      <ViewHead title="Matrix" sub="urgent vs important — drag cards between quadrants" />
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="matrix-grid">
          {QUADS.map((quad) => (
            <Quad
              key={quad.id}
              quad={quad}
              tasks={tasks.filter((x) => quadrantOf(x.task as never) === quad.id)}
            />
          ))}
        </div>
      </DndContext>
      <p className="chart-note" style={{ marginTop: 14 }}>
        quadrant flags live on each task (urgent / important) — done tasks leave the matrix
      </p>
      <div style={{ display: 'none' }}><Washi bg="none" color="none">x</Washi></div>
    </>
  )
}
