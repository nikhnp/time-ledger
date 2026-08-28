'use client'

import { useState, useEffect } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'

/**
 * ConsistencyHeatmap — GitHub-style contribution heatmap for habit tracking.
 *
 * Renders an 18-week × 7-day grid showing which days the user completed
 * the selected habit. Includes a dropdown to switch habits and an
 * "Overall / By habit" toggle.
 *
 * Per the user's mockup: dark card with grid of small squares, accent color
 * for completed days, footer showing the time range.
 */

interface ConsistencyHeatmapProps {
  /** Override the number of weeks to show (default 18). */
  weeks?: number
}

export default function ConsistencyHeatmap({ weeks = 18 }: ConsistencyHeatmapProps) {
  const ledger = useLedger((s) => s.ledger)
  const [pickedHabitId, setPickedHabitId] = useState<string>('')
  const [view, setView] = useState<'overall' | 'byHabit'>('byHabit')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [cells, setCells] = useState<Array<{ date: string; done: boolean }>>([])

  /* the effective habit: the user's pick when valid, else the first one */
  const habits = ledger?.habits ?? []
  const selectedHabitId = habits.some((h) => h.id === pickedHabitId)
    ? pickedHabitId
    : habits[0]?.id ?? ''

  // Fetch consistency data via API (we don't call the data layer directly from client)
  useEffect(() => {
    if (!selectedHabitId) return
    let cancelled = false
    fetch(`/api/habits/consistency?habitId=${encodeURIComponent(selectedHabitId)}&weeks=${weeks}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data?.cells) setCells(data.cells)
      })
      .catch(() => { /* ignore — leave empty */ })
    return () => { cancelled = true }
  }, [selectedHabitId, weeks])

  if (!ledger) return null
  if (habits.length === 0) {
    return (
      <div className="consistency-card">
        <div className="consistency-header">
          <div className="consistency-title">
            <span className="consistency-title-icon"><I name="check" /></span>
            Consistency
          </div>
        </div>
        <div className="consistency-empty">
          No habits yet. Add one in the Habits view to start tracking consistency.
        </div>
      </div>
    )
  }

  const selectedHabit = habits.find((h) => h.id === selectedHabitId) ?? habits[0]

  // Build the heatmap grid: 7 rows (days of week) × N columns (weeks)
  const today = new Date().toISOString().slice(0, 10)
  const grid: Array<Array<{ date: string; done: boolean }>> = []
  for (let row = 0; row < 7; row++) {
    grid[row] = []
  }
  // Cells come in chronological order: oldest first. Group into weeks of 7.
  const totalDays = weeks * 7
  for (let i = 0; i < totalDays; i++) {
    const cell = cells[i] ?? { date: '', done: false }
    const row = i % 7
    grid[row].push(cell)
  }

  return (
    <div className="consistency-card">
      <div className="consistency-header">
        <div className="consistency-title">
          <span className="consistency-title-icon"><I name="check" /></span>
          Consistency
        </div>
        <div className="consistency-controls">
          <div className="consistency-dropdown">
            <button
              className="consistency-dropdown-btn"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              type="button"
            >
              {selectedHabit.name}
              <I name="caret-down" />
            </button>
            {dropdownOpen && (
              <div className="consistency-dropdown-menu" role="listbox">
                {habits.map((h) => (
                  <button
                    key={h.id}
                    className={`consistency-dropdown-item${h.id === selectedHabitId ? ' selected' : ''}`}
                    onClick={() => { setPickedHabitId(h.id); setDropdownOpen(false) }}
                    role="option"
                    aria-selected={h.id === selectedHabitId}
                    type="button"
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="consistency-toggle" role="group" aria-label="View mode">
            <button
              className={view === 'overall' ? 'active' : ''}
              onClick={() => setView('overall')}
              type="button"
            >
              Overall
            </button>
            <button
              className={view === 'byHabit' ? 'active' : ''}
              onClick={() => setView('byHabit')}
              type="button"
            >
              By habit
            </button>
          </div>
        </div>
      </div>

      <div className="consistency-heatmap" role="img" aria-label={`Habit consistency heatmap for ${selectedHabit.name} over the last ${weeks} weeks`}>
        {grid.map((week, rowIdx) => (
          <div className="consistency-week-row" key={rowIdx}>
            {week.map((cell, colIdx) => (
              <div
                key={`${rowIdx}-${colIdx}`}
                className={`consistency-cell${cell.done ? ' done' : ''}${cell.date === today ? ' today' : ''}`}
                title={cell.date ? `${cell.date}: ${cell.done ? 'done' : 'not done'}` : ''}
                aria-label={cell.date ? `${cell.date}: ${cell.done ? 'done' : 'not done'}` : ''}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="consistency-footer">
        last {weeks} weeks — {selectedHabit.name}
      </div>
    </div>
  )
}
