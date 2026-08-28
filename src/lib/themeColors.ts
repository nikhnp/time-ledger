'use client'
/* Theme color access — reads CSS custom properties set by the 5 themes in
 * ledger.css (Linen / Night / Sage / Clay / Slate), with Linen-safe fallbacks.
 * All rough.js art routes through these getters so every stroke, fill and
 * chart re-tints when the appearance changes. */

import { useEffect, useState } from 'react'

/* ---------- raw CSS var read ---------- */

export function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

/* ---------- semantic getters ---------- */

export function accentHex(): string { return cssVar('--accent', '#BC5A33') }
export function accentDeepHex(): string { return cssVar('--accent-deep', '#A34A28') }
export function accentSoftHex(): string { return cssVar('--accent-soft', '#F3DDCB') }
export function onAccentHex(): string { return cssVar('--on-accent', '#FFF8EE') }
export function inkHex(): string { return cssVar('--ink', '#2E2418') }
export function inkSoftHex(): string { return cssVar('--ink-soft', '#63513C') }
export function inkFaintHex(): string { return cssVar('--ink-faint', '#6E5D49') }
export function paperHex(): string { return cssVar('--paper', '#F1E9DB') }
export function paperCardHex(): string { return cssVar('--paper-card', '#FAF4E9') }
export function ruleHex(): string { return cssVar('--rule', '#D3C2A4') }
export function goodHex(): string { return cssVar('--good', '#7E9A6B') }
export function warnHex(): string { return cssVar('--warn', '#C08A2D') }
export function badHex(): string { return cssVar('--bad', '#B95F52') }

/** Categorical chart color (1-based). Falls back to accent. */
export function chartHex(n: number): string {
  const names = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7']
  const name = names[(n - 1 + names.length) % names.length]
  return cssVar(name, ['#C96F4A', '#D19A3F', '#7E9A6B', '#6E93A0', '#B5858F', '#96829F', '#A29272'][(n - 1 + 7) % 7])
}

/** Convert #rrggbb to rgba() with alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const int = parseInt(m[1], 16)
  const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255
  return `rgba(${r},${g},${b},${alpha})`
}

/* ---------- re-render on theme switch ----------
 * Rough art is drawn imperatively in layout effects; the color getters read
 * the DOM at draw time. When data-theme changes we bump a counter so every
 * drawing effect re-runs and re-tints. */

const themeListeners = new Set<() => void>()
let observing = false

function ensureObserver() {
  if (observing || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return
  observing = true
  const mo = new MutationObserver(() => themeListeners.forEach((l) => l()))
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

/** Returns a counter that increments whenever the theme attribute changes. */
export function useThemeTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    ensureObserver()
    const fn = () => setTick((t) => t + 1)
    themeListeners.add(fn)
    return () => { themeListeners.delete(fn) }
  }, [])
  return tick
}
